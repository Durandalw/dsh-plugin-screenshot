/**
 * dsh-plugin-screenshot — browser half.
 *
 * Contributes one compact control to the composer tool row (the `+` seat) plus the
 * full-screen snipping overlay. Every Windows-native operation lives in the host half;
 * this module only renders and calls the plugin's HTTP routes.
 *
 * Compiled client-module form: `window.__ModuleLoader__.load({ id, factory })`.
 *
 * `id` and `exports.name` MUST equal the package name. The client-module registry keys
 * factories by this id and refuses a duplicate, so a stale id after a rename fails the
 * whole entry with "duplicate factory registration".
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-screenshot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		const PREFIX = "/dsh-screenshot";
		const STYLE_ID = "dsh-screenshot-styles";

		/**
		 * Screen pixels kept uncovered at the very top of the window while snipping.
		 *
		 * The Harness chrome (window frame plus the 应用/编辑 menu row) occupies roughly
		 * the first 62px of the window. Inside this strip the overlay is neither drawn
		 * nor interactive, so the menu row stays readable and clickable while the user
		 * is choosing a capture area.
		 */
		const TOP_SAFE = 48;

		const CSS = `
.dshss-root { position: fixed; inset: 0; z-index: 2147483000;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  pointer-events: none; }
/* The interaction layer sets its own cursor (crosshair / resize / move) and re-enables
   pointer events, so the root must not force one. */
.dshss-layer { cursor: crosshair; }
/* The dimmer, the frozen shot and the selection all start below the top safe strip;
   interactive children re-enable pointer events for themselves. */
.dshss-dim { position: absolute; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,.35);
  pointer-events: none; }
.dshss-shot { position: absolute; left: 0; transform-origin: 0 0; image-rendering: crisp-edges;
  -webkit-user-drag: none; user-select: none; pointer-events: none; }
.dshss-sel { position: absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,.5);
  outline: 1px solid rgba(255,255,255,.95); pointer-events: none; }
/* Resize handles. Positioned with a translate so the marker is centred exactly on the
   selection corner; hit-testing lives in JS (handleAt) and uses a larger radius than
   the 11px drawn size. */
.dshss-handle { position: absolute; width: 11px; height: 11px;
  transform: translate(-50%, -50%); background: #fff;
  border: 1px solid rgba(0,0,0,.65); border-radius: 2px;
  box-shadow: 0 1px 3px rgba(0,0,0,.45); pointer-events: none; }
.dshss-snap { position: absolute; outline: 2px solid rgba(90,190,255,.95);
  pointer-events: none; background: rgba(90,190,255,.14);
  box-shadow: 0 0 0 1px rgba(0,0,0,.35), inset 0 0 24px rgba(90,190,255,.2); }
.dshss-bar { position: absolute; display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-radius: 10px; background: rgba(28,28,32,.95);
  color: #eee; box-shadow: 0 6px 24px rgba(0,0,0,.5); pointer-events: auto;
  white-space: nowrap; z-index: 2147483005; box-sizing: border-box; }
.dshss-btn { box-sizing: border-box; display: inline-flex; align-items: center;
  justify-content: center; min-height: 28px; padding: 4px 10px;
  border: 1px solid rgba(255,255,255,.16); border-radius: 6px; background: rgba(255,255,255,.06);
  color: #eee; font: inherit; cursor: pointer; }
.dshss-btn:hover { background: rgba(255,255,255,.14); }
.dshss-btn[data-primary="1"] { background: #2f6feb; border-color: #2f6feb; color: #fff; }
.dshss-btn[data-primary="1"]:hover { background: #3b7cf7; }
.dshss-btn[data-on="1"] { background: rgba(47,111,235,.3); border-color: #2f6feb; }
.dshss-btn:disabled { opacity: .45; cursor: default; }
.dshss-size { position: absolute; padding: 2px 6px; border-radius: 4px;
  background: rgba(28,28,32,.92); color: #eee; font: 11px/1.4 ui-monospace, Consolas, monospace; }
.dshss-hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  padding: 6px 14px; border-radius: 999px; background: rgba(28,28,32,.94); color: #ddd;
  z-index: 2147483002; pointer-events: none; max-width: 80vw; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dshss-err { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%);
  padding: 6px 14px; border-radius: 8px; background: rgba(120,30,30,.96); color: #ffdede;
  z-index: 2147483002; max-width: 70vw; }
.dshss-tool { box-sizing: border-box; display: inline-flex; align-items: center;
  justify-content: center; width: 30px; height: 30px; border: 0; border-radius: 8px;
  background: transparent; color: currentColor; cursor: pointer; opacity: .78;
  padding: 0; margin: 0; position: relative; line-height: 0; }
.dshss-tool > svg { display: block; pointer-events: none; }
.dshss-tool:hover { opacity: 1; background: rgba(127,127,127,.16); }
.dshss-tool[data-busy="1"] { opacity: .4; cursor: default; }
.dshss-tool[data-pref="keep"]::after { content: ""; position: absolute; right: 2px; bottom: 2px;
  width: 5px; height: 5px; border-radius: 50%; background: #f0a020; }
/* Capture icon and its preference caret read as one joined control. */
.dshss-group { position: relative; display: inline-flex; align-items: center; gap: 0; }
.dshss-caret { box-sizing: border-box; display: inline-flex; align-items: center;
  justify-content: center; width: 17px; height: 30px; margin-left: -4px; padding: 0;
  border: 0; border-radius: 8px; background: transparent; color: currentColor;
  cursor: pointer; opacity: .62; line-height: 0; }
.dshss-caret > svg { display: block; pointer-events: none; }
.dshss-caret:hover { opacity: 1; background: rgba(127,127,127,.16); }
.dshss-caret[data-open="1"] { opacity: 1; background: rgba(127,127,127,.2); }
.dshss-caret:disabled { opacity: .3; cursor: default; }
/* Dropdown card, built to match @deepseek-ai/dsh-client-ui-primitives Menu.module.css.
   Sizing follows the PRIMARY card scale (item: 13px text, 34px min-height, 6px/8px
   padding, radius-md rows, radius-lg card) — not the compactList variant, which is
   noticeably tighter than the menus the app actually shows in the composer.
   Theme tokens carry the light-theme literal as fallback so the card stays correct
   even when rendered outside the token scope. */
.dshss-menu { position: fixed; z-index: 2147483006;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 0;
  min-width: 180px; max-width: 360px; padding: 4px; border: 0;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  box-shadow: var(--dsw-elevation-prominent, 0 0 0 1px #00000014, 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d);
  font: 13px/20px system-ui, -apple-system, "Segoe UI", sans-serif; }
.dshss-menu-title { padding: 6px 8px; font-size: 11px; line-height: 15px;
  color: var(--dsw-alias-label-tertiary, #61666b); }
.dshss-menu-item { box-sizing: border-box; display: flex; align-items: center; gap: 6px;
  width: 100%; min-height: 34px; padding: 6px 8px;
  /* appearance:none is load-bearing: a <button> keeps its native chrome otherwise,
     which renders as a grey rounded box exactly like an unstyled control. */
  appearance: none; -webkit-appearance: none;
  border: 0; border-radius: var(--dsw-radius-md, 12px); background: transparent;
  cursor: pointer; font: inherit; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-primary, #0f1115); text-align: left; }
.dshss-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, #2631480f); }
.dshss-menu-item[data-on="1"] { background: var(--dsw-alias-interactive-bg-hover, #2631480f); }
/* Trailing marker: the label takes the free space, the hint and the check sit at
   the end of the row (mirrors the app's own select-style menus). */
.dshss-menu-mark { display: inline-flex; flex: none; width: 14px; height: 14px;
  margin-inline-start: auto; align-items: center; justify-content: center;
  color: var(--dsw-alias-menu-icon, #353638); }
.dshss-menu-hint { flex: none; margin-inline-start: 10px;
  color: var(--dsw-alias-label-tertiary, #61666b); font-size: 11px; line-height: 16px; }
.dshss-menu-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
`;

		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const el = document.createElement("style");
			el.id = STYLE_ID;
			el.textContent = CSS;
			document.head.appendChild(el);
		}

		async function api(path, options) {
			const res = await fetch(PREFIX + path, Object.assign(
				{ headers: { "Content-Type": "application/json" } }, options));
			const text = await res.text();
			let data = null;
			try { data = text === "" ? null : JSON.parse(text); } catch (e) { data = null; }
			if (!res.ok) throw new Error((data && data.error) || ("HTTP " + String(res.status)));
			return data;
		}

		function IconFrame() {
			return react.createElement("svg", {
				width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
				stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round",
				strokeLinejoin: "round", "aria-hidden": "true",
			},
				react.createElement("path", { d: "M2 5.2V3.4A1.4 1.4 0 0 1 3.4 2h1.8" }),
				react.createElement("path", { d: "M10.8 2h1.8A1.4 1.4 0 0 1 14 3.4v1.8" }),
				react.createElement("path", { d: "M14 10.8v1.8a1.4 1.4 0 0 1-1.4 1.4h-1.8" }),
				react.createElement("path", { d: "M5.2 14H3.4A1.4 1.4 0 0 1 2 12.6v-1.8" }),
				react.createElement("circle", { cx: 8, cy: 8, r: 2.1 })
			);
		}

		/** Small chevron marking the preference dropdown beside the capture tool. */
		function CaretIcon() {
			return react.createElement("svg", {
				width: 10, height: 10, viewBox: "0 0 10 10", fill: "none",
				stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round",
				strokeLinejoin: "round", "aria-hidden": "true",
			},
				react.createElement("path", { d: "M2.2 3.9 5 6.7l2.8-2.8" }),
			);
		}

		/**
		 * Full-screen snipping overlay over a frozen capture.
		 * @param {{shot: object, onDone: Function, onCancel: Function}} props
		 */
		function Overlay(props) {
			const shot = props.shot;
			const [sel, setSel] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [windows, setWindows] = react.useState([]);
			const [snapOn, setSnapOn] = react.useState(true);
			const [hover, setHover] = react.useState(null);
			const [toast, setToast] = react.useState(null);
			// Cursor for the point under the pointer: a resize arrow over a handle, a
			// move cursor inside the box, null for crosshair elsewhere.
			const [cursor, setCursor] = react.useState(null);
			const dragRef = react.useRef(null);
			// Mirrors `sel` for event handlers that must read the pre-drag selection
			// without re-subscribing on every selection change.
			const selRef = react.useRef(null);
			selRef.current = sel;

			const scale = shot.scale;
			const originX = shot.originX;
			const originY = shot.originY;
			const threshold = shot.snapThreshold || 12;

			react.useEffect(() => {
				let alive = true;
				// Tell the host whether this capture hid the Harness window. When it did,
				// that window must be excluded from the snap list: it is absent from the
				// frozen image, so snapping to its rectangle would frame empty desktop.
				const hideQuery = shot.hidOwn ? "?hideOwn=1" : "";
				// `start()` already kicked this request off alongside the capture, so by the
				// time the overlay is on screen the response is usually in hand. Falling
				// back to a fresh request keeps the overlay self-sufficient when it is
				// opened some other way.
				const request = shot.windowsPromise !== undefined
					? shot.windowsPromise
					: api("/windows" + hideQuery, { method: "GET" });
				request
					.then((data) => {
						if (!alive) return;
						// Drop windows that cover the ENTIRE screen. The intent was to keep
						// the desktop and full-screen overlay helpers out of the snap list,
						// but 0.85 also discarded ordinary maximized windows: a maximized
						// 2582x1550 window on a 2560x1600 screen is 97.7%, so pointing at it
						// found no target at all and the snap fell through to whichever small
						// window was left. Desktop windows never even reach this list (no
						// title, or flagged as tool windows), so this guard only has to catch
						// something that truly fills the display.
						const screenArea = shot.width * shot.height;
						const hideOwn = Boolean(shot.hidOwn);
						const usable = (data.windows || []).filter((w) => {
							if (hideOwn && w.own) return false;
							// The host already drops DWM-cloaked windows; this is a second
							// guard for older hosts that still report them.
							if (w.cloaked !== undefined && w.cloaked !== 0) return false;
							if (w.width * w.height >= screenArea * 0.995) return false;
							return true;
						});
						setWindows(usable);
					})
					.catch(() => undefined);
				return () => { alive = false; };
			}, [shot.width, shot.height, shot.hidOwn]);

			const toDoc = (clientX, clientY) => ({
				x: (clientX - originX) / scale,
				y: (clientY - originY) / scale,
			});
			const toView = (dx, dy) => ({
				x: dx * scale + originX,
				y: dy * scale + originY,
			});

			/**
			 * The window a point is over, or whose edge the point is near.
			 *
			 * The probe radius is deliberately generous (40 screen px): the point of
			 * snapping is to be forgiving, and a hit highlights the whole window so
			 * the target is obvious before the user commits to it.
			 */
			const findWindowAt = (p) => {
				const near = 40 / scale;

				// Choosing by area was wrong: with a large window on top of a small one,
				// the pointer sits on the large window but the small one still has the
				// smaller area, so the small — invisible at that spot — window won. The
				// enumeration comes from EnumWindows, which yields windows in Z order,
				// topmost first (verified against GetTopWindow + GW_HWNDNEXT), so the
				// first window that actually contains the point is the one on screen there.
				for (const w of windows) {
					const inside = p.x >= w.x && p.x <= w.x + w.width
						&& p.y >= w.y && p.y <= w.y + w.height;
					if (inside) return w;
				}

				// Outside every window: fall back to the nearest edge within the probe
				// radius, which keeps the generous snap tolerance for thin targets.
				let best = null;
				let bestDist = Infinity;
				for (const w of windows) {
					const within = p.x >= w.x - near && p.x <= w.x + w.width + near
						&& p.y >= w.y - near && p.y <= w.y + w.height + near;
					if (!within) continue;
					const dx = Math.max(w.x - p.x, 0, p.x - (w.x + w.width));
					const dy = Math.max(w.y - p.y, 0, p.y - (w.y + w.height));
					const dist = Math.hypot(dx, dy);
					if (dist < bestDist) { bestDist = dist; best = w; }
				}
				return best;
			};

			/**
			 * Snap-by-edge: pull a dragged rectangle's edges onto the nearest window
			 * edge within the threshold. This is the QQ/WeChat behaviour — the box
			 * clicks into place as it approaches a window border.
			 *
			 * @param {object} rect
			 * @param {{x:number,y:number}|undefined} pointer - current pointer position.
			 *   When the pointer is over a window, ONLY that window may snap: it is the
			 *   one the user sees there. Without this, a window hidden underneath — e.g.
			 *   a small window fully covered by a larger one, which is a common layout —
			 *   could capture the snap merely because its edge was a few pixels nearer,
			 *   so dragging inside the visible window snapped to an invisible one.
			 */
			const findSnap = (rect, pointer) => {
				if (!snapOn) return null;
				const t = threshold / scale;
				const reach = t * 3;

				const under = pointer === undefined ? null : findWindowAt(pointer);
				const candidates = under === null ? windows : [under];

				let best = null;
				let score = Infinity;
				for (const w of candidates) {
					const d = {
						l: Math.abs(rect.x - w.x),
						t: Math.abs(rect.y - w.y),
						r: Math.abs(rect.x + rect.width - (w.x + w.width)),
						b: Math.abs(rect.y + rect.height - (w.y + w.height)),
					};
					const s = Math.min(d.l, d.r) + Math.min(d.t, d.b);
					// Only a clearly nearer edge displaces the incumbent, so an exact tie
					// keeps the window earlier in the list — which is the one higher in the
					// stack, since the list arrives in Z order.
					if (s < score - 0.5 && Math.min(d.l, d.r) <= reach && Math.min(d.t, d.b) <= reach) {
						score = s;
						best = { w: w, d: d, t: t };
					}
				}
				return best;
			};

			const applySnap = (rect, pointer) => {
				const hit = findSnap(rect, pointer);
				if (hit === null) return rect;
				const w = hit.w;
				const out = Object.assign({}, rect);
				if (hit.d.l <= hit.t) out.x = w.x;
				else if (hit.d.r <= hit.t) out.x = w.x + w.width - out.width;
				if (hit.d.t <= hit.t) out.y = w.y;
				else if (hit.d.b <= hit.t) out.y = w.y + w.height - out.height;
				return out;
			};

			const normalise = (a, b) => ({
				x: Math.round(Math.min(a.x, b.x)),
				y: Math.round(Math.min(a.y, b.y)),
				width: Math.round(Math.abs(a.x - b.x)),
				height: Math.round(Math.abs(a.y - b.y)),
			});

			/**
			 * Which resize handle a document-space point grabs, if any.
			 *
			 * Handles are hit-tested here rather than given pointer handlers of their
			 * own, so a single pointerdown path covers creating, moving and resizing,
			 * and the hit area can be larger than the 9px marker it draws.
			 *
			 * @returns {string|null} one of nw/n/ne/e/se/s/sw/w, or null.
			 */
			const handleAt = (p) => {
				const box = selRef.current;
				if (box === null || box.width < 4 || box.height < 4) return null;
				const r = 7 / scale;
				const xs = [box.x, box.x + box.width / 2, box.x + box.width];
				const ys = [box.y, box.y + box.height / 2, box.y + box.height];
				const cols = ["w", "", "e"];
				const rows = ["n", "", "s"];
				for (let iy = 0; iy < 3; iy += 1) {
					for (let ix = 0; ix < 3; ix += 1) {
						if (ix === 1 && iy === 1) continue;
						if (Math.abs(p.x - xs[ix]) <= r && Math.abs(p.y - ys[iy]) <= r) {
							return rows[iy] + cols[ix];
						}
					}
				}
				return null;
			};

			/** True when a point sits inside the current selection. */
			const insideSel = (p) => {
				const box = selRef.current;
				if (box === null) return false;
				return p.x >= box.x && p.x <= box.x + box.width
					&& p.y >= box.y && p.y <= box.y + box.height;
			};

			/** Cursor that matches the handle under the pointer. */
			const CURSORS = {
				nw: "nwse-resize", se: "nwse-resize",
				ne: "nesw-resize", sw: "nesw-resize",
				n: "ns-resize", s: "ns-resize",
				e: "ew-resize", w: "ew-resize",
			};

			/**
			 * Resize a selection by moving the edges its handle names.
			 *
			 * Edges are clamped to the captured image instead of being allowed to cross
			 * the opposite edge. Crossing looks like a bug in practice: once the pointer
			 * runs past the screen edge, the box folds back on itself while the user is
			 * still dragging outward, so the selection appears to grow the wrong way.
			 *
			 * @param {object} sel0 - selection before the drag.
			 * @param {string} handle - nw/n/ne/e/se/s/sw/w.
			 * @param {number} dx - document-space delta X.
			 * @param {number} dy - document-space delta Y.
			 */
			const resizeBy = (sel0, handle, dx, dy) => {
				let left = sel0.x;
				let top = sel0.y;
				let right = sel0.x + sel0.width;
				let bottom = sel0.y + sel0.height;

				if (handle.includes("w")) left = Math.max(0, Math.min(sel0.x + dx, right - 1));
				if (handle.includes("e")) right = Math.min(shot.width, Math.max(sel0.x + sel0.width + dx, left + 1));
				if (handle.includes("n")) top = Math.max(0, Math.min(sel0.y + dy, bottom - 1));
				if (handle.includes("s")) bottom = Math.min(shot.height, Math.max(sel0.y + sel0.height + dy, top + 1));

				return {
					x: Math.round(left), y: Math.round(top),
					width: Math.round(right - left), height: Math.round(bottom - top),
				};
			};

			/**
			 * Keep a selection inside the captured image.
			 *
			 * The host clamps a crop to the image bounds anyway, so an out-of-range box
			 * would silently produce a different picture than the one on screen. Nudging
			 * and dragging the box therefore stop at the edge instead of sliding off it.
			 *
			 * @param {object} box
			 * @returns {object} the same box, shifted back inside when needed.
			 */
			const clampSel = (box) => {
				const w = Math.max(1, Math.min(box.width, shot.width));
				const h = Math.max(1, Math.min(box.height, shot.height));
				return {
					x: Math.max(0, Math.min(box.x, shot.width - w)),
					y: Math.max(0, Math.min(box.y, shot.height - h)),
					width: w, height: h,
				};
			};

			const onDown = (event) => {
				if (event.button !== 0) return;
				if (event.target && event.target.closest && event.target.closest(".dshss-bar") !== null) return;
				// Keep focus in the page: the pointer handlers are the only input path,
				// and a focused button would swallow the arrow-key nudge.
				event.preventDefault();
				if (typeof document.activeElement?.blur === "function") document.activeElement.blur();
				const p = toDoc(event.clientX, event.clientY);
				const handle = handleAt(p);
				if (handle !== null) {
					dragRef.current = { mode: "resize", handle, start: p, before: selRef.current };
				} else if (insideSel(p)) {
					dragRef.current = { mode: "move", start: p, before: selRef.current };
				} else {
					dragRef.current = { mode: "create", start: p, before: selRef.current };
					setSel({ x: p.x, y: p.y, width: 0, height: 0 });
				}
				setHover(null);
				if (typeof event.currentTarget.setPointerCapture === "function") {
					event.currentTarget.setPointerCapture(event.pointerId);
				}
			};

			const onMove = (event) => {
				const p = toDoc(event.clientX, event.clientY);
				const drag = dragRef.current;
				if (drag === null) {
					// Not dragging: reflect what this point would grab, and highlight the
					// window under the pointer so the snap target is visible up front.
					const h = handleAt(p);
					if (h !== null) setCursor(CURSORS[h]);
					else if (insideSel(p)) setCursor("move");
					else setCursor(null);
					setHover(snapOn ? findWindowAt(p) : null);
					return;
				}
				if (drag.mode === "resize") {
					setSel(clampSel(resizeBy(drag.before, drag.handle, p.x - drag.start.x, p.y - drag.start.y)));
					setHover(null);
					return;
				}
				if (drag.mode === "move") {
					setSel(clampSel({
						x: Math.round(drag.before.x + (p.x - drag.start.x)),
						y: Math.round(drag.before.y + (p.y - drag.start.y)),
						width: drag.before.width, height: drag.before.height,
					}));
					setHover(null);
					return;
				}
				const rect = normalise(drag.start, p);
				if (event.shiftKey) { setSel(rect); setHover(null); return; }
				const snapped = applySnap(rect, p);
				setSel(snapped);
				// Highlight whatever the box is currently locked onto, or failing that
				// the window under the pointer.
				const hit = findSnap(rect, p);
				setHover(hit !== null ? hit.w : findWindowAt(p));
			};

			const onUp = (event) => {
				const drag = dragRef.current;
				dragRef.current = null;
				if (drag === null) return;
				// Adjusting an existing selection: the value was already committed by the
				// move handler, and a click without movement must leave it untouched.
				if (drag.mode !== "create") { setHover(null); return; }
				const p = toDoc(event.clientX, event.clientY);
				const rect = normalise(drag.start, p);
				// A click without a drag (tiny box) inside a window selects that whole
				// window: the fastest way to grab one. Shift means "no snapping at all",
				// so it disables this shortcut too rather than leaving an empty box.
				const tiny = rect.width < 6 && rect.height < 6;
				const under = snapOn && !event.shiftKey ? findWindowAt(p) : null;
				if (tiny && under !== null) {
					setSel({ x: under.x, y: under.y, width: under.width, height: under.height });
				} else if (tiny && event.shiftKey) {
					// Shift means "no snapping"; a bare click must not wipe an existing
					// selection with a zero-size box, so restore what was selected before
					// the pointer went down.
					setSel(drag.before ?? null);
				} else {
					setSel(event.shiftKey ? rect : applySnap(rect, p));
				}
				setHover(null);
			};

			const confirm = react.useCallback(async (action) => {
				if (sel === null || sel.width < 2 || sel.height < 2) return;
				setBusy(true);
				setError(null);
				try {
					const cropped = await api("/crop", {
						method: "POST",
						body: JSON.stringify({
							file: shot.file, x: sel.x, y: sel.y, width: sel.width, height: sel.height,
						}),
					});
					await api("/commit", {
						method: "POST",
						body: JSON.stringify({ png: cropped.png, action: action }),
					});
					await api("/cleanup", { method: "POST", body: JSON.stringify({ files: [shot.file] }) }).catch(() => undefined);
					// Hand the finished PNG to the caller so it can drop it straight
					// into the composer instead of making the user paste manually.
					props.onDone(
						action === "clipboard" ? "已复制到剪贴板" : "已保存",
						typeof cropped.png === "string" ? cropped.png : "",
					);
				} catch (e) {
					setError(String(e.message || e));
					setBusy(false);
				}
			}, [sel, shot.file, props]);

			const cancel = react.useCallback(async () => {
				await api("/cleanup", { method: "POST", body: JSON.stringify({ files: [shot.file] }) }).catch(() => undefined);
				props.onCancel();
			}, [shot.file, props]);

			react.useEffect(() => {
				const ARROWS = {
					ArrowLeft: [-1, 0], ArrowRight: [1, 0],
					ArrowUp: [0, -1], ArrowDown: [0, 1],
				};
				const onKey = (event) => {
					if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
					if (event.key === "Enter") { event.preventDefault(); confirm("clipboard"); return; }
					if ((event.ctrlKey || event.metaKey) && (event.key === "c" || event.key === "C")) {
						event.preventDefault();
						confirm("clipboard");
						return;
					}
					// Nudge the selection. Ctrl resizes instead of moving, so the two
					// operations do not need separate modifier families.
					const arrow = ARROWS[event.key];
					if (arrow !== undefined && selRef.current !== null) {
						event.preventDefault();
						const box = selRef.current;
						const step = event.altKey ? 10 : 1;
						const dx = arrow[0] * step;
						const dy = arrow[1] * step;
						if (event.ctrlKey || event.metaKey) {
							setSel(clampSel({
								x: box.x, y: box.y,
								width: Math.max(1, box.width + dx),
								height: Math.max(1, box.height + dy),
							}));
						} else {
							setSel(clampSel({ x: box.x + dx, y: box.y + dy, width: box.width, height: box.height }));
						}
						return;
					}
					if ((event.key === "s" || event.key === "S") && !event.ctrlKey && !event.metaKey) {
						setSnapOn((v) => !v);
					}
				};
				window.addEventListener("keydown", onKey, true);
				return () => window.removeEventListener("keydown", onKey, true);
			}, [confirm, cancel]);

			react.useEffect(() => {
				if (toast === null) return undefined;
				const timer = window.setTimeout(() => setToast(null), 2000);
				return () => window.clearTimeout(timer);
			}, [toast]);

			// Selection geometry in viewport coordinates.
			let selStyle = null;
			if (sel !== null) {
				const tl = toView(sel.x, sel.y);
				selStyle = { left: tl.x, top: tl.y, width: sel.width * scale, height: sel.height * scale };
			}

			// Toolbar placement, in SCREEN coordinates. The render step converts to the
			// layer's own origin. Before a selection exists it sits at the bottom centre:
			// the Harness chrome runs along the top of the window, so parking the toolbar
			// there would cover it. After a selection it follows the box.
			let barStyle = { left: "50%", top: window.innerHeight - 74, transform: "translateX(-50%)" };
			if (selStyle !== null) {
				const below = selStyle.top + selStyle.height + 8;
				const above = selStyle.top - 46;
				// Prefer below the box, but keep the toolbar clear of the top safe strip
				// and inside the viewport in both directions.
				const fits = below + 46 < window.innerHeight - TOP_SAFE - 8;
				barStyle = {
					transform: "none",
					left: Math.max(8, Math.min(selStyle.left, Math.max(8, window.innerWidth - 442))),
					top: fits ? below : Math.max(TOP_SAFE + 8, above),
				};
			}

			const handles = [];
			if (selStyle !== null) {
				for (const fx of [0, 0.5, 1]) {
					for (const fy of [0, 0.5, 1]) {
						if (fx === 0.5 && fy === 0.5) continue;
						handles.push(react.createElement("div", {
							key: "h" + String(fx) + String(fy),
							className: "dshss-handle",
							style: {
								left: selStyle.left + selStyle.width * fx,
								// selStyle is in screen coordinates; the handles live inside the
								// layer, whose origin is TOP_SAFE below the viewport top.
								top: selStyle.top + selStyle.height * fy - TOP_SAFE,
							},
						}));
					}
				}
			}

			let hoverStyle = null;
			if (hover !== null) {
				const tl = toView(hover.x, hover.y);
				hoverStyle = { left: tl.x, top: tl.y, width: hover.width * scale, height: hover.height * scale };
			}

			let sizeLabel = null;
			if (selStyle !== null && sel.width > 0 && sel.height > 0) {
				const top = selStyle.top + selStyle.height + 6;
				// Same coordinate shift as the handles: render inside the layer.
				sizeLabel = react.createElement("div", {
					className: "dshss-size",
					style: {
						left: selStyle.left,
						top: (top + 40 < window.innerHeight ? top : Math.max(TOP_SAFE + 4, selStyle.top - 22)) - TOP_SAFE,
					},
				}, String(sel.width) + " × " + String(sel.height));
			}

			const shotStyle = { left: originX, top: originY, width: shot.width * scale, height: shot.height * scale };
			const ready = !busy && sel !== null && sel.width >= 2 && sel.height >= 2;

			// Everything below the safe strip: dimmer, frozen shot, overlays and the
			// pointer handlers. The root itself has pointer-events: none, so the strip
			// above this layer lets clicks fall through to the Harness menus.
			return react.createElement("div", { className: "dshss-root" },
				react.createElement("div", {
					className: "dshss-layer",
					style: {
						position: "absolute", left: 0, right: 0, top: TOP_SAFE, bottom: 0,
						pointerEvents: "auto",
						// Crosshair to draw, resize arrow over a handle, move cursor
						// inside the box — resolved from the pointer position.
						cursor: cursor !== null ? cursor : "crosshair",
					},
					onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp,
					onContextMenu: (event) => { event.preventDefault(); cancel(); },
				},
					react.createElement("div", { className: "dshss-dim", style: { top: 0 } }),
					react.createElement("img", {
						className: "dshss-shot",
						src: shot.png,
						// shotStyle is in screen coordinates and the layer starts TOP_SAFE below
						// the viewport top, so shift by that. The capture is fitted inside the
						// safe area, so it normally needs no clipping; inset() guards the case
						// where the window is shorter than the reserve.
						style: Object.assign({}, shotStyle, {
							top: shotStyle.top - TOP_SAFE,
							clipPath: shotStyle.top < TOP_SAFE
								? "inset(" + String(TOP_SAFE - shotStyle.top) + "px 0 0 0)"
								: "none",
						}),
					}),
					hoverStyle === null ? null : react.createElement("div", {
						className: "dshss-snap",
						style: Object.assign({}, hoverStyle, { top: hoverStyle.top - TOP_SAFE }),
					}),
					selStyle === null ? null : react.createElement("div", {
						className: "dshss-sel",
						style: Object.assign({}, selStyle, { top: selStyle.top - TOP_SAFE }),
					}),
					...handles,
					sizeLabel,
					react.createElement("div", {
						className: "dshss-bar",
						style: Object.assign({}, barStyle, { top: Math.max(0, barStyle.top - TOP_SAFE) }),
					},
					react.createElement("button", {
						className: "dshss-btn", "data-primary": "1", disabled: !ready,
						title: "完成：把选中的截图送进对话框（Enter 或 Ctrl+C）",
						onClick: () => confirm("clipboard"),
					}, busy ? "处理中…" : "完成 ⏎"),
					react.createElement("button", {
						className: "dshss-btn", "data-on": snapOn ? "1" : "0",
						title: "自动吸附窗口边缘（S 切换；拖拽时按住 Shift 临时禁用）\n"
							+ "也可直接单击某个窗口选中它\n"
							+ "方向键微调位置 · Ctrl+方向键改大小 · Alt 加速 10px",
						onClick: () => setSnapOn((v) => !v),
					}, "吸附"),
					react.createElement("button", { className: "dshss-btn", onClick: cancel }, "取消 Esc"),
					),
					error === null ? null : react.createElement("div", { className: "dshss-err" }, error),
					toast === null ? null : react.createElement("div", { className: "dshss-hint" }, toast),
				),
			);
		}

		/** Composer tool-row control: left click follows the saved preference. */
		const PREF_KEY = "dsh-screenshot.hideOwn";

		/** Saved default: "1" hide the Harness window, "0" keep it. Defaults to hide. */
		function readHideOwn() {
			try {
				const raw = window.localStorage.getItem(PREF_KEY);
				if (raw === "0") return false;
				if (raw === "1") return true;
			} catch (e) { /* private mode or storage disabled: fall through */ }
			return true;
		}

		function writeHideOwn(value) {
			try { window.localStorage.setItem(PREF_KEY, value ? "1" : "0"); } catch (e) { /* ignore */ }
		}

		/**
		 * Hand a captured PNG to the composer as if the user pasted it.
		 *
		 * The composer is a Lexical editor whose own paste handler reads
		 * `event.clipboardData.items` and calls `getAsFile()` on every file item
		 * (dsh-client-ui-conversation, `editor.registerCommand(<paste>, ...)`), so a
		 * synthetic ClipboardEvent reaches exactly the code path a real Ctrl+V uses.
		 * No DSH internal API is touched.
		 *
		 * @returns {Promise<boolean>} whether a file item was handed to the editor.
		 */
		async function insertIntoComposer(dataUrl) {
			// A session may render more than one editor; take the visible one, which
			// is the composer the user is actually typing into.
			const editors = document.querySelectorAll('[data-lexical-editor="true"]');
			let editor = null;
			for (const candidate of editors) {
				const box = candidate.getBoundingClientRect();
				if (box.width > 0 && box.height > 0) editor = candidate;
			}
			if (editor === null) editor = editors[0] ?? null;
			if (editor === null) return false;

			const comma = dataUrl.indexOf(",");
			const binary = window.atob(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

			const file = new window.File([bytes], "screenshot-" + String(Date.now()) + ".png", { type: "image/png" });
			const transfer = new window.DataTransfer();
			transfer.items.add(file);

			// focus() first: the paste command runs against the focused editor.
			editor.focus();

			// Both keys are supplied on purpose. ClipboardEventInit is specified as
			// `dataTransfer`, while the read-only event property every consumer uses is
			// `clipboardData`; setting both keeps the event valid whichever the
			// implementation honours.
			let event = null;
			try {
				event = new window.ClipboardEvent("paste", {
					dataTransfer: transfer,
					clipboardData: transfer,
					bubbles: true,
					cancelable: true,
					composed: true,
				});
			} catch (e) {
				event = new window.ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true });
			}
			// Some engines ignore constructor init for clipboardData: define it directly.
			if (event.clipboardData === null || event.clipboardData === undefined) {
				try {
					Object.defineProperty(event, "clipboardData", { value: transfer, configurable: true });
				} catch (e) { /* leave as-is and let the caller report failure */ }
			}
			if (event.clipboardData === null || event.clipboardData === undefined) return false;

			// A native event would carry isTrusted=true, which cannot be forged; the
			// Lexical handler does not check it, so a synthetic dispatch works.
			editor.dispatchEvent(event);
			return true;
		}

		/**
		 * Small popover choosing the default capture behaviour.
		 *
		 * The check sits AFTER the label (trailing marker, mirroring the app's own
		 * select-style menus) and the card is anchored to the capture button's own left
		 * edge, which the caller passes in as `left`.
		 */
		function PrefMenu(props) {
			const item = (value, text, hint) => react.createElement("button", {
				className: "dshss-menu-item",
				"data-on": props.value === value ? "1" : "0",
				onClick: () => { props.onPick(value); },
			},
				react.createElement("span", { className: "dshss-menu-text" }, text),
				hint === undefined ? null : react.createElement("span", { className: "dshss-menu-hint" }, hint),
				react.createElement("span", { className: "dshss-menu-mark" },
					props.value === value
						? react.createElement("svg", {
							width: 14, height: 14, viewBox: "0 0 14 14", fill: "none",
							stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round",
							strokeLinejoin: "round", "aria-hidden": "true",
						}, react.createElement("path", { d: "M2.8 7.2 5.6 10 11.2 4.2" }))
						: null),
			);

			// Anchored in viewport coordinates so the card's left edge lines up with the
			// capture button and no ancestor's overflow can clip it.
			const anchor = props.anchor;
			const style = anchor === null
				? { left: 0, bottom: 36 }
				: {
					left: Math.round(anchor.left),
					bottom: Math.round(window.innerHeight - anchor.top + 6),
				};

			return react.createElement("div", {
				className: "dshss-menu",
				style: style,
				onMouseLeave: props.onClose,
			},
				react.createElement("div", { className: "dshss-menu-title" }, "截图默认行为"),
				item(true, "隐藏 DSH 窗口", "截图不含本窗口"),
				item(false, "保留 DSH 窗口", "截图包含本窗口"),
			);
		}

		function CaptureButton() {
			const [busy, setBusy] = react.useState(false);
			const [overlay, setOverlay] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [toast, setToast] = react.useState(null);
			const [hideOwn, setHideOwn] = react.useState(readHideOwn);
			const [menu, setMenu] = react.useState(false);
			// Viewport rect of the capture button, captured when the menu opens so the
			// card's left edge can line up with the button's left edge.
			const [anchor, setAnchor] = react.useState(null);
			const toolRef = react.useRef(null);

			const toggleMenu = react.useCallback(() => {
				setMenu((open) => {
					if (open) return false;
					const node = toolRef.current;
					if (node !== null && typeof node.getBoundingClientRect === "function") {
						const box = node.getBoundingClientRect();
						setAnchor({ left: box.left, top: box.top, bottom: box.bottom });
					}
					return true;
				});
			}, []);

			const start = react.useCallback(async (useHideOwn) => {
				setBusy(true);
				setError(null);
				setMenu(false);
				try {
					// Prefetch the snap targets in parallel with the capture.
					//
					// Enumerating windows costs a full PowerShell launch, so /windows takes
					// over a second even after the host stopped enumerating twice. Fetching
					// it from the overlay meant the snap list was still empty for that whole
					// time, so moving the pointer over a window produced no highlight and
					// snapping appeared "broken" right after the overlay appeared.
					//
					// A capture takes at least as long, so starting both at once hides the
					// enumeration entirely. hideOwn is the intent here, which matches what
					// /windows expects; the result is a pre-capture snapshot, and window
					// positions do not move during a capture.
					const windowsPromise = api("/windows" + (useHideOwn ? "?hideOwn=1" : ""), { method: "GET" })
						.catch(() => ({ windows: [] }));
					const shot = await api("/capture", {
						method: "POST",
						body: JSON.stringify({ mode: "fullscreen", hideOwn: useHideOwn }),
					});
					// Fit the whole capture INSIDE the area below the top safe strip, keeping
					// the aspect ratio. Scaling against the full window height would push the
					// top of the picture under the Harness chrome; reserving TOP_SAFE first
					// shrinks it just enough to stay clear.
					const availW = window.innerWidth;
					const availH = Math.max(1, window.innerHeight - TOP_SAFE);
					const scale = Math.min(availW / shot.width, availH / shot.height);
					shot.scale = scale;
					const drawnW = shot.width * scale;
					const drawnH = shot.height * scale;
					shot.originX = Math.round((availW - drawnW) / 2);
					shot.originY = Math.round(TOP_SAFE + (availH - drawnH) / 2);
					shot.windowsPromise = windowsPromise;
					setOverlay(shot);
				} catch (e) {
					setError(String(e.message || e));
				} finally {
					setBusy(false);
				}
			}, []);

			react.useEffect(() => {
				if (toast === null) return undefined;
				const timer = window.setTimeout(() => setToast(null), 2600);
				return () => window.clearTimeout(timer);
			}, [toast]);

			return react.createElement(react.Fragment, null,
				react.createElement("span", { className: "dshss-group" },
					react.createElement("button", {
						ref: toolRef,
						className: "dshss-tool",
						"data-busy": busy ? "1" : "0",
						"data-pref": hideOwn ? "hide" : "keep",
						disabled: busy,
						title: error !== null
							? ("截图失败：" + error)
							: ("截图（" + (hideOwn ? "隐藏本窗口" : "保留本窗口") + "）"),
						onClick: () => start(hideOwn),
					}, react.createElement(IconFrame, null)),
					react.createElement("button", {
						className: "dshss-caret",
						"data-open": menu ? "1" : "0",
						disabled: busy,
						title: "选择截图默认行为",
						onClick: toggleMenu,
					}, react.createElement(CaretIcon, null)),
				),
				menu ? react.createElement(PrefMenu, {
					value: hideOwn,
					anchor: anchor,
					onPick: (value) => { writeHideOwn(value); setHideOwn(value); setMenu(false); },
					onClose: () => setMenu(false),
				}) : null,
				overlay === null ? null : react.createElement(Overlay, {
					shot: overlay,
					onDone: async (message, dataUrl) => {
						setOverlay(null);
						setToast(message);
						if (typeof dataUrl !== "string" || dataUrl === "") return;
						// Put the finished selection straight into the composer.
						try {
							const ok = await insertIntoComposer(dataUrl);
							setToast(ok ? "已直接插入对话框" : message);
						} catch (e) {
							setToast(message + "（自动插入失败，已复制到剪贴板）");
						}
					},
					onCancel: () => setOverlay(null),
				}),
				toast === null ? null : react.createElement("div", { className: "dshss-hint" }, toast),
				error !== null && overlay === null ? react.createElement("div", { className: "dshss-err" }, error) : null,
			);
		}

		/**
		 * The services this browser half needs.
		 *
		 * These are CLIENT service names, not npm package names: every working
		 * client bundle on this machine declares its own, e.g.
		 *   dsh-rewind-plugin : ["slots", "sessions", "locale", "commandUi", "configForms"]
		 *   dsh-context       : ["slots", "locale"]
		 *   dsh-mnemon        : ["slots", "sessions", "workspaces", "uiSession", "connection", "locale", "layout"]
		 * A client bundle that omits `inject` never reports the service it needs,
		 * so the web boot audit records the entry as not activated.
		 */
		const inject = ["slots"];

		/** Cordis plugin body for the browser half. */
		function apply(ctx) {
			ensureStyles();

			// `conversation.input.left` is a list slot: id, order and label form the
			// registration contract; the component is the second argument.
			const dispose = ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "dsh-screenshot",
				order: 42,
				label: () => "截图",
			}, CaptureButton));

			ctx.effect(() => () => {
				if (typeof dispose === "function") dispose();
				const el = document.getElementById(STYLE_ID);
				if (el !== null) el.remove();
			});
		}

		exports.name = "dsh-plugin-screenshot";
		exports.inject = inject;
		exports.apply = apply;
		return exports;
	},
});
