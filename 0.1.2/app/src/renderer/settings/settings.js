import { bindTheme } from "../shared/theme.js";
import { WEATHER_SITES } from "../shared/weathersites.js";
import { CITY_GROUPS, cityKey } from "../shared/cities.js";
import { WIDGETS, PRESETS, CLASSIC } from "../shared/presets.js";
import { PHOTO_SHAPES } from "../widgets/shapes.js";
import { VIZ_STYLES } from "../widgets/viz.js";
import { NAV_ICONS } from "../widgets/icons.js";
import { esc } from "../widgets/dom.js";
import { safe, cssUrl, bootSettings } from "../shared/util.js";

const $ = (s) => document.querySelector(s);
let s = await bootSettings();

// ── Saving ─────────────────────────────────────────────────────────────────

let toastTimer = 0;
function toast(text = "Сохранено", ms = 1300) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), ms);
}

/**
 * Save and show the result. If main couldn't save, say so and redraw from
 * the settings as they still are: the switch the user flipped flips back.
 */
async function save(patch) {
  try {
    s = await window.cozy.setSettings(patch);
    toast();
  } catch (e) {
    console.error("[settings] save failed:", e);
    toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "Не удалось сохранить", 4000);
  }
  render();
  lastShown = shownSig(s);
}

/** Segmented control / swatches: mark `value`, call onPick on click. */
function choice(container, value, onPick) {
  container.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.v === value);
    b.onclick = () => onPick(b.dataset.v);
  });
}

const fileName = (p) => (p ? p.split(/[\\/]/).pop() : "");

// ── Pages & navigation ─────────────────────────────────────────────────────

document.querySelectorAll("nav i[data-icon]").forEach((i) => {
  i.innerHTML = `<svg viewBox="0 0 24 24">${NAV_ICONS[i.dataset.icon] || ""}</svg>`;
});

function showPage(page) {
  if (!document.querySelector(`section[data-page="${page}"]`)) page = "wallpaper";
  document.querySelectorAll("section[data-page]").forEach((sec) => sec.classList.toggle("active", sec.dataset.page === page));
  document.querySelectorAll("nav [data-page]").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === page);
    if (a.dataset.page === page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#main").scrollTop = 0;
  localStorage.setItem("settings.page", page);
}
document.querySelectorAll("nav [data-page]").forEach((a) => (a.onclick = () => showPage(a.dataset.page)));

// ── Search ─────────────────────────────────────────────────────────────────
// Every row label is searchable; picking a result opens its page and
// highlights the row.

function searchIndex() {
  const out = [];
  document.querySelectorAll("section[data-page]").forEach((sec) => {
    const pageName = sec.querySelector("h1")?.textContent || "";
    sec.querySelectorAll(".row, .wcard").forEach((row) => {
      const label = (row.querySelector("b") || row.querySelector("span"))?.childNodes[0]?.textContent?.trim();
      if (!label) return;
      out.push({ page: sec.dataset.page, pageName, label, text: row.textContent.toLowerCase(), el: row });
    });
  });
  return out;
}

let found = [];
let foundIndex = 0;
function runSearch() {
  const q = $("#find").value.trim().toLowerCase();
  const box = $("#findResults");
  if (!q) {
    box.hidden = true;
    return;
  }
  found = searchIndex()
    .filter((r) => r.text.includes(q) || r.pageName.toLowerCase().includes(q))
    .slice(0, 9);
  foundIndex = 0;
  box.hidden = false;
  box.innerHTML = found.length
    ? found.map((r, i) => `<button data-i="${i}" class="${i === 0 ? "on" : ""}">${esc(r.label)}<small>${esc(r.pageName)}</small></button>`).join("")
    : `<div class="none">Ничего не нашлось</div>`;
}

function openFound(i) {
  const r = found[i];
  if (!r) return;
  $("#findResults").hidden = true;
  $("#find").value = "";
  showPage(r.page);
  r.el.scrollIntoView({ block: "center", behavior: "smooth" });
  r.el.classList.remove("flash");
  void r.el.offsetWidth;
  r.el.classList.add("flash");
}

$("#find").addEventListener("input", runSearch);
$("#find").addEventListener("keydown", (e) => {
  const buttons = [...$("#findResults").querySelectorAll("button")];
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && buttons.length) {
    e.preventDefault();
    foundIndex = (foundIndex + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons.forEach((b, i) => b.classList.toggle("on", i === foundIndex));
  } else if (e.key === "Enter") openFound(foundIndex);
  else if (e.key === "Escape") {
    $("#find").value = "";
    runSearch();
  }
});
$("#findResults").addEventListener("mousedown", (e) => {
  const b = e.target.closest("[data-i]");
  if (b) openFound(Number(b.dataset.i));
});
$("#find").addEventListener("blur", () => setTimeout(() => ($("#findResults").hidden = true), 150));

// ── Render ─────────────────────────────────────────────────────────────────

const WIDGET_ICONS = {
  weather: "⛅", bigClock: "🕰", calendar: "📅", player: "🎵", notes: "📝", todo: "✅", stats: "📊",
  worldClock: "🌍", search: "🔎", analog: "⏰", pomodoro: "🍅", profile: "👤", quote: "💬", photo: "🖼",
  converter: "🔁", news: "📰", net: "📶", stocks: "📈", sports: "⚽", esports: "🎮", phone: "📱",
  sound: "🔊", soundStrip: "🎚",
};

// ── Per-widget settings ────────────────────────────────────────────────────
// The gear next to a widget's switch: a page of its own, or a few rows that
// fold out under it. Segmented controls bind to settings by data-set="key"
// or "key.sub" (one level into an object).

const seg = (key, options) =>
  `<div class="seg small" data-set="${key}">${Object.entries(options)
    .map(([v, l]) => `<button data-v="${esc(v)}">${esc(l)}</button>`)
    .join("")}</div>`;
const VIZ_COLORS = { ink: "Как текст", accent: "Цвет палитры", wall: "Под обои" };

const WIDGET_SETTINGS = {
  weather: { page: "weather" },
  worldClock: { page: "clocks" },
  profile: { page: "profile" },
  photo: () => `
    <div class="row"><span>Фото или папка<small>${esc(s.photoFolder || "не выбрано")}</small></span>
      <div class="actions"><button class="btn ghost sm" data-act="photo:image">Фото…</button><button class="btn ghost sm" data-act="photo:folder">Папка…</button></div></div>
    <div class="row"><span>Показывать</span>${seg("photoFit", { contain: "Фото целиком", cover: "Заполнить рамку" })}</div>
    <div class="row stack"><span>Форма</span>${seg("photoShape", PHOTO_SHAPES)}</div>`,
  sound: () => `
    <div class="row stack"><span>Вид</span>${seg("soundCardStyle", VIZ_STYLES)}</div>
    <div class="row"><span>Цвет<small>Общий с полосой по низу</small></span>${seg("audioViz.color", VIZ_COLORS)}</div>`,
  soundStrip: () => `
    <div class="row stack"><span>Вид</span>${seg("audioViz.style", VIZ_STYLES)}</div>
    <div class="row"><span>Цвет</span>${seg("audioViz.color", VIZ_COLORS)}</div>
    <div class="row"><span>Высота</span>${seg("audioViz.height", { 70: "Низкая", 110: "Средняя", 150: "Высокая", 210: "Огромная" })}</div>`,
  search: () => `<div class="row"><span>Поисковик</span>${seg("searchEngine", { google: "Google", yandex: "Яндекс", duckduckgo: "DuckDuckGo", bing: "Bing" })}</div>`,
  esports: () => `<div class="row"><span>Игра</span>${seg("esportsGame", { dota2: "Dota 2", cs2: "CS2", valorant: "Valorant", lol: "LoL" })}</div>`,
  sports: () => `<div class="row stack"><span>Лига</span>${seg("sportsLeague", { "soccer/eng.1": "АПЛ", "soccer/esp.1": "Ла Лига", "soccer/uefa.champions": "ЛЧ", "soccer/rus.1": "РПЛ", "basketball/nba": "НБА", "hockey/nhl": "НХЛ" })}</div>`,
  stocks: () => `<label class="row"><span>Тикеры<small>Через запятую; Мосбиржа — с приставкой MOEX:</small></span><input type="text" data-text="stocks" value="${esc(s.stocks)}" spellcheck="false" autocomplete="off" /></label>`,
};

let openWidget = null; // widget whose settings are folded out

function getPath(key) {
  const [a, b] = key.split(".");
  return String(b ? s[a]?.[b] : s[a]);
}
function setPath(key, v) {
  const [a, b] = key.split(".");
  if (!b) return save({ [a]: v });
  const old = s[a]?.[b];
  return save({ [a]: { ...(s[a] ?? {}), [b]: typeof old === "number" ? Number(v) : v } });
}

function renderWidgetList() {
  $("#widgetToggles").innerHTML = Object.entries(WIDGETS)
    .map(([id, [name, desc]]) => {
      const cfg = WIDGET_SETTINGS[id];
      const open = openWidget === id && typeof cfg === "function";
      const gear = cfg
        ? `<button class="wgear ${open ? "on" : ""}" data-gear="${id}" title="${cfg.page ? "Открыть настройки" : "Настройки виджета"}" aria-label="Настройки: ${esc(name)}"><svg viewBox="0 0 24 24">${NAV_ICONS.gear}</svg></button>`
        : "";
      return `<div class="wcard ${s.widgets[id] ? "on" : ""} ${open ? "open" : ""}" data-w="${id}">
        <span class="wicon">${WIDGET_ICONS[id] || "▫"}</span>
        <span><b>${esc(name)}</b><small>${esc(desc)}</small></span>
        ${gear}
        <input type="checkbox" class="switch" ${s.widgets[id] ? "checked" : ""} aria-label="${esc(name)}" />
      </div>${open ? `<div class="wset">${cfg()}</div>` : ""}`;
    })
    .join("");
  $("#widgetToggles").querySelectorAll("[data-set]").forEach((c) => choice(c, getPath(c.dataset.set), (v) => setPath(c.dataset.set, v)));
}

function wallpaperMode() {
  if (s.wallpaper.type === "we") return "we";
  return s.wallpaper.type === "shader" ? "shader" : "file";
}

function render() {
  // Wallpaper
  const mode = wallpaperMode();
  choice($("#wpType"), mode, (v) => {
    if (v === "shader" || v === "we") return save({ wallpaper: { ...s.wallpaper, type: v } });
    // Back from the animation: a path without a wallpaper extension was a folder.
    if (s.wallpaper.path) return save({ wallpaper: { ...s.wallpaper, type: WALL_FILE.test(s.wallpaper.path) ? "file" : "folder" } });
    pickWallpaper();
  });
  const folder = s.wallpaper.type === "folder";
  $("#wpFileRow").classList.toggle("disabled", mode !== "file");
  $("#wpPath").textContent = s.wallpaper.path || "Файл не выбран";
  $("#wpHint").textContent = folder
    ? "Папка: картинки из неё сменяют друг друга, новые подхватываются сами"
    : "Видео (MP4, WEBM), GIF, картинки (PNG, JPG, WEBP, AVIF), HTML-страница или папка с картинками";
  $("#wpInterval").hidden = !folder;
  $("#wpInterval").value = String(s.wallpaper.interval || 600);
  $("#fps").value = String(s.fpsLimit);
  $("#pauseCovered").checked = s.pauseWhenCovered;
  $("#wpSound").checked = s.wallpaperSound;
  $("#liveGlass").checked = s.liveGlass;
  renderWeState();

  // Look
  choice($("#theme"), s.theme, (v) => save({ theme: v }));
  choice($("#palette"), s.palette, (v) => save({ palette: v }));
  choice($("#barStyle"), s.barStyle, (v) => save({ barStyle: v }));
  choice($("#glassStyle"), s.glassStyle, (v) => save({ glassStyle: v }));
  choice($("#font"), s.font, (v) => save({ font: v }));
  $("#reduceMotion").checked = s.reduceMotion;

  // Widgets
  renderWidgetList();
  $("#locked").checked = s.layoutLocked;
  $("#snap").checked = s.snap;
  renderLaunchers();
  renderUserPresets();

  // Top bar & dock
  $("#topbarOn").checked = s.topbar.enabled;
  $("#topbarReserve").checked = s.topbar.reserve;
  $("#topbarReserve").disabled = !s.topbar.enabled;
  $("#topbarVolSlider").checked = s.topbar.volumeSlider;
  choice($("#topbarPos"), s.topbar.position, (v) => save({ topbar: { ...s.topbar, position: v } }));
  $("#dockOn").checked = s.dock.enabled;
  choice($("#dockMode"), s.dock.mode, (v) => save({ dock: { ...s.dock, mode: v } }));
  choice($("#dockPos"), s.dock.position, (v) => save({ dock: { ...s.dock, position: v } }));
  $("#dockMagnify").checked = s.dock.magnify;
  $("#dockRunning").checked = s.dock.showRunning;
  $("#hideTaskbar").checked = s.hideTaskbar;
  $("#shelfOn").checked = s.dock.shelf;
  $("#shelfFade").checked = s.dock.shelfFade;
  $("#shelfFade").disabled = !s.dock.shelf;
  renderPins();

  // Profile
  if (document.activeElement !== $("#displayName")) $("#displayName").value = s.profile.displayName;
  $("#avatarPath").textContent = fileName(s.profile.avatarPath) || "аватар Windows";
  $("#bannerPath").textContent = fileName(s.profile.bannerPath) || "градиент палитры";

  // Weather
  $("#cityNow").textContent = `сейчас: ${s.weather.city}`;
  $("#weatherSite").value = s.weatherLink.site;
  $("#weatherCustomRow").hidden = s.weatherLink.site !== "custom";
  if (document.activeElement !== $("#weatherCustom")) $("#weatherCustom").value = s.weatherLink.custom;

  renderClocks();

  // System
  $("#autostart").checked = s.autostart;
  $("#hideIcons").checked = s.hideDesktopIcons;
  $("#dnd").checked = s.dnd;
  choice($("#gameMode"), s.gameMode, (v) => save({ gameMode: v }));
  $("#gameDnd").checked = s.gameDnd;
  $("#lowPower").checked = s.lowPower;
}

// Widget rows: the switch turns the widget on, the gear opens its settings.
$("#widgetToggles").addEventListener("click", async (e) => {
  const gear = e.target.closest("[data-gear]");
  if (gear) {
    const cfg = WIDGET_SETTINGS[gear.dataset.gear];
    if (cfg.page) return showPage(cfg.page);
    openWidget = openWidget === gear.dataset.gear ? null : gear.dataset.gear;
    return renderWidgetList();
  }
  const pick = e.target.closest('[data-act^="photo:"]');
  if (pick) {
    const p = await window.cozy.pickFile(pick.dataset.act.slice(6));
    if (p) save({ photoFolder: p });
    return;
  }
  if (e.target.closest(".wset")) return;
  const card = e.target.closest("[data-w]");
  if (!card) return;
  e.preventDefault(); // the switch is flipped by render(), not by the click
  save({ widgets: { ...s.widgets, [card.dataset.w]: !s.widgets[card.dataset.w] } });
});
$("#widgetToggles").addEventListener("change", (e) => {
  const f = e.target.closest("[data-text]");
  if (f) save({ [f.dataset.text]: f.value.trim() });
});

// ── Wallpaper ──────────────────────────────────────────────────────────────

const WALL_FILE = /\.(mp4|webm|mov|mkv|m4v|gif|png|jpe?g|webp|avif|bmp|html?)$/i;

async function pickWallpaper() {
  const p = await window.cozy.pickFile("wallpaper");
  if (p) save({ wallpaper: { type: "file", path: p } });
}

async function pickWallpaperFolder() {
  const p = await window.cozy.pickFile("folder");
  if (p) save({ wallpaper: { type: "folder", path: p, interval: s.wallpaper.interval || 600 } });
}

let we = null; // { installed, running, current }
let weItems = [];
let weFilter = "all";
const WE_TYPES = { video: "видео", web: "web", scene: "сцена · WE", application: "программа · WE" };

/** A sharp frame of a video, drawn by the page itself (1 s in, full size). */
function videoFrame(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    const done = (out) => {
      v.removeAttribute("src");
      v.load();
      resolve(out);
    };
    v.onloadedmetadata = () => (v.currentTime = Math.min(1, (v.duration || 2) / 2));
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const k = Math.min(1, 1600 / (v.videoWidth || 1600));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      try {
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL("image/jpeg", 0.88));
      } catch {
        done("");
      }
    };
    v.onerror = () => done("");
    setTimeout(() => done(""), 8000);
  });
}

async function paintWallpaperPreview() {
  const t = await safe(window.cozy.wallpaperThumb(), { kind: "image", url: "" });
  const url = t.kind === "video" ? await videoFrame(t.url) : t.url;
  const lowres = t.lowres;
  const bg = cssUrl(url);
  // A small preview isn't stretched: shown whole over a blurred copy of itself.
  $("#wpPreview").style.setProperty("--img", bg || "none");
  $("#wpPreview").classList.toggle("lowres", Boolean(lowres));
  $("#wpPreview").classList.toggle("empty", !url);
  document.querySelectorAll(".preset .mini").forEach((m) => (m.style.backgroundImage = bg));
  const label = {
    shader: "Анимация Haze",
    file: (s.wallpaper.type === "folder" ? "Папка · " : "") + (fileName(s.wallpaper.path) || "Свой файл"),
    we: `Wallpaper Engine${we?.current ? " · " + we.current.title : ""}`,
  };
  $("#wpPreviewLabel").textContent = label[wallpaperMode()];
}

async function loadWe() {
  we = await safe(window.cozy.weStatus(), { installed: false, running: false, current: null });
  if (we.installed && !weItems.length) {
    weItems = await safe(window.cozy.weLibrary(), []);
    renderWeGrid();
  }
  renderWeState();
  paintWallpaperPreview();
}

function renderWeState() {
  if (!we) return;
  $("#weBody").hidden = !we.installed;
  const actions = $("#weActions");
  if (!we.installed) {
    $("#weState").textContent = "не найден — нужен Wallpaper Engine из Steam";
    actions.innerHTML = "";
    return;
  }
  const weMode = s.wallpaper.type === "we";
  let state = we.running ? "запущен" : "установлен, не запущен";
  if (we.running && we.current) state += ` · сейчас «${we.current.title}»`;
  if (we.running && we.current && !weMode) state += ". Его обои скрыты под обоями Haze и зря тратят ресурсы";
  $("#weState").textContent = state;
  actions.innerHTML = !we.running
    ? `<button class="btn ghost sm" id="weLaunch">Запустить</button>`
    : !weMode && we.current
      ? `<button class="btn ghost sm" id="weClose">Закрыть обои WE</button>`
      : "";
  const launch = $("#weLaunch");
  if (launch) launch.onclick = async () => (await window.cozy.weLaunch(), setTimeout(loadWe, 4000));
  const close = $("#weClose");
  if (close) close.onclick = async () => (await window.cozy.weClose(), setTimeout(loadWe, 2000));
  markWe();
}

function weVisible() {
  const q = $("#weSearch").value.trim().toLowerCase();
  return weItems.filter((it) => {
    if (q && !it.title.toLowerCase().includes(q)) return false;
    if (weFilter === "all") return true;
    if (weFilter === "scene") return it.type === "scene" || it.type === "application";
    return it.type === weFilter;
  });
}

function renderWeGrid() {
  const items = weVisible();
  $("#weGrid").innerHTML = items.length
    ? items
        .map(
          (it) => `<button class="we-item" data-dir="${esc(it.dir)}" title="${esc(it.title)}">
            ${it.previewUrl ? `<img loading="lazy" src="${esc(it.previewUrl)}" alt="" />` : ""}
            <span class="we-badge ${it.type === "video" || it.type === "web" ? "own" : ""}">${WE_TYPES[it.type] || it.type}</span>
            <span class="we-title">${esc(it.title)}</span>
          </button>`
        )
        .join("")
    : `<div class="hint">Ничего не нашлось</div>`;
  $("#weGrid").querySelectorAll(".we-item").forEach((b) => {
    b.onclick = () => pickWe(weItems.find((it) => it.dir === b.dataset.dir));
  });
  markWe();
}

/** Highlight whatever is on the desktop right now. */
function markWe() {
  const weMode = s.wallpaper.type === "we";
  $("#weGrid").querySelectorAll(".we-item").forEach((b) => {
    const it = weItems.find((x) => x.dir === b.dataset.dir);
    const on = weMode ? we?.current?.dir === it?.dir : s.wallpaper.type === "file" && s.wallpaper.path === it?.file;
    b.classList.toggle("on", Boolean(on));
  });
}

async function pickWe(it) {
  if (!it) return;
  // Video and web wallpapers Haze plays itself, unless WE mode is on.
  if ((it.type === "video" || it.type === "web") && s.wallpaper.type !== "we") return save({ wallpaper: { type: "file", path: it.file } });
  await window.cozy.weOpen(it.dir);
  if (s.wallpaper.type !== "we") await save({ wallpaper: { ...s.wallpaper, type: "we" } });
  setTimeout(loadWe, 2500);
}

$("#weSearch").oninput = renderWeGrid;
choice($("#weFilter"), weFilter, function pick(v) {
  weFilter = v;
  choice($("#weFilter"), v, pick);
  renderWeGrid();
});

// ── Presets ────────────────────────────────────────────────────────────────

/** Tiny schematic of an arrangement for the preset card. */
function miniPreview(arr) {
  const boxes = [];
  for (const g of arr) {
    const n = g.cols.length;
    g.cols.forEach((col, ci) => {
      const w = 15;
      const x = g.anchor === "left" ? 4 + ci * (w + 2) : g.anchor === "right" ? 96 - (n - ci) * (w + 2) : 50 - (n * (w + 2)) / 2 + ci * (w + 2);
      const hgt = Math.min(18, 80 / col.length - 3);
      const total = col.length * (hgt + 3);
      let y = g.valign === "top" ? 6 : g.valign === "bottom" ? 94 - total : 50 - total / 2;
      for (const _ of col) {
        boxes.push(`<i style="left:${x}%;top:${y}%;width:${w}%;height:${hgt}%"></i>`);
        y += hgt + 3;
      }
    });
  }
  return boxes.join("");
}

$("#presetGrid").innerHTML = PRESETS.map(
  (p) => `<button class="preset" data-preset="${p.id}"><div class="mini">${miniPreview(p.arrangement)}</div><b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`
).join("");
/** The current desktop as a preset (what "Мои пресеты" stores). */
function snapshot(id, name) {
  return {
    id,
    name,
    widgets: { ...s.widgets },
    launchers: s.launchers,
    layout: s.layout,
    scales: s.scales,
    sizes: s.sizes,
    arrangement: s.arrangement || CLASSIC,
    palette: s.palette,
    theme: s.theme,
    barStyle: s.barStyle,
  };
}

$("#presetGrid").onclick = async (e) => {
  const b = e.target.closest("[data-preset]");
  const p = b && PRESETS.find((x) => x.id === b.dataset.preset);
  if (!p) return;
  // Never lose a hand-made layout: keep it as "До пресета" (one slot, replaced each time).
  const stamp = new Date().toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const backup = snapshot("before-preset", `До пресета · ${stamp}`);
  const userPresets = [backup, ...s.userPresets.filter((x) => x.id !== "before-preset")];
  // Fresh arrangement: drop saved spots and sizes so the preset shows as designed.
  await save({ userPresets, widgets: { ...p.widgets }, arrangement: p.arrangement, layout: {}, scales: {}, sizes: {} });
  toast("Готово. Прежняя расстановка — в «Мои пресеты»");
};

function renderUserPresets() {
  $("#userPresets").innerHTML = s.userPresets
    .map(
      (p) => `<div class="row"><span>${esc(p.name)}<small>${Object.values(p.widgets).filter(Boolean).length} виджетов</small></span>
        <div class="actions"><button class="btn sm" data-apply="${p.id}">Применить</button><button class="btn ghost sm" data-drop="${p.id}">Удалить</button></div></div>`
    )
    .join("");
  $("#userPresets").querySelectorAll("[data-apply]").forEach((b) => {
    b.onclick = () => {
      const p = s.userPresets.find((x) => x.id === b.dataset.apply);
      if (!p) return;
      const { id, name, ...look } = p;
      save(look);
    };
  });
  $("#userPresets").querySelectorAll("[data-drop]").forEach((b) => {
    b.onclick = () => save({ userPresets: s.userPresets.filter((x) => x.id !== b.dataset.drop) });
  });
}

$("#presetSave").onclick = () => {
  const name = $("#presetName").value.trim() || `Мой пресет ${s.userPresets.length + 1}`;
  $("#presetName").value = "";
  save({ userPresets: [...s.userPresets, snapshot(Date.now().toString(36), name)] });
};

// ── Launchers ──────────────────────────────────────────────────────────────

function renderLaunchers() {
  $("#launcherList").innerHTML = Object.entries(s.launchers)
    .map(
      ([id, l], i) => `<div class="row"><span>${esc(l.title || "Панель " + (i + 1))}<small>${
        l.apps?.length ? l.apps.map((a) => esc(a.name)).join(", ") : "пустая — добавь значки кнопкой «+» на панели"
      }</small></span><button class="btn ghost sm" data-del-launcher="${id}">Удалить</button></div>`
    )
    .join("");
  $("#launcherList").querySelectorAll("[data-del-launcher]").forEach((b) => {
    b.onclick = () => {
      const { [b.dataset.delLauncher]: _, ...rest } = s.launchers;
      save({ launchers: rest });
    };
  });
}

$("#addLauncher").onclick = async () => {
  const id = "apps-" + Date.now().toString(36);
  await save({ launchers: { ...s.launchers, [id]: { title: "Приложения", cols: 4, apps: [] } }, layoutLocked: false });
  toast("Панель добавлена на рабочий стол");
};

// ── Dock pins ──────────────────────────────────────────────────────────────

function renderPins() {
  const pins = s.dock.pinned;
  $("#pinList").innerHTML =
    pins
      .map(
        (p, i) => `<div class="row pin-row" data-i="${i}">
          <span>${esc(p.name)}<small>${esc(p.path)}</small></span>
          <div class="actions">
            <button class="btn ghost sm" data-up title="Левее" ${i === 0 ? "disabled" : ""}>↑</button>
            <button class="btn ghost sm" data-del>Убрать</button>
          </div>
        </div>`
      )
      .join("") +
    `<div class="row"><span>${pins.length ? "" : "Закреплённых приложений нет"}</span><button class="btn" id="addPin">Добавить приложение…</button></div>`;
  $("#pinList").querySelectorAll(".pin-row").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector("[data-del]").onclick = () => save({ dock: { ...s.dock, pinned: pins.filter((_, j) => j !== i) } });
    row.querySelector("[data-up]").onclick = () => {
      const next = [...pins];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      save({ dock: { ...s.dock, pinned: next } });
    };
  });
  $("#addPin").onclick = async () => {
    const p = await window.cozy.pickFile("app");
    if (!p || pins.some((x) => x.path === p)) return;
    save({ dock: { ...s.dock, pinned: [...pins, { path: p, name: fileName(p).replace(/\.(exe|lnk)$/i, "") }] } });
  };
}

// ── World clocks ───────────────────────────────────────────────────────────

function offsetLabel(tz) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return (part || "GMT").replace("GMT", "UTC").replace(/^UTC$/, "UTC+0");
  } catch {
    return "";
  }
}

function cityOptions(current) {
  const key = cityKey(current.name, current.tz);
  const known = Object.values(CITY_GROUPS).flat().some(([n, tz]) => cityKey(n, tz) === key);
  const custom = known ? "" : `<option value="${esc(key)}">${esc(current.name)} (${esc(current.tz)})</option>`;
  return (
    custom +
    Object.entries(CITY_GROUPS)
      .map(
        ([group, list]) =>
          `<optgroup label="${esc(group)}">${list.map(([n, tz]) => `<option value="${esc(cityKey(n, tz))}">${esc(n)} · ${offsetLabel(tz)}</option>`).join("")}</optgroup>`
      )
      .join("")
  );
}

function renderClocks() {
  const list = $("#clockList");
  if (list.contains(document.activeElement)) return;
  list.innerHTML =
    s.worldClocks
      .map(
        (z, i) => `<div class="clock-row" data-i="${i}">
          <select>${cityOptions(z)}</select>
          <button class="btn ghost sm" data-del>Удалить</button>
        </div>`
      )
      .join("") +
    (s.worldClocks.length < 4 ? `<div class="row"><span></span><button class="btn" id="addClock">Добавить город</button></div>` : "");
  list.querySelectorAll(".clock-row").forEach((row) => {
    const i = Number(row.dataset.i);
    const sel = row.querySelector("select");
    sel.value = cityKey(s.worldClocks[i].name, s.worldClocks[i].tz);
    sel.onchange = () => {
      const [name, tz] = sel.value.split("|");
      const next = [...s.worldClocks];
      next[i] = { name, tz };
      save({ worldClocks: next });
      sel.blur();
    };
    row.querySelector("[data-del]").onclick = () => save({ worldClocks: s.worldClocks.filter((_, j) => j !== i) });
  });
  const add = $("#addClock");
  if (add) {
    add.onclick = () => {
      const used = new Set(s.worldClocks.map((z) => cityKey(z.name, z.tz)));
      const [name, tz] = Object.values(CITY_GROUPS).flat().find(([n, t]) => !used.has(cityKey(n, t)));
      save({ worldClocks: [...s.worldClocks, { name, tz }] });
    };
  }
}

// ── Weather city search ────────────────────────────────────────────────────

async function searchCity() {
  const q = $("#cityQuery").value.trim();
  const box = $("#cityResults");
  if (!q) return;
  box.innerHTML = `<div class="hint">Ищу…</div>`;
  try {
    const results = await window.cozy.geocode(q);
    if (!results.length) {
      box.innerHTML = `<div class="hint">Ничего не нашлось</div>`;
      return;
    }
    box.innerHTML = results
      .map((r, i) => `<button data-i="${i}">${esc(r.name)} <small>${esc([r.admin, r.country].filter(Boolean).join(", "))}</small></button>`)
      .join("");
    box.querySelectorAll("button").forEach((b) => {
      b.onclick = () => {
        const r = results[Number(b.dataset.i)];
        box.innerHTML = "";
        $("#cityQuery").value = "";
        save({ weather: { ...s.weather, city: r.name, lat: r.lat, lon: r.lon } });
      };
    });
  } catch {
    box.innerHTML = `<div class="hint">Не удалось связаться с сервисом погоды</div>`;
  }
}
$("#citySearch").onclick = searchCity;
// Not an `on…` handler returning false: that would cancel every other key.
$("#cityQuery").addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchCity();
});

$("#weatherSite").innerHTML = [["off", "Ничего не открывать"], ...Object.entries(WEATHER_SITES).map(([k, v]) => [k, v.name]), ["custom", "Свой адрес…"]]
  .map(([v, name]) => `<option value="${v}">${esc(name)}</option>`)
  .join("");

// ── Static handlers ────────────────────────────────────────────────────────

const onToggle = (sel, fn) => ($(sel).onchange = (e) => save(fn(e.target.checked)));
$("#wpPick").onclick = pickWallpaper;
$("#wpPickFolder").onclick = pickWallpaperFolder;
$("#wpInterval").onchange = (e) => save({ wallpaper: { ...s.wallpaper, interval: Number(e.target.value) } });
$("#fps").onchange = (e) => save({ fpsLimit: Number(e.target.value) });
onToggle("#pauseCovered", (v) => ({ pauseWhenCovered: v }));
onToggle("#wpSound", (v) => ({ wallpaperSound: v }));
onToggle("#liveGlass", (v) => ({ liveGlass: v }));
onToggle("#reduceMotion", (v) => ({ reduceMotion: v }));
onToggle("#locked", (v) => ({ layoutLocked: v }));
onToggle("#snap", (v) => ({ snap: v }));
$("#resetLayout").onclick = () => save({ layout: {}, scales: {}, sizes: {} });
onToggle("#topbarOn", (v) => ({ topbar: { ...s.topbar, enabled: v } }));
onToggle("#topbarReserve", (v) => ({ topbar: { ...s.topbar, reserve: v } }));
onToggle("#topbarVolSlider", (v) => ({ topbar: { ...s.topbar, volumeSlider: v } }));
onToggle("#dockOn", (v) => ({ dock: { ...s.dock, enabled: v } }));
onToggle("#dockMagnify", (v) => ({ dock: { ...s.dock, magnify: v } }));
onToggle("#dockRunning", (v) => ({ dock: { ...s.dock, showRunning: v } }));
onToggle("#shelfOn", (v) => ({ dock: { ...s.dock, shelf: v } }));
onToggle("#shelfFade", (v) => ({ dock: { ...s.dock, shelfFade: v } }));
onToggle("#hideTaskbar", (v) => ({ hideTaskbar: v }));
onToggle("#autostart", (v) => ({ autostart: v }));
onToggle("#hideIcons", (v) => ({ hideDesktopIcons: v }));
onToggle("#dnd", (v) => ({ dnd: v }));
onToggle("#gameDnd", (v) => ({ gameDnd: v }));
onToggle("#lowPower", (v) => ({ lowPower: v }));
$("#displayName").onchange = (e) => save({ profile: { ...s.profile, displayName: e.target.value.trim() } });
document.querySelectorAll("[data-pick]").forEach((b) => {
  b.onclick = async () => {
    const p = await window.cozy.pickFile(b.dataset.kind || "image");
    if (p) save({ profile: { ...s.profile, [b.dataset.pick]: p } });
  };
});
document.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => save({ profile: { ...s.profile, [b.dataset.clear]: "" } })));
$("#weatherSite").onchange = (e) => save({ weatherLink: { ...s.weatherLink, site: e.target.value } });
$("#weatherCustom").onchange = (e) => {
  const v = e.target.value.trim();
  const ok = v === "" || /^https:\/\/\S+$/i.test(v);
  e.target.classList.toggle("bad", !ok);
  if (ok) save({ weatherLink: { ...s.weatherLink, custom: v } });
};

// Window buttons (the window has no system frame) and the About page.
document.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => window.cozy.windowCmd(b.dataset.win)));
$("#relaunch").onclick = () => window.cozy.appCmd("relaunch");
$("#showWelcome").onclick = () => window.cozy.showWelcome();
$("#quitApp").onclick = () => window.cozy.appCmd("quit");
window.cozy
  .appInfo()
  .then((i) => ($("#version").textContent = `Версия ${i.version} · Electron ${i.electron}`))
  .catch(() => {});

// ── Start ──────────────────────────────────────────────────────────────────

// Settings this window doesn't show (notes typed in a widget, positions of
// dragged widgets…) change often; those broadcasts don't redraw the page.
const NOT_SHOWN = new Set(["notes", "todos", "dateNotes", "layout", "scales", "sizes", "powerTimer", "alarms"]);
const shownSig = (x) => JSON.stringify(Object.entries(x).filter(([k]) => !NOT_SHOWN.has(k)));
let lastShown = "";

await bindTheme();
window.cozy.onSettings((next) => {
  const wallpaperChanged = JSON.stringify(next.wallpaper) !== JSON.stringify(s.wallpaper);
  s = next;
  const sig = shownSig(next);
  if (sig === lastShown) return;
  lastShown = sig;
  render();
  if (wallpaperChanged) paintWallpaperPreview();
});
lastShown = shownSig(s);
window.cozy.onWeCurrent((c) => {
  if (we) we.current = c;
  renderWeState();
  paintWallpaperPreview();
});
render();
// A page asked for in the address (#system) wins over the last one visited.
showPage(location.hash.slice(1) || localStorage.getItem("settings.page") || "wallpaper");
window.cozy.onSettingsGoto(showPage);
loadWe();
