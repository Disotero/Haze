// Sound visualizers: a strip along the bottom edge of the screen and a card
// the size of the world clock. Both draw the shared loopback spectrum
// (audio.js) in one of a few looks: bars, a filled wave or a thin line.

import { listen, bands, audioError } from "./audio.js";
import { icons } from "./icons.js";

export const VIZ_STYLES = {
  bars: "Столбики",
  mirror: "Зеркало",
  blocks: "Блоки",
  dots: "Точки",
  wave: "Волна",
  hills: "Холмы",
  line: "Линия",
};
const BARRED = new Set(["bars", "mirror", "blocks", "dots"]);

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Canvas sizes in CSS px, kept current by an observer: reading clientWidth
// every frame would force a layout pass whenever anything else changed.
const sizes = new WeakMap();
const sizeWatch = new ResizeObserver((entries) => {
  for (const e of entries) sizes.set(e.target, [e.contentRect.width, e.contentRect.height]);
});

/** Keeps the canvas backing store at device pixels; returns [w, h] in CSS px. */
function fit(canvas) {
  const dpr = devicePixelRatio || 1;
  if (!sizes.has(canvas)) {
    sizes.set(canvas, [canvas.clientWidth, canvas.clientHeight]);
    sizeWatch.observe(canvas);
  }
  const [w, h] = sizes.get(canvas);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return [g, w, h];
}

/**
 * Bass in the middle, highs out to both sides — symmetric reads calmer
 * across a whole screen. `levels` smooths the fall so bars don't flicker.
 */
function draw(canvas, levels, style, colors, { mirror = true, floor = 0.02 } = {}) {
  const [g, w, h] = fit(canvas);
  // Left to right: a faint shift toward the second colour at the sides, or
  // the wallpaper's own colours above each spot. Made again only when the
  // colours or the width change, not every frame.
  const key = w + "|" + colors.join();
  if (canvas._gradKey !== key) {
    canvas._gradKey = key;
    canvas._grad = g.createLinearGradient(0, 0, w, 0);
    colors.forEach((c, i) => canvas._grad.addColorStop(i / (colors.length - 1), c));
  }
  const color = canvas._grad;
  const n = levels.length;
  const count = mirror ? n * 2 : n;
  const at = (i) => levels[mirror ? Math.abs(i - n + (i < n ? 1 : 0)) : i];
  g.fillStyle = g.strokeStyle = color;

  if (BARRED.has(style)) {
    const step = w / count;
    const bw = Math.max(1.5, step * (style === "dots" ? 0.5 : style === "blocks" ? 0.7 : 0.42));
    for (let i = 0; i < count; i++) {
      const v = Math.max(floor, at(i));
      const x = i * step + (step - bw) / 2;
      if (style === "bars") {
        const bh = Math.max(2, v * h);
        g.beginPath();
        g.roundRect(x, h - bh, bw, bh, bw / 2);
        g.fill();
      } else if (style === "mirror") {
        // Grows both ways from the middle line.
        const bh = Math.max(2, v * h);
        g.beginPath();
        g.roundRect(x, (h - bh) / 2, bw, bh, bw / 2);
        g.fill();
      } else if (style === "blocks") {
        // Equaliser-style segments, the top one brighter.
        const seg = Math.max(3, bw * 0.55);
        const cells = Math.max(1, Math.round((v * h) / (seg * 1.6)));
        for (let d = 0; d < cells; d++) {
          g.globalAlpha = d === cells - 1 ? 1 : 0.55;
          g.fillRect(x, h - seg - d * seg * 1.6, bw, seg);
        }
        g.globalAlpha = 1;
      } else {
        const dots = Math.max(1, Math.round((v * h) / (bw * 1.8)));
        for (let d = 0; d < dots; d++) {
          g.beginPath();
          g.arc(x + bw / 2, h - bw / 2 - d * bw * 1.8, bw / 2, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    return;
  }

  if (style === "hills") {
    // Three soft layers: the back ones taller and fainter, shifted aside.
    [
      [1, 0.3, 0.33],
      [0.8, 0.5, -0.25],
      [0.6, 1, 0],
    ].forEach(([k, alpha, shift]) => {
      g.globalAlpha = alpha;
      curve(g, w, h, count, (i) => at(Math.min(count - 1, Math.max(0, Math.round(i + shift * 6)))) * k, floor);
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
    });
    g.globalAlpha = 1;
    return;
  }

  // wave / line: a smooth curve through the band tops.
  curve(g, w, h, count, at, floor);
  if (style === "line") {
    g.lineWidth = 2;
    g.lineJoin = "round";
    g.stroke();
    return;
  }
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  // Fade toward the bottom.
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "#000");
  fade.addColorStop(1, "transparent");
  g.globalCompositeOperation = "destination-in";
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
}

/** Opens a path along a smooth curve through the band tops (not closed). */
function curve(g, w, h, count, at, floor) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([(i + 0.5) * (w / count), h - Math.max(floor, at(i)) * h * 0.95]);
  g.beginPath();
  g.moveTo(0, pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  g.lineTo(w, pts[pts.length - 1][1]);
}

const rgbOf = (name) => {
  const m = css(name).match(/^#([0-9a-f]{6})$/i);
  const n = m ? parseInt(m[1], 16) : 0x888888;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Pulls a loud colour (neon violet…) toward grey: saturation at most `max`. */
function tame([r, g, b], max = 0.42) {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const sat = hi === lo ? 0 : (hi - lo) / (255 - Math.abs(hi + lo - 255));
  if (sat <= max) return [r, g, b];
  const grey = (hi + lo) / 2;
  const k = max / sat;
  return [r, g, b].map((c) => Math.round(grey + (c - grey) * k));
}

const mixRgb = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

// ── Wallpaper colours ──────────────────────────────────────────────────────
// The bottom part of the wallpaper in columns, lifted so they read on top
// of it. Refreshed every 20 s (video and animated wallpapers change).

const WALL_COLS = 10;
let wallCols = null;
let wallAt = 0;
let wallBusy = false;

function toHsl([r, g, b]) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  if (hi === lo) return [0, 0, l];
  const d = hi - lo;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

/** Lighter and a little richer: the wallpaper's hue, still visible over it. */
function lift(rgb) {
  const [h, s, l] = toHsl(rgb);
  return fromHsl([h, Math.min(0.85, s * 1.25), 0.62 + l * 0.25]);
}

async function refreshWall() {
  wallBusy = true;
  try {
    const url = await window.cozy.wallpaperSample();
    if (!url) return (wallCols = null);
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = WALL_COLS * 4;
    c.height = 20;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    // Lower 45 %: what's right behind the strip.
    const y0 = Math.floor(c.height * 0.55);
    const data = g.getImageData(0, y0, c.width, c.height - y0).data;
    wallCols = Array.from({ length: WALL_COLS }, (_, col) => {
      const sum = [0, 0, 0];
      let n = 0;
      for (let y = 0; y < c.height - y0; y++)
        for (let x = col * 4; x < col * 4 + 4; x++) {
          const i = (y * c.width + x) * 4;
          sum[0] += data[i];
          sum[1] += data[i + 1];
          sum[2] += data[i + 2];
          n++;
        }
      return lift(sum.map((v) => v / n));
    });
  } catch {
    wallCols = null;
  } finally {
    wallAt = Date.now();
    wallBusy = false;
  }
}

/** Wallpaper changed: pick the colours up again on the next frame. */
export function invalidateWall() {
  wallAt = 0;
}

/** Gradient stops, left to right. */
const colorOf = (cfg, alpha) => {
  if (cfg.color === "wall") {
    if (!wallBusy && Date.now() - wallAt > 20000) refreshWall();
    if (wallCols) return wallCols.map((c) => rgba(c, alpha + 0.12));
  }
  const base = tame(rgbOf(cfg.color === "accent" ? "--accent" : "--ink"));
  const side = rgba(mixRgb(base, tame(rgbOf("--accent-2")), 0.3), alpha);
  return [side, rgba(base, alpha), side];
};

/** Eases levels toward the new bands: quick rise, slower fall. */
function follow(levels, next) {
  for (let i = 0; i < levels.length; i++) {
    const v = next ? next[i] : 0;
    levels[i] = v > levels[i] ? levels[i] + (v - levels[i]) * 0.6 : levels[i] * 0.86 + v * 0.14;
  }
}

// ── Bottom strip ───────────────────────────────────────────────────────────

/** The strip along the bottom edge; sync(settings) turns it on/off/restyles. */
export function soundStrip(host) {
  const canvas = Object.assign(document.createElement("canvas"), { className: "sound-strip" });
  host.prepend(canvas);
  let off = null;
  let cfg = {};
  let levels = new Float32Array(48);
  let tmp = new Float32Array(48);

  function frame(bins) {
    follow(levels, bins && bands(bins, levels.length, tmp));
    draw(canvas, levels, cfg.style, colorOf(cfg, cfg.color === "accent" ? 0.75 : 0.42), { floor: 0.015 });
  }

  return {
    sync(s, on) {
      cfg = s.audioViz;
      canvas.style.height = cfg.height + "px";
      canvas.hidden = !on;
      const n = BARRED.has(cfg.style) ? 64 : 40;
      if (levels.length !== n) {
        levels = new Float32Array(n);
        tmp = new Float32Array(n);
      }
      if (on && !off) off = listen(frame);
      if (!on && off) {
        off();
        off = null;
      }
      if (on) frame(null);
    },
  };
}

// ── Card ───────────────────────────────────────────────────────────────────

export function soundWidget(ctx) {
  const el = document.createElement("template");
  el.innerHTML = `
    <div class="widget w-sound">
      <div class="glass">
        <div class="row">
          <span class="s-badge">${icons.note}</span>
          <div class="grow">
            <div class="title ellipsis"></div>
            <div class="artist muted ellipsis"></div>
          </div>
        </div>
        <canvas class="viz"></canvas>
        <div class="viz-note muted"></div>
      </div>
    </div>`;
  const root = el.content.firstElementChild;
  const canvas = root.querySelector(".viz");
  const note = root.querySelector(".viz-note");
  let levels = new Float32Array(28);
  const tmp = new Float32Array(28);
  let media = { active: false };

  function frame(bins) {
    const text = bins ? "" : audioError();
    if (note.textContent !== text) note.textContent = text;
    follow(levels, bins && bands(bins, levels.length, tmp));
    const cfg = ctx.s.audioViz;
    draw(canvas, levels, ctx.s.soundCardStyle || "bars", colorOf(cfg, 0.9), { floor: 0.03 });
  }

  function paintMedia() {
    root.querySelector(".title").textContent = media.active ? media.title || "Без названия" : "Тишина";
    root.querySelector(".artist").textContent = media.active ? media.artist || "" : "звук системы — в такт";
  }

  const off = listen(frame);
  window.cozy.getMedia().then((m) => {
    media = m || { active: false };
    paintMedia();
  });
  return {
    el: root,
    update(kind, payload) {
      if (kind === "media") {
        media = payload || { active: false };
        paintMedia();
      }
      if (kind === "init") paintMedia();
      if (kind === "settings" || kind === "init") frame(null);
    },
    destroy: off,
  };
}

