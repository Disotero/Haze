// Everything Haze polls goes through here. Each task re-reads the slow-down
// factor ("Слабый ПК" doubles every interval) when it re-arms, so toggling
// the setting changes the cadence at once — no restart, no re-created timers.
// HAZE_PROF=1 logs how long each task takes and how often it ran (dev aid).

let factor = 1;
let report = (name, e) => console.error(`[poll ${name}]`, e);
const prof = new Map(); // name → [total ms, runs]

function setSlow(k) {
  factor = k > 0 ? k : 1;
}

function setLogger(fn) {
  report = fn;
}

/**
 * Run `fn` every `ms` (times the slow factor unless `fixed`). A throw is
 * logged and the task keeps going. Returns stop().
 */
function every(name, ms, fn, { fixed = false } = {}) {
  let timer = null;
  let stopped = false;
  const run = () => {
    const t = process.env.HAZE_PROF ? performance.now() : 0;
    try {
      fn();
    } catch (e) {
      report(name, e);
    }
    if (t) {
      const p = prof.get(name) || [0, 0];
      p[0] += performance.now() - t;
      p[1]++;
      prof.set(name, p);
    }
    arm();
  };
  const arm = () => {
    if (!stopped) timer = setTimeout(run, ms * (fixed ? 1 : factor));
  };
  arm();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

if (process.env.HAZE_PROF) {
  setInterval(() => {
    console.log("[prof]", JSON.stringify(Object.fromEntries([...prof].map(([k, [t, n]]) => [k, `${t.toFixed(0)}ms/${n}`]))));
    prof.clear();
  }, 30000);
}

module.exports = { every, setSlow, setLogger };
