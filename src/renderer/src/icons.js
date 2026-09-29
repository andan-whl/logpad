/**
 * LogPad SVG 图标共享库（任务 3）
 *
 * icon(name, size) 返回内联 SVG 字符串（stroke 风格，currentColor），
 * 供工具栏/菜单/面板等模块直接插入 innerHTML。
 */

const PATHS = {
  new: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/>',
  open: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  save: '<path d="M5 3h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3"/><rect x="8" y="13" width="8" height="5"/>',
  'save-all': '<path d="M4 3h9l3 3v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v4h5"/><path d="M8 20h11a1 1 0 0 0 1-1V8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  'close-all': '<rect x="5" y="5" width="10" height="10" rx="1"/><path d="M9 5V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-1"/><path d="M2 9l6 6"/>',
  cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 16L18 4M16 16L6 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  paste: '<path d="M9 3h6v3H9z"/><path d="M15 4h2a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2"/>',
  undo: '<path d="M4 10h9a5 5 0 0 1 0 10h-3"/><path d="M8 6l-4 4 4 4"/>',
  redo: '<path d="M20 10h-9a5 5 0 0 0 0 10h3"/><path d="M16 6l4 4-4 4"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M8 11h6"/>',
  find: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  replace: '<path d="M10 4h4v4h-4z"/><path d="M12 8v3m0 0-3 4h6l-3-4"/><path d="M5 15h2m-2 3h2m10-3h2m-2 3h2"/>',
  'find-in-files': '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15h6"/>',
  'word-wrap': '<path d="M4 6h16M4 12h12a3 3 0 0 1 0 6h-3"/><path d="M10 15l-3 3 3 3" transform="translate(0,-3)"/><path d="M4 18h4"/>',
  whitespace: '<path d="M4 18h5m-5-6h10m-10-6h16"/><path d="M17 15l2 2 2-2" transform="translate(-1,-4)"/>',
  'follow-tail': '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  filter: '<path d="M4 5h16l-6 7v5l-4 2v-7z"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  goto: '<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/><path d="M9 4v2M9 18v2M4 9v2M4 13v2"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  'copy-path': '<path d="M4 12h16"/><path d="M14 6l6 6-6 6"/><rect x="2" y="3" width="4" height="4" rx="0.5"/><rect x="2" y="17" width="4" height="4" rx="0.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 5v6h-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10l2.1 2.1M19.1 4.9l-2.1 2.1m-10 10l-2.1 2.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><path d="M12 17v.01"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'arrow-down-to-line': '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  cancel: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  clear: '<path d="M8 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-5-6z"/><path d="M12 10l5 5m0-5l-5 5"/>',
  convert: '<path d="M4 8h13m0 0-3-3m3 3-3 3"/><path d="M20 16H7m0 0 3-3m-3 3 3 3"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  dot: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>'
}

/**
 * 获取内联 SVG 图标字符串。
 * @param {string} name 图标名（见 PATHS）
 * @param {number} [size=16] 尺寸（px）
 * @returns {string} SVG HTML
 */
export function icon(name, size = 16) {
  const body = PATHS[name]
  if (!body) {
    console.warn(`[icons] 未知图标: ${name}`)
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24"></svg>`
  }
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${body}</svg>`
  )
}

/**
 * LogPad 应用图形：圆角方形深底 + 三条彩色日志级别横线 + 左侧时间刻度。
 * @param {number} [size=32]
 */
export function logo(size = 32) {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">` +
    `<rect x="3" y="3" width="42" height="42" rx="9" fill="#181825" stroke="#313244" stroke-width="2"/>` +
    `<path d="M11 13h4M20 13h17" stroke="#34d399" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M11 23h4M20 23h17" stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M11 33h4M20 33h17" stroke="#f87171" stroke-width="3.5" stroke-linecap="round"/>` +
    `<circle cx="13" cy="13" r="2" fill="#34d399"/>` +
    `<circle cx="13" cy="23" r="2" fill="#fbbf24"/>` +
    `<circle cx="13" cy="33" r="2" fill="#f87171"/>` +
    `</svg>`
  )
}
