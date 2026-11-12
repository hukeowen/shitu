// 前后对照页：左边改版前（基线），右边当前截图，按路由清单的顺序排。
// 用法：node compare.mjs [--app seeker,staff] [--route /pm,/owner/bills] [--base baseline] [--cur current] [--out 文件名]
//   node compare.mjs --app seeker            → shots/compare-seeker.html
// 只生成一个本地 HTML，图片用相对路径引 shots/ 下的截图，用浏览器直接打开看。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS, parseArgs, selectRoutes } from './routes.mjs'

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
const APP_NAME = { seeker: '求职者端', staff: '驻场端', console: '企业后台', ops: '平台中台' }
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const argv = process.argv.slice(2)
const opt = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : argv.splice(i, 2)[1] }
const base = opt('--base', 'baseline')
const cur = opt('--cur', 'current')
const outOpt = opt('--out')
let args
try { args = parseArgs(argv) } catch (e) { console.log(e.message); process.exit(1) }
const list = selectRoutes(args)
if (!list.length) { console.log('没有匹配的页面'); process.exit(1) }

/** 一侧的图：没截到就写明，有整页图时给个链接。 */
function side(dir, r, label) {
  const file = `${dir}/${r.file}`
  if (!fs.existsSync(path.join(SHOTS, file))) return `<figure><figcaption>${label}</figcaption><p class="none">没有截图（${esc(file)}）</p></figure>`
  const full = file.replace(/\.png$/, '.full.png')
  const more = fs.existsSync(path.join(SHOTS, full)) ? ` · <a href="${esc(full)}" target="_blank">整页</a>` : ''
  return `<figure><figcaption>${label}${more}</figcaption><a href="${esc(file)}" target="_blank"><img loading="lazy" src="${esc(file)}" alt="${label} ${esc(r.route)}"></a></figure>`
}
/** 这一页截图时记录的问题（跳到别的页、接口报错等），来自各目录的 report.json。 */
function issuesOf(dir) {
  const f = path.join(SHOTS, dir, 'report.json')
  const rows = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
  return new Map(rows.map((x) => [x.file, x.issues ?? []]))
}
const curIssues = issuesOf(cur)

let missing = 0
const sections = Object.entries(Object.groupBy(list, (r) => r.app)).map(([app, rows]) => {
  const body = rows.map((r) => {
    if (!fs.existsSync(path.join(SHOTS, cur, r.file))) missing++
    const warn = (curIssues.get(r.file) ?? []).map((x) => `<li>${esc(x)}</li>`).join('')
    return `<section class="row ${APPS[r.app].mobile ? 'mobile' : 'desktop'}">
  <h3><code>${esc(r.route)}</code><span>${esc(r.persona)}</span></h3>${warn ? `\n  <ul class="warn">${warn}</ul>` : ''}
  <div class="pair">${side(base, r, '改版前')}${side(cur, r, '当前')}</div>
</section>`
  }).join('\n')
  return `<h2 id="${app}">${APP_NAME[app]}（${rows.length} 页）</h2>\n${body}`
})

const title = `改版前后对照 · ${[...new Set(list.map((r) => APP_NAME[r.app]))].join(' / ')}`
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { margin: 0; padding: 24px 32px 80px; font: 14px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1a1d23; background: #f5f6f8; }
  h1 { font-size: 20px; margin: 0 0 4px; } .meta { color: #6b7280; margin: 0 0 16px; }
  nav a { margin-right: 16px; color: #1f58e0; }
  h2 { font-size: 16px; margin: 40px 0 12px; padding-top: 16px; border-top: 1px solid #e6e8ec; }
  .row { background: #fff; border: 1px solid #e6e8ec; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; } h3 span { margin-left: 12px; font-weight: 400; color: #6b7280; }
  .pair { display: flex; gap: 16px; align-items: flex-start; } figure { margin: 0; flex: 1; min-width: 0; }
  .mobile .pair { justify-content: flex-start; } .mobile figure { flex: 0 0 390px; }
  figcaption { font-size: 12px; color: #6b7280; margin-bottom: 6px; } figcaption a { color: #1f58e0; }
  img { display: block; width: 100%; border: 1px solid #e6e8ec; }
  .none { margin: 0; padding: 48px 16px; text-align: center; color: #6b7280; border: 1px dashed #c9cdd4; }
  .warn { margin: 0 0 12px; padding: 8px 12px 8px 28px; background: #fff4e5; color: #a85f00; border-radius: 4px; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">左：${esc(base)}　右：${esc(cur)}　共 ${list.length} 页　生成于 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
<nav>${[...new Set(list.map((r) => r.app))].map((a) => `<a href="#${a}">${APP_NAME[a]}</a>`).join('')}</nav>
${sections.join('\n')}
</body></html>
`
const suffix = [...args.apps, ...args.routes.map((p) => (p === '/' ? 'home' : p.replaceAll('/', '_').replace(/^_/, '')))].join('-')
// 图片用的是相对 shots/ 的路径，对照页只能放在 shots/ 这一层
const outFile = path.join(SHOTS, outOpt ? path.basename(outOpt) : `compare${suffix ? '-' + suffix : ''}.html`)
fs.writeFileSync(outFile, html)
console.log(`对照页：${path.relative(process.cwd(), outFile)}（${list.length} 页${missing ? `，其中 ${missing} 页还没有「${cur}」截图` : ''}）`)
