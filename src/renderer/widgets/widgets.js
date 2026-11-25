import { bindTheme } from "../shared/theme.js";
import { WallSource } from "../shared/wallsource.js";
import { CLASSIC } from "../shared/presets.js";
import { primeAudio } from "./sound.js";
import * as extra from "./extra.js";
import * as tools from "./tools.js";
import * as feeds from "./feedwidgets.js";
import { newsWidget } from "./news.js";
import { launcherWidget } from "./launcher.js";
import { soundWidget, soundStrip, invalidateWall, invalidateColors } from "./viz.js";
import { setAudioPaused } from "./audio.js";
import { installShapes } from "./shapes.js";
import { retry, safe, bootSettings } from "../shared/util.js";
import { misaligned } from "../shared/clip.js";
import { profileWidget, worldWidget, bigClockWidget, playerWidget, weatherWidget, statsWidget } from "./basic.js";
import { MARGIN, BOTTOM_SAFE, GAP, clampPos, moveTo, insetOf, boxToRect, rectToBox, freeSpot } from "./layout.js";
import { createClip } from "./clip.js";
import { createHit } from "./hit.js";
import { createDrag } from "./drag.js";
import { createPanel } from "./panel.js";
import { createRing } from "./ring.js";
import { installWidgetMenu } from "./widgetmenu.js";

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
// basic.js; the newer ones in their own modules (extra, tools, feeds, news,
// launcher). widgets.js is the assembly: mounting, layout and wiring.

// Context handed to the widget modules: live state through getters (a
// factory never holds a stale copy), saving, and the day panel.
const ctx = {
  get s() {
    return settings;
  },
  // Live page state the built-in widgets (basic.js) read per update.
  get weather() {
    return weather;
  },
  get weatherError() {
    return weatherError;
  },
  get profile() {
    return profile;
  },
  get lastStats() {
    return lastStats;
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
  openPanel: (anchor, opts) => panelApi.openPanel(anchor, opts),
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
  net: tools.netWidget,
  quote: tools.quoteWidget,
  photo: tools.photoWidget,
  search: tools.searchWidget,
  converter: tools.converterWidget,
  esports: feeds.esportsWidget,
  stocks: feeds.stocksWidget,
  sports: feeds.sportsWidget,
  phone: feeds.phoneWidget,
  news: newsWidget,
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
  dragApi.applyScale(w.el, id);
  dragApi.applySize(w.el, id);
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
  panelApi.closePanel();
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
    clipApi.trackClipFor(1500);
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
    clipApi.trackClipFor(900);
  });
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
  hitApi.invalidateRects();
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
    if (moved && !dragApi.isDragging()) settle(w.el);
    moveTo(w.el, box);
    w.el.dataset.placed = "1";
    if (saved) placedAt.delete(id);
    else placedAt.set(id, box);
    placed.push(spot);
  }
  hitApi.invalidateRects();
  dragApi.positionGrips();
  clipApi.updateClip();
}

/** Glide to the next position set (CSS transition on left/top). */
function settle(el) {
  el.classList.add("settling");
  clipApi.trackClipFor(400);
  clearTimeout(el._settle);
  el._settle = setTimeout(() => el.classList.remove("settling"), 400);
}

// ── Extracted interaction modules (A3) ─────────────────────────────────────
// Created in the same order their listeners used to be installed, so the
// event phases and handler order are exactly as before.

// The frosted backdrop's clip (the blur shows only through the glass).
const clipApi = createClip({ board, backdropEl, getS: () => settings, sendGlassRects: (rects) => window.cozy.sendGlassRects(rects) });
clipApi.watchBoard();

// Hit testing: the window ignores the mouse except over cards.
const hitApi = createHit({ getMounted: () => mounted, isDragging: () => dragApi.isDragging() });

// Dragging, grips, Ctrl+wheel, magnets and the per-widget size helpers.
const dragApi = createDrag({
  board,
  getS: () => settings,
  getMounted: () => mounted,
  placedAt,
  saveEntry: (map, key, value) => ctx.saveEntry(map, key, value),
  invalidateRects: hitApi.invalidateRects,
  trackClipFor: clipApi.trackClipFor,
});

// The day panel (calendar, alarms, power timer) and the alarm-ringing card.
const panelApi = createPanel({ board, ctx, getMounted: () => mounted, setHit: hitApi.setHit, trackClipFor: clipApi.trackClipFor, updateClip: clipApi.updateClip });
const ringAlarm = createRing({ board, setHit: hitApi.setHit, trackClipFor: clipApi.trackClipFor, updateClip: clipApi.updateClip });

// The widget context menu.
installWidgetMenu({ ctx, placedAt });

addEventListener("resize", () => {
  clipApi.alignBackdrop();
  placeAll({ reflow: true });
});
clipApi.alignBackdrop();

// Widgets change height as data arrives (weather facts, player art); re-run
// the layout so the default column restacks and nothing ends up overlapping.
let relayoutQueued = false;
const sizeWatch = new ResizeObserver(() => {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    hitApi.invalidateRects();
    // Not while a widget is being dragged or resized: the others would jump.
    if (!dragApi.busy()) placeAll();
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
      dragApi.applyScale(w.el, id);
      dragApi.applySize(w.el, id);
    }
    dispatch("settings");
    try {
      panelApi.get()?.update();
    } catch (e) {
      console.warn("[panel] update failed:", e);
    }
    hitApi.invalidateRects();
    if (layoutReset || rearranged) placeAll({ reflow: layoutReset || JSON.stringify(prev.arrangement) !== JSON.stringify(settings.arrangement) });
    else requestAnimationFrame(clipApi.updateClip);
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
  invalidateColors(); // viz caches parsed theme colours; re-read them
  backdrop.refreshColors();
  requestAnimationFrame(clipApi.updateClip);
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
  requestAnimationFrame(clipApi.updateClip);
});
window.cozy.onWeatherError((e) => {
  weatherError = e || "";
  dispatch("weather");
});
window.cozy.onMedia((m) => {
  dispatch("media", m);
  requestAnimationFrame(clipApi.updateClip);
});
window.cozy.onStatus((s) => dispatch("status", s));
window.cozy.onGlassResend(() => clipApi.resend());
window.cozy.onPanelOpen(() => (panelApi.get() ? panelApi.closePanel() : panelApi.openPanel(mounted.bigClock?.el || mounted.calendar?.el)));
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
    clipApi.alignBackdrop();
    clipApi.updateClip();
  }
}, 1000);

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

// A click anywhere on a one-field card (search…) goes to its field.
document.addEventListener("click", (e) => {
  const card = e.target.closest?.(".widget[data-focus] .glass");
  if (!card || e.target.closest("input, textarea, button")) return;
  const field = card.querySelector("input, textarea");
  if (!field) return;
  window.cozy.focusWidgets();
  setTimeout(() => field.focus(), 60);
});
