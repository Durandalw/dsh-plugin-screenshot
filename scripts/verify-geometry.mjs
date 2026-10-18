// Exercise the real selection geometry by extracting it from the shipped bundle.
//
// Testing a hand-copied version would prove nothing, so this pulls the actual
// function source out of lib/client.js and runs it. resizeBy is the part most likely
// to be subtly wrong (dragging a handle past its opposite edge), so it gets the
// most cases.
import { readFileSync } from 'node:fs'

const FILE = 'E:\\DeepSeek Harness 工作区\\dsh-screenshot\\lib\\client.js'
const source = readFileSync(FILE, 'utf8')

/**
 * Pull one arrow function out of the bundle, parameters included, and bind it to a
 * stand-in for the overlay's captured-image dimensions.
 *
 * The body is found by balancing braces from the `{` that opens the function, which
 * is the first `{` AFTER the `=>` — searching from the arrow keeps it from tripping
 * over an object pattern in the parameter list.
 */
function extractFunction(name, scope) {
  const declStart = source.indexOf(`const ${name} = `)
  if (declStart < 0) throw new Error(`找不到 ${name}`)
  const exprStart = declStart + `const ${name} = `.length
  const arrow = source.indexOf('=>', exprStart)
  if (arrow < 0) throw new Error(`${name} 不是箭头函数`)
  const braceStart = source.indexOf('{', arrow)
  let depth = 0
  let i = braceStart
  for (; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  // Slice from the start of the expression so the parameter list comes with it.
  const expr = source.slice(exprStart, i + 1)
  const names = Object.keys(scope ?? {})
  const values = names.map((n) => scope[n])
  return new Function(...names, 'return (' + expr + ')')(...values)
}

// resizeBy clamps edges to the captured image, so it reads `shot` from the closure.
const SCREEN = { width: 400, height: 300 }
const resizeBy = extractFunction('resizeBy', { shot: SCREEN })
console.log('✅ 已从源码提取 resizeBy（绑定 shot = 400x300）')
console.log('')

const base = { x: 100, y: 100, width: 200, height: 100 }   // right edge 300, bottom 200

const cases = [
  // [handle, dx, dy, expected, description]
  ['se', 50, 30, { x: 100, y: 100, width: 250, height: 130 }, '右下角放大'],
  ['se', -50, -30, { x: 100, y: 100, width: 150, height: 70 }, '右下角缩小'],
  ['nw', 20, 10, { x: 120, y: 110, width: 180, height: 90 }, '左上角内移（缩小）'],
  ['nw', -20, -10, { x: 80, y: 90, width: 220, height: 110 }, '左上角外移（放大）'],
  ['n', 0, 20, { x: 100, y: 120, width: 200, height: 80 }, '上边下移'],
  ['s', 0, 40, { x: 100, y: 100, width: 200, height: 140 }, '下边下移'],
  ['w', 30, 0, { x: 130, y: 100, width: 170, height: 100 }, '左边右移'],
  ['e', 25, 0, { x: 100, y: 100, width: 225, height: 100 }, '右边右移'],

  // Boundary behaviour: an edge stops at the image border and never crosses the
  // opposite one, so dragging further has no further effect. (Crossing used to flip
  // the box, which looked like the selection growing backwards.)
  ['e', 500, 0, { x: 100, y: 100, width: 300, height: 100 }, '右边拖到右缘后停住'],
  ['e', 5000, 0, { x: 100, y: 100, width: 300, height: 100 }, '右边狂拖仍停在右缘'],
  ['s', 0, 500, { x: 100, y: 100, width: 200, height: 200 }, '下边拖到下缘后停住'],
  ['w', -500, 0, { x: 0, y: 100, width: 300, height: 100 }, '左边拖到左缘后停住'],
  ['n', 0, -500, { x: 100, y: 0, width: 200, height: 200 }, '上边拖到上缘后停住'],
  // Reversing inside the image simply shrinks the other way.
  ['e', -50, 0, { x: 100, y: 100, width: 150, height: 100 }, '右边往回拖（缩小）'],
  // Dragging one edge onto the opposite one bottoms out at 1px rather than flipping.
  // The opposite edge is pinned, so the dragged edge stops one pixel short of it:
  // a `w` drag from 100 with the right edge at 300 lands on 299, not 300.
  ['w', 250, 0, { x: 299, y: 100, width: 1, height: 100 }, '左边压到右缘 → 1px'],
  ['n', 0, 150, { x: 100, y: 199, width: 200, height: 1 }, '上边压到下缘 → 1px'],
  ['se', -300, -200, { x: 100, y: 100, width: 1, height: 1 }, '右下角拖到左上角 → 1px'],
]

let pass = 0
let fail = 0
for (const [handle, dx, dy, want, label] of cases) {
  const got = resizeBy(base, handle, dx, dy)
  const ok = got.x === want.x && got.y === want.y && got.width === want.width && got.height === want.height
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${label.padEnd(24)} handle=${handle.padEnd(2)} d=(${String(dx)},${String(dy)})`)
  if (!ok) console.log(`       期望 ${JSON.stringify(want)}  实际 ${JSON.stringify(got)}`)
}

console.log('')
console.log('=== 不变量检查（缩放后右下角应随边移动）===')
const invariants = [
  ['e', 50, 0, 'right', 350],
  ['s', 0, 50, 'bottom', 250],
  ['w', -50, 0, 'right', 300],
  ['n', 0, -50, 'bottom', 200],
]
for (const [handle, dx, dy, edge, want] of invariants) {
  const r = resizeBy(base, handle, dx, dy)
  const got = edge === 'right' ? r.x + r.width : r.y + r.height
  const ok = got === want
  if (ok) pass += 1; else fail += 1
  console.log(`  ${ok ? '✅' : '❌'} ${handle} → ${edge}=${String(got)}（期望 ${String(want)}）`)
}

console.log('')
console.log(fail === 0 ? `✅ 全部通过（${String(pass)} 项）` : `❌ ${String(fail)} 项失败`)
process.exit(fail === 0 ? 0 : 1)
