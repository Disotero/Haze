// Top-level windows: z-order and owners of the Haze layers, the app list for
// the dock, the foreground window, focus, shapes and window-event hooks.
const koffi = require("koffi");
const { AttachThreadInput, CombineRgn, CreateRectRgn, CreateRoundRectRgn, DWMWA_CLOAKED, DeleteObject, DwmGetWindowAttribute, DwmSetWindowAttribute, EnumWindows, EnumWindowsProc, FindWindowExW, FindWindowW, GWLP_HWNDPARENT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, GetCurrentThreadId, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, HWND_BOTTOM, IsIconic, IsWindowVisible, IsZoomed, PostMessageW, SHELL_CLASSES, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MINIMIZE, SW_RESTORE, SetFocus, SetForegroundWindow, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, SetWindowRgn, ShowWindowAsync, SwitchToThisWindow, WM_CLOSE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, className, hwndOf, isCloaked, processPath, user32, windowPid, windowText } = require("./win32");

/**
 * Pin `win` to the desktop: owned by Progman so it survives Win+D, and pushed
 * to the bottom of the z-order so ordinary windows stay above it.
 */
function pinToDesktop(win) {
  const progman = FindWindowW("Progman", null);
  const hwnd = hwndOf(win);
  if (progman) SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, progman);
  SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

const GW_HWNDNEXT = 2;

/** The window `win` is owned by (0 = none). */
function ownerOf(win) {
  return Number(GetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT));
}

/** The desktop shell window pinToDesktop() makes our layers owned by. */
function desktopOwner() {
  return Number(FindWindowW("Progman", null));
}

/**
 * Does any visible app window sit below `win` in the z-order? Then it is no
 * longer at the bottom and needs pinning again. (Re-pinning without need
 * makes layered windows repaint: visible flicker on every check.)
 */
function hasAppWindowBelow(win, ownHwnds) {
  let w = GetWindow(hwndOf(win), GW_HWNDNEXT);
  for (let i = 0; w && i < 2000; i++, w = GetWindow(w, GW_HWNDNEXT)) {
    if (!IsWindowVisible(w) || ownHwnds.has(w)) continue;
    if (SHELL_CLASSES.has(className(w)) || isCloaked(w)) continue;
    const ex = Number(GetWindowLongPtrW(w, GWL_EXSTYLE));
    if (ex & WS_EX_TOOLWINDOW && !(ex & WS_EX_APPWINDOW)) continue;
    const r = {};
    if (GetWindowRect(w, r) && r.right - r.left > 0 && r.bottom - r.top > 0) return true;
  }
  return false;
}

const SHELL_HOSTS =
  /\\(StartMenuExperienceHost|SearchHost|SearchApp|ShellExperienceHost|ShellHost|TextInputHost|LockApp)\.exe$/i;

/**
 * Rect of the foreground window if it hides the desktop (maximized or
 * fullscreen), else null. Our own windows and shell windows are ignored.
 */
function coveringForegroundRect(ownHwnds) {
  const fg = GetForegroundWindow();
  if (!fg || ownHwnds.has(fg) || !IsWindowVisible(fg)) return null;
  if (SHELL_CLASSES.has(className(fg))) return null;
  const cloaked = [0];
  if (DwmGetWindowAttribute(fg, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return null;
  const r = {};
  if (!GetWindowRect(fg, r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, zoomed: IsZoomed(fg) };
}

/**
 * Windows that would get a taskbar button on the current virtual desktop,
 * front to back: [{ hwnd, title, exe, minimized }].
 */
function appWindows(ownHwnds, { exe = true } = {}) {
  const found = [];
  const cb = koffi.register((hwnd) => {
    if (!IsWindowVisible(hwnd) || ownHwnds.has(hwnd) || GetWindow(hwnd, GW_OWNER)) return true;
    const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    if (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) && !(ex & WS_EX_APPWINDOW)) return true;
    // Cloaked: suspended UWP frames and windows on other virtual desktops.
    if (isCloaked(hwnd) || SHELL_CLASSES.has(className(hwnd))) return true;
    const title = windowText(hwnd);
    if (title) found.push({ hwnd, title });
    return true;
  }, koffi.pointer(EnumWindowsProc));
  try {
    EnumWindows(cb, 0);
  } finally {
    koffi.unregister(cb);
  }
  for (const w of found) {
    w.minimized = IsIconic(w.hwnd);
    const r = {};
    // A window that died mid-enumeration has no rect: an empty one, not NaN.
    w.rect = GetWindowRect(w.hwnd, r)
      ? { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
      : { x: 0, y: 0, width: 0, height: 0 };
    // Callers that only need positions skip the (slower) process lookup.
    if (!exe) continue;
    let pid = windowPid(w.hwnd);
    // Store apps run inside an ApplicationFrameHost frame; the app's own
    // process owns the CoreWindow child.
    if (className(w.hwnd) === "ApplicationFrameWindow") {
      const core = FindWindowExW(w.hwnd, 0, "Windows.UI.Core.CoreWindow", null);
      if (core) pid = windowPid(core);
    }
    w.exe = processPath(pid);
  }
  // Start, Search and other shell flyouts show up as titled windows while open.
  return exe ? found.filter((w) => !SHELL_HOSTS.test(w.exe)) : found;
}

function foregroundWindow() {
  return Number(GetForegroundWindow());
}

/** Full path of the foreground window's program ("" if unknown). */
function foregroundExe() {
  const fg = GetForegroundWindow();
  return fg ? processPath(windowPid(fg)) : "";
}

/** { hwnd, exe } of the foreground window in one go. */
function foreground() {
  const hwnd = Number(GetForegroundWindow());
  return { hwnd, exe: hwnd ? processPath(windowPid(hwnd)) : "" };
}

const AllowSetForegroundWindow = user32.func("bool __stdcall AllowSetForegroundWindow(uint32 pid)");

/** While we're in front: let whatever we launch next come forward. */
function allowAnyForeground() {
  AllowSetForegroundWindow(0xffffffff); // ASFW_ANY
}

function activateWindow(hwnd) {
  if (IsIconic(hwnd)) ShowWindowAsync(hwnd, SW_RESTORE);
  SwitchToThisWindow(hwnd, true);
}

function minimizeWindow(hwnd) {
  ShowWindowAsync(hwnd, SW_MINIMIZE);
}

function closeWindow(hwnd) {
  PostMessageW(hwnd, WM_CLOSE, 0, 0);
}

/**
 * Hide `win` from screen capture (Windows 10 2004+). The widgets need this
 * to blur a live capture of the desktop without seeing themselves in it.
 */
function setCaptureExcluded(win, on) {
  const WDA_NONE = 0;
  const WDA_EXCLUDEFROMCAPTURE = 0x11;
  return SetWindowDisplayAffinity(hwndOf(win), on ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE);
}

/**
 * Drop the caption/frame styles Electron keeps on frameless windows: with a
 * caption, Windows won't let a window be shorter than ~39 px (SM_CYMIN).
 */
function stripFrame(win) {
  const WS_CAPTION = 0x00c00000;
  const WS_THICKFRAME = 0x00040000;
  const hwnd = hwndOf(win);
  const style = Number(GetWindowLongPtrW(hwnd, GWL_STYLE));
  SetWindowLongPtrW(hwnd, GWL_STYLE, style & ~(WS_CAPTION | WS_THICKFRAME));
}

/**
 * Give `win` keyboard focus even though another app is in front: Windows
 * refuses SetForegroundWindow to background processes, unless our thread
 * shares input with the current foreground thread for that moment.
 */
function takeFocus(win) {
  const hwnd = hwndOf(win);
  const fg = GetForegroundWindow();
  const fgThread = fg ? GetWindowThreadProcessId(fg, [0]) : 0;
  const ours = GetCurrentThreadId();
  const attach = fgThread && fgThread !== ours;
  if (attach) AttachThreadInput(ours, fgThread, true);
  SetForegroundWindow(hwnd);
  SetFocus(hwnd);
  if (attach) AttachThreadInput(ours, fgThread, false);
}

/** Bottom of the z-order (an owned window lands just above its owner). */
function sendToBottom(win) {
  SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

/** Make `owner` own `win`: Windows then always keeps `win` above it. */
function setOwner(win, owner) {
  SetWindowLongPtrW(hwndOf(win), GWLP_HWNDPARENT, hwndOf(owner));
}

/** Exact window rect in physical pixels (Electron pads tiny frameless windows). True if it took. */
function setWindowRect(win, r) {
  const SWP_FRAMECHANGED = 0x20;
  return Boolean(SetWindowPos(hwndOf(win), 0, r.x, r.y, r.width, r.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED));
}

/** Window rect in physical pixels, or null if Windows can't tell. */
function windowRect(win) {
  const r = {};
  if (!GetWindowRect(hwndOf(win), r)) return null;
  return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
}

/**
 * Clip `win` to rounded rectangles [{ x, y, w, h, r }] (window pixels).
 * An opaque window shaped this way is drawn by the GPU directly — far
 * cheaper than a transparent (layered) window repainted every frame.
 */
function setWindowShape(win, rects) {
  const RGN_OR = 2;
  const rgn = CreateRectRgn(0, 0, 0, 0);
  for (const q of rects) {
    const part = CreateRoundRectRgn(q.x, q.y, q.x + q.w + 1, q.y + q.h + 1, q.r * 2, q.r * 2);
    CombineRgn(rgn, rgn, part, RGN_OR);
    DeleteObject(part);
  }
  // The window owns the region from here on (don't delete it) — unless it refused it.
  if (!SetWindowRgn(hwndOf(win), rgn, true)) DeleteObject(rgn);
}

const WinEventProc = koffi.proto(
  "void __stdcall WinEventProc(intptr hook, uint32 event, intptr hwnd, long idObject, long idChild, uint32 thread, uint32 time)"
);

const SetWinEventHook = user32.func(
  "intptr __stdcall SetWinEventHook(uint32 min, uint32 max, intptr mod, WinEventProc *cb, uint32 pid, uint32 tid, uint32 flags)"
);

const UnhookWinEvent = user32.func("bool __stdcall UnhookWinEvent(intptr hook)");

/**
 * Call `onChange` the moment any top-level window is activated, moved,
 * resized, maximized or minimized (WinEvent hooks, delivered on this
 * thread's message loop). Returns stop().
 */
function watchWindows(onChange) {
  const EVENT_SYSTEM_FOREGROUND = 0x0003;
  const EVENT_SYSTEM_MINIMIZEEND = 0x0017;
  const EVENT_OBJECT_LOCATIONCHANGE = 0x800b;
  const WINEVENT_OUTOFCONTEXT = 0;
  const WINEVENT_SKIPOWNPROCESS = 2;
  const cb = koffi.register((_h, event, hwnd, idObject, idChild) => {
    // Location changes come for carets and cursors too; only whole windows count.
    if (event === EVENT_OBJECT_LOCATIONCHANGE && (idObject !== 0 || idChild !== 0 || !hwnd)) return;
    onChange(event);
  }, koffi.pointer(WinEventProc));
  const flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
  const hooks = [
    SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, 0, cb, 0, 0, flags),
    SetWinEventHook(0x0016, EVENT_SYSTEM_MINIMIZEEND, 0, cb, 0, 0, flags), // MINIMIZESTART..END
    SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, 0, cb, 0, 0, flags),
  ];
  return () => {
    hooks.forEach((h) => h && UnhookWinEvent(h));
    koffi.unregister(cb);
  };
}

/** Windows 11 rounded corners for a frameless window. */
function roundCorners(win) {
  const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
  const DWMWCP_ROUND = 2;
  DwmSetWindowAttribute(hwndOf(win), DWMWA_WINDOW_CORNER_PREFERENCE, [DWMWCP_ROUND], 4);
}

module.exports = { AllowSetForegroundWindow, GW_HWNDNEXT, SHELL_HOSTS, SetWinEventHook, UnhookWinEvent, WinEventProc, activateWindow, allowAnyForeground, appWindows, closeWindow, coveringForegroundRect, desktopOwner, foreground, foregroundExe, foregroundWindow, hasAppWindowBelow, minimizeWindow, ownerOf, pinToDesktop, roundCorners, sendToBottom, setCaptureExcluded, setOwner, setWindowRect, setWindowShape, stripFrame, takeFocus, watchWindows, windowRect };
