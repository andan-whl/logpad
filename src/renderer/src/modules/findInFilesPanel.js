/**
 * LogPad 在文件中查找面板（任务 7）
 *
 * Ctrl+Shift+F 打开：指定目录 + 通配符（; 分隔多模式）+ 子目录/大小写/正则，
 * 后台扫描（进度显示、可取消），结果按文件分组的树形列表（行号 + 摘要 + <mark> 高亮），
 * 双击结果行在新标签打开文件并跳转到对应行整行高亮。
 * 搜索历史（目录/模式）自动记录（主进程持久化）。
 */

export function init(ctx) {
  const { commandBus, monaco } = ctx

  const host = document.getElementById('panel-findinfiles')
  if (!host) return

  let searching = false
  let resultDecor = null
  let highlightTimer = null

  /* ==================== 面板结构 ==================== */

  host.innerHTML = ''
  const panel = document.createElement('div')
  panel.className = 'panel'

  panel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">在文件中查找</span>
      <div style="display:flex;gap:6px;align-items:center;flex:1;margin-left:12px">
        <label style="color:var(--text-dim)">目录</label>
        <input id="fif-dir" type="text" list="fif-dir-history" style="width:260px" placeholder="选择或输入目录" />
        <datalist id="fif-dir-history"></datalist>
        <button class="panel-btn" id="fif-browse">浏览...</button>
        <label style="color:var(--text-dim)">文件类型</label>
        <input id="fif-glob" type="text" style="width:120px" value="*.log;*.txt" title="通配符，分号分隔多模式" />
        <label style="color:var(--text-dim)">查找</label>
        <input id="fif-pattern" type="text" list="fif-pattern-history" style="width:160px" placeholder="查找内容" />
        <datalist id="fif-pattern-history"></datalist>
        <label class="checkbox"><input type="checkbox" id="fif-recursive" checked />子目录</label>
        <label class="checkbox"><input type="checkbox" id="fif-case" />区分大小写</label>
        <label class="checkbox"><input type="checkbox" id="fif-regex" />正则</label>
        <button class="panel-btn primary" id="fif-start">查找</button>
        <button class="panel-btn" id="fif-stop" hidden>取消</button>
      </div>
      <div class="panel-actions">
        <span id="fif-status" style="color:var(--text-dim);font-size:12px"></span>
        <button class="panel-btn panel-close" id="fif-close" title="关闭面板">✕</button>
      </div>
    </div>
    <div class="panel-body" id="fif-results"></div>
  `
  host.appendChild(panel)

  const $ = (sel) => panel.querySelector(sel)
  const dirInput = $('#fif-dir')
  const globInput = $('#fif-glob')
  const patternInput = $('#fif-pattern')
  const recursiveChk = $('#fif-recursive')
  const caseChk = $('#fif-case')
  const regexChk = $('#fif-regex')
  const startBtn = $('#fif-start')
  const stopBtn = $('#fif-stop')
  const statusEl = $('#fif-status')
  const resultsEl = $('#fif-results')

  /* ==================== 历史 ==================== */

  async function loadHistory() {
    try {
      const hist = await window.api.getSearchHistory()
      $('#fif-dir-history').innerHTML = (hist.dirs || []).map((d) => `<option value="${d}">`).join('')
      $('#fif-pattern-history').innerHTML = (hist.patterns || []).map((p) => `<option value="${p}">`).join('')
      if (hist.dirs && hist.dirs[0]) dirInput.value = hist.dirs[0]
    } catch {
      /* 历史不可用时忽略 */
    }
  }
  loadHistory()

  /* ==================== 进度订阅 ==================== */

  window.api.on('search-progress', ({ scanned, matches, current }) => {
    if (searching) {
      statusEl.textContent = `已扫描 ${scanned} 个文件，匹配 ${matches} 条 — ${current}`
    }
  })

  /* ==================== 搜索执行 ==================== */

  async function startSearch() {
    if (searching) return
    const dir = dirInput.value.trim()
    const glob = globInput.value.trim() || '*'
    const pattern = patternInput.value
    if (!dir) {
      statusEl.textContent = '请指定查找目录'
      dirInput.focus()
      return
    }
    if (!pattern) {
      statusEl.textContent = '请输入查找内容'
      patternInput.focus()
      return
    }
    if (regexChk.checked) {
      try {
        new RegExp(pattern)
      } catch (err) {
        statusEl.textContent = `无效的正则表达式：${err.message}`
        patternInput.style.borderColor = 'var(--danger)'
        return
      }
    }
    patternInput.style.borderColor = ''

    searching = true
    startBtn.hidden = true
    stopBtn.hidden = false
    statusEl.textContent = '准备扫描...'
    resultsEl.innerHTML = ''
    ctx.panels.show('findinfiles')

    let res
    try {
      res = await window.api.searchInFiles({
        dir,
        glob,
        pattern,
        caseSensitive: caseChk.checked,
        regex: regexChk.checked,
        recursive: recursiveChk.checked
      })
    } catch (err) {
      statusEl.textContent = `查找失败：${err.message || err}`
      searching = false
      startBtn.hidden = false
      stopBtn.hidden = true
      return
    }

    searching = false
    startBtn.hidden = false
    stopBtn.hidden = true

    renderResults(res)
    loadHistory() // 刷新历史
  }

  function stopSearch() {
    if (searching) window.api.cancelSearch()
  }

  /* ==================== 结果渲染 ==================== */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  /** 摘要中转义后标记匹配片段（简单非正则模式用全局替换；正则模式不做片段高亮） */
  function markMatches(text, pattern, caseSensitive, regex) {
    const escaped = escapeHtml(text)
    if (!regex && pattern) {
      try {
        const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
        return escaped.replace(re, (m) => `<mark>${m}</mark>`)
      } catch {
        return escaped
      }
    }
    return escaped
  }

  function renderResults(res) {
    resultsEl.innerHTML = ''
    const { results, totalFiles, truncated } = res
    statusEl.textContent =
      `共扫描 ${totalFiles} 个文件，匹配 ${results.length} 条` + (truncated ? '（结果过多已截断）' : '')

    // 按文件分组
    const groups = new Map()
    for (const r of results) {
      if (!groups.has(r.path)) groups.set(r.path, [])
      groups.get(r.path).push(r)
    }
    if (groups.size === 0) {
      resultsEl.innerHTML = '<div style="padding:8px 10px;color:var(--text-dim)">无匹配结果</div>'
      return
    }
    for (const [path, lines] of groups) {
      const fileEl = document.createElement('div')
      fileEl.className = 'fi-file'
      fileEl.innerHTML = `<span>${escapeHtml(path)}</span><span class="fi-count">${lines.length}</span>`
      resultsEl.appendChild(fileEl)

      for (const line of lines) {
        const lineEl = document.createElement('div')
        lineEl.className = 'fi-line mono'
        lineEl.innerHTML =
          `<span class="fi-lineno">${line.line}</span>` +
          `<span class="fi-text">${markMatches(line.text, patternInput.value, caseChk.checked, regexChk.checked)}</span>`
        lineEl.addEventListener('dblclick', () => locate(path, line.line))
        lineEl.title = '双击打开并定位'
        resultsEl.appendChild(lineEl)
      }
    }
  }

  /* ==================== 定位（双击结果） ==================== */

  async function locate(path, line) {
    const tab = await ctx.tabs.openFile(path)
    if (!tab) return
    const ed = ctx.tabs.editor
    // openFile 返回 tab；若已是活动标签则 editor 可直接操作
    const model = tab.model
    ed.setModel(model)
    const safeLine = Math.min(line, model.getLineCount())
    ed.revealLineInCenter(safeLine)
    ed.setPosition({ lineNumber: safeLine, column: model.getLineMaxColumn(safeLine) > 1 ? 1 : 1 })
    ed.focus()
    // 整行高亮 2 秒
    if (resultDecor) resultDecor.clear()
    resultDecor = ed.createDecorationsCollection([
      {
        range: new monaco.Range(safeLine, 1, safeLine, 1),
        options: { isWholeLine: true, className: 'lp-line-highlight' }
      }
    ])
    clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => resultDecor?.clear(), 2000)
  }

  /* ==================== 事件绑定 ==================== */

  startBtn.addEventListener('click', startSearch)
  stopBtn.addEventListener('click', stopSearch)
  $('#fif-close').addEventListener('click', () => ctx.panels.hide('findinfiles'))
  $('#fif-browse').addEventListener('click', async () => {
    const dir = await window.api.openDirectoryDialog()
    if (dir) dirInput.value = dir
  })
  patternInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      startSearch()
    }
  })

  /* 面板打开时聚焦查找内容（保持上次目录/模式） */
  commandBus.register('panel.findinfiles.show', {
    label: '在文件中查找（聚焦）',
    run: () => {
      ctx.panels.show('findinfiles')
      patternInput.focus()
    }
  })
}
