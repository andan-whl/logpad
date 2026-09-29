/**
 * LogPad 菜单栏（任务 5）
 *
 * 完整中文菜单：文件 / 编辑 / 搜索 / 视图 / 编码 / 设置 / 工具 / 帮助
 *  - 菜单项通过 commandBus id 连接功能模块（未注册或禁用的命令自动灰显）
 *  - 下拉内容在每次打开时动态构建，enabled/checked 状态实时反映
 *  - 最近文件子菜单从持久化记录动态生成
 *  - 本模块同时注册基础编辑命令（undo/redo/cut/copy/paste/delete/selectAll）
 *    与主题切换、编码重载/转换、退出、关于等外壳级命令
 */

import { icon } from '../icons.js'
import { switchTheme, THEME_NAMES } from '../themes.js'

export function init(ctx) {
  const { commandBus } = ctx

  const menubar = document.getElementById('menubar')
  const overlay = document.getElementById('overlay-layer')

  let openMenu = null // 当前打开的 { barItem, dropdown }
  let openedByClick = false

  /* ==================== 基础编辑命令（外壳级，Monaco trigger） ==================== */

  const reg = (id, label, run) => commandBus.register(id, { label, run })

  reg('edit.undo', '撤销', () => ctx.tabs?.editor.trigger('logpad', 'undo', null))
  reg('edit.redo', '重做', () => ctx.tabs?.editor.trigger('logpad', 'redo', null))
  reg('edit.cut', '剪切', () => ctx.tabs?.editor.trigger('logpad', 'cut', null))
  reg('edit.copy', '复制', () => {
    // 搜索结果面板等区域的鼠标选区优先复制（正文仍走编辑器复制）
    const sel = window.getSelection()
    const anchor = sel?.anchorNode
    if (sel && !sel.isCollapsed && anchor && document.getElementById('sr-body')?.contains(anchor)) {
      copyText(sel.toString())
      return
    }
    ctx.tabs?.editor.trigger('logpad', 'copy', null)
  })

  /** 写剪贴板：navigator.clipboard 优先，execCommand 兜底 */
  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  reg('edit.paste', '粘贴', () => ctx.tabs?.editor.trigger('logpad', 'paste', null))
  reg('edit.delete', '删除', () => ctx.tabs?.editor.trigger('logpad', 'delete', null))
  reg('edit.selectAll', '全选', () => ctx.tabs?.editor.trigger('logpad', 'selectAll', null))

  /* ==================== 主题切换命令 ==================== */

  reg('theme.dark', 'LogVue Dark', () => applyTheme('dark'))
  reg('theme.light', 'LogVue Light', () => applyTheme('light'))

  function applyTheme(themeId) {
    ctx.settings.theme = themeId
    switchTheme(ctx.monaco, themeId)
    window.api.saveSettings({ theme: themeId })
  }

  /* ==================== 编码命令 ==================== */

  const ENCODINGS = [
    { id: 'utf-8', label: 'UTF-8' },
    { id: 'utf-8-bom', label: 'UTF-8 (BOM)' },
    { id: 'gbk', label: 'GBK' },
    { id: 'utf-16le', label: 'UTF-16 LE' },
    { id: 'utf-16be', label: 'UTF-16 BE' }
  ]

  function activeFileTab() {
    const t = ctx.tabs?.getActive()
    return t && t.path ? t : null
  }

  for (const enc of ENCODINGS) {
    reg(`encoding.reload.${enc.id}`, `以 ${enc.label} 重新加载`, async () => {
      const t = activeFileTab()
      if (t) await ctx.tabs.reloadWithEncoding(t.id, enc.id)
    })
    reg(`encoding.convert.${enc.id}`, `转换为 ${enc.label} 并保存`, async () => {
      const t = activeFileTab()
      if (!t) return
      t.encoding = enc.id
      await ctx.tabs.saveTab(t)
      commandBus.execute('encoding.convert.done')
    })
  }
  // 编码转换完成通知（状态栏联动由任务 12 监听 tabs activated 事件实现）

  /* ==================== 退出 / 关于 ==================== */

  reg('app.quit', '退出', () => window.api.quitApp())
  reg('help.about', '关于 LogPad', async () => {
    await window.api.showMessageBox({
      type: 'info',
      title: '关于 LogPad',
      message: 'LogPad 0.1.0',
      detail:
        'Notepad++ 风格的跨平台日志查看器\n\n' +
        '特性：多标签编辑 · 日志级别高亮/过滤 · 跟随尾部\n' +
        '大文件流式加载 · GBK/UTF-8/UTF-16 编码支持\n\n' +
        '基于 Electron + Monaco Editor',
      buttons: ['确定'],
      defaultId: 0,
      cancelId: 0
    })
  })

  /* ==================== 面板命令（工具菜单） ==================== */

  reg('panel.findinfiles', '在文件中查找', () => ctx.panels.toggle('findinfiles'))
  reg('panel.filter', '日志过滤', () => ctx.panels.toggle('filter'))

  /* ==================== 菜单数据结构 ==================== */
  /* 项：{ label, cmd?, accel?, run?, checked?(), enabled?(), items?[], sep? }
     cmd 存在时：enabled/checked 取自 commandBus 实时状态 */

  const MENUS = [
    {
      label: '文件',
      items: [
        { label: '新建', cmd: 'file.new', accel: 'Ctrl+N' },
        { label: '打开...', cmd: 'file.open', accel: 'Ctrl+O' },
        { label: '打开文件夹为工作区...', cmd: 'file.openFolder' },
        { sep: true },
        { label: '保存', cmd: 'file.save', accel: 'Ctrl+S' },
        { label: '另存为...', cmd: 'file.saveAs', accel: 'Ctrl+Shift+S' },
        { label: '全部保存', cmd: 'file.saveAll' },
        { sep: true },
        { label: '关闭', cmd: 'file.close', accel: 'Ctrl+W' },
        { label: '关闭所有', cmd: 'file.closeAll', accel: 'Ctrl+Shift+W' },
        { label: '关闭其他', cmd: 'file.closeOthers' },
        { sep: true },
        { label: '最近文件', submenu: 'recent', dynamic: true },
        { sep: true },
        { label: '退出', cmd: 'app.quit', accel: 'Alt+F4' }
      ]
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', cmd: 'edit.undo', accel: 'Ctrl+Z' },
        { label: '重做', cmd: 'edit.redo', accel: 'Ctrl+Y' },
        { sep: true },
        { label: '剪切', cmd: 'edit.cut', accel: 'Ctrl+X' },
        { label: '复制', cmd: 'edit.copy', accel: 'Ctrl+C' },
        { label: '粘贴', cmd: 'edit.paste', accel: 'Ctrl+V' },
        { label: '删除', cmd: 'edit.delete', accel: 'Del' },
        { label: '全选', cmd: 'edit.selectAll', accel: 'Ctrl+A' },
        { sep: true },
        {
          label: '行操作',
          items: [
            { label: '复制当前行', cmd: 'edit.duplicateLine', accel: 'Ctrl+D' },
            { label: '删除当前行', cmd: 'edit.deleteLine', accel: 'Ctrl+L' },
            { label: '上移当前行', cmd: 'edit.moveLineUp', accel: 'Ctrl+Shift+↑' },
            { label: '下移当前行', cmd: 'edit.moveLineDown', accel: 'Ctrl+Shift+↓' },
            { sep: true },
            { label: '删除空行', cmd: 'edit.removeEmptyLines' },
            { label: '去除行尾空白', cmd: 'edit.trimTrailing' },
            { sep: true },
            { label: '转为大写', cmd: 'edit.upperCase' },
            { label: '转为小写', cmd: 'edit.lowerCase' }
          ]
        }
      ]
    },
    {
      label: '搜索',
      items: [
        { label: '查找...', cmd: 'search.find', accel: 'Ctrl+F' },
        { label: '替换...', cmd: 'search.replace', accel: 'Ctrl+H' },
        { label: '查找下一个', cmd: 'search.next', accel: 'F3' },
        { label: '查找上一个', cmd: 'search.prev', accel: 'Shift+F3' },
        { label: '查找选中词', cmd: 'search.findSelection', accel: 'Ctrl+F3' },
        { sep: true },
        { label: '在文件中查找...', cmd: 'search.inFiles', accel: 'Ctrl+Shift+F' },
        { sep: true },
        { label: '跳转到行...', cmd: 'search.goto', accel: 'Ctrl+G' },
        { sep: true },
        {
          label: '书签',
          items: [
            { label: '切换书签', cmd: 'bookmark.toggle', accel: 'Ctrl+F2' },
            { label: '下一书签', cmd: 'bookmark.next', accel: 'F2' },
            { label: '上一书签', cmd: 'bookmark.prev', accel: 'Shift+F2' },
            { sep: true },
            { label: '清除全部书签', cmd: 'bookmark.clearAll' },
            { label: '复制书签行', cmd: 'bookmark.copyLines' }
          ]
        }
      ]
    },
    {
      label: '视图',
      items: [
        {
          label: '缩放',
          items: [
            { label: '放大', cmd: 'view.zoomIn', accel: 'Ctrl+Num +' },
            { label: '缩小', cmd: 'view.zoomOut', accel: 'Ctrl+Num -' },
            { label: '重置缩放', cmd: 'view.zoomReset', accel: 'Ctrl+Num 0' }
          ]
        },
        { sep: true },
        { label: '自动换行', cmd: 'view.wordWrap', checked: true },
        { label: '显示空白字符', cmd: 'view.whitespace', checked: true },
        { label: '显示行尾符', cmd: 'view.eol', checked: true },
        { label: '显示行号', cmd: 'view.lineNumbers', checked: true },
        { sep: true },
        { label: '跟随尾部', cmd: 'follow.toggle', accel: 'Ctrl+Alt+T', checked: true },
        { label: '文件夹工作区', cmd: 'workspace.toggle', checked: true },
        { sep: true },
        { label: '全屏', cmd: 'view.fullscreen', accel: 'F11', checked: true }
      ]
    },
    {
      label: '编码',
      items: [
        { label: '以指定编码重新加载', items: ENCODINGS.map((e) => ({ label: e.label, cmd: `encoding.reload.${e.id}` })) },
        { sep: true },
        { label: '转换编码并保存', items: ENCODINGS.map((e) => ({ label: e.label, cmd: `encoding.convert.${e.id}` })) }
      ]
    },
    {
      label: '设置',
      items: [
        {
          label: '主题',
          items: [
            { label: THEME_NAMES.dark, cmd: 'theme.dark', checked: true },
            { label: THEME_NAMES.light, cmd: 'theme.light', checked: true }
          ]
        },
        { sep: true },
        { label: '首选项...', cmd: 'preferences.open' }
      ]
    },
    {
      label: '工具',
      items: [
        { label: '在文件中查找...', cmd: 'panel.findinfiles', accel: 'Ctrl+Shift+F' },
        { label: '日志过滤...', cmd: 'panel.filter', accel: 'Ctrl+Shift+L' },
        { sep: true },
        { label: '切换全屏', cmd: 'view.fullscreen', accel: 'F11' }
      ]
    },
    {
      label: '帮助',
      items: [{ label: '关于 LogPad', cmd: 'help.about' }]
    }
  ]

  /* ==================== 下拉构建 ==================== */

  function isItemEnabled(it) {
    if (it.dynamic) return true // 动态项（最近文件）自行判断
    if (typeof it.enabled === 'function') return it.enabled()
    if (it.cmd) {
      const c = commandBus.get(it.cmd)
      return !!c && c.enabled
    }
    if (it.items || it.submenu) return true
    return typeof it.run === 'function'
  }

  function isItemChecked(it) {
    if (typeof it.checked === 'function') return it.checked()
    if (it.cmd) {
      const c = commandBus.get(it.cmd)
      return !!c && c.checked
    }
    return false
  }

  function buildMenuItem(it) {
    if (it.sep) {
      const sep = document.createElement('div')
      sep.className = 'menu-sep'
      return sep
    }
    const el = document.createElement('div')
    const disabled = !isItemEnabled(it)
    el.className = 'menu-item' + (disabled ? ' disabled' : '')

    const check = document.createElement('span')
    check.className = 'menu-check'
    check.textContent = isItemChecked(it) ? '✓' : ''
    el.appendChild(check)

    if (it.icon) {
      const ic = document.createElement('span')
      ic.className = 'menu-icon'
      ic.innerHTML = icon(it.icon, 14)
      el.appendChild(ic)
    }

    const label = document.createElement('span')
    label.className = 'menu-label'
    label.textContent = it.label
    el.appendChild(label)

    if (it.accel) {
      const acc = document.createElement('span')
      acc.className = 'menu-accel'
      acc.textContent = it.accel
      el.appendChild(acc)
    }

    if (it.submenu === 'recent') {
      // 动态最近文件子菜单
      const wrap = document.createElement('div')
      wrap.className = 'menu-submenu'
      wrap.replaceChildren(el)
      const sub = document.createElement('div')
      sub.className = 'menu-dropdown'
      wrap.appendChild(sub)
      el.addEventListener('mouseenter', () => fillRecentMenu(sub))
      return wrap
    }

    if (it.items) {
      const wrap = document.createElement('div')
      wrap.className = 'menu-submenu'
      wrap.replaceChildren(el)
      const sub = document.createElement('div')
      sub.className = 'menu-dropdown'
      for (const child of it.items) sub.appendChild(buildMenuItem(child))
      wrap.appendChild(sub)
      return wrap
    }

    if (!disabled) {
      el.addEventListener('click', () => {
        closeMenu()
        if (it.cmd) commandBus.execute(it.cmd)
        else if (typeof it.run === 'function') it.run()
      })
    }
    return el
  }

  async function fillRecentMenu(sub) {
    sub.innerHTML = ''
    let recent = []
    try {
      recent = await window.api.getRecent()
    } catch {
      recent = []
    }
    if (!recent || recent.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'menu-item disabled'
      empty.innerHTML = '<span class="menu-label">（无最近文件）</span>'
      sub.appendChild(empty)
      return
    }
    for (const p of recent) {
      const it = {
        label: p.split(/[\\/]/).pop() + ' — ' + p,
        icon: 'file',
        run: () => ctx.tabs.openFile(p)
      }
      sub.appendChild(buildMenuItem(it))
    }
  }

  /* ==================== 打开 / 关闭 ==================== */

  function closeMenu() {
    if (openMenu) {
      openMenu.barItem.classList.remove('open')
      openMenu.dropdown.remove()
      openMenu = null
      openedByClick = false
    }
  }

  function openMenuFor(barItem, menuDef) {
    closeMenu()
    const dd = document.createElement('div')
    dd.className = 'menu-dropdown'
    for (const it of menuDef.items) dd.appendChild(buildMenuItem(it))
    const rect = barItem.getBoundingClientRect()
    dd.style.left = rect.left + 'px'
    dd.style.top = rect.bottom + 'px'
    overlay.appendChild(dd)
    barItem.classList.add('open')
    openMenu = { barItem, dropdown: dd }
  }

  /* ==================== 菜单栏渲染 ==================== */

  menubar.innerHTML = ''
  for (const menuDef of MENUS) {
    const item = document.createElement('div')
    item.className = 'menubar-item'
    item.textContent = menuDef.label
    item.addEventListener('mousedown', (e) => {
      e.preventDefault() // 防止抢走编辑器焦点导致选区丢失
      if (openMenu && openMenu.barItem === item) {
        closeMenu()
      } else {
        openMenuFor(item, menuDef)
        openedByClick = true
      }
    })
    item.addEventListener('mouseenter', () => {
      // 已有菜单打开时，横向滑动直接切换
      if (openMenu && openedByClick && openMenu.barItem !== item) {
        openMenuFor(item, menuDef)
      }
    })
    menubar.appendChild(item)
  }

  // 点击任意处关闭菜单（捕获阶段，避免先触发底层动作）
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !openMenu.dropdown.contains(e.target) && !openMenu.barItem.contains(e.target)) {
      closeMenu()
    }
  }, true)

  // Alt 菜单快捷键（Alt+F 触发"文件"等）暂不实现（v1 范围外）
}
