// Keyboard layouts and virtual desktops.
const { GetForegroundWindow, GetKeyboardLayout, GetWindowThreadProcessId, HKEY_CURRENT_USER, PostMessageW, ProcessIdToSessionId, RRF_RT_REG_BINARY, RegGetValueW, VK_CONTROL, VK_LEFT, VK_LWIN, VK_RIGHT, className, key } = require("./win32");

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

module.exports = { CONSOLE_CLASSES, VD_KEY, keyboardLang, nextKeyboardLayout, openStartMenu, regBinary, sessionId, switchDesktop, virtualDesktops };
