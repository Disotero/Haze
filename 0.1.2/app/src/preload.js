const { contextBridge, ipcRenderer, webUtils } = require("electron");

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("cozy", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  // One entry of layout / sizes / scales / dateNotes (undefined removes it).
  setSettingsEntry: (map, key, value) => ipcRenderer.invoke("settings:entry", map, key, value),
  onSettings: on("settings"),
  getTheme: () => ipcRenderer.invoke("theme:get"),
  onTheme: on("theme"),

  getMedia: () => ipcRenderer.invoke("media:get"),
  onMedia: on("media"),
  mediaCommand: (cmd) => ipcRenderer.send("media:cmd", cmd),

  getWeather: () => ipcRenderer.invoke("weather:get"),
  getWeatherError: () => ipcRenderer.invoke("weather:error"),
  refreshWeather: () => ipcRenderer.invoke("weather:refresh"),
  geocode: (q) => ipcRenderer.invoke("weather:geocode", q),
  onWeather: on("weather"),
  onWeatherError: on("weather:error"),

  onStats: on("stats"),
  getProfile: () => ipcRenderer.invoke("profile:get"),

  isPaused: () => ipcRenderer.invoke("wallpaper:paused"),
  onPaused: on("wallpaper:paused"),

  setHit: (hit) => ipcRenderer.send("widgets:hit", hit),
  widgetsReady: () => ipcRenderer.send("widgets:ready"),
  onWidgetsRearm: on("widgets:rearm"),
  openSettings: () => ipcRenderer.send("open:settings"),
  lock: () => ipcRenderer.send("system:lock"),
  taskManager: () => ipcRenderer.send("system:taskmgr"),
  power: (action) => ipcRenderer.send("system:power", action),
  pickFile: (kind) => ipcRenderer.invoke("dialog:pick", kind),
  fileUrl: (p) => ipcRenderer.invoke("file:url", p),
  screenSource: () => ipcRenderer.invoke("capture:source"),
  wallpaperSample: () => ipcRenderer.invoke("wallpaper:sample"),
  openExternal: (url) => ipcRenderer.send("open:external", url),
  wallpaperThumb: () => ipcRenderer.invoke("wallpaper:thumb"),
  appInfo: () => ipcRenderer.invoke("app:info"),
  appCmd: (cmd) => ipcRenderer.send("app:cmd", cmd),
  onSettingsGoto: on("settings:goto"),
  welcomeInfo: () => ipcRenderer.invoke("welcome:info"),
  welcomeOpen: (page) => ipcRenderer.send("welcome:open", page),
  welcomeDone: () => ipcRenderer.send("welcome:done"),
  showWelcome: () => ipcRenderer.send("welcome:show"),
  windowCmd: (cmd) => ipcRenderer.send("win:cmd", cmd),
  openSystem: (uri) => ipcRenderer.send("open:system", uri),

  // Wallpaper Engine
  weCurrent: () => ipcRenderer.invoke("we:current"),
  onWeCurrent: on("we:current"),
  weStatus: () => ipcRenderer.invoke("we:status"),
  weLibrary: () => ipcRenderer.invoke("we:library"),
  weOpen: (dir) => ipcRenderer.invoke("we:open", dir),
  weClose: () => ipcRenderer.invoke("we:close"),
  weLaunch: () => ipcRenderer.invoke("we:launch"),

  // Top bar
  getStatus: () => ipcRenderer.invoke("status:get"),
  onStatus: on("status"),
  getGaming: () => ipcRenderer.invoke("gaming:get"),
  onGaming: on("gaming"),
  statusCommand: (cmd) => ipcRenderer.send("status:cmd", cmd),
  getDesk: () => ipcRenderer.invoke("desk:get"),
  onDesk: on("desk"),
  switchDesktop: (delta) => ipcRenderer.send("desk:switch", delta),
  nextLayout: () => ipcRenderer.send("desk:next-layout"),

  // Dock
  getDockItems: () => ipcRenderer.invoke("dock:items"),
  onDockItems: on("dock:items"),
  onDockVisible: on("dock:visible"),
  dockActivate: (key) => ipcRenderer.send("dock:activate", key),
  dockMenu: (key) => ipcRenderer.send("dock:menu", key),
  dockStart: () => ipcRenderer.send("dock:start"),
  peekTaskbar: () => ipcRenderer.send("shelf:taskbar"),
  openTrayApp: (exe) => ipcRenderer.send("tray:open", exe),
  closeTrayApp: (exe, force) => ipcRenderer.send("tray:close", exe, force),
  dockRect: (rect) => ipcRenderer.send("dock:rect", rect),
  dockHit: (hit) => ipcRenderer.send("dock:hit", hit),
  onBarCovered: on("bar:covered"),
  barHit: (hit) => ipcRenderer.send("topbar:hit", hit),

  // Live glass layer
  sendGlassRects: (rects) => ipcRenderer.send("glass:rects", rects),
  onGlassRects: on("glass:rects"),
  glassReady: () => ipcRenderer.send("glass:ready"),
  onGlassFreeze: on("glass:freeze"),
  onGlassResend: on("glass:resend"),

  // Day panel: calendar, alarms, power timer
  openDayPanel: () => ipcRenderer.send("panel:open"),
  onPanelOpen: on("panel:open"),
  onAlarmRing: on("alarm:ring"),
  snoozeAlarm: (id) => ipcRenderer.send("alarm:snooze", id),
  setPowerTimer: (action, minutes) => ipcRenderer.send("power:set", action, minutes),
  cancelPowerTimer: () => ipcRenderer.send("power:cancel"),
  notify: (title, body) => ipcRenderer.send("notify", { title, body }),

  // Widgets
  focusWidgets: () => ipcRenderer.send("widgets:focus"),
  photosList: () => ipcRenderer.invoke("photos:list"),
  imagesList: (p) => ipcRenderer.invoke("images:list", p),
  appIcon: (p) => ipcRenderer.invoke("app:icon", p),
  launchApp: (p) => ipcRenderer.send("app:launch", p),
  launcherActivate: (id, index) => ipcRenderer.send("launcher:activate", id, index),
  launcherRemove: (id, index) => ipcRenderer.send("launcher:remove", id, index),
  launcherStates: () => ipcRenderer.invoke("launcher:states"),
  onLauncherStates: on("launcher:states"),
  revealApp: (p) => ipcRenderer.send("app:reveal", p),
  openBrowser: (url) => ipcRenderer.send("browser:open", url),
  popupMenu: (items) => ipcRenderer.invoke("menu:popup", items),
  // A dropped file's path; main also learns it (the converter may then use it).
  pathForFile: (file) => {
    const p = webUtils.getPathForFile(file);
    if (p) ipcRenderer.send("files:dropped", p);
    return p;
  },
  favicon: (host) => ipcRenderer.invoke("favicon:get", host),
  // A team logo from a feed, through main's cache (other hosts give "").
  feedImage: (url) => ipcRenderer.invoke("image:get", url),
  convertSave: (src, ext, data) => ipcRenderer.invoke("convert:save", src, ext, data),
  convertPdf: (src) => ipcRenderer.invoke("convert:pdf", src),
  convertReveal: (p) => ipcRenderer.send("convert:reveal", p),
  openPhoneFolder: (p) => ipcRenderer.send("phone:open", p),
  feed: (kind, params) => ipcRenderer.invoke("feed:get", kind, params),

  // Cozy browser toolbar
  browserCmd: (cmd, arg) => ipcRenderer.send("browser:cmd", cmd, arg),
  browserState: () => ipcRenderer.invoke("browser:state"),
  onBrowserState: on("browser:state"),
});
