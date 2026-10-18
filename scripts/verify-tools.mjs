/**
 * Schema compliance checker for every tool this plugin registers.
 *
 * This exists because a bad output schema fails at plugin activation and the
 * harness then reports only a bare "failed" — the real error lives in a
 * non-enumerable cause that the desktop crash log drops.
 *
 * Verified against the live runtime on 2026-10-07 with a probe plugin:
 *   step2 handwritten tool register: FAIL JsonSchemaError:
 *     unsupported JSON schema: schema.properties.ok.required
 *     is not supported on type "boolean"
 *   step3 defineTool tool register: OK
 * So `required: true` on a SCALAR property is rejected; an object-level
 * `required` array is the supported spelling.
 *
 * Run: node scripts/verify-tools.mjs
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROFILE = 'C:\\Users\\Durandal\\.dsh\\profiles\\desktop'
const profileRequire = createRequire(PROFILE + '\\package.json')

let defineTool
try {
  const toolsPath = profileRequire.resolve('@deepseek-ai/dsh-tools')
  defineTool = (await import('file:///' + toolsPath.replace(/\\/g, '/'))).defineTool
  console.log(`dsh-tools: ${toolsPath}`)
} catch (error) {
  console.log(`无法解析 @deepseek-ai/dsh-tools: ${error.message}`)
  process.exit(1)
}
if (typeof defineTool !== 'function') {
  console.log('defineTool 不是函数')
  process.exit(1)
}

/** Scalar JSON Schema types, which must not carry `required: true`. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * Walk one schema node and collect every unsupported spelling.
 *
 * Two distinct DSL rules apply, verified against the live runtime:
 *   * a scalar property must not spell `required: true`
 *   * the OUTPUT value-schema DSL rejects an object-level `required` array
 *     entirely ("not supported by the value schema DSL"), while the PARAMETER
 *     DSL accepts and generates one — hence `allowRequiredArray`.
 */
function auditSchema(node, path, out, allowRequiredArray) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return
  const type = node.type
  if (node.required === true) {
    if (typeof type === 'string' && SCALAR_TYPES.has(type)) {
      out.push(`${path}.required is not supported on type "${type}"`)
    } else if (type === undefined) {
      out.push(`${path}.required must be an array of property names, not a boolean`)
    }
  }
  if (node.required !== undefined && node.required !== true) {
    if (!Array.isArray(node.required)) {
      out.push(`${path}.required must be an array when present`)
    } else if (!allowRequiredArray) {
      out.push(`${path}.required array is not supported by the value schema DSL`)
    }
  }
  if (node.properties !== undefined) {
    if (typeof node.properties !== 'object' || node.properties === null) {
      out.push(`${path}.properties must be an object`)
    } else {
      for (const [key, child] of Object.entries(node.properties)) {
        auditSchema(child, `${path}.properties.${key}`, out, allowRequiredArray)
      }
    }
  }
  if (node.items !== undefined) auditSchema(node.items, `${path}.items`, out, allowRequiredArray)
  if (Array.isArray(node.oneOf)) {
    node.oneOf.forEach((child, i) => { auditSchema(child, `${path}.oneOf[${String(i)}]`, out, allowRequiredArray) })
  }
}

// Resolve the plugin relative to this script (../lib/index.js) so the checker
// survives a package rename or a different install name.
const pluginUrl = 'file:///' + join(dirname(HERE), 'lib', 'index.js').replace(/\\/g, '/')
const plugin = await import(pluginUrl)
console.log(`plugin: ${plugin.name ?? '(no name)'}  inject=${JSON.stringify(plugin.inject)}`)
console.log('')

const registered = []
const ctx = {
  webServer: { register() { return () => {} } },
  tools: {
    register(definition) {
      registered.push(definition)
      return () => {}
    },
  },
}

// apply() must never throw: an activation throw is exactly what the harness
// reports as a bare "failed".
try {
  await plugin.apply(ctx, {})
} catch (error) {
  console.log('❌ apply() 抛出异常 —— 这正是会变成裸 "failed" 的失败')
  console.log(`   ${error?.constructor?.name}: ${error?.message}`)
  if (Array.isArray(error?.violations)) {
    for (const v of error.violations) console.log(`   - ${v}`)
  }
  process.exit(1)
}
console.log(`✅ apply() 完成，注册工具 ${registered.length} 个`)
console.log('')

let problems = 0
for (const def of registered) {
  console.log(`── ${def.name} ──`)
  if (typeof def.output?.render !== 'function') {
    console.log('   ❌ output.render 缺失（register 会抛 TypeError）')
    problems++
  } else {
    console.log('   output.render  ✅')
  }

  const violations = []
  auditSchema(def.output?.schema, 'schema', violations, false)
  if (violations.length > 0) {
    problems += violations.length
    console.log('   ❌ output.schema 不合规:')
    for (const v of violations) console.log(`      - ${v}`)
  } else {
    console.log('   output.schema  ✅')
  }

  // The parameter DSL is the other one: it accepts and generates a required array.
  const paramViolations = []
  auditSchema(def.parameters, 'parameters', paramViolations, true)
  if (paramViolations.length > 0) {
    problems += paramViolations.length
    console.log('   ❌ parameters 不合规:')
    for (const v of paramViolations) console.log(`      - ${v}`)
  } else {
    console.log('   parameters     ✅')
  }

  // Exercise render so a malformed renderer surfaces here rather than at runtime.
  try {
    const sample = def.name === 'screenshot_capture'
      ? { file: 'C:\\x.png', x: 0, y: 0, width: 100, height: 50, bytes: 2048, hidOwn: true }
      : { count: 1, lines: ['hwnd=1 pid=2 [0,0 10x10] app - t'] }
    const blocks = def.output.render({}, sample)
    const ok = Array.isArray(blocks) && blocks.length > 0 && typeof blocks[0].text === 'string'
    console.log(`   render 试跑    ${ok ? '✅ ' + JSON.stringify(blocks[0].text).slice(0, 60) : '❌ ' + JSON.stringify(blocks).slice(0, 100)}`)
    if (!ok) problems++
  } catch (error) {
    console.log(`   render 试跑    ❌ ${error.message}`)
    problems++
  }
  console.log('')
}

// Rebuilding through defineTool is NOT re-checked here: defineTool takes the
// author-facing *field map* for parameters, while `def.parameters` is already the
// compiled JSON Schema that register consumes. Feeding the compiled form back in
// throws "parameters.type must be a value schema object" — a mistake in this
// checker, not in the plugin. Compilation correctness is covered above:
// apply() completing without a throw means defineTool already compiled every
// parameter and output schema successfully.

console.log('')
console.log(problems === 0 ? '✅ 全部通过' : `❌ 发现 ${String(problems)} 个问题`)
process.exit(problems === 0 ? 0 : 1)
