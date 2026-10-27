// Utility widgets: network speed, quote of the day, photo frame, web search
// and the image converter. Split out of extra.js by widget family (A3).
// Each factory takes ctx { s (settings), save(patch), saveEntry(…) } and
// returns { el, update?(kind, payload), destroy?() }.
import { h, $, esc, plural, sparkline } from "./dom.js";
import { icons } from "./icons.js";
import { cssUrl } from "../shared/util.js";

// ── Network speed ──────────────────────────────────────────────────────────

function fmtRate(bps) {
  if (bps == null) return "—";
  const kb = bps / 1024;
  if (kb < 1000) return `${kb.toFixed(kb < 10 ? 1 : 0)} КБ/с`;
  return `${(kb / 1024).toFixed(1)} МБ/с`;
}

export function netWidget() {
  const el = h(`
    <div class="widget w-net">
      <div class="glass">
        <div class="w-title">Сеть <span class="muted kind"></span></div>
        <div class="net-row down"><span class="arrow">${icons.down}</span><b class="num v"></b><span class="g"></span></div>
        <div class="net-row up"><span class="arrow">${icons.up}</span><b class="num v"></b><span class="g"></span></div>
      </div>
    </div>`);
  const hist = { rx: [], tx: [] };
  function update(kind, s) {
    if (kind !== "status" || !s) return;
    for (const k of ["rx", "tx"]) {
      hist[k].push(s[k] || 0);
      if (hist[k].length > 40) hist[k].shift();
    }
    $(el, ".kind").textContent = { wifi: "Wi-Fi", ethernet: "кабель", none: "нет сети" }[s.net?.kind] || "";
    $(el, ".down .v").textContent = fmtRate(s.rx);
    $(el, ".up .v").textContent = fmtRate(s.tx);
    $(el, ".down .g").innerHTML = sparkline(hist.rx, 120, 26, "var(--accent)");
    $(el, ".up .g").innerHTML = sparkline(hist.tx, 120, 26, "var(--accent-2)");
  }
  return { el, update };
}

// ── Quote of the day ───────────────────────────────────────────────────────

const QUOTES = [
  ["Дорогу осилит идущий.", "пословица"],
  ["Лучшее время посадить дерево было двадцать лет назад. Следующее лучшее время — сегодня.", "китайская пословица"],
  ["Простота — это высшая степень изощрённости.", "Леонардо да Винчи"],
  ["Делай что можешь, с тем что имеешь, там где ты есть.", "Теодор Рузвельт"],
  ["Счастье — это когда то, что ты думаешь, говоришь и делаешь, находится в гармонии.", "Махатма Ганди"],
  ["Не бойся медленно продвигаться вперёд, бойся стоять на месте.", "китайская пословица"],
  ["Всё, что нас не убивает, делает нас сильнее.", "Фридрих Ницше"],
  ["Если хочешь идти быстро — иди один. Если хочешь идти далеко — идите вместе.", "африканская пословица"],
  ["Мечты сбываются, если в них верить и действовать.", "Уолт Дисней"],
  ["Чем умнее человек, тем легче он признаёт себя дураком.", "Альберт Эйнштейн"],
  ["Утро вечера мудренее.", "пословица"],
  ["Жизнь — это то, что происходит, пока ты строишь планы.", "Джон Леннон"],
  ["Терпение и труд всё перетрут.", "пословица"],
  ["Ничто не вечно под луной — даже наши беды.", "Чарли Чаплин"],
  ["Делай сегодня то, что другие не хотят, — завтра будешь жить так, как другие не могут.", "Джаред Лето"],
  ["Самое тёмное время — перед рассветом.", "Томас Фуллер"],
  ["Счастье не в том, чтобы делать всегда что хочешь, а в том, чтобы всегда хотеть того, что делаешь.", "Лев Толстой"],
  ["Победа над собой — величайшая из побед.", "Платон"],
  ["Кто хочет — ищет возможности, кто не хочет — ищет причины.", "Сократ"],
  ["Мир принадлежит тем, кто встаёт рано.", "пословица"],
  ["Маленькие шаги каждый день складываются в большие перемены.", "—"],
  ["Отдых — это тоже часть работы.", "—"],
  ["Ты не обязан быть великим, чтобы начать, но должен начать, чтобы стать великим.", "Зиг Зиглар"],
  ["Красота спасёт мир.", "Ф. М. Достоевский"],
  ["Где хотят, там и могут.", "пословица"],
  ["Каждый день — новая страница. Напиши её красиво.", "—"],
  ["Хорошо там, где мы есть.", "—"],
  ["Через тернии к звёздам.", "Сенека"],
];

export function quoteWidget() {
  const el = h(`
    <div class="widget w-quote">
      <div class="glass" title="Клик — другая цитата">
        <div class="q-mark">“</div>
        <div class="q-text"></div>
        <div class="q-who muted"></div>
      </div>
    </div>`);
  const dayIndex = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60e3) / 864e5) % QUOTES.length;
  let i = dayIndex();
  const paint = () => {
    $(el, ".q-text").textContent = QUOTES[i][0];
    $(el, ".q-who").textContent = "— " + QUOTES[i][1];
  };
  $(el, ".glass").addEventListener("click", () => {
    i = (i + 1 + Math.floor(Math.random() * (QUOTES.length - 1))) % QUOTES.length;
    paint();
  });
  return { el, update: (k) => k === "init" && paint() };
}

// ── Photo frame ────────────────────────────────────────────────────────────

export function photoWidget(ctx) {
  // Slides are backgrounds, not <img>: an image would start the browser's
  // own file drag instead of moving the widget.
  const el = h(`
    <div class="widget w-photo empty">
      <div class="glass">
        <div class="slide a"><i class="bg"></i><i class="pic"></i></div>
        <div class="slide b"><i class="bg"></i><i class="pic"></i></div>
        <div class="pick">
          <button class="pill" data-pick="image">${icons.folder}Фото</button>
          <button class="pill" data-pick="folder">${icons.folder}Папка</button>
        </div>
      </div>
    </div>`);
  let list = [];
  let idx = 0;
  let front = "a";
  let source = null;
  let since = 0;
  let busy = false;
  let current = "";
  let listedAt = 0;

  // Shuffled so a big folder doesn't always start with the same pictures.
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  async function load() {
    source = ctx.s.photoFolder;
    listedAt = Date.now();
    list = source ? shuffle(await window.cozy.photosList()) : [];
    idx = 0;
    current = "";
    el.classList.toggle("empty", !list.length);
    el.querySelectorAll(".slide").forEach((x) => x.classList.remove("on"));
    show();
  }
  /**
   * The folder read again (every few seconds): added pictures come next,
   * removed ones drop out — and go off the screen if one was showing.
   */
  async function refresh() {
    listedAt = Date.now();
    const wanted = source;
    const fresh = wanted ? await window.cozy.photosList() : [];
    if (wanted !== source) return;
    const now = new Set(fresh);
    const had = new Set(list);
    if (fresh.length === list.length && fresh.every((u) => had.has(u))) return;
    const at = list.length ? idx % list.length : 0;
    const added = shuffle(fresh.filter((u) => !had.has(u)));
    list = [...added, ...list.slice(at), ...list.slice(0, at)].filter((u) => now.has(u));
    idx = 0;
    el.classList.toggle("empty", !list.length);
    if (!list.length) {
      current = "";
      el.querySelectorAll(".slide").forEach((x) => x.classList.remove("on"));
    } else if (!current || !now.has(current) || added.length) show();
  }
  /** Next picture, faded in once it's decoded; a broken file is skipped. */
  async function show() {
    if (!list.length || busy) return;
    busy = true;
    since = Date.now();
    for (let tries = 0; tries < Math.min(list.length, 5); tries++) {
      const url = list[idx++ % list.length];
      const probe = new Image();
      probe.src = url;
      try {
        await probe.decode();
      } catch {
        continue;
      }
      const back = front === "a" ? "b" : "a";
      const slide = $(el, "." + back);
      // cssUrl: a file named `pic).jpg` must not end the url() early.
      const css = cssUrl(url);
      slide.querySelector(".bg").style.backgroundImage = css;
      slide.querySelector(".pic").style.backgroundImage = css;
      slide.classList.add("on");
      $(el, "." + front).classList.remove("on");
      front = back;
      current = url;
      break;
    }
    busy = false;
  }
  el.querySelectorAll("[data-pick]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const p = await window.cozy.pickFile(b.dataset.pick);
      // The same folder again: no settings change, so read it here.
      if (p && p === source) refresh();
      else if (p) ctx.save({ photoFolder: p });
    };
  });
  $(el, ".glass").addEventListener("click", () => list.length > 1 && show());
  return {
    el,
    update(kind) {
      if (kind === "init" || kind === "settings") {
        el.dataset.shape = ctx.s.photoShape || "rounded";
        el.dataset.fit = ctx.s.photoFit || "contain";
      }
      if (kind === "init" || (kind === "settings" && ctx.s.photoFolder !== source)) load();
      if (kind === "tick" && source && Date.now() - listedAt > 5000) refresh();
      if (kind === "tick" && list.length > 1 && Date.now() - since > 20000) show();
    },
  };
}

// ── Web search ─────────────────────────────────────────────────────────────

export const ENGINES = {
  google: ["Google", "https://www.google.com/search?q="],
  yandex: ["Яндекс", "https://yandex.ru/search/?text="],
  duckduckgo: ["DuckDuckGo", "https://duckduckgo.com/?q="],
  bing: ["Bing", "https://www.bing.com/search?q="],
};

export function searchWidget(ctx) {
  const el = h(`
    <div class="widget w-search" data-focus>
      <div class="glass">
        <span class="s-icon">${icons.search}</span>
        <input type="text" placeholder="Поиск" />
        <button class="engine" title="Сменить поисковик"></button>
      </div>
    </div>`);
  const input = $(el, "input");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const [, url] = ENGINES[ctx.s.searchEngine] || ENGINES.google;
    window.cozy.openExternal(url + encodeURIComponent(input.value.trim()));
    input.value = "";
    input.blur();
  });
  $(el, ".engine").onclick = () => {
    const keys = Object.keys(ENGINES);
    ctx.save({ searchEngine: keys[(keys.indexOf(ctx.s.searchEngine) + 1) % keys.length] });
  };
  return {
    el,
    update(kind) {
      if (kind === "init" || kind === "settings") $(el, ".engine").textContent = (ENGINES[ctx.s.searchEngine] || ENGINES.google)[0];
    },
  };
}

// ── Image converter ────────────────────────────────────────────────────────

const OUT = ["png", "jpg", "webp", "bmp", "ico", "pdf"];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("не картинка"));
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((r) => canvas.toBlob(r, type, quality));
}

/** 32-bit BMP (BGRA, bottom-up). */
function encodeBmp(ctx2d, w, hgt) {
  const px = ctx2d.getImageData(0, 0, w, hgt).data;
  const size = 54 + w * hgt * 4;
  const b = new DataView(new ArrayBuffer(size));
  b.setUint16(0, 0x4d42, true);
  b.setUint32(2, size, true);
  b.setUint32(10, 54, true);
  b.setUint32(14, 40, true);
  b.setInt32(18, w, true);
  b.setInt32(22, hgt, true);
  b.setUint16(26, 1, true);
  b.setUint16(28, 32, true);
  b.setUint32(34, w * hgt * 4, true);
  let o = 54;
  for (let y = hgt - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      b.setUint8(o++, px[i + 2]);
      b.setUint8(o++, px[i + 1]);
      b.setUint8(o++, px[i]);
      b.setUint8(o++, px[i + 3]);
    }
  }
  return b.buffer;
}

/** ICO holding one PNG (Windows Vista+ reads these). */
async function encodeIco(img) {
  const s = Math.min(256, Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const k = s / Math.max(img.naturalWidth, img.naturalHeight);
  const w = img.naturalWidth * k;
  const hh = img.naturalHeight * k;
  c.getContext("2d").drawImage(img, (s - w) / 2, (s - hh) / 2, w, hh);
  const png = new Uint8Array(await (await toBlob(c, "image/png")).arrayBuffer());
  const head = new DataView(new ArrayBuffer(22));
  head.setUint16(2, 1, true); // type: icon
  head.setUint16(4, 1, true); // one image
  head.setUint8(6, s === 256 ? 0 : s);
  head.setUint8(7, s === 256 ? 0 : s);
  head.setUint16(10, 1, true);
  head.setUint16(12, 32, true);
  head.setUint32(14, png.length, true);
  head.setUint32(18, 22, true);
  const out = new Uint8Array(22 + png.length);
  out.set(new Uint8Array(head.buffer), 0);
  out.set(png, 22);
  return out.buffer;
}

async function convertOne(src, fmt) {
  if (fmt === "pdf") return window.cozy.convertPdf(src);
  const img = await loadImage(await window.cozy.fileUrl(src));
  if (fmt === "ico") return window.cozy.convertSave(src, "ico", await encodeIco(img));
  const w = img.naturalWidth || 1024;
  const hgt = img.naturalHeight || 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  const g = c.getContext("2d");
  if (fmt === "jpg" || fmt === "bmp") {
    // No transparency in JPG: put it on white instead of black.
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, hgt);
  }
  g.drawImage(img, 0, 0, w, hgt);
  const data =
    fmt === "bmp"
      ? encodeBmp(g, w, hgt)
      : await (await toBlob(c, { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[fmt], 0.92)).arrayBuffer();
  return window.cozy.convertSave(src, fmt, data);
}

export function converterWidget() {
  const el = h(`
    <div class="widget w-convert">
      <div class="glass">
        <div class="fmt-list">${OUT.map((f) => `<button data-f="${f}">${f.toUpperCase()}</button>`).join("")}</div>
        <div class="drop">
          ${icons.image}
          <span class="d-text"></span>
        </div>
        <div class="c-results"></div>
      </div>
    </div>`);
  let fmt = localStorage.getItem("convert.fmt") || "webp";
  const results = [];
  const paintFmt = () => {
    el.querySelectorAll(".fmt-list button").forEach((b) => b.classList.toggle("on", b.dataset.f === fmt));
    $(el, ".d-text").innerHTML = `Перетащи картинки сюда<br>или нажми, чтобы выбрать<br><b>→ ${fmt.toUpperCase()}</b>`;
  };
  const paintResults = () => {
    $(el, ".c-results").innerHTML = results
      .slice(0, 4)
      .map((r) =>
        r.error
          ? `<div class="c-row err"><span class="ellipsis">${esc(r.name)}</span><small>${esc(r.error)}</small></div>`
          : `<button class="c-row" data-p="${esc(r.path)}"><span class="ellipsis">${esc(r.name)}</span><small>показать</small></button>`
      )
      .join("");
  };
  $(el, ".fmt-list").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    fmt = b.dataset.f;
    localStorage.setItem("convert.fmt", fmt);
    paintFmt();
  };
  $(el, ".c-results").onclick = (e) => {
    const b = e.target.closest("[data-p]");
    if (b) window.cozy.convertReveal(b.dataset.p);
  };

  async function run(paths) {
    if (!paths.length) return;
    el.classList.add("busy");
    $(el, ".d-text").textContent = `Конвертирую ${paths.length} ${plural(paths.length, "файл", "файла", "файлов")}…`;
    for (const p of paths) {
      try {
        const out = await convertOne(p, fmt);
        if (!out) throw new Error("не удалось");
        results.unshift({ path: out, name: out.split(/[\\/]/).pop() });
      } catch (err) {
        results.unshift({ error: err.message, name: p.split(/[\\/]/).pop() });
      }
    }
    el.classList.remove("busy");
    paintFmt();
    paintResults();
  }

  const drop = $(el, ".drop");
  drop.onclick = async () => run(await window.cozy.pickFile("convert"));
  el.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  el.addEventListener("dragleave", () => drop.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    run([...e.dataTransfer.files].map((f) => window.cozy.pathForFile(f)).filter(Boolean));
  });
  paintFmt();
  return { el };
}
