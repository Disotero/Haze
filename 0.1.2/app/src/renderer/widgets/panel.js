// The day panel (calendar, alarms, power timer) opening over the widgets.
// Extracted from widgets.js unchanged (A3).
import { createDayPanel } from "./calendar.js";
import { moveTo, rectOf, overlaps, clampRect, GAP } from "./layout.js";

/**
 * `board` — the widgets board; `ctx` — the widget context (createDayPanel);
 * `getMounted()` — mounted widgets; `setHit`/`trackClipFor`/`updateClip` —
 * the shared interaction helpers.
 */
export function createPanel({ board, ctx, getMounted, setHit, trackClipFor, updateClip }) {
  let panel = null;
  let scrim = null;

  function openPanel(anchor, opts) {
    if (panel) return closePanel();
    scrim = Object.assign(document.createElement("div"), { className: "scrim" });
    scrim.addEventListener("pointerdown", closePanel);
    panel = createDayPanel(ctx, opts);
    panel.el.querySelector(".panel-close").onclick = closePanel;
    board.append(scrim, panel.el);
    moveTo(panel.el, panelSpot(anchor, panel.el.offsetWidth, panel.el.offsetHeight));
    setHit(true);
    trackClipFor(700);
  }

  function closePanel() {
    if (!panel) return;
    panel.destroy();
    scrim?.remove();
    panel = scrim = null;
    requestAnimationFrame(updateClip);
  }

  /**
   * Where the day panel goes: beside, below or above the anchor — whichever
   * covers the fewest other widgets; ties go to the roomier side.
   */
  function panelSpot(anchor, pw, ph) {
    const a = anchor?.getBoundingClientRect() || { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3 };
    const fit = (x, y) =>
      clampRect({ x, y, w: pw, h: ph });
    const candidates = [
      fit(a.right + GAP, a.top), // right
      fit(a.left - GAP - pw, a.top), // left
      fit(a.left, a.bottom + GAP), // below
      fit(a.left, a.top - GAP - ph), // above
      fit((innerWidth - pw) / 2, (innerHeight - ph) / 2), // centre
    ];
    const others = Object.values(getMounted())
      .filter((w) => w.el !== anchor)
      .map((w) => rectOf(w.el));
    const overlap = (r) =>
      others.reduce((sum, o) => {
        const w = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x);
        const h = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y);
        return sum + (w > 0 && h > 0 ? w * h : 0);
      }, 0);
    // Covering the anchor itself is the worst outcome.
    const ar = { x: a.left, y: a.top, w: a.right - a.left, h: a.bottom - a.top };
    const score = (r, i) => overlap(r) + (overlaps(r, ar) ? 1e9 : 0) + i * 10;
    return candidates.reduce((best, r, i) => (score(r, i) < score(best.r, best.i) ? { r, i } : best), { r: candidates[0], i: 0 }).r;
  }

  document.addEventListener("keydown", (e) => e.key === "Escape" && closePanel());

  return { openPanel, closePanel, get: () => panel };
}
