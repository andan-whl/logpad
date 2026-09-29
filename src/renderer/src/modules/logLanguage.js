/**
 * LogPad 自定义 log 语言（任务 9）
 *
 * Monarch 定义：识别日志级别（大小写不敏感）、时间戳（ISO8601 / 日期时间 /
 * 括号时间 / log4j 逗号毫秒）、UUID、URL、IPv4、JSON key、字符串、数字、
 * 异常类名、堆栈行（at 开头灰显）、括号。
 * token 名与 themes.js（任务 3）的 LogVue 主题 rules 一一对应：
 *   level-fatal/-error/-warn/-info/-debug/-trace、timestamp、string、number、
 *   json-key、uuid、ip、url、bracket、keyword、type、comment
 * 语言扩展名注册 .log/.out/.trace；.txt 由 tabs.js 的 detectLanguage 指向 log。
 */

export function init(ctx) {
  const { monaco } = ctx

  monaco.languages.register({
    id: 'log',
    extensions: ['.log', '.out', '.trace'],
    aliases: ['Log', 'log']
  })

  monaco.languages.setMonarchTokensProvider('log', {
    ignoreCase: true,
    tokenizer: {
      root: [
        /* ---- 日志级别（优先级最高，先于 type/error 类词） ---- */
        [/\bfatal\b/, 'level-fatal'],
        [/\berror\b/, 'level-error'],
        [/\bwarn(?:ing)?\b/, 'level-warn'],
        [/\binfo\b/, 'level-info'],
        [/\bdebug\b/, 'level-debug'],
        [/\btrace\b/, 'level-trace'],

        /* ---- 时间戳：ISO8601 / 括号日期时间 / 日期时间 / 括号时间（含 log4j 逗号毫秒） ---- */
        [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?/, 'timestamp'],
        [/\[\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?[^\]]*\]/, 'timestamp'],
        [/\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?/, 'timestamp'],
        [/\[\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?\]/, 'timestamp'],

        /* ---- UUID / URL / IPv4 ---- */
        [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/, 'uuid'],
        [/https?:\/\/[^\s"'<>]+/, 'url'],
        [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/, 'ip'],

        /* ---- JSON key（引号字符串后跟冒号）与字符串 ---- */
        [/"[^"\n]+"(?=\s*:)/, 'json-key'],
        [/"[^"\n]*"?/, 'string'],
        [/'[^'\n]*'?/, 'string'],

        /* ---- 字面量 / 异常类名 ---- */
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/\b[A-Z][A-Za-z0-9]*(?:Exception|Error)\b/, 'type'],

        /* ---- 数字 / 堆栈行 / # 注释 / 括号 ---- */
        [/\d+(?:\.\d+)?/, 'number'],
        [/^[ \t]+at\s+[^\n]*/, 'comment'],
        [/^#.*$/, 'comment'],
        [/[()[\]{}]/, 'bracket']
      ]
    }
  })

  // 语言配置：# 行注释（供 Ctrl+/ 与注释折叠提示）
  monaco.languages.setLanguageConfiguration('log', {
    comments: { lineComment: '#' }
  })
}
