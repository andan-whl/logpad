/**
 * LogPad 行操作（任务 8）
 *
 * Notepad++ 式行操作（均进入撤销栈）：
 *   Ctrl+D 复制当前行 | Ctrl+L 删除当前行 | Ctrl+Shift+↑/↓ 上下移动行
 *   删除空行 | 去除行尾空白（全文批量，一次撤销）| 大小写转换（选中或当前行）
 */

export function init(ctx) {
  const { commandBus } = ctx

  function editor() {
    return ctx.tabs?.editor
  }

  function runAction(id) {
    const ed = editor()
    if (!ed) return
    ed.focus()
    ed.getAction(id)?.run()
  }

  /** 当前行（无选中时）或选区覆盖的行范围 [start, end] */
  function lineRange(ed) {
    const sel = ed.getSelection()
    const model = ed.getModel()
    const start = sel.startLineNumber
    const end = sel.endLineNumber
    return { start, end, model }
  }

  /* ==================== 单行操作 ==================== */

  // Ctrl+D：复制当前行（Monaco copyLinesDownAction，默认绑定 Ctrl+Shift+D，改为 Notepad++ 的 Ctrl+D）
  commandBus.register('edit.duplicateLine', {
    label: '复制当前行',
    run: () => runAction('editor.action.copyLinesDownAction')
  })

  // Ctrl+L：删除当前行（Monaco deleteLines，VSCode 绑定 Ctrl+Shift+K）
  commandBus.register('edit.deleteLine', {
    label: '删除当前行',
    run: () => runAction('editor.action.deleteLines')
  })

  commandBus.register('edit.moveLineUp', {
    label: '上移当前行',
    run: () => runAction('editor.action.moveLinesUpAction')
  })

  commandBus.register('edit.moveLineDown', {
    label: '下移当前行',
    run: () => runAction('editor.action.moveLinesDownAction')
  })

  /* ==================== 全文批量操作（一次撤销） ==================== */

  /** 删除空行：仅含空白字符的行整行删除 */
  commandBus.register('edit.removeEmptyLines', {
    label: '删除空行',
    run: () => {
      const ed = editor()
      const model = ed?.getModel()
      if (!ed || !model) return
      const edits = []
      const total = model.getLineCount()
      for (let l = 1; l <= total; l++) {
        if (model.getLineContent(l).trim() === '') {
          const endLine = Math.min(l + 1, total)
          const endCol = endLine === l ? model.getLineMaxColumn(l) : 1
          edits.push({ range: new ctx.monaco.Range(l, 1, endLine, endCol), text: null })
        }
      }
      if (edits.length) model.pushEditOperations([], edits, () => null)
    }
  })

  /** 去除行尾空白：[ \t]+$ 清除 */
  commandBus.register('edit.trimTrailing', {
    label: '去除行尾空白',
    run: () => {
      const ed = editor()
      const model = ed?.getModel()
      if (!ed || !model) return
      const edits = []
      const total = model.getLineCount()
      for (let l = 1; l <= total; l++) {
        const content = model.getLineContent(l)
        const m = content.match(/[ \t]+$/)
        if (m) {
          edits.push({
            range: new ctx.monaco.Range(l, content.length - m[0].length + 1, l, content.length + 1),
            text: null
          })
        }
      }
      if (edits.length) model.pushEditOperations([], edits, () => null)
    }
  })

  /* ==================== 大小写转换（选中或当前行） ==================== */

  function transformCase(upper) {
    const ed = editor()
    const model = ed?.getModel()
    if (!ed || !model) return
    const sel = ed.getSelection()
    let range
    if (sel.isEmpty()) {
      // 无选中：作用于当前行
      const line = sel.startLineNumber
      range = new ctx.monaco.Range(line, 1, line, model.getLineMaxColumn(line))
    } else {
      range = sel
    }
    const text = model.getValueInRange(range)
    const converted = upper ? text.toUpperCase() : text.toLowerCase()
    if (converted !== text) {
      model.pushEditOperations([], [{ range, text: converted }], () => null)
    }
  }

  commandBus.register('edit.upperCase', { label: '转为大写', run: () => transformCase(true) })
  commandBus.register('edit.lowerCase', { label: '转为小写', run: () => transformCase(false) })

  /* ==================== 快捷键（capture + stopPropagation 覆盖 Monaco 内置） ==================== */

  window.addEventListener(
    'keydown',
    (e) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'd' && !e.shiftKey && !e.altKey) {
        // 覆盖 Monaco 内置 Ctrl+D（多光标添加下一个匹配）
        e.preventDefault()
        e.stopPropagation()
        commandBus.execute('edit.duplicateLine')
      } else if (key === 'l' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        commandBus.execute('edit.deleteLine')
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        commandBus.execute('edit.moveLineUp')
      } else if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        commandBus.execute('edit.moveLineDown')
      }
    },
    { capture: true }
  )
}
