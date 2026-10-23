// Soft synthesized chimes (no audio files needed).
let ctx = null;
const audio = () => (ctx ||= new AudioContext());

function note(freq, at, dur, gain = 0.18) {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A short three-note chime (timers, pomodoro). */
export function chime() {
  const t = audio().currentTime + 0.02;
  [784, 988, 1319].forEach((f, i) => note(f, t + i * 0.16, 0.9));
}

/** Repeating alarm melody; returns stop(). Gives up after `maxMs`. */
export function alarmLoop(maxMs = 120000) {
  let stopped = false;
  const play = () => {
    if (stopped) return;
    const t = audio().currentTime + 0.02;
    [880, 1109, 1319, 1109, 880, 1319].forEach((f, i) => note(f, t + i * 0.14, 0.5, 0.22));
  };
  play();
  const timer = setInterval(play, 1600);
  const limit = setTimeout(() => stop(), maxMs);
  function stop() {
    stopped = true;
    clearInterval(timer);
    clearTimeout(limit);
  }
  return stop;
}
