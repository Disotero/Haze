// What the speakers play, as a spectrum: Windows loopback capture through
// Chromium's desktop capture (it wants a video track too — we stop it at
// once). One capture is shared by every visualizer and runs only while
// someone listens; frames stop while it's quiet, so silence costs nothing.

const subs = new Set();
let stream = null;
let audioCtx = null;
let analyser = null;
let bins = null;
let starting = null;
let raf = 0;
let paused = false;
let quietSince = 0;
let failed = "";

async function start() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "desktop" } },
      video: { mandatory: { chromeMediaSource: "desktop", maxWidth: 16, maxHeight: 16, maxFrameRate: 1 } },
    });
    s.getVideoTracks().forEach((t) => t.stop());
    if (!subs.size) return s.getTracks().forEach((t) => t.stop());
    stream = s;
    audioCtx = new AudioContext();
    // Made without a click, it may start suspended: silent bars, no error.
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -88;
    analyser.maxDecibels = -22;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    bins = new Uint8Array(analyser.frequencyBinCount);
    failed = "";
    loop();
  } catch (e) {
    failed = "Нет доступа к звуку системы";
    console.warn("audio capture", e);
    for (const fn of subs) fn(null);
    // Often passing (the default device just changed): try again in a while.
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (subs.size && !stream && !starting) {
        failed = "";
        starting = start();
      }
    }, 10000);
  } finally {
    starting = null;
  }
}
let retryTimer = 0;

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  stream = audioCtx = analyser = bins = null;
}

function loop() {
  raf = 0;
  if (!analyser || paused) return;
  analyser.getByteFrequencyData(bins);
  let peak = 0;
  for (let i = 0; i < 200; i++) peak = Math.max(peak, bins[i]);
  const now = performance.now();
  if (peak > 4) quietSince = 0;
  else if (!quietSince) quietSince = now;
  // Quiet for a second: hand out one empty frame, then check 4× a second.
  const quiet = quietSince && now - quietSince > 1000;
  if (!quiet || now - quietSince < 1100) for (const fn of subs) fn(bins);
  if (quiet) setTimeout(() => (raf = requestAnimationFrame(loop)), 250);
  else raf = requestAnimationFrame(loop);
}

/** fn(bins | null) on every frame while sound plays; returns the unsubscribe. */
export function listen(fn) {
  subs.add(fn);
  // A new listener gets a fresh try even after a failure.
  if (!stream && !starting) {
    failed = "";
    starting = start();
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && !starting) stop();
  };
}

export const audioError = () => failed;

/** Game mode: no frames at all. */
export function setAudioPaused(p) {
  paused = p;
  if (!p && analyser && !raf) loop();
}

/**
 * Log-spaced bands out of the FFT bins, 0…1, with a gentle lift for the
 * highs (they're quieter) — what bars and waves draw.
 */
export function bands(bins, n, out = new Float32Array(n)) {
  const lo = 2;
  const hi = Math.min(bins.length - 1, 700); // ~16 kHz at 48 kHz
  for (let i = 0; i < n; i++) {
    const a = Math.floor(lo * Math.pow(hi / lo, i / n));
    const b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / n)));
    let sum = 0;
    for (let j = a; j < b; j++) sum += bins[j];
    const v = sum / (b - a) / 255;
    out[i] = Math.min(1, Math.pow(v, 1.6) * (1 + (i / n) * 0.6));
  }
  return out;
}
