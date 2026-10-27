// Haze browser: websites from launcher widgets open in a frameless window
// whose toolbar is drawn in the Haze theme; the site itself is a
// WebContentsView under the toolbar. Native programs can't be re-skinned —
// Windows draws their frames — so this shell is for sites only.
//
// Toolbar modes (cycled from the toolbar, remembered in settings):
//   full — the whole toolbar; thin — a slim strip; none — just the page,
//   the toolbar slides back while the pointer rests at the top edge.
const path = require("node:path");
const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeTheme, screen, session, dialog } = require("electron");
const desktop = require("./desktop");
const poller = require("./poller");

const BAR = { full: 48, thin: 18, none: 4 };
const PAD = 6;
// Sites get their own cookie jar and cache, apart from the session the Haze
// windows (with the `cozy` bridge) load in.
const PARTITION = "persist:browserview";
// A page looping window.open() must not spawn renderer after renderer.
const MAX_SHELLS = 10;
const shells = new Map(); // toolbar webContents id → shell

// Permissions on the page session: deny by default — a desktop shell doesn't
// hand geolocation, notifications, media or clipboard access to websites.
// Fullscreen and pointer lock are enough for video players and maps.
const PAGE_PERMISSIONS = new Set(["fullscreen", "pointerLock"]);
let pageSessionWired = false;

/**
 * Session-wide policy for every site that opens here (once per run, the
 * session itself outlives the windows). Denials are logged so a site that
 * "doesn't work" can be traced. Downloads never start silently: the user
 * picks the destination, a cancelled dialog means no download at all.
 */
function wirePageSession() {
  if (pageSessionWired) return;
  pageSessionWired = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = PAGE_PERMISSIONS.has(permission);
    if (!ok) console.error(`[browser] permission denied: ${permission} (${details?.requestingUrl || wc?.getURL() || "?"})`);
    cb(ok);
  });
  // The same list for the passive checks (navigator.permissions.query and friends).
  ses.setPermissionCheckHandler((wc, permission) => PAGE_PERMISSIONS.has(permission));
  ses.on("will-download", (event, item, webContents) => {
    // The page lives in a WebContentsView; its window is the host.
    const host = webContents?.hostWebContents;
    const owner = (host && BrowserWindow.fromWebContents(host)) || BrowserWindow.fromWebContents(webContents) || undefined;
    const name = path.basename(item.getFilename() || "download");
    const dest = dialog.showSaveDialogSync(owner, { defaultPath: name });
    if (dest) item.setSavePath(dest);
    else {
      event.preventDefault();
      console.error(`[browser] download cancelled by the user: ${name}`);
    }
  });
}

function normalizeUrl(input) {
  const t = String(input || "").trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return "https://" + t;
  return "https://www.google.com/search?q=" + encodeURIComponent(t);
}

function createBrowserShell({ rendererDir, webPrefs, register, settings, applySettings }) {
  /**
   * key: the launcher entry the window was opened from (its URL), so the
   * launcher can find it again to restore, minimize or close it.
   */
  function open(url, key = "") {
    wirePageSession();
    if (shells.size >= MAX_SHELLS) {
      console.error(`[browser] ${MAX_SHELLS} windows open already; not opening ${String(url).slice(0, 120)}`);
      return null;
    }
    const win = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 520,
      minHeight: 360,
      frame: false,
      show: false,
      title: "Haze",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#241d2b" : "#f4eff8",
      webPreferences: webPrefs(),
    });
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, partition: PARTITION } });
    win.contentView.addChildView(view);
    const s = { win, view, peek: false, pageFull: false, key, mode: settings.get().browserChrome };

    // Fullscreen always hides the toolbar (it slides back at the top edge).
    const mode = () => (win.isFullScreen() ? "none" : settings.get().browserChrome);
    const layout = () => {
      if (win.isDestroyed()) return;
      const [w, h] = win.getContentSize();
      // Page fullscreen (a video's ⛶ button) and "none" give the page everything.
      const bare = s.pageFull || (mode() === "none" && !s.peek);
      const top = s.pageFull ? 0 : s.peek ? BAR.full : BAR[mode()];
      const pad = bare || win.isMaximized() || win.isFullScreen() || mode() === "thin" ? 0 : PAD;
      view.setBounds({ x: pad, y: top, width: w - pad * 2, height: h - top - pad });
      if (view.setBorderRadius) view.setBorderRadius(pad ? 14 : 0);
    };
    s.layout = layout;
    win.on("resize", layout);
    layout();

    const wc = view.webContents;
    const send = () => {
      if (win.isDestroyed()) return;
      const nav = wc.navigationHistory;
      win.webContents.send("browser:state", {
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        canBack: nav.canGoBack(),
        canForward: nav.canGoForward(),
        maximized: win.isMaximized() || win.isFullScreen(),
        mode: mode(),
        peek: s.peek,
      });
      win.setTitle(wc.getTitle() || "Haze");
    };
    s.send = send;
    for (const ev of ["did-navigate", "did-navigate-in-page", "page-title-updated", "did-start-loading", "did-stop-loading"]) {
      wc.on(ev, send);
    }
    win.on("maximize", () => (layout(), send()));
    win.on("unmaximize", () => (layout(), send()));
    // A page going fullscreen takes the whole screen, not just its box.
    wc.on("enter-html-full-screen", () => {
      s.pageFull = true;
      win.setFullScreen(true);
      layout();
    });
    wc.on("leave-html-full-screen", () => {
      s.pageFull = false;
      win.setFullScreen(false);
      layout();
    });
    // Links that want a new window open in a new Haze shell.
    wc.setWindowOpenHandler(({ url: next }) => {
      if (/^https?:\/\//i.test(next)) open(next);
      return { action: "deny" };
    });

    win.loadFile(path.join(rendererDir, "browser", "index.html"));
    win.once("ready-to-show", () => {
      desktop.roundCorners(win);
      win.show();
      send();
    });
    const id = win.webContents.id;
    shells.set(id, s);
    register(win);
    win.on("closed", () => {
      shells.delete(id);
      // The page view outlives its window otherwise — and keeps playing.
      if (!wc.isDestroyed()) wc.close();
    });
    wc.loadURL(normalizeUrl(url));
    return s;
  }

  /**
   * The toolbar mode changed (from any shell or the settings window): every
   * open shell drops a leftover peek and lays itself out for the new mode.
   */
  function sync() {
    const mode = settings.get().browserChrome;
    for (const s of shells.values()) {
      if (s.win.isDestroyed()) continue;
      if (s.mode !== mode) {
        s.mode = mode;
        s.peek = false;
      }
      s.layout();
      s.send();
    }
  }

  ipcMain.on("browser:cmd", (e, cmd, arg) => {
    const s = shells.get(e.sender.id);
    if (!s) return;
    const wc = s.view.webContents;
    const nav = wc.navigationHistory;
    switch (cmd) {
      case "back":
        if (nav.canGoBack()) nav.goBack();
        break;
      case "forward":
        if (nav.canGoForward()) nav.goForward();
        break;
      case "reload":
        wc.isLoading() ? wc.stop() : wc.reload();
        break;
      case "go":
        wc.loadURL(normalizeUrl(arg));
        break;
      case "external":
        if (/^https?:\/\//i.test(wc.getURL())) shell.openExternal(wc.getURL());
        break;
      case "mode": {
        const order = ["full", "thin", "none"];
        const next = order[(order.indexOf(settings.get().browserChrome) + 1) % order.length];
        applySettings({ browserChrome: next }); // → sync() for every shell
        break;
      }
      case "peek":
        // "none" mode: the pointer reached the top edge, or left the toolbar.
        s.peek = Boolean(arg) && settings.get().browserChrome === "none";
        s.layout();
        s.send();
        break;
      case "min":
        s.win.minimize();
        break;
      case "max":
        // "Full screen" means the whole screen: over the Haze bar too.
        s.peek = false;
        s.win.setFullScreen(!s.win.isFullScreen());
        setTimeout(() => (s.layout(), s.send()), 60);
        break;
      case "close":
        s.win.close();
        break;
    }
  });
  ipcMain.handle("browser:state", (e) => {
    const s = shells.get(e.sender.id);
    if (s) setTimeout(s.send);
    return null;
  });

  /**
   * "No toolbar" mode: watch the pointer ourselves. Page events can't see
   * the top few px (the window's resize border takes them), so the bar
   * comes back when the pointer is within 12 px of the window's top and
   * hides again once it moves 70 px below.
   */
  poller.every("browser peek", 120, () => {
    // Nothing to watch without shells (and `screen` needs the app ready).
    if (!shells.size || !app.isReady() || settings.get().browserChrome !== "none") return;
    const p = screen.getCursorScreenPoint();
    for (const s of shells.values()) {
      if (s.win.isDestroyed() || !s.win.isVisible() || s.win.isMinimized() || s.pageFull) continue;
      const b = s.win.getBounds();
      const inX = p.x >= b.x && p.x < b.x + b.width;
      const y = p.y - b.y;
      const want = s.peek ? inX && y >= -2 && y < 70 : inX && y >= -2 && y < 12;
      if (want !== s.peek) {
        s.peek = want;
        s.layout();
        s.send();
      }
    }
  });

  const byKey = (key) => [...shells.values()].filter((s) => s.key === key && !s.win.isDestroyed());

  return {
    open,
    sync,
    /** Launcher click: open, bring forward, or minimize if already in front. */
    toggle(url, key) {
      const [s] = byKey(key);
      if (!s) return open(url, key);
      const w = s.win;
      if (w.isMinimized() || !w.isVisible()) {
        w.restore();
        w.show();
        w.focus();
      } else if (w.isFocused()) w.minimize();
      else w.focus();
    },
    /** Close every window opened from this launcher entry (page and all). */
    close(key) {
      for (const s of byKey(key)) s.win.close();
    },
    /** { key: "open" | "min" } for launcher entries with a window. */
    states() {
      const out = {};
      for (const s of shells.values()) {
        if (!s.key || s.win.isDestroyed()) continue;
        out[s.key] = s.win.isMinimized() ? "min" : out[s.key] || "open";
      }
      return out;
    },
    /** Shell windows count as ordinary apps for the fullscreen check. */
    windows: () => [...shells.values()].map((s) => s.win).filter((w) => !w.isDestroyed()),
  };
}

module.exports = { createBrowserShell };
