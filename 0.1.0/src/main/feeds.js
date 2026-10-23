// Data for the info widgets (esports, stocks, sports, phone), fetched in the
// main process with a cache per request so several widgets share one fetch.
const path = require("node:path");
const { execFile } = require("node:child_process");
const { fetchHltv } = require("./hltv");

const TTL = { esports: 10 * 60e3, stocks: 60e3, sports: 60e3, phone: 15e3, news: 10 * 60e3 };

// News sources (RSS/Atom). The widget parses the XML with DOMParser.
const NEWS = {
  rbc: "https://rssexport.rbc.ru/rbcnews/news/30/full.rss",
  lenta: "https://lenta.ru/rss/news",
  bbc: "https://feeds.bbci.co.uk/russian/rss.xml",
  ixbt: "https://www.ixbt.com/export/news.rss",
  habr: "https://habr.com/ru/rss/articles/?fl=ru",
  stopgame: "https://rss.stopgame.ru/rss_news.xml",
  verge: "https://www.theverge.com/rss/index.xml",
};
const cache = new Map(); // key → { at, promise }

// Liquipedia's API terms ask for a descriptive User-Agent and gzip.
const LP_HEADERS = { "User-Agent": "Haze/0.1 (Windows desktop widgets)", "Accept-Encoding": "gzip" };
const LP_WIKIS = { dota2: "dota2", cs2: "counterstrike", valorant: "valorant", lol: "leagueoflegends" };

async function getJson(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Raw HTML of Liquipedia:Matches; the widget parses it with DOMParser. */
async function esports({ game }) {
  // CS2 comes from HLTV, the other games from Liquipedia.
  if (game === "cs2") return fetchHltv();
  const wiki = LP_WIKIS[game] || "dota2";
  const j = await getJson(`https://liquipedia.net/${wiki}/api.php?action=parse&page=Liquipedia:Matches&format=json&prop=text`, LP_HEADERS);
  return { wiki, html: j.parse?.text?.["*"] || "" };
}

async function yahoo(symbol) {
  const j = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`,
    { "User-Agent": "Mozilla/5.0" }
  );
  const r = j.chart?.result?.[0];
  if (!r) throw new Error("нет данных");
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null);
  return { symbol, price: r.meta.regularMarketPrice, prev: r.meta.chartPreviousClose, currency: r.meta.currency, spark: closes };
}

async function moex(secid) {
  const j = await getJson(
    `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(secid)}.json?iss.meta=off&iss.only=marketdata&marketdata.columns=LAST,LASTTOPREVPRICE`
  );
  const [last, changePct] = j.marketdata?.data?.[0] || [];
  if (last == null) throw new Error("нет данных");
  return { symbol: "MOEX:" + secid, price: last, prev: last / (1 + (changePct || 0) / 100), currency: "RUB", spark: [] };
}

/** Symbols like AAPL, BTC-USD, ^GSPC (Yahoo) or MOEX:SBER (Moscow Exchange). */
async function stocks({ symbols }) {
  const list = String(symbols || "").split(/[\s,]+/).filter(Boolean).slice(0, 8);
  return Promise.all(
    list.map((s) =>
      (/^MOEX:/i.test(s) ? moex(s.slice(5).toUpperCase()) : yahoo(s.toUpperCase())).catch((e) => ({ symbol: s, error: e.message }))
    )
  );
}

/** ESPN scoreboard for a league path like "soccer/eng.1" or "basketball/nba". */
async function sports({ league }) {
  if (!/^[a-z]+\/[a-z0-9.\-_]+$/i.test(league || "")) throw new Error("лига?");
  const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`);
  return {
    league: j.leagues?.[0]?.name || league,
    events: (j.events || []).slice(0, 12).map((e) => {
      const c = e.competitions?.[0] || {};
      const side = (h) => {
        const t = (c.competitors || []).find((x) => x.homeAway === h) || {};
        return { name: t.team?.shortDisplayName || t.team?.displayName || "?", logo: t.team?.logo || "", score: t.score ?? "" };
      };
      return { date: e.date, state: e.status?.type?.state, detail: e.status?.type?.shortDetail || "", home: side("home"), away: side("away") };
    }),
  };
}

function phone() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "phone.ps1")],
      { windowsHide: true, timeout: 20000, maxBuffer: 1 << 20 },
      (err, out) => {
        try {
          resolve(JSON.parse(out.trim().split("\n").pop()));
        } catch {
          resolve({ devices: [], error: err ? err.message : "нет ответа" });
        }
      }
    );
  });
}

// Google News RSS: plain topic feeds and keyword search (no AI involved).
const GN = "hl=ru&gl=RU&ceid=RU:ru";
const GN_TOPICS = new Set(["WORLD", "NATION", "BUSINESS", "TECHNOLOGY", "ENTERTAINMENT", "SPORTS", "SCIENCE", "HEALTH"]);

/** { kind: "source", value: "rbc" } | { kind: "topic", value: "TECHNOLOGY" } | { kind: "search", value: "SpaceX" } */
async function news({ kind = "source", value, source }) {
  let url = "";
  if (kind === "source") url = NEWS[value || source];
  if (kind === "topic" && GN_TOPICS.has(value)) url = `https://news.google.com/rss/headlines/section/topic/${value}?${GN}`;
  if (kind === "search" && String(value || "").trim()) url = `https://news.google.com/rss/search?q=${encodeURIComponent(String(value).trim())}&${GN}`;
  if (!url) throw new Error("лента?");
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Haze" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return { xml: await r.text() };
}

const FEEDS = { esports, stocks, sports, phone, news };

function get(kind, params = {}) {
  const fn = FEEDS[kind];
  if (!fn) return Promise.reject(new Error("unknown feed"));
  const key = kind + JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL[kind]) return hit.promise;
  const promise = Promise.resolve(fn(params));
  cache.set(key, { at: Date.now(), promise });
  // Don't keep failures around for the whole TTL.
  promise.catch(() => cache.delete(key));
  return promise;
}

module.exports = { get };
