import { bindTheme } from "../shared/theme.js";
import { WallSource } from "../shared/wallsource.js";
import { icons } from "./icons.js";
import { CLASSIC } from "../shared/presets.js";
import { createDayPanel } from "./calendar.js";
import { alarmLoop, primeAudio } from "./sound.js";
import * as extra from "./extra.js";
import * as feeds from "./feedwidgets.js";
import { launcherWidget } from "./launcher.js";
import { soundWidget, soundStrip, invalidateWall } from "./viz.js";
import { setAudioPaused } from "./audio.js";
import { installShapes, PHOTO_SHAPES } from "./shapes.js";
import { esc, h } from "./dom.js";
import { retry, safe, bootSettings } from "../shared/util.js";
import { roundedRect, alignToScreen, misaligned } from "../shared/clip.js";
import { profileWidget, worldWidget, bigClockWidget, playerWidget, weatherWidget, statsWidget } from "./basic.js";
import { zOf, MARGIN, BOTTOM_SAFE, GAP, clampPos, moveTo, insetOf, boxToRect, rectToBox, rectOf, overlaps, clampRect, freeSpot, guides, snapAxis } from "./layout.js";

const board = document.getElementById("board");
const backdropEl = document.getElementById("backdrop");
const backdrop = new WallSource(backdropEl, { scale: 0.25, fps: 15 });

// Boot calls retry: at login the main process can be slow to answer, and a
// rejected call here used to leave the window blank for good.
export let settings = await bootSettings();
export let weather = await safe(window.cozy.getWeather(), null);
export let weatherError = await safe(window.cozy.getWeatherError(), "");
export let profile = await retry(() => window.cozy.getProfile(), { user: "", host: "", avatar: "" });
let weCurrent = await safe(window.cozy.weCurrent(), null);
export let lastStats = null;
let panel = null; // open day panel (see openPanel)
let scrim = null;
let sizing = null; // corner-grip resize in progress
let edging = null; // edge-grip resize in progress

// Wallpaper Engine renders in its own process, so the glass can't replay it
// like our own wallpapers. Live glass blurs a low-res capture of the screen
// (this window excluded); otherwise it falls back to WE's still preview.
function backdropSource() {
  // Weak PC: no second copy of the wallpaper to blur (a video would decode twice).
  if (settings.lowPower || settings.glassStyle !== "frost") return { type: "none" };
  if (settings.wallpaper.type !== "we") return settings.wallpaper;
  if (settings.liveGlass) return { type: "none" }; // drawn by the glass layer window
  return weCurrent?.preview ? { type: "file", path: weCurrent.preview } : { type: "none" };
}

// ── Widgets ──────────────────────────────────────────────────────────────
// The built-in widgets (profile, clocks, player, weather, stats) are in
// basic.js; the newer ones in their own modules.

// Context handed to the newer widget modules.
const ctx = {
  get s() {
    return settings;
  },
  /** Save a patch; on failure (logged) the settings stay as they were. */
  async save(patch) {
    settings = await safe(window.cozy.setSettings(patch), settings);
    return settings;
  },
  /**
   * Save one entry of a map setting (layout, sizes, scales, dateNotes):
   * main merges it into its current map, so another window's edit of a
   * different entry is never overwritten with a stale copy.
   */
  async saveEntry(map, key, value) {
    settings = await safe(window.cozy.setSettingsEntry(map, key, value), settings);
    return settings;
  },
  openPanel: (anchor, opts) => openPanel(anchor, opts),
};

const FACTORIES = {
  profile: profileWidget,
  worldClock: worldWidget,
  bigClock: bigClockWidget,
  player: playerWidget,
  weather: weatherWidget,
  stats: statsWidget,
  calendar: extra.calendarWidget,
  analog: extra.analogWidget,
  notes: extra.notesWidget,
  todo: extra.todoWidget,
  pomodoro: extra.pomodoroWidget,
  net: extra.netWidget,
  quote: extra.quoteWidget,
  photo: extra.photoWidget,
  search: extra.searchWidget,
  converter: extra.converterWidget,
  esports: feeds.esportsWidget,
  stocks: feeds.stocksWidget,
  sports: feeds.sportsWidget,
  phone: feeds.phoneWidget,
  news: feeds.newsWidget,
  sound: soundWidget,
};

let mounted = {}; // id → widget

/** Enabled widgets in arrangement order, then the rest, then launchers. */
function widgetIds() {
  const order = arrangement().flatMap((g) => g.cols.flat());
  const ids = [...new Set([...order, ...Object.keys(FACTORIES)])].filter((id) => FACTORIES[id] && settings.widgets[id]);
  return [...ids, ...Object.keys(settings.launchers)];
}

const arrangement = () => settings.arrangement || CLASSIC;

/**
 * Build one widget and put it on the board (it plays the entry animation).
 * A widget that throws while being built or filled is left out (or shown
 * as it is) — it must not stop the ones after it from mounting.
 */
function mountOne(id, i) {
  let w;
  try {
    w = id.startsWith("apps-") ? launcherWidget(ctx, id) : FACTORIES[id](ctx, id);
  } catch (e) {
    console.error(`[widget ${id}] failed to build:`, e);
    return;
  }
  w.el.dataset.id = id;
  w.el.append(
    Object.assign(document.createElement("span"), { className: "grip", title: "Размер (пропорционально)" }),
    Object.assign(document.createElement("span"), { className: "grip-r", title: "Ширина" }),
    Object.assign(document.createElement("span"), { className: "grip-b", title: "Высота" })
  );
  applyScale(w.el, id);
  applySize(w.el, id);
  w.el.style.setProperty("--i", i);
  board.appendChild(w.el);
  mounted[id] = w;
  try {
    w.update?.("init");
  } catch (e) {
    console.error(`[widget ${id}] failed to fill:`, e);
  }
  sizeWatch.observe(w.el);
  w.el.addEventListener("animationend", () => (w.el.style.animation = "none"), { once: true });
}

function unmountOne(id) {
  const w = mounted[id];
  if (!w) return;
  try {
    w.destroy?.();
  } catch (e) {
    console.error(`[widget ${id}] failed to clean up:`, e);
  }
  sizeWatch.unobserve(w.el);
  w.el.remove();
  delete mounted[id];
  placedAt.delete(id);
}

/** First build: everything, with the staggered entry animation. */
function mountAll() {
  closePanel();
  sizeWatch.disconnect();
  for (const id of Object.keys(mounted)) unmountOne(id);
  board.innerHTML = "";
  placedAt.clear();
  widgetIds().forEach((id, i) => mountOne(id, i));
  // Placed right away (layout works in a window not shown yet), and again
  // once painted, when fonts and images have settled.
  placeAll();
  requestAnimationFrame(() => {
    placeAll();
    trackClipFor(1500);
  });
}

/**
 * Widgets switched on/off: add and remove just those. The others stay as
 * they are — rebuilding them all made the whole desktop blink.
 */
function syncWidgets() {
  const want = widgetIds();
  for (const id of Object.keys(mounted)) if (!want.includes(id)) unmountOne(id);
  for (const id of want) if (!mounted[id]) mountOne(id, 0);
  requestAnimationFrame(() => {
    placeAll();
    trackClipFor(900);
  });
}

// ── Size (per-widget scale) ────────────────────────────────────────────────


function applyScale(el, id) {
  const z = settings.scales[id] || 1;
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
  const sz = (isStretchable(id) && settings.sizes?.[id]) || {};
  el.classList.toggle("sized-w", Boolean(sz.w));
  el.classList.toggle("sized-h", Boolean(sz.h));
  el.style.setProperty("--w", sz.w ? sz.w + "px" : "");
  el.style.setProperty("--h", sz.h ? sz.h + "px" : "");
  el.classList.toggle("stretchable", stretchable(el));
}

// ── Layout ─────────────────────────────────────────────────────────────────


/**
 * Positions for widgets without a saved spot, from the arrangement: each
 * group's columns sit side by side against its anchor edge; widgets stack
 * down each column, centred in it. Widgets in no group go top centre.
 */
function defaultPositions() {
  const pos = {};
  const groups = arrangement().map((g) => ({ ...g, cols: g.cols.map((c) => c.filter((id) => mounted[id])) }));
  const placed = new Set(groups.flatMap((g) => g.cols.flat()));
  const rest = Object.keys(mounted).filter((id) => !placed.has(id));
  if (rest.length) groups.push({ anchor: "center", valign: "top", cols: [rest] });
  for (const g of groups) {
    const cols = g.cols.filter((c) => c.length);
    const sizes = cols.map((c) => c.map((id) => insetOf(mounted[id].el)));
    const widths = sizes.map((c) => Math.max(...c.map((r) => r.w)));
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (cols.length - 1);
    let x = g.anchor === "left" ? MARGIN : g.anchor === "right" ? innerWidth - MARGIN - total : (innerWidth - total) / 2;
    cols.forEach((col, ci) => {
      const height = sizes[ci].reduce((a, r) => a + r.h, 0) + GAP * (col.length - 1);
      let y = g.valign === "top" ? MARGIN : g.valign === "bottom" ? innerHeight - BOTTOM_SAFE - height : (innerHeight - height) / 2;
      col.forEach((id, k) => {
        const r = sizes[ci][k];
        const el = mounted[id].el;
        pos[id] = rectToBox(el, { x: Math.round(x + (widths[ci] - r.w) / 2), y: Math.round(y) });
        y += r.h + GAP;
      });
      x += widths[ci] + GAP;
    });
  }
  return pos;
}

// Where each widget without a saved spot was put last: it stays there while
// that's free, instead of the whole default column restacking every time
// one widget's height changes (weather facts arriving, player art loading).
const placedAt = new Map(); // id → { x, y }

/**
 * reflow: start over from the default arrangement (layout reset, a new
 * preset, the window resized). Otherwise only widgets that now collide or
 * fall off the screen move — with an animation, so it reads as a move.
 */
function placeAll({ reflow = false } = {}) {
  if (reflow) placedAt.clear();
  invalidateRects();
  const defs = defaultPositions();
  const placed = [];
  for (const [id, w] of Object.entries(mounted)) {
    const saved = settings.layout[id];
    const p = saved ? { x: saved.x * innerWidth, y: saved.y * innerHeight } : placedAt.get(id) || defs[id];
    if (!p) continue;
    const c = clampPos(w.el, p.x, p.y);
    // A resized screen or a widget that grew can make saved spots collide;
    // later widgets step aside for earlier ones.
    const spot = freeSpot(boxToRect(w.el, c.x, c.y), placed);
    const box = rectToBox(w.el, spot);
    const moved = w.el.dataset.placed && (Math.abs(w.el.offsetLeft - box.x) > 1 || Math.abs(w.el.offsetTop - box.y) > 1);
    if (moved && !drag) settle(w.el);
    moveTo(w.el, box);
    w.el.dataset.placed = "1";
    if (saved) placedAt.delete(id);
    else placedAt.set(id, box);
    placed.push(spot);
  }
  invalidateRects();
  positionGrips();
  updateClip();
}

/** Glide to the next position set (CSS transition on left/top). */
function settle(el) {
  el.classList.add("settling");
  trackClipFor(400);
  clearTimeout(el._settle);
  el._settle = setTimeout(() => el.classList.remove("settling"), 400);
}

/** Each resize grip goes into the corner of its widget's visible card. */
function positionGrips() {
  for (const w of Object.values(mounted)) {
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

// ── Collisions & magnetic edges ────────────────────────────────────────────


function othersThan(id) {
  return Object.entries(mounted)
    .filter(([oid]) => oid !== id)
    .map(([oid, w]) => ({ id: oid, ...rectOf(w.el) }));
}

function markMagnets(ids) {
  for (const [id, w] of Object.entries(mounted)) w.el.classList.toggle("magnet", ids.has(id));
}

// ── Frosted backdrop clip ──────────────────────────────────────────────────

const alignBackdrop = () => alignToScreen(backdropEl);

let lastRects = "";
function sendRects(rects) {
  const json = JSON.stringify(rects);
  if (json === lastRects) return;
  lastRects = json;
  window.cozy.sendGlassRects(rects);
}

function updateClip() {
  const parts = [];
  const rects = [];
  // clip-path is in the backdrop's own coordinates.
  const ox = backdropEl.offsetLeft;
  const oy = backdropEl.offsetTop;
  board.querySelectorAll(".glass").forEach((g) => {
    // A photo covers its card, the clock draws its own dial: shapes the blur can't follow.
    if (g.closest(".w-photo:not(.empty), .w-analog")) return;
    const r = g.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const z = zOf(g.closest(".widget, .panel") || g);
    const radius = (parseFloat(getComputedStyle(g).borderTopLeftRadius) || 22) * z;
    parts.push(roundedRect(r.left - ox, r.top - oy, r.width, r.height, radius));
    rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: radius });
  });
  if (settings.wallpaper.type === "we" && settings.liveGlass) sendRects(rects);
  backdropEl.style.clipPath = parts.length ? `path('${parts.join("")}')` : "inset(50%)";
}

// Following an animation (entry, settling) with the clip: about 20 times a
// second is smooth enough under a 26 px blur, at a fraction of the cost of
// every frame.
const CLIP_STEP = 50;
let clipUntil = 0;
let clipLast = 0;
function trackClipFor(ms) {
  const already = clipUntil > performance.now();
  clipUntil = Math.max(clipUntil, performance.now() + ms);
  if (already) return;
  const step = (t) => {
    if (t - clipLast >= CLIP_STEP || t >= clipUntil) {
      clipLast = t;
      updateClip();
    }
    if (t < clipUntil) requestAnimationFrame(step);
    else updateClip();
  };
  requestAnimationFrame(step);
}

new ResizeObserver(() => updateClip()).observe(board);
addEventListener("resize", () => {
  alignBackdrop();
  placeAll({ reflow: true });
});
alignBackdrop();

// ── Hit testing & dragging ─────────────────────────────────────────────────
// The window ignores the mouse except over glass/digits, so the desktop stays
// clickable everywhere else.

let hit = false;

const HIT_MARGIN = 10;
const HIT_SEL = ".glass, .digits, .grip, .grip-r, .grip-b, .scrim, .ring-card";

// Card rectangles, measured once per layout change instead of on every
// mouse move (each measurement forces a layout pass).
let rectCache = null;
function invalidateRects() {
  rectCache = null;
}
function cardRects() {
  return (rectCache ||= Object.values(mounted).map((w) => rectOf(w.el)));
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

let drag = null;
document.addEventListener("mousemove", (e) => {
  if (drag) return;
  const over = (e.target instanceof Element && e.target.closest(HIT_SEL)) || nearCard(e.clientX, e.clientY);
  setHit(Boolean(over));
});
// Entering and leaving cards report too: one more path in, should mouse
// moves stop arriving.
document.addEventListener(
  "pointerenter",
  (e) => !drag && e.target instanceof Element && e.target.matches(HIT_SEL) && setHit(true),
  true
);
document.addEventListener(
  "pointerleave",
  (e) => {
    if (drag || !(e.target instanceof Element) || !e.target.matches(HIT_SEL)) return;
    const to = e.relatedTarget;
    setHit(Boolean(to instanceof Element && to.closest(HIT_SEL)) || nearCard(e.clientX, e.clientY));
  },
  true
);
document.addEventListener("mouseleave", () => !drag && setHit(false));
// Main asks after showing or re-pinning the window; the page itself after
// it becomes visible or gets focus.
window.cozy.onWidgetsRearm(() => setHit(hit, true));
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && setHit(hit, true));
addEventListener("focus", () => setHit(hit, true));

document.addEventListener("pointerdown", (e) => {
  if (settings.layoutLocked || e.button !== 0) return;
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

const ghost = document.createElement("div");
ghost.className = "ghost";
board.after(ghost);

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
  if (settings.snap && !e.altKey) {
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
  updateClip();
});

let justDragged = false;
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
  await ctx.saveEntry("layout", d.id, { x: box.x / innerWidth, y: box.y / innerHeight });
});

// Widgets change height as data arrives (weather facts, player art); re-run
// the layout so the default column restacks and nothing ends up overlapping.
let relayoutQueued = false;
const sizeWatch = new ResizeObserver(() => {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    invalidateRects();
    // Not while a widget is being resized: the others would jump around.
    if (!drag && !edging && !sizing) placeAll();
  });
});

// ── Live data wiring ───────────────────────────────────────────────────────

/** One widget throwing must not stop the updates of the others. */
function dispatch(kind, payload) {
  for (const [id, w] of Object.entries(mounted)) {
    try {
      w.update?.(kind, payload);
    } catch (e) {
      console.warn(`[widget ${id}] ${kind} update failed:`, e);
    }
  }
}

/** Live glass (over Wallpaper Engine) gets a lighter tint: the blur is the show. */
function syncGlassLook() {
  document.body.classList.toggle(
    "live-glass",
    settings.wallpaper.type === "we" && settings.liveGlass && !settings.lowPower && settings.glassStyle === "frost"
  );
  document.body.classList.toggle("low-power", settings.lowPower);
}

function applySettings(next) {
  const prev = settings;
  settings = next;
  syncGlassLook();
  document.body.classList.toggle("unlocked", !settings.layoutLocked);
  backdrop.set(backdropSource(), 15);
  const widgetsChanged =
    JSON.stringify(prev.widgets) !== JSON.stringify(settings.widgets) ||
    Object.keys(prev.launchers).join() !== Object.keys(settings.launchers).join();
  const layoutReset = Object.keys(settings.layout).length === 0 && Object.keys(prev.layout).length > 0;
  const rearranged =
    JSON.stringify(prev.arrangement) !== JSON.stringify(settings.arrangement) ||
    JSON.stringify(prev.scales) !== JSON.stringify(settings.scales) ||
    JSON.stringify(prev.sizes) !== JSON.stringify(settings.sizes);
  if (JSON.stringify(prev.wallpaper) !== JSON.stringify(settings.wallpaper)) setTimeout(invalidateWall, 2500);
  syncStrip();
  if (widgetsChanged) syncWidgets();
  else {
    for (const [id, w] of Object.entries(mounted)) {
      applyScale(w.el, id);
      applySize(w.el, id);
    }
    dispatch("settings");
    try {
      panel?.update();
    } catch (e) {
      console.warn("[panel] update failed:", e);
    }
    invalidateRects();
    if (layoutReset || rearranged) placeAll({ reflow: layoutReset || JSON.stringify(prev.arrangement) !== JSON.stringify(settings.arrangement) });
    else requestAnimationFrame(updateClip);
  }
}

installShapes();
const strip = soundStrip(document.body);
let gaming = await safe(window.cozy.getGaming(), false);
function syncStrip() {
  strip.sync(settings, Boolean(settings.widgets.soundStrip) && !gaming);
}
syncStrip();
setAudioPaused(Boolean(gaming));

await bindTheme(() => {
  backdrop.refreshColors();
  requestAnimationFrame(updateClip);
});
document.body.classList.toggle("unlocked", !settings.layoutLocked);
syncGlassLook();
backdrop.set(backdropSource(), 15);
backdrop.setPaused(await safe(window.cozy.isPaused(), false));
mountAll();
// Everything is mounted and listening: main may show the window now.
window.cozy.widgetsReady();

window.cozy.onSettings(applySettings);
window.cozy.onPaused((p) => backdrop.setPaused(p));
window.cozy.onWeCurrent((c) => {
  weCurrent = c;
  invalidateWall();
  backdrop.set(backdropSource(), 15);
});
window.cozy.onWeather((w) => {
  weather = w;
  weatherError = "";
  dispatch("weather");
  requestAnimationFrame(updateClip);
});
window.cozy.onWeatherError((e) => {
  weatherError = e || "";
  dispatch("weather");
});
window.cozy.onMedia((m) => {
  dispatch("media", m);
  requestAnimationFrame(updateClip);
});
window.cozy.onStatus((s) => dispatch("status", s));
window.cozy.onGlassResend(() => {
  lastRects = "";
  updateClip();
});
window.cozy.onPanelOpen(() => (panel ? closePanel() : openPanel(mounted.bigClock?.el || mounted.calendar?.el)));
window.cozy.onAlarmRing(ringAlarm);
window.cozy.onStats((s) => {
  lastStats = s;
  dispatch("stats");
});
window.cozy.onGaming((g) => {
  gaming = g;
  setAudioPaused(Boolean(g));
  syncStrip();
  if (!g) dispatch("tick"); // catch up at once
});
setInterval(() => {
  if (gaming) return;
  dispatch("tick");
  // The window can move without resizing (top bar toggled); keep the glass aligned.
  if (misaligned(backdropEl)) {
    alignBackdrop();
    updateClip();
  }
}, 1000);

// ── Day panel (calendar, alarms, power timer) ──────────────────────────────
// Opens over the other widgets next to whatever was clicked. While it's open
// a transparent scrim takes the clicks around it, so a click anywhere on the
// desktop closes it (the window ignores the mouse elsewhere otherwise).

export function openPanel(anchor, opts) {
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
  const others = Object.values(mounted)
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

function closePanel() {
  if (!panel) return;
  panel.destroy();
  scrim?.remove();
  panel = scrim = null;
  requestAnimationFrame(updateClip);
}

document.addEventListener("keydown", (e) => e.key === "Escape" && closePanel());

// ── Alarm ringing ──────────────────────────────────────────────────────────

let ringDone = null; // stops the alarm that's ringing now

function ringAlarm(a) {
  // A second alarm replaces the first, sound included.
  ringDone?.();
  document.querySelector(".ring-card")?.remove();
  const stopSound = alarmLoop();
  const card = h(`
    <div class="ring-card glass">
      <div class="ring-bell">${icons.bell}</div>
      <div class="ring-time num">${esc(a.time)}</div>
      <div class="ring-label">${esc(a.label || "Будильник")}</div>
      <div class="row">
        <button class="pill snooze">Отложить на 5 минут</button>
        <button class="pill accent stop">Стоп</button>
      </div>
    </div>`);
  const done = () => {
    stopSound();
    card.remove();
    if (ringDone === done) ringDone = null;
    requestAnimationFrame(updateClip);
  };
  ringDone = done;
  card.querySelector(".stop").onclick = done;
  card.querySelector(".snooze").onclick = () => {
    window.cozy.snoozeAlarm(a.id);
    done();
  };
  board.append(card);
  setHit(true);
  trackClipFor(800);
  setTimeout(done, 120000);
}

// ── Resize grip & Ctrl+wheel ───────────────────────────────────────────────

const ZMIN = 0.6;
const ZMAX = 1.8;

document.addEventListener(
  "pointerdown",
  (e) => {
    const grip = e.target.closest?.(".grip");
    if (!grip || settings.layoutLocked || e.button !== 0) return;
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
  updateClip();
});

document.addEventListener("pointerup", () => {
  if (!sizing) return;
  const { widget, id, moved } = sizing;
  sizing = null;
  widget.classList.remove("dragging");
  if (!moved) return; // a click on the grip changes nothing
  const z = Math.round(zOf(widget) * 20) / 20;
  ctx.saveEntry("scales", id, z === 1 ? undefined : z);
});

document.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey || settings.layoutLocked) return;
    const widget = e.target.closest?.(".widget");
    if (!widget) return;
    e.preventDefault();
    const id = widget.dataset.id;
    const z = Math.max(ZMIN, Math.min(ZMAX, Math.round((zOf(widget) + (e.deltaY < 0 ? 0.05 : -0.05)) * 20) / 20));
    ctx.saveEntry("scales", id, z === 1 ? undefined : z);
  },
  { passive: false }
);

// ── Keyboard focus for fields ──────────────────────────────────────────────
// The widgets window normally never takes focus (it would steal it from
// apps). Clicking into a field asks for focus just for the typing.

// Any click makes the alarm sound able to play (an AudioContext created
// without one may start suspended).
document.addEventListener("pointerdown", primeAudio, { once: true, capture: true });

document.addEventListener("pointerdown", (e) => {
  const field = e.target.closest?.("input, textarea");
  if (!field) return;
  window.cozy.focusWidgets();
  setTimeout(() => field.focus(), 60);
});

// ── Widget context menu ────────────────────────────────────────────────────
// Also the way back to the settings when there's no profile widget and the
// tray is hidden with the taskbar.

document.addEventListener("contextmenu", async (e) => {
  const widget = e.target.closest?.(".widget");
  if (!widget || e.defaultPrevented) return; // launchers have their own menu
  e.preventDefault();
  const id = widget.dataset.id;
  const scaled = (settings.scales[id] || 1) !== 1 || Boolean(settings.sizes?.[id]);
  const choice = await window.cozy.popupMenu([
    { id: "settings", label: "Настройки Haze…" },
    { type: "separator" },
    { id: "lock", label: "Закрепить расстановку", checked: settings.layoutLocked },
    ...(scaled ? [{ id: "size", label: "Исходный размер" }] : []),
    ...(settings.layout[id] ? [{ id: "home", label: "Вернуть на место по умолчанию" }] : []),
    ...(id === "photo"
      ? [
          { type: "separator" },
          {
            label: "Форма",
            submenu: Object.entries(PHOTO_SHAPES).map(([k, label]) => ({ id: "shape:" + k, label, radio: true, checked: (settings.photoShape || "rounded") === k })),
          },
          {
            label: "Показывать",
            submenu: [
              { id: "fit:contain", label: "Фото целиком", radio: true, checked: (settings.photoFit || "contain") === "contain" },
              { id: "fit:cover", label: "Заполнить рамку", radio: true, checked: settings.photoFit === "cover" },
            ],
          },
          { id: "pick:image", label: "Выбрать фото…" },
          { id: "pick:folder", label: "Выбрать папку…" },
        ]
      : []),
    { type: "separator" },
    { id: "hide", label: "Убрать этот виджет" },
  ]);
  if (choice === "settings") window.cozy.openSettings();
  if (choice === "lock") ctx.save({ layoutLocked: !settings.layoutLocked });
  if (choice === "size") {
    await ctx.saveEntry("scales", id, undefined);
    await ctx.saveEntry("sizes", id, undefined);
  }
  if (choice === "home") {
    placedAt.delete(id);
    ctx.saveEntry("layout", id, undefined);
  }
  if (choice === "hide") ctx.save({ widgets: { ...settings.widgets, [id]: false } });
  if (choice?.startsWith("shape:")) ctx.save({ photoShape: choice.slice(6) });
  if (choice?.startsWith("fit:")) ctx.save({ photoFit: choice.slice(4) });
  if (choice?.startsWith("pick:")) {
    const p = await window.cozy.pickFile(choice.slice(5));
    if (p) ctx.save({ photoFolder: p });
  }
});

// ── Edge grips: free width / height ────────────────────────────────────────


document.addEventListener(
  "pointerdown",
  (e) => {
    const grip = e.target.closest?.(".grip-r, .grip-b");
    if (!grip || settings.layoutLocked || e.button !== 0) return;
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
  updateClip();
});

document.addEventListener("pointerup", () => {
  if (!edging) return;
  const { widget, id, axis } = edging;
  edging = null;
  widget.classList.remove("dragging");
  const v = parseFloat(widget.style.getPropertyValue(axis === "w" ? "--w" : "--h"));
  // A click without a drag leaves the variable unset: nothing to save.
  if (!Number.isFinite(v) || v <= 0) return;
  ctx.saveEntry("sizes", id, { ...(settings.sizes?.[id] || {}), [axis]: v });
});

// A click anywhere on a one-field card (search…) goes to its field.
document.addEventListener("click", (e) => {
  const card = e.target.closest?.(".widget[data-focus] .glass");
  if (!card || e.target.closest("input, textarea, button")) return;
  const field = card.querySelector("input, textarea");
  if (!field) return;
  window.cozy.focusWidgets();
  setTimeout(() => field.focus(), 60);
});
