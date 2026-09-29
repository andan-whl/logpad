/**
 * TODO(任务3 验证用演示脚本)：为外壳视觉冒烟填充工具栏图标，
 * 正式版将由 menubar.js / toolbar.js（任务5）动态替换，不属于功能代码。
 */
import { icon } from './icons.js'

const demo = document.getElementById('demo-toolbar')
if (demo) {
  const names = [
    'new', 'open', 'save', 'find', 'replace', 'find-in-files',
    'word-wrap', 'follow-tail', 'filter', 'settings'
  ]
  for (const n of names) {
    const btn = document.createElement('button')
    btn.className = 'toolbar-btn' + (n === 'word-wrap' ? ' active' : '')
    btn.innerHTML = icon(n)
    btn.title = n
    demo.appendChild(btn)
  }
}
