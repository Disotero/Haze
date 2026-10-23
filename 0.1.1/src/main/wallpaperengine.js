// Wallpaper Engine interop. Finds the install and the workshop library through
// Steam, reads which wallpaper WE is showing, and drives WE through its
// documented "-control" command line. Scene wallpapers (.pkg) can only be
// rendered by WE itself; video and web ones Cozy can play on its own.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync, spawn } = require("node:child_process");

const APP_ID = "431960";
let found; // undefined: not searched yet, null: not installed

function steamRoot() {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
      windowsHide: true,
      encoding: "utf8",
    });
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    return m ? path.normalize(m[1].trim()) : null;
  } catch {
    return null;
  }
}

function steamLibraries(root) {
  // Keyed case-insensitively: the registry and the .vdf spell paths differently.
  const libs = new Map([[root.toLowerCase(), root]]);
  try {
    const vdf = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = path.normalize(m[1].replace(/\\\\/g, "\\"));
      libs.set(p.toLowerCase(), p);
    }
  } catch {
    // A fresh Steam install has no libraryfolders.vdf yet.
  }
  return [...libs.values()];
}

/** { dir, exe, libs } or null when Wallpaper Engine isn't installed. */
function locate(force = false) {
  if (found !== undefined && !force) return found;
  found = null;
  const root = steamRoot();
  if (!root) return found;
  const libs = steamLibraries(root);
  for (const lib of libs) {
    const dir = path.join(lib, "steamapps", "common", "wallpaper_engine");
    const exe = path.join(dir, os.arch() === "x64" ? "wallpaper64.exe" : "wallpaper32.exe");
    if (fs.existsSync(exe)) {
      found = { dir, exe, libs };
      break;
    }
  }
  return found;
}

function readJson(file) {
  // WE writes some project.json files with a UTF-8 BOM.
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^FEFF/, ""));
}

// Some bundled projects omit "type".
function typeFromFile(file = "") {
  if (/\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(file)) return "video";
  if (/\.html?$/i.test(file)) return "web";
  if (/\.exe$/i.test(file)) return "application";
  return "scene";
}

function readProject(dir, source) {
  try {
    const p = readJson(path.join(dir, "project.json"));
    const type = String(p.type || typeFromFile(p.file)).toLowerCase();
    return {
      dir,
      source,
      title: p.title || path.basename(dir),
      type, // scene | video | web | application
      file: p.file ? path.join(dir, p.file) : "",
      preview: p.preview ? path.join(dir, p.preview) : "",
    };
  } catch {
    return null;
  }
}

function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Every wallpaper WE knows about: workshop subscriptions and local projects. */
function library() {
  const we = locate();
  if (!we) return [];
  const items = [];
  for (const lib of we.libs) {
    for (const d of subdirs(path.join(lib, "steamapps", "workshop", "content", APP_ID))) {
      items.push(readProject(d, "workshop"));
    }
  }
  for (const d of subdirs(path.join(we.dir, "projects", "myprojects"))) items.push(readProject(d, "local"));
  for (const d of subdirs(path.join(we.dir, "projects", "defaultprojects"))) items.push(readProject(d, "default"));
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

function isRunning() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/NH", "/FO", "CSV"], { windowsHide: true }, (err, out) => {
      resolve(!err && /^"wallpaper(32|64)\.exe"/im.test(out));
    });
  });
}

function control(...args) {
  const we = locate();
  if (!we) return false;
  // Starts WE if needed; a running instance picks the command up and exits.
  spawn(we.exe, ["-control", ...args], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return true;
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
  spawn(we.exe, [], { detached: true, stdio: "ignore", windowsHide: true, cwd: we.dir }).unref();
  return true;
}

module.exports = { locate, library, current, watchCurrent, isRunning, openWallpaper, closeWallpaper, launch, setMuted };
