/**
 * deb 结构校验器（任务 15）：解析 ar 容器与 tar 成员，
 * 校验 control/data 完整性、关键文件权限与内容。纯 Node。
 * 用法：node scripts/verify-deb.mjs
 */
import { readFileSync } from 'fs'
import { gunzipSync, inflateRawSync } from 'zlib'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const debPath = join(root, 'release', 'LogPad-0.1.0-amd64.deb')
const buf = readFileSync(debPath)

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${msg}`)
  } else {
    fail++
    console.error(`  ✗ ${msg}`)
  }
}

/* ==================== ar 容器解析 ==================== */
console.log('== ar 容器 ==')
ok(buf.subarray(0, 8).toString('ascii') === '!<arch>\n', '魔数 !<arch>')

const members = []
let off = 8
while (off < buf.length) {
  const head = buf.subarray(off, off + 60)
  if (head.length < 60) break
  const name = head.subarray(0, 16).toString('ascii').replace(/[\s/\0]+$/, '')
  const size = parseInt(head.subarray(48, 58).toString('ascii').trim(), 10)
  const magic = head.subarray(58, 60).toString('ascii')
  if (magic !== '`\n') throw new Error(`成员 ${name} 魔数错误: ${JSON.stringify(magic)}`)
  members.push({ name, size, data: buf.subarray(off + 60, off + 60 + size) })
  off += 60 + size + (size % 2)
}
ok(members.length === 3, `成员数 = 3（实际 ${members.length}）`)
ok(members[0]?.name === 'debian-binary', `成员1 名称 = debian-binary（${members[0]?.name}）`)
ok(members[0]?.data.toString('ascii').trim() === '2.0', 'debian-binary 版本 2.0')
ok(members[1]?.name === 'control.tar.gz', `成员2 名称 = control.tar.gz（${members[1]?.name}）`)
ok(members[2]?.name === 'data.tar.gz', `成员3 名称 = data.tar.gz（${members[2]?.name}）`)

/* ==================== tar 解析 ==================== */
function parseTar(tarBuf) {
  const entries = []
  let off = 0
  while (off < tarBuf.length) {
    const h = tarBuf.subarray(off, off + 512)
    if (h.every((b) => b === 0)) break
    const nameField = h.subarray(0, 100).toString('utf8').replace(/\0+$/, '')
    const prefixField = h.subarray(345, 500).toString('utf8').replace(/\0+$/, '')
    const name = prefixField ? `${prefixField}/${nameField}` : nameField
    const mode = parseInt(h.subarray(100, 108).toString('ascii').trim(), 8)
    const size = parseInt(h.subarray(124, 136).toString('ascii').trim(), 8)
    const typeflag = String.fromCharCode(h[156])
    let data = null
    let linkname = null
    if (typeflag === '0') {
      data = tarBuf.subarray(off + 512, off + 512 + size)
    } else if (typeflag === '2') {
      linkname = h.subarray(157, 257).toString('utf8').replace(/\0+$/, '')
    }
    // 校验和验证（POSIX/GNU 约定：checksum 字段本身按 8 个空格计入，即 +256）
    let sum = 256
    for (let i = 0; i < 512; i++) if (i < 148 || i >= 156) sum += h[i]
    const stored = parseInt(h.subarray(148, 156).toString('ascii').trim(), 8)
    if (sum !== stored) throw new Error(`tar 校验和错误: ${name} (${sum} != ${stored})`)
    entries.push({ name, mode, typeflag, data, linkname })
    off += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

/* ==================== control.tar.gz ==================== */
console.log('== control.tar.gz ==')
const controlEntries = parseTar(gunzipSync(members[1].data))
const controlFile = controlEntries.find((e) => e.name === './control')
ok(!!controlFile, '包含 ./control')
const controlText = controlFile?.data.toString('utf8') ?? ''
ok(/^Package: logpad$/m.test(controlText), 'Package: logpad')
ok(/^Version: 0\.1\.0$/m.test(controlText), 'Version: 0.1.0')
ok(/^Architecture: amd64$/m.test(controlText), 'Architecture: amd64')
ok(/^Maintainer: /m.test(controlText), 'Maintainer 存在')
ok(/^Depends: libgtk-3-0/m.test(controlText), 'Depends 依赖列表')
const postinst = controlEntries.find((e) => e.name === './postinst')
ok(!!postinst && (postinst.mode & 0o755) === 0o755, `postinst 存在且 0755（mode=${(postinst?.mode ?? 0).toString(8)}）`)

/* ==================== data.tar.gz ==================== */
console.log('== data.tar.gz ==')
const dataEntries = parseTar(gunzipSync(members[2].data))
const byName = new Map(dataEntries.map((e) => [e.name, e]))

ok(byName.has('./opt/LogPad/logpad'), '包含 /opt/LogPad/logpad 可执行')
const bin = byName.get('./opt/LogPad/logpad')
ok((bin?.mode & 0o755) === 0o755, `logpad 权限 0755（mode=${(bin?.mode ?? 0).toString(8)}）`)
ok(bin?.data.subarray(0, 4).toString('ascii') === '\x7fELF', 'logpad 为 ELF 二进制')

const sandbox = byName.get('./opt/LogPad/chrome-sandbox')
ok((sandbox?.mode & 0o4755) === 0o4755, `chrome-sandbox setuid 4755（mode=${(sandbox?.mode ?? 0).toString(8)}）`)

const asar = byName.get('./opt/LogPad/resources/app.asar')
ok(!!asar && asar.data.length > 100 * 1024 * 1024 || (asar?.data.length ?? 0) > 50 * 1024 * 1024, `app.asar 完整（${((asar?.data.length ?? 0) / 1048576).toFixed(1)} MB）`)

ok(byName.has('./usr/share/applications/logpad.desktop'), '包含 desktop 文件')
const desktopText = byName.get('./usr/share/applications/logpad.desktop')?.data.toString('utf8') ?? ''
ok(/^Name=LogPad$/m.test(desktopText), 'desktop Name=LogPad')
ok(/^Exec=\/opt\/LogPad\/logpad %U$/m.test(desktopText), 'desktop Exec=/opt/LogPad/logpad %U')
ok(/^Icon=logpad$/m.test(desktopText), 'desktop Icon=logpad')

const icon = byName.get('./usr/share/icons/hicolor/512x512/apps/logpad.png')
ok(icon?.data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'hicolor 图标为 PNG')

const dirEntry = byName.get('./opt/LogPad')
ok(dirEntry?.typeflag === '5' && (dirEntry.mode & 0o755) === 0o755, '目录条目 type=5 且 0755')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
