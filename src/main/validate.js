// Validation of renderer-supplied data at the IPC boundary. Handlers that
// take structured data from a page funnel it through here: a compromised
// renderer must not be able to hand main a cyclic object, a huge array or a
// junk-typed field. Pure functions, no Electron — unit-tested in test/.
const isPlainObject = (v) => typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

// ── menu:popup ─────────────────────────────────────────────────────────────

const MENU_MAX_ITEMS = 100;
const MENU_MAX_DEPTH = 3;
const MENU_LABEL_MAX = 200;

/**
 * A menu template from a renderer: plain objects, string labels, bounded
 * depth and size. `onPick(id)` stands in for the click handler. Throws on
 * anything odd — the caller logs and no-ops instead of building the menu.
 * Only the fields below survive: `role`, `accelerator` and friends from a
 * renderer are dropped by construction.
 */
function checkMenuTemplate(items, onPick = () => {}) {
  if (!Array.isArray(items)) throw new Error("menu: template must be an array");
  let count = 0;
  const walk = (list, depth) => {
    if (depth > MENU_MAX_DEPTH) throw new Error(`menu: deeper than ${MENU_MAX_DEPTH} levels`);
    const out = [];
    for (const it of list) {
      if (++count > MENU_MAX_ITEMS) throw new Error(`menu: more than ${MENU_MAX_ITEMS} items`);
      if (!isPlainObject(it)) throw new Error("menu: item must be a plain object");
      if (it.type === "separator") {
        out.push({ type: "separator" });
        continue;
      }
      if (it.label != null && typeof it.label !== "string") throw new Error("menu: label must be a string");
      const label = String(it.label ?? "").slice(0, MENU_LABEL_MAX);
      if (it.submenu !== undefined) {
        if (!Array.isArray(it.submenu)) throw new Error("menu: submenu must be an array");
        out.push({ label, submenu: walk(it.submenu, depth + 1) });
      } else {
        out.push({
          label,
          type: it.checked == null ? "normal" : it.radio ? "radio" : "checkbox",
          checked: Boolean(it.checked),
          click: () => onPick(it.id),
        });
      }
    }
    return out;
  };
  return walk(items, 1);
}

// ── dock:rect / glass:rects ────────────────────────────────────────────────

/**
 * One rect in window coordinates, for the reveal/clip logic: only finite
 * numbers survive, rounded and clamped to `bounds` ({ w, h }). Returns null
 * for garbage — the caller logs it.
 */
function sanitizeRect(r, bounds) {
  if (!isPlainObject(r) || !["x", "y", "width", "height"].every((k) => Number.isFinite(r[k]))) return null;
  return {
    x: Math.min(Math.max(0, Math.round(r.x)), bounds.w),
    y: Math.min(Math.max(0, Math.round(r.y)), bounds.h),
    width: Math.max(0, Math.round(r.width)),
    height: Math.max(0, Math.round(r.height)),
  };
}

/**
 * Widget-card rects for the glass layer ({ x, y, w, h, r }). Entries that
 * aren't sane are dropped (the count comes back so the caller can log it);
 * a non-array throws. Coordinates are rounded and kept inside the window.
 */
function sanitizeRects(list, bounds) {
  if (!Array.isArray(list)) throw new Error("rects: must be an array");
  const rects = [];
  let dropped = 0;
  for (const r of list) {
    if (!isPlainObject(r) || !["x", "y", "w", "h"].every((k) => Number.isFinite(r[k]))) {
      dropped++;
      continue;
    }
    rects.push({
      x: Math.min(Math.max(0, Math.round(r.x)), bounds.w),
      y: Math.min(Math.max(0, Math.round(r.y)), bounds.h),
      w: Math.max(0, Math.round(r.w)),
      h: Math.max(0, Math.round(r.h)),
      r: Number.isFinite(r.r) ? Math.max(0, r.r) : 0, // radius goes into the clip path: keep it sub-pixel
    });
  }
  return { rects, dropped };
}

module.exports = { isPlainObject, checkMenuTemplate, sanitizeRect, sanitizeRects, MENU_MAX_DEPTH, MENU_MAX_ITEMS };
