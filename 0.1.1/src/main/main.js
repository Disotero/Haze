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
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const settings = require("./settings");
const desktop = require("./desktop");
const system = require("./system");
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
function logError(kind, err) {
  try {
    const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : err}
`;
    console.error(line);
    fs.appendFileSync(path.join(app.getPath("userData"), "errors.log"), line);
  } catch {
    // Nowhere left to report it.
  }
}
process.on("uncaughtException", (e) => logError("uncaughtException", e));
process.on("unhandledRejection", (e) => logError("unhandledRejection", e));

if (!app.requestSingleInstanceLock() || process.argv.includes("--quit")) {
  app.quit();
} else {
  // `electron . --quit` asks the running copy to exit cleanly (it must hand
  // back the app bar space and repaint the stock wallpaper).
  // `--settings=<page>` opens the settings on that page.
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--quit")) return app.quit();
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

function webPrefs() {
  // Alarms and timers must be able to play a sound without a click first.
  return {
    preload: PRELOAD,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
    autoplayPolicy: "no-user-gesture-required",
  };
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
    webPreferences: webPrefs(),
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
  widgetsWin.once("ready-to-show", () => {
    widgetsWin.showInactive();
    pinLayers();
    syncGlass();
  });
  // Typing in a widget (notes, search…) makes the window focusable for a
  // moment; once focus leaves, it goes back to never stealing focus.
  // Taking focus raised the window over the apps: send it back down.
  widgetsWin.on("blur", () => {
    widgetsWin.setFocusable(false);
    pinLayers();
  });
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
      glassWin.showInactive();
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
    { type: "separator" },
    { label: "Выход", click: () => app.quit() },
  ]);
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
  if ("autostart" in patch) {
    app.setLoginItemSettings({
      openAtLogin: next.autostart,
      // The portable build runs from a temp unpack dir; point at the real exe.
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    });
  }
  if (patch.weather && JSON.stringify(patch.weather) !== JSON.stringify(before.weather)) {
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
    startTimers();
    if (status) status.send(`slow ${next.lowPower ? 1 : 0}`);
  }
  if ("hideDesktopIcons" in patch) desktop.setDesktopIcons(!next.hideDesktopIcons);
  if ("hideTaskbar" in patch) desktop.taskbarAutoHide(next.hideTaskbar);
  if ("dnd" in patch) applyDnd(next.dnd);
  if ("gameMode" in patch) updateGaming(false); // the next cover check fills in fullscreen
  if ("wallpaperSound" in patch && next.wallpaper.type === "we") we.setMuted(!next.wallpaperSound);
  if (patch.widgets) syncStatusBridge();
  if (patch.topbar) {
    topbar.sync(next.topbar);
    setTimeout(() => {
      syncIconInset();
      placeWindows();
    }, 300);
    syncStatusBridge();
  }
  if (patch.dock) dock.sync(next.dock);
  if (tray) tray.setContextMenu(buildTrayMenu());
  broadcast("settings", next);
  broadcast("theme", themeState());
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

async function refreshWeather() {
  try {
    lastWeather = { ...(await fetchWeather(settings.get().weather)), city: settings.get().weather.city };
    broadcast("weather", lastWeather);
  } catch (e) {
    console.error("[weather]", e.message);
  }
}

// ── Game mode ──────────────────────────────────────────────────────────────
// While a game is in front Haze gets out of the way: bars and dock hide,
// the widgets window stops drawing, live glass and its capture stop, the
// wallpaper pauses and background polling idles.

const GAME_DIRS = /\\(steamapps\\common|Epic Games|Riot Games|GOG Galaxy\\Games|Ubisoft Game Launcher\\games|EA Games|XboxGames)\\/i;
const NOT_GAMES = /\\steamapps\\common\\wallpaper_engine\\/i;
let fgExe = { hwnd: 0, exe: "" };

/** Is the foreground app a game (by where it's installed)? */
function foregroundIsGame() {
  const hwnd = desktop.foregroundWindow();
  if (hwnd !== fgExe.hwnd) fgExe = { hwnd, exe: desktop.foregroundExe() };
  return GAME_DIRS.test(fgExe.exe) && !NOT_GAMES.test(fgExe.exe) && !CAPTURE_TOOLS.test(fgExe.exe);
}

function updateGaming(coversScreen) {
  const mode = settings.get().gameMode;
  const now = Date.now();
  const game = mode === "auto" && foregroundIsGame();
  if (game) gameSince = now;
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
      layers.forEach((w) => w.showInactive());
      pinLayers();
    }
    topbar.setHard(gameHard);
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
      !CAPTURE_TOOLS.test(desktop.foregroundExe());
    // Covers the whole screen, edge to edge or beyond (a maximized window
    // with the taskbar hidden does): the bar and dock step aside for it.
    coversAll =
      r.x <= B.x + 2 && r.y <= B.y + 2 && r.width >= B.w - 4 && r.height >= B.h - 4 && !CAPTURE_TOOLS.test(desktop.foregroundExe());
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
  updateGaming(coversScreen);
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
  pinLayers();
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
  execFile(
    "reg",
    ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings", "/v",
      "NOC_GLOBAL_SETTING_TOASTS_ENABLED", "/t", "REG_DWORD", "/d", on ? "0" : "1", "/f"],
    { windowsHide: true }
  );
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

function pollDesk() {
  if (!topbar.window() || gaming || fullscreen) return;
  const lang = desktop.keyboardLang() || lastDesk?.lang || 0;
  const next = { lang, ...desktop.virtualDesktops() };
  if (JSON.stringify(next) !== JSON.stringify(lastDesk)) {
    lastDesk = next;
    broadcast("desk", next);
  }
}

function findAvatar() {
  // Windows account picture: HKLM\...\AccountPicture\Users\<SID>\Image192
  execFile("whoami", ["/user", "/fo", "csv", "/nh"], { windowsHide: true }, (err, out) => {
    const sid = !err && out.trim().split(",").pop()?.replace(/"/g, "");
    if (!sid) return;
    const key = `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AccountPicture\\Users\\${sid}`;
    execFile("reg", ["query", key, "/v", "Image192"], { windowsHide: true }, (e2, o2) => {
      const m = !e2 && o2.match(/Image192\s+REG_SZ\s+(.+)/);
      if (m) systemAvatar = pathToFileURL(m[1].trim()).href;
    });
  });
}
let systemAvatar = "";

// ── IPC ────────────────────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle("settings:get", () => settings.get());
  ipcMain.handle("settings:set", (_e, patch) => applySettings(patch));
  ipcMain.handle("theme:get", () => themeState());
  ipcMain.handle("media:get", () => lastMedia);
  ipcMain.on("media:cmd", (_e, cmd) => media && media.send(cmd));
  ipcMain.handle("weather:get", () => lastWeather);
  ipcMain.handle("weather:refresh", () => refreshWeather());
  ipcMain.handle("weather:geocode", (_e, q) => geocode(q));
  ipcMain.handle("wallpaper:paused", () => paused);
  ipcMain.handle("profile:get", () => ({
    user: os.userInfo().username,
    host: os.hostname(),
    avatar: systemAvatar,
  }));
  ipcMain.on("widgets:hit", (_e, hit) => {
    if (widgetsWin && !widgetsWin.isDestroyed()) {
      widgetsWin.setIgnoreMouseEvents(!hit, { forward: true });
    }
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
  ipcMain.on("system:taskmgr", () => execFile("cmd.exe", ["/c", "start", "", "taskmgr.exe"], { windowsHide: true }));
  ipcMain.on("system:power", (_e, action) => runPower(action));
  registerMoreIpc();
  registerWidgetIpc();
}

function runPower(action) {
  {
    const cmds = {
      shutdown: ["shutdown", ["/s", "/t", "0"]],
      restart: ["shutdown", ["/r", "/t", "0"]],
      sleep: [
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
        ],
      ],
      signout: ["shutdown", ["/l"]],
    };
    const c = cmds[action];
    if (c) execFile(c[0], c[1], { windowsHide: true });
  }
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
      return r.canceled ? null : r.filePaths[0];
    }
    if (kind === "convert") {
      const r = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters });
      return r.canceled ? [] : r.filePaths;
    }
    // Apps are easiest to find as Start menu shortcuts.
    const defaultPath =
      kind === "app" ? path.join(process.env.ProgramData || "C:\\ProgramData", "Microsoft\\Windows\\Start Menu\\Programs") : undefined;
    const r = await dialog.showOpenDialog(settingsWin || undefined, { properties: ["openFile"], filters, defaultPath });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("capture:source", async () => {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    const own = sources.find((src) => src.display_id === String(primary().id)) || sources[0];
    return own ? own.id : null;
  });
  ipcMain.handle("file:url", (_e, p) => (p ? pathToFileURL(p).href : ""));
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
  ipcMain.handle("we:status", async () => ({
    installed: Boolean(we.locate()),
    running: await we.isRunning(),
    current: weCurrent,
  }));
  ipcMain.handle("we:library", () =>
    we.library().map((i) => ({ ...i, previewUrl: i.preview ? pathToFileURL(i.preview).href : "" }))
  );
  ipcMain.handle("we:open", (_e, dir) => {
    // Only projects WE itself lists, never an arbitrary path from the renderer.
    if (we.library().some((i) => i.dir === dir)) we.openWallpaper(dir);
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
  ipcMain.on("dock:rect", (_e, r) => dock.setRect(r));
  ipcMain.on("dock:hit", (_e, hit) => dock.setHit(hit));
}

// ── Widget IPC ─────────────────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const converted = new Set(); // files the converter wrote (allowed in "reveal")

/** Every path a launcher widget or the dock may start. */
function launchablePaths() {
  const s = settings.get();
  const out = new Set(s.dock.pinned.map((p) => p.path));
  for (const l of Object.values(s.launchers)) for (const a of l.apps) if (a.path) out.add(a.path);
  return out;
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
  return settings.get().launchers[id]?.apps[index] || null;
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
    applySettings({ launchers: { ...settings.get().launchers, [id]: { ...l, apps: l.apps.filter((_, i) => i !== index) } } });
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
  ipcMain.on("alarm:snooze", (_e, id) => clockwork.snooze(id));
  ipcMain.on("power:set", (_e, action, minutes) => clockwork.setPowerTimer(action, Number(minutes)));
  ipcMain.on("power:cancel", () => clockwork.cancelPowerTimer());
  ipcMain.on("notify", (_e, n) => {
    if (!settings.get().dnd) new Notification({ title: String(n.title || "Haze"), body: String(n.body || "") }).show();
  });

  ipcMain.handle("photos:list", () => {
    const dir = settings.get().photoFolder;
    if (!dir) return [];
    try {
      // A single picture works as well as a folder of them.
      if (fs.statSync(dir).isFile()) return IMAGE_EXT.test(dir) ? [pathToFileURL(dir).href] : [];
      return fs
        .readdirSync(dir)
        .filter((f) => IMAGE_EXT.test(f))
        .slice(0, 2000)
        .map((f) => pathToFileURL(path.join(dir, f)).href);
    } catch {
      return [];
    }
  });

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
    glassRects = rects;
    if (glassWin && !glassWin.isDestroyed()) glassWin.webContents.send("glass:rects", rects);
  });

  ipcMain.handle("app:icon", (_e, p) => iconFor(String(p)));
  ipcMain.on("app:launch", (_e, p) => {
    if (launchablePaths().has(p)) shell.openPath(p);
  });
  ipcMain.on("app:reveal", (_e, p) => {
    if (launchablePaths().has(p)) shell.showItemInFolder(p);
  });
  ipcMain.on("browser:open", (_e, url) => {
    if (/^https?:\/\//i.test(url)) openBrowser(url);
  });

  // Native context menu; resolves with the chosen item's id (or null).
  ipcMain.handle(
    "menu:popup",
    (e, items) =>
      new Promise((resolve) => {
        let chosen = null;
        const build = (list) =>
          list.map((it) =>
            it.type === "separator"
              ? { type: "separator" }
              : it.submenu
                ? { label: String(it.label), submenu: build(it.submenu) }
                : {
                    label: String(it.label),
                    type: it.checked == null ? "normal" : it.radio ? "radio" : "checkbox",
                    checked: Boolean(it.checked),
                    click: () => (chosen = it.id),
                  }
          );
        const menu = Menu.buildFromTemplate(build(items));
        // Click handlers run just after the menu closes.
        menu.popup({ window: BrowserWindow.fromWebContents(e.sender), callback: () => setTimeout(() => resolve(chosen), 30) });
      })
  );

  // Image converter: the renderer re-encodes, we write next to the original.
  ipcMain.handle("convert:save", (_e, src, ext, data) => {
    if (!/^(png|jpg|webp|bmp|ico)$/.test(ext) || !fs.existsSync(src)) return null;
    const out = freeName(path.dirname(src), path.parse(src).name, ext);
    fs.writeFileSync(out, Buffer.from(data));
    converted.add(out);
    return out;
  });
  ipcMain.handle("convert:pdf", async (_e, src) => {
    if (!fs.existsSync(src)) return null;
    const out = freeName(path.dirname(src), path.parse(src).name, "pdf");
    fs.writeFileSync(out, await imageToPdf(src));
    converted.add(out);
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
  ipcMain.on("phone:open", (_e, p) => phonePaths.has(p) && execFile("explorer.exe", [p]));
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

const prof = {};
if (process.env.HAZE_PROF) global.setInterval(() => console.log("[prof]", JSON.stringify(Object.fromEntries(Object.entries(prof).map(([k, [t, n]]) => [k, `${t.toFixed(0)}ms/${n}`])))), 30000);

// ── Timers ─────────────────────────────────────────────────────────────────
// Everything Haze polls, in one place. A weak PC stretches the intervals.

function startTimers() {
  timers.forEach(clearInterval);
  timers.length = 0;
  // HAZE_PROF=1: log how long each poll takes (dev aid).
  const setInterval = process.env.HAZE_PROF
    ? (fn, ms) =>
        global.setInterval(() => {
          const t = performance.now();
          fn();
          const d = performance.now() - t;
          (prof[fn.name || ms] ||= [0, 0])[0] += d;
          prof[fn.name || ms][1]++;
        }, ms)
    : global.setInterval;
  const k = settings.get().lowPower ? 2 : 1;
  timers.push(setInterval(refreshWeather, 15 * 60 * 1000));
  timers.push(setInterval(() => broadcast("stats", system.sample()), 2000 * k));
  timers.push(setInterval(updateCover, 250 * k));
  timers.push(setInterval(pollDesk, 400 * k));
  timers.push(setInterval(pushLauncherStates, 1500 * k));
  // The bridge restarts on its own after a crash; keep its options current.
  timers.push(
    setInterval(() => {
      if (!status) return;
      status.send(`net ${settings.get().widgets.net ? 1 : 0}`);
      status.send(`slow ${settings.get().lowPower ? 1 : 0}`);
    }, 15000)
  );
  timers.push(setInterval(watchDesktop, 5000));
  timers.push(setInterval(watchGlassOverlap, 250 * k));
  timers.push(setInterval(clockwork.tick, 1000));
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

  if (we.locate()) {
    weCurrent = we.current();
    we.watchCurrent((c) => {
      weCurrent = c;
      broadcast("we:current", c);
    });
  }

  // The cover art (a big data URL) goes out only when it changes; updates in
  // between carry `thumb: undefined`, meaning "same as before".
  media = startMediaBridge((state) => {
    const sameArt = state.thumb && state.thumb === lastMedia.thumb;
    lastMedia = state;
    broadcast("media", sameArt ? { ...state, thumb: undefined } : state);
  });

  refreshWeather();
  startTimers();
  // React the instant a window maximizes, goes fullscreen or comes back,
  // instead of waiting for the next poll (coalesced to one check per tick).
  let coverQueued = false;
  stopWindowWatch = desktop.watchWindows(() => {
    if (coverQueued) return;
    coverQueued = true;
    setImmediate(() => {
      coverQueued = false;
      updateCover();
    });
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

app.on("before-quit", () => {
  timers.forEach(clearInterval);
  if (stopWindowWatch) stopWindowWatch();
  if (media) media.stop();
  if (status) status.stop();
  // Give back the top strip; a stale app bar keeps it reserved until Explorer restarts.
  desktop.insetDesktopIcons({}); // icons back to the full desktop
  topbar.destroy();
  dock.destroy();
  // Leave Windows as we found it.
  const s = settings.get();
  if (s.hideTaskbar) desktop.taskbarAutoHide(false);
  if (s.hideDesktopIcons) desktop.setDesktopIcons(true);
  if (s.dnd) applyDnd(false);
  // In Wallpaper Engine mode the desktop is WE's; leave it alone.
  if (glassWin && !glassWin.isDestroyed() && widgetsWin && !widgetsWin.isDestroyed()) desktop.pinToDesktop(widgetsWin);
  if (wallpaperWin && !wallpaperWin.isDestroyed()) {
    wallpaperWin.destroy();
    desktop.refreshSystemWallpaper();
  }
});
