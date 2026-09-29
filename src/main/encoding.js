/**
 * 编码检测与转换（任务 2.2）
 *
 * 检测策略（detect）：
 *   1. BOM 优先：EF BB BF→utf-8-bom；FF FE→utf-16le；FE FF→utf-16be
 *   2. TextDecoder('utf-8',{fatal:true}) 严格试解码成功 → utf-8
 *   3. 高字节（0x81-0xFE）占比 >3% 且 iconv-lite GBK 解码无替换符 → gbk
 *   4. 兜底 utf-8
 *
 * 本模块不依赖 electron，可被 node 直接单测。
 */
import iconv from 'iconv-lite'

const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf])
const BOM_UTF16LE = Buffer.from([0xff, 0xfe])
const BOM_UTF16BE = Buffer.from([0xfe, 0xff])

// 增量解码时最多回退探测的字节数（UTF-8 序列最长 4 字节，GBK 双字节，UTF-16 双/四字节）
const MAX_BACKTRACK = 4

const startsWithBom = (buf, bom) =>
  buf.length >= bom.length && bom.every((b, i) => buf[i] === b)

/** 检测编码。传入文件前 64KB 即可，返回 { encoding, bom } */
export function detect(buffer) {
  if (startsWithBom(buffer, BOM_UTF8)) return { encoding: 'utf-8-bom', bom: true }
  if (startsWithBom(buffer, BOM_UTF16LE)) return { encoding: 'utf-16le', bom: true }
  if (startsWithBom(buffer, BOM_UTF16BE)) return { encoding: 'utf-16be', bom: true }

  // 合法 UTF-8 则直接判定（fatal 模式遇非法序列抛错）
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { encoding: 'utf-8', bom: false }
  } catch {
    /* 非 UTF-8，继续启发式 */
  }

  // GBK 启发式：高字节占比 >3% 且 iconv-lite 严格解码无替换符
  let high = 0
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i]
    if (b >= 0x81 && b <= 0xfe) high++
  }
  if (buffer.length > 0 && high / buffer.length > 0.03) {
    try {
      const text = iconv.decode(buffer, 'gbk')
      if (!text.includes('\ufffd')) return { encoding: 'gbk', bom: false }
    } catch {
      /* 解码异常则不算 GBK */
    }
  }

  return { encoding: 'utf-8', bom: false }
}

/**
 * 解码：encoding 取值 'utf-8' | 'utf-8-bom' | 'gbk' | 'utf-16le' | 'utf-16be'
 * bom 编码自动剥离文件头 BOM 前缀；utf-8 走 TextDecoder 保证代理对正确。
 */
export function decode(buffer, encoding = 'utf-8') {
  switch (encoding) {
    case 'utf-8':
      return new TextDecoder('utf-8').decode(buffer)
    case 'utf-8-bom': {
      const body = startsWithBom(buffer, BOM_UTF8) ? buffer.subarray(3) : buffer
      return new TextDecoder('utf-8').decode(body)
    }
    case 'utf-16le': {
      const body = startsWithBom(buffer, BOM_UTF16LE) ? buffer.subarray(2) : buffer
      return iconv.decode(body, 'utf-16le')
    }
    case 'utf-16be': {
      const body = startsWithBom(buffer, BOM_UTF16BE) ? buffer.subarray(2) : buffer
      return iconv.decode(body, 'utf-16be')
    }
    case 'gbk':
      return iconv.decode(buffer, 'gbk')
    default:
      return new TextDecoder('utf-8').decode(buffer)
  }
}

/** 编码：utf-8-bom 写 EF BB BF 前缀，GBK/UTF-16 由 iconv-lite 处理 */
export function encode(text, encoding = 'utf-8') {
  switch (encoding) {
    case 'utf-8-bom':
      return Buffer.concat([BOM_UTF8, Buffer.from(text, 'utf-8')])
    case 'utf-16le':
    case 'utf-16be':
    case 'gbk':
      return iconv.encode(text, encoding)
    default:
      return Buffer.from(text, 'utf-8')
  }
}

/** 严格试解码：出现无效序列（fatal 抛错或含 U+FFFD）返回 null */
function strictDecode(buffer, encoding) {
  try {
    if (encoding === 'utf-8' || encoding === 'utf-8-bom') {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    }
    const text = iconv.decode(buffer, encoding)
    return text.includes('\ufffd') ? null : text
  } catch {
    return null
  }
}

/**
 * 增量解码（文件监视用）：处理 chunk 末尾可能被截断的多字节序列。
 * 若末尾回退若干字节后可严格解码成功，则回退掉的字节作为 pending 留待下次拼接；
 * 回退 4 字节仍失败说明内容本身损坏，按非严格方式整体解码，不保留 pending。
 * 返回 { text, pending }，pending 为 null 或 Buffer。
 */
export function decodeIncremental(buffer, encoding = 'utf-8') {
  if (buffer.length === 0) return { text: '', pending: null }
  // UTF-16 奇数长度必为跨界截断：iconv-lite 内部基于 StringDecoder 会静默吞掉半字符，
  // 无法靠严格解码探测，须显式保留末字节
  let back = 0
  if ((encoding === 'utf-16le' || encoding === 'utf-16be') && buffer.length % 2 === 1) {
    back = 1
  }
  const limit = Math.min(MAX_BACKTRACK, buffer.length)
  for (; back <= limit; back++) {
    const candidate = back === 0 ? buffer : buffer.subarray(0, buffer.length - back)
    const text = strictDecode(candidate, encoding)
    if (text !== null) {
      return {
        text,
        pending: back === 0 ? null : buffer.subarray(buffer.length - back)
      }
    }
  }
  return { text: decode(buffer, encoding), pending: null }
}
