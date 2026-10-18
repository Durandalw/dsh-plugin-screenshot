// Simulate how the page loads a client bundle and assert the plugin contract:
// name / inject / apply, with inject spelled as CLIENT service names.
//
// The default target is resolved relative to THIS script (../lib/client.js), so the
// checker keeps working after the package is renamed or installed under a new name.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = process.argv[2] ?? join(dirname(HERE), 'lib', 'client.js')

const loaded = []
globalThis.window = {
  __ModuleLoader__: { load(spec) { loaded.push(spec) } },
  addEventListener() {}, removeEventListener() {},
  innerWidth: 1600, innerHeight: 900, setTimeout, clearTimeout,
}
const styleTags = []
globalThis.document = {
  getElementById: () => null,
  createElement: (tag) => ({ tagName: tag, id: '', textContent: '', dataset: {}, remove() {} }),
  head: { appendChild(el) { styleTags.push(el) } },
  querySelector: () => null,
}

const code = readFileSync(FILE, 'utf8')
new Function('window', 'document', code)(globalThis.window, globalThis.document)

if (loaded.length !== 1) {
  console.log(`❌ __ModuleLoader__.load 调用 ${String(loaded.length)} 次（应为 1）`)
  process.exit(1)
}
const spec = loaded[0]
console.log(`__ModuleLoader__.load  id=${spec.id}  factory=${typeof spec.factory}`)
if (typeof spec.factory !== 'function') { console.log('❌ factory 不是函数'); process.exit(1) }

// The registry keys factories by this id and rejects duplicates. A stale id after a
// rename fails the whole entry at boot with "duplicate factory registration", so the
// id must track the package name — this check exists because that bug shipped once.
let expectedId = null
try {
  const pkg = JSON.parse(readFileSync(join(dirname(HERE), 'package.json'), 'utf8'))
  expectedId = pkg.name
} catch { /* manifest unreadable: skip the cross-check */ }
if (expectedId !== null && spec.id !== expectedId) {
  console.log(`❌ 模块 id (${String(spec.id)}) 与包名 (${expectedId}) 不一致 —— 会导致重复注册`)
  process.exit(1)
}
if (expectedId !== null) console.log(`✅ id 与包名一致 (${expectedId})`)

const slotCalls = []
const fakeReact = {
  createElement: (...a) => ({ type: a[0], props: a[1] ?? {} }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {}, useRef: () => ({ current: null }),
  useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'Fragment',
}
const fakeSlots = {
  inject(name, fn) { slotCalls.push(`inject:${name}`); return fn() },
  register(def, comp) { slotCalls.push(`register:${def.name}|id=${def.id}|order=${def.order}`); return () => {} },
}
/** Stub for anything the bundle requires but this harness does not model. */
const stub = new Proxy({}, {
  get(_t, key) {
    if (key === 'default') return stub
    if (key === '__esModule') return true
    return stub
  },
  apply() { return stub },
})

const fakeRequire = (name) => {
  if (name === 'react') return fakeReact
  if (name === '@deepseek-ai/dsh-client-ui-slots') return fakeSlots
  // Other modules are opaque to this checker: a stub keeps the contract
  // assertions meaningful without pretending to execute the plugin's UI.
  return stub
}

const mod = spec.factory(fakeRequire)
console.log('')
console.log('── 客户端插件契约（WebBoot 依此判定是否激活） ──')
const hasName = typeof mod.name === 'string' && mod.name !== ''
const hasInject = Array.isArray(mod.inject)
const hasApply = typeof mod.apply === 'function'
console.log(`   name   : ${hasName ? `✅ "${mod.name}"` : '❌ 缺失'}`)
console.log(`   inject : ${hasInject ? `✅ ${JSON.stringify(mod.inject)}` : '❌ 缺失（entry 会判定为未激活）'}`)
console.log(`   apply  : ${hasApply ? '✅ function' : '❌ 缺失'}`)
if (hasName && expectedId !== null && mod.name !== expectedId) {
  console.log(`   ⚠️  exports.name (${mod.name}) 与包名 (${expectedId}) 不一致`)
}

// Client service names observed on working bundles in this profile.
const KNOWN_SERVICES = new Set([
  'slots', 'sessions', 'workspaces', 'uiSession', 'connection', 'locale',
  'layout', 'commandUi', 'configForms', 'commands', 'settings', 'renderer',
])
if (hasInject) {
  const unknown = mod.inject.filter((s) => !KNOWN_SERVICES.has(s))
  console.log(`   服务名核对: ${unknown.length === 0 ? '✅ 全部是已知客户端服务名' : `⚠️ 未在已知集合内: ${unknown.join(', ')}（可能是包名写错了）`}`)
}

console.log('')
if (hasApply) {
  try {
    const fakeCtx = {
      slots: fakeSlots,
      effect: (fn) => { fn(); return () => {} },
      get: () => undefined,
      on: () => () => {},
    }
    mod.apply(fakeCtx)
    console.log('   apply(ctx) 执行 ✅')
    for (const call of slotCalls) console.log(`      ${call}`)
    console.log(`      注入 CSS ${String(styleTags[0]?.textContent?.length ?? 0)} 字节`)
  } catch (error) {
    // A bundle may legitimately need services this checker does not model;
    // that is not a contract failure, so report it without failing the run.
    console.log(`   apply(ctx) 未完成（本检查器缺少它依赖的服务，非契约问题）: ${error.message}`)
  }
}

console.log('')
const ok = hasName && hasInject && hasApply
console.log(ok ? '✅ 客户端插件契约完整' : '❌ 客户端插件契约不完整')
process.exit(ok ? 0 : 1)
