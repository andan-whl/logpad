/**
 * LogPad Linux deb 构建器（任务 15，Windows 本机无 fpm/Ruby 时的替代实现）
 *
 * 纯 Node（fs + zlib）构建标准 .deb：
 *   debian-binary + control.tar.gz（control/postinst/prerm）+ data.tar.gz
 *   （/opt/LogPad/** + desktop 文件 + hicolor 图标）
 * 产出与 electron-builder fpm 目标等价：release/LogPad-<version>-amd64.deb
 *
 * 用法：node scripts/build-deb.mjs
 */
import { createWriteStream } from 'fs'
import { readdirSync, readFileSync, statSync, mkdirSync } from 'fs'
import { deflateSync, gzipSync } from 'zlib'
import { join, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const unpacked = join(root, 'release', 'linux-unpacked')
const iconSrc = join(root, 'build', 'icon.png')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version.replace(/-/g, '~') // deb 版本规范（同 electron-builder）
const outDir = join(root, 'release')
const outFile = join(outDir, `LogPad-${pkg.version}-amd64.deb`)

/* ==================== USTAR tar 编码 ==================== */

function tarHeader(name, mode, size, mtime, typeflag, linkname) {
  const h = Buffer.alloc(512)
  // name ≤100 直接放；超长按 USTAR prefix 切分
  let n = name
  let prefix = ''
  if (Buffer.byteLength(n) > 100) {
    const idx = n.slice(0, 155).lastIndexOf('/')
    prefix = n.slice(0, idx)
    n = n.slice(idx + 1)
  }
  h.write(n, 0, 100, 'utf8')
  h.write(oct(mode, 7), 100)
  h.write(oct(0, 7), 108) // uid
  h.write(oct(0, 7), 116) // gid
  h.write(oct(size, 11), 124)
  h.write(oct(mtime, 11), 136)
  h.write('        ', 148) // checksum 占位（8 空格）
  h.write(typeflag, 156)
  if (linkname) h.write(linkname, 157, 100)
  h.write('ustar\0', 257)
  h.write('00', 263)
  h.write('root', 265, 32) // uname
  h.write('root', 297, 32) // gname
  // 校验和：头 512 字节求和（checksum 字段按空格计）
  let sum = 0
  for (const b of h) sum += b
  // 校验和字段恰好 8 字节：6 位八进制 + NUL + 空格（多写会覆写 156 处 typeflag）
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}

function oct(v, width) {
  return v.toString(8).padStart(width, '0') + ' '
}

function pad512(n) {
  const rem = n % 512
  return rem ? Buffer.alloc(512 - rem) : Buffer.alloc(0)
}

/** 收集 tar 条目（files: {name, mode, size, data} / {name, type:'dir'} / {name, type:'link', target}） */
function buildTar(entries) {
  const parts = []
  for (const e of entries) {
    if (e.type === 'dir') {
      parts.push(tarHeader(e.name, e.mode ?? 0o755, 0, e.mtime ?? 0, '5'))
    } else if (e.type === 'link') {
      parts.push(tarHeader(e.name, e.mode ?? 0o777, 0, e.mtime ?? 0, '2', e.target))
    } else {
      parts.push(tarHeader(e.name, e.mode, e.data.length, e.mtime ?? 0, '0'))
      parts.push(e.data)
      parts.push(pad512(e.data.length))
    }
  }
  parts.push(Buffer.alloc(1024)) // 结束标志
  return Buffer.concat(parts)
}

/* ==================== ar 归档编码（deb 容器） ==================== */

function arMember(name, data) {
  const head = Buffer.alloc(60)
  head.write(name.slice(0, 16).padEnd(16, ' '), 0, 16, 'ascii') // 经典 ar：空格填充
  head.write('0           ', 16) // mtime
  head.write('0     ', 28) // uid
  head.write('0     ', 34) // gid
  head.write('100644  ', 40) // mode
  head.write(String(data.length).padStart(10, ' '), 48) // size（48-57）
  head.write('`\n', 58) // magic
  const pad = data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
  return Buffer.concat([head, data, pad])
}

/* ==================== 文件系统收集（含 Unix 权限规则） ==================== */

function walkDir(absDir, tarPrefix, entries) {
  entries.push({ name: tarPrefix, type: 'dir' })
  for (const item of readdirSync(absDir, { withFileTypes: true })) {
    const abs = join(absDir, item.name)
    const rel = `${tarPrefix}/${item.name}`
    if (item.isDirectory()) {
      walkDir(abs, rel, entries)
    } else {
      entries.push({
        name: rel,
        mode: unixMode(item.name),
        data: readFileSync(abs),
        mtime: Math.floor(statSync(abs).mtimeMs / 1000)
      })
    }
  }
}

/** Electron Linux 发行权限规则（与官方 zip 一致） */
function unixMode(name) {
  if (name === 'logpad' || name === 'chrome_crashpad_handler') return 0o755
  if (name === 'chrome-sandbox') return 0o4755 // setuid（无 --no-sandbox 运行必需）
  return 0o644
}

/* ==================== control / 脚本 ==================== */

const control = [
  'Package: logpad',
  `Version: ${version}`,
  'Section: utils',
  'Priority: optional',
  'Architecture: amd64',
  'Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0',
  'Recommends: libappindicator3-1',
  'Maintainer: LogPad Contributors <logpad@example.com>',
  `Homepage: ${pkg.homepage}`,
  `Description: ${pkg.description}`,
  ' Multi-tab log viewer/editor with level highlighting/filtering,',
  ' tail-follow, large-file streaming and multi-encoding (GBK/UTF-8/UTF-16) support.',
  ''
].join('\n')

const postinst = [
  '#!/bin/sh',
  'set -e',
  'if command -v update-desktop-database >/dev/null 2>&1; then',
  '  update-desktop-database /usr/share/applications || true',
  'fi',
  'if command -v gtk-update-icon-cache >/dev/null 2>&1; then',
  '  gtk-update-icon-cache --force /usr/share/icons/hicolor || true',
  'fi',
  ''
].join('\n')

const prerm = ['#!/bin/sh', 'set -e', ''].join('\n')

/* ==================== desktop 文件（与 electron-builder 生成一致） ==================== */

const desktop = [
  '[Desktop Entry]',
  'Name=LogPad',
  'Exec=/opt/LogPad/logpad %U',
  `Comment=${pkg.description}`,
  'Terminal=false',
  'Type=Application',
  'Icon=logpad',
  'Categories=Utility;',
  'StartupWMClass=LogPad',
  ''
].join('\n')

/* ==================== 组装 ==================== */

// data.tar.gz
const dataEntries = []
walkDir(unpacked, './opt/LogPad', dataEntries)
dataEntries.push({
  name: './usr/share/applications',
  type: 'dir'
})
dataEntries.push({
  name: './usr/share/applications/logpad.desktop',
  mode: 0o644,
  data: Buffer.from(desktop, 'utf8')
})
dataEntries.push({ name: './usr/share/icons', type: 'dir' })
dataEntries.push({ name: './usr/share/icons/hicolor', type: 'dir' })
dataEntries.push({ name: './usr/share/icons/hicolor/512x512', type: 'dir' })
dataEntries.push({ name: './usr/share/icons/hicolor/512x512/apps', type: 'dir' })
dataEntries.push({
  name: './usr/share/icons/hicolor/512x512/apps/logpad.png',
  mode: 0o644,
  data: readFileSync(iconSrc)
})

const dataTar = gzipSync(buildTar(dataEntries), { level: 9 })
console.log(`data.tar.gz: ${dataEntries.length} 条目，${(dataTar.length / 1048576).toFixed(1)} MB`)

// control.tar.gz
const controlEntries = [
  { name: './control', mode: 0o644, data: Buffer.from(control, 'utf8') },
  { name: './postinst', mode: 0o755, data: Buffer.from(postinst, 'utf8') },
  { name: './prerm', mode: 0o755, data: Buffer.from(prerm, 'utf8') }
]
const controlTar = gzipSync(buildTar(controlEntries), { level: 9 })

// ar 容器
const debianBinary = Buffer.from('2.0\n', 'ascii')
const deb = Buffer.concat([
  Buffer.from('!<arch>\n', 'ascii'),
  arMember('debian-binary', debianBinary),
  arMember('control.tar.gz', controlTar),
  arMember('data.tar.gz', dataTar)
])

mkdirSync(outDir, { recursive: true })
createWriteStream(outFile).write(deb, () => {
  console.log(`deb 已生成: ${outFile}（${(deb.length / 1048576).toFixed(1)} MB）`)
})
