// Verify that window hit-testing follows Z order, not area.
//
// Regression: findWindowAt used to pick the smallest window containing the point. With
// a large window sitting on top of a small one, the pointer is over the large window
// but the small one still has the smaller area — so the invisible, covered window won
// and the overlay highlighted / selected the wrong target.
//
// The function is extracted from the shipped bundle and run against synthetic window
// lists, so this tests the real implementation rather than a copy of it.
import { readFileSync } from 'node:fs'

const FILE = 'E:\\DeepSeek Harness 工作区\\dsh-screenshot\\lib\\client.js'
const source = readFileSync(FILE, 'utf8')

/**
 * Pull one arrow function out of the bundle and bind free variables to `scope`.
 *
 * Braces are balanced from the `{` after the `=>`, which avoids tripping over an
 * object pattern in the parameter list.
 */
function extractFunction(name, scope) {
  const marker = `const ${name} = `
  const declStart = source.indexOf(marker)
  if (declStart < 0) throw new Error(`找不到 ${name}`)
  const exprStart = declStart + marker.length
  const arrow = source.indexOf('=>', exprStart)
  const braceStart = source.indexOf('{', arrow)
  let depth = 0
  let i = braceStart
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const expr = source.slice(exprStart, i + 1)
  const names = Object.keys(scope)
  return new Function(...names, 'return (' + expr + ')')(...names.map((n) => scope[n]))
}

// A window helper: Z order is the array order, index 0 = topmost.
const win = (title, x, y, width, height) => ({ title, x, y, width, height })

const cases = []

// --- The reported bug -------------------------------------------------------
{
  // The small window sticks out past the large window's right edge, so there are
  // points inside only one of them as well as points inside both.
  const windows = [
    win('big-on-top', 0, 0, 800, 600),
    win('small-below', 700, 200, 300, 150),   // spans x 700..1000, y 200..350
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 1 })
  cases.push(['大窗口盖住小窗口，点重叠区 → 应选大窗口', at({ x: 750, y: 260 }), 'big-on-top'])
  cases.push(['点只在小窗口伸出的一截 → 应选小窗口', at({ x: 900, y: 260 }), 'small-below'])
  cases.push(['点只在大窗口区域 → 应选大窗口', at({ x: 400, y: 260 }), 'big-on-top'])
  cases.push(['点在两个窗口之外 → 应返回 null', at({ x: 2000, y: 2000 }), null])
}

// --- Reversed stacking ------------------------------------------------------
{
  const windows = [
    win('small-on-top', 300, 200, 200, 150),
    win('big-below', 0, 0, 800, 600),
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 1 })
  cases.push(['小窗口在上层，点重叠区 → 应选小窗口', at({ x: 400, y: 260 }), 'small-on-top'])
}

// --- Same size, different stacking ------------------------------------------
{
  const windows = [
    win('front', 100, 100, 300, 200),
    win('back', 100, 100, 300, 200),
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 1 })
  cases.push(['同尺寸完全重叠 → 应选 Z 序高的', at({ x: 200, y: 200 }), 'front'])
}

// --- Probe radius fallback --------------------------------------------------
{
  const windows = [
    win('top', 100, 100, 300, 200),        // spans x 100..400
    win('left-near', 0, 100, 90, 200),     // right edge at x=90
    win('far', 600, 100, 100, 200),
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 1 })
  // x=92 is 8px from `top`'s left edge and 2px from `left-near`'s right edge, and
  // inside neither — so the nearest edge decides.
  cases.push(['窗口外但明显更靠近某窗口 → 应选它', at({ x: 92, y: 200 }), 'left-near'])
  // x=95 is 5px from both: a tie, which must go to the window higher in the stack.
  cases.push(['同距离时 → 应优先 Z 序高的', at({ x: 95, y: 200 }), 'top'])
  cases.push(['窗口外且都太远 → 应返回 null', at({ x: 400, y: 900 }), null])
}

// --- Three-deep stack -------------------------------------------------------
{
  const windows = [
    win('L1', 0, 0, 900, 700),
    win('L2', 100, 100, 500, 400),
    win('L3', 200, 200, 200, 150),
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 1 })
  cases.push(['三层堆叠，点在最内层 → 应选最上层的 L1', at({ x: 300, y: 300 }), 'L1'])
}

// --- Edge snapping must not reach into covered windows -----------------------
//
// Real layout from the machine that reported this: DSH on top, with Clash and
// PowerShell fully contained inside it and therefore completely covered.
{
  const windows = [
    win('DSH', 309, 149, 1941, 1243),
    win('Clash', 565, 216, 1432, 1106),
    win('PowerShell', 751, 169, 1488, 776),
  ]
  const findWindowAt = extractFunction('findWindowAt', { windows, scale: 1 })
  const findSnap = extractFunction('findSnap', {
    windows, scale: 1, threshold: 12, snapOn: true, findWindowAt,
  })
  // The shared loop expects a window object (it reads `.title` itself), so unwrap
  // findSnap's { w, d, t } result here rather than pre-extracting the title.
  const asWindow = (hit) => (hit === null ? null : hit.w)

  // Pointer inside DSH; the box's left edge sits 5px from Clash's left edge (565)
  // but 261px from DSH's (309). Before the fix this snapped to the covered window.
  cases.push(['拖框靠近被盖住窗口的边缘 → 不应吸附它',
    asWindow(findSnap({ x: 570, y: 220, width: 200, height: 120 }, { x: 800, y: 400 })), null])

  // Box's top-left near DSH's own corner: the visible window snaps.
  cases.push(['拖框靠近可见窗口边缘 → 应吸附它',
    asWindow(findSnap({ x: 313, y: 153, width: 200, height: 120 }, { x: 800, y: 400 })), 'DSH'])

  // Pointer outside every window: nearest-edge search still applies.
  cases.push(['指针在空白处 → 仍按最近边缘吸附',
    asWindow(findSnap({ x: 313, y: 153, width: 200, height: 120 }, { x: 2000, y: 1500 })), 'DSH'])

  // Without a pointer argument the old behaviour (all windows eligible) remains.
  cases.push(['未传指针 → 回退到全量最近边缘',
    asWindow(findSnap({ x: 570, y: 220, width: 200, height: 120 })), 'Clash'])
}

// --- Scale applied ----------------------------------------------------------
{
  const windows = [
    win('scaled', 100, 100, 400, 300),
  ]
  const at = extractFunction('findWindowAt', { windows, scale: 0.5 })
  cases.push(['缩放 0.5 下点在窗口内 → 应命中', at({ x: 200, y: 150 }), 'scaled'])
  cases.push(['缩放 0.5 下点在窗口外 → null', at({ x: 1200, y: 1200 }), null])
}

let pass = 0
let fail = 0
for (const [label, result, want] of cases) {
  const got = result === null ? null : result.title
  const ok = got === want
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label}`)
  if (!ok) console.log(`       期望 ${String(want)}  实际 ${String(got)}`)
}

console.log('')
console.log(fail === 0 ? `✅ 全部通过（${String(pass)} 项）` : `❌ ${String(fail)} 项失败`)
process.exit(fail === 0 ? 0 : 1)
