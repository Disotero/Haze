// Everything that moves and resizes widgets: dragging, the corner grip
// (proportional scale), the edge grips (free width/height), Ctrl+wheel and
// the magnets. Extracted from widgets.js unchanged (A3) — same listeners in
// the same order and phases, same timing; the clip passes are throttled
// (B9), as they were right before the extraction.
import { zOf, insetOf, boxToRect, rectToBox, rectOf, clampRect, freeSpot, guides, snapAxis, moveTo } from "./layout.js";

/**
 * `board` — the widgets board (the ghost goes next to it);
 * `getS()` — current settings; `getMounted()` — mounted widgets;
 * `placedAt` — the last unsaved spots map; `saveEntry(map, key, value)` —
 * a one-entry settings save; `invalidateRects`/`trackClipFor` — the hit
 * cache and the clip throttle.
 */
export function createDrag({ board, getS, getMounted, placedAt, saveEntry, invalidateRects, trackClipFor }) {
  let drag = null;
  let sizing = null; // corner-grip resize in progress
  let edging = null; // edge-grip resize in progress
  let justDragged = false;

  const ZMIN = 0.6;
  const ZMAX = 1.8;

  function othersThan(id) {
    return Object.entries(getMounted())
      .filter(([oid]) => oid !== id)
      .map(([oid, w]) => ({ id: oid, ...rectOf(w.el) }));
  }

  function markMagnets(ids) {
    for (const [id, w] of Object.entries(getMounted())) w.el.classList.toggle("magnet", ids.has(id));
  }

  /** Each resize grip goes into the corner of its widget's visible card. */
  function positionGrips() {
    for (const w of Object.values(getMounted())) {
      const grip = w.el.querySelector(":scope > .grip");
      if (!grip) continue;
      const z = zOf(w.el);
      const i = insetOf(w.el);
      // Inside the scaled element, so back to unscaled px.
      grip.style.left = (i.l + i.w) / z - 18 + "px";
      grip.style.top = (i.t + i.h) / z - 18 + "px";
      const r = w.el.querySelector(":scope > .grip-r");
      const b = w.el.querySelector(":scope > .grip-b");
      if (r) Object.assign(r.style, { left: (i.l + i.w) / z - 5 + "px", top: i.t / z + i.h / z / 2 - 15 + "px" });
      if (b) Object.assign(b.style, { left: i.l / z + i.w / z / 2 - 15 + "px", top: (i.t + i.h) / z - 5 + "px" });
    }
  }

  // ── Size (per-widget scale) ─────────────────────────────────────────────

  function applyScale(el, id) {
    const z = getS().scales[id] || 1;
    el.dataset.z = z;
    el.style.scale = z === 1 ? "" : String(z);
  }

  /**
   * Free size: width and/or height set by the edge grips (unscaled px). Only
   * where stretching shows more content — the to-do list, the note, and app
   * panels (more columns of same-size icons, a bigger "add" area); other
   * widgets would just get emptier, so they only scale proportionally.
   */
  const STRETCHABLE = new Set(["todo", "notes"]);
  const isStretchable = (id = "") => STRETCHABLE.has(id) || id.startsWith("apps-");
  const stretchable = (el) => isStretchable(el.dataset.id);

  function applySize(el, id) {
    const sz = (isStretchable(id) && getS().sizes?.[id]) || {};
    el.classList.toggle("sized-w", Boolean(sz.w));
    el.classList.toggle("sized-h", Boolean(sz.h));
    el.style.setProperty("--w", sz.w ? sz.w + "px" : "");
    el.style.setProperty("--h", sz.h ? sz.h + "px" : "");
    el.classList.toggle("stretchable", stretchable(el));
  }

  // ── Dragging ────────────────────────────────────────────────────────────

  const ghost = document.createElement("div");
  ghost.className = "ghost";
  board.after(ghost);

  document.addEventListener("pointerdown", (e) => {
    if (getS().layoutLocked || e.button !== 0) return;
    if (e.target.closest("button, input, textarea, select, .power-menu, .grip, .panel")) return;
    const widget = e.target.closest(".widget");
    if (!widget) return;
    drag = {
      widget,
      id: widget.dataset.id,
      startX: e.clientX,
      startY: e.clientY,
      left: widget.offsetLeft,
      top: widget.offsetTop,
      box: null, // where it is now; left/top stay put until the drop
      moved: false,
      pointerId: e.pointerId,
      others: [],
      sx: null,
      sy: null,
    };
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      // Capture only once it's really a drag: capturing on pointerdown would
      // retarget the click to the widget and swallow clicks on its cards.
      drag.widget.setPointerCapture(drag.pointerId);
      drag.widget.classList.add("dragging");
      drag.others = othersThan(drag.id);
    }
    const el = drag.widget;
    const raw = boxToRect(el, drag.left + dx, drag.top + dy);
    // Hold Alt to place freely.
    if (getS().snap && !e.altKey) {
      const g = guides(raw, drag.others);
      drag.sx = snapAxis(raw.x, g.xs, drag.sx);
      drag.sy = snapAxis(raw.y, g.ys, drag.sy);
    } else {
      drag.sx = drag.sy = null;
    }
    const r = clampRect({
      ...raw,
      x: drag.sx ? drag.sx.v : Math.round(raw.x / 4) * 4,
      y: drag.sy ? drag.sy.v : Math.round(raw.y / 4) * 4,
    });
    // Moved by `translate` while dragging: the compositor moves it, no layout
    // of the board per pointer event.
    drag.box = rectToBox(el, r);
    el.style.translate = `${drag.box.x - drag.left}px ${drag.box.y - drag.top}px`;
    el.classList.toggle("snapped", Boolean(drag.sx || drag.sy));
    markMagnets(new Set([drag.sx?.id, drag.sy?.id].filter(Boolean)));

    // Preview where the widget will settle if dropped on top of another one.
    const spot = freeSpot(r, drag.others);
    ghost.classList.toggle("on", spot !== r);
    if (spot !== r) {
      Object.assign(ghost.style, { left: spot.x + "px", top: spot.y + "px", width: r.w + "px", height: r.h + "px" });
    }
    // One full clip pass per pointer event was the hottest renderer path:
    // route it through the shared throttle (a pass every ~50 ms while moving).
    trackClipFor(120);
  });

  // A drag must not also count as a click on the widget underneath.
  document.addEventListener(
    "click",
    (e) => {
      if (!justDragged) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );

  document.addEventListener("pointerup", async () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.widget.classList.remove("dragging", "snapped");
    markMagnets(new Set());
    ghost.classList.remove("on");
    if (!d.moved) return;
    justDragged = true;
    setTimeout(() => (justDragged = false));
    // Commit the dragged position to left/top.
    if (d.box) moveTo(d.widget, d.box);
    d.widget.style.translate = "";
    invalidateRects();

    const r = rectOf(d.widget);
    const spot = freeSpot(r, d.others);
    const box = rectToBox(d.widget, spot);
    if (spot !== r) {
      d.widget.classList.add("settling");
      moveTo(d.widget, box);
      trackClipFor(400);
      setTimeout(() => d.widget.classList.remove("settling"), 400);
    }
    // Just this widget's spot: a stale copy of the whole layout would undo
    // whatever else changed meanwhile.
    placedAt.delete(d.id);
    await saveEntry("layout", d.id, { x: box.x / innerWidth, y: box.y / innerHeight });
  });

  // ── Corner grip: proportional scale ─────────────────────────────────────

  document.addEventListener(
    "pointerdown",
    (e) => {
      const grip = e.target.closest?.(".grip");
      if (!grip || getS().layoutLocked || e.button !== 0) return;
      const widget = grip.closest(".widget");
      sizing = { widget, id: widget.dataset.id, x: e.clientX, z: zOf(widget), w: widget.offsetWidth, moved: false };
      grip.setPointerCapture(e.pointerId);
      widget.classList.add("dragging");
      e.stopPropagation();
    },
    true
  );

  document.addEventListener("pointermove", (e) => {
    if (!sizing) return;
    const z = Math.max(ZMIN, Math.min(ZMAX, (sizing.w * sizing.z + (e.clientX - sizing.x)) / sizing.w));
    sizing.moved = true;
    sizing.widget.dataset.z = z.toFixed(3);
    sizing.widget.style.scale = String(z.toFixed(3));
    trackClipFor(120); // throttled: see the drag handler
  });

  document.addEventListener("pointerup", () => {
    if (!sizing) return;
    const { widget, id, moved } = sizing;
    sizing = null;
    widget.classList.remove("dragging");
    if (!moved) return; // a click on the grip changes nothing
    const z = Math.round(zOf(widget) * 20) / 20;
    saveEntry("scales", id, z === 1 ? undefined : z);
  });

  document.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey || getS().layoutLocked) return;
      const widget = e.target.closest?.(".widget");
      if (!widget) return;
      e.preventDefault();
      const id = widget.dataset.id;
      const z = Math.max(ZMIN, Math.min(ZMAX, Math.round((zOf(widget) + (e.deltaY < 0 ? 0.05 : -0.05)) * 20) / 20));
      saveEntry("scales", id, z === 1 ? undefined : z);
    },
    { passive: false }
  );

  // ── Edge grips: free width / height ─────────────────────────────────────

  document.addEventListener(
    "pointerdown",
    (e) => {
      const grip = e.target.closest?.(".grip-r, .grip-b");
      if (!grip || getS().layoutLocked || e.button !== 0) return;
      const widget = grip.closest(".widget");
      const card = widget.querySelector(":scope > .glass");
      edging = {
        widget,
        id: widget.dataset.id,
        axis: grip.classList.contains("grip-r") ? "w" : "h",
        x: e.clientX,
        y: e.clientY,
        z: zOf(widget),
        w: widget.offsetWidth,
        h: card.offsetHeight,
      };
      grip.setPointerCapture(e.pointerId);
      widget.classList.add("dragging");
      e.stopPropagation();
    },
    true
  );

  document.addEventListener("pointermove", (e) => {
    if (!edging) return;
    const { widget, axis, z } = edging;
    if (axis === "w") {
      const w = Math.max(160, Math.round(edging.w + (e.clientX - edging.x) / z));
      widget.classList.add("sized-w");
      widget.style.setProperty("--w", w + "px");
    } else {
      const hgt = Math.max(90, Math.round(edging.h + (e.clientY - edging.y) / z));
      widget.classList.add("sized-h");
      widget.style.setProperty("--h", hgt + "px");
    }
    positionGrips();
    trackClipFor(120); // throttled: see the drag handler
  });

  document.addEventListener("pointerup", () => {
    if (!edging) return;
    const { widget, id, axis } = edging;
    edging = null;
    widget.classList.remove("dragging");
    const v = parseFloat(widget.style.getPropertyValue(axis === "w" ? "--w" : "--h"));
    // A click without a drag leaves the variable unset: nothing to save.
    if (!Number.isFinite(v) || v <= 0) return;
    saveEntry("sizes", id, { ...(getS().sizes?.[id] || {}), [axis]: v });
  });

  return {
    applyScale,
    applySize,
    isStretchable,
    positionGrips,
    isDragging: () => Boolean(drag),
    isResizing: () => Boolean(sizing || edging),
    busy: () => Boolean(drag || sizing || edging),
  };
}
