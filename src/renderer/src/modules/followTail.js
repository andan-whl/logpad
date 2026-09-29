/**
 * LogPad 跟随尾部与自动重载（任务 11）
 *
 * 跟随尾部（tail -f）：Ctrl+Alt+T 开关；文件追加内容自动加载并滚动到底；
 * 用户向上滚动时智能暂停并显示"回到底部（继续跟随）"悬浮按钮。
 *
 * 自动重载：监视所有打开标签的 file-event——
 *   appended（未跟随时）：未修改 → 增量加载且保持光标；已修改 → 弹窗（是=重载丢弃，
 *     否=保留本地版本且该文件后续事件静默忽略直至恢复干净）
 *   truncated（日志轮转/变小）：全量重载
 *   removed：状态栏提示
 */

export function init(ctx) {
  const { commandBus, monaco } = ctx

  const followState = new Map() // tabId -> { on, paused, dismissed }
  const scrollLock = new Map() // tabId -> 程序滚动标志（避免误判用户上滚）
  let floatBtn = null

  function editor() {
    return ctx.tabs?.editor
  }

  function tabIdOf(tab) {
    return tab.id
  }

  function stateOf(tab, create = true) {
    let st = followState.get(tab.id)
    if (!st && create) {
      st = { on: false, paused: false, dismissed: false }
      followState.set(tab.id, st)
    }
    return st
  }

  /* ==================== 悬浮"回到底部"按钮 ==================== */

  function showFloatBtn() {
    if (floatBtn) return
    floatBtn = document.createElement('button')
    floatBtn.className = 'float-btn'
    floatBtn.innerHTML = `<span class="float-btn-icon">↓</span> 回到底部（继续跟随）`
    floatBtn.addEventListener('click', () => {
      const tab = ctx.tabs?.getActive()
      const st = tab && stateOf(tab, false)
      if (tab && st) {
        st.paused = false
        revealBottom()
        hideFloatBtn()
        syncStatus(tab)
      }
    })
    document.body.appendChild(floatBtn)
  }

  function hideFloatBtn() {
    if (floatBtn) {
      floatBtn.remove()
      floatBtn = null
    }
  }

  function revealBottom() {
    const ed = editor()
    if (!ed) return
    const model = ed.getModel()
    if (!model) return
    const tab = ctx.tabs?.getActive()
    if (tab) scrollLock.set(tab.id, true)
    ed.revealLine(model.getLineCount(), monaco.editor.ScrollType.Immediate)
    setTimeout(() => tab && scrollLock.delete(tab.id), 120)
  }

  /* ==================== 跟随尾部命令 ==================== */

  commandBus.register('follow.toggle', {
    label: '跟随尾部',
    run: () => {
      const tab = ctx.tabs?.getActive()
      if (!tab) return
      const st = stateOf(tab)
      st.on = !st.on
      st.paused = false
      st.dismissed = false
      commandBus.setChecked('follow.toggle', st.on)
      if (st.on) revealBottom()
      else hideFloatBtn()
      syncStatus(tab)
    }
  })

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        e.stopPropagation()
        commandBus.execute('follow.toggle')
      }
    },
    { capture: true }
  )

  function syncStatus(tab) {
    const st = tab ? stateOf(tab, false) : null
    if (st && st.on) {
      ctx.status.set('follow', st.paused ? '跟随已暂停' : '● 跟随中')
    } else {
      ctx.status.set('follow', null)
    }
    if (st && st.on) commandBus.setChecked('follow.toggle', true)
    else commandBus.setChecked('follow.toggle', false)
  }

  /* ==================== 用户滚动检测（智能暂停） ==================== */

  const ed = ctx.tabs?.editor
  if (ed) {
    ed.onDidScrollChange(() => {
      const tab = ctx.tabs?.getActive()
      if (!tab) return
      const st = stateOf(tab, false)
      if (!st || !st.on || st.paused) return
      if (scrollLock.get(tab.id)) return // 程序滚动
      // 用户向上滚动：距底超过约 3 行高即暂停
      const layout = ed.getLayoutInfo()
      const dist = ed.getScrollHeight() - ed.getScrollTop() - layout.height
      if (dist > 3 * 19) {
        st.paused = true
        showFloatBtn()
        syncStatus(tab)
      }
    })
  }

  /* ==================== file-event 处理（追加 / 轮转 / 消失） ==================== */

  window.api.on('file-event', (ev) => {
    const tab = ctx.tabs?.findTabByPath(ev.path)
    if (!tab) return
    const st = stateOf(tab)

    if (ev.type === 'appended' && ev.chunk) {
      // 自动重载关闭：忽略外部追加（首选项设置，任务 14）
      if (ctx.settings.autoReload === 'off') return

      // 已修改且用户选择保留：静默忽略
      if (st.dismissed && tab.dirty) return

      if (tab.dirty) {
        // 修改冲突：弹窗询问（一次性，选"否"后静默）
        window.api
          .showMessageBox({
            type: 'warning',
            message: '文件已在磁盘上被修改',
            detail: `${ev.path}\n\n是否丢弃本地更改并重新加载？`,
            buttons: ['是（重新加载）', '否（保留本地版本）'],
            defaultId: 1,
            cancelId: 1
          })
          .then((res) => {
            if (res.response === 0) {
              ctx.tabs.reloadTab(tab.id)
              st.dismissed = false
            } else {
              st.dismissed = true
            }
          })
        return
      }

      appendChunk(tab, ev.chunk)
      return
    }

    if (ev.type === 'truncated') {
      // 日志轮转/文件变小：全量重载（未修改时；已修改弹窗同上）
      if (tab.dirty) {
        if (st.dismissed) return
        window.api
          .showMessageBox({
            type: 'warning',
            message: '文件已变小（可能发生日志轮转）',
            detail: `${ev.path}\n\n是否丢弃本地更改并重新加载？`,
            buttons: ['是（重新加载）', '否（保留本地版本）'],
            defaultId: 1,
            cancelId: 1
          })
          .then((res) => {
            if (res.response === 0) {
              ctx.tabs.reloadTab(tab.id)
              st.dismissed = false
            } else {
              st.dismissed = true
            }
          })
        return
      }
      ctx.tabs.reloadTab(tab.id)
      return
    }

    if (ev.type === 'removed') {
      ctx.status.set('follow', `文件已被删除或移动：${tab.name}`)
    }
  })

  /** 增量追加内容到 model（进入撤销栈，一次撤销可回退） */
  function appendChunk(tab, chunk) {
    const ed = editor()
    const model = tab.model
    const wasAtEnd = true // 追加场景默认按末尾处理光标
    const last = model.getLineCount()
    const lastCol = model.getLineMaxColumn(last)
    model.pushEditOperations(
      [],
      [
        {
          range: new monaco.Range(last, lastCol, last, lastCol),
          text: (lastCol > 1 || last > 1 ? '' : '') + chunk
        }
      ],
      () => null
    )
    // 跟随开启且未暂停 → 滚到底；否则保持视口
    const st = stateOf(tab, false)
    if (st && st.on && !st.paused && ed && ctx.tabs?.getActive()?.id === tab.id) {
      revealBottom()
    }
    if (wasAtEnd) {
      // 状态栏行数更新（任务 12 监听 model 变化亦可）
      ctx.status.set('lines', `${model.getLineCount()}`)
    }
  }

  /* ==================== 标签事件联动 ==================== */

  ctx.tabs?.on('activated', (tab) => {
    const st = stateOf(tab, false)
    commandBus.setChecked('follow.toggle', !!(st && st.on))
    hideFloatBtn()
    syncStatus(tab)
  })

  ctx.tabs?.on('closed', (tab) => {
    followState.delete(tab.id)
    scrollLock.delete(tab.id)
  })

  // 首次打开的日志文件默认开启跟随（settings.followTailDefault，v1 默认关闭）
  ctx.tabs?.on('opened', (tab) => {
    if (ctx.settings.followTailDefault && tab.path && !tab.large) {
      const st = stateOf(tab)
      st.on = true
      commandBus.setChecked('follow.toggle', true)
      syncStatus(tab)
    }
  })
}
