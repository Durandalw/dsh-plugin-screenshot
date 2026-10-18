// Cross-check every className used in the render tree against the stylesheet.
//
// A class present in JSX but missing from the CSS renders unstyled with no error
// anywhere — indistinguishable from "the stylesheet never loaded" when looking at a
// screenshot. This is the check that would catch such a drift.
import { readFileSync } from 'node:fs'

const FILE = 'E:\\DeepSeek Harness 工作区\\dsh-screenshot\\lib\\client.js'
const source = readFileSync(FILE, 'utf8')

const MARKER = 'const CSS = `'
const cssStart = source.indexOf(MARKER) + MARKER.length
const cssEnd = source.indexOf('`;', cssStart)
const css = source.slice(cssStart, cssEnd)
const js = source.slice(0, cssStart) + source.slice(cssEnd)

// Class names the stylesheet defines.
const defined = new Set()
for (const m of css.matchAll(/\.(dshss-[a-z0-9-]+)/g)) defined.add(m[1])

// Class names the render tree asks for.
const used = new Set()
for (const m of js.matchAll(/className:\s*"([^"]+)"/g)) {
  for (const part of m[1].split(/\s+/)) if (part !== '') used.add(part)
}
for (const m of js.matchAll(/classList\.(?:add|toggle)\(\s*"([^"]+)"/g)) used.add(m[1])

const missing = [...used].filter((c) => !defined.has(c)).sort()
const unused = [...defined].filter((c) => !used.has(c)).sort()

console.log(`CSS 定义 ${String(defined.size)} 个类，渲染树使用 ${String(used.size)} 个`)
console.log('')

if (missing.length > 0) {
  console.log(`❌ ${String(missing.length)} 个类在渲染树里用了但 CSS 没定义（会无样式渲染）:`)
  for (const c of missing) console.log(`   .${c}`)
} else {
  console.log('✅ 渲染树用到的类全部有样式定义')
}

if (unused.length > 0) {
  console.log('')
  console.log(`ℹ️  ${String(unused.length)} 个类有样式但没被用到（可能是残留）:`)
  for (const c of unused) console.log(`   .${c}`)
}

console.log('')
console.log('菜单相关类的定义情况:')
for (const c of ['dshss-menu', 'dshss-menu-title', 'dshss-menu-item', 'dshss-menu-mark', 'dshss-menu-hint', 'dshss-menu-text', 'dshss-menu-sep', 'dshss-menu-note']) {
  const inCss = defined.has(c)
  const inJs = used.has(c)
  console.log(`  ${inCss && inJs ? '✅' : '⚠️ '} .${c.padEnd(18)} CSS=${inCss ? 'Y' : 'N'}  JS=${inJs ? 'Y' : 'N'}`)
}

process.exit(missing.length === 0 ? 0 : 1)
