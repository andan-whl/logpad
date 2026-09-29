import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { statSync } from 'fs'
import { fileURLToPath } from 'url'
import { registerIpc } from './ipc'

// 开发/冒烟模式：userData 重定向到项目内 .userdata，
// 避免污染系统 AppData 目录，同时便于受限环境下运行（打包版仍用系统 userData）
if (!app.isPackaged) {
  app.setPath('userData', join(app.getAppPath(), '.userdata'))
}

// 主窗口与 IPC 注册中心引用（供退出清理使用）
let mainWin = null
let ipcApi = null

/**
 * 从命令行参数提取待打开的文件路径（"打开方式"/文件关联场景）：
 *  - 跳过可执行文件自身（argv[0]）与 Chromium 开关（-xxx / --xxx）
 *  - 支持 file:// URI（Linux .desktop 的 %U 传参形式）与普通绝对路径
 *  - 仅保留真实存在的文件（目录交给拖放/打开文件夹入口）
 */
function extractFileArgs(argv) {
  const files = []
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (!a || a.startsWith('-')) continue
    let p = a
    if (p.startsWith('file://')) {
      try {
        p = fileURLToPath(p)
      } catch {
        continue
      }
    }
    try {
      if (statSync(p).isFile()) files.push(p)
    } catch {
      /* 不存在的参数忽略 */
    }
  }
  return files
}

// 待打开文件队列：冷启动时渲染层尚未就绪，待 did-finish-load 后再推送
let pendingOpenFiles = []
function deliverPendingFiles(win) {
  if (!pendingOpenFiles.length || !win || win.isDestroyed()) return
  win.webContents.send('open-file-request', pendingOpenFiles)
  pendingOpenFiles = []
}

// 单实例锁：重复启动时聚焦已有窗口并转交新传入的文件
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      const files = extractFileArgs(argv)
      if (files.length) win.webContents.send('open-file-request', files)
    }
  })

  app.whenReady().then(() => {
    // 注册主进程 IPC（文件读写/监视/搜索/持久化），在创建窗口前完成以保证 api 就绪
    ipcApi = registerIpc(() => mainWin)
    // "打开方式"传入的文件：等渲染层加载完成后推送（tabs.js 订阅 open-file-request）
    pendingOpenFiles = extractFileArgs(process.argv)
    mainWin = createWindow()
    mainWin.webContents.once('did-finish-load', () => deliverPendingFiles(mainWin))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  // Windows/Linux 关闭所有窗口即退出应用（macOS 约定保留在 Dock）
  if (process.platform !== 'darwin') app.quit()
})

// 退出前关闭全部文件监视并确保 settings.json 落盘（阻断默认退出，清理完成后强制退出）
app.on('will-quit', (event) => {
  if (!ipcApi) return
  event.preventDefault()
  const api = ipcApi
  ipcApi = null
  api.cleanup().catch(() => {}).finally(() => app.exit(0))
})

function createWindow() {
  // 移除 Electron 默认原生菜单栏（File/Edit/View/Window/Help）：
  // 菜单功能已由页面内中文 HTML 菜单栏（#menubar）承担，避免出现两行菜单
  Menu.setApplicationMenu(null)

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1E1E2E',
    title: 'LogPad',
    show: false,
    webPreferences: {
      // electron-vite 约定：preload 构建产物固定在 out/preload/index.js，dev/prod 路径一致
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // 安全：禁止任何新窗口弹出，改为外部浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 安全：禁止页面内导航跳转（只保留初始加载的本地页面）
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // electron-vite 约定：dev 由 ELECTRON_RENDERER_URL 提供 dev server 地址，prod 加载本地打包文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ===== 冒烟验证钩子 =====
  // LOGPAD_SMOKE=1：窗口加载完成 3 秒后截屏写入 .smoke/app.png 并自动退出（应用可启动、渲染无白屏）。
  // LOGPAD_SMOKE=find：附加查找流程验证（Ctrl+F 对话框 → 计数 → 全部查找 → 搜索结果面板），截屏 .smoke/find.png。
  // 正常使用不设此变量，钩子不生效。
  if (process.env.LOGPAD_SMOKE === '1' || process.env.LOGPAD_SMOKE === 'find') {
    // 冒烟期间把渲染进程的错误/警告转发到终端，便于自动化排查控制台报错
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) console.error(`[renderer:${level}] ${message} (${sourceId}:${line})`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[smoke] renderer gone:', details.reason)
    })
    win.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        try {
          // DOM 健康检查：标签数 / Monaco 编辑器 / 主题 / body 高度 / 活动标签 / 换行联动标记
          const state = await win.webContents.executeJavaScript(
            `JSON.stringify({
              tabs: document.querySelectorAll('.tab').length,
              hasEditor: !!document.querySelector('#editor-host .monaco-editor'),
              theme: document.documentElement.dataset.theme,
              dataWrap: document.documentElement.dataset.wrap,
              activeTab: (document.querySelector('.tab.active .tab-label') || {}).textContent || null,
              bodyH: document.body.getBoundingClientRect().height
            })`
          )
          console.log('[smoke] DOM:', state)
          // 打包版（GUI 子系统）控制台输出不可见：同步写入 userData/.smoke-state.json 供外部验证
          try {
            await writeFile(join(app.getPath('userData'), '.smoke-state.json'), state)
          } catch {
            /* 写入失败不影响冒烟 */
          }

          // 查找流程验证：注入测试文本 → Ctrl+F → 替换标签切换 → 计数 → 全部查找 → 结果面板点击跳转
          //               → Ctrl+Shift+F 文件夹搜索（samples 目录）→ 高度调节条存在性
          if (process.env.LOGPAD_SMOKE === 'find') {
            const samplesDir = join(app.getAppPath(), 'samples').replace(/\\/g, '/')
            const find = await win.webContents.executeJavaScript(`(async () => {
              let insertFailed = true
              const ta = document.querySelector('#editor-host textarea.inputarea')
              if (ta) {
                ta.focus()
                try {
                  insertFailed = !document.execCommand('insertText', false,
                    'INFO service started\\nERROR connection lost\\nWARN retrying\\nERROR gave up\\nDEBUG done')
                } catch { insertFailed = true }
              }
              await new Promise((r) => setTimeout(r, 200))
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }))
              await new Promise((r) => setTimeout(r, 150))
              const dlg = document.querySelector('.lp-finddlg')
              const opened = !!dlg && !dlg.hidden
              const tabAfterOpen = dlg ? dlg.dataset.tab : null
              // 默认位置断言：垂直居中（top ≈ (视口高 - 对话框高)/2，而非固定 96px 偏上）
              let dlgTop = -1, dlgCentered = false
              if (dlg) {
                const r = dlg.getBoundingClientRect()
                dlgTop = Math.round(r.top)
                dlgCentered = Math.abs(r.top - (window.innerHeight - r.height) / 2) < 12
              }
              let tabReplace = null
              if (dlg) {
                dlg.querySelector('.lp-ftab[data-tab=replace]').click()
                tabReplace = dlg.dataset.tab
                dlg.querySelector('.lp-ftab[data-tab=find]').click()
                dlg.querySelector('#lp-what').value = 'ERROR'
                dlg.querySelector('#lp-btn-count').click()
                await new Promise((r) => setTimeout(r, 100))
              }
              const countStatus = dlg ? dlg.querySelector('#lp-fd-status').textContent : ''
              if (dlg) dlg.querySelector('#lp-btn-all').click()
              await new Promise((r) => setTimeout(r, 500))
              const panel = document.getElementById('panel-searchresults')
              const first = panel && panel.querySelector('.sr-line')
              if (first) first.click()
              await new Promise((r) => setTimeout(r, 200))
              const docResult = {
                lines: panel ? panel.querySelectorAll('.sr-line').length : -1,
                marks: panel ? panel.querySelectorAll('.sr-line mark').length : -1,
                levelSpans: panel ? panel.querySelectorAll('.sr-line .sr-lv-error').length : -1
              }
              // 文件夹搜索：Ctrl+Shift+F → infiles 标签 → 目录=samples → 全部查找
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
              await new Promise((r) => setTimeout(r, 150))
              let ifTab = null, ifForm = false, ifStatus = ''
              if (dlg && !dlg.hidden) {
                ifTab = dlg.dataset.tab
                dlg.querySelector('#lp-dir').value = ${JSON.stringify(samplesDir)}
                dlg.querySelector('#lp-what').value = 'ERROR'
                ifForm = !!dlg.querySelector('#lp-glob') && !dlg.hidden && getComputedStyle(dlg.querySelector('#lp-glob')).display !== 'none'
                dlg.querySelector('#lp-btn-ifall').click()
                const t0 = Date.now()
                while (Date.now() - t0 < 8000) {
                  await new Promise((r) => setTimeout(r, 200))
                  if (!/扫描/.test(dlg.querySelector('#lp-fd-status').textContent)) break
                }
                ifStatus = dlg.querySelector('#lp-fd-status').textContent
              }
              await new Promise((r) => setTimeout(r, 500))
              const ifLines = panel ? panel.querySelectorAll('.sr-line').length : -1
              const ifFiles = panel ? panel.querySelectorAll('.sr-path').length : -1
              // 级别着色：搜索词被 <mark> 包裹，行内其余级别词（如 INFO）应有着色 span
              const levelSpans = panel ? panel.querySelectorAll('.sr-line [class^=sr-lv-]').length : -1
              const resizer = document.querySelector('.lp-panels-resizer')
              // 工作区树：事件打开 samples 目录（同 文件->打开 选中文件夹）
              document.dispatchEvent(new CustomEvent('logpad-smoke-workspace', { detail: { dir: ${JSON.stringify(samplesDir)} } }))
              await new Promise((r) => setTimeout(r, 800))
              const ws = document.getElementById('lp-workspace')
              const wsShown = !!ws && !ws.hidden
              const wsItems = ws ? ws.querySelectorAll('.lp-ws-item').length : -1
              const wsTitle = ws ? ws.querySelector('#lp-ws-title').textContent : ''
              // 工作区目录右键 → 菜单 → "在此文件夹中查找" → 对话框 infiles 且目录预填
              // samples 无子目录：对树空白处右键（根目录菜单）验证
              let wsCtxShown = false, wsFindTab = null, wsFindDir = ''
              const wsTree = ws && ws.querySelector('#lp-ws-tree')
              if (wsTree) {
                wsTree.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }))
                await new Promise((r) => setTimeout(r, 100))
                const menu = document.querySelector('.lp-ws-ctxmenu')
                wsCtxShown = !!menu
                const item = menu && menu.querySelector('[data-act=find]')
                if (item) item.click()
                await new Promise((r) => setTimeout(r, 200))
                const d2 = document.querySelector('.lp-finddlg')
                wsFindTab = d2 ? d2.dataset.tab : null
                wsFindDir = d2 ? d2.querySelector('#lp-dir').value : ''
                // 关闭对话框，避免遮挡后续断言截图
                d2.querySelector('#lp-fd-x').click()
              }
              // 拖放：dragenter（带 Files）→ 提示遮罩显示；drop → defaultPrevented 且遮罩复位
              // 注：合成 File 无本地路径，getPathForFile 返回空 → 不实际打开（真实拖放需 OS 层）
              const dropHint = document.querySelector('.lp-drop-hint')
              let dropHintShown = null, dropPrevented = false, dropHintReset = null
              if (dropHint) {
                const dt = new DataTransfer()
                dt.items.add(new File(['INFO smoke drag'], 'smoke-drag.log', { type: 'text/plain' }))
                document.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
                document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
                dropHintShown = !dropHint.hidden
                const dropEvt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
                document.dispatchEvent(dropEvt)
                dropPrevented = dropEvt.defaultPrevented
                await new Promise((r) => setTimeout(r, 200))
                dropHintReset = dropHint.hidden
              }
              // 选区复制：结果区文本可选中（user-select）且右键菜单可弹出
              const srSelectable = panel ? getComputedStyle(panel.querySelector('#sr-body')).userSelect : 'none'
              panel.querySelector('#sr-body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))
              await new Promise((r) => setTimeout(r, 100))
              const ctxMenuShown = !!document.querySelector('.lp-sr-ctxmenu')
              document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
              // 换行开关联动：打开"视图"菜单 → 点击"自动换行" → 正文(data-wrap)与搜索结果面板同步换行
              // （下拉菜单为惰性构建：须先对 .menubar-item 派发 mousedown 打开）
              const wrapBefore = document.documentElement.dataset.wrap
              const viewBtn = Array.from(document.querySelectorAll('.menubar-item')).find(
                (el) => el.textContent.trim() === '视图'
              )
              if (viewBtn) viewBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
              await new Promise((r) => setTimeout(r, 100))
              const wrapItem = Array.from(document.querySelectorAll('.menu-item')).find(
                (el) => el.textContent.trim().endsWith('自动换行')
              )
              if (wrapItem) wrapItem.click()
              await new Promise((r) => setTimeout(r, 150))
              const wrapAfter = document.documentElement.dataset.wrap
              const srTextEl = document.querySelector('#sr-body .fi-text')
              const srWrapCss = srTextEl ? getComputedStyle(srTextEl).whiteSpace : null
              document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) // 关闭菜单
              if (wrapItem && wrapAfter !== wrapBefore) wrapItem.click() // 还原，避免污染持久化设置
              await new Promise((r) => setTimeout(r, 150))
              const wrapRestored = document.documentElement.dataset.wrap === wrapBefore
              // 撤销开头插入的测试文本：否则退出时 beforeunload 的自动保存会把
              // 模型内容写回 samples/app.log，逐轮污染样例文件
              // （走 tabs.js 的 logpad-smoke-revert 钩子 → 编辑器 undo → dirty 清零；
              //   execCommand('undo') 会触发原生 textarea undo 再插入一份，不可用）
              document.dispatchEvent(new Event('logpad-smoke-revert'))
              await new Promise((r) => setTimeout(r, 300))
              return JSON.stringify({
                insertFailed, opened, tabAfterOpen, dlgTop, dlgCentered, tabReplace, countStatus, docResult,
                ifTab, ifForm, ifStatus, ifLines, ifFiles, levelSpans,
                resizerShown: !!resizer && resizer.style.display !== 'none',
                wsShown, wsItems, wsTitle, wsCtxShown, wsFindTab, wsFindDir,
                dropHintShown, dropPrevented, dropHintReset, srSelectable, ctxMenuShown, wrapBefore, wrapAfter, srWrapCss, wrapRestored,
                panelStatus: panel ? panel.querySelector('#sr-status').textContent : ''
              })
            })()`)
            console.log('[smoke] find:', find)
          }

          const img = await win.webContents.capturePage()
          const dir = join(app.getAppPath(), '.smoke')
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, process.env.LOGPAD_SMOKE === 'find' ? 'find.png' : 'app.png'), img.toPNG())
        } catch (err) {
          console.error('smoke capture failed:', err)
        } finally {
          app.quit()
        }
      }, 3000)
    })
  }

  return win
}
