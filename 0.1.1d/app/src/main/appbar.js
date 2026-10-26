// App bars (the Haze bar reserving a screen strip) and the Windows taskbar
// (auto-hide, hide, peek).
const { ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, FindWindowExW, FindWindowW, IsWindowVisible, RegisterWindowMessageW, SHAppBarMessage, ShowWindow, VK_LWIN, appBarData, hwndOf, key } = require("./win32");

/** Register `win` as an app bar; Explorer notifies it through `callbackMsg`. False if refused. */
function appBarRegister(win, callbackMsg) {
  return Number(SHAppBarMessage(ABM_NEW, appBarData(hwndOf(win), { uCallbackMessage: callbackMsg }))) !== 0;
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

module.exports = { ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, EDGES, appBarRegister, appBarRemove, appBarSetPos, keepTaskbarHidden, peekTaskbar, peekUntil, taskbarAutoHide, taskbarCreatedMessage, taskbars };
