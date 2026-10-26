// Widget geometry: visible card boxes (inset), collisions, free spots and
// magnetic snap guides. Pure functions of the elements and the window size.

export const zOf = (el) => Number(el.dataset.z) || 1;

export const MARGIN = 28;
// Widgets at the bottom keep clear of the tray shelf and the dock's reveal zone.
export const BOTTOM_SAFE = 78;
export const GAP = 16;
export const SNAP = 12; // an edge this close to a guide jumps onto it
export const RELEASE = 26; // …and stays there until pulled this far past it
export const NEAR = 90; // guides only come from widgets within this distance

export function clampPos(el, x, y) {
  const z = zOf(el);
  return {
    x: Math.round(Math.max(0, Math.min(innerWidth - el.offsetWidth * z, x))),
    y: Math.round(Math.max(0, Math.min(innerHeight - el.offsetHeight * z, y))),
  };
}

export function moveTo(el, p) {
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
}

// Collisions and magnets work on what you can see: the big clock's box is
// wider than its digits and date tile. inset = visible part within the box.
export function insetOf(el) {
  const z = zOf(el);
  // offset* are layout values: unaffected by the entry animation's transform.
  const parts = [...el.querySelectorAll(":scope > .glass, :scope > .digits")];
  if (!parts.length) return { l: 0, t: 0, w: el.offsetWidth * z, h: el.offsetHeight * z };
  const l = Math.min(...parts.map((p) => p.offsetLeft));
  const t = Math.min(...parts.map((p) => p.offsetTop));
  const r = Math.max(...parts.map((p) => p.offsetLeft + p.offsetWidth));
  const b = Math.max(...parts.map((p) => p.offsetTop + p.offsetHeight));
  return { l: Math.round(l * z), t: Math.round(t * z), w: Math.round((r - l) * z), h: Math.round((b - t) * z) };
}
export function boxToRect(el, x, y) {
  const i = insetOf(el);
  return { x: x + i.l, y: y + i.t, w: i.w, h: i.h };
}
export function rectToBox(el, r) {
  const i = insetOf(el);
  return { x: r.x - i.l, y: r.y - i.t };
}
export const rectOf = (el) => boxToRect(el, el.offsetLeft, el.offsetTop);
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const collides = (r, rects) => rects.some((o) => overlaps(r, o));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function clampRect(r) {
  return {
    ...r,
    x: Math.round(Math.max(0, Math.min(innerWidth - r.w, r.x))),
    y: Math.round(Math.max(0, Math.min(innerHeight - r.h, r.y))),
  };
}

/**
 * Nearest position to `r` where it overlaps none of `rects`: tries stepping
 * past each blocking widget (GAP away) on all four sides, a few levels deep.
 * Returns `r` unchanged when it's already free or there is no room at all.
 */
export function freeSpot(r, rects) {
  if (!collides(r, rects)) return r;
  let frontier = [r];
  for (let depth = 0; depth < 3; depth++) {
    const next = [];
    for (const c of frontier) {
      for (const o of rects) {
        if (!overlaps(c, o)) continue;
        next.push(
          clampRect({ ...c, x: o.x - GAP - c.w }),
          clampRect({ ...c, x: o.x + o.w + GAP }),
          clampRect({ ...c, y: o.y - GAP - c.h }),
          clampRect({ ...c, y: o.y + o.h + GAP })
        );
      }
    }
    const free = next.filter((c) => !collides(c, rects));
    if (free.length) return free.reduce((a, b) => (dist(a, r) <= dist(b, r) ? a : b));
    frontier = next.sort((a, b) => dist(a, r) - dist(b, r)).slice(0, 24);
  }
  return r;
}

/** Snap guides for a widget at `r`: screen margins plus edges of nearby widgets. */
export function guides(r, others) {
  const xs = [{ v: MARGIN }, { v: innerWidth - MARGIN - r.w }];
  const ys = [{ v: MARGIN }, { v: innerHeight - BOTTOM_SAFE - r.h }];
  for (const o of others) {
    const besideV = r.y < o.y + o.h + NEAR && o.y < r.y + r.h + NEAR;
    const besideH = r.x < o.x + o.w + NEAR && o.x < r.x + r.w + NEAR;
    if (besideV) {
      // Side by side GAP apart, or left/right edges lined up.
      for (const v of [o.x + o.w + GAP, o.x - GAP - r.w, o.x, o.x + o.w - r.w]) xs.push({ v, id: o.id });
    }
    if (besideH) {
      for (const v of [o.y + o.h + GAP, o.y - GAP - r.h, o.y, o.y + o.h - r.h]) ys.push({ v, id: o.id });
    }
  }
  return { xs, ys };
}

/** Keeps the current guide until the pointer pulls RELEASE px away from it. */
export function snapAxis(raw, candidates, current) {
  if (current && Math.abs(raw - current.v) < RELEASE && candidates.some((c) => Math.abs(c.v - current.v) < 1)) {
    return current;
  }
  let best = null;
  for (const c of candidates) {
    const d = Math.abs(raw - c.v);
    if (d < SNAP && (!best || d < best.d)) best = { ...c, d };
  }
  return best;
}
