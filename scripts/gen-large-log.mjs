/**
 * 生成大体积示例日志（任务 13 性能验证用）
 * 用法：node scripts/gen-large-log.mjs [目标MB]（默认 100）
 * 输出 samples/large.log（已 .gitignore，不入库）
 */
import { createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targetMB = Number(process.argv[2] || 100)
const targetBytes = targetMB * 1024 * 1024
const out = join(root, 'samples', 'large.log')

const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const MSGS = [
  'Request processed successfully id={id}',
  'Database query returned {n} rows in {ms}ms',
  'Cache miss for key user:{id}, fetching from db',
  'Connection pool status active={n} idle={m} waiting={k}',
  'Failed to call upstream service http://api.internal.svc:8080/v2/users/{id} timeout after 3000ms',
  'User login userId={id} ip=10.{a}.{b}.{c} result=ok',
  'GC pause detected duration={ms}ms totalPause={n}ms',
  'Retrying operation attempt={n} maxAttempts=5 nextDelayMs={ms}',
  'Trace id={uuid} span={uuid} sampled=true',
  '配置热加载完成，共更新 {n} 项参数',
  '队列积压告警 queue=order-events backlog={n} threshold=10000',
  '磁盘使用率 {n}% 超过告警阈值 85%'
]

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  )
const ri = (a, b) => a + Math.floor(Math.random() * (b - a))

const ws = createWriteStream(out, { encoding: 'utf8' })
let written = 0
let line = 0

function pad(n, w) {
  return String(n).padStart(w, '0')
}

function nextChunk() {
  const rows = []
  for (let i = 0; i < 2000; i++) {
    line++
    const lvl = LEVELS[ri(0, LEVELS.length)]
    const msg = MSGS[ri(0, MSGS.length)]
      .replace('{id}', ri(1, 999999))
      .replace('{n}', ri(1, 50000))
      .replace('{m}', ri(1, 500))
      .replace('{k}', ri(0, 50))
      .replace('{ms}', ri(1, 999))
      .replace('{a}', ri(0, 255))
      .replace('{b}', ri(0, 255))
      .replace('{c}', ri(0, 255))
      .replace('{uuid}', uuid())
    const ts = `2026-09-${pad(ri(1, 24), 2)} ${pad(ri(0, 23), 2)}:${pad(ri(0, 59), 2)}:${pad(ri(0, 59), 2)}.${pad(ri(0, 999), 3)}`
    rows.push(`${ts} ${lvl.padEnd(5)} [worker-${ri(1, 8)}] ${msg} requestId=${uuid()}`)
  }
  return rows.join('\n') + '\n'
}

function write() {
  while (written < targetBytes) {
    const chunk = nextChunk()
    written += Buffer.byteLength(chunk)
    if (!ws.write(chunk)) {
      ws.once('drain', write)
      return
    }
  }
  ws.end()
}

write()
ws.on('finish', () => {
  console.log(`生成完成: ${out}`)
  console.log(`大小: ${(written / 1024 / 1024).toFixed(1)} MB，行数: ${line}`)
})
