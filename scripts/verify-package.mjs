// Pack the current directory and assert the tarball's client bundle carries the
// correct module id. Catches "published a stale id" before it reaches the registry.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ROOT = 'E:\\DeepSeek Harness 工作区\\dsh-screenshot'
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-'))

/**
 * Run `npm pack` without a shell.
 *
 * On Windows npm is a `.cmd` shim, which execFile refuses to launch (EINVAL), and
 * `shell: true` triggers Node's argument-concatenation deprecation. Locating npm's
 * JS entry point and running it with the current node binary avoids both.
 */
function npmCliPath() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.env.ProgramFiles ?? '', 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

const NPM_CLI = npmCliPath()

function runPack() {
  if (NPM_CLI !== null) {
    return execFileSync(process.execPath, [NPM_CLI, 'pack', '--pack-destination', dir, '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 180000,
    })
  }
  // Last resort: the shell shim.
  return execFileSync('npm pack --pack-destination "' + dir + '" --json', {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, shell: true,
  })
}

console.log(`待发布: ${pkg.name}@${pkg.version}`)
console.log(`npm cli: ${NPM_CLI ?? '(未定位，回退到 shell)'}`)
console.log('')

let tarball = null
try {
  const out = runPack()
  const meta = JSON.parse(out)[0]
  tarball = join(dir, meta.filename)
  console.log(`打包成功: ${meta.filename}  (${(meta.size / 1024).toFixed(1)} KB)`)
} catch (error) {
  console.log(`打包失败: ${String(error.message).slice(0, 300)}`)
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}

// Extract just the client bundle and inspect it.
const extractDir = join(dir, 'x')
execFileSync('tar', ['-xzf', tarball, '-C', dir], { encoding: 'utf8', timeout: 60000 })
const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8', timeout: 60000 })
  .split('\n').filter((l) => l !== '')

console.log('')
console.log(`包内 ${String(files.length)} 个文件:`)
for (const f of files) console.log(`   ${f}`)

const clientPath = join(dir, 'package', 'lib', 'client.js')
if (!existsSync(clientPath)) {
  console.log('')
  console.log('❌ 包里没有 lib/client.js')
  rmSync(dir, { recursive: true, force: true })
  process.exit(1)
}

const client = readFileSync(clientPath, 'utf8')
const idMatch = /id:\s*"([^"]+)"/.exec(client)
const nameMatch = /exports\.name\s*=\s*"([^"]+)"/.exec(client)
const patch = readFileSync(join(dir, 'package', 'cordis.patch.yml'), 'utf8')
const patchMatch = /name:\s*'([^']+)'/.exec(patch)

console.log('')
console.log('包内四处命名:')
const rows = [
  ['package.json name', pkg.name],
  ['cordis.patch.yml name', patchMatch === null ? null : patchMatch[1]],
  ['lib/client.js id', idMatch === null ? null : idMatch[1]],
  ['lib/client.js exports.name', nameMatch === null ? null : nameMatch[1]],
]
let bad = 0
for (const [label, value] of rows) {
  const ok = value === pkg.name
  if (!ok) bad += 1
  console.log(`   ${ok ? '✅' : '❌'} ${label.padEnd(28)} ${String(value)}`)
}

/**
 * Host-provided modules must never appear in `dependencies`.
 *
 * They are supplied by the running Harness through `dsh.client.inject`, so listing
 * them as runtime dependencies makes the package manager install a second copy inside
 * the profile. Two copies of a client UI module break web boot — 0.3.2 declared
 * dsh-client-ui-slots and dsh-client-ui-conversation this way, pnpm installed
 * 0.2.0-rc.2 copies beside the host's 0.2.1-rc.2 build, and the host's own
 * dsh-client-ui-skill / -reference / -secret-mask / -goal entries all failed to
 * activate, crashing startup with "4 entries did not activate".
 *
 * Reproduced in a clean profile with nodeLinker: hoisted; fixed by moving them to
 * peerDependencies, after which `pnpm add` installs the plugin alone.
 */
const HOST_SCOPES = ['@deepseek-ai/']
const runtimeDeps = Object.keys(pkg.dependencies ?? {})
const leakedDeps = runtimeDeps.filter((d) => HOST_SCOPES.some((s) => d.startsWith(s)))
const peerDeps = Object.keys(pkg.peerDependencies ?? {})

console.log('')
console.log('依赖声明:')
console.log(`   dependencies      ${runtimeDeps.length === 0 ? '（空）' : runtimeDeps.join(', ')}`)
console.log(`   peerDependencies  ${peerDeps.length === 0 ? '（空）' : peerDeps.join(', ')}`)
const depOk = leakedDeps.length === 0
if (!depOk) bad += 1
console.log(`   ${depOk ? '✅' : '❌'} 宿主提供的 @deepseek-ai/* 不在 dependencies 里`)

rmSync(dir, { recursive: true, force: true })
console.log('')
if (bad > 0) {
  console.log(`❌ 包内有 ${String(bad)} 处问题 —— 不要发布这个版本`)
  if (!depOk) console.log(`   依赖泄漏: ${leakedDeps.join(', ')} 应移到 peerDependencies`)
  process.exit(1)
}
console.log('✅ 包内命名一致，可以发布')
