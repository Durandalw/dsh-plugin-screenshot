/**
 * Name-consistency checker for a DSH plugin package.
 *
 * A plugin's name appears in four independent places, and a mismatch fails the whole
 * entry at boot:
 *   * package.json          `name`                    — the published identity
 *   * cordis.patch.yml      insert row `name`         — what the loader resolves
 *   * lib/client.js         __ModuleLoader__ `id`     — registry key; a stale value
 *                                                      throws "duplicate factory
 *                                                      registration"
 *   * lib/client.js         `exports.name`            — the client plugin name
 *
 * Run inside an installed package:
 *   node scripts/check-consistency.mjs
 * or point it at another copy:
 *   node scripts/check-consistency.mjs <package-dir>
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = process.argv[2] ?? dirname(HERE)

function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

const problems = []

// 1) package.json name
const manifestText = readIfPresent(join(ROOT, 'package.json'))
let pkgName = null
if (manifestText === null) {
  problems.push('package.json 不存在')
} else {
  try { pkgName = JSON.parse(manifestText).name } catch (e) { problems.push(`package.json 解析失败: ${e.message}`) }
}
console.log(`  package.json      name : ${String(pkgName)}`)

// 2) cordis.patch.yml insert-row name
const patchText = readIfPresent(join(ROOT, 'cordis.patch.yml'))
let patchName = null
if (patchText === null) {
  problems.push('cordis.patch.yml 不存在')
} else {
  const m = /name:\s*'([^']+)'/.exec(patchText) ?? /name:\s*"([^"]+)"/.exec(patchText) ?? /name:\s*([^\s'"]+)/.exec(patchText)
  patchName = m === null ? null : m[1]
}
console.log(`  cordis.patch.yml  name : ${String(patchName)}`)

// 3) + 4) browser-half id and exported name
const clientText = readIfPresent(join(ROOT, 'lib', 'client.js'))
let clientId = null
let exportName = null
if (clientText === null) {
  problems.push('lib/client.js 不存在')
} else {
  const idMatch = /id:\s*"([^"]+)"/.exec(clientText) ?? /id:\s*'([^']+)'/.exec(clientText)
  clientId = idMatch === null ? null : idMatch[1]
  const nameMatch = /exports\.name\s*=\s*"([^"]+)"/.exec(clientText) ?? /exports\.name\s*=\s*'([^']+)'/.exec(clientText)
  exportName = nameMatch === null ? null : nameMatch[1]
}
console.log(`  lib/client.js     id   : ${String(clientId)}`)
console.log(`  lib/client.js  exports.name : ${String(exportName)}`)
console.log('')

// Cross-check.
const values = [
  ['package.json name', pkgName],
  ['cordis.patch.yml name', patchName],
  ['lib/client.js id', clientId],
  ['lib/client.js exports.name', exportName],
]
for (const [label, value] of values) {
  if (value === null) { problems.push(`${label} 读取不到`); continue }
  if (pkgName !== null && value !== pkgName) problems.push(`${label} = "${value}" ≠ 包名 "${pkgName}"`)
}

if (problems.length > 0) {
  console.log('❌ 命名不一致（会导致 entry 加载失败）:')
  for (const p of problems) console.log(`   - ${p}`)
  process.exit(1)
}
console.log(`✅ 四处命名完全一致: ${String(pkgName)}`)
