/**
 * 主进程纯逻辑单测（任务 2 验证，node 直接运行，不依赖 electron）：
 *   node scripts/verify-main.mjs
 * 覆盖：encoding.js（检测/解码/编码/增量解码）、store.js（持久化注入临时目录）、
 *       search.js（目录搜索：通配/递归/跳过/进度/取消/正则）
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'

import { detect, decode, encode, decodeIncremental } from '../src/main/encoding.js'
import { createStore, DEFAULT_SETTINGS } from '../src/main/store.js'
import { createSearchEngine } from '../src/main/search.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
let passed = 0
// 收集测试统一串行执行（避免与脚本尾部清理产生竞态）
const tests = []
const test = (name, fn) => tests.push({ name, fn })
const section = (title) => tests.push({ title })

async function runAll() {
  for (const t of tests) {
    if (t.title) {
      console.log(`\n${t.title}`)
      continue
    }
    try {
      await t.fn()
      passed++
      console.log(`  ok - ${t.name}`)
    } catch (err) {
      console.error(`  FAIL - ${t.name}`)
      throw err
    }
  }
}

/* ==================== 1. encoding.js ==================== */
section('[1] encoding.js 编码检测')

test('UTF-8 无 BOM（含中文）', () => {
  const buf = Buffer.from('ERROR 数据库连接失败', 'utf-8')
  assert.equal(detect(buf).encoding, 'utf-8')
  assert.equal(detect(buf).bom, false)
})

test('纯 ASCII 判定 UTF-8', () => {
  assert.equal(detect(Buffer.from('2026-09-24 INFO ok', 'utf-8')).encoding, 'utf-8')
})

test('空内容判定 UTF-8', () => {
  assert.equal(detect(Buffer.alloc(0)).encoding, 'utf-8')
})

test('UTF-8 BOM → utf-8-bom 且解码去 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('你好', 'utf-8')])
  assert.deepEqual(detect(buf), { encoding: 'utf-8-bom', bom: true })
  assert.equal(decode(buf, 'utf-8-bom'), '你好')
})

test('GBK 中文（iconv-lite 造样本）→ gbk', () => {
  const buf = iconv.encode('中文日志测试 ERROR 发生异常', 'gbk')
  assert.equal(detect(buf).encoding, 'gbk')
  assert.equal(decode(buf, 'gbk'), '中文日志测试 ERROR 发生异常')
})

test('UTF-16LE BOM → utf-16le 且解码去 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('你好世界', 'utf-16le')])
  assert.deepEqual(detect(buf), { encoding: 'utf-16le', bom: true })
  assert.equal(decode(buf, 'utf-16le'), '你好世界')
})

test('UTF-16BE BOM → utf-16be 且解码去 BOM', () => {
  const body = iconv.encode('你好世界', 'utf-16be')
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  assert.deepEqual(detect(buf), { encoding: 'utf-16be', bom: true })
  assert.equal(decode(buf, 'utf-16be'), '你好世界')
})

section('[1.2] encoding.js 编码转换（roundtrip）')

test('encode/decode roundtrip：utf-8 / gbk / utf-16le / utf-16be', () => {
  const text = '中文abc surrogate: \ud83d\ude00'
  for (const enc of ['utf-8', 'gbk', 'utf-16le', 'utf-16be']) {
    if (enc === 'gbk') {
      // GBK 无法表示 emoji，改用中文样本
      assert.equal(decode(encode('中文abc', enc), enc), '中文abc')
    } else {
      assert.equal(decode(encode(text, enc), enc), text)
    }
  }
})

test('encode utf-8-bom 写 EF BB BF 前缀', () => {
  const buf = encode('你好', 'utf-8-bom')
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf])
  assert.equal(buf.subarray(3).toString('utf-8'), '你好')
})

section('[1.3] encoding.js 增量解码（多字节字符跨界）')

test('UTF-8 跨界：分两次拼接完整还原', () => {
  const full = Buffer.from('世界', 'utf-8') // 各 3 字节
  const r1 = decodeIncremental(full.subarray(0, 4), 'utf-8')
  assert.equal(r1.text, '世')
  assert.equal(r1.pending.length, 1)
  const r2 = decodeIncremental(Buffer.concat([r1.pending, full.subarray(4)]), 'utf-8')
  assert.equal(r2.text, '界')
  assert.equal(r2.pending, null)
  assert.equal(r1.text + r2.text, '世界')
})

test('GBK 跨界：残留半字符合并到下次', () => {
  const full = iconv.encode('中文测试', 'gbk') // 每字 2 字节
  const r1 = decodeIncremental(full.subarray(0, 5), 'gbk')
  assert.equal(r1.text, '中文')
  assert.equal(r1.pending.length, 1)
  const r2 = decodeIncremental(Buffer.concat([r1.pending, full.subarray(5)]), 'gbk')
  assert.equal(r2.text, '测试')
})

test('UTF-16LE 奇数截断跨界', () => {
  const full = Buffer.from('AB', 'utf-16le') // 4 字节
  const r1 = decodeIncremental(full.subarray(0, 3), 'utf-16le')
  assert.equal(r1.text, 'A')
  assert.equal(r1.pending.length, 1)
  const r2 = decodeIncremental(Buffer.concat([r1.pending, full.subarray(3)]), 'utf-16le')
  assert.equal(r2.text, 'B')
})

test('完整块解码无 pending', () => {
  const r = decodeIncremental(Buffer.from('完整内容', 'utf-8'), 'utf-8')
  assert.equal(r.text, '完整内容')
  assert.equal(r.pending, null)
})

test('损坏字节兜底不抛错', () => {
  const r = decodeIncremental(Buffer.from([0xff, 0xfe, 0xff]), 'utf-8')
  assert.equal(typeof r.text, 'string')
})

/* ==================== 2. store.js ==================== */
section('[2] store.js 持久化（临时目录注入）')

const storeDir = await mkdtemp(join(tmpdir(), 'logpad-store-'))
const store = createStore(storeDir)

test('默认设置', async () => {
  const s = await store.getSettings()
  assert.deepEqual(s, { ...DEFAULT_SETTINGS })
  assert.equal(s.largeFileThresholdMB, 20)
})

test('saveSettings 深合并返回完整设置', async () => {
  const s = await store.saveSettings({ fontSize: 18, theme: 'light', nested: { a: 1 } })
  assert.equal(s.fontSize, 18)
  assert.equal(s.theme, 'light')
  assert.equal(s.wordWrap, false) // 未传字段保持默认
  // 再次部分保存：之前修改保持
  const s2 = await store.saveSettings({ wordWrap: true })
  assert.equal(s2.fontSize, 18)
  assert.equal(s2.wordWrap, true)
})

test('pushRecent 去重置顶 + 上限 10 条', async () => {
  await store.pushRecent('a.log')
  await store.pushRecent('b.log')
  await store.pushRecent('a.log')
  assert.deepEqual(await store.getRecent(), ['a.log', 'b.log'])
  for (let i = 0; i < 12; i++) await store.pushRecent(`f${i}.log`)
  const recent = await store.getRecent()
  assert.equal(recent.length, 10)
  assert.equal(recent[0], 'f11.log')
})

test('saveSession / getSession', async () => {
  await store.saveSession({ tabs: [{ path: 'x.log' }, { path: 'y.log' }], activeIndex: 1 })
  const s = await store.getSession()
  assert.equal(s.tabs.length, 2)
  assert.equal(s.tabs[1].path, 'y.log')
  assert.equal(s.activeIndex, 1)
})

test('搜索历史去重置顶 + 上限 8 条', async () => {
  await store.pushSearchDir('D:\\logs')
  await store.pushSearchDir('E:\\logs')
  await store.pushSearchDir('D:\\logs')
  for (let i = 0; i < 10; i++) await store.pushSearchPattern(`p${i}`)
  const h = await store.getSearchHistory()
  assert.deepEqual(h.dirs, ['D:\\logs', 'E:\\logs'])
  assert.equal(h.patterns.length, 8)
  assert.equal(h.patterns[0], 'p9')
})

test('flush 落盘且新实例可恢复（重启恢复场景）', async () => {
  await store.flush()
  const raw = JSON.parse(await readFile(join(storeDir, 'settings.json'), 'utf-8'))
  assert.equal(raw.settings.fontSize, 18)
  assert.equal(raw.recent[0], 'f11.log')
  const store2 = createStore(storeDir)
  assert.equal((await store2.getSettings()).fontSize, 18)
  assert.equal((await store2.getRecent())[0], 'f11.log')
  assert.equal((await store2.getSession()).activeIndex, 1)
  assert.equal((await store2.getSearchHistory()).patterns[0], 'p9')
})

test('损坏的 settings.json 回退默认不崩溃', async () => {
  const corruptDir = await mkdtemp(join(tmpdir(), 'logpad-corrupt-'))
  await writeFile(join(corruptDir, 'settings.json'), '{ 不是合法 JSON', 'utf-8')
  const s = await createStore(corruptDir).getSettings()
  assert.equal(s.theme, 'dark')
  await rm(corruptDir, { recursive: true, force: true })
})

/* ==================== 3. search.js ==================== */
section('[3] search.js 目录搜索引擎（临时目录）')

const searchRoot = await mkdtemp(join(tmpdir(), 'logpad-search-'))
const engine = createSearchEngine()

await writeFile(join(searchRoot, 'a.log'), 'ERROR alpha 连接失败\nWARN beta\nERROR gamma\r\nINFO  ok\n', 'utf-8')
await writeFile(join(searchRoot, 'b.log'), iconv.encode('2026 ERROR 中文错误行\n正常行\nERROR 又一行\n', 'gbk'))
await writeFile(join(searchRoot, 'c.txt'), '  ERROR in txt with padding  \nplain line\n')
await writeFile(join(searchRoot, 'd.md'), 'ERROR should not match glob\n')
await writeFile(join(searchRoot, 'binary.bin'), Buffer.concat([Buffer.from('ERROR'), Buffer.from([0x00]), Buffer.from('more')]))
await mkdir(join(searchRoot, 'node_modules', 'pkg'), { recursive: true })
await writeFile(join(searchRoot, 'node_modules', 'pkg', 'skip.log'), 'ERROR in node_modules\n')
await mkdir(join(searchRoot, '.hidden'), { recursive: true })
await writeFile(join(searchRoot, '.hidden', 'h.log'), 'ERROR in hidden dir\n')
await mkdir(join(searchRoot, 'sub'), { recursive: true })
await writeFile(join(searchRoot, 'sub', 'e.log'), 'ERROR in subdir\n')

test('基础搜索：UTF-8 + GBK + 递归 + glob 多模式 + 跳过目录', async () => {
  const r = await engine.searchInFiles({
    dir: searchRoot,
    glob: '*.log; *.txt', // 含空格分隔
    pattern: 'ERROR',
    recursive: true
  })
  const paths = r.results.map((x) => x.path)
  assert.ok(paths.includes(join(searchRoot, 'a.log')))
  assert.ok(paths.includes(join(searchRoot, 'b.log')))
  assert.ok(paths.includes(join(searchRoot, 'c.txt')))
  assert.ok(paths.includes(join(searchRoot, 'sub', 'e.log')), '递归子目录')
  assert.ok(!paths.some((p) => p.includes('node_modules')), '跳过 node_modules')
  assert.ok(!paths.some((p) => p.includes('.hidden')), '跳过隐藏目录')
  assert.ok(!paths.includes(join(searchRoot, 'd.md')), '不匹配 glob 的文件')
  assert.ok(!paths.includes(join(searchRoot, 'binary.bin')), '二进制跳过')
  assert.equal(r.truncated, false)
  // UTF-8 与 GBK 文件都按自身编码解码（中文匹配正确性）
  const gbkLine = r.results.find((x) => x.path === join(searchRoot, 'b.log') && x.line === 1)
  assert.equal(gbkLine.text, '2026 ERROR 中文错误行')
  // 行号从 1 开始、CRLF 行正确计行
  const a3 = r.results.find((x) => x.path === join(searchRoot, 'a.log') && x.line === 3)
  assert.equal(a3.text, 'ERROR gamma') // \r 已剥离
})

test('大小写敏感开关', async () => {
  const cs = await engine.searchInFiles({ dir: searchRoot, glob: 'a.log', pattern: 'error', caseSensitive: true })
  assert.equal(cs.results.length, 0)
  const ci = await engine.searchInFiles({ dir: searchRoot, glob: 'a.log', pattern: 'error' })
  assert.equal(ci.results.length, 2) // 'ERROR alpha' 与 'ERROR gamma'
})

test('正则搜索与无效正则报错', async () => {
  const r = await engine.searchInFiles({ dir: searchRoot, glob: 'a.log', pattern: '^ERROR (alpha|gamma)', regex: true })
  assert.equal(r.results.length, 2)
  await assert.rejects(
    engine.searchInFiles({ dir: searchRoot, glob: 'a.log', pattern: '(', regex: true }),
    /无效的正则表达式/
  )
})

test('通配符 ? 与单字符匹配', async () => {
  await writeFile(join(searchRoot, 'toolong.log'), 'ERROR long name\n', 'utf-8')
  const r = await engine.searchInFiles({ dir: searchRoot, glob: '?.log', pattern: 'ERROR' })
  const names = r.results.map((x) => x.path)
  assert.ok(names.includes(join(searchRoot, 'a.log')), 'a.log 匹配')
  assert.ok(names.includes(join(searchRoot, 'sub', 'e.log')), '文件名 e.log 为单字符，应匹配')
  assert.ok(!names.includes(join(searchRoot, 'toolong.log')), '多字符文件名不匹配 ?')
})

test('recursive:false 不进子目录', async () => {
  const r = await engine.searchInFiles({ dir: searchRoot, glob: '*.log', pattern: 'ERROR', recursive: false })
  assert.ok(!r.results.some((x) => x.path.includes('sub')), '子目录文件不应出现')
})

test('结果文本去首尾空白并截断 300 字符', async () => {
  const pad = ' '.repeat(5) + 'ERROR ' + 'x'.repeat(400)
  const dir2 = await mkdtemp(join(tmpdir(), 'logpad-trim-'))
  await writeFile(join(dir2, 'long.log'), pad + '\n', 'utf-8')
  const r = await engine.searchInFiles({ dir: dir2, glob: '*.log', pattern: 'ERROR' })
  assert.equal(r.results[0].text.length, 300)
  assert.ok(!r.results[0].text.startsWith(' '))
  await rm(dir2, { recursive: true, force: true })
})

test('进度回调：每 20 个文件推送', async () => {
  const dir3 = await mkdtemp(join(tmpdir(), 'logpad-prog-'))
  for (let i = 0; i < 25; i++) {
    await writeFile(join(dir3, `p${i}.log`), `ERROR file ${i}\n`, 'utf-8')
  }
  const events = []
  const r = await engine.searchInFiles(
    { dir: dir3, glob: '*.log', pattern: 'ERROR' },
    (p) => events.push(p)
  )
  assert.equal(r.totalFiles, 25)
  assert.equal(r.results.length, 25)
  assert.ok(events.length >= 1, '至少触发一次进度')
  assert.ok(events[0].scanned % 20 === 0 && events[0].scanned > 0)
  assert.equal(events[0].matches, 19) // 推送发生在扫描第 20 个文件之前
  assert.equal(typeof events[0].current, 'string')
  await rm(dir3, { recursive: true, force: true })
})

test('取消搜索：resolve 已有部分结果', async () => {
  const dir4 = await mkdtemp(join(tmpdir(), 'logpad-cancel-'))
  for (let i = 0; i < 30; i++) {
    await writeFile(join(dir4, `c${i}.log`), `ERROR cancel ${i}\n`, 'utf-8')
  }
  const promise = engine.searchInFiles(
    { dir: dir4, glob: '*.log', pattern: 'ERROR' },
    () => {}
  )
  engine.cancelSearch() // 发起后立即取消
  const r = await promise
  assert.ok(Array.isArray(r.results))
  assert.ok(r.results.length < 30, `取消后结果应为部分（实际 ${r.results.length}）`)
  await rm(dir4, { recursive: true, force: true })
})

test('单文件 >64MB 跳过', async () => {
  const dir5 = await mkdtemp(join(tmpdir(), 'logpad-big-'))
  const big = join(dir5, 'big.log')
  await writeFile(big, 'ERROR big file\n', 'utf-8')
  const { truncate } = await import('node:fs/promises')
  await truncate(big, 65 * 1024 * 1024 + 1) // 稀疏扩展为 64MB+1
  const r = await engine.searchInFiles({ dir: dir5, glob: '*.log', pattern: 'ERROR' })
  assert.equal(r.results.length, 0)
  assert.equal(r.totalFiles, 1)
  await rm(dir5, { recursive: true, force: true })
})

/* ==================== 6. 跨平台路径契约（Linux 工作区/搜索回归防护） ==================== */
section('[6] 跨平台路径契约')

test('渲染层不得把 / 转换为 \\（Linux 绝对路径会被毁成 \\home\\x）', async () => {
  const { readFile: rf } = await import('node:fs/promises')
  const raw = await rf(join(ROOT, '..', 'src', 'renderer', 'src', 'modules', 'workspace.js'), 'utf-8')
  // 排除注释行（历史 bug 以注释形式留档，不算回归）
  const code = raw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.ok(!code.includes('replace(/\\//g'), 'workspace.js 不得含 replace(/\\//g —— 会破坏 Linux 路径')
  assert.ok(!code.includes("+ '\\\\' +"), "workspace.js 不得自行用 '\\' 拼接路径 —— 主进程已返回 full")
})

test('list-dir 返回完整路径 full（渲染层跨平台路径的唯一来源）', async () => {
  const { readFile: rf } = await import('node:fs/promises')
  const src = await rf(join(ROOT, '..', 'src', 'main', 'ipc.js'), 'utf-8')
  assert.ok(src.includes('out.push({ name: ent.name, dir: isDir, size, mtime, full })'),
    'ipc.js list-dir 必须返回 full（path.join 生成，跨平台正确）')
})

test('posix 语义：join 后的 Linux 路径可直接 readdir（模拟 Linux 运行时）', async () => {
  // 主进程在 Linux 上 path.join 即 posix 语义；此处验证渲染层拿到的 full
  // 传回 listDir/isDirectory 时不经任何转换（源码级），并验证 posix.join 产物可读
  const { readdir: rd } = await import('node:fs/promises')
  const posix = await import('node:path').then((m) => m.posix)
  const dir6 = await mkdtemp(join(tmpdir(), 'logpad-posix-'))
  await writeFile(join(dir6, 'note.txt'), 'hello\n', 'utf-8')
  // 以 posix 风格重算（等价 Linux 上主进程的行为）
  const full = posix.join(dir6.split('\\').join('/'), 'note.txt')
  const entries = await rd(posix.dirname(full), { withFileTypes: true })
  assert.ok(entries.some((e) => e.name === 'note.txt'))
  await rm(dir6, { recursive: true, force: true })
})

/* ==================== 执行、清理与汇总 ==================== */
await runAll()

await store.flush() // 清掉可能残留的去抖 timer，避免清理后触发写盘
await rm(storeDir, { recursive: true, force: true })
await rm(searchRoot, { recursive: true, force: true })

console.log(`\n全部通过：${passed} 个断言组 ✓`)
