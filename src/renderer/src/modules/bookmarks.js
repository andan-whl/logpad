/**
 * LogPad 书签（任务 8）
 *
 * Ctrl+F2 切换当前行书签 / F2、Shift+F2 跳转下一个/上一个（循环）/
 * 全部清除 / 复制所有书签行内容到剪贴板。
 * 书签图标显示在 glyph margin（任务 3 的编辑器已开启 glyphMargin），
 * 点击 glyph margin 也可切换书签。每个标签独立书签集合（挂在 tab 对象上）。
 */

export function init(ctx) {
  const { commandBus, monaco } = ctx

  const BOOKMARK_CLS = 'lp-bookmark'
  const style = document.createElement('style')
  style.textContent = `
    .lp-bookmark { background: var(--lvl-warn); width: 8px !important; margin-left: 4px;
      border-radius: 2px; }
    .lp-bookmark:hover { background: var(--accent); }
  `
  document.head.appendChild(style)

  let collection = null

  function editor() {
    return ctx.tabs?.editor
  }

  function currentTab() {
    return ctx.tabs?.getActive()
  }

  function bookmarksOf(tab) {
    if (!tab.bookmarks) tab.bookmarks = new Set()
    return tab.bookmarks
  }

  function render() {
    const ed = editor()
    const tab = currentTab()
    if (!ed || !tab) return
    const decos = []
    for (const line of bookmarksOf(tab)) {
      if (line <= tab.model.getLineCount()) {
        decos.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { glyphMarginClassName: BOOKMARK_CLS, isWholeLine: false }
        })
      }
    }
    if (!collection) collection = ed.createDecorationsCollection([])
    collection.set(decos)
  }

  function toggle(line) {
    const tab = currentTab()
    if (!tab) return
    const cur = line ?? editor()?.getPosition()?.lineNumber
    if (!cur) return
    const set = bookmarksOf(tab)
    if (set.has(cur)) set.delete(cur)
    else set.add(cur)
    render()
  }

  function jump(next) {
    const ed = editor()
    const tab = currentTab()
    if (!ed || !tab) return
    const set = bookmarksOf(tab)
    if (set.size === 0) return
    const cur = ed.getPosition().lineNumber
    const sorted = [...set].sort((a, b) => a - b)
    let target
    if (next) {
      target = sorted.find((l) => l > cur)
      if (target === undefined) target = sorted[0] // 循环到第一个
    } else {
      target = [...sorted].reverse().find((l) => l < cur)
      if (target === undefined) target = sorted[sorted.length - 1] // 循环到最后一个
    }
    ed.revealLineInCenter(target)
    ed.setPosition({ lineNumber: target, column: 1 })
    ed.focus()
  }

  async function copyLines() {
    const ed = editor()
    const tab = currentTab()
    if (!ed || !tab) return
    const set = bookmarksOf(tab)
    if (set.size === 0) return
    const sorted = [...set].sort((a, b) => a - b)
    const lines = sorted.map((l) => tab.model.getLineContent(l))
    await navigator.clipboard.writeText(lines.join('\n'))
    ctx.status.set('bookmark', `已复制 ${sorted.length} 个书签行`)
  }

  function clearAll() {
    const tab = currentTab()
    if (!tab) return
    bookmarksOf(tab).clear()
    render()
  }

  /* ==================== 命令注册 ==================== */

  commandBus.register('bookmark.toggle', { label: '切换书签', run: () => toggle() })
  commandBus.register('bookmark.next', { label: '下一书签', run: () => jump(true) })
  commandBus.register('bookmark.prev', { label: '上一书签', run: () => jump(false) })
  commandBus.register('bookmark.clearAll', { label: '清除全部书签', run: clearAll })
  commandBus.register('bookmark.copyLines', { label: '复制书签行', run: copyLines })

  /* ==================== 快捷键 ==================== */

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F2' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      } else if (e.key === 'F2' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        jump(true)
      } else if (e.key === 'F2' && e.shiftKey && !e.ctrlKey) {
        e.preventDefault()
        e.stopPropagation()
        jump(false)
      }
    },
    { capture: true }
  )

  /* ==================== glyph margin 点击切换书签 ==================== */

  const ed0 = ctx.tabs?.editor
  if (ed0) {
    ed0.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        toggle(e.target.position.lineNumber)
      }
    })
  }

  /* ==================== 标签切换时重绘 ==================== */

  ctx.tabs?.on('activated', render)
  ctx.tabs?.on('closed', render)
  render()
}
