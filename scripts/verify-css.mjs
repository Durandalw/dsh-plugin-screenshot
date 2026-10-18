// Validate the injected stylesheet: extract the CSS template from the shipped bundle
// and check it for the syntax errors that make a browser drop rules.
import { readFileSync } from 'node:fs'

const FILE = 'E:\\DeepSeek Harness 工作区\\dsh-screenshot\\lib\\client.js'
const source = readFileSync(FILE, 'utf8')

// The stylesheet lives in a template literal assigned to CSS.
const MARKER = 'const CSS = `'
const start = source.indexOf(MARKER)
if (start < 0) { console.log('❌ 找不到 const CSS = `'); process.exit(1) }
// +1 to step over the opening backtick itself; otherwise the closing-backtick search
// finds the opening one and the "CSS" under test is a single character.
const bodyStart = start + MARKER.length
const bodyEnd = source.indexOf('`;', bodyStart)
if (bodyEnd < 0) { console.log('❌ CSS 模板没有闭合（模板字符串里出现了裸反引号？）'); process.exit(1) }
const css = source.slice(bodyStart, bodyEnd)

// A backtick inside the stylesheet would have terminated the template early and
// silently truncated every rule after it.
if (bodyStart === bodyEnd) {
  console.log('❌ CSS 模板为空 —— 模板字符串被提前终止')
  process.exit(1)
}
if (css.includes('`')) {
  console.log('❌ CSS 中含裸反引号 —— 会提前终止模板字符串')
  process.exit(1)
}

console.log(`CSS 长度: ${String(css.length)} 字符，${String(css.split('\n').length)} 行`)
console.log('')

let problems = 0

// 1) Brace balance — an unbalanced brace swallows every following rule.
let depth = 0
let line = 1
const unbalanced = []
for (let i = 0; i < css.length; i += 1) {
  const ch = css[i]
  if (ch === '\n') line += 1
  if (ch === '{') depth += 1
  else if (ch === '}') {
    depth -= 1
    if (depth < 0) { unbalanced.push(`第 ${String(line)} 行多余的 }`); depth = 0 }
  }
}
if (depth !== 0) unbalanced.push(`结尾有 ${String(depth)} 个未闭合的 {`)
if (unbalanced.length > 0) {
  problems += unbalanced.length
  console.log('❌ 花括号不平衡:')
  for (const u of unbalanced) console.log(`   ${u}`)
} else {
  console.log('✅ 花括号平衡')
}

// 2) Paren balance inside each declaration — a stray quote once broke this file.
let paren = 0
let parenLine = 1
line = 1
const parenIssues = []
for (let i = 0; i < css.length; i += 1) {
  const ch = css[i]
  if (ch === '\n') line += 1
  if (ch === '(') { paren += 1; parenLine = line }
  else if (ch === ')') {
    paren -= 1
    if (paren < 0) { parenIssues.push(`第 ${String(line)} 行多余的 )`); paren = 0 }
  }
}
if (paren !== 0) parenIssues.push(`第 ${String(parenLine)} 行起的 ( 未闭合`)
if (parenIssues.length > 0) {
  problems += parenIssues.length
  console.log('❌ 圆括号不平衡:')
  for (const p of parenIssues) console.log(`   ${p}`)
} else {
  console.log('✅ 圆括号平衡')
}

// 3) Every rule must have at least one declaration.
const rules = css.split('}').filter((r) => r.includes('{'))
const emptyRules = rules.filter((r) => {
  const decls = r.slice(r.indexOf('{') + 1).trim()
  return decls === ''
})
if (emptyRules.length > 0) {
  problems += emptyRules.length
  console.log(`❌ ${String(emptyRules.length)} 条空规则（可能吞掉了后续内容）`)
} else {
  console.log(`✅ ${String(rules.length)} 条规则都有声明`)
}

// 4) The menu rules must actually be present, since a menu that renders unstyled
//    means the browser never saw them.
console.log('')
console.log('菜单相关规则:')
for (const sel of ['.dshss-menu ', '.dshss-menu-item', '.dshss-menu-title', '.dshss-menu-mark', '.dshss-menu-hint']) {
  const present = css.includes(sel)
  if (!present) problems += 1
  console.log(`  ${present ? '✅' : '❌'} ${sel.trim()}`)
}

// 5) appearance: a <button> keeps its native chrome unless this is neutralised, and
//    the screenshot from the other machine shows exactly that native chrome.
const hasAppearance = /appearance\s*:/.test(css)
console.log('')
console.log(`  ${hasAppearance ? '✅' : '⚠️ '} 声明了 appearance（未声明时按钮可能保留原生外观）`)

// 6) Show the menu-item rule verbatim for review.
console.log('')
console.log('── .dshss-menu-item 规则原文 ──')
const itemStart = css.indexOf('.dshss-menu-item {')
if (itemStart >= 0) {
  const itemEnd = css.indexOf('}', itemStart)
  console.log(css.slice(itemStart, itemEnd + 1))
}

console.log('')
console.log(problems === 0 ? '✅ CSS 未发现语法问题' : `❌ 发现 ${String(problems)} 个问题`)
