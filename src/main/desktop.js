// Win32 glue: embeds windows into the desktop wallpaper layer and keeps
// widget windows pinned to the desktop. Uses koffi to call user32 directly.
// The work lives in the modules below; this file keeps the one `desktop`
// API the rest of Haze uses.
const win32 = require("./win32");
const wallpaper = require("./wallpaper");
const appbar = require("./appbar");
const windows = require("./windows");
const input = require("./input");
const power = require("./power");

module.exports = {
  hwndOf: win32.hwndOf,
  attachToWallpaper: wallpaper.attachToWallpaper,
  isStillAttached: wallpaper.isStillAttached,
  pinToDesktop: windows.pinToDesktop,
  coveringForegroundRect: windows.coveringForegroundRect,
  refreshSystemWallpaper: wallpaper.refreshSystemWallpaper,
  powerStatus: power.powerStatus,
  lockWorkStation: () => win32.LockWorkStation(),
  className: win32.className,
  appBarRegister: appbar.appBarRegister,
  appBarSetPos: appbar.appBarSetPos,
  appBarRemove: appbar.appBarRemove,
  taskbarCreatedMessage: appbar.taskbarCreatedMessage,
  appWindows: windows.appWindows,
  foregroundWindow: windows.foregroundWindow,
  activateWindow: windows.activateWindow,
  minimizeWindow: windows.minimizeWindow,
  closeWindow: windows.closeWindow,
  keyboardLang: input.keyboardLang,
  nextKeyboardLayout: input.nextKeyboardLayout,
  virtualDesktops: input.virtualDesktops,
  switchDesktop: input.switchDesktop,
  openStartMenu: input.openStartMenu,
  setCaptureExcluded: windows.setCaptureExcluded,
  taskbarAutoHide: appbar.taskbarAutoHide,
  keepTaskbarHidden: appbar.keepTaskbarHidden,
  peekTaskbar: appbar.peekTaskbar,
  setQuietHours: power.setQuietHours,
  setDesktopIcons: wallpaper.setDesktopIcons,
  insetDesktopIcons: wallpaper.insetDesktopIcons,
  roundCorners: windows.roundCorners,
  watchWindows: windows.watchWindows,
  setWindowShape: windows.setWindowShape,
  foregroundExe: windows.foregroundExe,
  allowAnyForeground: windows.allowAnyForeground,
  setWindowRect: windows.setWindowRect,
  takeFocus: windows.takeFocus,
  setOwner: windows.setOwner,
  sendToBottom: windows.sendToBottom,
  stripFrame: windows.stripFrame,
  windowRect: windows.windowRect,
  ownerOf: windows.ownerOf,
  desktopOwner: windows.desktopOwner,
  hasAppWindowBelow: windows.hasAppWindowBelow,
  foreground: windows.foreground,
  suspend: power.suspend,
};
