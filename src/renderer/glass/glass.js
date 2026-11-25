// Live glass layer: blurs a capture of the screen under the widgets. This
// window is hidden from screen capture (so it never blurs itself) and sits
// right below the widgets window, which sends the shapes to cut out.
import { WallSource } from "../shared/wallsource.js";
import { roundedRect, alignToScreen, misaligned } from "../shared/clip.js";
import { safe } from "../shared/util.js";

const backdropEl = document.getElementById("backdrop");
const wall = new WallSource(backdropEl, { scale: 0.25, fps: 15 });
const align = () => alignToScreen(backdropEl);

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
  if (misaligned(backdropEl)) {
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
let paused = await safe(window.cozy.isPaused(), false);
let frozen = false;
const apply = () => wall.setPaused(paused || frozen);
apply();
window.cozy.onPaused((p) => ((paused = p), apply()));
window.cozy.onGlassFreeze((f) => ((frozen = f), apply()));
