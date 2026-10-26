// HLTV.org (CS2 matches and results). HLTV sits behind Cloudflare, which
// turns away plain HTTP clients, so the pages are loaded in a hidden
// Chromium window — like a normal visit — and read from the DOM.
const { BrowserWindow, session } = require("electron");

const BASE = "https://www.hltv.org";

const EXTRACT_MATCHES = `[...document.querySelectorAll('.match-wrapper')].slice(0, 40).map((w) => ({
  live: w.getAttribute('live') === 'true',
  unix: Number(w.querySelector('[data-unix]')?.getAttribute('data-unix')) || 0,
  event: w.querySelector('[data-event-headline]')?.dataset.eventHeadline || '',
  link: w.querySelector('a[href^="/matches/"]')?.getAttribute('href') || '',
  names: [...w.querySelectorAll('.match-teamname')].map((e) => e.textContent.trim()),
  logos: [...w.querySelectorAll('img.match-team-logo')].map((e) => e.src),
  score: [...w.querySelectorAll('[class*=score]')].map((e) => e.textContent.trim()).find(Boolean) || '',
  meta: [...w.querySelectorAll('.match-meta')].map((e) => e.textContent.trim()).filter((t) => t !== 'Live').join(' '),
}))`;

const EXTRACT_RESULTS = `[...document.querySelectorAll('.results-all .result-con')].slice(0, 25).map((r) => ({
  unix: Number(r.getAttribute('data-zonedgrouping-entry-unix')) || 0,
  names: [r.querySelector('.team1 .team')?.textContent.trim(), r.querySelector('.team2 .team')?.textContent.trim()],
  logos: [...r.querySelectorAll('img.team-logo')].map((i) => i.src),
  score: r.querySelector('.result-score')?.textContent.trim() || '',
  event: r.querySelector('.event-name')?.textContent.trim() || '',
  link: r.querySelector('a')?.getAttribute('href') || '',
}))`;

let win = null;
let busy = Promise.resolve();
let idleTimer = null;
const JOB_TIMEOUT = 45e3; // a hung navigation must not block every later fetch
const IDLE_CLOSE = 10 * 60e3;

const alive = () => win && !win.isDestroyed();

function browser() {
  clearTimeout(idleTimer);
  if (alive()) return win;
  win = new BrowserWindow({
    show: false,
    width: 1300,
    height: 900,
    webPreferences: { sandbox: true, partition: "persist:hltv", backgroundThrottling: false },
  });
  // Look like the plain Chrome this is: no Electron/app tokens in the UA.
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ \S+\/\d+\.\d+\.\d+(?= Chrome)/, ""));
  // Pictures and fonts aren't needed to read the lists.
  session.fromPartition("persist:hltv").webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (d, cb) =>
    cb({ cancel: ["image", "font", "media"].includes(d.resourceType) })
  );
  return win;
}

/** Load `path` and poll `extract` until it yields rows (Cloudflare may interpose). */
async function read(path, extract, job) {
  const w = browser();
  await w.loadURL(BASE + path).catch(() => {});
  for (let i = 0; i < 12; i++) {
    if (job.over || w.isDestroyed()) throw new Error("HLTV: отменено");
    const rows = await w.webContents.executeJavaScript(extract).catch(() => []);
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("HLTV не ответил");
}

/** "9 (0) 13 (1)" → rounds and maps; "2 - 1" → maps. */
function parseScore(s) {
  const live = s.match(/(\S+)\s*\((\d+)\)\s+(\S+)\s*\((\d+)\)/);
  if (live) return { maps: [live[2], live[4]], rounds: [live[1], live[3]] };
  const done = s.match(/(\d+)\s*-\s*(\d+)/);
  return done ? { maps: [done[1], done[2]] } : null;
}

function toMatch(r, finished) {
  const sc = parseScore(r.score);
  return {
    ts: r.unix,
    a: { name: r.names[0] || "TBD", logo: r.logos[0] || "" },
    b: { name: r.names[1] || "TBD", logo: r.logos[1] || "" },
    scores: sc ? sc.maps : [],
    rounds: sc?.rounds || null,
    live: !finished && Boolean(r.live),
    finished,
    event: [r.event, r.meta].filter(Boolean).join(" · "),
    link: r.link ? BASE + r.link : "",
  };
}

/** { source: "hltv", matches } — upcoming/live and recent results together. */
/** Close the hidden window when nothing has asked for HLTV in a while. */
function closeWhenIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (alive()) win.destroy();
    win = null;
  }, IDLE_CLOSE);
}

async function job(state) {
  const upcoming = await read("/matches", EXTRACT_MATCHES, state);
  const results = await read("/results", EXTRACT_RESULTS, state).catch(() => []);
  return {
    source: "hltv",
    matches: [...upcoming.map((r) => toMatch(r, false)), ...results.map((r) => toMatch(r, true))],
  };
}

function fetchHltv() {
  // One page load at a time in the shared hidden window — and each one gets
  // JOB_TIMEOUT at most, so the queue always moves on.
  const run = busy.then(() => {
    const state = { over: false };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        state.over = true;
        // Whatever the window was stuck on, start clean next time.
        if (alive()) win.destroy();
        win = null;
        reject(new Error("HLTV не ответил вовремя"));
      }, JOB_TIMEOUT);
    });
    return Promise.race([job(state), timeout]).finally(() => {
      state.over = true;
      clearTimeout(timer);
      // Ten minutes until the next read: don't keep a live HLTV page around.
      if (alive()) win.webContents.loadURL("about:blank").catch(() => {});
      closeWhenIdle();
    });
  });
  busy = run.catch(() => {});
  return run;
}

module.exports = { fetchHltv };
