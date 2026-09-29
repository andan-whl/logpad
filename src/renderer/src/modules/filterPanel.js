/**
 * LogPad 日志级别过滤面板（任务 10）
 *
 * Ctrl+Shift+L 打开：级别多选 chips（TRACE/DEBUG/INFO/WARN/ERROR/FATAL）、
 * 关键字（支持正则）、排除模式（关键字反选）。过滤后编辑区显示过滤视图
 * （只读副本 model），行号栏显示原始行号（lineNumbers 回调映射），
 * 面板显示"显示 N / M 行"。清除过滤恢复全文（原 model 未动，
 * 书签/撤销/光标状态天然保留在原 model 与 tab.viewState 上）。
 *
 * 关键设计：tab.model 始终是原始内容（保存/监视/书签不受过滤影响）；
 * 过滤视图是独立的 filteredModel，激活时替换编辑器显示并在切走时还原。
 */

export function init(ctx) {
  const { commandBus } = ctx

  const host = document.getElementById('panel-filter')
  if (!host) return

  const LEVELS = [
    { id: 'fatal', label: 'FATAL' },
    { id: 'error', label: 'ERROR' },
    { id: 'warn', label: 'WARN' },
    { id: 'info', label: 'INFO' },
    { id: 'debug', label: 'DEBUG' },
    { id: 'trace', label: 'TRACE' }
  ]
  // 级别词匹配（大小写不敏感、支持 WARNING 变体）
  const LEVEL_RE = {
    fatal: /\bfatal\b/i,
    error: /\berror\b/i,
    warn: /\bwarn(?:ing)?\b/i,
    info: /\binfo\b/i,
    debug: /\bdebug\b/i,
    trace: /\btrace\b/i
  }

  let chips = new Map() // levelId -> chip element
  let active = false

  /* ==================== 面板结构 ==================== */

  host.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">日志过滤</span>
      <div style="display:flex;gap:8px;align-items:center;flex:1;margin-left:12px;flex-wrap:wrap">
        <span id="fl-chips" style="display:flex;gap:4px"></span>
        <span style="color:var(--text-dim)">|</span>
        <label style="color:var(--text-dim)">关键字</label>
        <input id="fl-keyword" type="text" style="width:180px" placeholder="支持正则" />
        <label class="checkbox"><input type="checkbox" id="fl-regex" />正则</label>
        <label class="checkbox"><input type="checkbox" id="fl-exclude" />排除模式（反选）</label>
        <button class="panel-btn primary" id="fl-apply">应用过滤</button>
        <button class="panel-btn" id="fl-clear">清除过滤</button>
      </div>
      <div class="panel-actions">
        <span id="fl-count" style="color:var(--text-dim);font-size:12px"></span>
        <button class="panel-btn panel-close" id="fl-close" title="关闭面板">✕</button>
      </div>
    </div>
  `
  host.appendChild(panel)

  const $ = (sel) => panel.querySelector(sel)
  const keywordInput = $('#fl-keyword')
  const regexChk = $('#fl-regex')
  const excludeChk = $('#fl-exclude')
  const countEl = $('#fl-count')

  const chipsWrap = $('#fl-chips')
  for (const lvl of LEVELS) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    chip.dataset.level = lvl.id
    chip.textContent = lvl.label
    chip.addEventListener('click', () => {
      chip.classList.toggle('on')
      applyFilter()
    })
    chipsWrap.appendChild(chip)
    chips.set(lvl.id, chip)
  }

  /* ==================== 过滤引擎 ==================== */

  function currentTab() {
    return ctx.tabs?.getActive()
  }

  function getConditions() {
    const levels = LEVELS.filter((l) => chips.get(l.id).classList.contains('on')).map((l) => l.id)
    const kw = keywordInput.value
    let kwRe = null
    if (kw) {
      try {
        kwRe = new RegExp(regexChk.checked ? kw : kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
      } catch {
        kwRe = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') // 无效正则按字面量
      }
    }
    return { levels, kwRe, exclude: excludeChk.checked }
  }

  function lineMatches(line, cond) {
    const lvlHit = cond.levels.length === 0 || cond.levels.some((id) => LEVEL_RE[id].test(line))
    if (!lvlHit) return false
    if (cond.kwRe) {
      const kwHit = cond.kwRe.test(line)
      return cond.exclude ? !kwHit : kwHit
    }
    return true
  }

  function applyFilter() {
    const tab = currentTab()
    const ed = ctx.tabs?.editor
    if (!tab || !ed) return

    const cond = getConditions()
    const noFilter = cond.levels.length === 0 && !cond.kwRe
    if (noFilter) {
      clearFilter(true)
      return
    }

    // 构建过滤视图：原行号映射 + 匹配行拼接
    const model = tab.model
    const total = model.getLineCount()
    const kept = []
    const lines = []
    for (let l = 1; l <= total; l++) {
      if (lineMatches(model.getLineContent(l), cond)) {
        kept.push(l)
        lines.push(model.getLineContent(l))
      }
    }

    // 保存原视图状态（首次进入过滤时）
    if (!tab.filterState) {
      tab.filterState = {
        savedViewState: ed.saveViewState(),
        filteredModel: null,
        lineMap: null
      }
    }
    // 释放旧过滤 model
    if (tab.filterState.filteredModel) tab.filterState.filteredModel.dispose()

    const lang = model.getLanguageId?.() || 'plaintext'
    const filteredModel = ctx.monaco.editor.createModel(lines.join('\n'), lang)
    filteredModel.updateOptions({ tabSize: model.getOptions?.().tabSize ?? 4 })

    tab.filterState.filteredModel = filteredModel
    tab.filterState.lineMap = kept

    // 行号显示原始行号
    ed.updateOptions({
      readOnly: true,
      lineNumbers: (n) => String(kept[n - 1] ?? n)
    })
    ed.setModel(filteredModel)
    active = true
    countEl.textContent = `显示 ${kept.length} / ${total} 行`
    commandBus.setChecked('panel.filter', true)
  }

  function clearFilter(keepPanel) {
    const tab = currentTab()
    const ed = ctx.tabs?.editor
    if (!tab) return
    if (tab.filterState) {
      // 还原编辑器显示与视图状态
      ed.updateOptions({ readOnly: false, lineNumbers: 'on' })
      ed.setModel(tab.model)
      if (tab.filterState.savedViewState && ctx.tabs.getActive()?.id === tab.id) {
        ed.restoreViewState(tab.filterState.savedViewState)
      }
      if (tab.filterState.filteredModel) tab.filterState.filteredModel.dispose()
      tab.filterState = null
    }
    active = false
    countEl.textContent = ''
    commandBus.setChecked('panel.filter', false)
    if (!keepPanel) {
      keywordInput.value = ''
      excludeChk.checked = false
      for (const chip of chips.values()) chip.classList.remove('on')
    }
  }

  /* ==================== 命令与快捷键 ==================== */

  commandBus.register('panel.filter', {
    label: '日志过滤',
    run: () => ctx.panels.toggle('filter')
  })

  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        e.stopPropagation()
        ctx.panels.toggle('filter')
        if (ctx.panels.isVisible('filter')) keywordInput.focus()
      }
    },
    { capture: true }
  )

  /* ==================== 事件 ==================== */

  $('#fl-apply').addEventListener('click', applyFilter)
  $('#fl-clear').addEventListener('click', () => clearFilter(false))
  $('#fl-close').addEventListener('click', () => ctx.panels.hide('filter'))
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyFilter()
    }
  })
  excludeChk.addEventListener('change', applyFilter)
  regexChk.addEventListener('change', () => {
    if (keywordInput.value) applyFilter()
  })

  // 切换标签：若新标签无过滤视图，还原编辑器选项（tabs.activate 已 setModel(原 model)）
  ctx.tabs?.on('activated', (tab) => {
    if (!tab.filterState) {
      ctx.tabs.editor.updateOptions({ readOnly: false, lineNumbers: 'on' })
      commandBus.setChecked('panel.filter', false)
    } else {
      const st = tab.filterState
      ctx.tabs.editor.updateOptions({
        readOnly: true,
        lineNumbers: (n) => String(st.lineMap?.[n - 1] ?? n)
      })
      ctx.tabs.editor.setModel(st.filteredModel)
      commandBus.setChecked('panel.filter', true)
    }
  })
}
