/**
 * 主进程 IPC 注册中心（任务 2.1/2.3/2.4）
 *
 * 职责：
 *  - 文件：对话框、openFile（流式分块读取 + 进度）、按编码重载、保存
 *  - 监视：fs.watch + 定期 stat，推 file-event（appended/truncated/removed），200ms 去抖
 *  - 搜索：在文件中查找（目录递归扫描，进度/取消）
 *  - 持久化：settings/recent/session/搜索历史 桥接 store.js
 *  - Shell/窗口/对话框杂项
 */
import { app, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { mkdir, open as fsOpen, readdir, readFile as fsReadFile, stat as fsStat, writeFile } from 'fs/promises'
import { createReadStream, watch as fsWatch } from 'fs'
import { detect, decode, encode, decodeIncremental } from './encoding.js'
import { createStore } from './store.js'
import { createSearchEngine } from './search.js'

const CHUNK_SIZE = 1024 * 1024 // 流式读取分块 1MB
const WATCH_DEBOUNCE_MS = 200 // 事件去抖
const WATCH_LOST_TIMEOUT_MS = 3000 // 文件丢失后轮询时长（处理编辑器原子写 rename+create）
const WATCH_LOST_INTERVAL_MS = 500

/** EOL 判定：内容中 \r\n 与 \n 计数取多者 */
function detectEol(content) {
  let crlf = 0
  let lf = 0
  let pos = content.indexOf('\n')
  while (pos !== -1) {
    lf++
    if (pos > 0 && content.charCodeAt(pos - 1) === 13) crlf++
    pos = content.indexOf('\n', pos + 1)
  }
  return crlf > lf - crlf ? 'CRLF' : 'LF'
}

/**
 * 注册全部 IPC。
 * @param {() => Electron.BrowserWindow|null} getWin 获取主窗口（惰性，避免初始化时序问题）
 * @returns {{ cleanup: () => Promise<void> }}
 */
export function registerIpc(getWin) {
  const store = createStore(app.getPath('userData'))
  const searchEngine = createSearchEngine()
  const watchers = new Map() // path → watcher 状态
  const fileEncodings = new Map() // path → 打开/重载时检测到的编码（监视解码用）

  const send = (channel, payload) => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  /* ==================== 文件读取辅助 ==================== */

  /** 读取 [start, end) 区间字节（读取少于请求时返回实际读到的部分） */
  async function readRange(path, start, end) {
    const length = end - start
    if (length <= 0) return null
    const fd = await fsOpen(path, 'r')
    try {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fd.read(buf, 0, length, start)
      return bytesRead === length ? buf : buf.subarray(0, bytesRead)
    } finally {
      await fd.close()
    }
  }

  /** 同步 watcher 的 offset/编码（openFile/saveFile/重载后调用，避免把已知内容当增量） */
  function syncWatcher(path, encoding, size) {
    const w = watchers.get(path)
    if (w) {
      w.encoding = encoding
      w.offset = size
      w.pending = null
    }
  }

  /* ==================== 文件监视 ==================== */

  function sendFileEvent(payload) {
    send('file-event', payload)
  }

  /** 去抖 200ms：同一文件的多次原始事件聚合为一次检查，追加内容自然合并 */
  function scheduleCheck(w) {
    if (w.closed) return
    if (w.debounceTimer) return
    w.debounceTimer = setTimeout(() => {
      w.debounceTimer = null
      checkWatcher(w).catch(() => {})
    }, WATCH_DEBOUNCE_MS)
  }

  /** 建立/重建 fs.watch（rename 后原 watcher 可能失效） */
  function attachWatch(w) {
    if (w.closed || w.raw) return
    try {
      w.raw = fsWatch(w.path, () => scheduleCheck(w))
      w.raw.on('error', () => {
        w.raw = null
        scheduleCheck(w)
      })
    } catch {
      // 文件暂不存在：交给丢失轮询
      startLostPolling(w)
    }
  }

  /** stat 对比 offset，产生 appended / truncated / 丢失轮询 */
  async function checkWatcher(w) {
    if (w.closed) return
    let st = null
    try {
      st = await fsStat(w.path)
    } catch {
      st = null
    }
    if (w.closed) return

    if (st) {
      stopLostPolling(w)
      attachWatch(w) // 丢失期间 raw 已置空，此处幂等
      const prevSize = w.offset

      if (st.size > w.offset) {
        // 追加：从 offset 读到新末尾，按文件编码解码（处理多字节字符跨界）
        try {
          const chunk = await readRange(w.path, w.offset, st.size)
          if (chunk) {
            const merged = w.pending ? Buffer.concat([w.pending, chunk]) : chunk
            const { text, pending } = decodeIncremental(merged, w.encoding)
            w.pending = pending || null
            w.offset = st.size
            if (text) {
              sendFileEvent({
                type: 'appended',
                path: w.path,
                chunk: text,
                prevSize,
                size: st.size,
                encoding: w.encoding
              })
            }
          }
        } catch {
          // 读取失败（文件被锁等）：不推进 offset，下次事件重试
        }
      } else if (st.size < w.offset) {
        // 变小（日志轮转/原子写重建）：重置 offset 供渲染端全量重载
        w.offset = 0
        w.pending = null
        sendFileEvent({
          type: 'truncated',
          path: w.path,
          prevSize,
          size: st.size,
          encoding: w.encoding
        })
      }
      // size === offset：仅 touch/时间戳变化，不产生事件
    } else {
      // 文件不存在：进入丢失轮询（3 秒内重新出现视为原子写完成）
      startLostPolling(w)
    }
  }

  /** 文件丢失后的 3 秒轮询：重新出现→按轮转处理；超时→removed */
  function startLostPolling(w) {
    if (w.pollTimer) return
    const deadline = Date.now() + WATCH_LOST_TIMEOUT_MS
    w.pollTimer = setInterval(async () => {
      if (w.closed) {
        stopLostPolling(w)
        return
      }
      let st = null
      try {
        st = await fsStat(w.path)
      } catch {
        st = null
      }
      if (st) {
        // 原子写完成（rename+create）：重建监视，通知全量重载
        stopLostPolling(w)
        w.offset = 0
        w.pending = null
        if (w.raw) {
          try {
            w.raw.close()
          } catch {
            /* 忽略 */
          }
          w.raw = null
        }
        attachWatch(w)
        sendFileEvent({
          type: 'truncated',
          path: w.path,
          prevSize: 0,
          size: st.size,
          encoding: w.encoding
        })
      } else if (Date.now() >= deadline) {
        stopLostPolling(w)
        const prevSize = w.offset
        closeWatcher(w)
        sendFileEvent({
          type: 'removed',
          path: w.path,
          prevSize,
          size: 0,
          encoding: w.encoding
        })
      }
    }, WATCH_LOST_INTERVAL_MS)
    w.pollTimer.unref?.()
  }

  function stopLostPolling(w) {
    if (w.pollTimer) {
      clearInterval(w.pollTimer)
      w.pollTimer = null
    }
  }

  function closeWatcher(w) {
    w.closed = true
    if (w.debounceTimer) {
      clearTimeout(w.debounceTimer)
      w.debounceTimer = null
    }
    stopLostPolling(w)
    if (w.raw) {
      try {
        w.raw.close()
      } catch {
        /* 忽略 */
      }
      w.raw = null
    }
    if (watchers.get(w.path) === w) watchers.delete(w.path)
  }

  /* ==================== 文件对话框与读写 ==================== */

  ipcMain.handle('open-file-dialog', async () => {
    const win = getWin()
    const opts = {
      // openDirectory：允许直接选中文件夹（打开为工作区树，同 Notepad++ Open Folder as Workspace）
      properties: ['openFile', 'multiSelections', 'openDirectory'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '日志文件', extensions: ['log', 'txt', 'out', 'trace'] }
      ]
    }
    const r = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths
  })

  ipcMain.handle('open-directory-dialog', async () => {
    const win = getWin()
    const opts = { properties: ['openDirectory'] }
    const r = win && !win.isDestroyed()
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })

  /** 判断路径是否为目录（"打开"同时支持文件与文件夹，渲染层据此分流） */
  ipcMain.handle('is-directory', async (_e, path) => {
    if (typeof path !== 'string' || !path) return false
    try {
      return (await fsStat(path)).isDirectory()
    } catch {
      return false
    }
  })

  /** 列出目录直接子项（工作区树懒加载用）：目录优先 + 名称排序 */
  ipcMain.handle('list-dir', async (_e, dir) => {
    if (typeof dir !== 'string' || !dir) return []
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out = []
    for (const ent of entries) {
      const full = join(dir, ent.name)
      let isDir = ent.isDirectory()
      let size = 0
      let mtime = 0
      try {
        const st = await fsStat(full)
        isDir = st.isDirectory()
        size = st.size
        mtime = st.mtimeMs
      } catch {
        /* 无权限等：仅按 dirent 类型展示 */
      }
      out.push({ name: ent.name, dir: isDir, size, mtime, full })
    }
    out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'zh'))
    return out
  })

  ipcMain.handle('save-file-dialog', async (_e, defaultPath) => {
    const win = getWin()
    const opts = typeof defaultPath === 'string' ? { defaultPath } : {}
    const r = win && !win.isDestroyed()
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts)
    return r.canceled ? null : r.filePath
  })

  ipcMain.handle('open-file', async (_e, path) => {
    if (typeof path !== 'string' || !path) return null
    let st
    try {
      st = await fsStat(path)
    } catch {
      throw new Error(`无法打开文件：${path}`)
    }
    if (!st.isFile()) throw new Error(`不是可打开的文件：${path}`)

    // 流式分块（1MB）读取，期间推送 open-progress 进度
    const total = st.size
    const parts = []
    let loaded = 0
    await new Promise((resolve, reject) => {
      const stream = createReadStream(path, { highWaterMark: CHUNK_SIZE })
      stream.on('data', (chunk) => {
        parts.push(chunk)
        loaded += chunk.length
        send('open-progress', { path, loaded, total })
      })
      stream.on('error', reject)
      stream.on('end', resolve)
    })
    const buffer = parts.length === 1 ? parts[0] : Buffer.concat(parts, total)

    const { encoding } = detect(buffer.subarray(0, Math.min(65536, buffer.length)))
    const content = decode(buffer, encoding)
    const settings = await store.getSettings()
    const large = total >= settings.largeFileThresholdMB * 1024 * 1024

    // 记录编码供文件监视解码 chunk 使用；已有 watcher 同步 offset 避免误报
    fileEncodings.set(path, encoding)
    syncWatcher(path, encoding, total)

    return { path, content, size: total, encoding, eol: detectEol(content), large, mtimeMs: st.mtimeMs }
  })

  ipcMain.handle('read-file-with-encoding', async (_e, path, encoding) => {
    if (typeof path !== 'string' || !path) throw new Error('缺少文件路径')
    const enc = encoding || 'utf-8'
    const buffer = await fsReadFile(path)
    const content = decode(buffer, enc) // bom 编码由 decode 剥离前缀
    fileEncodings.set(path, enc)
    syncWatcher(path, enc, buffer.length)
    return { content, size: buffer.length, eol: detectEol(content) }
  })

  ipcMain.handle('save-file', async (_e, path, content, encoding) => {
    if (typeof path !== 'string' || !path) throw new Error('缺少文件路径')
    const enc = encoding || 'utf-8'
    const buffer = encode(String(content ?? ''), enc)
    await writeFile(path, buffer)
    // 写盘后更新 watcher offset，避免误触发自身变更事件
    fileEncodings.set(path, enc)
    syncWatcher(path, enc, buffer.length)
    return { saved: true, path, size: buffer.length }
  })

  /* ==================== 文件监视 IPC ==================== */

  ipcMain.handle('watch-file', async (_e, path) => {
    if (typeof path !== 'string' || !path) return false
    if (watchers.has(path)) return true

    let size = 0
    try {
      const st = await fsStat(path)
      size = st.size
    } catch {
      return false // 文件不存在
    }

    // 优先用打开时检测到的编码，否则读头部检测兜底
    let encoding = fileEncodings.get(path)
    if (!encoding) {
      try {
        const head = await readRange(path, 0, Math.min(65536, size))
        encoding = head ? detect(head).encoding : 'utf-8'
      } catch {
        encoding = 'utf-8'
      }
    }

    const w = {
      path,
      encoding,
      offset: size,
      pending: null, // 多字节字符跨界的未消费尾部字节
      raw: null, // fs.FSWatcher
      debounceTimer: null,
      pollTimer: null,
      closed: false
    }
    watchers.set(path, w)
    attachWatch(w)
    return true
  })

  ipcMain.handle('unwatch-file', (_e, path) => {
    const w = watchers.get(path)
    if (w) closeWatcher(w)
    return true
  })

  /* ==================== 在文件中查找 ==================== */

  ipcMain.handle('search-in-files', async (_e, opts) => {
    if (opts && typeof opts.dir === 'string' && opts.dir) await store.pushSearchDir(opts.dir)
    if (opts && typeof opts.pattern === 'string' && opts.pattern) {
      await store.pushSearchPattern(opts.pattern)
    }
    return searchEngine.searchInFiles(opts, (data) => send('search-progress', data))
  })

  ipcMain.handle('cancel-search', () => {
    searchEngine.cancelSearch()
    return true
  })

  ipcMain.handle('get-search-history', () => store.getSearchHistory())

  /* ==================== 对话框 / Shell / 窗口 ==================== */

  ipcMain.handle('show-message-box', async (_e, opts) => {
    const o = opts || {}
    const boxOpts = {
      type: o.type,
      message: o.message || '',
      detail: o.detail,
      buttons: Array.isArray(o.buttons) ? o.buttons : ['确定'],
      defaultId: o.defaultId,
      cancelId: o.cancelId
    }
    const win = getWin()
    const r = win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, boxOpts)
      : await dialog.showMessageBox(boxOpts)
    return { response: r.response }
  })

  ipcMain.handle('show-in-folder', (_e, path) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle('toggle-fullscreen', () => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen())
    return win && !win.isDestroyed() ? win.isFullScreen() : false
  })

  ipcMain.handle('is-fullscreen', () => {
    const win = getWin()
    return win && !win.isDestroyed() ? win.isFullScreen() : false
  })

  ipcMain.handle('open-external', async (_e, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new Error('仅支持打开 http/https 链接')
    }
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('screenshot', async (_e, name) => {
    const win = getWin()
    if (!win || win.isDestroyed()) return null
    const img = await win.webContents.capturePage()
    const dir = join(app.getAppPath(), '.smoke')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${String(name || 'shot').replace(/[\\/:*?"<>|]/g, '_')}.png`)
    await writeFile(file, img.toPNG())
    return file
  })

  ipcMain.handle('quit-app', () => {
    app.quit()
    return true
  })

  /* ==================== 持久化桥接 ==================== */

  ipcMain.handle('get-settings', () => store.getSettings())
  ipcMain.handle('save-settings', (_e, partial) => store.saveSettings(partial))
  ipcMain.handle('push-recent', (_e, path) => store.pushRecent(path))
  ipcMain.handle('get-recent', () => store.getRecent())
  ipcMain.handle('save-session', (_e, session) => store.saveSession(session))
  ipcMain.handle('get-session', () => store.getSession())

  /* ==================== 退出清理 ==================== */

  /** 关闭全部 watcher 并确保 settings.json 落盘（index.js 在 will-quit 中调用） */
  async function cleanup() {
    for (const w of [...watchers.values()]) closeWatcher(w)
    await store.flush()
  }

  return { cleanup }
}
