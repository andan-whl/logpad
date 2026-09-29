/**
 * 大文件打开性能测量（任务 13 验证）
 * 用主进程同款算法（流式读取 + 编码检测）测量 100MB 日志的读取耗时。
 * 用法：node scripts/measure-large.mjs
 */
import { createReadStream, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { detect, decode } from '../src/main/encoding.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(root, 'samples', 'large.log')

const CHUNK_SIZE = 1024 * 1024
const st = statSync(file)
console.log(`文件: ${file}`)
console.log(`大小: ${(st.size / 1024 / 1024).toFixed(1)} MB`)

let t0 = Date.now()
const parts = []
let loaded = 0
await new Promise((resolve, reject) => {
  const stream = createReadStream(file, { highWaterMark: CHUNK_SIZE })
  stream.on('data', (chunk) => {
    parts.push(chunk)
    loaded += chunk.length
  })
  stream.on('error', reject)
  stream.on('end', resolve)
})
const tRead = Date.now() - t0
const buffer = parts.length === 1 ? parts[0] : Buffer.concat(parts, st.size)
console.log(`流式读取: ${tRead} ms`)

t0 = Date.now()
const { encoding } = detect(buffer.subarray(0, Math.min(65536, buffer.length)))
console.log(`编码检测: ${encoding} (${Date.now() - t0} ms)`)

t0 = Date.now()
const content = decode(buffer, encoding)
const tDecode = Date.now() - t0
const lines = content.split('\n').length
console.log(`解码为字符串: ${tDecode} ms（${lines.toLocaleString('en-US')} 行，${content.length.toLocaleString('en-US')} 字符）`)

const total = tRead + tDecode
console.log(`\n总计: ${total} ms（目标 ≤ 5000 ms → ${total <= 5000 ? 'PASS' : 'FAIL'}）`)
process.exit(total <= 5000 ? 0 : 1)
