/**
 * LogPad 文件夹工作区（Notepad++ "Open Folder as Workspace"）
 *
 * 文件->打开 选中文件夹（或 文件->打开文件夹为工作区）后，在主区左侧显示目录树：
 *  - 目录可展开/折叠（懒加载子项，目录优先 + 名称排序）
 *  - 单击文件在标签页打开；右缘拖动调节宽度（160~480px）
 *  - 头部：文件夹名 / 刷新 / 关闭；视图菜单"文件夹工作区"可显隐
 *
 * 布局：把 #editor-host 与 #panels 包进 #lp-main-col，#main 转为横向 flex
 * （sidebar + 主列），#main 原纵向布局由 #lp-main-col 承接。
 */

import { icon } from '../icons.js'

export function init(ctx) {
  /* ==================== 样式注入（模块自包含） ==================== */

  const style = document.createElement('style')
  style.textContent = `
    /* #main 转横向：侧栏 + 主列（编辑器 + 底部面板） */
    #main { flex-direction: row; }
    #lp-main-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }

    #lp-workspace {
      width: 240px; flex: none; display: flex; flex-direction: column;
      background: var(--bg-panel); border-right: 1px solid var(--border);
      min-height: 0;
    }
    #lp-workspace[hidden] { display: none; }
    .lp-ws-header {
      flex: none; display: flex; align-items: center; gap: 6px;
      height: 30px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--border);
    }
    .lp-ws-title {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; color: var(--text); font-weight: 600; font-size: 12px;
    }
    .lp-ws-tree { flex: 1; min-height: 0; overflow: auto; padding: 4px 0 12px; }
    .lp-ws-empty { padding: 14px 12px; color: var(--text-dim); font-size: 12px; line-height: 1.6; }
    .lp-ws-item {
      display: flex; align-items: center; gap: 5px; height: 24px;
      padding-right: 8px; white-space: nowrap; cursor: default; color: var(--text);
    }
    .lp-ws-item:hover { background: var(--bg-hover); }
    .lp-ws-item.file { color: var(--text-dim); }
    .lp-ws-item.file:hover { color: var(--text); }
    .lp-ws-arrow {
      flex: none; width: 14px; height: 14px; display: inline-flex;
      align-items: center; justify-content: center; color: var(--text-dim); cursor: pointer;
    }
    .lp-ws-arrow svg { transition: transform 100ms ease; }
    .lp-ws-item.collapsed .lp-ws-arrow svg { transform: rotate(0deg); }
    .lp-ws-item.expanded .lp-ws-arrow svg { transform: rotate(90deg); }
    .lp-ws-icon { flex: none; display: inline-flex; color: var(--text-dim); }
    .lp-ws-item.dir > .lp-ws-icon { color: var(--accent); }
    .lp-ws-name { overflow: hidden; text-overflow: ellipsis; }
    .lp-ws-resizer {
      flex: none; width: 5px; cursor: ew-resize; background: transparent;
    }
    .lp-ws-resizer:hover, .lp-ws-resizer.dragging { background: var(--bg-hover); }

    /* 右键菜单（与搜索结果面板右键菜单同风格） */
    .lp-ws-ctxmenu {
      position: fixed; z-index: 1600; min-width: 150px; padding: 4px 0;
      background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px;
      box-shadow: var(--shadow); font-size: 13px;
    }
    .lp-ws-ctxmenu .ctx-item { padding: 5px 16px; cursor: default; color: var(--text); white-space: nowrap; }
    .lp-ws-ctxmenu .ctx-item:hover { background: var(--bg-hover); }

    /* 拖放提示遮罩（拖入文件/文件夹时全屏虚线框） */
    .lp-drop-hint {
      position: fixed; inset: 0; z-index: 1700; display: flex;
      align-items: center; justify-content: center; pointer-events: none;
      background: color-mix(in srgb, var(--bg-base) 55%, transparent);
    }
    .lp-drop-hint[hidden] { display: none; }
    .lp-drop-hint-inner {
      padding: 28px 44px; border: 2px dashed var(--accent); border-radius: 12px;
      background: var(--bg-elevated); color: var(--text); font-size: 15px; font-weight: 600;
      box-shadow: var(--shadow);
    }
  `
  document.head.appendChild(style)

  /* ==================== 布局重构：#main → [sidebar, #lp-main-col] ==================== */

  const main = document.getElementById('main')
  // 整体平移 #main 现有子节点（editor-host / 面板高度调节条 / panels）到主列，保持原顺序
  const mainCol = document.createElement('div')
  mainCol.id = 'lp-main-col'
  while (main.firstChild) mainCol.appendChild(main.firstChild)
  main.appendChild(mainCol)

  const sidebar = document.createElement('div')
  sidebar.id = 'lp-workspace'
  sidebar.hidden = true
  main.insertBefore(sidebar, mainCol)
  sidebar.innerHTML = `
    <div class="lp-ws-header">
      <span class="lp-ws-title" id="lp-ws-title" title=""></span>
      <button class="panel-btn" id="lp-ws-refresh" title="刷新目录树">${icon('refresh', 14)}</button>
      <button class="panel-btn panel-close" id="lp-ws-close" title="关闭工作区">${icon('close', 14)}</button>
    </div>
    <div class="lp-ws-tree" id="lp-ws-tree"></div>
  `
  // 右缘拖宽（160~480）
  const resizer = document.createElement('div')
  resizer.className = 'lp-ws-resizer'
  resizer.title = '拖动调节宽度'
  sidebar.appendChild(resizer)
  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    resizer.setPointerCapture(e.pointerId)
    resizer.classList.add('dragging')
    const startX = e.clientX
    const startW = sidebar.offsetWidth
    const move = (ev) => {
      sidebar.style.width = `${Math.min(480, Math.max(160, startW + ev.clientX - startX))}px`
    }
    const up = () => {
      resizer.classList.remove('dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })

  const titleEl = sidebar.querySelector('#lp-ws-title')
  const treeEl = sidebar.querySelector('#lp-ws-tree')

  /* ==================== 树状态 ==================== */

  let rootDir = null
  const expanded = new Set() // 已展开目录路径集合（刷新时保留）
  const loading = new Set() // 防重复加载

  function fmtSize(n) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  /** 渲染整棵树（展开集合内的目录递归加载；数据量可控，整树重绘足够） */
  async function render() {
    if (!rootDir) return
    titleEl.textContent = rootDir.split(/[\\/]/).filter(Boolean).pop() || rootDir
    titleEl.title = rootDir
    treeEl.innerHTML = ''
    const frag = document.createDocumentFragment()
    await renderLevel(rootDir, 0, frag)
    treeEl.appendChild(frag)
  }

  async function renderLevel(dir, depth, frag) {
    let entries
    try {
      entries = await window.api.listDir(dir)
    } catch {
      entries = []
    }
    for (const ent of entries) {
      // full 由主进程 path.join 生成（跨平台正确），渲染层不自行拼接——
      // 自拼固定 '\\' 在 Linux 会产生 '/home/x\file' 混合分隔符路径导致 stat/readdir 全部失败
      const full = ent.full
      const row = document.createElement('div')
      row.className = `lp-ws-item ${ent.dir ? 'dir' : 'file'}`
      row.style.paddingLeft = `${6 + depth * 14}px`

      if (ent.dir) {
        const isOpen = expanded.has(full)
        row.classList.add(isOpen ? 'expanded' : 'collapsed')
        const arrow = document.createElement('span')
        arrow.className = 'lp-ws-arrow'
        arrow.innerHTML = icon('chevron-right', 12)
        row.appendChild(arrow)
      } else {
        const pad = document.createElement('span')
        pad.style.flex = 'none'
        pad.style.width = '14px'
        row.appendChild(pad)
      }

      const ic = document.createElement('span')
      ic.className = 'lp-ws-icon'
      ic.innerHTML = icon(ent.dir ? 'folder' : 'file', 14)
      row.appendChild(ic)

      const name = document.createElement('span')
      name.className = 'lp-ws-name'
      name.textContent = ent.name
      row.appendChild(name)

      row.title = ent.dir ? full : `${full}${ent.size ? `\n${fmtSize(ent.size)}` : ''}`
      if (ent.dir) {
        row.addEventListener('click', () => {
          if (expanded.has(full)) expanded.delete(full)
          else expanded.add(full)
          render()
        })
      } else {
        row.addEventListener('click', () => ctx.tabs?.openFile(full))
      }
      // 右键：目录/文件均弹出上下文菜单（Notepad++ 工作区右键 Find in Files 一致）
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        showContextMenu(e, full, !!ent.dir)
      })
      frag.appendChild(row)

      if (ent.dir && expanded.has(full)) {
        await renderLevel(full, depth + 1, frag)
      }
    }
  }

  /* ==================== 右键菜单（Notepad++ 工作区目录右键） ==================== */

  let ctxMenu = null

  function closeCtxMenu() {
    ctxMenu?.remove()
    ctxMenu = null
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.cssText = 'position:fixed;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      })
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
  }

  /**
   * 工作区树右键菜单：在此文件夹中查找（Notepad++ Find in Files）/ 复制路径 / 刷新。
   * @param {MouseEvent} e 触发事件（提供坐标）
   * @param {string} full 右键目标完整路径
   * @param {boolean} isDir 是否目录
   */
  function showContextMenu(e, full, isDir) {
    closeCtxMenu()
    ctxMenu = document.createElement('div')
    ctxMenu.className = 'lp-ws-ctxmenu'
    const items = []
    if (isDir) {
      items.push({ act: 'find', label: '在此文件夹中查找...' })
      items.push({ act: 'expand', label: expanded.has(full) ? '折叠文件夹' : '展开文件夹' })
    } else {
      items.push({ act: 'open', label: '打开文件' })
      items.push({ act: 'findparent', label: '在所在文件夹中查找...' })
    }
    items.push({ act: 'copypath', label: '复制路径' })
    if (isDir) items.push({ act: 'refresh', label: '刷新' })
    ctxMenu.innerHTML = items.map((it) => `<div class="ctx-item" data-act="${it.act}">${it.label}</div>`).join('')
    ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 170)}px`
    ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 40 - items.length * 26)}px`
    document.getElementById('overlay-layer').appendChild(ctxMenu)

    ctxMenu.addEventListener('click', (ev) => {
      const act = ev.target.dataset?.act
      closeCtxMenu()
      if (act === 'find') {
        // 打开查找窗口"在文件中查找"标签并预填该目录（同 Notepad++）
        commandBus.execute('search.inFiles', { dir: full })
      } else if (act === 'findparent') {
        const parent = full.replace(/[\\/][^\\/]+$/, '')
        if (parent) commandBus.execute('search.inFiles', { dir: parent })
      } else if (act === 'expand') {
        if (expanded.has(full)) expanded.delete(full)
        else expanded.add(full)
        render()
      } else if (act === 'open') {
        ctx.tabs?.openFile(full)
      } else if (act === 'copypath') {
        copyToClipboard(full)
      } else if (act === 'refresh') {
        render()
      }
    })
  }

  window.addEventListener('pointerdown', (e) => {
    if (ctxMenu && !ctxMenu.contains(e.target)) closeCtxMenu()
  })

  // 树空白处右键：等同根目录菜单（在此文件夹中查找 / 复制路径 / 刷新）
  treeEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.lp-ws-item')) return // 行自身已处理
    e.preventDefault()
    if (rootDir) showContextMenu(e, rootDir, true)
  })

  /* ==================== 拖放：文件→标签页打开 / 文件夹→设为工作区 ==================== */

  const dropHint = document.createElement('div')
  dropHint.className = 'lp-drop-hint'
  dropHint.hidden = true
  dropHint.innerHTML = '<div class="lp-drop-hint-inner">松开以打开 — 文件在标签页打开，文件夹设为工作区</div>'
  document.body.appendChild(dropHint)

  let dragDepth = 0
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragDepth++
    dropHint.hidden = false
  })
  document.addEventListener('dragover', (e) => {
    // 阻止默认：否则 Electron 会把文件路径当页面导航（主进程 will-navigate 已兜底拦截）
    e.preventDefault()
  })
  document.addEventListener('dragleave', () => {
    if (dragDepth > 0 && --dragDepth === 0) dropHint.hidden = true
  })

  document.addEventListener('drop', async (e) => {
    e.preventDefault()
    dragDepth = 0
    dropHint.hidden = true
    const files = Array.from(e.dataTransfer?.files ?? [])
    for (const f of files) {
      let path = ''
      try {
        path = window.api.getPathForFile(f)
      } catch {
        continue // 非本地文件对象（如网页内元素）
      }
      if (!path) continue
      if (await window.api.isDirectory(path)) await open(path)
      else await ctx.tabs?.openFile(path)
    }
  })

  /* ==================== 对外接口（ctx.workspace） ==================== */

  const { commandBus } = ctx

  async function open(dir) {
    if (!dir) return
    // 保留原生路径（Windows 'D:\x' / Linux '/home/x'）——
    // 此前的 replace(/\//g,'\\') 会把 Linux 绝对路径毁成 '\home\x'，readdir 失败导致树空白
    rootDir = dir
    sidebar.hidden = false
    treeEl.innerHTML = '<div class="lp-ws-empty">正在读取目录...</div>'
    expanded.clear()
    loading.clear()
    await render()
    commandBus.setChecked('workspace.toggle', true)
  }

  function close() {
    sidebar.hidden = true
    commandBus.setChecked('workspace.toggle', false)
  }

  function toggle() {
    if (sidebar.hidden) {
      if (rootDir) {
        sidebar.hidden = false
        commandBus.setChecked('workspace.toggle', true)
      } else {
        commandBus.execute('file.openFolder')
      }
    } else {
      close()
    }
  }

  ctx.workspace = {
    open,
    close,
    toggle,
    isVisible: () => !sidebar.hidden
  }

  /* ==================== 命令与事件 ==================== */

  commandBus.register('file.openFolder', {
    label: '打开文件夹为工作区...',
    run: async () => {
      const dir = await window.api.openDirectoryDialog()
      if (dir) await open(dir)
    }
  })

  commandBus.register('workspace.toggle', {
    label: '文件夹工作区',
    run: toggle
  })

  sidebar.querySelector('#lp-ws-refresh').addEventListener('click', () => {
    if (rootDir) render() // expanded 集合保留，刷新后恢复展开状态
  })
  sidebar.querySelector('#lp-ws-close').addEventListener('click', close)

  // 冒烟/自动化入口：document 派发 logpad-smoke-workspace 事件携带目录路径
  document.addEventListener('logpad-smoke-workspace', (e) => {
    if (e.detail && e.detail.dir) open(e.detail.dir)
  })
}
