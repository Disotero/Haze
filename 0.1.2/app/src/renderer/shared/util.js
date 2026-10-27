// Small helpers every window uses: boot-time IPC that survives a slow or
// hiccuping main process, and safe CSS url() values.

/** `promise`'s value, or `fallback` if it rejects (logged, never thrown). */
export async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    console.warn("[haze]", e?.message || e);
    return fallback;
  }
}

/**
 * Call `fn` until it resolves: `tries` attempts `delay` ms apart, then
 * `fallback`. For the calls a window can't start without.
 */
export async function retry(fn, fallback, { tries = 3, delay = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      console.warn("[haze] boot call failed:", e?.message || e);
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }
  return fallback;
}

/** The settings at boot: retried, and if main still hasn't answered, the next broadcast. */
export async function bootSettings() {
  const s = await retry(() => window.cozy.getSettings(), null, { tries: 5 });
  return (
    s ??
    new Promise((resolve) => {
      const off = window.cozy.onSettings((next) => (off(), resolve(next)));
    })
  );
}

/** Only pictures we can show without trusting the source: http(s), file and data:image. */
export function imageUrl(v) {
  const s = String(v ?? "");
  return /^(https?:|file:|data:image\/)/i.test(s) ? s : "";
}

/**
 * A CSS url() for any string: quotes, brackets and backslashes are
 * percent-encoded, so a file named `pic).jpg` or a crafted media thumbnail
 * can't break out of the value. "" for anything that isn't a picture URL.
 */
export function cssUrl(v) {
  const s = imageUrl(v);
  // By hand: encodeURIComponent leaves ( ) ' alone.
  const pct = (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  return s ? `url("${s.replace(/["'()\\\s]/g, pct)}")` : "";
}
