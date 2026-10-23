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

function browser() {
  if (win && !win.isDestroyed()) return win;
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
async function read(path, extract) {
  const w = browser();
  await w.loadURL(BASE + path).catch(() => {});
  for (let i = 0; i < 12; i++) {
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
function fetchHltv() {
  // One page load at a time in the shared hidden window.
  const job = busy.then(async () => {
    const upcoming = await read("/matches", EXTRACT_MATCHES);
    const results = await read("/results", EXTRACT_RESULTS).catch(() => []);
    // Ten minutes until the next read: don't keep a live HLTV page around.
    win?.webContents.loadURL("about:blank").catch(() => {});
    return {
      source: "hltv",
      matches: [...upcoming.map((r) => toMatch(r, false)), ...results.map((r) => toMatch(r, true))],
    };
  });
  busy = job.catch(() => {});
  return job;
}

module.exports = { fetchHltv };
