/**
 * LogPad 跳转到行（任务 6）
 *
 * Ctrl+G 打开对话框：显示当前行 / 总行数，输入行号跳转（非法输入红框提示），
 * 跳转后整行高亮 2 秒（行高亮样式由本模块注入，自包含）。
 */

export function init(ctx) {
  const { commandBus, monaco } = ctx

  // 整行高亮样式（跳转/书签定位共用视觉）
  const style = document.createElement('style')
  style.textContent = `.lp-line-highlight { background: var(--bg-active); outline: 1px solid var(--accent); }`
  document.head.appendChild(style)

  let dialog = null
  let highlight = null
  let highlightTimer = null

  function editor() {
    return ctx.tabs?.editor
  }

  function currentModel() {
    return ctx.tabs?.getActiveModel()
  }

  function open() {
    const model = currentModel()
    if (!model) return
    close()

    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop'
    dialog = backdrop

    const modal = document.createElement('div')
    modal.className = 'modal'

    const curLine = editor().getPosition()?.lineNumber ?? 1
    const total = model.getLineCount()

    modal.innerHTML = `
      <div class="modal-title">跳转到行</div>
      <div class="modal-body">
        <div style="margin-bottom:8px;color:var(--text-dim)">
          当前行：<span id="goto-cur">${curLine}</span> &nbsp;/&nbsp; 总行数：<span id="goto-total">${total}</span>
        </div>
        <input id="goto-input" type="number" min="1" max="${total}" value="${curLine}"
               style="width:100%" placeholder="行号 (1 - ${total})" />
        <div id="goto-error" style="color:var(--danger);font-size:12px;height:16px;margin-top:4px"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="goto-cancel">取消</button>
        <button class="btn btn-primary" id="goto-ok">跳转</button>
      </div>
    `
    backdrop.appendChild(modal)
    document.getElementById('overlay-layer').appendChild(backdrop)

    const input = modal.querySelector('#goto-input')
    const err = modal.querySelector('#goto-error')
    input.focus()
    input.select()

    const cancel = () => close()
    modal.querySelector('#goto-cancel').addEventListener('click', cancel)
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) cancel()
    })

    const jump = () => {
      const raw = input.value.trim()
      const line = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isInteger(line) || line < 1 || line > total) {
        err.textContent = `请输入 1 - ${total} 之间的整数`
        input.style.borderColor = 'var(--danger)'
        input.focus()
        return
      }
      close()
      doJump(line)
    }
    modal.querySelector('#goto-ok').addEventListener('click', jump)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        jump()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    })
  }

  function doJump(line) {
    const ed = editor()
    const model = currentModel()
    if (!ed || !model) return
    ed.revealLineInCenter(line)
    ed.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) > 1 ? 1 : 1 })
    ed.focus()
    // 整行高亮 2 秒
    if (highlight) highlight.clear()
    highlight = ed.createDecorationsCollection([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: 'lp-line-highlight' }
      }
    ])
    clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => highlight?.clear(), 2000)
  }

  function close() {
    if (dialog) {
      dialog.remove()
      dialog = null
    }
  }

  commandBus.register('search.goto', { label: '跳转到行', run: open })

  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        commandBus.execute('search.goto')
      }
    },
    { capture: true }
  )
}
