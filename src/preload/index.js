/**
 * preload 桥（任务 2）：window.api 完整契约
 *
 * 安全约定：
 *  - 全部主进程能力经 ipcRenderer.invoke 走白名单通道，严禁暴露 ipcRenderer 本体
 *  - 事件订阅 on(channel, cb) 仅放行白名单频道，返回 dispose 取消函数
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 渲染进程可订阅的主进程推送频道白名单
const ALLOWED_CHANNELS = ['file-event', 'search-progress', 'open-progress', 'open-file-request']

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

const api = {
  /* ==================== 文件 ==================== */
  /** 多选打开对话框（日志文件/所有文件），取消返回 null */
  openFileDialog: () => invoke('open-file-dialog'),
  /** 目录选择对话框，取消返回 null */
  openDirectoryDialog: () => invoke('open-directory-dialog'),
  /** 另存为对话框，取消返回 null */
  saveFileDialog: (defaultPath) => invoke('save-file-dialog', defaultPath),
  /** 打开文件：流式分块读取（open-progress 进度），自动检测编码/EOL/大文件 */
  openFile: (path) => invoke('open-file', path),
  /** 以指定编码重新读取（编码：utf-8|utf-8-bom|gbk|utf-16le|utf-16be） */
  readFileWithEncoding: (path, encoding) => invoke('read-file-with-encoding', path, encoding),
  /** 按编码写盘（utf-8-bom 自动写 EF BB BF 前缀） */
  saveFile: (path, content, encoding) => invoke('save-file', path, content, encoding),
  /** 判断路径是否为目录（"打开"同时支持文件与文件夹） */
  isDirectory: (path) => invoke('is-directory', path),
  /** 列出目录直接子项：[{name, dir, size, mtime}]，目录优先（工作区树用） */
  listDir: (dir) => invoke('list-dir', dir),
  /** 拖放的 File 对象 → 绝对路径（Electron 32+ 已移除 File.path，须走 webUtils） */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  /* ==================== 文件监视 ==================== */
  watchFile: (path) => invoke('watch-file', path),
  unwatchFile: (path) => invoke('unwatch-file', path),

  /* ==================== 在文件中查找 ==================== */
  searchInFiles: (opts) => invoke('search-in-files', opts),
  cancelSearch: () => invoke('cancel-search'),
  getSearchHistory: () => invoke('get-search-history'),

  /* ==================== 对话框 / Shell / 窗口 ==================== */
  showMessageBox: (opts) => invoke('show-message-box', opts),
  showInFolder: (path) => invoke('show-in-folder', path),
  toggleFullscreen: () => invoke('toggle-fullscreen'),
  isFullscreen: () => invoke('is-fullscreen'),
  /** 仅允许 http/https 链接 */
  openExternal: (url) => invoke('open-external', url),
  /** 截屏写入 .smoke/<name>.png（冒烟验证用） */
  screenshot: (name) => invoke('screenshot', name),
  quitApp: () => invoke('quit-app'),

  /** 运行平台（win32/darwin/linux） */
  platform: process.platform,

  /* ==================== 持久化 ==================== */
  getSettings: () => invoke('get-settings'),
  saveSettings: (partial) => invoke('save-settings', partial),
  pushRecent: (path) => invoke('push-recent', path),
  getRecent: () => invoke('get-recent'),
  saveSession: (session) => invoke('save-session', session),
  getSession: () => invoke('get-session'),

  /* ==================== 事件订阅（白名单频道） ==================== */
  /**
   * 订阅主进程推送事件
   * @param {'file-event'|'search-progress'|'open-progress'} channel 频道
   * @param {(data: any) => void} cb 回调
   * @returns {() => void} dispose 取消订阅函数
   */
  on(channel, cb) {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      throw new Error(`不允许订阅的频道: ${channel}`)
    }
    if (typeof cb !== 'function') {
      throw new Error('on() 需要回调函数')
    }
    const listener = (_event, data) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
