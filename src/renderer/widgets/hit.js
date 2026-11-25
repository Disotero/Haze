// Hit testing: the widgets window ignores the mouse except over glass and
// digits, so the desktop stays clickable everywhere else. Extracted from
// widgets.js unchanged (A3) — same listeners, same order, same state.
import { rectOf } from "./layout.js";

const HIT_MARGIN = 10;
const HIT_SEL = ".glass, .digits, .grip, .grip-r, .grip-b, .scrim, .ring-card";

/**
 * `getMounted()` — the mounted widgets (for their card rects);
 * `isDragging()` — a drag in progress suspends re-testing.
 */
export function createHit({ getMounted, isDragging = () => false }) {
  let hit = false;

  // Card rectangles, measured once per layout change instead of on every
  // mouse move (each measurement forces a layout pass).
  let rectCache = null;
  function invalidateRects() {
    rectCache = null;
  }
  function cardRects() {
    return (rectCache ||= Object.values(getMounted()).map((w) => rectOf(w.el)));
  }

  /** Within HIT_MARGIN px of a visible card. */
  function nearCard(x, y) {
    return cardRects().some(
      (r) => x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN && y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN
    );
  }

  /**
   * Tell main whether the pointer is over a card (the window then takes the
   * mouse) or not (clicks go through to the desktop). `force` re-sends an
   * unchanged state: main re-arms mouse forwarding on every report.
   */
  function setHit(v, force = false) {
    if (v !== hit || force) {
      hit = v;
      window.cozy.setHit(v);
    }
  }

  document.addEventListener("mousemove", (e) => {
    if (isDragging()) return;
    const over = (e.target instanceof Element && e.target.closest(HIT_SEL)) || nearCard(e.clientX, e.clientY);
    setHit(Boolean(over));
  });
  // Entering and leaving cards report too: one more path in, should mouse
  // moves stop arriving.
  document.addEventListener(
    "pointerenter",
    (e) => !isDragging() && e.target instanceof Element && e.target.matches(HIT_SEL) && setHit(true),
    true
  );
  document.addEventListener(
    "pointerleave",
    (e) => {
      if (isDragging() || !(e.target instanceof Element) || !e.target.matches(HIT_SEL)) return;
      const to = e.relatedTarget;
      setHit(Boolean(to instanceof Element && to.closest(HIT_SEL)) || nearCard(e.clientX, e.clientY));
    },
    true
  );
  document.addEventListener("mouseleave", () => !isDragging() && setHit(false));
  // Main asks after showing or re-pinning the window; the page itself after
  // it becomes visible or gets focus.
  window.cozy.onWidgetsRearm(() => setHit(hit, true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && setHit(hit, true));
  addEventListener("focus", () => setHit(hit, true));

  return { setHit, invalidateRects, nearCard };
}
