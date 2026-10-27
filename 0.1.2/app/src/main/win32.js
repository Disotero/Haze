// Win32 declarations shared by the desktop modules: koffi bindings for
// user32 / dwmapi / kernel32 / gdi32 / shell32 / advapi32, their constants,
// and the small helpers several modules need (window handles, class names,
// process paths, key presses).

const koffi = require("koffi");

const user32 = koffi.load("user32.dll");

const dwmapi = koffi.load("dwmapi.dll");

const kernel32 = koffi.load("kernel32.dll");

const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });

// Registered by name for GetSystemPowerStatus below.
koffi.struct("SYSTEM_POWER_STATUS", {
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

/**
 * Electron's getNativeWindowHandle() buffer → HWND as a number, signed like
 * the intptr values koffi hands back (USER handles are sign-extended), so
 * the two compare equal.
 */
function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return Number(buf.length >= 8 ? buf.readBigInt64LE(0) : buf.readInt32LE(0));
}

function className(hwnd) {
  const buf = new Uint16Array(256);
  const n = GetClassNameW(hwnd, buf, buf.length);
  return String.fromCharCode(...buf.subarray(0, n));
}

const SHELL_CLASSES = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"]);

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

// pid → { exe, at }. Every enumeration used to open a process handle per
// window; a pid keeps its exe for life, so a short TTL only guards against
// pid reuse.
const exeCache = new Map();

const EXE_TTL = 10e3;

function processPath(pid) {
  if (!pid) return "";
  const hit = exeCache.get(pid);
  const now = Date.now();
  if (hit && now - hit.at < EXE_TTL) return hit.exe;
  const exe = queryProcessPath(pid);
  exeCache.set(pid, { exe, at: now });
  if (exeCache.size > 512) {
    for (const [k, v] of exeCache) if (now - v.at >= EXE_TTL) exeCache.delete(k);
  }
  return exe;
}

function queryProcessPath(pid) {
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

function key(vk, up, extended) {
  keybd_event(vk, 0, (up ? KEYEVENTF_KEYUP : 0) | (extended ? KEYEVENTF_EXTENDEDKEY : 0), 0);
}

module.exports = { ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA, AttachThreadInput, CloseHandle, CombineRgn, CreateRectRgn, CreateRoundRectRgn, DWMWA_CLOAKED, DeleteObject, DwmGetWindowAttribute, DwmSetWindowAttribute, EXE_TTL, EnumWindows, EnumWindowsProc, FindWindowExW, FindWindowW, GWLP_HWNDPARENT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, GetClassNameW, GetClientRect, GetCurrentThreadId, GetForegroundWindow, GetKeyboardLayout, GetParent, GetSystemPowerStatus, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, HKEY_CURRENT_USER, HWND_BOTTOM, IsIconic, IsWindow, IsWindowVisible, IsZoomed, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, LockWorkStation, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PostMessageW, ProcessIdToSessionId, QueryFullProcessImageNameW, RECT, RRF_RT_REG_BINARY, RegGetValueW, RegisterWindowMessageW, SHAppBarMessage, SHELL_CLASSES, SMTO_NORMAL, SPIF_SENDCHANGE, SPI_GETDESKWALLPAPER, SPI_SETDESKWALLPAPER, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_MINIMIZE, SW_RESTORE, SendMessageTimeoutW, SetFocus, SetForegroundWindow, SetParent, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, SetWindowRgn, ShowWindow, ShowWindowAsync, SwitchToThisWindow, SystemParametersInfoW, VK_CONTROL, VK_LEFT, VK_LWIN, VK_RIGHT, WM_CLOSE, WS_CHILD, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, advapi32, appBarData, className, dwmapi, exeCache, gdi32, hwndOf, isCloaked, kernel32, key, keybd_event, processPath, queryProcessPath, shell32, user32, windowPid, windowText };
