// 设计变量守卫的测试：node --test tools/design-guard/
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contrastFindings, contrastRatio, elementGradientFindings, scanText } from './guard.mjs'

const GUARD = fileURLToPath(new URL('./guard.mjs', import.meta.url))

const kinds = (findings) => findings.map((f) => f.kind)

test('页面里引用旧变量名会被报出，并带行号', () => {
  const css = '.a { color: var(--text-1); }\n.b { background: var(--signal); border-color: var(--line-2); }\n'
  const found = scanText('web/apps/seeker/src/styles/app.css', css)
  assert.deepEqual(found.map((f) => [f.kind, f.line, f.value]), [
    ['legacy-token', 2, '--signal'],
    ['legacy-token', 2, '--line-2'],
  ])
})

test('名字只是以旧变量名开头的新变量不算残留', () => {
  const css = '.a { color: var(--danger-text); background: var(--danger-soft); border-radius: var(--radius-tag); }'
  assert.deepEqual(scanText('web/apps/ops/src/styles/ops.css', css), [])
})

test('变量文件里标了 legacy 的那一段不报旧变量名，段外照报', () => {
  const css = ':root { --primary: #2B6BFF; }\n/* legacy:start */\n:root { --signal: #E8590C; }\n.x { color: var(--signal); }\n/* legacy:end */\nbody { color: var(--ink-800); }\n'
  const found = scanText('web/packages/ui-tokens/tokens.css', css)
  assert.deepEqual(found.map((f) => [f.kind, f.line, f.value]), [['legacy-token', 6, '--ink-800']])
})

test('写死的十六进制、rgb、rgba 颜色会被报出', () => {
  const vue = '<template><div style="color: #E8590C" /></template>\n<style scoped>\n.a { background: rgba(0, 0, 0, .2); border-color: rgb(1 2 3); color: #fff; }\n</style>\n'
  const found = scanText('web/apps/console/src/views/X.vue', vue)
  assert.deepEqual(found.map((f) => [f.kind, f.line, f.value]), [
    ['hard-color', 1, '#E8590C'],
    ['hard-color', 3, 'rgba(0, 0, 0, .2)'],
    ['hard-color', 3, 'rgb(1 2 3)'],
    ['hard-color', 3, '#fff'],
  ])
})

test('插槽简写、注释、HTML 实体、锚点里像颜色的写法不算写死颜色', () => {
  const vue = '<template>\n  <el-table><template #add>x</template><template v-if="a" #bad="{ row }">y</template></el-table>\n  <!-- 原来是 #E8590C -->\n  <a href="#abc">&#160;</a>\n</template>\n<script setup lang="ts">\n// 主色 #2B6BFF\n/* rgba(0,0,0,.1) */\nconst el = document.querySelector(\'#app\')\n</script>\n'
  assert.deepEqual(scanText('web/apps/ops/src/views/Y.vue', vue), [])
})

test('变量文件里可以写色值；白名单登记过的文件和色值不报', () => {
  assert.deepEqual(scanText('web/packages/ui-tokens/tokens.css', ':root { --primary: #2B6BFF; --shadow-card: 0 1px 2px rgba(0,0,0,.04); }'), [])
  const rules = { colorAllowlist: [{ file: 'web/apps/staff/src/utils/qr.ts', value: '#000000', reason: '二维码码点' }] }
  const ts = "ctx.fillStyle = '#000000'\nctx.strokeStyle = '#123456'\n"
  assert.deepEqual(scanText('web/apps/staff/src/utils/qr.ts', ts, rules).map((f) => f.value), ['#123456'])
  assert.deepEqual(kinds(scanText('web/apps/staff/src/utils/other.ts', ts, rules)), ['hard-color', 'hard-color'])
})

test('小于 12px 的字号和半像素字号会被报出，12px 及以上的整数不报', () => {
  const css = '.a { font-size: 11px; }\n.b { font-size: 12.5px; }\n.c { font-size: 12px; }\n.d { font: 600 11.5px/1.2 sans-serif; }\n.e { font-size: 15px; line-height: 1.5; padding: 0.5px; }\n.f { font-size: 0; }\n'
  assert.deepEqual(scanText('web/apps/staff/src/styles/app.css', css).map((f) => [f.kind, f.line, f.value]), [
    ['font-size', 1, '11px'],
    ['font-size', 2, '12.5px'],
    ['font-size', 4, '11.5px'],
  ])
  const ts = "const s = { fontSize: '10px' }\nctx.font = '600 13.5px sans-serif'\nconst ok = { fontSize: '14px' }\n"
  assert.deepEqual(scanText('web/apps/staff/src/utils/poster.ts', ts).map((f) => [f.line, f.value]), [[1, '10px'], [2, '13.5px']])
})

test('对比度按 WCAG 公式计算', () => {
  // 取值来自规范表：白字在主色上 4.52，原三级文字 #8A909C 在白底上 3.21
  assert.equal(contrastRatio('#FFFFFF', '#2B6BFF').toFixed(2), '4.52')
  assert.equal(contrastRatio('#8A909C', '#FFFFFF').toFixed(2), '3.21')
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(0), '21')
})

test('变量里对比度不够的组合、指向不存在变量的组合会被报出', () => {
  const css = ':root { --fg: #8A909C; --bg: #FFFFFF; --big: #FF5A1F; }\n/* legacy:start */\n:root { --old: #000000; }\n/* legacy:end */\n'
  const pairs = [
    { fg: '--fg', bg: '--bg', min: 4.5, use: '正文' },
    { fg: '--fg', bg: '--bg', min: 3, use: '大字' },
    { fg: '--big', bg: '--bg', min: 3, use: '薪资' },
    { fg: '--old', bg: '--bg', min: 4.5, use: '旧变量不算' },
  ]
  const found = contrastFindings(css, pairs)
  assert.deepEqual(found.map((f) => f.value), ['--fg / --bg', '--old / --bg'])
  assert.match(found[0].message, /3\.21.*低于 4\.5/)
  assert.match(found[1].message, /--old 不存在/)
})

test('Element 主色梯度要由主色算出并与主色一致', () => {
  // Element Plus 默认主题自己的梯度，作为算法的对照
  const tokens = ':root { --primary: #409EFF; }'
  const good = 'html:root { --el-color-primary: #409EFF; --el-color-primary-light-3: #79BBFF; --el-color-primary-light-5: #A0CFFF; --el-color-primary-light-7: #C6E2FF; --el-color-primary-light-8: #D9ECFF; --el-color-primary-light-9: #ECF5FF; --el-color-primary-dark-2: #337ECC; }'
  const sources = { primary: '--primary' }
  assert.deepEqual(elementGradientFindings(tokens, good, sources), [])
  const stale = good.replace('#409EFF;', '#E8590C;').replace('#D9ECFF', '#FADECE')
  assert.deepEqual(elementGradientFindings(tokens, stale, sources).map((f) => f.value), ['--el-color-primary', '--el-color-primary-light-8'])
})

test('命令行：按文件运行，有问题退出码 1 并列出位置，没问题退出码 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-guard-'))
  const bad = join(dir, 'Bad.vue')
  const good = join(dir, 'Good.vue')
  writeFileSync(bad, '<style scoped>\n.a { color: var(--signal); font-size: 11.5px; }\n</style>\n')
  writeFileSync(good, '<style scoped>\n.a { color: var(--text-1); font-size: 14px; }\n</style>\n')
  const failed = spawnSync('node', [GUARD, bad, good], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /Bad\.vue:2 {2}\[legacy-token\] --signal/)
  assert.match(failed.stdout, /Bad\.vue:2 {2}\[font-size\] 11\.5px/)
  assert.doesNotMatch(failed.stdout, /Good\.vue/)
  assert.match(execFileSync('node', [GUARD, good], { encoding: 'utf8' }), /没有问题/)
})

test('命令行：不认识的端或不存在的文件按用法错误退出', () => {
  assert.equal(spawnSync('node', [GUARD, '--app', 'website'], { encoding: 'utf8' }).status, 2)
  assert.equal(spawnSync('node', [GUARD, '/no/such/file.vue'], { encoding: 'utf8' }).status, 2)
})

test('仓库里的设计变量：对比度和 Element 梯度校验全部通过', () => {
  const out = spawnSync('node', [GUARD, '--contrast'], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stdout)
})

test('类名里的 --danger、--info（BEM 修饰符）不是变量引用', () => {
  const vue = '<template><span class="tag tag--danger" :class="`tag--${tone}`" /></template>\n<style>\n.status-tag--info, .tag--warn { color: var(--text-1); }\n</style>\n'
  assert.deepEqual(scanText('web/apps/console/src/components/DictTag.vue', vue), [])
})

test('legacy 标记只在变量文件里有效，页面里写了也照报', () => {
  const css = '/* legacy:start */\n.a { color: var(--signal); }\n/* legacy:end */\n'
  assert.deepEqual(kinds(scanText('web/apps/seeker/src/styles/app.css', css)), ['legacy-token'])
})

test('accept="image/*" 这类写法不会被当成注释开头而漏掉后面的问题', () => {
  const vue = '<template><input accept="image/*" style="color: #E8590C" /></template>\n<style>\n/* 说明 */\n.a { color: #123456; }\n</style>\n'
  assert.deepEqual(scanText('web/apps/console/src/components/U.vue', vue).map((f) => f.value), ['#E8590C', '#123456'])
})

test('组件上的插槽简写、url(#id) 不算颜色；带变量的 rgba 整段报出', () => {
  const vue = '<template><MyList #add><svg><use href="#abc" /><rect fill="url(#fade)" /></svg></MyList></template>\n<style>\n.a { color: rgba(var(--rgb), .5); }\n</style>\n'
  assert.deepEqual(scanText('web/apps/ops/src/views/Z.vue', vue).map((f) => f.value), ['rgba(var(--rgb), .5)'])
})

test('白名单比较不分大小写、空格和三位六位写法', () => {
  const rules = { colorAllowlist: [
    { file: 'web/apps/staff/src/utils/qr.ts', value: '#FFFFFF', reason: '二维码底色' },
    { file: 'web/apps/staff/src/utils/qr.ts', value: 'rgba(0,0,0,.5)', reason: '遮罩' },
  ] }
  const ts = "a = '#fff'\nb = 'rgba(0, 0, 0, .5)'\nc = '#ffe'\n"
  assert.deepEqual(scanText('web/apps/staff/src/utils/qr.ts', ts, rules).map((f) => f.value), ['#ffe'])
})

test('字号：变量里定义的小字号会报；em 和别的属性里的 px 不误报', () => {
  const css = ':root { --van-font-size-xs: 10px; --font-size-min: 12px; }\n'
  assert.deepEqual(scanText('web/packages/ui-tokens/vant-theme.css', css).map((f) => f.value), ['10px'])
  const ts = "const a = { fontSize: '1.2em' }\nconst b = { font: 'inherit', padding: '2px' }\nconst c = { fontSize: 11 }\n"
  assert.deepEqual(scanText('web/apps/staff/src/utils/x.ts', ts).map((f) => [f.line, f.value]), [[3, '11px']])
})
