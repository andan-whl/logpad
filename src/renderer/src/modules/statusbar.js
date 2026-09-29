/**
 * LogPad 状态栏（任务 12）
 *
 * 替换 ctx.status 为 DOM 实现。字段（实时更新）：
 * 左：长度 | Ln/Col | Sel（字符/行） | 总行数 | 大文件模式
 * 右：修改状态 ● | 跟随 | EOL | 编码 | 语言 | 缩放
 */

export function init(ctx) {
  const bar = document.getElementById('statusbar')
  if (!bar) return

  /* ==================== 结构 ==================== */

  bar.innerHTML = ''
  const left = document.createElement('div')
  left.className = 'status-left'
  const right = document.createElement('div')
  right.className = 'status-right'
  bar.appendChild(left)
  bar.appendChild(right)

  const SEGS = {
    length: ['长度', left],
    ln: ['行', left],
    sel: ['选区', left],
    lines: ['总行数', left],
    large: ['', left],
    dirty: ['', right],
    follow: ['', right],
    eol: ['EOL', right],
    encoding: ['编码', right],
    language: ['语言', right],
    zoom: ['缩放', right]
  }

  const els = new Map()
  for (const [key, [label, side]] of Object.entries(SEGS)) {
    const seg = document.createElement('span')
    seg.className = 'status-seg'
    if (label) {
      const dim = document.createElement('span')
      dim.textContent = label + ' '
      dim.style.color = 'var(--text-dim)'
      seg.appendChild(dim)
    }
    const val = document.createElement('span')
    seg.appendChild(val)
    seg.style.display = 'none'
    side.appendChild(seg)
    els.set(key, { seg, val })
  }

  // 自定义临时字段（书签复制提示等）：动态插入右侧
  const transient = document.createElement('span')
  transient.className = 'status-seg'
  right.insertBefore(transient, els.get('dirty').seg)
  let transientTimer = null

  /* ==================== ctx.status 替换 ==================== */

  ctx.status = {
    set(key, text) {
      if (key === 'bookmark' || !SEGS[key]) {
        // 临时提示字段：5 秒后消失
        transient.textContent = text ?? ''
        transient.style.display = text ? '' : 'none'
        clearTimeout(transientTimer)
        if (text) transientTimer = setTimeout(() => (transient.style.display = 'none'), 5000)
        return
      }
      const el = els.get(key)
      if (text === null || text === undefined || text === '') {
        el.seg.style.display = 'none'
      } else {
        el.seg.style.display = ''
        el.val.textContent = text
      }
    }
  }

  /* ==================== 编辑器事件 → 字段刷新 ==================== */

  const ed = ctx.tabs?.editor

  function tab() {
    return ctx.tabs?.getActive()
  }

  function fmt(n) {
    return n.toLocaleString('en-US')
  }

  function refreshPosition() {
    const pos = ed?.getPosition()
    if (pos) {
      ctx.status.set('ln', `${pos.lineNumber}, ${pos.column}`)
    }
  }

  function refreshSelection() {
    const sel = ed?.getSelection()
    const model = ed?.getModel()
    if (!sel || !model) {
      ctx.status.set('sel', null)
      return
    }
    if (sel.isEmpty()) {
      ctx.status.set('sel', null)
    } else {
      const chars = model.getValueInRange(sel).length
      const lines = sel.endLineNumber - sel.startLineNumber + 1
      ctx.status.set('sel', `${fmt(chars)} 字符, ${lines} 行`)
    }
  }

  function refreshContent() {
    const t = tab()
    const model = t?.model
    if (!model) return
    ctx.status.set('length', fmt(model.getValueLength()))
    ctx.status.set('lines', fmt(model.getLineCount()))
  }

  function refreshMeta() {
    const t = tab()
    if (!t) return
    const model = t.model
    ctx.status.set('eol', model.getEOL() === '\r\n' ? 'CRLF' : 'LF')
    const encLabel = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8-BOM', gbk: 'GBK', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE' }
    ctx.status.set('encoding', encLabel[t.encoding] || t.encoding)
    const lang = model.getLanguageId?.() || 'plaintext'
    ctx.status.set('language', lang === 'log' ? 'Log' : lang === 'plaintext' ? '纯文本' : lang.toUpperCase())
    ctx.status.set('dirty', t.dirty ? '● 已修改' : null)
    ctx.status.set('large', t.large ? '大文件模式' : null)
  }

  if (ed) {
    ed.onDidChangeCursorPosition(refreshPosition)
    ed.onDidChangeCursorSelection(refreshSelection)
    ed.onDidChangeModelContent(() => {
      refreshContent()
      refreshMeta()
    })
    ed.onDidChangeModel(() => {
      refreshPosition()
      refreshSelection()
      refreshContent()
      refreshMeta()
    })
  }

  ctx.tabs?.on('activated', (t) => {
    refreshPosition()
    refreshSelection()
    refreshContent()
    refreshMeta()
  })
  ctx.tabs?.on('dirty-changed', refreshMeta)
  ctx.tabs?.on('saved', refreshMeta)
}
