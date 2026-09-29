/**
 * "在文件中查找"目录搜索引擎（任务 2.3）
 *
 * 特性：'; ' 分隔多 glob（支持 * 与 ? 通配）、递归子目录、大小写/正则、
 * 跳过二进制（前 8KB 含 0x00）与 >64MB 大文件、node_modules/.git/隐藏目录、
 * 结果上限 5000 条（truncated=true）、每扫描 20 个文件回报进度、支持取消。
 *
 * 不依赖 electron（进度经回调推送），便于 node 直接单测。
 */
import { readdir, stat, readFile } from 'fs/promises'
import { join } from 'path'
import { detect, decode } from './encoding.js'

const MAX_RESULTS = 5000
const MAX_FILE_SIZE = 64 * 1024 * 1024 // 单文件上限 64MB
const BINARY_CHECK_BYTES = 8192 // 前 8KB 含 0x00 视为二进制
const SKIP_DIRS = new Set(['node_modules', '.git'])

/** 通配符转正则：* → .*，? → .，其余按字面量（自实现，避免新增依赖） */
function globToRegExp(pattern, flags) {
  let source = ''
  for (const ch of pattern) {
    if (ch === '*') source += '.*'
    else if (ch === '?') source += '.'
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, flags)
}

export function createSearchEngine() {
  let cancelled = false

  /**
   * @param {object} options { dir, glob, pattern, caseSensitive, wholeWord, regex, recursive }
   * @param {(data:{scanned:number,matches:number,current:string})=>void} onProgress 进度回调
   * @returns {Promise<{totalFiles:number, results:Array<{path,line,text}>, truncated:boolean}>}
   */
  async function searchInFiles(options, onProgress) {
    const opts = options || {}
    const dir = opts.dir
    const pattern = opts.pattern
    const caseSensitive = opts.caseSensitive === true
    const wholeWord = opts.wholeWord === true
    const regex = opts.regex === true
    const recursive = opts.recursive !== false // 默认递归

    if (typeof dir !== 'string' || !dir) throw new Error('必须指定搜索目录')
    if (typeof pattern !== 'string' || pattern === '') throw new Error('必须指定搜索内容')

    // 行匹配器（regex 时无效正则报错给上层展示；全字仅对字面模式生效，同 Notepad++）
    let matcher
    if (regex) {
      try {
        matcher = new RegExp(pattern, caseSensitive ? '' : 'i')
      } catch (err) {
        throw new Error(`无效的正则表达式：${err.message}`)
      }
    } else {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      matcher = new RegExp(wholeWord ? `\\b${escaped}\\b` : escaped, caseSensitive ? '' : 'i')
    }

    // glob 支持 '; ' 分隔多模式，空模式视为 '*'
    const patterns = String(opts.glob ?? '*')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    if (patterns.length === 0) patterns.push('*')
    // Windows 文件名大小写不敏感
    const globFlags = process.platform === 'win32' ? 'i' : ''
    const globRegs = patterns.map((p) => globToRegExp(p, globFlags))

    cancelled = false
    const results = []
    const state = { scanned: 0, truncated: false, stop: false }

    async function walk(current) {
      if (state.stop || cancelled) return
      let entries
      try {
        entries = await readdir(current, { withFileTypes: true })
      } catch {
        return // 无权限等：跳过该目录
      }
      for (const entry of entries) {
        if (state.stop || cancelled) return
        const full = join(current, entry.name)
        if (entry.isDirectory()) {
          if (!recursive) continue
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          await walk(full)
        } else if (entry.isFile()) {
          if (!globRegs.some((re) => re.test(entry.name))) continue
          state.scanned++
          if (state.scanned % 20 === 0 && onProgress) {
            onProgress({ scanned: state.scanned, matches: results.length, current: full })
          }
          await scanFile(full, matcher, results, state)
        }
      }
    }

    await walk(dir)
    return { totalFiles: state.scanned, results, truncated: state.truncated }
  }

  async function scanFile(filePath, matcher, results, state) {
    let st
    try {
      st = await stat(filePath)
    } catch {
      return
    }
    if (!st.isFile() || st.size > MAX_FILE_SIZE) return

    let buffer
    try {
      buffer = await readFile(filePath)
    } catch {
      return
    }
    // 前 8KB 含 0x00 视为二进制跳过
    const head = buffer.subarray(0, Math.min(BINARY_CHECK_BYTES, buffer.length))
    if (head.includes(0)) return

    // 按文件自身编码解码（日志文件可能是 GBK/UTF-16）
    const { encoding } = detect(buffer.subarray(0, Math.min(65536, buffer.length)))
    const text = decode(buffer, encoding)

    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (matcher.test(line)) {
        // 行内容去首尾空白并截断到 300 字符
        results.push({ path: filePath, line: i + 1, text: line.trim().slice(0, 300) })
        if (results.length >= MAX_RESULTS) {
          state.truncated = true
          state.stop = true
          return
        }
      }
    }
  }

  /** 置取消标志：进行中的搜索会停止扫描并 resolve 已有部分结果 */
  function cancelSearch() {
    cancelled = true
  }

  return { searchInFiles, cancelSearch }
}
