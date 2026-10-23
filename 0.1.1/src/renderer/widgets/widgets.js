import { bindTheme } from "../shared/theme.js";
import { WallSource } from "../shared/wallsource.js";
import { weatherUrl } from "../shared/weathersites.js";
import { icons, weatherGlyph } from "./icons.js";
import { CLASSIC } from "../shared/presets.js";
import { createDayPanel } from "./calendar.js";
import { alarmLoop } from "./sound.js";
import * as extra from "./extra.js";
import * as feeds from "./feedwidgets.js";
import { launcherWidget } from "./launcher.js";
import { soundWidget, soundStrip, invalidateWall } from "./viz.js";
import { setAudioPaused } from "./audio.js";
import { installShapes, PHOTO_SHAPES } from "./shapes.js";

const board = document.getElementById("board");
const backdropEl = document.getElementById("backdrop");
const backdrop = new WallSource(backdropEl, { scale: 0.25, fps: 15 });

let settings = await window.cozy.getSettings();
let weather = await window.cozy.getWeather();
let profile = await window.cozy.getProfile();
let weCurrent = await window.cozy.weCurrent();
let lastStats = null;
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

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const DAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const DAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = (root, sel) => root.querySelector(sel);

function h(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ── Widgets ────────────────────────────────────────────────────────────────
// Each factory returns { el, update?(kind), column: "left"|"right" }.

function profileWidget() {
  const el = h(`
    <div class="widget w-profile">
      <div class="glass">
        <div class="banner"></div>
        <div class="body">
          <div class="row">
            <div class="avatar"></div>
            <div class="grow">
              <div class="name ellipsis"></div>
              <div class="uptime muted num"></div>
            </div>
          </div>
          <div class="status muted ellipsis"></div>
          <div class="row actions">
            <button class="pill" data-act="lock">${icons.lock}Блок</button>
            <button class="icon-btn" data-act="settings" title="Настройки">${icons.gear}</button>
            <button class="icon-btn" data-act="power" title="Питание">${icons.power}</button>
          </div>
        </div>
      </div>
    </div>`);
  const glass = $(el, ".glass");
  $(el, '[data-act="lock"]').onclick = () => window.cozy.lock();
  $(el, '[data-act="settings"]').onclick = () => window.cozy.openSettings();
  $(el, '[data-act="power"]').onclick = () => togglePowerMenu(glass);

  async function paint() {
    const p = settings.profile;
    const name = p.displayName || profile.user;
    $(el, ".name").textContent = `${name}@${profile.host.toLowerCase()}`;
    const av = $(el, ".avatar");
    const avatarUrl = p.avatarPath ? await window.cozy.fileUrl(p.avatarPath) : profile.avatar;
    av.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
    av.textContent = avatarUrl ? "" : name.slice(0, 1).toUpperCase();
    const banner = $(el, ".banner");
    const bannerUrl = p.bannerPath ? await window.cozy.fileUrl(p.bannerPath) : "";
    banner.style.backgroundImage = bannerUrl ? `url("${bannerUrl}")` : "";
  }

  function update(kind) {
    if (kind === "settings" || kind === "init") paint();
    if (kind === "stats" && lastStats) {
      const m = Math.floor(lastStats.uptimeSec / 60);
      const d = Math.floor(m / 1440);
      const hh = Math.floor((m % 1440) / 60);
      $(el, ".uptime").textContent =
        "в сети · " + (d ? `${d} д ${hh} ч` : hh ? `${hh} ч ${m % 60} мин` : `${m} мин`);
    }
    if (kind === "weather" || kind === "init") {
      $(el, ".status").textContent = weather ? `☁ сегодня ${weather.desc}, ${weather.temp}°` : "☁ хорошего дня";
    }
  }
  return { el, update, column: "left" };
}

function togglePowerMenu(glass) {
  const existing = $(glass, ".power-menu");
  if (existing) return existing.remove();
  const items = [
    ["sleep", "Сон"],
    ["restart", "Перезагрузка"],
    ["shutdown", "Выключение"],
    ["signout", "Выйти из системы"],
  ];
  const menu = h(`<div class="power-menu">${items
    .map(([k, l]) => `<button data-k="${k}" data-label="${l}">${l}</button>`)
    .join("")}</div>`);
  // Two-step confirm: first click arms the action, second click runs it.
  menu.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("confirm")) {
      window.cozy.power(b.dataset.k);
      menu.remove();
      return;
    }
    menu.querySelectorAll("button").forEach((x) => {
      x.classList.remove("confirm");
      x.textContent = x.dataset.label;
    });
    b.classList.add("confirm");
    b.textContent = `${b.dataset.label} — точно?`;
  };
  glass.appendChild(menu);
  setTimeout(() => menu.isConnected && menu.remove(), 8000);
}

function tzOffset(tz, now) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value;
  return (part || "GMT").replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
}

function worldWidget() {
  const el = h(`
    <div class="widget w-world">
      <div class="glass">
        <div class="row label"><span class="pin" style="width:14px;height:14px;display:inline-flex">${icons.pin}</span><span class="city grow ellipsis"></span></div>
        <div class="big num"></div>
        <div class="date muted"></div>
        <div class="zones"></div>
      </div>
    </div>`);
  function update(kind) {
    if (kind !== "tick" && kind !== "init" && kind !== "settings" && kind !== "weather") return;
    const now = new Date();
    $(el, ".city").textContent = settings.weather.city || "Локальное время";
    $(el, ".big").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    $(el, ".date").textContent = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    const fmt = (tz) =>
      new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(now);
    $(el, ".zones").innerHTML = settings.worldClocks
      .slice(0, 4)
      .map((z) => {
        try {
          return `<div class="zone"><div class="top"><span class="ellipsis">${esc(z.name)}</span><span class="off">${tzOffset(z.tz, now)}</span></div><div class="t num">${fmt(z.tz)}</div></div>`;
        } catch {
          return `<div class="zone"><div class="top"><span>${esc(z.name)}</span></div><div class="t muted">?</div></div>`;
        }
      })
      .join("");
  }
  return { el, update, column: "left" };
}

function bigClockWidget() {
  const el = h(`
    <div class="widget w-bigclock">
      <div class="digits"><div class="hh"></div><div class="mm"></div></div>
      <div class="glass tile"><div class="head"><b class="mon"></b> <span class="dow"></span></div><div class="day"></div></div>
    </div>`);
  const tile = $(el, ".tile");
  tile.title = "Календарь, будильники, таймер выключения";
  tile.addEventListener("click", () => openPanel(el));
  function update(kind) {
    if (kind !== "tick" && kind !== "init") return;
    const now = new Date();
    $(el, ".hh").textContent = pad(now.getHours());
    $(el, ".mm").textContent = pad(now.getMinutes());
    $(el, ".mon").textContent = MONTHS_SHORT[now.getMonth()];
    $(el, ".dow").textContent = DAYS_SHORT[now.getDay()];
    $(el, ".day").textContent = now.getDate();
  }
  return { el, update, column: "right" };
}

function fmtTime(ms) {
  if (!ms || ms < 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function appName(id = "") {
  const known = { spotify: "Spotify", chrome: "Chrome", msedge: "Edge", firefox: "Firefox", yandex: "Яндекс", zune: "Медиаплеер", music: "Музыка", vlc: "VLC", telegram: "Telegram" };
  const low = id.toLowerCase();
  for (const [k, v] of Object.entries(known)) if (low.includes(k)) return v;
  return id.replace(/\.exe$/i, "").split(/[!\\.]/).pop() || "";
}

function playerWidget() {
  const el = h(`
    <div class="widget w-player">
      <div class="glass">
        <div class="row">
          <div class="cover">${icons.note}</div>
          <div class="grow">
            <div class="title ellipsis"></div>
            <div class="artist muted ellipsis"></div>
            <div class="src muted ellipsis"></div>
          </div>
        </div>
        <div class="bar"><div class="fill"></div></div>
        <div class="times muted num"><span class="pos"></span><span class="dur"></span></div>
        <div class="controls">
          <button class="icon-btn" data-c="prev" title="Назад">${icons.prev}</button>
          <button class="icon-btn play" data-c="toggle" title="Пауза/воспроизведение"></button>
          <button class="icon-btn" data-c="next" title="Вперёд">${icons.next}</button>
        </div>
      </div>
    </div>`);
  let m = { active: false };
  let thumb = "";
  el.querySelectorAll("[data-c]").forEach((b) => {
    b.onclick = () => {
      window.cozy.mediaCommand(b.dataset.c);
      if (b.dataset.c === "toggle" && m.active) {
        m.playing = !m.playing;
        paint();
      }
    };
  });

  function position() {
    if (!m.active || !m.durationMs) return 0;
    let pos = m.positionMs;
    if (m.playing && m.updatedAt) pos += Date.now() - m.updatedAt;
    return Math.min(pos, m.durationMs);
  }

  function paint() {
    el.classList.toggle("playing", Boolean(m.active && m.playing));
    $(el, ".title").innerHTML = m.active
      ? `${esc(m.title || "Без названия")}<span class="eq"><i></i><i></i><i></i></span>`
      : "Ничего не играет";
    $(el, ".artist").textContent = m.active ? m.artist || "" : "включите музыку или видео";
    $(el, ".src").textContent = m.active ? appName(m.app) : "";
    $(el, ".play").innerHTML = m.active && m.playing ? icons.pause : icons.play;
    $(el, ".play").disabled = !m.active;
    $(el, '[data-c="prev"]').disabled = !m.active || !m.canPrev;
    $(el, '[data-c="next"]').disabled = !m.active || !m.canNext;
    const cover = $(el, ".cover");
    const art = m.active ? (m.thumb === undefined ? thumb : m.thumb || "") : "";
    if (art !== thumb) {
      thumb = art;
      cover.style.backgroundImage = art ? `url("${art}")` : "";
      cover.classList.toggle("has-art", Boolean(art));
    }
    paintProgress();
  }

  function paintProgress() {
    const pos = position();
    const dur = m.active ? m.durationMs : 0;
    $(el, ".fill").style.width = dur ? `${(pos / dur) * 100}%` : "0%";
    $(el, ".pos").textContent = dur ? fmtTime(pos) : "";
    $(el, ".dur").textContent = dur ? fmtTime(dur) : "";
  }

  function update(kind, payload) {
    if (kind === "media") {
      m = payload || { active: false };
      paint();
    } else if (kind === "tick") paintProgress();
    else if (kind === "init") paint();
  }
  window.cozy.getMedia().then((s) => update("media", s));
  return { el, update, column: "right" };
}

function weatherWidget() {
  const el = h(`
    <div class="widget w-weather">
      <div class="glass">
        <div class="row">
          <div class="grow">
            <div class="row" style="align-items:flex-end;gap:12px">
              <div class="temp num"></div>
              <div class="grow" style="padding-bottom:4px">
                <div class="desc ellipsis"></div>
                <div class="city muted ellipsis" style="font-size:12px"></div>
              </div>
            </div>
          </div>
          <div class="glyph"></div>
        </div>
        <div class="facts"></div>
      </div>
    </div>`);
  $(el, ".glass").addEventListener("click", () => {
    const url = weatherUrl(settings);
    if (url) window.cozy.openExternal(url);
  });

  function update(kind) {
    if (kind !== "weather" && kind !== "init" && kind !== "settings") return;
    const linked = Boolean(weatherUrl(settings));
    el.classList.toggle("linked", linked);
    $(el, ".glass").title = linked ? "Открыть прогноз в браузере" : "";
    if (!weather) {
      $(el, ".temp").textContent = "—";
      $(el, ".desc").textContent = "загружаю погоду…";
      $(el, ".city").textContent = settings.weather.city;
      return;
    }
    $(el, ".temp").textContent = `${weather.temp}°C`;
    $(el, ".desc").textContent = weather.desc;
    $(el, ".city").textContent = `${weather.city} · ощущается ${weather.feels}°`;
    $(el, ".glyph").innerHTML = weatherGlyph(weather.kind, weather.isDay);
    $(el, ".facts").innerHTML = `
      <span>💧 <b>${weather.humidity}%</b></span>
      <span>💨 <b>${weather.wind.toFixed(1)} м/с</b></span>
      <span>↑ <b>${weather.max}°</b> ↓ <b>${weather.min}°</b></span>
      <span>☀ <b>${weather.sunrise}</b>–<b>${weather.sunset}</b></span>`;
  }
  return { el, update, column: "right" };
}

function ringSvg(pct, color) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="var(--track)" stroke-width="3.6"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"
      stroke-dasharray="${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}" transform="rotate(-90 18 18)"/>
  </svg>`;
}

function statsWidget() {
  const el = h(`
    <div class="widget w-stats">
      <div class="glass" data-s="cpu"></div>
      <div class="glass" data-s="ram"></div>
      <div class="glass" data-s="third"></div>
    </div>`);
  const tile = (key, pct, value, label, color) => {
    $(el, `[data-s="${key}"]`).innerHTML =
      `${ringSvg(pct, color)}<div class="v num">${value}</div><div class="k">${label}</div>`;
  };
  function update(kind) {
    if (kind !== "stats" && kind !== "init") return;
    const s = lastStats;
    if (!s) {
      tile("cpu", 0, "—", "CPU", "var(--accent)");
      tile("ram", 0, "—", "RAM", "var(--accent-2)");
      tile("third", 0, "—", "", "var(--accent)");
      return;
    }
    tile("cpu", s.cpu, `${s.cpu}%`, "CPU", "var(--accent)");
    tile("ram", s.ram, `${s.ram}%`, `RAM · ${s.ramUsedGb.toFixed(1)} ГБ`, "var(--accent-2)");
    if (s.battery.hasBattery) {
      tile("third", s.battery.percent, `${s.battery.percent}%`, s.battery.charging ? "Заряд ⚡" : "Батарея", "var(--accent)");
    } else {
      tile("third", s.disk ?? 0, s.disk == null ? "—" : `${s.disk}%`, "Диск C:", "var(--accent)");
    }
  }
  return { el, update, column: "right" };
}

// Context handed to the newer widget modules.
const ctx = {
  get s() {
    return settings;
  },
  async save(patch) {
    settings = await window.cozy.setSettings(patch);
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

/** Build one widget and put it on the board (it plays the entry animation). */
function mountOne(id, i) {
  const w = id.startsWith("apps-") ? launcherWidget(ctx, id) : FACTORIES[id](ctx, id);
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
  w.update?.("init");
  sizeWatch.observe(w.el);
  w.el.addEventListener("animationend", () => (w.el.style.animation = "none"), { once: true });
}

function unmountOne(id) {
  const w = mounted[id];
  w.destroy?.();
  sizeWatch.unobserve(w.el);
  w.el.remove();
  delete mounted[id];
}

/** First build: everything, with the staggered entry animation. */
function mountAll() {
  closePanel();
  sizeWatch.disconnect();
  for (const id of Object.keys(mounted)) unmountOne(id);
  board.innerHTML = "";
  widgetIds().forEach((id, i) => mountOne(id, i));
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

const zOf = (el) => Number(el.dataset.z) || 1;

function applyScale(el, id) {
  const z = settings.scales[id] || 1;
  el.dataset.z = z;
  el.style.scale = z === 1 ? "" : String(z);
}

/**
 * Free size: width and/or height set by the edge grips (unscaled px). Only
 * where stretching shows more content — the to-do list and the note; other
 * widgets would just get emptier, so they only scale proportionally.
 */
const STRETCHABLE = new Set(["todo", "notes"]);
const stretchable = (el) => STRETCHABLE.has(el.dataset.id);

function applySize(el, id) {
  const sz = (STRETCHABLE.has(id) && settings.sizes?.[id]) || {};
  el.classList.toggle("sized-w", Boolean(sz.w));
  el.classList.toggle("sized-h", Boolean(sz.h));
  el.style.setProperty("--w", sz.w ? sz.w + "px" : "");
  el.style.setProperty("--h", sz.h ? sz.h + "px" : "");
  el.classList.toggle("stretchable", stretchable(el));
}

// ── Layout ─────────────────────────────────────────────────────────────────

const MARGIN = 28;
// Widgets at the bottom keep clear of the tray shelf and the dock's reveal zone.
const BOTTOM_SAFE = 78;
const GAP = 16;
const SNAP = 12; // an edge this close to a guide jumps onto it
const RELEASE = 26; // …and stays there until pulled this far past it
const NEAR = 90; // guides only come from widgets within this distance

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

function clampPos(el, x, y) {
  const z = zOf(el);
  return {
    x: Math.round(Math.max(0, Math.min(innerWidth - el.offsetWidth * z, x))),
    y: Math.round(Math.max(0, Math.min(innerHeight - el.offsetHeight * z, y))),
  };
}

function moveTo(el, p) {
  el.style.left = p.x + "px";
  el.style.top = p.y + "px";
}

function placeAll() {
  const defs = defaultPositions();
  const placed = [];
  for (const [id, w] of Object.entries(mounted)) {
    const saved = settings.layout[id];
    const p = saved ? { x: saved.x * innerWidth, y: saved.y * innerHeight } : defs[id];
    const c = clampPos(w.el, p.x, p.y);
    // A resized screen or a widget that grew can make saved spots collide;
    // later widgets step aside for earlier ones.
    const spot = freeSpot(boxToRect(w.el, c.x, c.y), placed);
    moveTo(w.el, rectToBox(w.el, spot));
    placed.push(spot);
  }
  positionGrips();
  updateClip();
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

// Collisions and magnets work on what you can see: the big clock's box is
// wider than its digits and date tile. inset = visible part within the box.
function insetOf(el) {
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
function boxToRect(el, x, y) {
  const i = insetOf(el);
  return { x: x + i.l, y: y + i.t, w: i.w, h: i.h };
}
function rectToBox(el, r) {
  const i = insetOf(el);
  return { x: r.x - i.l, y: r.y - i.t };
}
const rectOf = (el) => boxToRect(el, el.offsetLeft, el.offsetTop);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const collides = (r, rects) => rects.some((o) => overlaps(r, o));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function othersThan(id) {
  return Object.entries(mounted)
    .filter(([oid]) => oid !== id)
    .map(([oid, w]) => ({ id: oid, ...rectOf(w.el) }));
}

function clampRect(r) {
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
function freeSpot(r, rects) {
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
function guides(r, others) {
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
function snapAxis(raw, candidates, current) {
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

function markMagnets(ids) {
  for (const [id, w] of Object.entries(mounted)) w.el.classList.toggle("magnet", ids.has(id));
}

// ── Frosted backdrop clip ──────────────────────────────────────────────────

function roundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

// The backdrop covers the whole screen, not just this window (which starts
// below the top bar), so the blurred copy lines up with the real wallpaper.
function alignBackdrop() {
  Object.assign(backdropEl.style, {
    left: -window.screenX + "px",
    top: -window.screenY + "px",
    width: screen.width + "px",
    height: screen.height + "px",
  });
}

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

let clipUntil = 0;
function trackClipFor(ms) {
  const already = clipUntil > performance.now();
  clipUntil = Math.max(clipUntil, performance.now() + ms);
  if (already) return;
  const step = () => {
    updateClip();
    if (performance.now() < clipUntil) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

new ResizeObserver(() => updateClip()).observe(board);
addEventListener("resize", () => {
  alignBackdrop();
  placeAll();
});
alignBackdrop();

// ── Hit testing & dragging ─────────────────────────────────────────────────
// The window ignores the mouse except over glass/digits, so the desktop stays
// clickable everywhere else.

let hit = false;

const HIT_MARGIN = 10;
/** Within HIT_MARGIN px of a visible card. */
function nearCard(x, y) {
  return Object.values(mounted).some((w) => {
    const r = rectOf(w.el);
    return x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN && y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN;
  });
}
function setHit(v) {
  if (v !== hit) {
    hit = v;
    window.cozy.setHit(v);
  }
}

let drag = null;
document.addEventListener("mousemove", (e) => {
  if (drag) return;
  const over =
    (e.target instanceof Element && e.target.closest(".glass, .digits, .grip, .grip-r, .grip-b, .scrim, .ring-card")) ||
    nearCard(e.clientX, e.clientY);
  setHit(Boolean(over));
});
document.addEventListener("mouseleave", () => !drag && setHit(false));

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
  moveTo(el, rectToBox(el, r));
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

  const r = rectOf(d.widget);
  const spot = freeSpot(r, d.others);
  const box = rectToBox(d.widget, spot);
  if (spot !== r) {
    d.widget.classList.add("settling");
    moveTo(d.widget, box);
    trackClipFor(400);
    setTimeout(() => d.widget.classList.remove("settling"), 400);
  }
  const layout = { ...settings.layout, [d.id]: { x: box.x / innerWidth, y: box.y / innerHeight } };
  settings = await window.cozy.setSettings({ layout });
});

// Widgets change height as data arrives (weather facts, player art); re-run
// the layout so the default column restacks and nothing ends up overlapping.
let relayoutQueued = false;
const sizeWatch = new ResizeObserver(() => {
  if (relayoutQueued) return;
  relayoutQueued = true;
  requestAnimationFrame(() => {
    relayoutQueued = false;
    // Not while a widget is being resized: the others would jump around.
    if (!drag && !edging && !sizing) placeAll();
  });
});

// ── Live data wiring ───────────────────────────────────────────────────────

function dispatch(kind, payload) {
  for (const w of Object.values(mounted)) w.update?.(kind, payload);
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
    panel?.update();
    if (layoutReset || rearranged) placeAll();
    else requestAnimationFrame(updateClip);
  }
}

installShapes();
const strip = soundStrip(document.body);
let gaming = await window.cozy.getGaming();
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
backdrop.setPaused(await window.cozy.isPaused());
mountAll();

window.cozy.onSettings(applySettings);
window.cozy.onPaused((p) => backdrop.setPaused(p));
window.cozy.onWeCurrent((c) => {
  weCurrent = c;
  invalidateWall();
  backdrop.set(backdropSource(), 15);
});
window.cozy.onWeather((w) => {
  weather = w;
  dispatch("weather");
  requestAnimationFrame(updateClip);
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
  if (backdropEl.offsetLeft !== -window.screenX || backdropEl.offsetTop !== -window.screenY) {
    alignBackdrop();
    updateClip();
  }
}, 1000);

// ── Day panel (calendar, alarms, power timer) ──────────────────────────────
// Opens over the other widgets next to whatever was clicked. While it's open
// a transparent scrim takes the clicks around it, so a click anywhere on the
// desktop closes it (the window ignores the mouse elsewhere otherwise).

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

function ringAlarm(a) {
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
    requestAnimationFrame(updateClip);
  };
  card.querySelector(".stop").onclick = done;
  card.querySelector(".snooze").onclick = () => {
    window.cozy.snoozeAlarm(a.id);
    done();
  };
  board.append(card);
  setHit(true);
  trackClipFor(800);
  setTimeout(() => card.isConnected && done(), 120000);
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
    sizing = { widget, id: widget.dataset.id, x: e.clientX, z: zOf(widget), w: widget.offsetWidth };
    grip.setPointerCapture(e.pointerId);
    widget.classList.add("dragging");
    e.stopPropagation();
  },
  true
);

document.addEventListener("pointermove", (e) => {
  if (!sizing) return;
  const z = Math.max(ZMIN, Math.min(ZMAX, (sizing.w * sizing.z + (e.clientX - sizing.x)) / sizing.w));
  sizing.widget.dataset.z = z.toFixed(3);
  sizing.widget.style.scale = String(z.toFixed(3));
  updateClip();
});

document.addEventListener("pointerup", () => {
  if (!sizing) return;
  const { widget, id } = sizing;
  sizing = null;
  widget.classList.remove("dragging");
  const z = Math.round(zOf(widget) * 20) / 20;
  ctx.save({ scales: { ...settings.scales, [id]: z === 1 ? undefined : z } });
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
    ctx.save({ scales: { ...settings.scales, [id]: z === 1 ? undefined : z } });
  },
  { passive: false }
);

// ── Keyboard focus for fields ──────────────────────────────────────────────
// The widgets window normally never takes focus (it would steal it from
// apps). Clicking into a field asks for focus just for the typing.

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
  if (choice === "size") ctx.save({ scales: { ...settings.scales, [id]: undefined }, sizes: { ...settings.sizes, [id]: undefined } });
  if (choice === "home") ctx.save({ layout: { ...settings.layout, [id]: undefined } });
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
  ctx.save({ sizes: { ...settings.sizes, [id]: { ...(settings.sizes?.[id] || {}), [axis]: v } } });
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
