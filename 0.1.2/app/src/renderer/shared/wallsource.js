// Renders a wallpaper source (built-in shader, image/GIF, a folder of
// pictures, video, HTML) into a
// container. Used full-size by the wallpaper layer and at low resolution
// behind the widget cards (the "frosted glass" backdrop). Both copies derive
// their timeline from the wall clock so they stay in sync without IPC.
import { cssColor } from "./theme.js";
import { safe } from "./util.js";

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// Soft aurora bands + drifting bokeh in the palette colours.
const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float t;
uniform vec3 c1, c2, c3, c4;

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / res;
  vec2 q = vec2(uv.x * res.x / res.y, uv.y);
  float s = t * 0.035;

  float n1 = fbm(q * 1.4 + vec2(s, -s * 0.6));
  float n2 = fbm(q * 2.1 - vec2(s * 0.7, s) + n1 * 1.3);
  vec3 col = mix(c4, c1, smoothstep(0.05, 0.95, uv.y + (n1 - 0.5) * 0.6));
  col = mix(col, c2, smoothstep(0.35, 0.85, n2) * 0.75);
  float band = smoothstep(0.45, 0.0, abs(uv.y - 0.62 - (n1 - 0.5) * 0.45));
  col = mix(col, c3, band * 0.45 * smoothstep(0.3, 0.8, n2));

  // Bokeh: soft circles rising slowly.
  for (int i = 0; i < 14; i++){
    float fi = float(i);
    float sp = 0.012 + hash(vec2(fi, 3.1)) * 0.02;
    vec2 c = vec2(hash(vec2(fi, 1.7)) * res.x / res.y,
                  fract(hash(vec2(fi, 9.2)) + t * sp) * 1.3 - 0.15);
    c.x += sin(t * 0.15 + fi) * 0.04;
    float r = 0.03 + hash(vec2(fi, 5.5)) * 0.07;
    float d = length(q - c);
    float glow = smoothstep(r, r * 0.35, d) * (0.10 + 0.12 * hash(vec2(fi, 7.7)));
    col = mix(col, mix(c4, vec3(1.0), 0.6), glow);
  }

  // Gentle vignette + grain against banding.
  col *= 1.0 - 0.18 * pow(length(uv - 0.5) * 1.25, 2.0);
  col += (hash(gl_FragCoord.xy + t) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v)$/i;
const HTML_EXT = /\.html?$/i;

export function kindOf(wp) {
  // "live": a capture of the screen itself (to blur another app's wallpaper).
  if (wp?.type === "live") return "live";
  // "none": something else (Wallpaper Engine) paints the desktop.
  if (wp?.type === "none" || wp?.type === "we") return "none";
  if (!wp || wp.type === "shader" || !wp.path) return "shader";
  if (wp.type === "folder") return "folder";
  if (VIDEO_EXT.test(wp.path)) return "video";
  if (HTML_EXT.test(wp.path)) return "html";
  return "image";
}

export class WallSource {
  /**
   * @param {HTMLElement} host
   * @param {{ scale?: number, fps?: number, muted?: boolean }} opts
   *   scale: render resolution factor for the shader (backdrop uses ~0.25).
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.scale = opts.scale ?? 1;
    this.fps = opts.fps ?? 30;
    this.paused = false;
    this.sound = false;
    this.el = null;
    this.raf = 0;
    this.syncTimer = 0;
    this.key = "";
    // Bumped by every set(): an older set() still awaiting must not mount.
    this.gen = 0;
  }

  async set(wp, fps) {
    if (fps) this.fps = fps;
    const key = JSON.stringify(wp);
    if (key === this.key) {
      this.refreshColors();
      return;
    }
    const gen = ++this.gen;
    this.key = key;
    const kind = kindOf(wp);
    // Live capture swaps itself in once frames flow (see mountLive).
    if (kind !== "live") this.teardown();
    if (kind === "none") return;
    if (kind === "live") return this.mountLive(gen);
    if (kind === "folder") return this.mountFolder(wp, gen);
    let url = "";
    if (kind !== "shader") {
      try {
        url = await window.cozy.fileUrl(wp.path);
      } catch (e) {
        console.error("[wallpaper] can't open", wp.path, e?.message || e);
        // Forget the key, so setting the same wallpaper again retries.
        if (gen === this.gen) this.key = "";
        return;
      }
      if (gen !== this.gen) return;
    }
    if (kind === "shader") this.mountShader();
    else if (kind === "video") this.mountVideo(url);
    else if (kind === "html") this.mountHtml(url);
    else this.mountImage(url);
  }

  teardown() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.syncTimer);
    clearTimeout(this.slideTimer);
    this.raf = 0;
    this.gl = null;
    this.video = null;
    this.live = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.el) this.el.remove();
    this.el = null;
    (this.slides || []).forEach((i) => i.remove());
    this.slides = null;
  }

  /** Unmute a video wallpaper (only the main wallpaper layer calls this). */
  setSound(on) {
    this.sound = on;
    if (this.video) this.video.muted = !on;
  }

  /**
   * Pausing a live capture pauses its <video>, which keeps showing the last
   * frame. (Disabling the capture track instead made many drivers show
   * black or stale frames: the frosted glass pulsed.)
   */
  setPaused(p) {
    this.paused = p;
    const v = this.video || this.live;
    if (v) {
      if (p) v.pause();
      else v.play().catch(() => {});
    }
    if (!p && this.gl && !this.raf) this.loop();
  }

  // ── shader ──
  mountShader() {
    const canvas = document.createElement("canvas");
    canvas.className = "wall-fill";
    this.host.appendChild(canvas);
    this.el = canvas;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.gl = gl;
    this.u = {
      res: gl.getUniformLocation(prog, "res"),
      t: gl.getUniformLocation(prog, "t"),
      c: ["c1", "c2", "c3", "c4"].map((n) => gl.getUniformLocation(prog, n)),
    };
    this.refreshColors();
    this.lastFrame = 0;
    this.loop();
  }

  refreshColors() {
    if (!this.gl) return;
    ["--wp-1", "--wp-2", "--wp-3", "--wp-4"].forEach((name, i) =>
      this.gl.uniform3fv(this.u.c[i], cssColor(name))
    );
    this.draw();
  }

  resize() {
    const c = this.el;
    const w = Math.max(1, Math.round(this.host.clientWidth * devicePixelRatio * this.scale));
    const h = Math.max(1, Math.round(this.host.clientHeight * devicePixelRatio * this.scale));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  draw() {
    if (!this.gl) return;
    this.resize();
    const gl = this.gl;
    gl.uniform2f(this.u.res, this.el.width, this.el.height);
    // Wall-clock time keeps the wallpaper and the backdrop copy identical.
    gl.uniform1f(this.u.t, (Date.now() / 1000) % 100000);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  loop() {
    this.raf = requestAnimationFrame((ts) => {
      this.raf = 0;
      if (this.paused || !this.gl) return;
      if (ts - this.lastFrame >= 1000 / this.fps - 1) {
        this.lastFrame = ts;
        this.draw();
      }
      this.loop();
    });
  }

  // ── media ──
  mountImage(url) {
    const img = document.createElement("img");
    img.className = "wall-fill";
    img.src = url;
    img.decoding = "async";
    this.host.appendChild(img);
    this.el = img;
  }

  /**
   * A folder of pictures, one every `wp.interval` seconds. The pick comes
   * from the wall clock and the name-sorted list (the same in main.js
   * slideIndex), so the wallpaper and the glass copy agree without IPC. The
   * folder is listed again at least once a minute: added and removed
   * pictures show up without picking the folder again.
   */
  mountFolder(wp, gen) {
    const ms = Math.max(10, Number(wp.interval) || 600) * 1000;
    const imgs = [0, 1].map(() => {
      const img = document.createElement("img");
      img.className = "wall-fill";
      img.decoding = "async";
      img.style.opacity = "0";
      img.style.transition = "opacity 1.2s ease";
      this.host.appendChild(img);
      return img;
    });
    this.slides = imgs;
    let front = 1;
    let shown = "";
    const tick = async () => {
      const list = await safe(window.cozy.imagesList(wp.path), []);
      if (gen !== this.gen) return;
      const url = list.length ? list[Math.floor(Date.now() / ms) % list.length] : "";
      if (url !== shown) {
        // The new picture fades in on top; the old one goes once it's covered.
        const back = imgs[1 - front];
        const old = imgs[front];
        if (url) {
          back.src = url;
          await back.decode().catch(() => {});
        }
        if (gen !== this.gen) return;
        if (!url || back.naturalWidth) {
          back.style.zIndex = "1";
          old.style.zIndex = "0";
          back.style.opacity = url ? "1" : "0";
          setTimeout(() => back.style.opacity === "1" && (old.style.opacity = "0"), 1300);
          front = 1 - front;
          shown = url;
        }
      }
      this.slideTimer = setTimeout(tick, Math.min(ms - (Date.now() % ms) + 50, 60000));
    };
    tick();
  }

  mountVideo(url) {
    const v = document.createElement("video");
    v.className = "wall-fill";
    Object.assign(v, { src: url, muted: !this.sound, loop: true, autoplay: true, playsInline: true });
    v.disablePictureInPicture = true;
    this.host.appendChild(v);
    this.el = v;
    this.video = v;
    const sync = () => {
      if (!v.duration || !isFinite(v.duration) || this.paused) return;
      const target = (Date.now() / 1000) % v.duration;
      let drift = Math.abs(v.currentTime - target);
      drift = Math.min(drift, v.duration - drift);
      if (drift > 0.25) v.currentTime = target;
    };
    v.addEventListener("loadedmetadata", sync);
    this.syncTimer = setInterval(sync, 3000);
    v.play().catch(() => {});
  }

  // ── live screen ──
  /**
   * A new capture plays in a hidden <video> first and replaces the old one
   * only once its first frame is there, so a restarted capture (display
   * sleep, resolution change) never leaves the glass blank in between.
   */
  async mountLive(gen, attempt = 0) {
    const v = document.createElement("video");
    v.className = "wall-fill";
    v.muted = true;
    v.style.visibility = "hidden";
    let stream = null;
    try {
      const id = await window.cozy.screenSource();
      if (gen !== this.gen) return;
      // Low resolution is plenty: the picture is blurred by 26 px anyway.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: id,
            maxWidth: 960,
            maxHeight: 540,
            maxFrameRate: this.fps,
          },
        },
      });
    } catch (e) {
      console.error("[glass] screen capture failed:", e.message);
      // Retry a few times (the display may still be waking up); the last frame stays meanwhile.
      if (gen === this.gen && attempt < 5) setTimeout(() => gen === this.gen && this.mountLive(gen, attempt + 1), 2000 * (attempt + 1));
      return;
    }
    if (gen !== this.gen) return stream.getTracks().forEach((t) => t.stop());
    v.srcObject = stream;
    this.host.appendChild(v);
    const swap = () => {
      if (gen !== this.gen) {
        stream.getTracks().forEach((t) => t.stop());
        return v.remove();
      }
      // The old capture goes only now.
      this.teardown();
      v.style.visibility = "";
      this.el = this.live = v;
      this.stream = stream;
      if (this.paused) v.pause();
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(swap);
    else v.addEventListener("loadeddata", swap, { once: true });
    v.play().catch(() => {});
    // Capture can drop (display change, sleep): start a new one; this one's
    // last frame stays up until the new one has its first.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.stream === stream && gen === this.gen) setTimeout(() => gen === this.gen && this.mountLive(gen), 500);
    });
  }

  mountHtml(url) {
    const f = document.createElement("iframe");
    f.className = "wall-fill";
    f.src = url;
    f.setAttribute("sandbox", "allow-scripts");
    f.tabIndex = -1;
    this.host.appendChild(f);
    this.el = f;
  }
}
