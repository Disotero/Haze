// Wallpaper Engine interop. Finds the install and the workshop library through
// Steam, reads which wallpaper WE is showing, and drives WE through its
// documented "-control" command line. Scene wallpapers (.pkg) can only be
// rendered by WE itself; video and web ones Cozy can play on its own.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTool, spawnDetached } = require("./runtool");

const APP_ID = "431960";
const LOCATE_TTL = 60e3; // a WE installed while Haze runs shows up within a minute
let found = null; // { dir, exe, libs } once located
let locatedAt = 0;
let locating = null;

async function steamRoot() {
  const r = await runTool("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], { expectFail: true });
  const m = r.ok && r.stdout.match(/SteamPath\s+REG_SZ\s+(.+)/);
  return m ? path.normalize(m[1].trim()) : null;
}

async function steamLibraries(root) {
  // Keyed case-insensitively: the registry and the .vdf spell paths differently.
  const libs = new Map([[root.toLowerCase(), root]]);
  try {
    const vdf = await fs.promises.readFile(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = path.normalize(m[1].replace(/\\\\/g, "\\"));
      libs.set(p.toLowerCase(), p);
    }
  } catch {
    // A fresh Steam install has no libraryfolders.vdf yet.
  }
  return [...libs.values()];
}

async function search() {
  const root = await steamRoot();
  if (!root) return null;
  const libs = await steamLibraries(root);
  for (const lib of libs) {
    const dir = path.join(lib, "steamapps", "common", "wallpaper_engine");
    const exe = path.join(dir, os.arch() === "x64" ? "wallpaper64.exe" : "wallpaper32.exe");
    if (fs.existsSync(exe)) return { dir, exe, libs };
  }
  return null;
}

/** Resolves { dir, exe, libs } or null when Wallpaper Engine isn't installed. */
function locateAsync(force = false) {
  if (!force && locatedAt && Date.now() - locatedAt < LOCATE_TTL) return Promise.resolve(found);
  if (!locating) {
    locating = search()
      .catch(() => null)
      .then((r) => {
        found = r;
        locatedAt = Date.now();
        locating = null;
        return r;
      });
  }
  return locating;
}

/** The last known install (no waiting); refreshes in the background when stale. */
function locate() {
  if (!locatedAt || Date.now() - locatedAt >= LOCATE_TTL) locateAsync();
  return found;
}

function parseJson(text) {
  // WE writes some project.json files with a UTF-8 BOM.
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function readJson(file) {
  return parseJson(fs.readFileSync(file, "utf8"));
}

// Some bundled projects omit "type".
function typeFromFile(file = "") {
  if (/\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(file)) return "video";
  if (/\.html?$/i.test(file)) return "web";
  if (/\.exe$/i.test(file)) return "application";
  return "scene";
}

function projectFrom(p, dir, source) {
  const type = String(p.type || typeFromFile(p.file)).toLowerCase();
  return {
    dir,
    source,
    title: p.title || path.basename(dir),
    type, // scene | video | web | application
    file: p.file ? path.join(dir, p.file) : "",
    preview: p.preview ? path.join(dir, p.preview) : "",
  };
}

function readProject(dir, source) {
  try {
    return projectFrom(readJson(path.join(dir, "project.json")), dir, source);
  } catch {
    return null;
  }
}

// project.json contents by folder, re-read only when the file changes.
const projects = new Map(); // dir → { mtimeMs, data | null }

async function readProjectAsync(dir, source) {
  const file = path.join(dir, "project.json");
  try {
    const st = await fs.promises.stat(file);
    let hit = projects.get(dir);
    if (!hit || hit.mtimeMs !== st.mtimeMs) {
      let data = null;
      try {
        data = parseJson(await fs.promises.readFile(file, "utf8"));
      } catch {
        // Malformed project: not listed.
      }
      hit = { mtimeMs: st.mtimeMs, data };
      projects.set(dir, hit);
    }
    return hit.data ? projectFrom(hit.data, dir, source) : null;
  } catch {
    projects.delete(dir);
    return null;
  }
}

async function subdirs(dir) {
  try {
    const list = await fs.promises.readdir(dir, { withFileTypes: true });
    return list.filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Every wallpaper WE knows about: workshop subscriptions and local projects. */
async function library() {
  const we = await locateAsync();
  if (!we) return [];
  const dirs = [];
  for (const lib of we.libs) {
    for (const d of await subdirs(path.join(lib, "steamapps", "workshop", "content", APP_ID))) dirs.push([d, "workshop"]);
  }
  for (const d of await subdirs(path.join(we.dir, "projects", "myprojects"))) dirs.push([d, "local"]);
  for (const d of await subdirs(path.join(we.dir, "projects", "defaultprojects"))) dirs.push([d, "default"]);
  // In small batches: hundreds of subscriptions shouldn't hold the event loop.
  const items = [];
  for (let i = 0; i < dirs.length; i += 32) {
    items.push(...(await Promise.all(dirs.slice(i, i + 32).map(([d, src]) => readProjectAsync(d, src)))));
  }
  return items.filter((i) => i && i.file).sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function configPath() {
  const we = locate();
  return we ? path.join(we.dir, "config.json") : null;
}

/** The project WE currently shows on the first monitor, or null. */
function current() {
  const file = configPath();
  if (!file) return null;
  try {
    const cfg = readJson(file);
    const user = cfg[os.userInfo().username] || Object.values(cfg).find((v) => v && v.general);
    const selected = user?.general?.wallpaperconfig?.selectedwallpapers || {};
    const first = Object.values(selected).find((m) => m && m.file);
    if (!first) return null;
    return readProject(path.dirname(path.normalize(first.file)), "current");
  } catch {
    return null;
  }
}

/** Calls onChange(current()) whenever WE switches wallpaper. Returns a stop function. */
function watchCurrent(onChange) {
  const file = configPath();
  if (!file) return () => {};
  const listener = () => onChange(current());
  fs.watchFile(file, { interval: 3000 }, listener);
  return () => fs.unwatchFile(file, listener);
}

async function isRunning() {
  const r = await runTool("tasklist", ["/NH", "/FO", "CSV"], { expectFail: true });
  return r.ok && /^"wallpaper(32|64)\.exe"/im.test(r.stdout);
}

function control(...args) {
  const we = locate();
  if (!we) return false;
  // Starts WE if needed; a running instance picks the command up and exits.
  return spawnDetached(we.exe, ["-control", ...args]);
}

function openWallpaper(projectDir) {
  return control("openWallpaper", "-file", path.join(projectDir, "project.json"));
}

function closeWallpaper() {
  return control("closeWallpaper");
}

/** WE's own mute switch (it plays audio of video/scene wallpapers). */
function setMuted(muted) {
  return control(muted ? "mute" : "unmute");
}

function launch() {
  const we = locate();
  if (!we) return false;
  return spawnDetached(we.exe, [], { cwd: we.dir });
}

module.exports = { locate, locateAsync, library, current, watchCurrent, isRunning, openWallpaper, closeWallpaper, launch, setMuted };
