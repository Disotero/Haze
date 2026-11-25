// The wallpaper layer inside Explorer's desktop (WorkerW / Progman) and the
// desktop icon view.
const koffi = require("koffi");
const { EnumWindows, EnumWindowsProc, FindWindowExW, FindWindowW, GWL_EXSTYLE, GWL_STYLE, GetClientRect, GetParent, GetWindowLongPtrW, GetWindowRect, IsWindow, SMTO_NORMAL, SPIF_SENDCHANGE, SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow, SystemParametersInfoW, WS_CHILD, WS_EX_LAYERED, WS_POPUP, hwndOf } = require("./win32");

/**
 * Locate the window that hosts the wallpaper layer. Asking Progman with
 * message 0x052C makes Explorer spawn a WorkerW behind the desktop icons.
 * On Windows 11 24H2+ ("raised desktop") that WorkerW is a child of Progman;
 * on older builds it is a top-level window right after the one holding
 * SHELLDLL_DefView.
 */
function findWallpaperHost() {
  const progman = FindWindowW("Progman", null);
  if (!progman) return null;
  const out = [0];
  SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, SMTO_NORMAL, 1000, out);
  SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, out);

  const childWorker = FindWindowExW(progman, 0, "WorkerW", null);
  if (childWorker) {
    const defView = FindWindowExW(progman, 0, "SHELLDLL_DefView", null);
    return { raised: true, progman, workerw: childWorker, defView };
  }

  let workerw = 0;
  const cb = koffi.register((hwnd) => {
    if (FindWindowExW(hwnd, 0, "SHELLDLL_DefView", null)) {
      workerw = FindWindowExW(0, hwnd, "WorkerW", null);
    }
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  return workerw ? { raised: false, progman, workerw } : null;
}

function makeChild(hwnd) {
  const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
  SetWindowLongPtrW(hwnd, GWL_STYLE, (style & ~WS_POPUP) | WS_CHILD);
}

/**
 * Embed `win` into the wallpaper layer, covering `bounds` (screen coords).
 * Returns the host description, or null if Explorer's desktop wasn't found.
 */
function attachToWallpaper(win, bounds, virtualOrigin) {
  const host = findWallpaperHost();
  if (!host) return null;
  const hwnd = hwndOf(win);
  makeChild(hwnd);
  const x = bounds.x - virtualOrigin.x;
  const y = bounds.y - virtualOrigin.y;

  if (host.raised) {
    // 24H2+: sit inside Progman, below the icon view and above the WorkerW
    // that paints the static wallpaper.
    const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
    // SetParent returns the old parent, 0 on failure (Explorer mid-restart).
    SetParent(hwnd, host.progman);
    if (GetParent(hwnd) !== host.progman) return null;
    SetWindowPos(hwnd, host.defView || 0, x, y, bounds.width, bounds.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetWindowPos(host.workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    host.parent = host.progman;
  } else {
    SetParent(hwnd, host.workerw);
    if (GetParent(hwnd) !== host.workerw) return null;
    SetWindowPos(hwnd, 0, x, y, bounds.width, bounds.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    host.parent = host.workerw;
  }
  ShowWindow(hwnd, 5);
  return host;
}

/** True while `win` is still embedded in a live desktop (Explorer may restart). */
function isStillAttached(win, host) {
  if (!host) return false;
  return IsWindow(host.parent) && GetParent(hwndOf(win)) === host.parent;
}

/** Repaint the stock wallpaper so nothing stale is left after we detach. */
function refreshSystemWallpaper() {
  const buf = new Uint16Array(260);
  if (!SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.length, buf, 0)) return;
  SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, buf, SPIF_SENDCHANGE);
}

// ── Desktop icons ──────────────────────────────────────────────────────────

/** Explorer's desktop icon list (SysListView32 "FolderView"). */
function desktopIconList() {
  const progman = FindWindowW("Progman", null);
  let defView = progman ? FindWindowExW(progman, 0, "SHELLDLL_DefView", null) : 0;
  if (!defView) {
    // Older builds move the icon view into a WorkerW once a wallpaper is attached.
    const cb = koffi.register((hwnd) => {
      const v = FindWindowExW(hwnd, 0, "SHELLDLL_DefView", null);
      if (v) defView = v;
      return !v;
    }, koffi.pointer(EnumWindowsProc));
    try {
      EnumWindows(cb, 0);
    } finally {
      koffi.unregister(cb);
    }
  }
  return defView ? FindWindowExW(defView, 0, "SysListView32", null) : 0;
}

/**
 * Keep desktop icons clear of a bar that doesn't reserve space: shrink the
 * icon list inside the desktop by `inset` px per side ({ top, left, right,
 * bottom }, physical). All zeros puts it back. Windows are unaffected.
 */
function insetDesktopIcons(inset = {}) {
  const list = desktopIconList();
  if (!list) return false;
  const parent = GetParent(list);
  const r = {};
  if (!parent || !GetClientRect(parent, r)) return false;
  const { top = 0, left = 0, right = 0, bottom = 0 } = inset;
  const want = { x: left, y: top, w: r.right - left - right, h: r.bottom - top - bottom };
  // Only move it when it's off: every move makes Explorer re-lay out the icons.
  const cur = {};
  const pr = {};
  GetWindowRect(list, cur);
  GetWindowRect(parent, pr);
  const same =
    cur.left - pr.left === want.x && cur.top - pr.top === want.y && cur.right - cur.left === want.w && cur.bottom - cur.top === want.h;
  if (!same) SetWindowPos(list, 0, want.x, want.y, want.w, want.h, SWP_NOZORDER | SWP_NOACTIVATE);
  return true;
}

/** Hide or show the desktop icons. Nothing is deleted; Explorer restarts show them again. */
function setDesktopIcons(visible) {
  const list = desktopIconList();
  if (list) ShowWindow(list, visible ? 5 : 0);
  return Boolean(list);
}

module.exports = { attachToWallpaper, desktopIconList, findWallpaperHost, insetDesktopIcons, isStillAttached, makeChild, refreshSystemWallpaper, setDesktopIcons };
