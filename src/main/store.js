/**
 * 持久化（任务 2.4）：settings / 最近文件 / 会话标签 / 搜索历史
 * 统一存入 userData/settings.json，写盘 200ms 去抖。
 *
 * 不依赖 electron（userData 目录由调用方注入），便于 node 直接单测。
 */
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  wordWrap: false,
  showWhitespace: false,
  showEol: false,
  lineNumbers: true,
  autoReload: 'auto',
  largeFileThresholdMB: 20,
  followTailDefault: false
}

const SAVE_DEBOUNCE_MS = 200
const RECENT_MAX = 10
const HISTORY_MAX = 8

/** 深合并 src 到 target（数组与 null 直接覆盖） */
function deepMerge(target, src) {
  for (const key of Object.keys(src || {})) {
    const v = src[key]
    if (
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      target[key] !== null && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      deepMerge(target[key], v)
    } else {
      target[key] = v
    }
  }
  return target
}

/** 置顶去重并截断到 max 条 */
function pushUnique(list, value, max) {
  const next = [value, ...list.filter((item) => item !== value)]
  return next.slice(0, max)
}

/**
 * 创建 store 实例。
 * @param {string} userDataDir 持久化目录（生产传 app.getPath('userData')，测试传临时目录）
 */
export function createStore(userDataDir) {
  const filePath = join(userDataDir, 'settings.json')
  let data = null // { settings, recent, session, searchHistory }
  let loading = null
  let saveTimer = null

  async function load() {
    if (data) return data
    if (!loading) {
      loading = (async () => {
        let parsed = null
        try {
          parsed = JSON.parse(await readFile(filePath, 'utf-8'))
        } catch {
          /* 首次运行或文件损坏：回退默认值 */
        }
        const p = parsed && typeof parsed === 'object' ? parsed : {}
        data = {
          settings: {
            ...DEFAULT_SETTINGS,
            ...(p.settings && typeof p.settings === 'object' ? p.settings : {})
          },
          recent: Array.isArray(p.recent) ? p.recent.filter((x) => typeof x === 'string') : [],
          session:
            p.session && typeof p.session === 'object'
              ? {
                  tabs: Array.isArray(p.session.tabs) ? p.session.tabs : [],
                  activeIndex: p.session.activeIndex ?? 0
                }
              : null,
          searchHistory: {
            dirs: Array.isArray(p.searchHistory?.dirs)
              ? p.searchHistory.dirs.filter((x) => typeof x === 'string')
              : [],
            patterns: Array.isArray(p.searchHistory?.patterns)
              ? p.searchHistory.patterns.filter((x) => typeof x === 'string')
              : []
          }
        }
        return data
      })()
    }
    return loading
  }

  /** 200ms 去抖写盘 */
  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      flush().catch((err) => console.error('settings.json 写盘失败:', err))
    }, SAVE_DEBOUNCE_MS)
  }

  /** 立即落盘（去抖窗口、退出与单测使用） */
  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!data) return
    await mkdir(userDataDir, { recursive: true })
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  return {
    flush,

    async getSettings() {
      return { ...(await load()).settings }
    },

    /** 深合并 partial 后返回完整设置（写盘去抖） */
    async saveSettings(partial) {
      const d = await load()
      deepMerge(d.settings, partial)
      scheduleSave()
      return { ...d.settings }
    },

    async pushRecent(path) {
      const d = await load()
      if (typeof path === 'string' && path) {
        d.recent = pushUnique(d.recent, path, RECENT_MAX)
        scheduleSave()
      }
      return [...d.recent]
    },

    async getRecent() {
      return [...(await load()).recent]
    },

    /** session: { tabs: [{path}], activeIndex } */
    async saveSession(session) {
      const d = await load()
      d.session =
        session && typeof session === 'object'
          ? {
              tabs: Array.isArray(session.tabs) ? session.tabs : [],
              activeIndex: session.activeIndex ?? 0
            }
          : null
      scheduleSave()
    },

    async getSession() {
      const d = await load()
      return d.session ? { ...d.session } : null
    },

    async pushSearchDir(dir) {
      if (typeof dir !== 'string' || !dir) return
      const d = await load()
      d.searchHistory.dirs = pushUnique(d.searchHistory.dirs, dir, HISTORY_MAX)
      scheduleSave()
    },

    async pushSearchPattern(pattern) {
      if (typeof pattern !== 'string' || !pattern) return
      const d = await load()
      d.searchHistory.patterns = pushUnique(d.searchHistory.patterns, pattern, HISTORY_MAX)
      scheduleSave()
    },

    async getSearchHistory() {
      const d = await load()
      return {
        dirs: [...d.searchHistory.dirs],
        patterns: [...d.searchHistory.patterns]
      }
    }
  }
}
