// Win32 glue: embeds windows into the desktop wallpaper layer and keeps
// widget windows pinned to the desktop. Uses koffi to call user32 directly.
const koffi = require("koffi");

const user32 = koffi.load("user32.dll");
const dwmapi = koffi.load("dwmapi.dll");
const kernel32 = koffi.load("kernel32.dll");

const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
const SYSTEM_POWER_STATUS = koffi.struct("SYSTEM_POWER_STATUS", {
  ACLineStatus: "uint8",
  BatteryFlag: "uint8",
  BatteryLifePercent: "uint8",
  SystemStatusFlag: "uint8",
  BatteryLifeTime: "uint32",
  BatteryFullLifeTime: "uint32",
});
const EnumWindowsProc = koffi.proto("bool __stdcall EnumWindowsProc(intptr hwnd, intptr lparam)");

const FindWindowW = user32.func("intptr __stdcall FindWindowW(str16 cls, str16 name)");
const FindWindowExW = user32.func(
  "intptr __stdcall FindWindowExW(intptr parent, intptr after, str16 cls, str16 name)"
);
const SendMessageTimeoutW = user32.func(
  "intptr __stdcall SendMessageTimeoutW(intptr hwnd, uint msg, uintptr wp, intptr lp, uint flags, uint timeout, _Out_ uintptr *result)"
);
const EnumWindows = user32.func("bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr lparam)");
const EnumChildWindows = user32.func("bool __stdcall EnumChildWindows(intptr parent, EnumWindowsProc *cb, intptr lparam)");
const SetParent = user32.func("intptr __stdcall SetParent(intptr child, intptr parent)");
const GetParent = user32.func("intptr __stdcall GetParent(intptr hwnd)");
const IsWindow = user32.func("bool __stdcall IsWindow(intptr hwnd)");
const GetWindowLongPtrW = user32.func("intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)");
const SetWindowLongPtrW = user32.func(
  "intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr value)"
);
const SetWindowPos = user32.func(
  "bool __stdcall SetWindowPos(intptr hwnd, intptr after, int x, int y, int cx, int cy, uint flags)"
);
const ShowWindow = user32.func("bool __stdcall ShowWindow(intptr hwnd, int cmd)");
const ShowWindowAsync = user32.func("bool __stdcall ShowWindowAsync(intptr hwnd, int cmd)");
const AttachThreadInput = user32.func("bool __stdcall AttachThreadInput(uint32 a, uint32 b, bool attach)");
const SetForegroundWindow = user32.func("bool __stdcall SetForegroundWindow(intptr hwnd)");
const SetFocus = user32.func("intptr __stdcall SetFocus(intptr hwnd)");
const GetCurrentThreadId = kernel32.func("uint32 __stdcall GetCurrentThreadId()");
const gdi32 = koffi.load("gdi32.dll");
const CreateRoundRectRgn = gdi32.func("intptr __stdcall CreateRoundRectRgn(int x1, int y1, int x2, int y2, int w, int h)");
const CreateRectRgn = gdi32.func("intptr __stdcall CreateRectRgn(int x1, int y1, int x2, int y2)");
const CombineRgn = gdi32.func("int __stdcall CombineRgn(intptr dst, intptr a, intptr b, int mode)");
const DeleteObject = gdi32.func("bool __stdcall DeleteObject(intptr obj)");
const SetWindowRgn = user32.func("int __stdcall SetWindowRgn(intptr hwnd, intptr rgn, bool redraw)");
const GetClientRect = user32.func("bool __stdcall GetClientRect(intptr hwnd, _Out_ RECT *rect)");
const SetWindowDisplayAffinity = user32.func("bool __stdcall SetWindowDisplayAffinity(intptr hwnd, uint32 affinity)");
const GetForegroundWindow = user32.func("intptr __stdcall GetForegroundWindow()");
const GetWindowRect = user32.func("bool __stdcall GetWindowRect(intptr hwnd, _Out_ RECT *rect)");
const GetClassNameW = user32.func("int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16_t *buf, int max)");
const IsZoomed = user32.func("bool __stdcall IsZoomed(intptr hwnd)");
const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(intptr hwnd)");
const LockWorkStation = user32.func("bool __stdcall LockWorkStation()");
const SystemParametersInfoW = user32.func(
  "bool __stdcall SystemParametersInfoW(uint action, uint param, _Inout_ uint16_t *pv, uint winIni)"
);
const DwmGetWindowAttribute = dwmapi.func(
  "long __stdcall DwmGetWindowAttribute(intptr hwnd, uint attr, _Out_ int *value, uint size)"
);
const DwmSetWindowAttribute = dwmapi.func(
  "long __stdcall DwmSetWindowAttribute(intptr hwnd, uint attr, _In_ int *value, uint size)"
);
const GetSystemPowerStatus = kernel32.func(
  "bool __stdcall GetSystemPowerStatus(_Out_ SYSTEM_POWER_STATUS *status)"
);

const shell32 = koffi.load("shell32.dll");
const advapi32 = koffi.load("advapi32.dll");
const APPBARDATA = koffi.struct("APPBARDATA", {
  cbSize: "uint32",
  hWnd: "intptr",
  uCallbackMessage: "uint32",
  uEdge: "uint32",
  rc: RECT,
  lParam: "intptr",
});
const SHAppBarMessage = shell32.func("uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ APPBARDATA *data)");
const RegisterWindowMessageW = user32.func("uint32 __stdcall RegisterWindowMessageW(str16 name)");
const GetWindow = user32.func("intptr __stdcall GetWindow(intptr hwnd, uint cmd)");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint16_t *buf, int max)");
const IsIconic = user32.func("bool __stdcall IsIconic(intptr hwnd)");
const GetWindowThreadProcessId = user32.func(
  "uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)"
);
const GetKeyboardLayout = user32.func("intptr __stdcall GetKeyboardLayout(uint32 thread)");
const PostMessageW = user32.func("bool __stdcall PostMessageW(intptr hwnd, uint msg, uintptr wp, intptr lp)");
const SwitchToThisWindow = user32.func("void __stdcall SwitchToThisWindow(intptr hwnd, bool altTab)");
const keybd_event = user32.func("void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)");
const OpenProcess = kernel32.func("intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(intptr h)");
const QueryFullProcessImageNameW = kernel32.func(
  "bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, _Out_ uint16_t *buf, _Inout_ uint32 *size)"
);
const ProcessIdToSessionId = kernel32.func("bool __stdcall ProcessIdToSessionId(uint32 pid, _Out_ uint32 *session)");
const RegGetValueW = advapi32.func(
  "long __stdcall RegGetValueW(intptr hkey, str16 sub, str16 value, uint32 flags, _Out_ uint32 *type, _Out_ uint8_t *data, _Inout_ uint32 *size)"
);

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const GWLP_HWNDPARENT = -8;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_EX_LAYERED = 0x00080000;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const HWND_BOTTOM = 1;
const SMTO_NORMAL = 0x0000;
const DWMWA_CLOAKED = 14;
const SPI_GETDESKWALLPAPER = 0x0073;
const SPI_SETDESKWALLPAPER = 0x0014;
const SPIF_SENDCHANGE = 0x02;
const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABE_TOP = 1;
const GW_OWNER = 4;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const WS_EX_NOACTIVATE = 0x08000000;
const SW_RESTORE = 9;
const SW_MINIMIZE = 6;
const WM_CLOSE = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const HKEY_CURRENT_USER = -0x7fffffff; // (HKEY)(LONG)0x80000001, sign-extended
const RRF_RT_REG_BINARY = 0x08;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const VK_CONTROL = 0x11;
const VK_LWIN = 0x5b;
const VK_LEFT = 0x25;
const VK_RIGHT = 0x27;

/** Electron's getNativeWindowHandle() buffer → HWND as a number. */
function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0));
}

function className(hwnd) {
  const buf = new Uint16Array(256);
  const n = GetClassNameW(hwnd, buf, buf.length);
  return String.fromCharCode(...buf.subarray(0, n));
}

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
    SetParent(hwnd, host.progman);
    SetWindowPos(hwnd, host.defView || 0, x, y, bounds.width, bounds.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    SetWindowPos(host.workerw, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    host.parent = host.progman;
  } else {
    SetParent(hwnd, host.workerw);
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

const SHELL_CLASSES = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"]);
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

/** Repaint the stock wallpaper so nothing stale is left after we detach. */
function refreshSystemWallpaper() {
  const buf = new Uint16Array(260);
  if (!SystemParametersInfoW(SPI_GETDESKWALLPAPER, buf.length, buf, 0)) return;
  SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, buf, SPIF_SENDCHANGE);
}

// ── App bar: a top panel that reserves screen space like the taskbar ─────

function appBarData(hwnd, extra) {
  return {
    cbSize: koffi.sizeof(APPBARDATA),
    hWnd: hwnd,
    uCallbackMessage: 0,
    uEdge: ABE_TOP,
    rc: { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0,
    ...extra,
  };
}

/** Register `win` as an app bar; Explorer notifies it through `callbackMsg`. */
function appBarRegister(win, callbackMsg) {
  SHAppBarMessage(ABM_NEW, appBarData(hwndOf(win), { uCallbackMessage: callbackMsg }));
}

const EDGES = { left: 0, top: 1, right: 2, bottom: 3 };

/**
 * Reserve a `size` px strip along `edge` of `rect` (physical screen pixels).
 * Returns the rect Explorer granted, which may sit next to the taskbar.
 */
function appBarSetPos(win, rect, size, edge = "top") {
  const r = { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height };
  if (edge === "top") r.bottom = r.top + size;
  if (edge === "bottom") r.top = r.bottom - size;
  if (edge === "left") r.right = r.left + size;
  if (edge === "right") r.left = r.right - size;
  const d = appBarData(hwndOf(win), { uEdge: EDGES[edge], rc: r });
  SHAppBarMessage(ABM_QUERYPOS, d);
  // QUERYPOS may shift the strip off the taskbar; keep our thickness.
  if (edge === "top") d.rc.bottom = d.rc.top + size;
  if (edge === "bottom") d.rc.top = d.rc.bottom - size;
  if (edge === "left") d.rc.right = d.rc.left + size;
  if (edge === "right") d.rc.left = d.rc.right - size;
  SHAppBarMessage(ABM_SETPOS, d);
  return { x: d.rc.left, y: d.rc.top, width: d.rc.right - d.rc.left, height: d.rc.bottom - d.rc.top };
}

function appBarRemove(win) {
  SHAppBarMessage(ABM_REMOVE, appBarData(hwndOf(win)));
}

/** Broadcast by Explorer when it (re)starts; app bars must register again. */
function taskbarCreatedMessage() {
  return RegisterWindowMessageW("TaskbarCreated");
}

// ── Application windows (for the dock) ─────────────────────────────────────

function windowText(hwnd) {
  const buf = new Uint16Array(512);
  const n = GetWindowTextW(hwnd, buf, buf.length);
  return String.fromCharCode(...buf.subarray(0, n));
}

function windowPid(hwnd) {
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

function processPath(pid) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return "";
  try {
    const buf = new Uint16Array(1024);
    const size = [buf.length];
    if (!QueryFullProcessImageNameW(h, 0, buf, size)) return "";
    return String.fromCharCode(...buf.subarray(0, size[0]));
  } finally {
    CloseHandle(h);
  }
}

function isCloaked(hwnd) {
  const cloaked = [0];
  return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0;
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
    GetWindowRect(w.hwnd, r);
    w.rect = { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
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

// ── Keyboard layout & virtual desktops ─────────────────────────────────────

/** LANGID of the keyboard layout active in the foreground window. */
function keyboardLang() {
  const tid = GetWindowThreadProcessId(GetForegroundWindow(), [0]);
  return Number(GetKeyboardLayout(tid)) & 0xffff;
}

// Consoles ignore WM_INPUTLANGCHANGEREQUEST; for them, press Win+Space.
const CONSOLE_CLASSES = new Set(["ConsoleWindowClass", "PseudoConsoleWindow"]);

/**
 * Switch the foreground app to its next keyboard layout. Asking the window
 * directly is what works from inside Haze (injected Win+Space doesn't reach
 * other apps from here), except for consoles.
 */
function nextKeyboardLayout() {
  const fg = GetForegroundWindow();
  if (!fg) return;
  if (!CONSOLE_CLASSES.has(className(fg))) {
    PostMessageW(fg, 0x50, 0, 1); // WM_INPUTLANGCHANGEREQUEST, HKL_NEXT
    return;
  }
  const VK_SPACE = 0x20;
  key(VK_LWIN, false, true);
  key(VK_SPACE, false);
  key(VK_SPACE, true);
  key(VK_LWIN, true, true);
}

function regBinary(sub, name) {
  const buf = Buffer.alloc(8192);
  const size = [buf.length];
  if (RegGetValueW(HKEY_CURRENT_USER, sub, name, RRF_RT_REG_BINARY, [0], buf, size) !== 0) return null;
  return buf.subarray(0, size[0]);
}

const VD_KEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops";
let sessionId = null;

/** { count, current } read from Explorer's (undocumented) registry state. */
function virtualDesktops() {
  const ids = regBinary(VD_KEY, "VirtualDesktopIDs");
  if (!ids || ids.length < 16) return { count: 1, current: 0 };
  let cur = regBinary(VD_KEY, "CurrentVirtualDesktop");
  if (!cur) {
    // Windows 10 keeps the current desktop per logon session.
    if (sessionId === null) {
      const s = [0];
      ProcessIdToSessionId(process.pid, s);
      sessionId = s[0];
    }
    cur = regBinary(
      `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SessionInfo\\${sessionId}\\VirtualDesktops`,
      "CurrentVirtualDesktop"
    );
  }
  const count = Math.floor(ids.length / 16);
  let current = 0;
  for (let i = 0; i < count; i++) {
    if (cur && ids.subarray(i * 16, i * 16 + 16).equals(cur)) current = i;
  }
  return { count, current };
}

function key(vk, up, extended) {
  keybd_event(vk, 0, (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0), 0);
}

/** Move `delta` virtual desktops left/right with Ctrl+Win+Arrow. */
function switchDesktop(delta) {
  const arrow = delta > 0 ? VK_RIGHT : VK_LEFT;
  for (let i = 0; i < Math.abs(delta); i++) {
    key(VK_CONTROL, false);
    key(VK_LWIN, false, true);
    key(arrow, false, true);
    key(arrow, true, true);
    key(VK_LWIN, true, true);
    key(VK_CONTROL, true);
  }
}

function openStartMenu() {
  key(VK_LWIN, false, true);
  key(VK_LWIN, true, true);
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

// ── Windows taskbar & Do Not Disturb ──────────────────────────────────────

const ABM_GETSTATE = 4;
const ABM_SETSTATE = 10;
const ABS_AUTOHIDE = 1;

/** Taskbar windows on every monitor. */
function taskbars() {
  const out = [];
  const main = FindWindowW("Shell_TrayWnd", null);
  if (main) out.push(main);
  let w = 0;
  while ((w = FindWindowExW(0, w, "Shell_SecondaryTrayWnd", null))) out.push(w);
  return out;
}

/**
 * Hide the Windows taskbar for the dock: auto-hide frees its screen strip,
 * and hiding the window stops it from sliding up at the bottom edge.
 * The Win key and Start menu keep working.
 */
function taskbarAutoHide(on) {
  const bars = taskbars();
  if (!bars.length) return;
  const d = appBarData(bars[0], {});
  const state = Number(SHAppBarMessage(ABM_GETSTATE, d));
  d.lParam = on ? state | ABS_AUTOHIDE : state & ~ABS_AUTOHIDE;
  SHAppBarMessage(ABM_SETSTATE, d);
  for (const b of bars) ShowWindow(b, on ? 0 : 5);
}

let peekUntil = 0;

/** Re-hide if Explorer brought the taskbar back (Start menu, restart). */
function keepTaskbarHidden() {
  if (Date.now() < peekUntil) return;
  for (const b of taskbars()) if (IsWindowVisible(b)) ShowWindow(b, 0);
}

/**
 * Let the hidden taskbar out for a while (for its tray icons): show it and
 * press Win+B, which slides an auto-hidden taskbar up with the tray focused.
 */
function peekTaskbar(ms = 15000) {
  peekUntil = Date.now() + ms;
  for (const b of taskbars()) ShowWindow(b, 5);
  key(VK_LWIN, false, true);
  key(0x42, false); // B
  key(0x42, true);
  key(VK_LWIN, true, true);
}

const ntdll = koffi.load("ntdll.dll");
const NtUpdateWnfStateData = ntdll.func(
  "long __stdcall NtUpdateWnfStateData(_In_ uint64_t *name, _In_ uint8_t *buf, uint32 len, intptr type, intptr scope, uint32 match, uint32 check)"
);
// WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED: Focus assist profile (0 off, 1 priority, 2 alarms only).
const WNF_QUIET_HOURS = [0x0d83063ea3bf1c75n];

/**
 * Quiet hours via the (undocumented) Focus assist state. Newer Windows 11
 * builds keep Do Not Disturb elsewhere, so callers also switch toasts off.
 */
function setQuietHours(on) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(on ? 2 : 0);
  return NtUpdateWnfStateData(WNF_QUIET_HOURS, buf, 4, 0, 0, 0, 0) === 0;
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

/** Exact window rect in physical pixels (Electron pads tiny frameless windows). */
function setWindowRect(win, r) {
  const SWP_FRAMECHANGED = 0x20;
  SetWindowPos(hwndOf(win), 0, r.x, r.y, r.width, r.height, SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

/** Window rect in physical pixels. */
function windowRect(win) {
  const r = {};
  GetWindowRect(hwndOf(win), r);
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
  // The window owns the region from here on (don't delete it).
  SetWindowRgn(hwndOf(win), rgn, true);
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

/** { hasBattery, percent, charging } */
function powerStatus() {
  const s = {};
  if (!GetSystemPowerStatus(s)) return { hasBattery: false };
  const hasBattery = (s.BatteryFlag & 128) === 0 && s.BatteryLifePercent !== 255;
  return { hasBattery, percent: s.BatteryLifePercent, charging: s.ACLineStatus === 1 };
}

module.exports = {
  hwndOf,
  attachToWallpaper,
  isStillAttached,
  pinToDesktop,
  coveringForegroundRect,
  refreshSystemWallpaper,
  powerStatus,
  lockWorkStation: () => LockWorkStation(),
  className,
  appBarRegister,
  appBarSetPos,
  appBarRemove,
  taskbarCreatedMessage,
  appWindows,
  foregroundWindow,
  activateWindow,
  minimizeWindow,
  closeWindow,
  keyboardLang,
  nextKeyboardLayout,
  virtualDesktops,
  switchDesktop,
  openStartMenu,
  setCaptureExcluded,
  taskbarAutoHide,
  keepTaskbarHidden,
  peekTaskbar,
  setQuietHours,
  setDesktopIcons,
  insetDesktopIcons,
  roundCorners,
  watchWindows,
  setWindowShape,
  foregroundExe,
  allowAnyForeground,
  setWindowRect,
  takeFocus,
  setOwner,
  sendToBottom,
  stripFrame,
  windowRect,
};
