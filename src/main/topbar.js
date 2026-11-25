// Control bar. Registered as a Windows app bar (like the taskbar) on any
// screen edge, so maximized windows stop next to it instead of covering it.
// Only the bar's islands take the mouse; the gaps between them click through.
const path = require("node:path");
const { BrowserWindow, screen } = require("electron");
const desktop = require("./desktop");

const THICKNESS = { top: 34, bottom: 34, left: 54, right: 54 }; // DIP
const CALLBACK_MSG = 0x0400 + 0x43; // WM_USER + n, private to this window
const ABN_POSCHANGED = 1;

const word = (buf) => (buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0));

function stripOf(area, edge, size) {
  if (edge === "top") return { x: area.x, y: area.y, width: area.width, height: size };
  if (edge === "bottom") return { x: area.x, y: area.y + area.height - size, width: area.width, height: size };
  if (edge === "left") return { x: area.x, y: area.y, width: size, height: area.height };
  return { x: area.x + area.width - size, y: area.y, width: size, height: area.height };
}

function createTopbar({ rendererDir, webPrefs, logConsole }) {
  let win = null;
  let registered = false;
  let opts = { reserve: true, position: "top" };
  let covered = false;
  let placedFor = "";
  let hideTimer = null;
  let hard = false;
  let wanted = null; // physical rect the bar should occupy
  let settleTimer = null;
  let ready = false; // shown once: only then may it claim a slot

  /**
   * Claim our strip. Claiming changes the work area, which fires a display
   * change that lands back here — so unforced calls skip an unchanged display.
   */
  function place(force = false) {
    if (!win || win.isDestroyed()) return;
    const d = screen.getPrimaryDisplay();
    const edge = opts.position;
    const key = JSON.stringify([d.bounds, d.scaleFactor, registered, edge]);
    if (!force && key === placedFor) return;
    const size = THICKNESS[edge];
    wanted = registered
      ? desktop.appBarSetPos(win, screen.dipToScreenRect(null, d.bounds), Math.round(size * d.scaleFactor), edge)
      : // Not reserving: right at the screen edge. (Just after unregistering,
        // the work area can still include our old strip.)
        screen.dipToScreenRect(null, stripOf(d.bounds, edge, size));
    // Straight to Win32: Electron pads small frameless windows by a few px,
    // which would overlap the top of maximized windows.
    // Only a placement that took counts as done; otherwise the next call retries.
    placedFor = desktop.setWindowRect(win, wanted) ? key : "";
  }

  /**
   * Explorer sometimes notifies us mid-change (taskbar toggling auto-hide),
   * and a slot claimed then can end up offset. Claim again once it settles.
   */
  function placeSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      place(true);
    }, 400);
  }

  /**
   * Put the bar back if something moved it: Chromium pushes windows into
   * the work area whenever it changes, and the bar lives outside it.
   * (Size isn't compared: Windows keeps tiny windows a few px larger; the
   * page pins its content to the edge and the rest clicks through.)
   */
  function check() {
    if (!win || win.isDestroyed() || !ready || covered) return;
    if (opts.reserve && !registered) return setReserve(true);
    if (!wanted || !placedFor) return place(true);
    const r = desktop.windowRect(win);
    if (r && (r.x !== wanted.x || r.y !== wanted.y)) place(true);
  }

  function setReserve(on) {
    if (!win || win.isDestroyed()) return;
    if (on && !registered) {
      // Explorer can refuse (mid-restart); then the bar overlays for now and
      // the next check() tries to register again.
      registered = desktop.appBarRegister(win, CALLBACK_MSG);
      if (!registered) console.error("[topbar] app bar registration refused; retrying later");
    } else if (!on && registered) {
      desktop.appBarRemove(win);
      registered = false;
    }
    place(true);
  }

  function create() {
    win = new BrowserWindow({
      ...stripOf(screen.getPrimaryDisplay().workArea, opts.position, THICKNESS[opts.position]),
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
    win.setIgnoreMouseEvents(true, { forward: true });
    logConsole("topbar", win);
    win.loadFile(path.join(rendererDir, "topbar", "index.html"));
    win.hookWindowMessage(CALLBACK_MSG, (wParam) => {
      // Taskbar moved or resized: ask for our slot again.
      if (word(wParam) === ABN_POSCHANGED) {
        place(true);
        placeSoon();
      }
    });
    win.hookWindowMessage(desktop.taskbarCreatedMessage(), () => {
      // Explorer restarted and forgot every app bar.
      registered = false;
      setReserve(opts.reserve);
    });
    win.on("move", () => setTimeout(check, 30));
    win.once("ready-to-show", () => {
      desktop.stripFrame(win);
      // Chromium also enforces a minimum window size of its own, and a
      // non-resizable window keeps its first size as the maximum, which
      // would leave a side bar's narrow window when it moves to the top.
      win.setMinimumSize(1, 1);
      win.setMaximumSize(100000, 100000);
      ready = true;
      setReserve(opts.reserve);
      if (!covered) win.showInactive();
    });
  }

  function destroy() {
    // Pending timers would reach for the window after it's gone.
    clearTimeout(hideTimer);
    clearTimeout(settleTimer);
    hideTimer = settleTimer = null;
    if (!win || win.isDestroyed()) return;
    ready = false;
    try {
      if (registered) desktop.appBarRemove(win);
    } finally {
      registered = false;
      placedFor = "";
      win.destroy();
      win = null;
    }
  }

  return {
    window: () => (win && !win.isDestroyed() ? win : null),
    /** Create, update or remove the bar to match settings.topbar. */
    sync(next) {
      const prev = opts;
      opts = { reserve: next.reserve, position: next.position || "top" };
      if (!next.enabled) return destroy();
      if (!win || win.isDestroyed()) return create();
      if (prev.position !== opts.position && registered) {
        // Explorer keeps an app bar's edge from registration; start over.
        desktop.appBarRemove(win);
        registered = false;
      }
      setReserve(opts.reserve);
    },
    place: () => place(),
    /** The strip desktop icons must avoid when the bar overlays the desktop: { edge, size } (DIP) or null. */
    overlay: () => (win && !win.isDestroyed() && !registered ? { edge: opts.position, size: THICKNESS[opts.position] } : null),
    check,
    /** Hide while a fullscreen app (game, video) owns the screen. */
    /**
     * Slide away / back. Hiding: the page animates out, then the window
     * hides. Showing: the window appears still slid out (that's how it was
     * left), then the page animates in.
     */
    setCovered(c) {
      if (c === covered) return;
      covered = c;
      if (!win || win.isDestroyed()) return;
      clearTimeout(hideTimer);
      win.webContents.send("bar:covered", c);
      // The window itself stays (slid out, click-through) so it's back
      // instantly; only a game gets it hidden.
      if (c && hard) {
        hideTimer = setTimeout(() => {
          hideTimer = null;
          const w = win;
          if (covered && w && !w.isDestroyed()) w.hide();
        }, 180);
      }
      else if (!c && !win.isVisible()) {
        win.showInactive();
        check();
      }
    },
    /** A game is running: hide the window completely while covered. */
    setHard(h) {
      hard = h;
      if (win && !win.isDestroyed() && covered && h) win.hide();
    },
    setHit(hit) {
      if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!hit, { forward: true });
    },
    destroy,
  };
}

module.exports = { createTopbar };
