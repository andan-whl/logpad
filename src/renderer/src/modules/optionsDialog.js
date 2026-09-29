/**
 * LogPad 首选项对话框（任务 14）
 *
 * 设置 → 首选项：主题 / 字号 / 显示选项（换行、空白、行尾符、行号）/
 * 自动重载模式 / 大文件阈值 / 跟随尾部默认。保存即生效并持久化（userData
 * settings.json），重启后由 tabs.js 启动流程恢复。
 */

import { switchTheme, THEME_NAMES } from '../themes.js'

export function init(ctx) {
  const { commandBus } = ctx

  let dialog = null

  function open() {
    close()
    const s = { ...ctx.settings }

    const backdrop = document.createElement('div')
    backdrop.className = 'modal-backdrop'
    dialog = backdrop

    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.style.minWidth = '460px'

    modal.innerHTML = `
      <div class="modal-title">首选项</div>
      <div class="modal-body">
        <div class="pref-grid">
          <label>主题</label>
          <select id="pref-theme">
            <option value="dark">${THEME_NAMES.dark}</option>
            <option value="light">${THEME_NAMES.light}</option>
          </select>

          <label>字号（10 - 40）</label>
          <input id="pref-font" type="number" min="10" max="40" step="1" />

          <label>自动换行</label>
          <input id="pref-wrap" type="checkbox" />

          <label>显示空白字符</label>
          <input id="pref-ws" type="checkbox" />

          <label>显示行尾符</label>
          <input id="pref-eol" type="checkbox" />

          <label>显示行号</label>
          <input id="pref-ln" type="checkbox" />

          <label>自动重载</label>
          <select id="pref-reload">
            <option value="auto">自动（未修改时静默重载）</option>
            <option value="off">关闭（忽略外部修改）</option>
          </select>

          <label>大文件阈值（MB）</label>
          <input id="pref-threshold" type="number" min="1" max="2048" step="1" />

          <label>打开日志默认跟随尾部</label>
          <input id="pref-follow" type="checkbox" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="pref-cancel">取消</button>
        <button class="btn btn-primary" id="pref-ok">保存</button>
      </div>
    `
    backdrop.appendChild(modal)
    document.getElementById('overlay-layer').appendChild(backdrop)

    // 首选项网格样式（模块自包含）
    if (!document.getElementById('pref-grid-style')) {
      const st = document.createElement('style')
      st.id = 'pref-grid-style'
      st.textContent = `
        .pref-grid { display: grid; grid-template-columns: 150px 1fr; gap: 10px 12px; align-items: center; }
        .pref-grid label { color: var(--text-dim); }
      `
      document.head.appendChild(st)
    }

    const $ = (sel) => modal.querySelector(sel)
    $('#pref-theme').value = s.theme === 'light' ? 'light' : 'dark'
    $('#pref-font').value = s.fontSize
    $('#pref-wrap').checked = !!s.wordWrap
    $('#pref-ws').checked = !!s.showWhitespace
    $('#pref-eol').checked = !!s.showEol
    $('#pref-ln').checked = !!s.lineNumbers
    $('#pref-reload').value = s.autoReload === 'off' ? 'off' : 'auto'
    $('#pref-threshold').value = s.largeFileThresholdMB
    $('#pref-follow').checked = !!s.followTailDefault

    $('#pref-cancel').addEventListener('click', close)
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close()
    })

    $('#pref-ok').addEventListener('click', async () => {
      const font = Math.max(10, Math.min(40, Number($('#pref-font').value) || 14))
      const threshold = Math.max(1, Math.min(2048, Number($('#pref-threshold').value) || 20))
      const next = {
        theme: $('#pref-theme').value,
        fontSize: font,
        wordWrap: $('#pref-wrap').checked,
        showWhitespace: $('#pref-ws').checked,
        showEol: $('#pref-eol').checked,
        lineNumbers: $('#pref-ln').checked,
        autoReload: $('#pref-reload').value,
        largeFileThresholdMB: threshold,
        followTailDefault: $('#pref-follow').checked
      }
      Object.assign(ctx.settings, next)
      try {
        await window.api.saveSettings(next)
      } catch {
        /* 持久化失败不阻断界面应用 */
      }
      // 即时生效
      switchTheme(ctx.monaco, next.theme)
      ctx.tabs?.editor.updateOptions({
        fontSize: next.fontSize,
        wordWrap: next.wordWrap ? 'on' : 'off',
        wordWrapMinified: true, // 长行文件也换行（与 viewControls/tabs 保持一致）
        renderWhitespace: next.showWhitespace ? 'all' : 'none',
        lineNumbers: next.lineNumbers ? 'on' : 'off'
      })
      // 搜索结果面板换行状态联动（同一开关管正文与结果两处）
      document.documentElement.dataset.wrap = next.wordWrap ? 'on' : 'off'
      commandBus.execute('view.refreshChecks')
      close()
    })
  }

  function close() {
    if (dialog) {
      dialog.remove()
      dialog = null
    }
  }

  commandBus.register('preferences.open', { label: '首选项', run: open })
}
