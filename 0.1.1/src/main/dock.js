// Dock: pinned and running apps along a screen edge (bottom by default; top,
// left or right like the info bar). The window spans that edge, stays on top
// and ignores the mouse except over the dock itself. In autohide mode it
// slides out when the pointer touches the edge next to the dock.
const path = require("node:path");
const { execFile } = require("node:child_process");
const { BrowserWindow, screen, shell, Menu } = require("electron");
const desktop = require("./desktop");
const { iconFor, linkTarget } = require("./appicons");

const WIN_HEIGHT = 124; // DIP: room for magnified icons and the tooltip
const WIN_WIDTH = 210; // DIP, side docks: icons plus a tooltip beside them
const EDGE = 12; // px from the dock's screen edge that reveal it
const HIDE_DELAY = 450;
// The dock comes out when the pointer rests (REVEAL_DELAY ms) anywhere from
// the screen edge up to a little below where the icons' top edge would be,
// so just passing over the bottom of the screen doesn't pop it up.
const REVEAL_DELAY = 60; // ~one poll tick
const REVEAL_INSET = 18; // px below the pill's far side: its 7 px padding + ~11 px into the icons
const KNOWN = {
  explorer: "Проводник",
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  browser: "Яндекс Браузер",
  telegram: "Telegram",
  discord: "Discord",
  spotify: "Spotify",
  steamwebhelper: "Steam",
  code: "VS Code",
  claude: "Claude",
  windowsterminal: "Терминал",
  obs64: "OBS",
};

function prettyName(file) {
  const base = path.basename(file).replace(/\.(exe|lnk)$/i, "");
  return KNOWN[base.toLowerCase()] || base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * area(): the screen area the dock may use (work area minus an overlaying
 * info bar), so the dock and the tray shelf sit above a bottom bar.
 */
function createDock({ rendererDir, webPrefs, logConsole, settings, applySettings, ownHwnds, area }) {
  let win = null;
  let opts = null;
  let shown = false;
  let covered = false;
  let menuOpen = false;
  let rect = null; // the dock pill inside the window, DIP
  let hideTimer = null;
  let revealSince = 0; // when the pointer entered the reveal zone
  let pollTimer = null;
  let appsTimer = null;
  let items = [];
  let tray = []; // running tray apps for the shelf: [{ exe, name, icon }]
  let trayTimer = null;
  let lastJson = "";
  const firstSeen = new Map();

  // ── Apps ──
  async function refreshApps() {
    const d = settings.get().dock;
    const fg = desktop.foregroundWindow();
    const groups = new Map();
    for (const w of desktop.appWindows(ownHwnds())) {
      if (!w.exe) continue;
      const k = w.exe.toLowerCase();
      if (!groups.has(k)) groups.set(k, { exe: w.exe, windows: [] });
      groups.get(k).windows.push({ hwnd: w.hwnd, title: w.title, minimized: w.minimized });
    }
    const next = [];
    for (const pin of d.pinned) {
      const target = linkTarget(pin.path).toLowerCase();
      const g = target ? groups.get(target) : null;
      if (g) groups.delete(target);
      next.push({ key: pin.path, path: pin.path, name: pin.name || prettyName(pin.path), pinned: true, windows: g ? g.windows : [] });
    }
    for (const [k] of groups) if (!firstSeen.has(k)) firstSeen.set(k, firstSeen.size);
    const running = [...groups.entries()]
      .sort((a, b) => firstSeen.get(a[0]) - firstSeen.get(b[0]))
      .map(([, g]) => ({ key: g.exe, path: g.exe, name: prettyName(g.exe), pinned: false, windows: g.windows }));
    if (d.showRunning) next.push(...running);
    for (const it of next) {
      it.active = it.windows.some((w) => w.hwnd === fg);
      it.icon = await iconFor(it.path);
    }
    items = next;
    send();
  }

  function send() {
    const json = JSON.stringify([items, tray]);
    if (json !== lastJson && win && !win.isDestroyed()) {
      lastJson = json;
      win.webContents.send("dock:items", { items, tray });
    }
  }

  /** Tray apps that are running (see tray.ps1); Haze itself left out. */
  function refreshTray() {
    if (covered || (opts && !opts.shelf)) return;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "tray.ps1")],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 << 20 },
      (err, out) => {
        if (err) return;
        try {
          const own = process.execPath.toLowerCase();
          tray = [].concat(JSON.parse(out.trim() || "[]")).filter((t) => t.exe.toLowerCase() !== own);
          send();
        } catch {
          // Keep the previous list.
        }
      }
    );
  }

  /**
   * Close a tray app: politely (taskkill without /F sends its windows
   * WM_CLOSE, which most tray apps treat as "exit"), or by force.
   */
  function closeTray(exe, force) {
    if (!tray.some((t) => t.exe === exe)) return;
    const name = path.basename(exe);
    const kill = (hard, done) => execFile("taskkill", [...(hard ? ["/F"] : []), "/IM", name, "/T"], { windowsHide: true }, () => done && done());
    const running = (cb) =>
      execFile("tasklist", ["/NH", "/FO", "CSV", "/FI", `IMAGENAME eq ${name}`], { windowsHide: true }, (err, out) =>
        cb(!err && out.toLowerCase().includes(`"${name.toLowerCase()}"`))
      );
    const after = () => {
      // Drop it from the shelf right away, then re-read the real list.
      tray = tray.filter((t) => t.exe !== exe);
      lastJson = "";
      send();
      setTimeout(refreshTray, 1500);
    };
    if (force) return kill(true, after);
    // Ask nicely first; tray apps that only hide on "close" (Telegram,
    // Discord…) get ended for real after 3 s, like "Exit" in their menu.
    kill(false, () => setTimeout(() => running((still) => (still ? kill(true, after) : after())), 3000));
  }

  /** Bring a tray app forward: its window if it has one, else start it again (most then show themselves). */
  function openTray(exe) {
    const t = tray.find((x) => x.exe === exe);
    if (!t) return;
    const w = desktop.appWindows(ownHwnds()).find((x) => x.exe.toLowerCase() === exe.toLowerCase());
    if (w) desktop.activateWindow(w.hwnd);
    else shell.openPath(exe);
  }

  function activate(key) {
    const it = items.find((i) => i.key === key);
    if (!it) return;
    if (!it.windows.length) {
      shell.openPath(it.path);
      return;
    }
    const fg = desktop.foregroundWindow();
    const i = it.windows.findIndex((w) => w.hwnd === fg);
    if (i < 0) desktop.activateWindow(it.windows[0].hwnd);
    // Clicking the app in front cycles its windows, or minimizes a lone one.
    else if (it.windows.length > 1) desktop.activateWindow(it.windows[(i + 1) % it.windows.length].hwnd);
    else desktop.minimizeWindow(fg);
    setTimeout(refreshApps, 250);
  }

  function setPinned(it, pin) {
    const d = settings.get().dock;
    const pinned = pin
      ? [...d.pinned, { path: it.path, name: it.name }]
      : d.pinned.filter((p) => p.path !== it.path);
    applySettings({ dock: { ...d, pinned } });
  }

  function popupMenu(key) {
    const it = items.find((i) => i.key === key);
    if (!it || !win) return;
    const template = [
      { label: it.windows.length ? "Открыть ещё одно окно" : "Открыть", click: () => shell.openPath(it.path) },
      it.pinned
        ? { label: "Открепить от дока", click: () => setPinned(it, false) }
        : { label: "Закрепить в доке", click: () => setPinned(it, true) },
    ];
    if (it.windows.length) {
      template.push(
        { type: "separator" },
        {
          label: it.windows.length > 1 ? `Закрыть все окна (${it.windows.length})` : "Закрыть окно",
          click: () => it.windows.forEach((w) => desktop.closeWindow(w.hwnd)),
        }
      );
    }
    menuOpen = true;
    Menu.buildFromTemplate(template).popup({
      window: win,
      callback: () => {
        menuOpen = false;
      },
    });
  }

  // ── Showing & hiding ──

  function wanted() {
    if (covered) return false;
    if (opts.mode === "always") return true;
    return shown;
  }

  function apply() {
    if (!win || win.isDestroyed()) return;
    const v = wanted();
    win.webContents.send("dock:visible", { visible: v, covered });
    // Forwarding stays on even while the dock is down: the shelf needs hover.
    win.setIgnoreMouseEvents(true, { forward: true });
    clearInterval(appsTimer);
    appsTimer = null;
    if (v) {
      refreshApps();
      appsTimer = setInterval(refreshApps, 1000);
    }
  }

  const edge = () => opts?.position || "bottom";
  const vertical = () => ["left", "right"].includes(edge());

  function pillOnScreen() {
    const b = win.getBounds();
    const r =
      rect ||
      (vertical()
        ? { x: edge() === "left" ? 8 : b.width - 78, y: b.height / 2 - 200, width: 70, height: 400 }
        : { x: b.width / 2 - 200, y: edge() === "top" ? 8 : b.height - 80, width: 400, height: 70 });
    return { x: b.x + r.x, y: b.y + r.y, width: r.width, height: r.height };
  }

  /**
   * The pointer in dock terms: `along` runs parallel to the edge, `depth` is
   * the distance from the edge inwards. Same for the pill (its near and far
   * sides), so one set of rules serves all four edges.
   */
  function measure(p, pill, a) {
    const e = edge();
    if (e === "bottom") return { along: p.x, from: pill.x, to: pill.x + pill.width, depth: a.y + a.height - p.y, far: a.y + a.height - pill.y };
    if (e === "top") return { along: p.x, from: pill.x, to: pill.x + pill.width, depth: p.y - a.y, far: pill.y + pill.height - a.y };
    if (e === "left") return { along: p.y, from: pill.y, to: pill.y + pill.height, depth: p.x - a.x, far: pill.x + pill.width - a.x };
    return { along: p.y, from: pill.y, to: pill.y + pill.height, depth: a.x + a.width - p.x, far: a.x + a.width - pill.x };
  }

  function poll() {
    if (!win || win.isDestroyed() || covered || opts.mode === "always") return;
    const m = measure(screen.getCursorScreenPoint(), pillOnScreen(), area());
    const inRange = (pad) => m.along >= m.from - pad && m.along <= m.to + pad;
    if (!shown) {
      // Reveal where the icons would be (a bit inside their far side) or right at the edge.
      const zone = m.depth >= 0 && m.depth <= Math.max(EDGE, m.far - REVEAL_INSET);
      if (!inRange(40) || !zone) {
        revealSince = 0;
        return;
      }
      const now = Date.now();
      if (!revealSince) revealSince = now;
      if (now - revealSince >= REVEAL_DELAY) {
        revealSince = 0;
        shown = true;
        apply();
      }
      return;
    }
    // Keep it out while the pointer is on the dock or between it and the edge.
    const keep = menuOpen || (inRange(24) && m.depth <= m.far + 40);
    if (keep) {
      clearTimeout(hideTimer);
      hideTimer = null;
    } else if (!hideTimer) {
      hideTimer = setTimeout(() => {
        hideTimer = null;
        shown = false;
        apply();
      }, HIDE_DELAY);
    }
  }

  function place() {
    if (!win || win.isDestroyed()) return;
    const wa = area();
    const e = edge();
    if (e === "top") win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: WIN_HEIGHT });
    else if (e === "left") win.setBounds({ x: wa.x, y: wa.y, width: WIN_WIDTH, height: wa.height });
    else if (e === "right") win.setBounds({ x: wa.x + wa.width - WIN_WIDTH, y: wa.y, width: WIN_WIDTH, height: wa.height });
    else win.setBounds({ x: wa.x, y: wa.y + wa.height - WIN_HEIGHT, width: wa.width, height: WIN_HEIGHT });
  }

  function create() {
    win = new BrowserWindow({
      width: 800,
      height: WIN_HEIGHT,
      frame: false,
      transparent: true,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      thickFrame: false,
      backgroundColor: "#00000000",
      webPreferences: webPrefs(),
    });
    win.setIgnoreMouseEvents(true);
    // A non-resizable window keeps its first size as the maximum; the dock
    // changes shape when it moves between a horizontal and a side edge.
    win.setMaximumSize(100000, 100000);
    logConsole("dock", win);
    place();
    win.loadFile(path.join(rendererDir, "dock", "index.html"));
    win.once("ready-to-show", () => {
      win.showInactive();
      apply();
    });
    pollTimer = setInterval(poll, settings.get().lowPower ? 200 : 100);
    refreshTray();
    trayTimer = setInterval(refreshTray, 30000);
  }

  function destroy() {
    clearInterval(pollTimer);
    clearInterval(appsTimer);
    clearInterval(trayTimer);
    pollTimer = appsTimer = trayTimer = null;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    lastJson = "";
  }

  return {
    window: () => (win && !win.isDestroyed() ? win : null),
    sync(next) {
      const moved = opts && opts.position !== next.position;
      opts = next;
      if (!next.enabled) return destroy();
      if (!win || win.isDestroyed()) return create();
      if (moved) {
        rect = null; // the renderer reports the new layout's box
        shown = false;
        place();
      }
      lastJson = "";
      apply();
    },
    place,
    setCovered(c) {
      if (c === covered) return;
      covered = c;
      apply();
    },
    items: () => ({ items, tray }),
    openTray,
    closeTray,
    activate,
    popupMenu,
    setRect(r) {
      // The first report means the renderer is listening: send it the state.
      const first = !rect;
      rect = r;
      if (first) apply();
    },
    setHit(hit) {
      if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!hit, { forward: true });
    },
    destroy,
  };
}

module.exports = { createDock };
