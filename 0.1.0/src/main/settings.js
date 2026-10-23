// Settings persisted as JSON in the Electron userData directory.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  theme: "auto", // auto | light | dark
  palette: "sage", // sage | warm | lavender
  // shader | file | we (Wallpaper Engine draws the wallpaper, we stay out of its way)
  wallpaper: { type: "shader", path: "" },
  fpsLimit: 30,
  pauseWhenCovered: true,
  autostart: false,
  layoutLocked: false,
  snap: true,
  // Wallpaper Engine mode: widgets blur a live screen capture instead of WE's still preview.
  liveGlass: true,
  reduceMotion: false,
  // Clicking the weather widget opens a forecast site: off | ventusky | windy | yandex | custom
  weatherLink: { site: "ventusky", custom: "" },
  // position: top | bottom | left | right
  topbar: { enabled: true, reserve: true, position: "top", volumeSlider: true },
  hideDesktopIcons: false,
  wallpaperSound: false, // video wallpapers (ours and Wallpaper Engine's) play muted unless on
  browserChrome: "full", // Haze browser toolbar: full | thin | none
  dateNotes: {}, // "2026-10-22" → note text
  dnd: false,
  // Game mode: auto (games and fullscreen apps) | on | off. Haze steps aside.
  gameMode: "auto",
  // Weak PC: same features, far less work (see main.js "Low power").
  lowPower: false,
  font: "haze", // haze | manrope | comfortaa | rubik | montserrat | mono | system
  glassStyle: "frost", // frost | clear (nearly transparent cards)
  gameDnd: true, // also hold notifications while gaming
  esportsGame: "dota2", // dota2 | cs2 | valorant | lol
  stocks: "AAPL, NVDA, BTC-USD, MOEX:SBER",
  sportsLeague: "soccer/eng.1",
  newsSource: "rbc",
  // News widget: mode topics | search | source; several topics/queries combine.
  news: { mode: "topics", topics: ["TECHNOLOGY", "SCIENCE"], queries: [], block: "" },
  // Look of the top bar and dock: glass | solid | float | neon
  barStyle: "glass",
  // Auto-hide the Windows taskbar while Cozy runs, so the dock replaces it.
  hideTaskbar: false,
  // mode: autohide (slides up from the bottom edge) | always
  dock: {
    enabled: true,
    mode: "autohide",
    position: "bottom", // bottom | top | left | right
    magnify: true,
    showRunning: true,
    shelf: true, // tray apps, bottom-right (the Windows tray is hidden with the taskbar)
    shelfFade: true, // nearly transparent until hovered
    pinned: [{ path: "C:\\Windows\\explorer.exe", name: "Проводник" }],
  },
  widgets: {
    profile: true,
    worldClock: true,
    bigClock: true,
    player: true,
    weather: true,
    stats: true,
    calendar: false,
    analog: false,
    notes: false,
    todo: false,
    pomodoro: false,
    net: false,
    quote: false,
    photo: false,
    search: false,
    converter: false,
    esports: false,
    stocks: false,
    sports: false,
    phone: false,
    news: false,
  },
  notes: "",
  todos: [], // [{ id, text, done }]
  // [{ id, time: "07:30", days: [1..7] (Mon=1; empty = once), label, on }]
  alarms: [],
  // { action: shutdown | restart | sleep, at: epoch ms } while a timer is set
  powerTimer: null,
  photoFolder: "",
  // Launcher widgets, keyed by widget id ("apps-…"): { title, cols, apps: [{ path | url, name }] }
  launchers: {},
  // Per-widget size factor, keyed by widget id.
  scales: {},
  // Free width/height per widget id from the edge grips: { w?, h? } (unscaled px).
  sizes: {},
  // Default arrangement (see renderer/shared/presets.js); null = classic.
  arrangement: null,
  userPresets: [], // [{ id, name, widgets, launchers, layout, scales, arrangement, palette, theme, barStyle }]
  searchEngine: "google", // google | yandex | duckduckgo | bing
  // Widget positions in fractions of the work area, keyed by widget id.
  layout: {},
  profile: { displayName: "", avatarPath: "", bannerPath: "" },
  weather: { city: "Москва", lat: 55.7558, lon: 37.6173, units: "metric" },
  worldClocks: [
    { name: "Лондон", tz: "Europe/London" },
    { name: "Дубай", tz: "Asia/Dubai" },
    { name: "Токио", tz: "Asia/Tokyo" },
    { name: "Нью-Йорк", tz: "America/New_York" },
  ],
};

function file() {
  return path.join(app.getPath("userData"), "settings.json");
}

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) {
    return over === undefined ? base : over;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = k in base ? merge(base[k], v) : v;
  }
  return out;
}

let current = null;

/** No settings saved yet: Haze runs for the first time on this account. */
function isFirstRun() {
  return !fs.existsSync(file());
}

function load() {
  try {
    current = merge(DEFAULTS, JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    current = structuredClone(DEFAULTS);
  }
  return current;
}

function get() {
  return current || load();
}

function save(next) {
  current = merge(DEFAULTS, next);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
  fs.renameSync(tmp, file());
  return current;
}

/** Shallow-merge a patch into the top level (nested objects are replaced). */
function update(patch) {
  return save({ ...get(), ...patch });
}

module.exports = { DEFAULTS, get, load, save, update, isFirstRun };
