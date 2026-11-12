#!/usr/bin/env node
/**
 * 设计变量守卫：查页面里残留的旧变量名、写死的颜色、12px 以下或半像素字号，
 * 并校验设计变量里文字色和背景色组合的对比度、Element 主题色梯度。
 *
 *   node tools/design-guard/guard.mjs                    全部：四个端 + 共享包 + 变量校验
 *   node tools/design-guard/guard.mjs --app seeker,staff 只查某几个端（seeker / staff / console / ops / packages）
 *   node tools/design-guard/guard.mjs web/apps/ops/src/views/LoginView.vue …   只查给出的文件
 *   node tools/design-guard/guard.mjs --contrast         只做变量校验
 *
 * 发现任何一处问题退出码为 1。配置集中在 rules.mjs。
 * 查不到的：rem / em / calc() 写的字号、跨行的 font 简写、命名色（white、red）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as defaults from './rules.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 把一段文本换成等长空白，保留换行，行号不变 */
const blank = (s) => s.replace(/[^\n]/g, ' ')

function stripComments(text) {
  return text
    // 注释开头前面要是行首或空白、分隔符，免得把 accept="image/*" 当成注释
    .replace(/(^|[\s;{}(,>])\/\*[\s\S]*?\*\//g, (m, lead) => lead + blank(m.slice(lead.length)))
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)))
}

/** legacy:start / legacy:end 注释之间的行号区间（待删的旧变量定义段） */
function legacyRanges(text) {
  const ranges = []
  let start = null
  text.split('\n').forEach((lineText, i) => {
    if (lineText.includes('legacy:start')) start = i + 1
    else if (lineText.includes('legacy:end') && start !== null) {
      ranges.push([start, i + 1])
      start = null
    }
  })
  return ranges
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length
const inRanges = (ranges, line) => ranges.some(([from, to]) => line >= from && line <= to)

const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z_-])/gi
const COLOR_FN = /\b(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)/gi
// 前面紧挨着字母、数字、连字符的是类名修饰符（.tag--danger），不是变量
const TOKEN_REF = /(?<![\w-])--[a-z][a-z0-9-]*/g
const FONT_SIZE = [
  /font-size\s*:\s*(\d*\.?\d+)px/gi,
  /--[a-z0-9-]*font-size[a-z0-9-]*\s*:\s*(\d*\.?\d+)px/gi,
  /\bfont\s*:[^;},\n]*?(\d*\.?\d+)px/gi,
  /fontSize\s*:\s*['"`]?(\d*\.?\d+)(?:px)?(?![\d.a-z%])/g,
  /\.font\s*=\s*['"`][^'"`\n]*?(\d*\.?\d+)px/g,
]

/** 插槽简写（<template #add>）、HTML 实体（&#160;）、锚点（href="#abc"）、url(#id) 不是颜色 */
function notAColor(text, index) {
  const before = text.slice(Math.max(0, index - 200), index)
  if (/&$/.test(before)) return true
  if (/(?:href|to)\s*=\s*["']$/.test(before) || /url\(\s*$/.test(before)) return true
  // 插槽简写出现在标签的属性位置：从标签开头到这里引号成对，说明不在属性值里
  const tag = before.match(/<[\w-]+\b[^<>]*\s$/)
  return tag !== null && (tag[0].match(/"/g) ?? []).length % 2 === 0 && (tag[0].match(/'/g) ?? []).length % 2 === 0
}

/** 白名单比较用：不分大小写和空格，#abc 与 #aabbcc 算同一个 */
function normalizeColor(value) {
  const v = value.toLowerCase().replace(/\s+/g, '')
  return /^#[0-9a-f]{3,4}$/.test(v) ? '#' + [...v.slice(1)].map((c) => c + c).join('') : v
}

/**
 * 检查一个文件的内容，返回问题列表 { kind, file, line, value, message }。
 * file 是相对仓库根目录的路径，用来判断它是不是变量文件、有没有白名单。
 */
export function scanText(file, rawText, rules = {}) {
  const legacyTokens = new Set(rules.legacyTokens ?? defaults.LEGACY_TOKENS)
  const tokenFiles = rules.tokenFiles ?? defaults.TOKEN_FILES
  const allowlist = rules.colorAllowlist ?? defaults.COLOR_ALLOWLIST
  const path = file.split(sep).join('/')
  const text = stripComments(rawText)
  // 待删的旧变量段只在变量文件里认，页面里写了标记也不豁免
  const ranges = tokenFiles.includes(path) ? legacyRanges(rawText) : []
  const findings = []
  const add = (kind, index, value, message) => findings.push({ kind, file: path, line: lineOf(text, index), value, message, index })

  for (const m of text.matchAll(TOKEN_REF)) {
    if (!legacyTokens.has(m[0])) continue
    // 更长的名字（--danger-text）已被整体匹配，这里只会是完全同名
    if (inRanges(ranges, lineOf(text, m.index))) continue
    add('legacy-token', m.index, m[0], '旧变量名，改用新的语义变量')
  }

  if (!tokenFiles.includes(path)) {
    const allowed = new Set(allowlist.filter((a) => a.file === path).map((a) => normalizeColor(a.value)))
    for (const re of [HEX, COLOR_FN]) {
      for (const m of text.matchAll(re)) {
        if (re === HEX && notAColor(text, m.index)) continue
        if (allowed.has(normalizeColor(m[0]))) continue
        add('hard-color', m.index, m[0], '写死的颜色，改用设计变量；确实需要真实色值就登记进 rules.mjs 的白名单')
      }
    }
  }

  const seen = new Set()
  for (const re of FONT_SIZE) {
    for (const m of text.matchAll(re)) {
      const size = Number(m[1])
      if (size === 0 || (size >= 12 && Number.isInteger(size))) continue
      const index = m.index + m[0].lastIndexOf(m[1])
      if (seen.has(index)) continue
      seen.add(index)
      add('font-size', index, `${m[1]}px`, size < 12 ? '字号小于 12px' : '半像素字号')
    }
  }

  return findings.sort((a, b) => a.index - b.index).map(({ index, ...rest }) => rest)
}

// ---------- 变量校验 ----------

/** 读出变量文件里取值是十六进制颜色的变量（legacy 段除外） */
export function parseColorTokens(css) {
  const ranges = legacyRanges(css)
  const text = stripComments(css)
  const tokens = {}
  for (const m of text.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*(#[0-9a-f]{6})\s*[;}]/gi)) {
    const line = lineOf(text, m.index)
    if (inRanges(ranges, line)) continue
    tokens[m[1]] = m[2].toUpperCase()
  }
  return tokens
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 对比度 */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 按比例把 hex 混向 target（Element 的 light-N = 向白混 N×10%，dark-2 = 向黑混 20%） */
export function mix(hex, target, weight) {
  const to = channels(target)
  return '#' + channels(hex).map((v, i) => Math.round(v * (1 - weight) + to[i] * weight).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** 校验变量文件里各组文字色和背景色的对比度 */
export function contrastFindings(tokensCss, pairs = defaults.CONTRAST_PAIRS, file = defaults.TOKENS_FILE) {
  const tokens = parseColorTokens(tokensCss)
  const findings = []
  for (const { fg, bg, min, use } of pairs) {
    const missing = [fg, bg].filter((name) => !tokens[name])
    if (missing.length) {
      findings.push({ kind: 'contrast', file, value: `${fg} / ${bg}`, message: `变量 ${missing.join('、')} 不存在（${use}）` })
      continue
    }
    const ratio = contrastRatio(tokens[fg], tokens[bg])
    if (ratio < min) {
      findings.push({ kind: 'contrast', file, value: `${fg} / ${bg}`, message: `对比度 ${ratio.toFixed(2)}，低于 ${min}（${use}：${tokens[fg]} 在 ${tokens[bg]} 上）` })
    }
  }
  return findings
}

/** 校验 Element 主题里各语义色与设计变量一致、梯度由它算出 */
export function elementGradientFindings(tokensCss, elementCss, sources = defaults.ELEMENT_COLOR_SOURCES, file = defaults.ELEMENT_THEME_FILE) {
  const tokens = parseColorTokens(tokensCss)
  const theme = parseColorTokens(elementCss)
  const findings = []
  for (const [name, token] of Object.entries(sources)) {
    const base = tokens[token]
    if (!base) {
      findings.push({ kind: 'element-gradient', file, value: token, message: `变量 ${token} 不存在` })
      continue
    }
    const expected = { [`--el-color-${name}`]: base, [`--el-color-${name}-dark-2`]: mix(base, '#000000', 0.2) }
    for (const n of [3, 5, 7, 8, 9]) expected[`--el-color-${name}-light-${n}`] = mix(base, '#FFFFFF', n / 10)
    for (const [key, want] of Object.entries(expected)) {
      if (theme[key] !== want) {
        findings.push({ kind: 'element-gradient', file, value: key, message: `应为 ${want}（由 ${token} ${base} 算出），现在是 ${theme[key] ?? '未定义'}` })
      }
    }
  }
  return findings
}

// ---------- 命令行 ----------

function walk(path, out = []) {
  if (!existsSync(path)) return out
  if (statSync(path).isFile()) {
    out.push(path)
    return out
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    walk(join(path, entry.name), out)
  }
  return out
}

const isSource = (path) => defaults.SOURCE_EXTENSIONS.includes(extname(path)) && !path.endsWith('.d.ts')

function main(argv) {
  const files = []
  let apps = null
  let contrastOnly = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--app') apps = (argv[++i] ?? '').split(',').filter(Boolean)
    else if (argv[i] === '--contrast') contrastOnly = true
    else if (argv[i] === '--') continue // pnpm guard -- --app seeker 会把分隔符原样传进来
    else if (argv[i].startsWith('--')) return usage(`不认识的参数 ${argv[i]}`)
    else files.push(argv[i])
  }
  const unknown = (apps ?? []).filter((a) => !defaults.SCOPES[a])
  if (apps && (!apps.length || unknown.length)) return usage(`--app 只能是 ${Object.keys(defaults.SCOPES).join(' / ')}`)
  const missing = files.filter((f) => !existsSync(resolve(f)))
  if (missing.length) return usage(`文件不存在：${missing.join('、')}`)

  const scoped = files.length > 0 || apps !== null
  const findings = []
  let scanned = 0

  if (!contrastOnly) {
    const targets = files.length
      ? files.flatMap((f) => walk(resolve(f)))
      : (apps ?? Object.keys(defaults.SCOPES)).flatMap((a) => defaults.SCOPES[a]).flatMap((p) => walk(join(REPO_ROOT, p)))
    for (const path of targets.filter(isSource)) {
      scanned++
      findings.push(...scanText(relative(REPO_ROOT, path), readFileSync(path, 'utf8')))
    }
  }
  if (contrastOnly || !scoped) {
    const tokensCss = readFileSync(join(REPO_ROOT, defaults.TOKENS_FILE), 'utf8')
    findings.push(...contrastFindings(tokensCss))
    findings.push(...elementGradientFindings(tokensCss, readFileSync(join(REPO_ROOT, defaults.ELEMENT_THEME_FILE), 'utf8')))
  }

  for (const f of findings) console.log(`${f.file}${f.line ? ':' + f.line : ''}  [${f.kind}] ${f.value}  ${f.message}`)
  const count = Object.entries(Object.groupBy(findings, (f) => f.kind)).map(([k, v]) => `${k} ${v.length}`).join('，')
  const what = contrastOnly ? `变量校验 ${defaults.CONTRAST_PAIRS.length} 组对比度` : `${scanned} 个文件${scoped ? '' : ` + 变量校验 ${defaults.CONTRAST_PAIRS.length} 组对比度`}`
  console.log(findings.length ? `\n设计变量守卫：${what}，发现 ${findings.length} 处问题（${count}）` : `设计变量守卫：${what}，没有问题`)
  return findings.length ? 1 : 0
}

function usage(message) {
  console.error(`${message}\n用法：node tools/design-guard/guard.mjs [--app seeker,staff,console,ops,packages] [--contrast] [文件或目录 …]`)
  return 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
