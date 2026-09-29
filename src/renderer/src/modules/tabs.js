/**
 * LogPad 多标签编辑核心（任务 4）
 *
 * 职责：
 *  - 单一 Monaco 编辑器实例 + 每标签独立 model：切换标签时光标/撤销栈/滚动位置完整保留
 *  - 打开/新建/关闭/关闭其他/关闭全部/保存/另存/全部保存（含未保存关闭保护）
 *  - 标签右键菜单、拖拽排序、Ctrl+Tab 循环切换、Ctrl+W / Ctrl+Shift+W
 *  - 打开文件时启动监视（file-event 事件处理由任务 11 followTail.js 订阅）
 *  - 会话保存/恢复、最近文件记录（设置对话框/菜单联动在任务 5/14）
 *
 * 对外契约：ctx.tabs（后续模块唯一入口）
 *  事件（ctx.tabs.on）：activated | opened | closed | dirty-changed | saved
 *  命令（ctx.commandBus）：file.new / file.open / file.save / file.saveAs /
 *                          file.saveAll / file.close / file.closeAll / file.closeOthers
 */
import { switchTheme } from '../themes.js'

export function init(ctx) {
  const { monaco, commandBus, status, settings } = ctx

  /* ==================== 状态 ==================== */

  const tabs = [] // { id, path|null, name, model, viewState, encoding, eol, large, savedVersionId }
  let activeId = null
  let nextId = 1
  let untitledSeq = 1
  let quitting = false // 退出流程放行标记
  const listeners = { activated: [], opened: [], closed: [], 'dirty-changed': [], saved: [] }

  const tabbar = document.getElementById('tabbar')
  const editorHost = document.getElementById('editor-host')

  /* ==================== 编辑器实例 ==================== */

  /** 应用基础视图选项（创建后/设置加载后/选项变化时统一调用）
   *  wordWrapMinified：Monaco 对"长行占多数"的文件（日志常见：整行 JSON/堆栈）
   *  默认拒绝换行（按压缩文件处理），这里强制换行，否则自动换行"时灵时不灵" */
  function applyEditorOptions() {
    editor.updateOptions({
      fontSize: settings.fontSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      wordWrapMinified: true,
      renderWhitespace: settings.showWhitespace ? 'all' : 'none',
      lineNumbers: settings.lineNumbers ? 'on' : 'off',
      glyphMargin: true, // 书签（任务 8）
      minimap: { enabled: false },
      scrollBeyondLastLine: true,
      automaticLayout: true,
      renderLineHighlight: 'all',
      smoothScrolling: true
    })
    // 同步 DOM 换行标记：底部搜索结果面板据此联动正文换行状态（一个开关管两处）
    document.documentElement.dataset.wrap = settings.wordWrap ? 'on' : 'off'
  }

  const existing = monaco.editor.getEditors()[0]
  let editor = existing
  if (!editor) {
    editor = monaco.editor.create(editorHost, { automaticLayout: true })
  }
  // 启动即同步应用默认主题与视图选项：不等任何 IPC/异步 import，
  // 消除"主题未应用 → 正文无多种色调 + 换行设置未生效"的偶发启动竞态
  try {
    switchTheme(monaco, settings.theme === 'light' ? 'light' : 'dark')
  } catch {
    /* 主题注册失败不阻断编辑器 */
  }
  applyEditorOptions()

  /* ==================== 工具函数 ==================== */

  function basename(p) {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
    return i >= 0 ? p.slice(i + 1) : p
  }

  function normalizePath(p) {
    return p.replace(/\\/g, '/')
  }

  function logRegistered() {
    return monaco.languages.getLanguages().some((l) => l.id === 'log')
  }

  /** 按扩展名选择语言；.log/.txt/.out/.trace 用自定义 log 语言（任务 9 注册后生效） */
  function detectLanguage(path, large) {
    if (large) return 'plaintext' // 大文件模式禁用高亮（任务 13 校验）
    const p = normalizePath(path).toLowerCase()
    const m = p.match(/\.([a-z0-9]+)$/)
    const ext = m ? m[1] : ''
    if (['log', 'txt', 'out', 'trace'].includes(ext)) {
      return logRegistered() ? 'log' : 'plaintext'
    }
    for (const lang of monaco.languages.getLanguages()) {
      if (lang.extensions && lang.extensions.some((e) => p.endsWith(e))) return lang.id
    }
    return 'plaintext'
  }

  function emit(ev, data) {
    for (const cb of listeners[ev]) cb(data)
  }

  function getTab(id) {
    return tabs.find((t) => t.id === id)
  }

  /* ==================== 标签栏 DOM ==================== */

  function renderTabs() {
    tabbar.innerHTML = ''
    for (const t of tabs) {
      const el = document.createElement('div')
      el.className = 'tab' + (t.id === activeId ? ' active' : '') + (t.dirty ? ' dirty' : '')
      el.dataset.tabId = t.id
      el.draggable = true
      el.title = t.path || `未保存 - ${t.name}`

      const label = document.createElement('span')
      label.className = 'tab-label'
      label.textContent = t.name
      el.appendChild(label)

      const close = document.createElement('span')
      close.className = 'tab-close'
      close.textContent = '✕'
      close.title = '关闭'
      el.appendChild(close)

      el.addEventListener('click', (e) => {
        if (e.target === close) {
          closeTabWithConfirm(t.id)
        } else {
          activate(t.id)
        }
      })
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        showTabContextMenu(e, t.id)
      })

      // 拖拽排序
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/logpad-tab', String(t.id))
        e.dataTransfer.effectAllowed = 'move'
      })
      el.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        el.style.borderLeft = '2px solid var(--accent)'
      })
      el.addEventListener('dragleave', () => {
        el.style.borderLeft = ''
      })
      el.addEventListener('drop', (e) => {
        e.preventDefault()
        el.style.borderLeft = ''
        const srcId = Number(e.dataTransfer.getData('text/logpad-tab'))
        moveTab(srcId, t.id)
      })

      tabbar.appendChild(el)
    }
    const newBtn = document.createElement('div')
    newBtn.className = 'tab-new'
    newBtn.textContent = '+'
    newBtn.title = '新建标签页 (Ctrl+N)'
    newBtn.addEventListener('click', () => newUntitled())
    tabbar.appendChild(newBtn)
  }

  /** 拖拽：把 srcId 移到 targetId 之前 */
  function moveTab(srcId, targetId) {
    if (srcId === targetId) return
    const srcIdx = tabs.findIndex((t) => t.id === srcId)
    const tgtIdx = tabs.findIndex((t) => t.id === targetId)
    if (srcIdx < 0 || tgtIdx < 0) return
    const [moved] = tabs.splice(srcIdx, 1)
    tabs.splice(tgtIdx, 0, moved)
    renderTabs()
    saveSessionSoon()
  }

  /* ==================== 标签右键菜单 ==================== */

  let ctxMenu = null

  function closeContextMenu() {
    if (ctxMenu) {
      ctxMenu.remove()
      ctxMenu = null
    }
  }

  function showTabContextMenu(e, tabId) {
    closeContextMenu()
    const t = getTab(tabId)
    if (!t) return
    const overlay = document.getElementById('overlay-layer')
    ctxMenu = document.createElement('div')
    ctxMenu.className = 'menu-dropdown'
    ctxMenu.style.left = e.clientX + 'px'
    ctxMenu.style.top = e.clientY + 'px'

    const mk = (label, fn, disabled) => {
      const item = document.createElement('div')
      item.className = 'menu-item' + (disabled ? ' disabled' : '')
      const span = document.createElement('span')
      span.className = 'menu-label'
      span.textContent = label
      item.appendChild(span)
      if (!disabled) item.addEventListener('click', () => { closeContextMenu(); fn() })
      ctxMenu.appendChild(item)
    }

    mk('关闭', () => closeTabWithConfirm(tabId))
    mk('关闭其他标签页', () => closeOthers(tabId), tabs.length <= 1)
    mk('关闭所有标签页', () => closeAll(), tabs.length === 0)
    ctxMenu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' }))
    mk('复制文件路径', () => navigator.clipboard.writeText(t.path || ''), !t.path)
    mk('打开所在文件夹', () => window.api.showInFolder(t.path), !t.path)
    mk('重新加载', async () => {
      if (t.path) await reloadTab(tabId)
    }, !t.path)

    overlay.appendChild(ctxMenu)
    setTimeout(() => {
      const off = (ev) => {
        if (!ctxMenu.contains(ev.target)) {
          closeContextMenu()
          document.removeEventListener('mousedown', off, true)
        }
      }
      document.addEventListener('mousedown', off, true)
    }, 0)
  }

  /* ==================== 激活与切换 ==================== */

  function activate(id) {
    const t = getTab(id)
    if (!t || id === activeId) return
    // 保存当前标签视图状态（光标/滚动）
    if (activeId !== null) {
      const cur = getTab(activeId)
      if (cur) cur.viewState = editor.saveViewState()
    }
    activeId = id
    editor.setModel(t.model)
    if (t.viewState) editor.restoreViewState(t.viewState)
    editor.focus()
    renderTabs()
    emit('activated', t)
    saveSessionSoon()
  }

  function nextTab() {
    if (tabs.length < 2) return
    const idx = tabs.findIndex((t) => t.id === activeId)
    activate(tabs[(idx + 1) % tabs.length].id)
  }

  function prevTab() {
    if (tabs.length < 2) return
    const idx = tabs.findIndex((t) => t.id === activeId)
    activate(tabs[(idx - 1 + tabs.length) % tabs.length].id)
  }

  /* ==================== 脏状态 ==================== */

  function watchDirty(t) {
    t.model.onDidChangeContent(() => {
      const dirty = t.model.getAlternativeVersionId() !== t.savedVersionId
      if (dirty !== t.dirty) {
        t.dirty = dirty
        renderTabs()
        emit('dirty-changed', t)
      }
    })
  }

  function setClean(t) {
    t.savedVersionId = t.model.getAlternativeVersionId()
    t.dirty = false
    renderTabs()
    emit('dirty-changed', t)
  }

  /* ==================== 打开 / 新建 ==================== */

  async function openPaths(paths) {
    for (const p of paths) await openFile(p)
  }

  async function openFile(path) {
    const norm = normalizePath(path)
    const exist = tabs.find((t) => t.path === norm)
    if (exist) {
      activate(exist.id)
      return exist
    }
    let data
    try {
      data = await window.api.openFile(norm)
    } catch (err) {
      await window.api.showMessageBox({
        type: 'error',
        message: '打开文件失败',
        detail: `${norm}\n\n${err.message || err}`,
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0
      })
      return null
    }
    if (!data) return null

    const t = {
      id: nextId++,
      path: norm,
      name: basename(norm),
      model: monaco.editor.createModel(data.content, detectLanguage(norm, data.large)),
      viewState: null,
      encoding: data.encoding,
      eol: data.eol,
      large: data.large,
      savedVersionId: 0,
      dirty: false
    }
    setClean(t)
    watchDirty(t)
    tabs.push(t)
    renderTabs()
    activate(t.id)

    window.api.watchFile(norm)
    window.api.pushRecent(norm)
    emit('opened', t)
    saveSessionSoon()
    return t
  }

  function newUntitled() {
    const t = {
      id: nextId++,
      path: null,
      name: `新建 ${untitledSeq++}`,
      model: monaco.editor.createModel('', logRegistered() ? 'log' : 'plaintext'),
      viewState: null,
      encoding: 'utf-8',
      eol: 'LF',
      large: false,
      savedVersionId: 0,
      dirty: false
    }
    setClean(t)
    watchDirty(t)
    tabs.push(t)
    renderTabs()
    activate(t.id)
    emit('opened', t)
    return t
  }

  /* ==================== 关闭 ==================== */

  async function confirmClose(t) {
    // 返回 true=允许关闭（已处理保存），false=取消
    if (!t.dirty) return true
    const res = await window.api.showMessageBox({
      type: 'warning',
      message: '是否将更改保存到以下文件？',
      detail: t.path || `未保存 - ${t.name}`,
      buttons: ['保存', '不保存', '取消'],
      defaultId: 0,
      cancelId: 2
    })
    if (res.response === 0) {
      const saved = await saveTab(t)
      return saved
    }
    return res.response === 1
  }

  async function closeTabWithConfirm(id) {
    const t = getTab(id)
    if (!t) return false
    if (!(await confirmClose(t))) return false
    return closeTab(id)
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return false
    const [t] = tabs.splice(idx, 1)
    if (t.path) window.api.unwatchFile(t.path)
    t.model.dispose()
    if (activeId === id) {
      activeId = null
      const fallback = tabs[Math.min(idx, tabs.length - 1)]
      if (fallback) {
        activate(fallback.id)
      } else {
        editor.setModel(null)
        renderTabs()
      }
    } else {
      renderTabs()
    }
    emit('closed', t)
    saveSessionSoon()
    return true
  }

  async function closeOthers(keepId) {
    for (const t of [...tabs]) {
      if (t.id !== keepId) {
        // 连续关闭：逐个确认（取消则中断）
        if (!(await closeTabWithConfirm(t.id))) return
      }
    }
  }

  async function closeAll() {
    for (const t of [...tabs]) {
      if (!(await closeTabWithConfirm(t.id))) return
    }
  }

  /* ==================== 保存 ==================== */

  /** 保存单个标签（未命名走另存为），成功返回 true */
  async function saveTab(t) {
    if (!t.path) return saveTabAs(t)
    try {
      let content = t.model.getValue()
      // 按 tab 检测的 EOL 统一换行
      if (t.eol === 'CRLF') content = content.replace(/\r\n|\n|\r/g, '\r\n')
      await window.api.saveFile(t.path, content, t.encoding)
      setClean(t)
      emit('saved', t)
      status.set('dirty', null)
      return true
    } catch (err) {
      await window.api.showMessageBox({
        type: 'error',
        message: '保存失败',
        detail: `${t.path}\n\n${err.message || err}`,
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0
      })
      return false
    }
  }

  async function saveTabAs(t) {
    const defaultPath = t.path || (t.name.endsWith('.log') ? t.name : `${t.name}.log`)
    const target = await window.api.saveFileDialog(defaultPath)
    if (!target) return false
    const norm = normalizePath(target)
    const other = tabs.find((x) => x.path === norm && x.id !== t.id)
    if (other) {
      await window.api.showMessageBox({
        type: 'warning',
        message: '该文件已在其他标签页中打开',
        detail: norm,
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0
      })
      return false
    }
    t.path = norm
    t.name = basename(norm)
    try {
      let content = t.model.getValue()
      if (t.eol === 'CRLF') content = content.replace(/\r\n|\n|\r/g, '\r\n')
      await window.api.saveFile(t.path, content, t.encoding)
    } catch (err) {
      await window.api.showMessageBox({
        type: 'error',
        message: '保存失败',
        detail: `${t.path}\n\n${err.message || err}`,
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0
      })
      return false
    }
    setClean(t)
    window.api.watchFile(t.path)
    window.api.pushRecent(t.path)
    renderTabs()
    emit('saved', t)
    return true
  }

  function saveActive() {
    const t = getTab(activeId)
    if (t) return saveTab(t)
  }

  async function saveActiveAs() {
    const t = getTab(activeId)
    if (t) return saveTabAs(t)
    return false
  }

  async function saveAll() {
    let all = true
    for (const t of tabs) {
      if (t.dirty || !t.path) {
        if (!(await saveTab(t))) all = false
      }
    }
    return all
  }

  /* ==================== 重载（外部修改自动重载在任务 11 扩展） ==================== */

  async function reloadTab(id) {
    const t = getTab(id)
    if (!t || !t.path) return
    const pos = editor.getModel() === t.model ? editor.getPosition() : null
    const data = await window.api.openFile(t.path)
    if (!data) return
    t.model.setValue(data.content)
    t.encoding = data.encoding
    t.eol = data.eol
    setClean(t)
    if (pos) {
      const line = Math.min(pos.lineNumber, t.model.getLineCount())
      t.model && editor.setPosition({ lineNumber: line, column: Math.min(pos.column, t.model.getLineMaxColumn(line)) })
    }
    emit('activated', t)
  }

  /** 以指定编码重新加载（编码菜单用，任务 5/14 绑定） */
  async function reloadWithEncoding(id, encoding) {
    const t = getTab(id)
    if (!t || !t.path) return
    const data = await window.api.readFileWithEncoding(t.path, encoding)
    t.model.setValue(data.content)
    t.encoding = encoding
    t.eol = data.eol
    setClean(t)
    emit('activated', t)
  }

  /* ==================== 会话持久化 ==================== */

  let sessionTimer = null
  function saveSessionSoon() {
    clearTimeout(sessionTimer)
    sessionTimer = setTimeout(() => {
      window.api.saveSession({
        tabs: tabs.filter((t) => t.path).map((t) => ({ path: t.path })),
        activeIndex: Math.max(0, tabs.findIndex((t) => t.id === activeId))
      })
    }, 400)
  }

  /* ==================== 对外 API ==================== */

  ctx.tabs = {
    get editor() {
      return editor
    },
    getAll: () => [...tabs],
    getActive: () => getTab(activeId) || null,
    findTabByPath: (path) => tabs.find((t) => t.path === normalizePath(path)) || null,
    getActiveModel: () => (activeId !== null ? getTab(activeId)?.model : null) || null,
    openPaths,
    openFile,
    newUntitled,
    activate,
    nextTab,
    prevTab,
    closeTab: closeTabWithConfirm,
    closeOthers,
    closeAll,
    saveActive,
    saveActiveAs,
    saveAll,
    saveTab,
    reloadTab,
    reloadWithEncoding,
    moveTab,
    /** 事件订阅：activated | opened | closed | dirty-changed | saved */
    on(ev, cb) {
      if (listeners[ev]) {
        listeners[ev].push(cb)
        return () => {
          const i = listeners[ev].indexOf(cb)
          if (i >= 0) listeners[ev].splice(i, 1)
        }
      }
      console.warn(`[tabs] 未知事件: ${ev}`)
    }
  }

  /* ==================== 命令注册（菜单/工具栏经 commandBus 调用） ==================== */

  commandBus.register('file.new', { label: '新建', run: () => newUntitled() })
  commandBus.register('file.open', {
    label: '打开...',
    run: async () => {
      const paths = await window.api.openFileDialog()
      if (!paths || !paths.length) return
      for (const p of paths) {
        // 文件夹 → 左侧工作区树（同 Notepad++ Open Folder as Workspace）
        if (await window.api.isDirectory(p)) ctx.workspace?.open(p)
        else await openFile(p)
      }
    }
  })
  commandBus.register('file.save', { label: '保存', run: () => saveActive() })
  commandBus.register('file.saveAs', { label: '另存为...', run: () => saveActiveAs() })
  commandBus.register('file.saveAll', { label: '全部保存', run: () => saveAll() })
  commandBus.register('file.close', { label: '关闭当前标签', run: () => activeId !== null && closeTabWithConfirm(activeId) })
  commandBus.register('file.closeAll', { label: '关闭所有标签', run: () => closeAll() })
  commandBus.register('file.closeOthers', { label: '关闭其他标签', run: () => activeId !== null && closeOthers(activeId) })

  /* ==================== 快捷键（capture 拦截，含 Ctrl+W 防关窗） ==================== */

  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        commandBus.execute('file.new')
      } else if (key === 'o' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        commandBus.execute('file.open')
      } else if (key === 's' && e.shiftKey) {
        e.preventDefault()
        commandBus.execute('file.saveAs')
      } else if (key === 's') {
        e.preventDefault()
        commandBus.execute('file.save')
      } else if (key === 'w' && e.shiftKey) {
        e.preventDefault()
        commandBus.execute('file.closeAll')
      } else if (key === 'w') {
        e.preventDefault()
        commandBus.execute('file.close')
      } else if (key === 'tab') {
        e.preventDefault()
        if (e.shiftKey) prevTab()
        else nextTab()
      }
    },
    { capture: true }
  )

  /* ==================== 窗口关闭保护 + 会话 ==================== */

  window.addEventListener('beforeunload', (e) => {
    if (quitting) return undefined // 退出流程放行
    if (!tabs.some((t) => t.dirty)) {
      saveSessionSoon()
      return undefined
    }
    // 有未保存：阻止关闭，异步确认后退出
    e.preventDefault()
    e.returnValue = false
    ;(async () => {
      const ok = await saveAll() // saveAll 对每个脏标签走"保存"（未命名走另存，取消即中断）
      if (ok) {
        quitting = true
        saveSessionSoon()
        setTimeout(() => window.api.quitApp(), 100)
      }
    })()
    return false
  })

  /* ==================== 启动：加载设置 + 恢复会话 ==================== */

  const startupPromise = (async () => {
    // 设置读取单独 try：失败（如配置目录权限异常）不再连带跳过主题/视图应用
    try {
      const saved = await window.api.getSettings()
      Object.assign(settings, saved)
    } catch {
      /* settings 不可用时维持默认值（主题与选项已在上面同步应用） */
    }
    // 应用主题与基础视图（任务 3 主题库；任务 12 viewControls 完整接管视图选项）
    try {
      switchTheme(monaco, settings.theme === 'light' ? 'light' : 'dark')
    } catch {
      /* 主题切换失败不阻断会话恢复 */
    }
    applyEditorOptions()
    try {
      const session = await window.api.getSession()
      if (session && Array.isArray(session.tabs) && session.tabs.length) {
        await openPaths(session.tabs.map((t) => t.path).filter(Boolean))
      }
    } catch {
      /* 会话恢复失败忽略 */
    }
    if (tabs.length === 0) {
      newUntitled() // 空态：自动建一个未命名标签
    } else {
      renderTabs()
    }
  })()

  // "打开方式"/文件关联：主进程冷启动（did-finish-load）或 second-instance
  // 推送待打开文件路径，逐个在标签页打开（与拖放文件同一入口）。
  // 等启动会话恢复完成后再开：用户显式指定的文件最后打开 → 成为活动标签
  window.api.on('open-file-request', (files) => {
    ;(async () => {
      await startupPromise.catch(() => {})
      for (const f of files ?? []) {
        if (typeof f === 'string' && f) await openFile(f)
      }
    })()
  })

  // 冒烟/自动化钩子：连续撤销当前标签编辑直到恢复已保存状态
  // （冒烟向编辑器注入测试文本后调用，避免退出时 beforeunload 的
  //   自动保存把测试内容写回样例文件；走编辑器自身 undo，可靠清 dirty）
  document.addEventListener('logpad-smoke-revert', () => {
    const t = getTab(activeId)
    if (!t) return
    for (let i = 0; i < 50 && t.dirty; i++) editor.trigger('logpad', 'undo', null)
  })
}
