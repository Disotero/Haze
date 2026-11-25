// Settings persisted as JSON in the Electron userData directory.
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const DEFAULTS = {
  theme: "auto", // auto | light | dark
  palette: "sage", // sage | warm | lavender
  // shader | file | folder (its pictures in turn, every `interval` s) | we (Wallpaper Engine draws the wallpaper, we stay out of its way)
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
  glassStyle: "frost", // frost | clear (nearly transparent cards) | tiles (solid Material-style tiles)
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
    sound: false,
    soundStrip: false,
  },
  notes: "",
  todos: [], // [{ id, text, done }]
  // [{ id, time: "07:30", days: [1..7] (Mon=1; empty = once), label, on }]
  alarms: [],
  // { action: shutdown | restart | sleep, at: epoch ms } while a timer is set
  powerTimer: null,
  photoFolder: "", // a folder of pictures or a single picture
  photoFit: "contain", // contain (whole picture over a blurred copy) | cover
  photoShape: "rounded", // rounded | arch | circle | pill | cookie | flower | clover | burst
  // Sound visualizers: the strip along the bottom edge (widgets.soundStrip) and the card.
  // style: bars | wave | line | dots | mirror | blocks | hills; color: ink | accent | wall (wallpaper colours); height of the strip in px.
  audioViz: { style: "bars", color: "ink", height: 110 },
  soundCardStyle: "bars",
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

let report = (kind, err) => console.error(`[${kind}]`, err);
/** Where load/save problems go (main.js passes its errors.log writer). */
function setLogger(fn) {
  report = fn;
}

// Keys that would reach an object's prototype instead of the object.
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const isPlain = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep copy of JSON-ish data without prototype-reaching keys. */
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (!isPlain(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) if (!UNSAFE.has(k)) out[k] = clean(x);
  return out;
}

/**
 * `over` on top of `base`: plain objects merge key by key, everything else
 * (arrays included) is replaced. A non-object over an object keeps the base.
 */
function merge(base, over) {
  if (!isPlain(base)) return over === undefined ? base : clean(over);
  if (!isPlain(over)) return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (UNSAFE.has(k)) continue;
    out[k] = Object.hasOwn(base, k) ? merge(base[k], v) : clean(v);
  }
  return out;
}

// ── Shapes ─────────────────────────────────────────────────────────────────
// Arrays are replaced wholesale by a merge, so one hand-edited or migrated
// value (`"pinned": [null]`) would break a loop that runs every second.
// Everything with a shape the code relies on is coerced to it here.

const list = (v) => (Array.isArray(v) ? v : []);
const objects = (v) => list(v).filter(isPlain);
const str = (v, d = "") => (typeof v === "string" ? v : d);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** `{ key: value }` with only the entries `ok(value)` accepts. */
function mapOf(v, ok) {
  const out = {};
  if (!isPlain(v)) return out;
  for (const [k, x] of Object.entries(v)) if (x !== undefined && ok(x)) out[k] = x;
  return out;
}

function normalize(s) {
  for (const [k, d] of Object.entries(DEFAULTS)) {
    // Wrong type at the top level (a string where an object goes…): default.
    if (Array.isArray(d) && !Array.isArray(s[k])) s[k] = structuredClone(d);
    else if (isPlain(d) && !isPlain(s[k])) s[k] = structuredClone(d);
  }
  s.dock.pinned = objects(list(s.dock.pinned).map((p) => (typeof p === "string" ? { path: p } : p)))
    .filter((p) => typeof p.path === "string" && p.path)
    .map((p) => ({ ...p, name: str(p.name) }));
  s.alarms = objects(s.alarms)
    .filter((a) => typeof a.time === "string" && /^\d{1,2}:\d{2}$/.test(a.time))
    .map((a) => ({
      ...a,
      id: a.id == null ? Math.random().toString(36).slice(2) : String(a.id),
      label: str(a.label),
      on: Boolean(a.on),
      days: list(a.days).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    }));
  s.todos = objects(s.todos).map((t) => ({ ...t, text: str(t.text), done: Boolean(t.done) }));
  s.worldClocks = objects(s.worldClocks)
    .filter((z) => typeof z.tz === "string")
    .map((z) => ({ ...z, name: str(z.name) }));
  s.userPresets = objects(s.userPresets);
  s.news.topics = list(s.news.topics).filter((t) => typeof t === "string");
  s.news.queries = list(s.news.queries).filter((t) => typeof t === "string");
  s.launchers = mapOf(s.launchers, isPlain);
  for (const [id, l] of Object.entries(s.launchers)) {
    s.launchers[id] = {
      ...l,
      title: str(l.title),
      apps: objects(l.apps).filter((a) => (typeof a.path === "string" && a.path) || (typeof a.url === "string" && a.url)),
    };
  }
  s.layout = mapOf(s.layout, (p) => isPlain(p) && finite(p.x) && finite(p.y));
  s.scales = mapOf(s.scales, (z) => finite(z) && z > 0);
  s.sizes = mapOf(s.sizes, isPlain);
  for (const [id, z] of Object.entries(s.sizes)) {
    s.sizes[id] = mapOf(z, (v) => finite(v) && v > 0);
    if (!Object.keys(s.sizes[id]).length) delete s.sizes[id];
  }
  s.dateNotes = mapOf(s.dateNotes, (t) => typeof t === "string" && t !== "");
  if (s.powerTimer !== null && !(isPlain(s.powerTimer) && finite(s.powerTimer.at))) s.powerTimer = null;
  return s;
}

const fresh = () => normalize(merge(DEFAULTS, {}));

// ── Disk ───────────────────────────────────────────────────────────────────

let current = null;
// The file exists but couldn't be read (locked by a backup tool or an
// antivirus): don't overwrite it with defaults before trying again.
let unreadable = false;

/** No settings saved yet: Haze runs for the first time on this account. */
function isFirstRun() {
  return !fs.existsSync(file());
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** File text, retrying a lock for a moment. Throws ENOENT straight away. */
function readText(f) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      return fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "");
    } catch (e) {
      if (e.code === "ENOENT") throw e;
      last = e;
      sleepMs(150);
    }
  }
  throw last;
}

/** The previous good file, kept by save(); null if missing or broken too. */
function fromBackup() {
  try {
    const s = normalize(merge(DEFAULTS, JSON.parse(readText(file() + ".bak"))));
    report("settings", "settings.json is unusable; using settings.json.bak");
    return s;
  } catch {
    return null;
  }
}

function load() {
  unreadable = false;
  let raw;
  try {
    raw = readText(file());
  } catch (e) {
    if (e.code !== "ENOENT") {
      unreadable = true;
      report("settings load", e);
    }
    current = (e.code !== "ENOENT" && fromBackup()) || fresh();
    return current;
  }
  try {
    current = normalize(merge(DEFAULTS, JSON.parse(raw)));
  } catch (e) {
    // Keep the broken file: it may be one stray comma away from the user's
    // alarms, launchers and notes.
    const bad = `${file()}.corrupt-${stamp()}`;
    try {
      fs.writeFileSync(bad, raw);
    } catch {
      // Nowhere to keep it; still don't crash.
    }
    report("settings load", `settings.json is not valid JSON (${e.message}); kept as ${path.basename(bad)}`);
    current = fromBackup() || fresh();
  }
  return current;
}

function get() {
  return current || load();
}

function write(data) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    // On disk before the rename: a power cut can't leave an empty settings.json.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // One generation back, for when the main file gets damaged anyway.
  try {
    if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");
  } catch {
    // A missing backup is no reason to lose the save.
  }
  fs.renameSync(tmp, f);
}

let saveError = null;

/**
 * Persist `next` (merged over the defaults). On a failed write nothing
 * changes — memory and disk keep the previous settings — and lastError()
 * says why.
 */
function save(next) {
  const candidate = normalize(merge(DEFAULTS, next));
  if (unreadable) {
    // The file couldn't be read at start: keep a copy before replacing it.
    try {
      fs.copyFileSync(file(), `${file()}.unreadable-${stamp()}`);
      unreadable = false;
    } catch (e) {
      report("settings save", `settings.json still unreadable (${e.code || e.message}); not overwriting it`);
      saveError = e;
      current ||= candidate;
      return current;
    }
  }
  try {
    write(candidate);
    current = candidate;
    saveError = null;
  } catch (e) {
    saveError = e;
    report("settings save", e);
    current ||= candidate;
  }
  return current;
}

/** Shallow-merge a patch into the top level (nested objects are replaced). */
function update(patch) {
  // A file that was locked at start may be readable now: build on it, not on defaults.
  if (unreadable) {
    load();
    if (!unreadable) return save({ ...current, ...patch });
  }
  return save({ ...get(), ...patch });
}

/** Why the last save failed (null after a good one). */
const lastError = () => saveError;

module.exports = { DEFAULTS, get, load, save, update, isFirstRun, lastError, setLogger, merge, normalize };
