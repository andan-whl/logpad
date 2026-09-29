/**
 * LogPad 视图控制（任务 12）
 *
 * 缩放：Ctrl+滚轮 / Ctrl+Num +/−/0 / 菜单重置（10-40px，状态栏百分比，持久化）。
 * 显示选项（全部持久化）：自动换行 / 显示空白字符 / 显示行尾符（视口行尾 ¶ 装饰）/
 * 显示行号。全屏 F11。
 * 大文件模式联动（任务 13）：大文件标签自动关闭"显示行尾符"装饰。
 */

export function init(ctx) {
  const { commandBus } = ctx

  const ed = ctx.tabs?.editor

  /* ==================== 缩放 ==================== */

  function getZoom() {
    return Math.round((ctx.settings.fontSize / 14) * 100)
  }

  function applyFont(delta, absolute) {
    const cur = ctx.settings.fontSize
    const next = absolute ?? Math.max(10, Math.min(40, cur + delta))
    if (next === cur && absolute === undefined) return
    ctx.settings.fontSize = next
    ed?.updateOptions({ fontSize: next })
    ctx.status.set('zoom', `${getZoom()}%`)
    window.api.saveSettings({ fontSize: next })
  }

  commandBus.register('view.zoomIn', { label: '放大', run: () => applyFont(1) })
  commandBus.register('view.zoomOut', { label: '缩小', run: () => applyFont(-1) })
  commandBus.register('view.zoomReset', { label: '重置缩放', run: () => applyFont(0, 14) })

  // Ctrl+滚轮
  const dom = ed?.getDomNode?.()
  if (dom) {
    dom.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          applyFont(e.deltaY < 0 ? 1 : -1)
        }
      },
      { passive: false }
    )
  }

  // Ctrl+Num+/−/0 与 F11
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'F11') {
        e.preventDefault()
        commandBus.execute('view.fullscreen')
        return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.code === 'NumpadAdd' || (e.key === '=' && !e.shiftKey)) {
        e.preventDefault()
        applyFont(1)
      } else if (e.code === 'NumpadSubtract' || e.key === '-') {
        e.preventDefault()
        applyFont(-1)
      } else if (e.code === 'Numpad0' || (e.key === '0' && !e.shiftKey)) {
        e.preventDefault()
        applyFont(0, 14)
      }
    },
    { capture: true }
  )

  /* ==================== 显示选项 toggle ==================== */

  function syncChecks() {
    commandBus.setChecked('view.wordWrap', !!ctx.settings.wordWrap)
    commandBus.setChecked('view.whitespace', !!ctx.settings.showWhitespace)
    commandBus.setChecked('view.eol', !!ctx.settings.showEol)
    commandBus.setChecked('view.lineNumbers', !!ctx.settings.lineNumbers)
  }

  function applyViewOptions() {
    ed?.updateOptions({
      wordWrap: ctx.settings.wordWrap ? 'on' : 'off',
      wordWrapMinified: true, // 长行文件（日志整行 JSON/堆栈）也强制换行，避免开关"时灵时不灵"
      renderWhitespace: ctx.settings.showWhitespace ? 'all' : 'none',
      lineNumbers: ctx.settings.lineNumbers ? 'on' : 'off'
    })
    // 与正文换行状态同步：底部搜索结果面板通过该标记联动（一个开关管两处）
    document.documentElement.dataset.wrap = ctx.settings.wordWrap ? 'on' : 'off'
    renderEolMarks()
    syncChecks()
  }

  commandBus.register('view.wordWrap', {
    label: '自动换行',
    run: () => {
      ctx.settings.wordWrap = !ctx.settings.wordWrap
      window.api.saveSettings({ wordWrap: ctx.settings.wordWrap })
      applyViewOptions()
    }
  })

  commandBus.register('view.whitespace', {
    label: '显示空白字符',
    run: () => {
      ctx.settings.showWhitespace = !ctx.settings.showWhitespace
      window.api.saveSettings({ showWhitespace: ctx.settings.showWhitespace })
      applyViewOptions()
    }
  })

  commandBus.register('view.eol', {
    label: '显示行尾符',
    run: () => {
      ctx.settings.showEol = !ctx.settings.showEol
      window.api.saveSettings({ showEol: ctx.settings.showEol })
      applyViewOptions()
    }
  })

  commandBus.register('view.lineNumbers', {
    label: '显示行号',
    run: () => {
      ctx.settings.lineNumbers = !ctx.settings.lineNumbers
      window.api.saveSettings({ lineNumbers: ctx.settings.lineNumbers })
      applyViewOptions()
    }
  })

  /* ==================== 全屏 ==================== */

  commandBus.register('view.fullscreen', {
    label: '全屏',
    run: async () => {
      await window.api.toggleFullscreen()
      const on = await window.api.isFullscreen()
      commandBus.setChecked('view.fullscreen', on)
    }
  })

  // 首选项保存后刷新所有 toggle 勾选态（任务 14 联动）
  commandBus.register('view.refreshChecks', {
    label: '刷新视图选项状态',
    run: () => {
      applyViewOptions()
    }
  })

  /* ==================== 行尾符显示（视口 ¶ 装饰） ==================== */

  const EOL_CLS = 'lp-eol-mark'
  const style = document.createElement('style')
  style.textContent = `.lp-eol-mark::after { content: '¶'; color: var(--text-dim); opacity: .6; font-size: .85em; }`
  document.head.appendChild(style)

  let eolDecor = null
  let eolTimer = null

  function renderEolMarks() {
    if (!ed) return
    const tab = ctx.tabs?.getActive()
    // 大文件模式禁用重装饰（任务 13）
    if (!ctx.settings.showEol || !tab || tab.large || tab.filterState) {
      eolDecor?.clear()
      return
    }
    const model = ed.getModel()
    if (!model) return
    // 视口范围 + 前后各 5 行缓冲
    const layout = ed.getLayoutInfo()
    const start = Math.max(1, ed.getScrollTop() / 19 - 5)
    const visible = layout.height / 19 + 10
    const end = Math.min(model.getLineCount(), Math.ceil(start + visible))
    const decos = []
    for (let l = Math.max(1, Math.floor(start)); l <= end; l++) {
      decos.push({
        range: new ctx.monaco.Range(l, model.getLineMaxColumn(l), l, model.getLineMaxColumn(l)),
        options: { className: EOL_CLS }
      })
    }
    if (!eolDecor) eolDecor = ed.createDecorationsCollection([])
    eolDecor.set(decos)
  }

  // 滚动/内容/换行变化时重绘（节流 150ms）
  function scheduleEol() {
    if (!ctx.settings.showEol) return
    clearTimeout(eolTimer)
    eolTimer = setTimeout(renderEolMarks, 150)
  }

  if (ed) {
    ed.onDidScrollChange(scheduleEol)
    ed.onDidChangeModelContent(scheduleEol)
    ed.onDidChangeModel(() => setTimeout(renderEolMarks, 0))
  }

  /* ==================== 标签切换联动 ==================== */

  ctx.tabs?.on('activated', (tab) => {
    // 大文件模式提示 + 行尾装饰刷新
    ctx.status.set('large', tab.large ? '大文件模式' : null)
    renderEolMarks()
  })

  // 启动时应用设置（settings 由 tabs.js 启动流程异步加载后写入 ctx.settings）
  const origLoad = () => applyViewOptions()
  ctx.tabs?.on('activated', origLoad)
  applyViewOptions()
  ctx.status.set('zoom', `${getZoom()}%`)
}
