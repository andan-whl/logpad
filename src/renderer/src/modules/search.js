/**
 * LogPad 查找/替换/文件夹搜索 —— Notepad++ 风格（任务 6 + 用户迭代增强）
 *
 * Ctrl+F / Ctrl+H / Ctrl+Shift+F 弹出与 Notepad++ 一致的浮动对话框：
 *   左侧竖排标签（查找 / 替换 / 在文件中查找）、查找内容历史（datalist）、
 *   选项（区分大小写 / 全字匹配 / 循环查找 / 正则表达式 + 方向单选）、
 *   右侧按钮列（查找下一个 / 计数 / 在当前文档中全部查找 / 在所有打开文档中全部查找 /
 *   替换 / 全部替换 / 关闭），标题栏可拖动，无模式（不遮挡编辑）。
 *
 * "在文件中查找"标签（文件夹搜索）：目录（浏览 + 历史）+ 文件类型（; 分隔通配符）+
 *   包含子目录 / 区分大小写 / 全字匹配 / 正则，结果显示在底部"搜索结果"面板。
 *
 * 底部"搜索结果"面板（panel-searchresults，Notepad++ Search results window）：
 *   命中行 + 亮黄 <mark> 高亮 + 级别词着色 + 计数徽标；顶部拖动条可上下拉调节面板高度
 *   （双击复位）；点击命中行跳转到对应标签/文件并选中匹配片段。
 *
 * 快捷键（与 Notepad++ 兼容）：
 *   Ctrl+F 查找 | Ctrl+H 替换 | Ctrl+Shift+F 在文件中查找 | F3 / Shift+F3 |
 *   Ctrl+F3 查找选中词。正则替换支持 $1 与 \1 分组引用。
 */

export function init(ctx) {
  const { commandBus, monaco } = ctx

  /* ==================== 样式注入（模块自包含） ==================== */

  const style = document.createElement('style')
  style.textContent = `
    /* ===== 浮动查找/替换对话框（Notepad++ 风格，纵向布局：标签在上 / 表单居中 / 按钮在下） ===== */
    .lp-finddlg {
      position: absolute; display: flex; flex-direction: column; width: 660px;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 8px;
      box-shadow: var(--shadow); z-index: 1500; font-size: 13px;
    }
    .lp-finddlg[hidden] { display: none; }
    .lp-fd-drag {
      display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 12px;
      cursor: move; user-select: none;
    }
    .lp-fd-drag-title { color: var(--text-dim); font-weight: 600; flex: 1; }
    .lp-fd-tabs {
      display: flex; gap: 2px; padding: 0 8px; flex: none;
      border-bottom: 1px solid var(--border);
    }
    .lp-ftab {
      padding: 7px 14px; text-align: left; border: none; background: none;
      color: var(--text-dim); border-radius: 4px 4px 0 0; cursor: default; font-size: 13px; white-space: nowrap;
    }
    .lp-ftab:hover { background: var(--bg-hover); color: var(--text); }
    .lp-ftab.active { background: var(--accent); color: #fff; }
    .lp-fd-main { display: flex; min-height: 0; align-items: stretch; }
    .lp-fd-form { flex: 1; min-width: 0; padding: 8px 16px 8px; }
    .lp-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .lp-row > label { width: 62px; flex: none; text-align: right; color: var(--text); }
    .lp-row > input[type='text'] { flex: 1; min-width: 0; }
    .lp-row .panel-btn { flex: none; }
    .lp-opts {
      display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
      margin: 14px 0 6px 70px; color: var(--text-dim); font-size: 12px;
    }
    .lp-opts .dir { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
    .lp-fd-btns {
      display: flex; flex-direction: column; justify-content: center; align-items: stretch; gap: 6px;
      padding: 10px 12px; border-left: 1px solid var(--border);
    }
    .lp-fd-btns .btn { height: 26px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
    .lp-fd-status {
      display: flex; align-items: center; min-height: 26px; padding: 2px 12px;
      border-top: 1px solid var(--border); color: var(--text-dim); font-size: 12px;
    }
    .lp-fd-status.err { color: var(--danger); }
    /* 标签页显隐：fd-only 仅查找 / rp-only 仅替换 / if-only 仅在文件中查找 / if-hide 在文件中查找时隐藏 */
    .lp-finddlg:not([data-tab='find']) .fd-only { display: none !important; }
    .lp-finddlg:not([data-tab='replace']) .rp-only { display: none !important; }
    .lp-finddlg:not([data-tab='infiles']) .if-only { display: none !important; }
    .lp-finddlg[data-tab='infiles'] .if-hide { display: none !important; }

    /* ===== 底部面板高度调节条（拖动上拉/下拉） ===== */
    .lp-panels-resizer {
      flex: none; height: 6px; margin: 0; cursor: ns-resize;
      background: var(--bg-panel); border-top: 1px solid var(--border);
      position: relative; user-select: none;
    }
    .lp-panels-resizer::after {
      content: ''; position: absolute; left: 50%; top: 2px; transform: translateX(-50%);
      width: 48px; height: 2px; border-radius: 2px; background: var(--text-dim); opacity: 0.5;
    }
    .lp-panels-resizer:hover, .lp-panels-resizer.dragging { background: var(--bg-hover); }
    .lp-panels-resizer:hover::after, .lp-panels-resizer.dragging::after { background: var(--accent); opacity: 1; }

    /* ===== 底部"搜索结果"面板（Notepad++ Search results） ===== */
    #panel-searchresults { max-height: 240px; overflow: hidden; transition: max-height 150ms ease; }
    .sr-file {
      display: flex; align-items: center; gap: 8px; padding: 3px 10px;
      color: var(--text); font-weight: 600; cursor: default;
    }
    .sr-file:hover { background: var(--bg-hover); }
    .sr-file .sr-path { color: #89b4fa; }
    [data-theme='light'] .sr-file .sr-path { color: #0a58ca; }
    .sr-count {
      font-size: 11px; font-weight: 400; color: var(--text-dim);
      background: var(--bg-active); border-radius: 999px; padding: 0 8px;
    }
    .sr-file.sr-term { color: var(--accent); }
    .sr-line.active { background: var(--bg-active); box-shadow: inset 2px 0 0 var(--accent); }
    .sr-line .fi-lineno { color: #74c7d8; }
    [data-theme='light'] .sr-line .fi-lineno { color: #0e7490; }
    /* 命中高亮：亮黄底深字（Notepad++ 风格） */
    #panel-searchresults .fi-text mark {
      background: #ffd866; color: #221c00; border-radius: 2px; padding: 0 1px; font-weight: 600;
    }
    [data-theme='light'] #panel-searchresults .fi-text mark { background: #ffe45c; color: #3a2c00; }
    /* 级别词着色（与编辑器 token 色板一致） */
    .sr-lv-fatal { color: #ff4d6d; font-weight: 700; }
    .sr-lv-error { color: #f87171; font-weight: 600; }
    .sr-lv-warn  { color: #fbbf24; }
    .sr-lv-info  { color: #2dd4a7; }
    .sr-lv-debug { color: #8b949e; }
    .sr-lv-trace { color: #94a3b8; }
    [data-theme='light'] .sr-lv-fatal { color: #b3123c; }
    [data-theme='light'] .sr-lv-error { color: #cf222e; }
    [data-theme='light'] .sr-lv-warn  { color: #9a6700; }
    [data-theme='light'] .sr-lv-info  { color: #0f8a4c; }
    [data-theme='light'] .sr-lv-debug { color: #57606a; }
    [data-theme='light'] .sr-lv-trace { color: #6e7781; }
    .lp-line-highlight { background: var(--bg-active); outline: 1px solid var(--accent); }

    /* ===== 搜索结果文本可选可复制（鼠标拖选任意区域 → Ctrl+C / 右键复制） ===== */
    #sr-body, #sr-body * { user-select: text; -webkit-user-select: text; }
    #sr-body .sr-line { cursor: text; }
    #sr-body .sr-line *::selection, #sr-body::selection { background: var(--accent-soft, #45547a); }
    .lp-sr-ctxmenu {
      position: fixed; z-index: 1600; min-width: 132px; padding: 4px 0;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px;
      box-shadow: var(--shadow); font-size: 13px;
    }
    .lp-sr-ctxmenu .ctx-item { padding: 5px 16px; cursor: default; color: var(--text); }
    .lp-sr-ctxmenu .ctx-item:hover { background: var(--bg-hover); }
    .lp-sr-ctxmenu .ctx-item[disabled] { color: var(--text-dim); opacity: 0.5; }
  `
  document.head.appendChild(style)

  /* ==================== 搜索结果面板（挂载到 #panels） ==================== */

  const panelsEl = document.getElementById('panels')
  const srHost = document.createElement('div')
  srHost.id = 'panel-searchresults'
  srHost.hidden = true
  panelsEl.appendChild(srHost)
  srHost.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">搜索结果</span>
        <span id="sr-status" style="color:var(--text-dim);font-size:12px;flex:1;margin-left:12px"></span>
        <div class="panel-actions">
          <button class="panel-btn" id="sr-clear" title="清除结果">清除</button>
          <button class="panel-btn panel-close" id="sr-close" title="关闭面板">✕</button>
        </div>
      </div>
      <div class="panel-body" id="sr-body"></div>
    </div>
  `
  const srStatus = srHost.querySelector('#sr-status')
  const srBody = srHost.querySelector('#sr-body')

  /* ==================== 面板高度调节条（上拉/下拉） ==================== */

  const resizer = document.createElement('div')
  resizer.className = 'lp-panels-resizer'
  resizer.title = '拖动调节面板高度（双击复位）'
  panelsEl.parentNode.insertBefore(resizer, panelsEl)

  const DEFAULT_PANEL_H = 240
  let panelH = DEFAULT_PANEL_H

  function applyPanelH(h) {
    panelH = h
    panelsEl.style.height = `${h}px`
    panelsEl.style.maxHeight = `${h}px`
    for (const p of panelsEl.children) p.style.maxHeight = `${h}px`
  }

  function anyPanelVisible() {
    return [...panelsEl.children].some((p) => !p.hidden)
  }
  function syncResizer() {
    resizer.style.display = anyPanelVisible() ? '' : 'none'
  }
  new MutationObserver(syncResizer).observe(panelsEl, {
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
    childList: true
  })
  syncResizer()

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    resizer.setPointerCapture(e.pointerId)
    resizer.classList.add('dragging')
    const startY = e.clientY
    const startH = panelsEl.offsetHeight || DEFAULT_PANEL_H
    const maxH = Math.max(160, window.innerHeight - 160)
    const move = (ev) => {
      applyPanelH(Math.min(maxH, Math.max(80, startH + (startY - ev.clientY))))
    }
    const up = () => {
      resizer.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
  resizer.addEventListener('dblclick', () => applyPanelH(DEFAULT_PANEL_H))

  /* ==================== 查找状态 ==================== */

  // F3/Shift+F3 在对话框关闭后仍可用的"上次查找"状态
  const state = {
    what: '',
    opts: { caseSensitive: false, wholeWord: false, wrap: true, regex: false, direction: 'down' }
  }
  const history = [] // 会话内查找历史（datalist）
  let activeItem = null // 搜索结果面板当前项

  function editor() {
    return ctx.tabs?.editor
  }

  /* ==================== 对话框 DOM ==================== */

  const dlg = document.createElement('div')
  dlg.className = 'lp-finddlg'
  dlg.hidden = true
  dlg.dataset.tab = 'find'
  dlg.innerHTML = `
    <div class="lp-fd-drag" id="lp-fd-drag">
      <span class="lp-fd-drag-title" id="lp-fd-title">查找</span>
      <button class="panel-btn panel-close" id="lp-fd-x" title="关闭 (Esc)">✕</button>
    </div>
    <div class="lp-fd-tabs">
      <button class="lp-ftab active" data-tab="find">查找</button>
      <button class="lp-ftab" data-tab="replace">替换</button>
      <button class="lp-ftab" data-tab="infiles">在文件中查找</button>
    </div>
    <div class="lp-fd-main">
    <div class="lp-fd-form">
      <div class="lp-row">
        <label for="lp-what">查找内容</label>
        <input type="text" id="lp-what" list="lp-what-history" placeholder="输入查找内容" />
        <datalist id="lp-what-history"></datalist>
      </div>
      <div class="lp-row rp-only">
        <label for="lp-with">替换为</label>
        <input type="text" id="lp-with" placeholder="替换文本（正则支持 \\1 或 $1 分组）" />
      </div>
      <div class="lp-row if-only">
        <label for="lp-dir">目录</label>
        <input type="text" id="lp-dir" list="lp-dir-history" style="flex:1" placeholder="选择或输入搜索目录" />
        <datalist id="lp-dir-history"></datalist>
        <button class="panel-btn" id="lp-browse">浏览...</button>
      </div>
      <div class="lp-row if-only">
        <label for="lp-glob">文件类型</label>
        <input type="text" id="lp-glob" style="flex:1" value="*" title="通配符，分号分隔多模式；* 为所有文件" />
      </div>
      <div class="lp-opts">
        <label class="checkbox if-only"><input type="checkbox" id="lp-recursive" checked />包含子目录</label>
        <label class="checkbox"><input type="checkbox" id="lp-case" />区分大小写</label>
        <label class="checkbox"><input type="checkbox" id="lp-word" />全字匹配</label>
        <label class="checkbox if-hide"><input type="checkbox" id="lp-wrap" checked />循环查找</label>
        <label class="checkbox"><input type="checkbox" id="lp-regex" />正则表达式</label>
        <span class="dir if-hide">
          方向
          <label class="checkbox"><input type="radio" name="lp-dir" value="down" checked />向下</label>
          <label class="checkbox"><input type="radio" name="lp-dir" value="up" />向上</label>
        </span>
      </div>
    </div>
    <div class="lp-fd-btns">
      <button class="btn btn-primary fd-only" id="lp-btn-next" title="Enter">查找下一个</button>
      <button class="btn fd-only" id="lp-btn-count">计数</button>
      <button class="btn fd-only" id="lp-btn-all" title="结果将显示在底部「搜索结果」面板">在当前文档中全部查找</button>
      <button class="btn fd-only" id="lp-btn-allopen" title="结果将显示在底部「搜索结果」面板">在所有打开文档中全部查找</button>
      <button class="btn if-only btn-primary" id="lp-btn-ifall" title="在指定目录中搜索所有文件">全部查找</button>
      <button class="btn rp-only" id="lp-btn-rep">替换</button>
      <button class="btn rp-only" id="lp-btn-repall">全部替换</button>
    </div>
    </div>
    <div class="lp-fd-status" id="lp-fd-status"></div>
  `
  document.getElementById('overlay-layer').appendChild(dlg)

  const $ = (sel) => dlg.querySelector(sel)
  const whatInput = $('#lp-what')
  const withInput = $('#lp-with')
  const dirInput = $('#lp-dir')
  const globInput = $('#lp-glob')
  const recursiveChk = $('#lp-recursive')
  const caseChk = $('#lp-case')
  const wordChk = $('#lp-word')
  const wrapChk = $('#lp-wrap')
  const regexChk = $('#lp-regex')
  const statusEl = $('#lp-fd-status')
  const historyList = $('#lp-what-history')
  const dirHistoryList = $('#lp-dir-history')

  function setStatus(msg, isErr) {
    statusEl.textContent = msg
    statusEl.classList.toggle('err', !!isErr)
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /* ==================== 对话框：开合/标签/拖动 ==================== */

  let dlgPos = null // 记忆位置（会话内）

  function placeDialog() {
    // 默认位置：水平 + 垂直均居中（dlg.offsetHeight 依赖当前 tab 的可见表单高度）
    if (!dlgPos) dlgPos = { left: (window.innerWidth - 660) / 2, top: (window.innerHeight - dlg.offsetHeight) / 2 }
    dlgPos.left = Math.min(Math.max(0, dlgPos.left), Math.max(0, window.innerWidth - 120))
    dlgPos.top = Math.min(Math.max(0, dlgPos.top), Math.max(0, window.innerHeight - dlg.offsetHeight - 40))
    dlg.style.left = `${dlgPos.left}px`
    dlg.style.top = `${dlgPos.top}px`
  }

  function setTab(t) {
    dlg.dataset.tab = t
    $('#lp-fd-title').textContent = t === 'replace' ? '替换' : t === 'infiles' ? '在文件中查找' : '查找'
    dlg.querySelectorAll('.lp-ftab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t))
  }

  function openDialog(tab = 'find') {
    dlg.hidden = false
    setTab(tab)
    placeDialog()
    // 预填：编辑器有单行选中则填入（同 Notepad++），否则保留上次内容
    const ed = editor()
    const sel = ed?.getSelection()
    if (ed && sel && !sel.isEmpty()) {
      const text = ed.getModel()?.getValueInRange(sel) ?? ''
      if (text && !text.includes('\n')) whatInput.value = text
    }
    // 关闭 Monaco 内置查找部件，避免双部件并存
    ed?.getAction('editor.action.closeFindWidget')?.run()
    ;(tab === 'infiles' && !dirInput.value ? dirInput : whatInput).focus()
    whatInput.select()
  }

  function closeDialog() {
    dlg.hidden = true
  }

  // 标题栏拖动（pointer 事件，含视口夹取）
  $('#lp-fd-drag').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return
    const rect = dlg.getBoundingClientRect()
    const dx = e.clientX - rect.left
    const dy = e.clientY - rect.top
    const move = (ev) => {
      dlgPos = {
        left: Math.min(Math.max(0, ev.clientX - dx), Math.max(0, window.innerWidth - 120)),
        top: Math.min(Math.max(0, ev.clientY - dy), Math.max(0, window.innerHeight - 60))
      }
      dlg.style.left = `${dlgPos.left}px`
      dlg.style.top = `${dlgPos.top}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  dlg.querySelectorAll('.lp-ftab').forEach((b) =>
    b.addEventListener('click', () => {
      setTab(b.dataset.tab)
      ;(b.dataset.tab === 'infiles' ? dirInput : whatInput).focus()
      whatInput.select()
    })
  )

  $('#lp-fd-x').addEventListener('click', closeDialog)
  // 关闭仅保留右上角 ✕（及 Esc），不再提供"关闭"按钮

  // 正则模式禁用全字匹配（同 Notepad++：二者互斥）
  regexChk.addEventListener('change', () => {
    wordChk.disabled = regexChk.checked
    if (regexChk.checked) wordChk.checked = false
  })

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeDialog()
    }
  })

  /* ==================== 查找引擎 ==================== */

  // Monaco 全字匹配约定使用的词分隔符（与编辑器 find 部件一致）
  const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?'

  function readOpts() {
    return {
      caseSensitive: caseChk.checked,
      wholeWord: wordChk.checked,
      wrap: wrapChk.checked,
      regex: regexChk.checked,
      direction: dlg.querySelector('input[name=lp-dir]:checked')?.value === 'up' ? 'up' : 'down'
    }
  }

  function validate(what, opts) {
    if (!what) return '请输入查找内容'
    if (opts.regex) {
      try {
        new RegExp(what)
      } catch (err) {
        return `无效的正则表达式：${err.message}`
      }
    }
    return null
  }

  /** 全量匹配（model.findMatches：全字/大小写/正则一次到位） */
  function matchesOf(model, what, opts, limit = 100000) {
    return model.findMatches(
      what,
      false,
      opts.regex,
      opts.caseSensitive,
      opts.wholeWord ? WORD_SEPARATORS : null,
      opts.regex, // captureMatches：正则替换需要分组
      limit
    )
  }

  /** 状态提交 + 历史记录（F3 在对话框关闭后仍复用） */
  function commitState(what, opts) {
    state.what = what
    state.opts = { ...opts }
    const i = history.indexOf(what)
    if (i >= 0) history.splice(i, 1)
    history.unshift(what)
    if (history.length > 12) history.length = 12
    historyList.innerHTML = history.map((h) => `<option value="${escapeHtml(h)}"></option>`).join('')
  }

  /** 从光标导航到上/下一个匹配（跳过光标所在匹配，循环由 wrap 决定） */
  function navigate(what, opts, dir) {
    const ed = editor()
    const model = ed?.getModel()
    if (!ed || !model) return setStatus('无打开的文档', true)
    const matches = matchesOf(model, what, opts)
    if (!matches.length) return setStatus(`找不到 "${what}"`, true)
    const sel = ed.getSelection()
    let idx = -1
    if (dir === 'down') {
      const pos = sel ? sel.getStartPosition() : { lineNumber: 1, column: 1 }
      idx = matches.findIndex(
        (m) =>
          m.range.startLineNumber > pos.lineNumber ||
          (m.range.startLineNumber === pos.lineNumber && m.range.startColumn > pos.column)
      )
      if (idx === -1) {
        if (!opts.wrap) return setStatus('已到文档末尾')
        idx = 0
      }
    } else {
      const pos = sel ? sel.getEndPosition() : { lineNumber: 1, column: 1 }
      for (let i = matches.length - 1; i >= 0; i--) {
        const r = matches[i].range
        if (r.endLineNumber < pos.lineNumber || (r.endLineNumber === pos.lineNumber && r.endColumn < pos.column)) {
          idx = i
          break
        }
      }
      if (idx === -1) {
        if (!opts.wrap) return setStatus('已到文档开头')
        idx = matches.length - 1
      }
    }
    const r = matches[idx].range
    const range = new monaco.Range(r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn)
    ed.setSelection(range)
    ed.revealRangeInCenterIfOutsideViewport(range)
    setStatus(`第 ${idx + 1} / ${matches.length} 处`)
  }

  /* ==================== 对话框动作（查找/替换） ==================== */

  function readAndValidate() {
    const what = whatInput.value
    const opts = readOpts()
    const err = validate(what, opts)
    if (err) {
      setStatus(err, true)
      whatInput.focus()
      return null
    }
    commitState(what, opts)
    setStatus('')
    return { what, opts }
  }

  function findNext() {
    const p = readAndValidate()
    if (!p) return
    navigate(p.what, p.opts, p.opts.direction)
  }

  function countMatches() {
    const p = readAndValidate()
    if (!p) return
    const model = editor()?.getModel()
    if (!model) return setStatus('无打开的文档', true)
    const n = matchesOf(model, p.what, p.opts).length
    setStatus(n ? `共找到 ${n} 处匹配` : `找不到 "${p.what}"`, !n)
  }

  /** 正则替换分组引用：\1 → $1（Monaco 约定）再展开为捕获文本 */
  function expandReplacement(tpl, groups) {
    const normalized = tpl.replace(/\\(\d)/g, '$$$1')
    if (!groups) return normalized
    return normalized.replace(/\$(\d+)/g, (_, n) => groups[+n] ?? '')
  }

  function replaceOne() {
    const ed = editor()
    const model = ed?.getModel()
    if (!ed || !model) return setStatus('无打开的文档', true)
    const p = readAndValidate()
    if (!p) return
    const tpl = withInput.value
    // 当前选中恰为一个匹配 → 先替换（光标置于替换文本之后），随后跳到下一个
    const sel = ed.getSelection()
    if (sel && !sel.isEmpty()) {
      const hit = matchesOf(model, p.what, p.opts).find(
        (m) =>
          m.range.startLineNumber === sel.startLineNumber && m.range.startColumn === sel.startColumn &&
          m.range.endLineNumber === sel.endLineNumber && m.range.endColumn === sel.endColumn
      )
      if (hit) {
        const text = expandReplacement(tpl, p.opts.regex ? hit.matches : null)
        const endCol = sel.startColumn + text.length
        ed.executeEdits(
          'lp-replace-one',
          [{ range: sel, text, forceMoveMarkers: false }],
          [new monaco.Selection(sel.startLineNumber, endCol, sel.startLineNumber, endCol)]
        )
      }
    }
    navigate(p.what, p.opts, 'down')
  }

  function replaceAll() {
    const ed = editor()
    const model = ed?.getModel()
    if (!ed || !model) return setStatus('无打开的文档', true)
    const p = readAndValidate()
    if (!p) return
    const matches = matchesOf(model, p.what, p.opts)
    if (!matches.length) return setStatus(`找不到 "${p.what}"`, true)
    const tpl = withInput.value
    const edits = matches.map((m) => ({
      range: m.range,
      text: expandReplacement(tpl, p.opts.regex ? m.matches : null),
      forceMoveMarkers: false
    }))
    // 一次事务提交：单步撤销；匹配互不重叠，前置范围按序应用
    ed.executeEdits('lp-replace-all', edits)
    setStatus(`已替换 ${matches.length} 处`)
  }

  /* ==================== 文件夹搜索（在文件中查找） ==================== */

  let searching = false

  // 搜索进度 → 对话框状态栏
  window.api.on('search-progress', ({ scanned, matches, current }) => {
    if (searching) setStatus(`已扫描 ${scanned} 个文件，匹配 ${matches} 条 — ${current}`)
  })

  async function findAllInFiles() {
    if (searching) return
    const what = whatInput.value
    const opts = readOpts()
    const err = validate(what, opts)
    if (err) {
      setStatus(err, true)
      whatInput.focus()
      return
    }
    const dir = dirInput.value.trim()
    if (!dir) {
      setStatus('请指定搜索目录', true)
      dirInput.focus()
      return
    }
    commitState(what, opts)

    searching = true
    setStatus('准备扫描...')
    let res
    try {
      res = await window.api.searchInFiles({
        dir,
        glob: globInput.value.trim() || '*',
        pattern: what,
        caseSensitive: opts.caseSensitive,
        wholeWord: opts.wholeWord,
        regex: opts.regex,
        recursive: recursiveChk.checked
      })
    } catch (e) {
      searching = false
      setStatus(`查找失败：${e.message || e}`, true)
      return
    }
    searching = false

    // 按文件分组（保序）
    const groups = []
    const byPath = new Map()
    for (const r of res.results) {
      let g = byPath.get(r.path)
      if (!g) {
        g = { kind: 'file', title: r.path, path: r.path, hits: [] }
        byPath.set(r.path, g)
        groups.push(g)
      }
      g.hits.push({ line: r.line, text: r.text })
    }
    renderGroups(what, opts, groups, res.totalFiles, res.truncated)
    setStatus(`共扫描 ${res.totalFiles} 个文件，匹配 ${res.results.length} 条`)
    loadDirHistory()
  }

  /* ==================== 历史（目录/模式） ==================== */

  async function loadDirHistory() {
    try {
      const hist = await window.api.getSearchHistory()
      dirHistoryList.innerHTML = (hist.dirs || [])
        .map((d) => `<option value="${escapeHtml(d)}"></option>`)
        .join('')
      if (!dirInput.value && hist.dirs && hist.dirs[0]) dirInput.value = hist.dirs[0]
    } catch {
      /* 历史不可用时忽略 */
    }
  }
  loadDirHistory()

  // 查找内容历史种子：主进程持久化的搜索模式
  window.api
    .getSearchHistory()
    .then((h) => {
      for (const p of (h.patterns || []).slice(0, 8)) if (p && !history.includes(p)) history.push(p)
      historyList.innerHTML = history.map((x) => `<option value="${escapeHtml(x)}"></option>`).join('')
    })
    .catch(() => {})

  $('#lp-browse').addEventListener('click', async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) dirInput.value = dir
  })

  /* ==================== 搜索结果面板渲染与跳转 ==================== */

  let flashDecor = null
  let flashTimer = null

  function flashLine(ed, line) {
    flashDecor?.clear()
    flashDecor = ed.createDecorationsCollection([
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'lp-line-highlight' } }
    ])
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => flashDecor?.clear(), 2000)
  }

  /** 跳转（已打开标签）：激活 → 选中匹配片段（整行高亮 2 秒） */
  function locateTab(tab, range) {
    if (ctx.tabs.getActive()?.id !== tab.id) ctx.tabs.activate(tab.id)
    const ed = ctx.tabs.editor
    if (ed.getModel() !== tab.model) ed.setModel(tab.model)
    const r = new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)
    ed.revealRangeInCenterIfOutsideViewport(r)
    ed.setSelection(r)
    ed.focus()
    flashLine(ed, r.startLineNumber)
  }

  /** 跳转（磁盘文件）：打开到新标签 → 定位行 → 选中匹配片段 */
  async function locatePath(path, line, range) {
    const tab = await ctx.tabs.openFile(path)
    if (!tab) return
    const ed = ctx.tabs.editor
    if (ed.getModel() !== tab.model) ed.setModel(tab.model)
    const ln = Math.min(line, tab.model.getLineCount())
    const startCol = range ? Math.min(range.startColumn, tab.model.getLineMaxColumn(ln)) : 1
    const endCol = range
      ? Math.min(range.endColumn, tab.model.getLineMaxColumn(ln))
      : tab.model.getLineMaxColumn(ln)
    const r = new monaco.Range(ln, startCol, ln, endCol)
    ed.revealLineInCenter(ln)
    ed.setSelection(r)
    ed.focus()
    flashLine(ed, ln)
  }

  function setActiveItem(el) {
    activeItem?.classList.remove('active')
    activeItem = el
    el?.classList.add('active')
    el?.scrollIntoView({ block: 'nearest' })
  }

  /* 级别词着色（escape 后的 HTML 片段） */
  const LV = /\b(FATAL|ERROR|WARNING|WARN|INFO|DEBUG|TRACE)\b/g
  const LV_CLASS = {
    FATAL: 'sr-lv-fatal', ERROR: 'sr-lv-error', WARNING: 'sr-lv-warn', WARN: 'sr-lv-warn',
    INFO: 'sr-lv-info', DEBUG: 'sr-lv-debug', TRACE: 'sr-lv-trace'
  }
  function colorizeLevels(escaped) {
    return escaped.replace(LV, (m) => `<span class="${LV_CLASS[m]}">${m}</span>`)
  }

  /** 行文本按命中列范围分段：<mark> 标记 + 级别着色（ranges: [{startColumn,endColumn}] 1-based） */
  function lineMarkedHtml(text, ranges) {
    let html = ''
    let last = 1
    for (const r of ranges) {
      html += colorizeLevels(escapeHtml(text.slice(last - 1, r.startColumn - 1)))
      html += '<mark>' + escapeHtml(text.slice(r.startColumn - 1, r.endColumn - 1)) + '</mark>'
      last = r.endColumn
    }
    html += colorizeLevels(escapeHtml(text.slice(last - 1)))
    return html
  }

  /** 纯文本（主进程返回）重匹配出所有命中范围（1-based 列） */
  function matchRangesInText(text, what, opts) {
    const ranges = []
    try {
      const escaped = what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(
        opts.regex ? what : opts.wholeWord ? `\\b${escaped}\\b` : escaped,
        opts.caseSensitive ? 'g' : 'gi'
      )
      let m
      while ((m = re.exec(text)) && ranges.length < 50) {
        if (m[0].length === 0) { re.lastIndex++; continue }
        ranges.push({ startColumn: m.index + 1, endColumn: m.index + 1 + m[0].length })
      }
    } catch {
      /* 无效正则等：退化为无高亮 */
    }
    return ranges
  }

  function optsSuffix(opts) {
    const parts = []
    if (opts.caseSensitive) parts.push('区分大小写')
    if (opts.wholeWord) parts.push('全字匹配')
    if (opts.regex) parts.push('正则')
    return parts.length ? `（${parts.join(' · ')}）` : ''
  }

  /**
   * 统一渲染搜索结果面板。
   * groups: [{ kind:'tab'|'file', title, tab?, path?, hits:[{line, ranges?, text?}] }]
   * kind tab：行内容取 tab.model，mark 按列；kind file：行内容取 hit.text，重匹配 mark。
   */
  function renderGroups(what, opts, groups, scannedInfo, truncated) {
    const total = groups.reduce((s, g) => s + g.hits.length, 0)
    srStatus.textContent =
      `查找 "${what}"${optsSuffix(opts)} — 共 ${total} 处命中` +
      (typeof scannedInfo === 'number' ? `（${scannedInfo} 个文件）` : '') +
      (truncated ? '（结果过多已截断）' : '')
    srBody.innerHTML = ''
    ctx.panels.show('searchresults')

    if (!total) {
      srBody.innerHTML = '<div style="padding:8px 10px;color:var(--text-dim)">无匹配结果</div>'
      return
    }

    const termEl = document.createElement('div')
    termEl.className = 'sr-file sr-term'
    termEl.innerHTML = `<span>查找 "${escapeHtml(what)}"</span><span class="sr-count">${total} 处</span>`
    srBody.appendChild(termEl)

    const MAX_RENDER = 2000
    let rendered = 0
    let overflow = false
    let first = null
    for (const g of groups) {
      const f = document.createElement('div')
      f.className = 'sr-file'
      f.innerHTML =
        (g.kind === 'file'
          ? `<span class="sr-path">${escapeHtml(g.title)}</span>`
          : `<span>${escapeHtml(g.title)}</span>`) +
        `<span class="sr-count">${g.hits.length} 处</span>`
      srBody.appendChild(f)

      // 按行聚合（同行多次命中合并为一条）
      const byLine = new Map()
      for (const h of g.hits) {
        if (!byLine.has(h.line)) byLine.set(h.line, [])
        byLine.get(h.line).push(h)
      }
      for (const [ln, hits] of byLine) {
        if (rendered >= MAX_RENDER) {
          overflow = true
          break
        }
        const lineText = g.kind === 'tab' ? g.tab.model.getLineContent(ln) : hits[0].text
        const ranges =
          g.kind === 'tab' ? hits.map((h) => h.range) : matchRangesInText(hits[0].text, what, opts)
        const lineEl = document.createElement('div')
        lineEl.className = 'fi-line mono sr-line'
        lineEl.innerHTML =
          `<span class="fi-lineno">${ln}</span>` +
          `<span class="fi-text">${lineMarkedHtml(lineText, ranges)}</span>`
        lineEl.title = '点击跳转到匹配位置（拖选文本可复制）'
        const r0 = ranges[0]
        lineEl.addEventListener('click', () => {
          // 拖选了文本 → 本次是复制操作，不跳转
          if (String(window.getSelection() ?? '')) return
          if (g.kind === 'tab') locateTab(g.tab, r0)
          else locatePath(g.path, ln, r0)
          setActiveItem(lineEl)
        })
        srBody.appendChild(lineEl)
        rendered++
        if (!first && r0) first = { lineEl, run: () => (g.kind === 'tab' ? locateTab(g.tab, r0) : locatePath(g.path, ln, r0)) }
      }
      if (overflow) break
    }
    if (overflow) {
      const note = document.createElement('div')
      note.style.cssText = 'padding:6px 10px;color:var(--text-dim);font-size:12px'
      note.textContent = `结果过多，仅显示前 ${MAX_RENDER} 行`
      srBody.appendChild(note)
    }
    // 首条命中自动跳转（同 Notepad++ 全部查找行为）
    if (first) {
      setActiveItem(first.lineEl)
      first.run()
    }
  }

  function findAllCurrent() {
    const ed = editor()
    const tab = ctx.tabs.getActive()
    if (!ed || !tab) return setStatus('无打开的文档', true)
    const p = readAndValidate()
    if (!p) return
    const matches = matchesOf(tab.model, p.what, p.opts, 10000)
    renderGroups(p.what, p.opts, [{ kind: 'tab', title: tab.name, tab, hits: matches.map((m) => ({ line: m.range.startLineNumber, range: m.range })) }])
  }

  function findAllOpened() {
    const tabs = ctx.tabs.getAll()
    if (!tabs.length) return setStatus('无打开的文档', true)
    const p = readAndValidate()
    if (!p) return
    const groups = []
    for (const t of tabs) {
      const matches = matchesOf(t.model, p.what, p.opts, 10000)
      if (matches.length) {
        groups.push({ kind: 'tab', title: t.name, tab: t, hits: matches.map((m) => ({ line: m.range.startLineNumber, range: m.range })) })
      }
    }
    renderGroups(p.what, p.opts, groups)
  }

  /* ==================== 面板事件 ==================== */

  srHost.querySelector('#sr-close').addEventListener('click', () => ctx.panels.hide('searchresults'))
  srHost.querySelector('#sr-clear').addEventListener('click', () => {
    srBody.innerHTML = ''
    srStatus.textContent = ''
    activeItem = null
  })

  /* ===== 右键菜单：复制选区 / 全部复制（搜索结果区域鼠标任意选区） ===== */

  let ctxMenu = null

  function closeCtxMenu() {
    ctxMenu?.remove()
    ctxMenu = null
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text))
    } else {
      fallbackCopyText(text)
    }
  }
  function fallbackCopyText(text) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }

  srBody.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    closeCtxMenu()
    const hasSel = !!String(window.getSelection() ?? '')
    ctxMenu = document.createElement('div')
    ctxMenu.className = 'lp-sr-ctxmenu'
    ctxMenu.innerHTML = `
      <div class="ctx-item" data-act="copy" ${hasSel ? '' : 'disabled'}>复制选中内容</div>
      <div class="ctx-item" data-act="copyall">复制全部结果</div>
      <div class="ctx-item" data-act="selectall">全选</div>
    `
    ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 150)}px`
    ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 110)}px`
    document.getElementById('overlay-layer').appendChild(ctxMenu)
    ctxMenu.addEventListener('click', (ev) => {
      const act = ev.target.dataset?.act
      if (act === 'copy' && hasSel) copyToClipboard(String(window.getSelection()))
      else if (act === 'copyall') copyToClipboard(srBody.innerText)
      else if (act === 'selectall') {
        const range = document.createRange()
        range.selectNodeContents(srBody)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
      }
      closeCtxMenu()
    })
  })

  window.addEventListener('pointerdown', (e) => {
    if (ctxMenu && !ctxMenu.contains(e.target)) closeCtxMenu()
  })

  /* ==================== 对话框事件 ==================== */

  $('#lp-btn-next').addEventListener('click', findNext)
  $('#lp-btn-count').addEventListener('click', countMatches)
  $('#lp-btn-all').addEventListener('click', findAllCurrent)
  $('#lp-btn-allopen').addEventListener('click', findAllOpened)
  $('#lp-btn-ifall').addEventListener('click', findAllInFiles)
  $('#lp-btn-rep').addEventListener('click', replaceOne)
  $('#lp-btn-repall').addEventListener('click', replaceAll)

  const onEnter = (fn) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      fn()
    }
  }
  whatInput.addEventListener('keydown', onEnter(() => (dlg.dataset.tab === 'infiles' ? findAllInFiles() : findNext())))
  withInput.addEventListener('keydown', onEnter(replaceOne))
  dirInput.addEventListener('keydown', onEnter(findAllInFiles))
  globInput.addEventListener('keydown', onEnter(findAllInFiles))
  whatInput.addEventListener('input', () => setStatus(''))

  /* ==================== F3/选中词查找（无对话框时的状态复用） ==================== */

  /** 取选中文本（无选中取光标处单词） */
  function selectionWord() {
    const ed = editor()
    if (!ed) return ''
    const sel = ed.getSelection()
    const model = ed.getModel()
    if (!model) return ''
    if (sel && !sel.isEmpty()) {
      const t = model.getValueInRange(sel)
      return t.includes('\n') ? '' : t
    }
    const pos = ed.getPosition()
    const w = pos ? model.getWordAtPosition(pos) : null
    return w ? model.getValueInRange(w) : ''
  }

  /** F3 / Shift+F3：对话框已填优先，其次上次查找状态，最后选中词/光标单词 */
  function currentPattern() {
    if (!dlg.hidden && whatInput.value) return { what: whatInput.value, opts: readOpts() }
    if (state.what) return { what: state.what, opts: state.opts }
    const word = selectionWord()
    if (word) {
      commitState(word, state.opts)
      return { what: word, opts: state.opts }
    }
    return null
  }

  /* ==================== 命令注册 ==================== */

  commandBus.register('search.find', {
    label: '查找',
    run: () => openDialog('find')
  })

  commandBus.register('search.replace', {
    label: '替换',
    run: () => openDialog('replace')
  })

  commandBus.register('search.next', {
    label: '查找下一个',
    run: () => {
      const p = currentPattern()
      if (!p) return openDialog('find')
      navigate(p.what, p.opts, 'down')
    }
  })

  commandBus.register('search.prev', {
    label: '查找上一个',
    run: () => {
      const p = currentPattern()
      if (!p) return openDialog('find')
      navigate(p.what, p.opts, 'up')
    }
  })

  commandBus.register('search.findSelection', {
    label: '查找选中词',
    run: () => {
      const word = selectionWord()
      if (!word) return openDialog('find')
      commitState(word, state.opts)
      navigate(word, state.opts, 'down')
    }
  })

  // 文件夹搜索：与 Notepad++ 一致 —— Ctrl+Shift+F 打开查找窗口的"在文件中查找"标签；
  // opts.dir 可预填目录（工作区树右键"在此文件夹中查找"传入）
  commandBus.register('search.inFiles', {
    label: '在文件中查找',
    run: (opts) => {
      if (opts && typeof opts.dir === 'string' && opts.dir) dirInput.value = opts.dir
      openDialog('infiles')
    }
  })

  /* ==================== 快捷键 ==================== */

  window.addEventListener(
    'keydown',
    (e) => {
      // 对话框打开时 Esc 关闭（有模态对话框时不抢占，模态自身处理）
      if (e.key === 'Escape' && !dlg.hidden && !document.querySelector('.modal-backdrop')) {
        e.preventDefault()
        closeDialog()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
        if (e.shiftKey) {
          e.preventDefault()
          commandBus.execute('search.inFiles')
        } else {
          e.preventDefault()
          commandBus.execute('search.find')
        }
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        commandBus.execute('search.replace')
      } else if (mod && e.shiftKey && !e.altKey && e.code === 'F3') {
        e.preventDefault()
        commandBus.execute('search.prev')
      } else if (e.key === 'F3' && !mod) {
        e.preventDefault()
        commandBus.execute('search.next')
      } else if (mod && !e.shiftKey && !e.altKey && e.code === 'F3') {
        e.preventDefault()
        commandBus.execute('search.findSelection')
      }
    },
    { capture: true }
  )
}
