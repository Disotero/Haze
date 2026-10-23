// Icons and shortcut targets for apps shown in the dock and launcher widgets.
const fs = require("node:fs");
const { app, nativeImage, shell } = require("electron");

const iconCache = new Map();
const linkTargets = new Map();

/** The exe a .lnk points at ("" if broken); other paths as they are. */
function linkTarget(p) {
  if (!/\.lnk$/i.test(p)) return p;
  if (!linkTargets.has(p)) {
    let target = "";
    try {
      target = shell.readShortcutLink(p).target || "";
    } catch {
      // Broken shortcut: still launchable through the shell, just never "running".
    }
    linkTargets.set(p, target);
  }
  return linkTargets.get(p);
}

/**
 * Where a shortcut's picture really lives: its own icon if it sets one,
 * else the program it starts. (The shell thumbnail of a .lnk is a blank
 * page with an arrow.)
 */
function iconSource(p) {
  if (!/\.lnk$/i.test(p)) return p;
  try {
    const l = shell.readShortcutLink(p);
    const icon = l.icon && !/\.(dll)$/i.test(l.icon) && fs.existsSync(l.icon) ? l.icon : "";
    return icon || (l.target && fs.existsSync(l.target) ? l.target : p);
  } catch {
    return p;
  }
}

/** Data URL of the app's icon, as large as Windows will give it. */
async function iconFor(original) {
  if (iconCache.has(original)) return iconCache.get(original);
  const p = iconSource(original);
  let url = "";
  try {
    // The shell thumbnail of an exe/lnk is its icon at full resolution;
    // getFileIcon tops out at 32 px on Windows.
    const img = await nativeImage.createThumbnailFromPath(p, { width: 96, height: 96 });
    if (!img.isEmpty()) url = img.toDataURL();
  } catch {
    // Fall through to the small icon.
  }
  if (!url) {
    try {
      url = (await app.getFileIcon(p, { size: "large" })).toDataURL();
    } catch {
      url = "";
    }
  }
  iconCache.set(original, url);
  return url;
}

module.exports = { iconFor, linkTarget };
