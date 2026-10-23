// Live glass layer: blurs a capture of the screen under the widgets. This
// window is hidden from screen capture (so it never blurs itself) and sits
// right below the widgets window, which sends the shapes to cut out.
import { WallSource } from "../shared/wallsource.js";

const backdropEl = document.getElementById("backdrop");
const settings = await window.cozy.getSettings();
const wall = new WallSource(backdropEl, { scale: 0.25, fps: 15 });

function align() {
  Object.assign(backdropEl.style, {
    left: -window.screenX + "px",
    top: -window.screenY + "px",
    width: screen.width + "px",
    height: screen.height + "px",
  });
}

function roundedRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

/** rects: [{ x, y, w, h, r }] in window coordinates. */
function clip(rects) {
  const ox = backdropEl.offsetLeft;
  const oy = backdropEl.offsetTop;
  const parts = rects.map((g) => roundedRect(g.x - ox, g.y - oy, g.w, g.h, g.r));
  backdropEl.style.clipPath = parts.length ? `path('${parts.join("")}')` : "inset(50%)";
}

let last = [];
align();
clip(last);
addEventListener("resize", () => {
  align();
  clip(last);
});
setInterval(() => {
  if (backdropEl.offsetLeft !== -window.screenX || backdropEl.offsetTop !== -window.screenY) {
    align();
    clip(last);
  }
}, 1000);
window.cozy.onGlassRects((rects) => {
  last = rects;
  clip(rects);
});
wall.set({ type: "live" });
window.cozy.glassReady();
// Paused (fullscreen app, game) or frozen (an app window over a widget).
let paused = await window.cozy.isPaused();
let frozen = false;
const apply = () => wall.setPaused(paused || frozen);
apply();
window.cozy.onPaused((p) => ((paused = p), apply()));
window.cozy.onGlassFreeze((f) => ((frozen = f), apply()));
