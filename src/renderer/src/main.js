/**
 * LogPad 渲染进程引导文件（唯一入口，后续任务不改动本文件）
 *
 * 模块化契约（所有后续任务共同遵守）：
 * - 每个功能模块位于 src/renderer/src/modules/<name>.js，只允许通过 init(ctx) 接收依赖，
 *   不得在模块内直接 import 本文件形成环；文件所有权严格分离，任务间互不修改对方文件。
 * - ctx 是模块间唯一共享对象，包含：
 *     ctx.commandBus  命令总线（注册/执行/启用/勾选），菜单、工具栏、快捷键统一走命令 id
 *     ctx.status      状态栏写入接口 set(key, text|null)
 *     ctx.panels      底部面板开合接口（findinfiles / filter）
 *     ctx.monaco      monaco-editor 命名空间（禁止模块自行 import monaco 以外的实例）
 *     ctx.settings    应用设置（任务 2/14 接真实持久化，模块只读写该对象）
 * - 模块加载顺序固定见下方 MODULES 数组，与 import 顺序一致，保证依赖方后初始化。
 */
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import * as monaco from 'monaco-editor'
import './styles.css'

// Monaco web worker：经 vite ?worker 打包为独立 worker 资源，保证语法/tokenize 不阻塞 UI 线程
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

/* ==================== ctx：全模块共享依赖契约 ==================== */

// 命令总线：基于 Map 的最小实现。命令是 UI（菜单/工具栏/快捷键）与功能的唯一连接方式。
const commands = new Map()

const commandBus = {
  /** 注册命令。def: { label, enabled = true, checked, run } */
  register(id, def = {}) {
    commands.set(id, {
      label: def.label ?? id,
      enabled: def.enabled !== false,
      checked: !!def.checked,
      run: def.run
    })
  },
  /** 执行命令（未注册警告提示、未启用静默忽略），返回 run 的返回值（可能是 Promise） */
  execute(id, ...args) {
    const cmd = commands.get(id)
    if (!cmd) {
      console.warn(`[commandBus] 未注册的命令: ${id}`)
      return
    }
    if (!cmd.enabled) return
    return cmd.run(...args)
  },
  setEnabled(id, bool) {
    const cmd = commands.get(id)
    if (cmd) cmd.enabled = !!bool
  },
  setChecked(id, bool) {
    const cmd = commands.get(id)
    if (cmd) cmd.checked = !!bool
  },
  /** 读取命令注册对象（含 label/enabled/checked），供菜单/工具栏渲染 */
  get(id) {
    return commands.get(id)
  }
}

// 状态栏接口：暂以 console.debug 兜底，任务 12（statusbar.js）替换为真实状态栏 DOM 更新
const status = {
  /** key: 字段标识（如 ln/col/sel/eol/encoding/language/follow/dirty）；text 传 null 清除 */
  set(key, text) {
    console.debug(`[status] ${key} = ${text}`)
  }
}

// 底部面板开合：操作 #panel-<id> 的 hidden 属性，id 仅允许 'findinfiles' | 'filter'
const panels = {
  toggle(id) {
    const el = document.getElementById(`panel-${id}`)
    if (el) el.hidden = !el.hidden
  },
  show(id) {
    const el = document.getElementById(`panel-${id}`)
    if (el) el.hidden = false
  },
  hide(id) {
    const el = document.getElementById(`panel-${id}`)
    if (el) el.hidden = true
  },
  isVisible(id) {
    const el = document.getElementById(`panel-${id}`)
    return !!el && !el.hidden
  }
}

// 应用设置默认值（任务 2/14 接真实持久化：userData JSON 读写）
const settings = {
  theme: 'dark',
  fontSize: 14,
  wordWrap: false,
  showWhitespace: false,
  showEol: false,
  lineNumbers: true,
  autoReload: 'auto',
  largeFileThresholdMB: 20,
  followTailDefault: false,
  recent: [],
  session: null
}

const ctx = {
  commandBus,
  status,
  panels,
  monaco,
  settings
}

// 供确有跨模块读取需求的场合使用（常规方式仍是 init(ctx) 注入）
export { ctx }

/* ==================== 模块装载（顺序固定，勿改） ==================== */

import * as tabs from './modules/tabs.js'
import * as logLanguage from './modules/logLanguage.js'
import * as viewControls from './modules/viewControls.js'
import * as search from './modules/search.js'
import * as gotoDialog from './modules/gotoDialog.js'
import * as bookmarks from './modules/bookmarks.js'
import * as lineOps from './modules/lineOps.js'
import * as findInFilesPanel from './modules/findInFilesPanel.js'
import * as filterPanel from './modules/filterPanel.js'
import * as workspace from './modules/workspace.js'
import * as followTail from './modules/followTail.js'
import * as menubar from './modules/menubar.js'
import * as toolbar from './modules/toolbar.js'
import * as statusbar from './modules/statusbar.js'
import * as optionsDialog from './modules/optionsDialog.js'

const MODULES = [
  tabs,
  logLanguage,
  viewControls,
  search,
  gotoDialog,
  bookmarks,
  lineOps,
  findInFilesPanel,
  filterPanel,
  workspace,
  followTail,
  menubar,
  toolbar,
  statusbar,
  optionsDialog
]

for (const mod of MODULES) {
  mod.init(ctx)
}

/* Monaco 编辑器实例由 tabs.js（任务 4 多标签核心）创建并管理：
   原任务 1 的演示编辑器已在任务 4 移除，编辑器生命周期归属 ctx.tabs.editor。 */
