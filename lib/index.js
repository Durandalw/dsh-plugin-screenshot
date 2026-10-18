/**
 * dsh-screenshot — host half.
 *
 * Owns everything the client half cannot do:
 *   * Windows-native window enumeration / show / hide (scripts/win.ps1)
 *   * screen, window and region capture (scripts/shot.ps1)
 *   * image cropping (scripts/crop.ps1)
 *   * clipboard and file output
 *
 * The client half is a normal compiled client module and talks to this half over
 * plain HTTP routes registered on the host web server, which is the transport a
 * persistent bundle uses (host.call belongs to dynamic Cordis packages).
 *
 * @module dsh-screenshot
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-screenshot'
export const inject = ['webServer', 'tools']

/** Absolute directory holding the PowerShell helpers and this module. */
const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = dirname(HERE)
const SCRIPTS = join(PKG_ROOT, 'scripts')

/** Screenshot scratch space; every intermediate PNG lands here. */
const WORK_DIR = join(tmpdir(), 'dsh-screenshot')

/** Route prefix served to the client half. */
const PREFIX = '/dsh-screenshot'

/**
 * PowerShell installations to probe, most capable first.
 *
 * Absolute paths only — see `powershell()` for why a bare command name is not used.
 * The list covers PowerShell 7 (machine and per-user installs) and the Windows
 * PowerShell that ships with Windows itself.
 */
const PWSH_CANDIDATES = [
  'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'PowerShell', 'pwsh.exe'),
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
].filter((p) => p !== '')

let resolvedShell = null

/**
 * Locate a PowerShell to run the helper scripts with.
 *
 * Only absolute paths are probed. Returning a bare command name (`pwsh.exe`) would
 * let the plugin load on a machine without PowerShell and then fail later with a raw
 * `spawn pwsh.exe ENOENT` — an error that says nothing about what is actually wrong.
 * A missing shell is a hard requirement, so it is reported as one.
 *
 * @returns {string} absolute path to a usable shell.
 * @throws {Error} when none of the candidates exists.
 */
function powershell() {
  if (resolvedShell !== null) return resolvedShell
  for (const candidate of PWSH_CANDIDATES) {
    if (existsSync(candidate)) {
      resolvedShell = candidate
      return resolvedShell
    }
  }
  throw new Error(
    'dsh-plugin-screenshot needs PowerShell, but none was found on this machine. '
    + `Looked for: ${PWSH_CANDIDATES.join(', ')}. `
    + 'This plugin is Windows-only; install PowerShell 7 (https://aka.ms/powershell) '
    + 'or Windows PowerShell, or set config.shellPath to the interpreter to use.',
  )
}

/**
 * Validate an explicitly configured shell and remember it.
 *
 * Called from apply() so a bad `shellPath` is reported at load time with the config
 * key named, rather than surfacing later as a spawn failure mid-capture.
 *
 * @param {string} path
 * @throws {Error} when the path is not an existing file.
 */
function useConfiguredShell(path) {
  if (!existsSync(path)) {
    throw new Error(`dsh-plugin-screenshot: config.shellPath points at "${path}", which does not exist.`)
  }
  resolvedShell = path
}

/**
 * Run one PowerShell script and parse its single-line JSON reply.
 * @param {string} script - file name inside scripts/.
 * @param {string[]} args - script arguments.
 * @returns {Promise<object>} the parsed payload.
 */
function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const file = join(SCRIPTS, script)
    if (!existsSync(file)) {
      reject(new Error(`screenshot: helper not found: ${file}`))
      return
    }
    // Resolve the shell first: a missing PowerShell is a configuration problem the
    // caller should see stated plainly, not an ENOENT from deep inside spawn.
    let shell = null
    try {
      shell = powershell()
    } catch (error) {
      reject(error)
      return
    }
    const child = spawn(
      shell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => {
      // ENOENT here means the resolved shell vanished between the existence check and
      // the spawn; anything else is passed through unchanged.
      if (error.code === 'ENOENT') {
        reject(new Error(`screenshot: cannot run PowerShell at ${shell} (ENOENT). The plugin is Windows-only.`))
        return
      }
      reject(error)
    })
    child.on('close', (code) => {
      const line = out.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()
      if (line === undefined) {
        reject(new Error(`screenshot: ${script} produced no JSON (exit ${String(code)})${err ? `: ${err.trim().slice(0, 300)}` : ''}`))
        return
      }
      let parsed
      try { parsed = JSON.parse(line) } catch (error) {
        reject(new Error(`screenshot: ${script} returned unparsable JSON: ${error.message}`))
        return
      }
      if (parsed.status !== 'ok') {
        reject(new Error(`screenshot: ${script} failed: ${String(parsed.error ?? 'unknown')}`))
        return
      }
      resolve(parsed.data ?? {})
    })
  })
}

/** Monotonic suffix so concurrent captures never share a file name. */
let shotSeq = 0
function nextShotPath(tag) {
  shotSeq += 1
  return join(WORK_DIR, `${tag}-${Date.now()}-${String(shotSeq)}.png`)
}

/**
 * Capture the screen, one window, or one region to a PNG file.
 * @param {{mode?: string, hwnd?: number, x?: number, y?: number, width?: number, height?: number}} options
 */
async function capture(options = {}) {
  mkdirSync(WORK_DIR, { recursive: true })
  const mode = options.mode ?? 'fullscreen'
  const out = nextShotPath(mode)
  const args = ['-Mode', mode, '-OutFile', out]
  if (mode === 'window') {
    if (!Number.isFinite(options.hwnd)) throw new Error('screenshot: window mode needs hwnd')
    args.push('-Hwnd', String(options.hwnd))
  } else if (mode === 'region') {
    const x = Math.round(options.x ?? 0)
    const y = Math.round(options.y ?? 0)
    const w = Math.round(options.width ?? 0)
    const h = Math.round(options.height ?? 0)
    if (w <= 0 || h <= 0) throw new Error('screenshot: region needs a positive size')
    args.push('-X', String(x), '-Y', String(y), '-W', String(w), '-H', String(h))
  }
  return runScript('shot.ps1', args)
}

/**
 * List top-level windows with their real screen rectangles.
 * @returns {Promise<Array<object>>}
 */
async function listWindows() {
  const data = await runScript('win.ps1', ['-Action', 'list'])
  return Array.isArray(data.windows) ? data.windows : []
}

/**
 * Show or hide one window.
 * @param {number} hwnd
 * @param {boolean} visible
 */
async function setWindowVisible(hwnd, visible) {
  return runScript('win.ps1', ['-Action', visible ? 'show' : 'hide', '-Hwnd', String(hwnd)])
}

/**
 * Capture with an optional window hidden, in ONE PowerShell process.
 *
 * Hiding, capturing and restoring as three separate `runScript` calls costs a pwsh
 * launch each (~1.1s), so the window stays invisible for over a second and a failing
 * restore leaves it hidden for good. `snip.ps1` performs all three steps itself, with
 * the restore in a `finally` block, which brings the invisible window down to ~380ms.
 *
 * `snip.ps1` always captures the whole virtual screen. Window and region requests crop
 * that result, which keeps the hide/restore sequencing in the one place that can
 * guarantee it.
 *
 * @param {{mode?: string, hwnd?: number, x?: number, y?: number, width?: number, height?: number}} options
 * @param {number|null} hideHwnd - window to hide, or null to keep every window
 */
async function captureWithOwnWindow(options, hideHwnd) {
  mkdirSync(WORK_DIR, { recursive: true })
  const out = nextShotPath('snip')
  const args = ['-OutFile', out]
  if (hideHwnd !== null) args.push('-HideOwn', '-Hwnd', String(hideHwnd))
  const full = await runScript('snip.ps1', args)

  const mode = options.mode ?? 'fullscreen'
  if (mode === 'fullscreen') return full

  // Derive the requested sub-rectangle from the full-screen capture.
  let rect
  if (mode === 'window') {
    if (!Number.isFinite(options.hwnd)) throw new Error('screenshot: window mode needs hwnd')
    const r = await runScript('win.ps1', ['-Action', 'rect', '-Hwnd', String(options.hwnd)])
    rect = { x: r.x, y: r.y, width: r.width, height: r.height }
  } else {
    rect = {
      x: Math.round(options.x ?? 0), y: Math.round(options.y ?? 0),
      width: Math.round(options.width ?? 0), height: Math.round(options.height ?? 0),
    }
    if (rect.width <= 0 || rect.height <= 0) throw new Error('screenshot: region needs a positive size')
  }

  const cropped = nextShotPath('crop')
  await runScript('crop.ps1', [
    '-InFile', out, '-OutFile', cropped,
    '-X', String(rect.x), '-Y', String(rect.y), '-W', String(rect.width), '-H', String(rect.height),
  ])
  cleanup([out])
  return { ...full, file: cropped, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Read an image as base64 for transport to the client half. */
function readImageBase64(file) {
  const bytes = readFileSync(file)
  return { base64: bytes.toString('base64'), bytes: bytes.length }
}

/** Drop intermediate files once the client half has what it needs. */
function cleanup(files) {
  for (const file of files) {
    try { rmSync(file, { force: true }) } catch { /* best effort */ }
  }
}

export function apply(ctx, config = {}) {
  const snapThreshold = Number(config.snapThreshold ?? 12)
  const ignorePatterns = Array.isArray(config.ignoreWindowPatterns) ? config.ignoreWindowPatterns : []
  const longShotScrollRatio = Number(config.longShotScrollRatio ?? 0.8)
  const longShotMaxFrames = Number(config.longShotMaxFrames ?? 40)
  const defaultAction = String(config.defaultAction ?? 'clipboard')

  // Optional explicit interpreter. Probing absolute paths covers the usual installs,
  // but a portable PowerShell, a renamed folder or a locked-down machine can defeat
  // the list; this lets the deployment say exactly which shell to use.
  if (typeof config.shellPath === 'string' && config.shellPath.trim() !== '') {
    useConfiguredShell(config.shellPath.trim())
  }

  const session = { lastCapture: null }
  const disposers = []

  /** Register one exact route under the plugin prefix. */
  function route(path, handler) {
    disposers.push(ctx.webServer.register({ kind: 'exact', path: `${PREFIX}${path}`, handler }))
  }

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
    })
    res.end(body)
  }

  /** Read and parse a JSON request body, bounded. */
  function readJson(req, limit = 8 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let total = 0
      req.on('data', (chunk) => {
        total += chunk.length
        if (total > limit) { reject(new Error('request body too large')); req.destroy(); return }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (text.trim() === '') { resolve({}); return }
        try { resolve(JSON.parse(text)) } catch (error) { reject(new Error(`invalid JSON body: ${error.message}`)) }
      })
      req.on('error', reject)
    })
  }

  /**
   * Locate the DSH window: the largest visible top-level window of this process tree.
   *
   * @param {Array<object>|undefined} windows - an enumeration the caller already has.
   *   Passing it avoids a second `win.ps1 -Action list`, which costs a full PowerShell
   *   launch (~1.5-5s depending on the machine) and is pure duplicate work when the
   *   caller has just enumerated. Omitting it keeps the previous behaviour.
   */
  async function findOwnWindow(windows) {
    const all = windows ?? await listWindows()
    const ownName = 'DeepSeek Harness'
    const mine = all
      .filter((w) => w.process === ownName || w.pid === process.pid)
      .filter((w) => w.width > 200 && w.height > 200)
    const visible = mine.filter((w) => w.visible && !w.minimized)
    const pick = (visible.length > 0 ? visible : mine)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
    return pick ?? null
  }

  // ── routes ────────────────────────────────────────────────────────────────

  route('/windows', async (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'GET only' }); return }
    try {
      // The client calls this BEFORE capturing, while the Harness window may still be
      // visible. When this capture will hide it, that window must not become a snap
      // target: it is absent from the final image, so snapping to its rectangle would
      // outline empty space. `?hideOwn=1` announces the intent.
      const willHideOwn = /(?:^|[?&])hideOwn=1(?:&|$)/.test(String(req.url ?? ''))

      const windows = await listWindows()
      const keep = windows
        .filter((w) => w.visible && !w.minimized && w.width > 40 && w.height > 40)
        .filter((w) => !ignorePatterns.some((p) => String(w.process ?? '').includes(p) || String(w.title ?? '').includes(p)))
      // Reuse the enumeration just made: findOwnWindow() would otherwise run win.ps1
      // a second time, doubling this route's latency for no new information. It also
      // makes the `own` flag describe the same snapshot as the list beside it.
      const own = await findOwnWindow(windows)
      const ownHwnd = own === null ? null : Number(own.hwnd)
      sendJson(res, 200, {
        windows: keep
          .filter((w) => !(willHideOwn && ownHwnd !== null && Number(w.hwnd) === ownHwnd))
          .map((w) => ({
            hwnd: Number(w.hwnd), pid: w.pid, x: w.x, y: w.y, width: w.width, height: w.height,
            process: w.process, title: w.title,
            own: ownHwnd !== null && Number(w.hwnd) === ownHwnd,
          })),
        own: own === null ? null : { hwnd: ownHwnd, x: own.x, y: own.y, width: own.width, height: own.height },
        hiddenOwn: willHideOwn && ownHwnd !== null,
        snapThreshold,
      })
    } catch (error) {
      sendJson(res, 500, { error: String(error.message ?? error) })
    }
  })

  route('/capture', async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return }
    let body
    try { body = await readJson(req) } catch (error) { sendJson(res, 400, { error: error.message }); return }
    try {
      // Whether the Harness window should be kept out of the image. `hideOwn` is the
      // original spelling; `ownWindow` is the current one and accepts the same two
      // states. ('offscreen' was tried and removed: moving the window clear of the
      // virtual screen worked, but hiding is equally fast once both run in one
      // process, and a maximized window cannot be moved at all.)
      const keep = body.ownWindow === undefined
        ? body.hideOwn !== true
        : String(body.ownWindow) === 'keep'
      const own = await findOwnWindow()
      const data = await captureWithOwnWindow({
        mode: body.mode ?? 'fullscreen',
        hwnd: body.hwnd,
        x: body.x, y: body.y, width: body.width, height: body.height,
      }, keep || own === null ? null : Number(own.hwnd))
      const image = readImageBase64(data.file)
      session.lastCapture = { file: data.file, x: data.x, y: data.y, width: data.width, height: data.height }
      sendJson(res, 200, {
        file: data.file,
        png: `data:image/png;base64,${image.base64}`,
        x: data.x, y: data.y, width: data.width, height: data.height, bytes: image.bytes,
        hidOwn: data.hidOwn === true,
        ownWindow: keep ? 'keep' : 'hide',
        longShot: { scrollRatio: longShotScrollRatio, maxFrames: longShotMaxFrames },
      })
    } catch (error) {
      sendJson(res, 500, { error: String(error.message ?? error) })
    }
  })

  route('/own-window', async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return }
    let body
    try { body = await readJson(req) } catch (error) { sendJson(res, 400, { error: error.message }); return }
    try {
      const own = await findOwnWindow()
      if (own === null) {
        // The window cannot be located while hidden, so there is nothing to toggle.
        // Only reachable if something hid it outside this plugin.
        sendJson(res, 404, { error: 'DSH window not found' })
        return
      }
      const hwnd = Number(own.hwnd)
      await setWindowVisible(hwnd, body.visible === true)
      sendJson(res, 200, { hwnd, visible: body.visible === true })
    } catch (error) {
      sendJson(res, 500, { error: String(error.message ?? error) })
    }
  })

  route('/crop', async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return }
    let body
    try { body = await readJson(req) } catch (error) { sendJson(res, 400, { error: error.message }); return }
    try {
      const source = String(body.file ?? '')
      if (source === '' || !existsSync(source)) throw new Error(`source image not found: ${source}`)
      const x = Math.round(body.x ?? 0)
      const y = Math.round(body.y ?? 0)
      const w = Math.round(body.width ?? 0)
      const h = Math.round(body.height ?? 0)
      if (w <= 0 || h <= 0) throw new Error('crop needs a positive size')
      mkdirSync(WORK_DIR, { recursive: true })
      const out = nextShotPath('crop')
      await runScript('crop.ps1', ['-InFile', source, '-OutFile', out, '-X', String(x), '-Y', String(y), '-W', String(w), '-H', String(h)])
      const image = readImageBase64(out)
      cleanup([out])
      sendJson(res, 200, { png: `data:image/png;base64,${image.base64}`, width: w, height: h, bytes: image.bytes })
    } catch (error) {
      sendJson(res, 500, { error: String(error.message ?? error) })
    }
  })

  route('/commit', async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return }
    let body
    try { body = await readJson(req, 24 * 1024 * 1024) } catch (error) { sendJson(res, 400, { error: error.message }); return }
    try {
      const base64 = String(body.png ?? '').replace(/^data:image\/png;base64,/, '')
      if (base64 === '') throw new Error('missing png payload')
      mkdirSync(WORK_DIR, { recursive: true })
      const target = body.savePath !== undefined && body.savePath !== null && String(body.savePath) !== ''
        ? String(body.savePath)
        : join(WORK_DIR, `shot-${String(Date.now())}.png`)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, Buffer.from(base64, 'base64'))
      const result = { file: target, bytes: readFileSync(target).length }
      if (body.action === 'clipboard') {
        await runScript('clip.ps1', ['-File', target])
        result.clipboard = true
      }
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 500, { error: String(error.message ?? error) })
    }
  })

  route('/cleanup', async (req, res) => {
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'POST only' }); return }
    let body = {}
    try { body = await readJson(req) } catch { /* tolerate an empty body */ }
    const files = Array.isArray(body.files) ? body.files.map(String) : []
    cleanup(files)
    // No window restore is needed here: snip.ps1 shows the window again in its own
    // `finally`, within the same process that hid it, so a capture can never leave it
    // hidden — the failure mode this safety net used to guard against.
    sendJson(res, 200, { removed: files.length })
  })

  route('/status', async (req, res) => {
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'GET only' }); return }
    const shell = powershell()
    sendJson(res, 200, {
      ok: shell.includes('\\') ? existsSync(shell) : true,
      shell,
      scripts: SCRIPTS,
      workDir: WORK_DIR,
      defaultAction,
      snapThreshold,
    })
  })

  // ── model-facing tools ────────────────────────────────────────────────────
  //
  // `tools` is a declared static dependency, so ctx.tools is available for the whole
  // plugin lifetime. Every tool goes through defineTool: tools.register rejects a
  // definition that lacks `output { schema, render }`, and defineTool is what compiles
  // the parameter and output schemas that register then validates.

  disposers.push(ctx.tools.register(defineTool({
    name: 'screenshot_capture',
    description:
      'Capture the user\'s screen to a PNG file. Use mode "fullscreen" for the whole desktop, '
      + '"window" with an hwnd for one window, or "region" with x/y/width/height. '
      + 'Set ownWindow="hide" to hide the DeepSeek Harness window during the capture, which is what the '
      + 'user usually wants when taking a clean shot of whatever sits behind it. '
      + 'The default, "keep", leaves the window in the picture. '
      + 'Hwnd values come from screenshot_list_windows.',
    parameters: {
      mode: {
        type: 'string',
        enum: ['fullscreen', 'window', 'region'],
        description: 'Capture modality. Defaults to fullscreen when omitted.',
      },
      hwnd: { type: 'integer', description: 'Window handle, for mode "window".' },
      x: { type: 'integer', description: 'Left edge in screen pixels, for mode "region".' },
      y: { type: 'integer', description: 'Top edge in screen pixels, for mode "region".' },
      width: { type: 'integer', description: 'Region width, for mode "region".' },
      height: { type: 'integer', description: 'Region height, for mode "region".' },
      hideOwn: { type: 'boolean', description: 'Legacy alias for ownWindow: true keeps the window, false hides it.' },
      ownWindow: {
        type: 'string',
        enum: ['keep', 'hide'],
        description: 'Whether the Harness window appears in the image. hide removes it.',
      },
    },
    output: {
      // The value-schema DSL that defineTool compiles rejects both spellings of
      // mandatory-ness on this path: `required: true` on a scalar property
      // ("not supported on type boolean"), and an object-level `required` array
      // ("not supported by the value schema DSL"). Every field is therefore
      // declared without a required marker, matching the official plugins.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: 'Absolute path of the captured PNG.' },
          x: { type: 'number', description: 'Capture origin X in screen pixels.' },
          y: { type: 'number', description: 'Capture origin Y in screen pixels.' },
          width: { type: 'number', description: 'Capture width in screen pixels.' },
          height: { type: 'number', description: 'Capture height in screen pixels.' },
          bytes: { type: 'number', description: 'PNG size on disk.' },
          hidOwn: { type: 'boolean', description: 'Whether the Harness window was hidden.' },
        },
      },
      render(_args, value) {
        return [{
          type: 'text',
          text: `Captured ${String(value.width)}x${String(value.height)} at (${String(value.x)}, ${String(value.y)})`
            + ` into ${value.file} (${String(Math.round(value.bytes / 1024))} KB)`
            + (value.hidOwn ? ' with the Harness window hidden.' : '.'),
        }]
      },
    },
    async execute(args) {
      const own = await findOwnWindow()
      let hid = null
      if (args.hideOwn === true && own !== null) {
        await setWindowVisible(Number(own.hwnd), false)
        hid = Number(own.hwnd)
        // Let the compositor actually drop the window before capturing.
        await new Promise((resolve) => setTimeout(resolve, 220))
      }
      try {
        const data = await capture({
          mode: args.mode,
          hwnd: args.hwnd,
          x: args.x, y: args.y, width: args.width, height: args.height,
        })
        return {
          file: data.file,
          x: data.x, y: data.y, width: data.width, height: data.height,
          bytes: data.bytes, hidOwn: hid !== null,
        }
      } finally {
        if (hid !== null) await setWindowVisible(hid, true).catch(() => undefined)
      }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'screenshot_list_windows',
    description:
      'List the top-level windows on screen with their exact rectangles, so a capture can target one window '
      + 'or a precise region. The Harness window itself is flagged with own=true.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'number', description: 'Number of windows reported.' },
          lines: { type: 'array', items: { type: 'string' }, description: 'One line per window.' },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.lines.length > 0 ? value.lines.join('\n') : '(no windows)' }]
      },
    },
    async execute() {
      const windows = await listWindows()
      // Same reuse as the /windows route: one enumeration serves both.
      const own = await findOwnWindow(windows)
      const keep = windows.filter((w) => w.visible && !w.minimized && w.width > 40 && w.height > 40)
      const lines = keep.map((w) => {
        const mine = own !== null && Number(w.hwnd) === Number(own.hwnd)
        return `hwnd=${String(w.hwnd)} pid=${String(w.pid)}`
          + ` [${String(w.x)},${String(w.y)} ${String(w.width)}x${String(w.height)}]`
          + `${mine ? ' (this harness window)' : ''} ${String(w.process)} — ${String(w.title)}`
      })
      return { count: lines.length, lines }
    },
  })))

  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* ignore teardown failures */ }
    }
  }
}
