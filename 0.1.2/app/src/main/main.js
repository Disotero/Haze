const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  nativeTheme,
  nativeImage,
  dialog,
  shell,
  desktopCapturer,
  Notification,
  globalShortcut,
  net,
  powerMonitor,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { runTool, setLogger: setToolLogger } = require("./runtool");
const poller = require("./poller");

const settings = require("./settings");
const desktop = require("./desktop");
const system = require("./system");
const { isPlainObject, checkMenuTemplate, sanitizeRect, sanitizeRects } = require("./validate");
const { startMediaBridge } = require("./media");
const { startPsBridge } = require("./psbridge");
const { fetchWeather, geocode } = require("./weather");
const we = require("./wallpaperengine");
const { createTopbar } = require("./topbar");
const { createDock } = require("./dock");
const { createClockwork } = require("./clockwork");
const { iconFor, linkTarget } = require("./appicons");
const { createBrowserShell } = require("./browser");
const feeds = require("./feeds");

const RENDERER = path.join(__dirname, "..", "renderer");
const PRELOAD = path.join(__dirname, "..", "preload.js");

let wallpaperWin = null;
let widgetsWin = null;
let glassWin = null;
const browserWins = new Set(); // Cozy browser shells
let settingsWin = null;
let welcomeWin = null;
let weChosenOnFirstRun = false;
let tray = null;
let wallpaperHost = null;
let media = null;
let status = null;
let lastMedia = { active: false };
let lastWeather = null;
let lastStatus = null;
let lastDesk = null;
let weCurrent = null;
let paused = false;
let userPaused = false;
let fullscreen = false;
let gaming = false; // game mode in effect
let stopWindowWatch = null;
let gameHard = false; // …because of a game: windows taken away, not just idle
let gameSince = 0; // last time a game was seen in front (leaving waits a bit)
const timers = [];

const topbar = createTopbar({ rendererDir: RENDERER, webPrefs, logConsole });
const dock = createDock({
  rendererDir: RENDERER,
  webPrefs,
  logConsole,
  settings,
  applySettings: (patch) => applySettings(patch),
  ownHwnds,
  area: () => widgetArea(),
});

const browserShell = createBrowserShell({
  rendererDir: RENDERER,
  webPrefs,
  settings,
  applySettings: (patch) => applySettings(patch),
  register: (win) => {
    browserWins.add(win);
    win.on("closed", () => browserWins.delete(win));
    // Same process as the widgets: keep them down under this app window.
    win.on("focus", () => pinLayers());
  },
});
const openBrowser = (url) => browserShell.open(url);

const clockwork = createClockwork({
  settings,
  applySettings: (patch) => applySettings(patch),
  broadcast,
  sleepNow: () => runPower("sleep"),
});

// Errors go to %APPDATA%\Haze\errors.log instead of a blocking error dialog.
// The log is capped: past LOG_MAX it moves to errors.log.1 (one generation),
// and the same message again within a second is counted, not repeated — a
// crash loop can't fill the disk.
const LOG_MAX = 1 << 20;
const logState = { bytes: -1, last: "", lastAt: 0, repeats: 0 };

function logFile() {
  return path.join(app.getPath("userData"), "errors.log");
}

function appendLog(text) {
  const file = logFile();
  if (logState.bytes < 0) {
    try {
      logState.bytes = fs.statSync(file).size;
    } catch {
      logState.bytes = 0;
    }
  }
  if (logState.bytes + text.length > LOG_MAX) {
    try {
      fs.renameSync(file, file + ".1");
    } catch {
      // Not there yet, or locked: start over in place.
    }
    logState.bytes = 0;
  }
  fs.appendFileSync(file, text);
  logState.bytes += Buffer.byteLength(text);
}

function logError(kind, err) {
  try {
    const msg = `${kind}: ${err && err.stack ? err.stack : err}`;
    const now = Date.now();
    if (msg === logState.last && now - logState.lastAt < 1000) {
      logState.repeats++;
      logState.lastAt = now;
      return;
    }
    let text = "";
    if (logState.repeats) text += `[${new Date(logState.lastAt).toISOString()}] (the previous message repeated ${logState.repeats}×)\n`;
    text += `[${new Date(now).toISOString()}] ${msg}\n`;
    logState.last = msg;
    logState.lastAt = now;
    logState.repeats = 0;
    console.error(text.trimEnd());
    appendLog(text);
  } catch {
    // Nowhere left to report it.
  }
}
process.on("uncaughtException", (e) => logError("uncaughtException", e));
process.on("unhandledRejection", (e) => logError("unhandledRejection", e));
settings.setLogger(logError);
setToolLogger(logError);
poller.setLogger((name, e) => logError(`poll ${name}`, e));

if (!app.requestSingleInstanceLock() || process.argv.includes("--quit")) {
  app.quit();
} else {
  // `electron . --quit` asks the running copy to exit cleanly (it must hand
  // back the app bar space and repaint the stock wallpaper).
  // `--settings=<page>` opens the settings on that page.
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--quit")) return app.quit();
    // Haze is running, so there's nothing to repair.
    if (argv.includes("--restore")) return;
    openSettings(argv.find((a) => a.startsWith("--settings="))?.slice(11));
  });
  app.whenReady().then(start);
}

// The wallpaper window lives inside Explorer's desktop, where Chromium's native
// occlusion tracking wrongly treats it as hidden and stops painting it.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

function allWindows() {
  return [wallpaperWin, widgetsWin, glassWin, settingsWin, welcomeWin, topbar.window(), dock.window(), ...browserWins].filter(
    (w) => w && !w.isDestroyed()
  );
}

function broadcast(channel, payload) {
  for (const w of allWindows()) w.webContents.send(channel, payload);
}

function ownHwnds() {
  return new Set(allWindows().map(desktop.hwndOf));
}

function primary() {
  return screen.getPrimaryDisplay();
}

function virtualOrigin() {
  const all = screen.getAllDisplays().map((d) => d.bounds);
  return { x: Math.min(...all.map((b) => b.x)), y: Math.min(...all.map((b) => b.y)) };
}

function logConsole(name, win) {
  win.webContents.on("console-message", (e) => {
    if (e.level === "error" || e.level === "warning") console.log(`[${name}] ${e.message}`);
  });
  win.webContents.on("render-process-gone", (_e, d) => console.error(`[${name}] renderer gone: ${d.reason}`));
}

/**
 * `role` "wallpaper" is the one window that must never be throttled: it lives
 * inside Explorer's desktop, where Chromium would think it hidden. On a weak
 * PC every other window may be throttled while it's hidden (game mode, the
 * dock slid away…); see syncThrottling() for the switch at runtime.
 */
function webPrefs(role = "") {
  // Alarms and timers must be able to play a sound without a click first.
  return {
    preload: PRELOAD,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: role !== "wallpaper" && Boolean(settings.get().lowPower),
    autoplayPolicy: "no-user-gesture-required",
  };
}

function syncThrottling() {
  const on = Boolean(settings.get().lowPower);
  for (const w of allWindows()) {
    if (w === wallpaperWin) continue;
    try {
      w.webContents.setBackgroundThrottling(on);
    } catch {
      // A window on its way out.
    }
  }
}

// ── Wallpaper layer ────────────────────────────────────────────────────────

function createWallpaper() {
  const b = primary().bounds;
  wallpaperWin = new BrowserWindow({
    ...b,
    frame: false,
    show: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    // No WS_THICKFRAME: its invisible 8px borders would shrink the client area.
    thickFrame: false,
    backgroundColor: "#000000",
    webPreferences: webPrefs("wallpaper"),
  });
  wallpaperWin.setIgnoreMouseEvents(true);
  logConsole("wallpaper", wallpaperWin);
  wallpaperWin.loadFile(path.join(RENDERER, "wallpaper", "index.html"));
  wallpaperWin.once("ready-to-show", attachWallpaper);
}

function attachWallpaper() {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) return;
  wallpaperHost = desktop.attachToWallpaper(wallpaperWin, primary().bounds, virtualOrigin());
  if (!wallpaperHost) {
    console.error("[wallpaper] desktop host not found; retrying");
    setTimeout(attachWallpaper, 3000);
  }
}

/**
 * Our wallpaper layer exists unless Wallpaper Engine is the wallpaper source:
 * two windows fighting over the same WorkerW slot would just hide each other.
 */
function syncWallpaperLayer() {
  const own = settings.get().wallpaper.type !== "we";
  const alive = wallpaperWin && !wallpaperWin.isDestroyed();
  if (own && !alive) createWallpaper();
  if (!own && alive) {
    wallpaperWin.destroy();
    wallpaperWin = null;
    wallpaperHost = null;
  }
}

// ── Widgets layer ──────────────────────────────────────────────────────────

function createWidgets() {
  widgetsWin = new BrowserWindow({
    ...widgetArea(),
    frame: false,
    transparent: true,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: webPrefs(),
  });
  // Transparent areas pass clicks through to the desktop icons; the renderer
  // turns hit-testing back on while the pointer is over a card.
  widgetsWin.setIgnoreMouseEvents(true, { forward: true });
  logConsole("widgets", widgetsWin);
  widgetsWin.loadFile(path.join(RENDERER, "widgets", "index.html"));
  // Shown once the page reports its widgets mounted and listening
  // (widgets:ready), not at ready-to-show: at login, under disk and antivirus
  // load, that came seconds before any button worked. The timer is a safety
  // net for a page that never reports.
  widgetsBootAt = Date.now();
  const win = widgetsWin;
  setTimeout(() => showWidgets(win, "timeout"), 15000);
  // Typing in a widget (notes, search…) makes the window focusable for a
  // moment; once focus leaves, it goes back to never stealing focus.
  // Taking focus raised the window over the apps: send it back down.
  widgetsWin.on("blur", () => {
    widgetsWin.setFocusable(false);
    pinLayers();
  });
}

let widgetsBootAt = 0;
let widgetsShown = null; // the window showWidgets() last revealed

function showWidgets(win, why) {
  if (!win || win.isDestroyed() || win !== widgetsWin || widgetsShown === win) return;
  widgetsShown = win;
  console.log(`[widgets] interactive after ${Date.now() - widgetsBootAt} ms (${why})`);
  if (!gameHard) win.showInactive();
  pinLayers();
  syncGlass();
}

/**
 * Click-through relies on Chromium forwarding mouse moves while the window
 * ignores the mouse; on Windows that forwarding can silently stop after
 * hide/show or z-order changes, leaving every widget button dead. Re-arm it
 * and have the page report its hit state again.
 */
function rearmWidgets() {
  if (!widgetsWin || widgetsWin.isDestroyed()) return;
  widgetsWin.setIgnoreMouseEvents(true, { forward: true });
  widgetsWin.webContents.send("widgets:rearm");
}

/**
 * Widgets above the glass layer, both under every app window. With a glass
 * layer the widgets window is owned by it — an owned window always stays
 * above its owner, so app switches can't slip the blur over the widgets.
 */
function pinLayers() {
  const widgets = widgetsWin && !widgetsWin.isDestroyed() ? widgetsWin : null;
  const glass = glassWin && !glassWin.isDestroyed() ? glassWin : null;
  if (glass) {
    if (widgets) {
      desktop.setOwner(widgets, glass);
      desktop.sendToBottom(widgets); // just above the glass, below every app
    }
    desktop.pinToDesktop(glass);
  } else if (widgets) desktop.pinToDesktop(widgets);
  if (widgets && widgets.isVisible()) rearmWidgets();
}

/**
 * pinLayers(), but only when something actually moved: an owner that got
 * lost or an app window that slipped below a layer. Re-pinning layered
 * windows for nothing makes them repaint — a flicker every few seconds.
 */
function pinLayersIfNeeded() {
  const widgets = widgetsWin && !widgetsWin.isDestroyed() ? widgetsWin : null;
  const glass = glassWin && !glassWin.isDestroyed() ? glassWin : null;
  if (!widgets && !glass) return;
  const own = ownHwnds();
  const progman = desktop.desktopOwner();
  const ok = glass
    ? desktop.ownerOf(glass) === progman &&
      !desktop.hasAppWindowBelow(glass, own) &&
      (!widgets || (desktop.ownerOf(widgets) === desktop.hwndOf(glass) && !desktop.hasAppWindowBelow(widgets, own)))
    : desktop.ownerOf(widgets) === progman && !desktop.hasAppWindowBelow(widgets, own);
  if (!ok) pinLayers();
}

// ── Live glass layer ───────────────────────────────────────────────────────
// With Wallpaper Engine as the wallpaper, the frosted glass blurs a live
// capture of the screen. That capture must not contain the blur itself, so
// the blur lives in this separate window, hidden from screen capture, right
// under the widgets. The widgets stay capturable: screenshots show them.

function glassWanted() {
  const s = settings.get();
  // Live glass means a screen capture: not on a weak PC.
  // "Clear" cards show the wallpaper itself: no blur layer behind them.
  return s.wallpaper.type === "we" && s.liveGlass && !s.lowPower && s.glassStyle === "frost" && widgetsWin && !widgetsWin.isDestroyed();
}

let glassRects = []; // widget cards, widgets-window coordinates
let glassFrozen = false;
let clearSince = 0;

/**
 * Live glass blurs a capture of the screen, so an app window over a widget
 * (or its open/close animation) would bleed into the glass. While any app
 * window overlaps a card, hold the last clean frame; resume half a second
 * after the overlap ends.
 */
function watchGlassOverlap() {
  if (!glassWin || glassWin.isDestroyed() || !widgetsWin || widgetsWin.isDestroyed() || gaming) return;
  const sf = primary().scaleFactor;
  const wb = widgetsWin.getBounds();
  const cards = glassRects.map((r) => ({ x: (wb.x + r.x) * sf, y: (wb.y + r.y) * sf, w: r.w * sf, h: r.h * sf }));
  const hit = desktop
    .appWindows(ownHwnds(), { exe: false })
    .some(
      (w) =>
        !w.minimized &&
        cards.some((c) => w.rect.x < c.x + c.w && c.x < w.rect.x + w.rect.width && w.rect.y < c.y + c.h && c.y < w.rect.y + w.rect.height)
    );
  const now = Date.now();
  if (hit) clearSince = 0;
  else if (!clearSince) clearSince = now;
  const frozen = hit || now - clearSince < 500;
  if (frozen !== glassFrozen) {
    glassFrozen = frozen;
    glassWin.webContents.send("glass:freeze", frozen);
  }
}

function syncGlass() {
  const alive = glassWin && !glassWin.isDestroyed();
  if (glassWanted() && !alive) {
    glassWin = new BrowserWindow({
      ...widgetArea(),
      frame: false,
      transparent: true,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: webPrefs(),
    });
    glassWin.setIgnoreMouseEvents(true);
    logConsole("glass", glassWin);
    glassWin.loadFile(path.join(RENDERER, "glass", "index.html"));
    glassWin.once("ready-to-show", () => {
      desktop.setCaptureExcluded(glassWin, true);
      if (!gameHard) glassWin.showInactive();
      pinLayers();
    });
  } else if (!glassWanted() && alive) {
    // Re-own the widgets first: destroying an owner destroys what it owns.
    if (widgetsWin && !widgetsWin.isDestroyed()) desktop.pinToDesktop(widgetsWin);
    glassWin.destroy();
    glassWin = null;
  }
}

/** Work area minus the bar's strip when the bar overlays instead of reserving. */
function widgetArea() {
  const a = { ...primary().workArea };
  const o = topbar.overlay();
  if (o?.edge === "top") (a.y += o.size), (a.height -= o.size);
  if (o?.edge === "bottom") a.height -= o.size;
  if (o?.edge === "left") (a.x += o.size), (a.width -= o.size);
  if (o?.edge === "right") a.width -= o.size;
  return a;
}

function placeWindows() {
  // The top bar first: reserving its strip changes the work area the others use.
  topbar.place();
  if (widgetsWin && !widgetsWin.isDestroyed()) widgetsWin.setBounds(widgetArea());
  if (glassWin && !glassWin.isDestroyed()) glassWin.setBounds(widgetArea());
  dock.place();
  if (wallpaperWin && !wallpaperWin.isDestroyed()) attachWallpaper();
}

// ── Settings window ────────────────────────────────────────────────────────

/**
 * Show a normal window for sure. Windows applies the launch's show mode to a
 * process's first ShowWindow, so when Haze was started hidden (Haze.vbs,
 * some launchers) the first show() becomes a hide and leaves a grey ghost
 * frame on screen. Asking again works.
 */
function showSurely(win) {
  win.show();
  if (!win.isVisible()) win.show();
}

function openSettings(page) {
  if (typeof page !== "string") page = "";
  if (settingsWin && !settingsWin.isDestroyed()) {
    showSurely(settingsWin);
    settingsWin.focus();
    if (page) settingsWin.webContents.send("settings:goto", page);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    title: "Haze — настройки",
    show: false,
    // Our own title strip (drag area + buttons) in the page, no system frame.
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#2b2320" : "#f3e3d8",
    icon: trayImage(),
    webPreferences: webPrefs(),
  });
  logConsole("settings", settingsWin);
  // A blank (grey) settings window means its page died; keep the reason.
  settingsWin.webContents.on("console-message", (e) => {
    if (e.level === "error") logError("settings", e.message);
  });
  settingsWin.webContents.on("render-process-gone", (_e, d) => logError("settings", `renderer gone: ${d.reason}`));
  settingsWin.webContents.on("did-fail-load", (_e, code, desc) => logError("settings", `load failed: ${code} ${desc}`));
  settingsWin.loadFile(path.join(RENDERER, "settings", "index.html"), { hash: page });
  settingsWin.once("ready-to-show", () => {
    desktop.roundCorners(settingsWin);
    showSurely(settingsWin);
  });
  settingsWin.on("closed", () => (settingsWin = null));
}

// ── Welcome (first run) ────────────────────────────────────────────────────

/** A short tour of what can be changed and where; each card opens its page. */
function openWelcome() {
  if (welcomeWin && !welcomeWin.isDestroyed()) {
    showSurely(welcomeWin);
    welcomeWin.focus();
    return;
  }
  welcomeWin = new BrowserWindow({
    width: 1000,
    height: 700,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    title: "Haze — добро пожаловать",
    show: false,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121212" : "#eef2ea",
    icon: trayImage(),
    webPreferences: webPrefs(),
  });
  logConsole("welcome", welcomeWin);
  welcomeWin.loadFile(path.join(RENDERER, "welcome", "index.html"));
  welcomeWin.once("ready-to-show", () => {
    desktop.roundCorners(welcomeWin);
    showSurely(welcomeWin);
    welcomeWin.focus();
  });
  welcomeWin.on("closed", () => (welcomeWin = null));
}

function closeWelcome() {
  if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close();
}

/**
 * First run: save the defaults (so the tour shows once) and, if Wallpaper
 * Engine is already running, leave the desktop to it instead of covering it
 * with our own wallpaper. Then say hello.
 */
async function firstRun() {
  const running = await we.isRunning();
  if (running && settings.get().wallpaper.type !== "we") {
    weChosenOnFirstRun = true;
    applySettings({ wallpaper: { type: "we", path: "" } });
  } else {
    settings.save(settings.get());
  }
  openWelcome();
}

// ── Tray ───────────────────────────────────────────────────────────────────

function trayImage() {
  return nativeImage.createFromPath(path.join(__dirname, "..", "..", "assets", "icon.png"));
}

function buildTrayMenu() {
  const s = settings.get();
  return Menu.buildFromTemplate([
    { label: "Настройки…", click: openSettings },
    { type: "separator" },
    {
      label: "Закрепить виджеты",
      type: "checkbox",
      checked: s.layoutLocked,
      click: (item) => applySettings({ layoutLocked: item.checked }),
    },
    {
      label: "Скрыть иконки рабочего стола",
      type: "checkbox",
      checked: s.hideDesktopIcons,
      click: (item) => applySettings({ hideDesktopIcons: item.checked }),
    },
    {
      label: "Пауза обоев",
      type: "checkbox",
      checked: userPaused,
      click: (item) => {
        userPaused = item.checked;
        updateCover();
      },
    },
    {
      // The way out of "always on" game mode, which hides everything else.
      label: "Игровой режим",
      type: "checkbox",
      checked: s.gameMode === "on",
      click: (item) => applySettings({ gameMode: item.checked ? "on" : "auto" }),
    },
    { type: "separator" },
    { label: "Выход", click: () => app.quit() },
  ]);
}

// Settings that show up in the tray menu: only these rebuild it.
const TRAY_KEYS = ["layoutLocked", "hideDesktopIcons", "gameMode"];
// Settings that change what themeState() returns.
const THEME_KEYS = ["theme", "palette", "reduceMotion", "lowPower", "barStyle", "font", "glassStyle"];

/** Same data regardless of key order (JSON.stringify isn't). */
function sameData(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameData(a[k], b[k]));
}

function createTray() {
  tray = new Tray(trayImage().resize({ width: 16, height: 16, quality: "best" }));
  tray.setToolTip("Haze");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", openSettings);
}

// ── Settings changes ───────────────────────────────────────────────────────

function applySettings(patch) {
  const before = settings.get();
  const next = settings.update(patch);
  // A failed save changed nothing (settings.lastError() says why).
  if (next === before) return next;
  if ("autostart" in patch) {
    app.setLoginItemSettings({
      openAtLogin: next.autostart,
      // The portable build runs from a temp unpack dir; point at the real exe.
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    });
  }
  if (patch.weather && !sameData(next.weather, before.weather)) {
    weatherRetry.reset();
    refreshWeather();
  }
  if (patch.wallpaper) {
    const wasWe = before.wallpaper.type === "we";
    const isWe = next.wallpaper.type === "we";
    if (isWe && !wasWe) {
      we.isRunning().then((r) => r || we.launch());
    } else if (wasWe && !isWe) {
      // Hand the desktop back to Cozy: WE would keep rendering underneath.
      we.isRunning().then((r) => r && we.closeWallpaper());
    }
    syncWallpaperLayer();
  }
  if (patch.wallpaper || "liveGlass" in patch || "lowPower" in patch || "glassStyle" in patch) syncGlass();
  if ("lowPower" in patch) {
    poller.setSlow(next.lowPower ? 2 : 1);
    syncThrottling();
    if (status) status.send(`slow ${next.lowPower ? 1 : 0}`);
  }
  if ("hideDesktopIcons" in patch) desktop.setDesktopIcons(!next.hideDesktopIcons);
  if ("hideTaskbar" in patch) desktop.taskbarAutoHide(next.hideTaskbar);
  if ("dnd" in patch) applyDnd(next.dnd);
  if ("gameMode" in patch) updateCover(); // game mode on/off takes effect at once
  if ("wallpaperSound" in patch && next.wallpaper.type === "we") we.setMuted(!next.wallpaperSound);
  if (patch.widgets) {
    syncStatusBridge();
    syncMediaBridge();
  }
  if ("browserChrome" in patch) browserShell.sync();
  if (patch.topbar) {
    topbar.sync(next.topbar);
    setTimeout(() => {
      syncIconInset();
      placeWindows();
    }, 300);
    syncStatusBridge();
  }
  if (patch.dock) dock.sync(next.dock);
  if (tray && TRAY_KEYS.some((k) => k in patch)) tray.setContextMenu(buildTrayMenu());
  broadcast("settings", next);
  if (THEME_KEYS.some((k) => k in patch && !sameData(before[k], next[k]))) broadcast("theme", themeState());
  return next;
}

function themeState() {
  const s = settings.get();
  const dark = s.theme === "dark" || (s.theme === "auto" && nativeTheme.shouldUseDarkColors);
  // Low power implies no animations everywhere.
  return {
    dark,
    palette: s.palette,
    reduceMotion: s.reduceMotion || s.lowPower,
    barStyle: s.barStyle,
    lowPower: s.lowPower,
    font: s.font,
    glassStyle: s.glassStyle,
  };
}

// ── Live data ──────────────────────────────────────────────────────────────

/**
 * At login the network is often not up yet. A failed fetch is retried soon
 * and then less often (15 s → 30 s → 1 min → 2 min → 5 min), and right away
 * once Windows reports the network back; any success resets the ladder.
 */
const weatherRetry = (() => {
  const steps = [15e3, 30e3, 60e3, 120e3, 300e3];
  let i = 0;
  let timer = null;
  return {
    failed() {
      clearTimeout(timer);
      timer = setTimeout(refreshWeather, steps[Math.min(i++, steps.length - 1)]);
    },
    reset() {
      clearTimeout(timer);
      timer = null;
      i = 0;
    },
    get pending() {
      return Boolean(timer);
    },
  };
})();
let weatherError = "";
let weatherBusy = null;

function refreshWeather() {
  // Clicks on "retry" while a fetch is on its way share it.
  if (weatherBusy) return weatherBusy;
  weatherBusy = (async () => {
    try {
      const w = settings.get().weather;
      lastWeather = { ...(await fetchWeather(w)), city: w.city };
      weatherError = "";
      weatherRetry.reset();
      broadcast("weather", lastWeather);
      return { ok: true };
    } catch (e) {
      // The last good data stays on screen; the widget only shows the error
      // when it has nothing at all.
      const msg = e.cause?.message ? `${e.message} (${e.cause.message})` : e.message || String(e);
      // In errors.log once per distinct reason: users can then say why.
      if (msg !== weatherError) logError("weather", msg);
      weatherError = msg;
      broadcast("weather:error", weatherError);
      weatherRetry.failed();
      return { ok: false, error: weatherError };
    } finally {
      weatherBusy = null;
    }
  })();
  return weatherBusy;
}

/** Network back (Windows' own idea of it): fetch now if the last try failed. */
let wasOnline = true;
function watchNetwork() {
  const online = net.isOnline();
  if (online && !wasOnline && weatherError) refreshWeather();
  wasOnline = online;
}

// ── Game mode ──────────────────────────────────────────────────────────────
// While a game is in front Haze gets out of the way: bars and dock hide,
// the widgets window stops drawing, live glass and its capture stop, the
// wallpaper pauses and background polling idles.

const GAME_DIRS = /\\(steamapps\\common|Epic Games|Riot Games|GOG Galaxy\\Games|Ubisoft Game Launcher\\games|EA Games|XboxGames)\\/i;
const NOT_GAMES = /\\steamapps\\common\\wallpaper_engine\\/i;
/** Is this (foreground) program a game, by where it's installed? */
function isGameExe(exe) {
  return GAME_DIRS.test(exe) && !NOT_GAMES.test(exe) && !CAPTURE_TOOLS.test(exe);
}

let gameHintShown = false;
let lastGameExe = "";

/**
 * `fg`: { exe } of the foreground window. Auto mode takes a program for a
 * game only when it is installed where games live *and* covers the screen
 * edge to edge: tools and launchers from those folders run in a window and
 * shouldn't make the widgets vanish.
 */
function updateGaming(coversScreen, fg = { exe: "" }) {
  const mode = settings.get().gameMode;
  const now = Date.now();
  const game = mode === "auto" && coversScreen && isGameExe(fg.exe);
  if (game) {
    gameSince = now;
    if (fg.exe !== lastGameExe) {
      lastGameExe = fg.exe;
      // So "my widgets keep disappearing" can be traced to a program.
      console.log("[game mode] game in front:", fg.exe);
    }
  }
  // Games: leave only after 3 s away, so a quick Alt+Tab to Discord doesn't
  // flash the desktop in and out. Fullscreen video / F11: follow it at once.
  const byGame = mode === "on" || (mode === "auto" && (game || now - gameSince < 3000));
  const next = byGame || (mode === "auto" && coversScreen);
  // Widgets stay put (shown, just idle): they sit under every app anyway, and
  // a hidden window takes ~0.5 s to paint again when it comes back. Only a
  // game gets the windows taken away completely, for every frame it can get.
  if (byGame !== gameHard) {
    gameHard = byGame;
    const layers = [widgetsWin, glassWin].filter((w) => w && !w.isDestroyed());
    if (gameHard) layers.forEach((w) => w.hide());
    else {
      // Only windows that were up before: a widgets window still booting
      // shows itself when it's ready.
      layers.filter((w) => w !== widgetsWin || widgetsShown === w).forEach((w) => w.showInactive());
      pinLayers();
    }
    topbar.setHard(gameHard);
    if (gameHard) {
      logError("game mode", mode === "on" ? "on (always)" : `auto: ${lastGameExe || "fullscreen"}`);
      if (!gameHintShown) {
        // Once per session: everything just vanished, so say how to get back.
        gameHintShown = true;
        if (Notification.isSupported()) {
          new Notification({
            title: "Игровой режим",
            body: "Панели и виджеты скрыты. Ctrl+Alt+H — настройки в любой момент; выключить можно и в меню значка Haze в трее.",
            silent: true,
          }).show();
        }
      }
    }
  }
  if (next === gaming) return;
  gaming = next;
  topbar.setCovered(gaming || fullscreen);
  dock.setCovered(gaming || fullscreen);
  if (settings.get().gameDnd && !settings.get().dnd) applyDnd(gaming);
  broadcast("gaming", gaming);
}

/**
 * Window layering rules, checked twice a second against the foreground window:
 *  - maximized or fullscreen app → the wallpaper animation pauses (unseen);
 *  - fullscreen app (game, video) → the top bar and dock get out of the way.
 * Widgets need no rule: they sit at the bottom of the z-order, under every app.
 */
// Screenshot tools put a fullscreen overlay in front; that's not a game.
const CAPTURE_TOOLS = /\\(ScreenClippingHost|SnippingTool|ScreenSketch|ShareX|Lightshot|Greenshot|Snagit\w*|obs64|Flameshot)\.exe$/i;

function updateCover() {
  const s = settings.get();
  // One process lookup per check, shared by everything below.
  const fg = desktop.foreground();
  const capture = CAPTURE_TOOLS.test(fg.exe);
  // Explorer re-shows the taskbar now and then (Start menu, restart).
  if (s.hideTaskbar) desktop.keepTaskbarHidden();
  let coversScreen = false;
  let coversWork = false;
  let coversAll = false;
  // Our browser shells count as apps: fullscreen there hides the bar and dock too.
  const shells = new Set(browserShell.windows().map(desktop.hwndOf));
  const r = desktop.coveringForegroundRect(new Set([...ownHwnds()].filter((h) => !shells.has(h))));
  if (r) {
    const db = primary().bounds;
    const wa = primary().workArea;
    // Fullscreen = the window sits exactly on the screen's edges (F11, a
    // video's fullscreen, games). A maximized window overhangs them by its
    // invisible resize border (about 8 px), even when Windows calls a
    // fullscreen browser "maximized" too — so the size decides, not the flag.
    const px = (v) => Math.round(v * primary().scaleFactor);
    const B = { x: px(db.x), y: px(db.y), w: px(db.width), h: px(db.height) };
    const near = (a, b) => Math.abs(a - b) <= 2;
    coversScreen =
      near(r.x, B.x) &&
      near(r.y, B.y) &&
      near(r.width, B.w) &&
      near(r.height, B.h) &&
      !capture;
    // Covers the whole screen, edge to edge or beyond (a maximized window
    // with the taskbar hidden does): the bar and dock step aside for it.
    coversAll = r.x <= B.x + 2 && r.y <= B.y + 2 && r.width >= B.w - 4 && r.height >= B.h - 4 && !capture;
    coversWork = r.zoomed && r.width >= wa.width - 16 && r.height >= wa.height - 16;
  }
  // Bar and dock: hidden while anything covers the screen (maximized or
  // fullscreen), back at once when it doesn't. Game mode — which also hides
  // the widgets and waits 3 s before returning — only for real fullscreen.
  if (coversAll !== fullscreen) {
    fullscreen = coversAll;
    topbar.setCovered(fullscreen || gaming);
    dock.setCovered(fullscreen || gaming);
  }
  updateGaming(coversScreen, fg);
  // On a weak PC any maximized window pauses the wallpaper, even with the option off.
  const next = userPaused || gaming || ((s.pauseWhenCovered || s.lowPower) && (coversScreen || coversWork));
  if (next !== paused) {
    paused = next;
    broadcast("wallpaper:paused", paused);
  }
}

function watchDesktop() {
  topbar.check();
  // Explorer resizes its icon view on its own (restarts, resolution changes).
  syncIconInset(true);
  if (!gameHard) pinLayersIfNeeded();
  // Explorer restarts drop our wallpaper window; put it back.
  if (wallpaperWin && !wallpaperWin.isDestroyed() && !desktop.isStillAttached(wallpaperWin, wallpaperHost)) {
    attachWallpaper();
    pinLayers();
  }
  // A restarted Explorer shows its icons again.
  if (settings.get().hideDesktopIcons) desktop.setDesktopIcons(false);
}

// ── Desktop icons vs. a non-reserving bar ─────────────────────────────────

let iconInset = "";
/** Shift the desktop icons out from under the bar when it doesn't reserve space. */
function syncIconInset(force = false) {
  const o = topbar.overlay();
  const sf = primary().scaleFactor;
  const inset = o ? { [o.edge]: Math.round(o.size * sf) } : {};
  const key = JSON.stringify(inset);
  if (!force && key === iconInset) return;
  if (desktop.insetDesktopIcons(inset)) iconInset = key;
}

// ── Do Not Disturb ─────────────────────────────────────────────────────────
// Windows has no public switch for it. We turn off toast banners with the
// global notifications value and set Focus assist's quiet hours (older
// builds); alarms from Cozy still ring.

function applyDnd(on) {
  desktop.setQuietHours(on);
  return runTool("reg", [
    "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings", "/v",
    "NOC_GLOBAL_SETTING_TOASTS_ENABLED", "/t", "REG_DWORD", "/d", on ? "0" : "1", "/f",
  ]);
}

// ── Top bar data ───────────────────────────────────────────────────────────

function syncStatusBridge() {
  const s = settings.get();
  const want = s.topbar.enabled || s.widgets.net;
  if (want && !status) {
    status = startPsBridge(path.join(__dirname, "status.ps1"), (st) => {
      lastStatus = st;
      broadcast("status", st);
    });
  } else if (!want && status) {
    status.stop();
    status = null;
  }
  // Throughput sampling costs a CIM query a second: only for the network widget.
  if (status) {
    status.send(`net ${s.widgets.net ? 1 : 0}`);
    status.send(`slow ${s.lowPower ? 1 : 0}`);
  }
}

/** "Now playing" only while a widget shows it: the helper is a PowerShell process of its own. */
function syncMediaBridge() {
  const w = settings.get().widgets;
  const want = Boolean(w.player || w.sound || w.soundStrip);
  if (want && !media) {
    // The cover art (a big data URL) goes out only when it changes; updates in
    // between carry `thumb: undefined`, meaning "same as before".
    media = startMediaBridge((state) => {
      const sameArt = state.thumb && state.thumb === lastMedia.thumb;
      lastMedia = state;
      broadcast("media", sameArt ? { ...state, thumb: undefined } : state);
    });
  } else if (!want && media) {
    media.stop();
    media = null;
    lastMedia = { active: false };
    broadcast("media", lastMedia);
  }
}

function pollDesk() {
  if (!topbar.window() || gaming || fullscreen) return;
  const lang = desktop.keyboardLang() || lastDesk?.lang || 0;
  const next = { lang, ...desktop.virtualDesktops() };
  if (JSON.stringify(next) !== JSON.stringify(lastDesk)) {
    lastDesk = next;
    broadcast("desk", next);
  }
}

async function findAvatar() {
  // Windows account picture: HKLM\...\AccountPicture\Users\<SID>\Image192
  const who = await runTool("whoami", ["/user", "/fo", "csv", "/nh"], { expectFail: true });
  const sid = who.ok && who.stdout.trim().split(",").pop()?.replace(/"/g, "");
  if (!sid || !/^S-[\d-]+$/.test(sid)) return;
  const key = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AccountPicture\\Users\\${sid}`;
  const r = await runTool("reg", ["query", key, "/v", "Image192"], { expectFail: true });
  const m = r.ok && r.stdout.match(/Image192\s+REG_SZ\s+(.+)/);
  if (m) systemAvatar = pathToFileURL(m[1].trim()).href;
}
let systemAvatar = "";

// ── IPC ────────────────────────────────────────────────────────────────────

const PATCH_MAX = 256 * 1024;
// Maps a widget may change one entry of (see settings:entry).
const ENTRY_MAPS = new Set(["layout", "sizes", "scales", "dateNotes"]);

/** A settings patch from a renderer: a plain object of sane size, or an error. */
function checkPatch(patch) {
  if (!isPlainObject(patch)) throw new Error("settings: patch must be an object");
  let size;
  try {
    size = JSON.stringify(patch).length;
  } catch {
    throw new Error("settings: patch is not JSON");
  }
  if (size > PATCH_MAX) throw new Error(`settings: patch too large (${size} bytes)`);
}

/** Save from a renderer; rejects (and the page can say so) when the disk refused. */
function saveFromRenderer(patch) {
  const next = applySettings(patch);
  const err = settings.lastError();
  if (err) throw new Error(`Не удалось сохранить настройки: ${err.code || err.message}`);
  return next;
}

function registerIpc() {
  ipcMain.handle("settings:get", () => settings.get());
  ipcMain.handle("settings:set", (_e, patch) => {
    try {
      checkPatch(patch);
    } catch (e) {
      logError("settings:set", e.message);
      throw e;
    }
    return saveFromRenderer(patch);
  });
  /**
   * One entry of a map setting ({ layout: { [id]: pos } } …), merged into the
   * current map here. Two writers (the calendar widget and the day panel, a
   * drag and the settings window) then can't overwrite each other's keys
   * with a stale copy of the whole map. `value` undefined removes the entry.
   */
  ipcMain.handle("settings:entry", (_e, map, key, value) => {
    if (!ENTRY_MAPS.has(map) || typeof key !== "string" || !key || key.length > 200) throw new Error("settings:entry: bad key");
    if (value !== undefined) checkPatch({ value });
    const cur = { ...settings.get()[map] };
    if (value === undefined || value === null || value === "") delete cur[key];
    else cur[key] = value;
    return saveFromRenderer({ [map]: cur });
  });
  ipcMain.handle("theme:get", () => themeState());
  ipcMain.handle("media:get", () => lastMedia);
  ipcMain.on("media:cmd", (_e, cmd) => media && media.send(cmd));
  ipcMain.handle("weather:get", () => lastWeather);
  ipcMain.handle("weather:error", () => weatherError);
  ipcMain.handle("weather:refresh", () => refreshWeather());
  ipcMain.handle("weather:geocode", (_e, q) => geocode(q));
  ipcMain.handle("wallpaper:paused", () => paused);
  ipcMain.handle("profile:get", () => ({
    user: os.userInfo().username,
    host: os.hostname(),
    avatar: systemAvatar,
  }));
  // Every report is applied, also a repeated "not over a card": that
  // re-arms mouse forwarding, which Windows sometimes drops.
  ipcMain.on("widgets:hit", (_e, hit) => {
    if (widgetsWin && !widgetsWin.isDestroyed()) {
      widgetsWin.setIgnoreMouseEvents(!hit, { forward: true });
    }
  });
  ipcMain.on("widgets:ready", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    showWidgets(win, "ready");
    // The 15 s safety net may have shown the window before the page finished
    // mounting: showWidgets() then early-returns and nothing re-arms. Send
    // widgets:rearm anyway — the first hover must work after every show.
    if (win && !win.isDestroyed() && win.isVisible()) rearmWidgets();
  });
  ipcMain.on("open:settings", openSettings);
  ipcMain.handle("welcome:info", () => ({ weChosen: weChosenOnFirstRun }));
  ipcMain.on("welcome:show", openWelcome);
  ipcMain.on("welcome:done", closeWelcome);
  ipcMain.on("welcome:open", (_e, page) => {
    closeWelcome();
    openSettings(typeof page === "string" ? page : "");
  });
  // Settings are reachable even with no profile widget and a hidden tray.
  globalShortcut.register("Control+Alt+H", openSettings);
  ipcMain.on("system:lock", () => desktop.lockWorkStation());
  // `start` goes through ShellExecute, which handles Task Manager's elevation
  // (a plain spawn or openPath fails silently); an open one comes forward.
  ipcMain.on("system:taskmgr", () => runTool("cmd", ["/c", "start", "", "taskmgr.exe"]));
  ipcMain.on("system:power", (_e, action) => runPower(action));
  registerMoreIpc();
  registerWidgetIpc();
}

function runPower(action) {
  if (action === "sleep") return desktop.suspend();
  const args = { shutdown: ["/s", "/t", "0"], restart: ["/r", "/t", "0"], signout: ["/l"] }[action];
  if (args) runTool("shutdown", args);
}

function registerMoreIpc() {
  ipcMain.handle("dialog:pick", async (_e, kind) => {
    const filters = {
      wallpaper: [
        { name: "Обои", extensions: ["mp4", "webm", "mov", "mkv", "gif", "png", "jpg", "jpeg", "webp", "avif", "bmp", "html", "htm"] },
      ],
      image: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp"] }],
      app: [{ name: "Приложения и ярлыки", extensions: ["exe", "lnk"] }],
      convert: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "ico", "svg"] }],
    }[kind];
    if (kind === "folder") {
      const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (!r.canceled) allowFile(r.filePaths[0]);
      return r.canceled ? null : r.filePaths[0];
    }
    if (kind === "convert") {
      const r = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters });
      if (r.canceled) return [];
      r.filePaths.forEach(allowConvert);
      r.filePaths.forEach(allowFile);
      return r.filePaths;
    }
    // Apps are easiest to find as Start menu shortcuts.
    const defaultPath =
      kind === "app" ? path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft\\Windows\\Start Menu\\Programs") : undefined;
    const r = await dialog.showOpenDialog(settingsWin || undefined, { properties: ["openFile"], filters, defaultPath });
    if (!r.canceled) allowFile(r.filePaths[0]);
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("capture:source", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    const own = sources.find((src) => src.display_id === String(primary().id)) || sources[0];
    return own ? own.id : null;
  });
  // file:url turns a path into a file: URL — an arbitrary-path version would
  // let a compromised renderer probe any file on disk (load errors tell it
  // what exists). Allowed: the app's own files, userData, the wallpaper /
  // profile / Wallpaper Engine preview paths from settings, and the files the
  // user picked or dropped this session (the same registry the converter uses).
  ipcMain.handle("file:url", (_e, p) => {
    if (!canFileUrl(p)) {
      logError("file:url", "path not allowed: " + (typeof p === "string" ? p.slice(0, 120) : typeof p));
      return "";
    }
    return pathToFileURL(p).href;
  });
  // A small picture of the wallpaper as a data: URL (a file:// one would
  // taint the canvas the visualizer reads the colours from).
  let thumbCache = { key: "", url: null };
  ipcMain.handle("wallpaper:sample", async () => {
    if (settings.get().wallpaper.type !== "we" && wallpaperWin && !wallpaperWin.isDestroyed()) {
      const img = await wallpaperWin.webContents.capturePage();
      return img.isEmpty() ? null : img.resize({ width: 160 }).toDataURL();
    }
    // Wallpaper Engine draws in its own process: its preview picture stands in.
    const p = weCurrent?.preview;
    if (!p || !fs.existsSync(p)) return null;
    if (thumbCache.key !== p) {
      const img = nativeImage.createFromPath(p);
      const ext = path.extname(p).slice(1).toLowerCase().replace("jpg", "jpeg");
      const url = !img.isEmpty()
        ? img.resize({ width: 160 }).toDataURL()
        : fs.statSync(p).size < 30e6
          ? `data:image/${ext};base64,${fs.readFileSync(p).toString("base64")}`
          : null;
      thumbCache = { key: p, url };
    }
    return thumbCache.url;
  });
  ipcMain.on("open:external", (_e, url) => {
    if (!/^https:\/\//.test(url)) return;
    if (widgetsWin && !widgetsWin.isDestroyed()) {
      desktop.takeFocus(widgetsWin);
      desktop.allowAnyForeground();
    }
    shell.openExternal(url);
  });
  // Windows settings pages and flyouts, e.g. ms-settings:sound.
  ipcMain.on("open:system", (_e, uri) => {
    if (/^ms-(settings|actioncenter|phone):[\w\-/&=]*$/.test(uri)) shell.openExternal(uri);
  });

  // Wallpaper Engine
  ipcMain.handle("we:current", () => weCurrent);
  ipcMain.handle("we:status", async () => {
    // A WE installed while Haze runs is found here (the search is cached a minute).
    const found = await we.locateAsync();
    if (found) watchWe();
    return { installed: Boolean(found), running: await we.isRunning(), current: weCurrent };
  });
  ipcMain.handle("we:library", async () =>
    (await we.library()).map((i) => ({ ...i, previewUrl: i.preview ? pathToFileURL(i.preview).href : "" }))
  );
  ipcMain.handle("we:open", async (_e, dir) => {
    // Only projects WE itself lists, never an arbitrary path from the renderer.
    if ((await we.library()).some((i) => i.dir === dir)) we.openWallpaper(dir);
  });
  ipcMain.handle("we:close", () => we.closeWallpaper());
  ipcMain.handle("we:launch", () => we.launch());

  // Top bar
  ipcMain.handle("status:get", () => lastStatus);
  ipcMain.handle("gaming:get", () => gaming);
  ipcMain.on("status:cmd", (_e, cmd) => {
    if (status && /^(mute|vol \d{1,3}|volstep -?\d{1,3})$/.test(cmd)) status.send(cmd);
  });
  ipcMain.handle("desk:get", () => lastDesk);
  ipcMain.on("desk:switch", (_e, delta) => {
    if (Number.isInteger(delta) && Math.abs(delta) <= 16) desktop.switchDesktop(delta);
  });
  ipcMain.on("desk:next-layout", () => desktop.nextKeyboardLayout());

  // Dock
  ipcMain.on("topbar:hit", (_e, hit) => topbar.setHit(hit));
  ipcMain.handle("dock:items", () => dock.items());
  ipcMain.on("dock:activate", (_e, key) => dock.activate(key));
  ipcMain.on("dock:menu", (_e, key) => dock.popupMenu(key));
  ipcMain.on("dock:start", () => desktop.openStartMenu());
  ipcMain.on("shelf:taskbar", () => desktop.peekTaskbar());
  ipcMain.on("tray:open", (_e, exe) => dock.openTray(exe));
  ipcMain.on("tray:close", (_e, exe, force) => dock.closeTray(exe, force));
  ipcMain.on("dock:rect", (_e, r) => {
    // Renderer-supplied numbers reach the reveal logic: only finite, sane
    // rects get through, everything else is logged and dropped.
    const clean = sanitizeRect(r, { w: primary().workArea.width, h: primary().workArea.height });
    if (!clean) return logError("dock:rect", "bad rect from a renderer, dropped");
    dock.setRect(clean);
  });
  ipcMain.on("dock:hit", (_e, hit) => dock.setHit(hit));
  ipcMain.handle("favicon:get", (_e, host) => favicon(host));
  ipcMain.handle("image:get", (_e, url) => feedImage(url));
}

// ── Site icons ─────────────────────────────────────────────────────────────
// Launcher tiles and the browser toolbar show site icons. Asking a web
// service for them on every paint would tell it every site the user opens;
// instead each site's icon is fetched once (its own /favicon.ico first) and
// kept on disk.

const favicons = new Map(); // cache key → Promise<data URL | "">
// The only in-memory cache without a cap (icons on disk are the real store):
// one promise per distinct host, the freshest touched survive, ~64 КБ each.
const FAVICONS_MAX = 200;

function faviconDir() {
  return path.join(app.getPath("userData"), "favicons");
}

/**
 * A picture kept on disk under `name` (in userData/favicons), fetched from
 * the first of `urls` that gives one. Fetched once, then always local.
 */
function cachedImage(name, urls) {
  if (favicons.has(name)) {
    // LRU: freshen on use, so a host in steady use is never evicted.
    const job = favicons.get(name);
    favicons.delete(name);
    favicons.set(name, job);
    return job;
  }
  const file = path.join(faviconDir(), name + ".txt");
  const job = (async () => {
    try {
      return await fs.promises.readFile(file, "utf8");
    } catch {
      // Not cached yet.
    }
    let url = "";
    for (const u of urls) if ((url = await fetchIcon(u))) break;
    if (url) {
      await fs.promises.mkdir(faviconDir(), { recursive: true }).catch(() => {});
      await fs.promises.writeFile(file, url).catch(() => {});
    } else {
      // Offline now: try again in a while rather than never.
      setTimeout(() => favicons.delete(name), 10 * 60e3);
    }
    return url;
  })();
  favicons.set(name, job);
  // Evict the oldest promises only — the disk cache stays, so an evicted
  // host re-renders from disk (or re-fetches) on its next use.
  while (favicons.size > FAVICONS_MAX) favicons.delete(favicons.keys().next().value);
  return job;
}

// Team logos come from the sites the feeds read anyway; pictures from any
// other server (RSS thumbnails could be tracking pixels) aren't loaded.
const FEED_IMAGE_HOSTS = /(^|\.)(liquipedia\.net|hltv\.org|espncdn\.com)$/i;

function feedImage(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return Promise.resolve("");
  }
  if (u.protocol !== "https:" || !FEED_IMAGE_HOSTS.test(u.hostname)) return Promise.resolve("");
  const name = "img-" + crypto.createHash("sha1").update(u.href).digest("hex");
  return cachedImage(name, [u.href]);
}

async function fetchIcon(url) {
  try {
    const r = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
    const type = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!r.ok || !/^image\//.test(type)) return "";
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 512 * 1024) return "";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return "";
  }
}

/** A site's icon: its own /favicon.ico, else Google's favicon service — once per site, ever. */
function favicon(host) {
  host = String(host || "").toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || host.includes("..")) return Promise.resolve("");
  return cachedImage(host, [`https://${host}/favicon.ico`, `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`]);
}

// ── Widget IPC ─────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/** Which of `n` slides is up now; changes every `interval` seconds. */
function slideIndex(n, interval) {
  return Math.floor(Date.now() / (Math.max(10, Number(interval) || 600) * 1000)) % n;
}

/**
 * file:// URLs of the pictures at `p`: a picture itself, or the pictures in
 * a folder, sorted by name (the wallpaper and its glass copy must agree on
 * the order to show the same one). Read fresh every call, so files added to
 * or removed from the folder show up.
 */
function listImages(p) {
  if (typeof p !== "string" || !p) return [];
  try {
    if (fs.statSync(p).isFile()) return IMAGE_EXT.test(p) ? [pathToFileURL(p).href] : [];
    return fs
      .readdirSync(p)
      .filter((f) => IMAGE_EXT.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 2000)
      .map((f) => pathToFileURL(path.join(p, f)).href);
  } catch {
    return [];
  }
}
const converted = new Set(); // files the converter wrote (allowed in "reveal")

/** Every path a launcher widget or the dock may start. */
function launchablePaths() {
  const s = settings.get();
  const out = new Set((s.dock.pinned || []).map((p) => p?.path).filter(Boolean));
  for (const l of Object.values(s.launchers || {})) for (const a of l?.apps || []) if (a?.path) out.add(a.path);
  return out;
}

// The converter only touches pictures the user handed it: picked in the
// dialog or dropped on the widget (preload reports drops; a page can't make
// up a dropped file's path).
const CONVERT_SRC = /\.(jpe?g|png|webp|gif|avif|bmp|ico|svg)$/i;
const CONVERT_MAX = 64 << 20;
const convertable = new Set();

function allowConvert(p) {
  if (typeof p === "string" && CONVERT_SRC.test(p)) convertable.add(path.resolve(p));
}

function canConvert(src) {
  return typeof src === "string" && CONVERT_SRC.test(src) && convertable.has(path.resolve(src)) && fs.existsSync(src);
}

// ── Which paths a renderer may turn into a file: URL ───────────────────

// The same "user handed it over" idea, for the file:url channel: the app's
// own tree, files under userData, the paths settings itself references
// (wallpaper, profile pictures, Wallpaper Engine's preview) and everything
// picked in a dialog or dropped on a widget this session. Anything else —
// e.g. C:\Windows\regedit.exe — is refused and logged.
const grantedFiles = new Set();

function allowFile(p) {
  if (typeof p === "string" && path.isAbsolute(p)) grantedFiles.add(path.normalize(p));
}

/** `p` sits inside `dir` (case-insensitive: Windows paths). */
function insideDir(dir, p) {
  if (typeof dir !== "string" || !dir) return false;
  const rel = path.relative(path.resolve(dir).toLowerCase(), path.resolve(p).toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function canFileUrl(p) {
  if (typeof p !== "string" || !path.isAbsolute(p)) return false;
  if (insideDir(app.getAppPath(), p) || insideDir(app.getPath("userData"), p)) return true;
  const s = settings.get();
  const full = path.normalize(p).toLowerCase();
  const eq = (q) => typeof q === "string" && q && path.normalize(q).toLowerCase() === full;
  if (eq(s.wallpaper?.path) || eq(s.profile?.avatarPath) || eq(s.profile?.bannerPath) || eq(weCurrent?.preview)) return true;
  return grantedFiles.has(path.normalize(p));
}

/** `name.ext`, or `name (2).ext` … when taken. */
function freeName(dir, base, ext) {
  let file = path.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i}).${ext}`);
  return file;
}

async function imageToPdf(src) {
  const html = path.join(app.getPath("temp"), `cozy-pdf-${process.pid}.html`);
  fs.writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0}img{display:block;width:100%}</style><img src="${pathToFileURL(src).href}">`
  );
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadFile(html);
    const [nw, nh] = await w.webContents.executeJavaScript(
      "new Promise(r => { const i = document.images[0]; const done = () => r([i.naturalWidth || 800, i.naturalHeight || 600]); i.complete ? done() : (i.onload = i.onerror = done); })"
    );
    // One page exactly the size of the picture (at 96 dpi).
    return await w.webContents.printToPDF({
      pageSize: { width: nw / 96, height: nh / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
    });
  } finally {
    w.destroy();
    fs.rmSync(html, { force: true });
  }
}

// ── Launcher widgets behave like a taskbar ────────────────────────────────
// A click brings the app/site forward (or minimizes it if it's already in
// front) and only starts it when nothing is open; removing an entry closes
// its windows first.

function launcherEntry(id, index) {
  return settings.get().launchers[id]?.apps?.[index] || null;
}

/** Top-level windows of a program entry (the .lnk's target exe). */
function entryWindows(app) {
  const exe = linkTarget(app.path).toLowerCase();
  if (!exe) return [];
  return desktop.appWindows(ownHwnds()).filter((w) => w.exe.toLowerCase() === exe);
}

function activateEntry(app) {
  if (app.url) return browserShell.toggle(app.url, app.url);
  const wins = entryWindows(app);
  if (!wins.length) return shell.openPath(app.path);
  const fg = desktop.foregroundWindow();
  const front = wins.find((w) => w.hwnd === fg);
  if (front && !front.minimized) desktop.minimizeWindow(front.hwnd);
  else desktop.activateWindow(wins[0].hwnd);
}

function closeEntry(app) {
  if (app.url) return browserShell.close(app.url);
  for (const w of entryWindows(app)) desktop.closeWindow(w.hwnd);
}

let lastLauncherStates = "";
/** Which launcher entries have a window: { "url or path": "open" | "min" }. */
function pushLauncherStates() {
  if (!widgetsWin || widgetsWin.isDestroyed() || gaming) return;
  const launchers = Object.values(settings.get().launchers);
  if (!launchers.length) return;
  const states = browserShell.states();
  const wins = desktop.appWindows(ownHwnds());
  for (const l of launchers) {
    for (const a of l.apps) {
      if (!a.path) continue;
      const exe = linkTarget(a.path).toLowerCase();
      const mine = wins.filter((w) => w.exe.toLowerCase() === exe);
      if (mine.length) states[a.path] = mine.every((w) => w.minimized) ? "min" : "open";
    }
  }
  const json = JSON.stringify(states);
  if (json === lastLauncherStates) return;
  lastLauncherStates = json;
  widgetsWin.webContents.send("launcher:states", states);
}

function registerWidgetIpc() {
  ipcMain.on("launcher:activate", (_e, id, index) => {
    const app = launcherEntry(id, index);
    if (app) activateEntry(app);
    setTimeout(pushLauncherStates, 300);
  });
  ipcMain.on("launcher:remove", (_e, id, index) => {
    const app = launcherEntry(id, index);
    if (!app) return;
    closeEntry(app);
    const l = settings.get().launchers[id];
    applySettings({ launchers: { ...settings.get().launchers, [id]: { ...l, apps: (l.apps || []).filter((_, i) => i !== index) } } });
  });
  ipcMain.handle("launcher:states", () => {
    lastLauncherStates = "";
    setTimeout(pushLauncherStates);
    return null;
  });
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), electron: process.versions.electron }));
  ipcMain.on("app:cmd", (e, cmd) => {
    if (BrowserWindow.fromWebContents(e.sender) !== settingsWin) return;
    if (cmd === "relaunch") {
      app.relaunch();
      app.quit();
    }
    if (cmd === "quit") app.quit();
  });
  // Window buttons of frameless windows (settings).
  ipcMain.on("win:cmd", (e, cmd) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || w !== settingsWin) return;
    if (cmd === "min") w.minimize();
    if (cmd === "max") w.isMaximized() ? w.unmaximize() : w.maximize();
    if (cmd === "close") w.close();
  });
  /**
   * What the settings should show as the current wallpaper:
   * { kind: "video" | "image", url, lowres }. Videos (ours or Wallpaper
   * Engine's) are framed by the page itself at full size; our animation is
   * captured from its window; WE scenes only have their small preview.
   */
  ipcMain.handle("wallpaper:thumb", async () => {
    const wp = settings.get().wallpaper;
    const VIDEO = /\.(mp4|webm|mov|mkv|m4v)$/i;
    const IMAGE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
    const url = (f) => pathToFileURL(f).href;
    if (wp.type === "we") {
      const cur = weCurrent;
      if (!cur) return { kind: "image", url: "" };
      if (cur.type === "video" && fs.existsSync(cur.file)) return { kind: "video", url: url(cur.file) };
      return { kind: "image", url: cur.preview && fs.existsSync(cur.preview) ? url(cur.preview) : "", lowres: true };
    }
    // A folder slideshow: the picture up now (same pick as wallsource.js).
    if (wp.type === "folder") {
      const list = listImages(wp.path);
      if (list.length) return { kind: "image", url: list[slideIndex(list.length, wp.interval)] };
    }
    if (wp.type !== "shader" && wp.path && fs.existsSync(wp.path)) {
      if (VIDEO.test(wp.path)) return { kind: "video", url: url(wp.path) };
      if (IMAGE.test(wp.path)) return { kind: "image", url: url(wp.path) };
    }
    // Our animation (and HTML wallpapers): a snapshot of the wallpaper window.
    if (wallpaperWin && !wallpaperWin.isDestroyed()) {
      try {
        const img = await wallpaperWin.webContents.capturePage();
        if (!img.isEmpty()) return { kind: "image", url: "data:image/jpeg;base64," + img.resize({ width: 1280 }).toJPEG(86).toString("base64") };
      } catch {
        // No snapshot; the page shows the palette gradient.
      }
    }
    return { kind: "image", url: "" };
  });
  ipcMain.on("panel:open", () => widgetsWin && !widgetsWin.isDestroyed() && widgetsWin.webContents.send("panel:open"));
  ipcMain.on("alarm:snooze", (_e, id) => typeof id === "string" && clockwork.snooze(id));
  ipcMain.on("power:set", (_e, action, minutes) => {
    const m = Number(minutes);
    if (Number.isFinite(m) && m > 0 && m <= 7 * 24 * 60) clockwork.setPowerTimer(action, m);
  });
  ipcMain.on("power:cancel", () => clockwork.cancelPowerTimer());
  ipcMain.on("notify", (_e, n) => {
    if (!isPlainObject(n) || settings.get().dnd) return;
    const title = String(n.title || "Haze").slice(0, 200);
    const body = String(n.body || "").slice(0, 1000);
    new Notification({ title, body }).show();
  });

  // A single picture works as well as a folder of them.
  ipcMain.handle("photos:list", () => listImages(settings.get().photoFolder));
  ipcMain.handle("images:list", (_e, p) => listImages(p));

  // Inputs in widgets need keyboard focus; see createWidgets().
  ipcMain.on("widgets:focus", () => {
    if (!widgetsWin || widgetsWin.isDestroyed()) return;
    widgetsWin.setFocusable(true);
    desktop.takeFocus(widgetsWin);
    widgetsWin.webContents.focus();
    pinLayers();
  });
  // A (re)created glass layer asks the widgets for their card shapes again.
  ipcMain.on("glass:ready", () => widgetsWin && !widgetsWin.isDestroyed() && widgetsWin.webContents.send("glass:resend"));
  ipcMain.on("glass:rects", (_e, rects) => {
    let clean;
    try {
      clean = sanitizeRects(rects, { w: primary().workArea.width, h: primary().workArea.height });
    } catch (err) {
      return logError("glass:rects", err.message);
    }
    if (clean.dropped) logError("glass:rects", `dropped ${clean.dropped} bad rect(s) of ${clean.rects.length + clean.dropped}`);
    glassRects = clean.rects;
    if (glassWin && !glassWin.isDestroyed()) glassWin.webContents.send("glass:rects", clean.rects);
  });

  ipcMain.handle("app:icon", (_e, p) => {
    // Icon extraction reads the file: only paths a launcher/dock tile may
    // start are allowed, so a renderer can't pull icons of arbitrary files.
    if (!launchablePaths().has(String(p))) {
      logError("app:icon", "path not launchable, refused: " + String(p).slice(0, 120));
      return null;
    }
    return iconFor(String(p));
  });
  ipcMain.on("app:launch", (_e, p) => {
    if (launchablePaths().has(p)) shell.openPath(p);
  });
  ipcMain.on("app:reveal", (_e, p) => {
    if (launchablePaths().has(p)) shell.showItemInFolder(p);
  });
  ipcMain.on("browser:open", (_e, url) => {
    if (/^https?:\/\//i.test(url)) openBrowser(url);
  });

  // Native context menu; resolves with the chosen item's id (or null). The
  // template comes from a renderer, so it's validated first (plain objects,
  // ≤ 100 items, ≤ 3 levels, labels ≤ 200 chars): a cyclic or oversized one
  // is logged and no-ops instead of throwing an unhandled rejection.
  ipcMain.handle(
    "menu:popup",
    (e, items) =>
      new Promise((resolve) => {
        let chosen = null;
        let menu;
        try {
          menu = Menu.buildFromTemplate(checkMenuTemplate(items, (id) => (chosen = id)));
        } catch (err) {
          logError("menu:popup", err.message);
          return resolve(null);
        }
        // Click handlers run just after the menu closes.
        menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(chosen), 30) });
      })
  );

  // Image converter: the renderer re-encodes, we write next to the original.
  ipcMain.on("files:dropped", (_e, p) => {
    allowConvert(p);
    allowFile(p);
  });
  ipcMain.handle("convert:save", (_e, src, ext, data) => {
    if (!/^(png|jpg|webp|bmp|ico)$/.test(ext) || !canConvert(src)) return null;
    const size = data?.byteLength ?? data?.length ?? 0;
    if (!size || size > CONVERT_MAX) return null;
    const out = freeName(path.dirname(src), path.parse(src).name, ext);
    fs.writeFileSync(out, Buffer.from(data));
    converted.add(out);
    allowFile(out);
    return out;
  });
  ipcMain.handle("convert:pdf", async (_e, src) => {
    if (!canConvert(src)) return null;
    const out = freeName(path.dirname(src), path.parse(src).name, "pdf");
    fs.writeFileSync(out, await imageToPdf(src));
    converted.add(out);
    allowFile(out);
    return out;
  });
  ipcMain.on("convert:reveal", (_e, p) => converted.has(p) && shell.showItemInFolder(p));

  // Info widgets. Phone folders may only be opened if the phone feed listed them.
  const phonePaths = new Set();
  ipcMain.handle("feed:get", async (_e, kind, params) => {
    const data = await feeds.get(kind, params);
    if (kind === "phone") for (const d of data.devices || []) [d.path, d.camera].forEach((p) => p && phonePaths.add(p));
    return data;
  });
  ipcMain.on("phone:open", (_e, p) => phonePaths.has(p) && runTool("explorer", [p], { expectFail: true }));
}

// Dev aid: COZY_CAPTURE=<dir> saves PNG snapshots of both desktop layers.
async function captureForDebug() {
  const fs = require("node:fs");
  const dir = process.env.COZY_CAPTURE;
  const layers = [
    ["wallpaper", wallpaperWin],
    ["widgets", widgetsWin],
    ["topbar", topbar.window()],
    ["dock", dock.window()],
  ];
  for (const [name, w] of layers) {
    if (!w || w.isDestroyed()) continue;
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
  }
  if (!wallpaperWin) return console.log("[capture] saved to", dir);
  const diag = await wallpaperWin.webContents.executeJavaScript(`(() => {
    const c = document.querySelector("canvas");
    if (!c) return { canvas: false, html: document.body.innerHTML.slice(0, 200) };
    const gl = c.getContext("webgl");
    const px = new Uint8Array(4);
    if (gl) gl.readPixels(c.width >> 1, c.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { canvas: true, w: c.width, h: c.height, inner: [innerWidth, innerHeight], gl: !!gl, px: [...px],
      vis: document.visibilityState, theme: document.documentElement.dataset.palette };
  })()`);
  console.log("[capture] wallpaper", JSON.stringify(diag), "bounds", JSON.stringify(wallpaperWin.getBounds()));
  console.log("[capture] saved to", dir);
}

// ── Timers ─────────────────────────────────────────────────────────────────
// Everything Haze polls, in one place (see poller.js). A weak PC stretches
// the intervals; HAZE_PROF=1 logs what each costs.

function startTimers() {
  timers.forEach((stop) => stop());
  timers.length = 0;
  poller.setSlow(settings.get().lowPower ? 2 : 1);
  const every = (name, ms, fn, opts) => timers.push(poller.every(name, ms, fn, opts));
  every("weather", 15 * 60 * 1000, () => weatherRetry.pending || refreshWeather(), { fixed: true });
  every("stats", 2000, () => broadcast("stats", system.sample()));
  every("cover", 250, updateCover);
  every("desk", 400, pollDesk);
  every("launchers", 1500, pushLauncherStates);
  // The bridge restarts on its own after a crash; keep its options current.
  every(
    "status opts",
    15000,
    () => {
      if (!status) return;
      status.send(`net ${settings.get().widgets.net ? 1 : 0}`);
      status.send(`slow ${settings.get().lowPower ? 1 : 0}`);
    },
    { fixed: true }
  );
  every("desktop", 5000, watchDesktop, { fixed: true });
  every("glass", 250, watchGlassOverlap);
  every("network", 5000, watchNetwork, { fixed: true });
  // Alarms: every second, whatever the power setting.
  every("clock", 1000, clockwork.tick, { fixed: true });
}

// ── Crash recovery ─────────────────────────────────────────────────────────
// Hiding the taskbar and the desktop icons outlives Haze if it's killed
// (Task Manager, a crash, power loss). A lock file marks a running Haze; one
// left over at start means the last run never cleaned up, so Windows is put
// back first. `--restore` does only that and exits (stop.cmd can use it).

function lockFile() {
  return path.join(app.getPath("userData"), "running.lock");
}

/**
 * Undo what Haze changes in Windows — by default only what the settings say
 * it changed (a taskbar the user auto-hides themselves stays that way).
 * `force` restores everything unconditionally: the crash path can't trust the
 * settings file (it may be corrupt, with no .bak either), and restoring
 * something that wasn't hidden is harmless — the Win32 calls are idempotent.
 */
function restoreWindows(s, force = false) {
  const steps = [
    ["taskbar", force || s.hideTaskbar, () => desktop.taskbarAutoHide(false)],
    ["dnd", force || s.dnd, () => applyDnd(false)],
    ["desktop icons", force || s.hideDesktopIcons, () => desktop.setDesktopIcons(true)],
    ["icon inset", true, () => desktop.insetDesktopIcons({})],
  ];
  for (const [name, needed, fn] of steps) {
    if (!needed) continue;
    try {
      fn();
    } catch (e) {
      logError(`restore ${name}`, e);
    }
  }
}

function recoverFromCrash() {
  if (!fs.existsSync(lockFile())) return false;
  logError("start", "the previous run didn't quit cleanly; restoring the taskbar, desktop icons and notifications");
  // Unconditionally: the previous run may have crashed with the taskbar
  // hidden AND the settings unreadable (corrupt, no .bak) — the settings-driven
  // restore would then be skipped and the user left with no taskbar.
  restoreWindows(settings.get(), true);
  return true;
}

function writeLock() {
  try {
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), String(process.pid));
  } catch (e) {
    logError("lock", e);
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

// The app used to be called Cozy Desktop; bring its settings over once.
function migrateUserData() {
  const now = path.join(app.getPath("userData"), "settings.json");
  const old = path.join(app.getPath("appData"), "cozy-desktop", "settings.json");
  if (fs.existsSync(now) || !fs.existsSync(old)) return;
  fs.mkdirSync(path.dirname(now), { recursive: true });
  fs.copyFileSync(old, now);
}

function start() {
  migrateUserData();
  const fresh = settings.isFirstRun();
  settings.load();
  if (process.argv.includes("--restore")) {
    restoreWindows(settings.get());
    fs.rmSync(lockFile(), { force: true });
    return app.exit(0);
  }
  recoverFromCrash();
  writeLock();
  app.setAppUserModelId("Haze");
  registerIpc();
  findAvatar();
  const s = settings.get();
  // Top bar before the widgets: it shrinks the work area they're laid out in.
  topbar.sync(s.topbar);
  syncWallpaperLayer();
  createWidgets();
  dock.sync(s.dock);
  createTray();
  syncStatusBridge();

  if (s.hideTaskbar) desktop.taskbarAutoHide(true);
  if (s.hideDesktopIcons) desktop.setDesktopIcons(false);
  if (s.dnd) applyDnd(true);
  clockwork.restore();
  // After the layers are up, so the tour opens over a finished desktop.
  if (fresh) setTimeout(firstRun, 1500);

  we.locateAsync().then((found) => found && watchWe());
  syncMediaBridge();

  wasOnline = net.isOnline();
  refreshWeather();
  startTimers();
  // React the instant a window maximizes, goes fullscreen or comes back,
  // instead of waiting for the next poll. Dragging a window sends hundreds
  // of location changes a second: at most one check per COVER_GAP ms, plus
  // one after the burst so the final state is never missed.
  const COVER_GAP = 60;
  let coverTimer = null;
  let coverAt = 0;
  stopWindowWatch = desktop.watchWindows(() => {
    if (coverTimer) return;
    const wait = Math.max(0, coverAt + COVER_GAP - Date.now());
    coverTimer = setTimeout(() => {
      coverTimer = null;
      coverAt = Date.now();
      updateCover();
    }, wait);
  });
  // Back from sleep: the network may have changed, forwarding may be gone.
  powerMonitor.on("resume", () => {
    setTimeout(refreshWeather, 5000);
    rearmWidgets();
  });

  nativeTheme.on("updated", () => broadcast("theme", themeState()));
  if (process.env.COZY_CAPTURE) setTimeout(captureForDebug, 8000);
  screen.on("display-metrics-changed", placeWindows);
  screen.on("display-added", placeWindows);
  screen.on("display-removed", placeWindows);
}

app.on("window-all-closed", () => {
  // Keep running in the tray when the settings window closes.
});

/** Wallpaper Engine is installed: follow which wallpaper it shows. */
let stopWeWatch = null;
function watchWe() {
  if (stopWeWatch) return;
  weCurrent = we.current();
  broadcast("we:current", weCurrent);
  stopWeWatch = we.watchCurrent((c) => {
    weCurrent = c;
    broadcast("we:current", c);
  });
}

let quitting = false;
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  // Each step on its own: one throwing must not leave the taskbar hidden.
  const step = (name, fn) => {
    try {
      fn();
    } catch (e) {
      logError(`quit ${name}`, e);
    }
  };
  // Leave Windows as we found it — the parts a user can't easily fix first.
  const s = settings.get();
  step("restore", () => restoreWindows(s));
  // Give back the top strip; a stale app bar keeps it reserved until Explorer restarts.
  step("topbar", () => topbar.destroy());
  step("dock", () => dock.destroy());
  step("timers", () => timers.forEach((stop) => stop()));
  step("window watch", () => stopWindowWatch && stopWindowWatch());
  step("media", () => media && media.stop());
  step("status", () => status && status.stop());
  // In Wallpaper Engine mode the desktop is WE's; leave it alone.
  step("widgets", () => {
    if (glassWin && !glassWin.isDestroyed() && widgetsWin && !widgetsWin.isDestroyed()) desktop.pinToDesktop(widgetsWin);
  });
  step("wallpaper", () => {
    if (wallpaperWin && !wallpaperWin.isDestroyed()) {
      wallpaperWin.destroy();
      desktop.refreshSystemWallpaper();
    }
  });
  // A clean exit: nothing to repair at the next start.
  step("lock", () => fs.rmSync(lockFile(), { force: true }));
});
