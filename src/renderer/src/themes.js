/**
 * LogPad Monaco 主题共享库（任务 3）
 *
 * 提供 LogVue Dark / LogVue Light 两套编辑器主题，token 与任务 9 的 log Monarch
 * 语言定义对齐（timestamp / level-* / string / number / json-key / uuid / ip / url 等），
 * 颜色值与 spec 色板一致。后续模块（任务 4 tabs、任务 5 设置菜单）经
 * switchTheme(monaco, themeId) 切换主题。
 */

export const THEME_IDS = ['dark', 'light']

export const THEME_NAMES = { dark: 'LogVue Dark', light: 'LogVue Light' }

/* token 颜色表：[dark, light]，保证两种主题下的可读性（与搜索结果面板级别色一致） */
const TOKEN_COLORS = {
  comment: ['#6c7086', '#6e7781'],
  timestamp: ['#cba6f7', '#8250df'],
  'level-fatal': ['#ff4d6d', '#b3123c'],
  'level-error': ['#f87171', '#cf222e'],
  'level-warn': ['#fbbf24', '#9a6700'],
  'level-info': ['#2dd4a7', '#0f8a4c'],
  'level-debug': ['#8b949e', '#57606a'],
  'level-trace': ['#94a3b8', '#6e7781'],
  string: ['#a6e3a1', '#0a7d33'],
  number: ['#fab387', '#953800'],
  'json-key': ['#89dceb', '#0969da'],
  uuid: ['#f5c2e7', '#8250df'],
  ip: ['#74c7d8', '#0e7490'],
  url: ['#8be0fd', '#0969da'],
  bracket: ['#a9b1d6', '#57606a'],
  keyword: ['#cba6f7', '#8250df'],
  type: ['#eba0ac', '#953800'],
  identifier: ['#cdd6f4', '#383a42']
}

function buildRules(themeIndex) {
  const rules = []
  for (const [token, [dark, light]] of Object.entries(TOKEN_COLORS)) {
    rules.push({ token, foreground: themeIndex === 0 ? dark : light })
  }
  // FATAL 加粗（spec：深红加粗）
  const fatal = rules.find((r) => r.token === 'level-fatal')
  if (fatal) fatal.fontStyle = 'bold'
  return rules
}

function buildColors(themeId) {
  if (themeId === 'dark') {
    return {
      'editor.background': '#1e1e2e',
      'editor.foreground': '#cdd6f4',
      'editor.lineHighlightBackground': '#262637',
      'editor.selectionBackground': '#45475a',
      'editor.cursorForeground': '#f5e0dc',
      'editorLineNumber.foreground': '#7f849c',
      'editorLineNumber.activeForeground': '#bac2de',
      'editorIndentGuide.background': '#313244',
      'editorIndentGuide.activeBackground': '#585b70',
      'editor.findMatchBackground': '#ffd86680',
      'editor.findMatchHighlightBackground': '#ffd86638',
      'editor.findMatchBorder': '#ffd866',
      'editor.findMatchHighlightBorder': '#ffd86680',
      'editorWidget.background': '#11111b',
      'editorWidget.border': '#313244',
      'editorSuggestWidget.background': '#11111b',
      'editorSuggestWidget.selectedBackground': '#45475a',
      'input.background': '#11111b',
      'focusBorder': '#89b4fa',
      'scrollbarSlider.background': '#31324480',
      'scrollbarSlider.hoverBackground': '#313244cc',
      'scrollbarSlider.activeBackground': '#89b4fa80',
      'editorGutter.background': '#181825',
      'editorBracketMatch.background': '#45475a00',
      'editorBracketMatch.border': '#89b4fa',
      'editorOverviewRuler.border': '#313244'
    }
  }
  return {
    'editor.background': '#fafafa',
    'editor.foreground': '#383a42',
    'editor.lineHighlightBackground': '#f0f1f3',
    'editor.selectionBackground': '#cce0f7',
    'editor.cursorForeground': '#526fff',
    'editorLineNumber.foreground': '#6e7781',
    'editorLineNumber.activeForeground': '#383a42',
    'editorIndentGuide.background': '#e2e2e9',
    'editorIndentGuide.activeBackground': '#c9c9d4',
    'editor.findMatchBackground': '#ffdf5d88',
    'editor.findMatchHighlightBackground': '#ffdf5d45',
    'editor.findMatchBorder': '#e3a400',
    'editor.findMatchHighlightBorder': '#e3a40060',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#e2e2e9',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.selectedBackground': '#cce0f7',
    'input.background': '#ffffff',
    'focusBorder': '#316bcd',
    'scrollbarSlider.background': '#c9c9d480',
    'scrollbarSlider.hoverBackground': '#c9c9d4cc',
    'scrollbarSlider.activeBackground': '#316bcd80',
    'editorGutter.background': '#f0f0f3',
    'editorBracketMatch.background': '#cce0f7',
    'editorBracketMatch.border': '#316bcd',
    'editorOverviewRuler.border': '#e2e2e9'
  }
}

/** 注册两套 Monaco 主题（幂等，可重复调用） */
export function registerThemes(monaco) {
  monaco.editor.defineTheme('logvue-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: buildRules(0),
    colors: buildColors('dark')
  })
  monaco.editor.defineTheme('logvue-light', {
    base: 'vs',
    inherit: true,
    rules: buildRules(1),
    colors: buildColors('light')
  })
}

/**
 * 完整切换主题：注册 Monaco 主题 + 应用编辑器主题 + 同步 DOM data-theme。
 * @param {object} monaco monaco 命名空间（ctx.monaco）
 * @param {'dark'|'light'} themeId
 */
export function switchTheme(monaco, themeId) {
  registerThemes(monaco)
  monaco.editor.setTheme('logvue-' + themeId)
  applyDomTheme(themeId)
}

/** 仅切换 DOM data-theme（CSS 变量层，不触碰 Monaco） */
export function applyDomTheme(themeId) {
  document.documentElement.dataset.theme = themeId === 'light' ? 'light' : 'dark'
}
