// The frosted backdrop clip: the blur shows only through the widgets' glass.
// Extracted from widgets.js unchanged (A3) — same pipeline, same timing.
import { roundedRect, alignToScreen } from "../shared/clip.js";
import { zOf } from "./layout.js";

/**
 * `board` is the widgets board, `backdropEl` the frosted backdrop element;
 * `getS()` returns the current settings, `sendGlassRects` forwards card
 * rects to the live-glass window (main validates them).
 */
export function createClip({ board, backdropEl, getS, sendGlassRects }) {
  const alignBackdrop = () => alignToScreen(backdropEl);

  let lastRects = "";
  function sendRects(rects) {
    const json = JSON.stringify(rects);
    if (json === lastRects) return;
    lastRects = json;
    sendGlassRects(rects);
  }

  function updateClip() {
    const parts = [];
    const rects = [];
    // clip-path is in the backdrop's own coordinates.
    const ox = backdropEl.offsetLeft;
    const oy = backdropEl.offsetTop;
    board.querySelectorAll(".glass").forEach((g) => {
      // A photo covers its card, the clock draws its own dial: shapes the blur can't follow.
      if (g.closest(".w-photo:not(.empty), .w-analog")) return;
      const r = g.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const z = zOf(g.closest(".widget, .panel") || g);
      const radius = (parseFloat(getComputedStyle(g).borderTopLeftRadius) || 22) * z;
      parts.push(roundedRect(r.left - ox, r.top - oy, r.width, r.height, radius));
      rects.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: radius });
    });
    if (getS().wallpaper.type === "we" && getS().liveGlass) sendRects(rects);
    backdropEl.style.clipPath = parts.length ? `path('${parts.join("")}')` : "inset(50%)";
  }

  // Following an animation (entry, settling) with the clip: about 20 times a
  // second is smooth enough under a 26 px blur, at a fraction of the cost of
  // every frame. Drag and grip-resize route through the same throttle.
  const CLIP_STEP = 50;
  let clipUntil = 0;
  let clipLast = 0;
  function trackClipFor(ms) {
    const already = clipUntil > performance.now();
    clipUntil = Math.max(clipUntil, performance.now() + ms);
    if (already) return;
    const step = (t) => {
      if (t - clipLast >= CLIP_STEP || t >= clipUntil) {
        clipLast = t;
        updateClip();
      }
      if (t < clipUntil) requestAnimationFrame(step);
      else updateClip();
    };
    requestAnimationFrame(step);
  }

  /** The board's size changes re-clip: fonts and images settle, cards grow. */
  function watchBoard() {
    new ResizeObserver(() => updateClip()).observe(board);
  }

  /** A (re)created glass layer asked for the shapes again. */
  function resend() {
    lastRects = "";
    updateClip();
  }

  return { alignBackdrop, updateClip, trackClipFor, watchBoard, resend };
}
