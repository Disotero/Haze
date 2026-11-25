// Icons and shortcut targets for apps shown in the dock and launcher widgets.
const fs = require("node:fs");
const { app, nativeImage, shell } = require("electron");

// Icons are data URLs of 10–50 KB each: keep the most recently used few hundred.
const ICON_LIMIT = 200;
// A shortcut broken now may be fixed later: don't believe "broken" for long.
const BROKEN_TTL = 5 * 60e3;
const iconCache = new Map(); // path → Promise<data URL>, least recently used first
const linkTargets = new Map(); // path → { target, at }

/** The exe a .lnk points at ("" if broken); other paths as they are. */
function linkTarget(p) {
  if (!/\.lnk$/i.test(p)) return p;
  const hit = linkTargets.get(p);
  if (hit && (hit.target || Date.now() - hit.at < BROKEN_TTL)) return hit.target;
  let target = "";
  try {
    target = shell.readShortcutLink(p).target || "";
  } catch {
    // Broken shortcut: still launchable through the shell, just never "running".
  }
  linkTargets.set(p, { target, at: Date.now() });
  return target;
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

/**
 * Data URL of the app's icon, as large as Windows will give it. Callers
 * asking for the same path at once share one extraction.
 */
function iconFor(original) {
  const hit = iconCache.get(original);
  if (hit) {
    iconCache.delete(original);
    iconCache.set(original, hit); // now the most recently used
    return hit;
  }
  const job = extractIcon(original).then((url) => {
    // No icon may just mean "not there yet" (an app mid-install): ask again later.
    if (!url) setTimeout(() => iconCache.get(original) === job && iconCache.delete(original), BROKEN_TTL);
    return url;
  });
  iconCache.set(original, job);
  while (iconCache.size > ICON_LIMIT) iconCache.delete(iconCache.keys().next().value);
  return job;
}

async function extractIcon(original) {
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
  return url;
}

module.exports = { iconFor, linkTarget };
