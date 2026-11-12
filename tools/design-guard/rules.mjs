// 设计变量守卫的集中配置：旧变量名、可写色值的文件、写死颜色白名单、对比度组合。

/** 扫描范围（相对仓库根目录）。--app 取这里的键 */
export const SCOPES = {
  seeker: ['web/apps/seeker/src', 'web/apps/seeker/index.html'],
  staff: ['web/apps/staff/src', 'web/apps/staff/index.html'],
  console: ['web/apps/console/src', 'web/apps/console/index.html'],
  ops: ['web/apps/ops/src', 'web/apps/ops/index.html'],
  packages: ['web/packages/ui-tokens', 'web/packages/ui-mobile/src', 'web/packages/ui-icons/src', 'web/packages/ui-icons/public/favicon.svg'],
}

export const SOURCE_EXTENSIONS = ['.vue', '.css', '.scss', '.ts', '.html', '.svg']

export const TOKENS_FILE = 'web/packages/ui-tokens/tokens.css'
export const ELEMENT_THEME_FILE = 'web/packages/ui-tokens/element-theme.css'

/** 设计变量文件：只有这里可以写色值（Element 的主色梯度必须是具体色值） */
export const TOKEN_FILES = [TOKENS_FILE, ELEMENT_THEME_FILE]

/** 改版前「纸 + 墨 + 仕兔橙」体系的变量名，页面里不能再引用 */
export const LEGACY_TOKENS = [
  'paper', 'paper-grid', 'surface', 'surface-2', 'surface-3', 'chrome', 'chrome-2', 'chrome-3',
  'ink-900', 'ink-800', 'ink-700', 'ink-600', 'ink-500', 'ink-400', 'ink-300', 'ink-200',
  'line', 'line-2', 'line-ink',
  'signal', 'signal-700', 'signal-300', 'signal-50',
  'private', 'private-bg', 'private-line', 'public', 'public-bg', 'public-line', 'temp', 'temp-bg', 'temp-line',
  'ok', 'ok-bg', 'ok-line', 'warn', 'warn-bg', 'warn-line', 'danger', 'danger-bg', 'danger-line', 'info', 'info-bg', 'info-line', 'muted-bg',
  'f-cn', 'f-dis', 'f-mono',
  'sh-1', 'sh-2', 'sh-3', 'sh-in',
  'r-xs', 'r-sm', 'r-md', 'r-lg', 'r-xl',
].map((name) => `--${name}`)

/**
 * 写死颜色白名单：确实需要真实色值的地方在这里登记，一行一个文件里的一个色值。
 * 例：{ file: 'web/apps/staff/src/utils/qr.ts', value: '#000000', reason: '二维码码点保持黑白，保证能扫' }
 */
const FAVICON = 'web/packages/ui-icons/public/favicon.svg'
export const COLOR_ALLOWLIST = [
  { file: FAVICON, value: '#2B6BFF', reason: 'favicon 是独立文件，读不到设计变量；对应 --primary' },
  { file: FAVICON, value: '#FFFFFF', reason: 'favicon 是独立文件，读不到设计变量；对应 --text-on-primary' },
]

const TEXT = 4.5 // 正文
const LARGE = 3 // 18px 及以上的加粗大字、图标和图形

/** 浅色底：一、二、三级文字放在其中任何一种上都要达到正文对比度 */
const LIGHT_BACKGROUNDS = ['--bg-card', '--bg-page', '--bg-hover', '--bg-fill', '--primary-bg']

/** 设计变量里要校验的「前景 / 背景」组合 */
export const CONTRAST_PAIRS = [
  ...['--text-1', '--text-2', '--text-3'].flatMap((fg) => LIGHT_BACKGROUNDS.map((bg) => ({ fg, bg, min: TEXT, use: '文字' }))),
  { fg: '--text-on-primary', bg: '--primary', min: TEXT, use: '主按钮文字' },
  { fg: '--text-on-primary', bg: '--primary-hover', min: TEXT, use: '主按钮悬停和按下时的文字' },
  { fg: '--primary-text', bg: '--bg-card', min: TEXT, use: '链接' },
  { fg: '--primary-text', bg: '--bg-page', min: TEXT, use: '页面底上的链接' },
  { fg: '--primary-text', bg: '--primary-bg', min: TEXT, use: '选中项文字、信息标签' },
  { fg: '--primary', bg: '--bg-card', min: LARGE, use: '强调图标、选中指示' },
  { fg: '--salary', bg: '--bg-card', min: LARGE, use: '薪资大字' },
  ...['danger', 'warning', 'success'].flatMap((tone) => [
    { fg: `--${tone}-text`, bg: '--bg-card', min: TEXT, use: '状态文字' },
    { fg: `--${tone}-text`, bg: `--${tone}-soft`, min: TEXT, use: '状态标签、提示条' },
    { fg: '--text-on-primary', bg: `--${tone}-text`, min: TEXT, use: '组件库实心按钮上的文字' },
  ]),
  { fg: '--text-1', bg: '--danger-soft', min: TEXT, use: '提示条正文' },
  { fg: '--text-1', bg: '--warning-soft', min: TEXT, use: '提示条正文' },
  { fg: '--text-1', bg: '--success-soft', min: TEXT, use: '提示条正文' },
  // 提醒填充色在白底上只有 2.6，不单独承载信息，所以不在这里；提醒图标用提醒文字色
  { fg: '--text-on-primary', bg: '--text-1', min: TEXT, use: '申诉弹层里截图缩略图的删除角标（ComplaintPopup.vue 的 .shot-x）' },
  { fg: '--danger-solid', bg: '--bg-card', min: LARGE, use: '危险图标、角标' },
  { fg: '--success-solid', bg: '--bg-card', min: LARGE, use: '成功图标' },
  { fg: '--domain-private-text', bg: '--domain-private-bg', min: TEXT, use: '私域标签' },
  { fg: '--domain-public-text', bg: '--domain-public-bg', min: TEXT, use: '公域标签' },
  { fg: '--domain-pending-text', bg: '--domain-pending-bg', min: TEXT, use: '报名中标签' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ fg: `--chart-${n}`, bg: '--bg-card', min: LARGE, use: '图表分类色' })),
]

/** Element 各语义色取自哪个设计变量；梯度由它计算 */
export const ELEMENT_COLOR_SOURCES = {
  primary: '--primary',
  success: '--success-text',
  warning: '--warning-text',
  danger: '--danger-text',
  error: '--danger-text',
  info: '--text-3',
}
