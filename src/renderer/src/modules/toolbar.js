/**
 * LogPad 工具栏（任务 5）
 *
 * 分组按钮：文件（新建/打开/保存/全部保存）| 关闭（关闭/全部关闭）|
 * 历史（撤销/重做）| 编辑（剪切/复制/粘贴）| 搜索（查找/替换/在文件中查找）|
 * 视图（换行/空白/跟随尾部 toggle）| 面板（过滤/设置）
 * 按钮状态经 commandBus 实时联动（enabled → 禁用态，checked → .active 高亮）。
 */

import { icon } from '../icons.js'

export function init(ctx) {
  const { commandBus } = ctx
  const toolbar = document.getElementById('toolbar')

  const GROUPS = [
    [
      { cmd: 'file.new', icon: 'new', tip: '新建 (Ctrl+N)' },
      { cmd: 'file.open', icon: 'open', tip: '打开 (Ctrl+O)' },
      { cmd: 'file.save', icon: 'save', tip: '保存 (Ctrl+S)' },
      { cmd: 'file.saveAll', icon: 'save-all', tip: '全部保存' }
    ],
    [
      { cmd: 'file.close', icon: 'close', tip: '关闭标签 (Ctrl+W)' },
      { cmd: 'file.closeAll', icon: 'close-all', tip: '关闭所有标签 (Ctrl+Shift+W)' }
    ],
    [
      { cmd: 'edit.undo', icon: 'undo', tip: '撤销 (Ctrl+Z)' },
      { cmd: 'edit.redo', icon: 'redo', tip: '重做 (Ctrl+Y)' }
    ],
    [
      { cmd: 'edit.cut', icon: 'cut', tip: '剪切 (Ctrl+X)' },
      { cmd: 'edit.copy', icon: 'copy', tip: '复制 (Ctrl+C)' },
      { cmd: 'edit.paste', icon: 'paste', tip: '粘贴 (Ctrl+V)' }
    ],
    [
      { cmd: 'search.find', icon: 'find', tip: '查找 (Ctrl+F)' },
      { cmd: 'search.replace', icon: 'replace', tip: '替换 (Ctrl+H)' },
      { cmd: 'panel.findinfiles', icon: 'find-in-files', tip: '在文件中查找 (Ctrl+Shift+F)' }
    ],
    [
      { cmd: 'view.wordWrap', icon: 'word-wrap', tip: '自动换行', toggle: true },
      { cmd: 'view.whitespace', icon: 'whitespace', tip: '显示空白字符', toggle: true },
      { cmd: 'follow.toggle', icon: 'follow-tail', tip: '跟随尾部 (Ctrl+Alt+T)', toggle: true }
    ],
    [
      { cmd: 'panel.filter', icon: 'filter', tip: '日志过滤 (Ctrl+Shift+L)' },
      { cmd: 'preferences.open', icon: 'settings', tip: '首选项' }
    ]
  ]

  toolbar.innerHTML = ''
  const buttons = []

  GROUPS.forEach((group, gi) => {
    const g = document.createElement('div')
    g.className = 'toolbar-group'
    for (const def of group) {
      const btn = document.createElement('button')
      btn.className = 'toolbar-btn'
      btn.title = def.tip
      btn.innerHTML = icon(def.icon)
      btn.addEventListener('click', () => {
        commandBus.execute(def.cmd)
        refresh() // 立即刷新 toggle 高亮
      })
      g.appendChild(btn)
      buttons.push({ def, btn })
    }
    toolbar.appendChild(g)
    if (gi < GROUPS.length - 1) {
      const sep = document.createElement('div')
      sep.className = 'toolbar-sep'
      toolbar.appendChild(sep)
    }
  })

  function refresh() {
    for (const { def, btn } of buttons) {
      const c = commandBus.get(def.cmd)
      btn.disabled = !c || !c.enabled
      btn.classList.toggle('active', !!c && !!c.checked)
    }
  }

  // 命令状态可能被各模块在任意时刻修改（setChecked/setEnabled），
  // commandBus 无事件机制（main.js 冻结），轻量轮询保持联动
  setInterval(refresh, 500)
  // 标签切换时立即刷新（文件类命令可用性变化）
  ctx.tabs?.on('activated', refresh)
  ctx.tabs?.on('closed', refresh)
  ctx.tabs?.on('dirty-changed', refresh)
  refresh()
}
