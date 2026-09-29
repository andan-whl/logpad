/**
 * LogPad 应用图标生成器（任务 15）
 * 纯 Node（zlib + 手写 PNG 编码，零外部依赖）生成 512x512 应用图标：
 * 圆角方形深底 + 三条彩色日志级别横线（绿/黄/红）+ 左端时间刻度圆点。
 * 用法：node scripts/gen-icon.mjs   →  build/icon.png
 */
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const SIZE = 512
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')
const outFile = join(outDir, 'icon.png')

/* ==================== 像素画布 ==================== */
const px = new Uint8Array(SIZE * SIZE * 4) // RGBA

function setPixel(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  const alpha = a / 255
  px[i] = Math.round(px[i] * (1 - alpha) + r * alpha)
  px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + g * alpha)
  px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + b * alpha)
  px[i + 3] = Math.max(px[i + 3], a)
}

/** 圆角矩形（抗锯齿：覆盖率近似的 2x2 超采样） */
function roundRect(x0, y0, x1, y1, radius, color) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      // 超采样判断覆盖率
      let cov = 0
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px2 = x + sx
        const py2 = y + sy
        if (px2 < x0 || px2 > x1 || py2 < y0 || py2 > y1) continue
        // 圆角外裁剪
        const cx = Math.max(x0 + radius, Math.min(px2, x1 - radius))
        const cy = Math.max(y0 + radius, Math.min(py2, y1 - radius))
        const dx = px2 - cx
        const dy = py2 - cy
        if (dx * dx + dy * dy > radius * radius) continue
        cov += 0.25
      }
      if (cov > 0) setPixel(x, y, [color[0], color[1], color[2], Math.round(color[3] * cov)])
    }
  }
}

function circle(cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      let cov = 0
      for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const dx = x + sx - cx
        const dy = y + sy - cy
        if (dx * dx + dy * dy <= r * r) cov += 0.25
      }
      if (cov > 0) setPixel(x, y, [color[0], color[1], color[2], Math.round(color[3] * cov)])
    }
  }
}

/* ==================== 绘制 ==================== */

// 深底圆角方形（#181825，边框 #313244）
roundRect(12, 12, 500, 500, 96, [24, 24, 37, 255])
roundRect(16, 16, 496, 496, 92, [24, 24, 37, 255])
// 边框环（用内外圆角差近似）
roundRect(12, 12, 500, 500, 96, [49, 50, 68, 255])
roundRect(20, 20, 492, 492, 88, [24, 24, 37, 255])

// 三条日志级别横线：绿 INFO / 黄 WARN / 红 ERROR
const lines = [
  { y: 128, color: [52, 211, 153, 255] }, // #34d399
  { y: 232, color: [251, 191, 36, 255] }, // #fbbf24
  { y: 336, color: [248, 113, 113, 255] } // #f87171
]
for (const { y, color } of lines) {
  circle(120, y + 18, 20, color) // 左端时间刻度圆点
  roundRect(160, y, 408, y + 36, 18, color) // 横线
}

/* ==================== PNG 编码 ==================== */

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// 扫描线：filter byte 0 + RGBA
const stride = SIZE * 4
const raw = Buffer.alloc((stride + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0
  Buffer.from(px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, png)
console.log(`图标已生成: ${outFile}（${SIZE}x${SIZE}，${(png.length / 1024).toFixed(1)} KB）`)
