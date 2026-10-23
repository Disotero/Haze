// Everyday widgets: analog clock, calendar, notes, to-do, pomodoro, network,
// quote of the day, photo frame, web search and the image converter.
// Each factory takes ctx { s (settings), save(patch), openPanel() } and
// returns { el, update?(kind, payload), destroy?() }.
import { h, $, esc, pad, uid, plural, sparkline } from "./dom.js";
import { icons } from "./icons.js";
import { mountCalendar } from "./calendar.js";
import { chime } from "./sound.js";

// ── Classic clock ──────────────────────────────────────────────────────────

export function analogWidget() {
  // Minute dots, with short bars at the hours and numerals at 12/3/6/9.
  const marks = Array.from({ length: 60 }, (_, i) => {
    if (i % 15 === 0) return "";
    return i % 5 === 0
      ? `<line x1="50" y1="9" x2="50" y2="13.5" class="hour" transform="rotate(${i * 6} 50 50)"/>`
      : `<circle cx="50" cy="9.6" r=".55" class="min" transform="rotate(${i * 6} 50 50)"/>`;
  }).join("");
  const nums = [
    [12, 50, 18.5],
    [3, 83, 53.5],
    [6, 50, 88],
    [9, 17, 53.5],
  ]
    .map(([n, x, y]) => `<text x="${x}" y="${y}">${n}</text>`)
    .join("");
  const el = h(`
    <div class="widget w-analog">
      <div class="glass">
        <svg viewBox="0 0 100 100" class="face">
          <circle cx="50" cy="50" r="46" class="rim"/>
          <g class="marks">${marks}</g>
          <g class="nums">${nums}</g>
          <line class="hh" x1="50" y1="53" x2="50" y2="29"/>
          <line class="mm" x1="50" y1="54" x2="50" y2="17"/>
          <g class="sec"><line x1="50" y1="60" x2="50" y2="14"/><circle cx="50" cy="60" r="1.6"/></g>
          <circle cx="50" cy="50" r="2.6" class="pin"/>
        </svg>
      </div>
    </div>`);
  function update(kind) {
    if (kind !== "tick" && kind !== "init") return;
    const d = new Date();
    const sec = d.getSeconds();
    const m = d.getMinutes() + sec / 60;
    const hr = (d.getHours() % 12) + m / 60;
    $(el, ".hh").setAttribute("transform", `rotate(${hr * 30} 50 50)`);
    $(el, ".mm").setAttribute("transform", `rotate(${m * 6} 50 50)`);
    $(el, ".sec").setAttribute("transform", `rotate(${sec * 6} 50 50)`);
  }
  return { el, update };
}

// ── Calendar ───────────────────────────────────────────────────────────────

export function calendarWidget(ctx) {
  const el = h(`
    <div class="widget w-calendar">
      <div class="glass">
        <div class="cal"></div>
        <button class="pill wide open-panel">${icons.bell}Будильники и таймер</button>
      </div>
    </div>`);
  const cal = mountCalendar($(el, ".cal"), ctx);
  // The widget is the calendar already: the panel only adds alarms and the timer.
  $(el, ".open-panel").onclick = () => ctx.openPanel(el, { calendar: false });
  let day = new Date().getDate();
  return {
    el,
    update(kind) {
      // Roll over at midnight.
      if (kind === "tick" && new Date().getDate() !== day) {
        day = new Date().getDate();
        cal.refresh();
      }
      if (kind === "settings") cal.refresh(); // notes changed elsewhere
    },
  };
}

// ── Notes ──────────────────────────────────────────────────────────────────

export function notesWidget(ctx) {
  const el = h(`
    <div class="widget w-notes" data-focus>
      <div class="glass">
        <div class="w-title">Заметка <span class="muted saved"></span></div>
        <textarea spellcheck="false" placeholder="Пиши что угодно — сохраняется само…"></textarea>
      </div>
    </div>`);
  const ta = $(el, "textarea");
  let timer = 0;
  ta.addEventListener("input", () => {
    clearTimeout(timer);
    $(el, ".saved").textContent = "…";
    timer = setTimeout(async () => {
      await ctx.save({ notes: ta.value });
      $(el, ".saved").textContent = "сохранено";
    }, 600);
  });
  return {
    el,
    update(kind) {
      if ((kind === "init" || kind === "settings") && document.activeElement !== ta) ta.value = ctx.s.notes;
    },
  };
}

// ── To-do ──────────────────────────────────────────────────────────────────

export function todoWidget(ctx) {
  const el = h(`
    <div class="widget w-todo">
      <div class="glass">
        <div class="w-title">Список дел <span class="muted count"></span></div>
        <div class="todo-list"></div>
        <div class="todo-add"><input type="text" placeholder="Новое дело и Enter" /></div>
      </div>
    </div>`);
  const input = $(el, "input");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    ctx.save({ todos: [...ctx.s.todos, { id: uid(), text: input.value.trim(), done: false }] });
    input.value = "";
  });
  $(el, ".todo-list").onclick = (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".t-del")) ctx.save({ todos: ctx.s.todos.filter((t) => t.id !== id) });
    else ctx.save({ todos: ctx.s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) });
  };
  function update(kind) {
    if (kind !== "init" && kind !== "settings") return;
    const todos = ctx.s.todos;
    const open = todos.filter((t) => !t.done).length;
    $(el, ".count").textContent = todos.length ? `${open} из ${todos.length}` : "";
    // Open items first, done ones sink to the bottom.
    const sorted = [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)];
    $(el, ".todo-list").innerHTML = sorted.length
      ? sorted
          .map(
            (t) => `<div class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
              <span class="box">${t.done ? icons.check : ""}</span>
              <span class="grow">${esc(t.text)}</span>
              <button class="t-del" title="Удалить">${icons.close}</button>
            </div>`
          )
          .join("")
      : `<div class="muted empty">Пусто — можно отдыхать</div>`;
  }
  return { el, update };
}

// ── Pomodoro ───────────────────────────────────────────────────────────────

const POMO = { focus: [25, "Фокус"], short: [5, "Перерыв"], long: [15, "Длинный"] };

export function pomodoroWidget() {
  const el = h(`
    <div class="widget w-pomodoro">
      <div class="glass">
        <div class="seg modes">${Object.entries(POMO).map(([k, [, n]]) => `<button data-m="${k}">${n}</button>`).join("")}</div>
        <div class="pomo-body">
          <svg viewBox="0 0 120 120" class="pomo-ring"><circle cx="60" cy="60" r="52" class="track"/><circle cx="60" cy="60" r="52" class="fill"/></svg>
          <div class="pomo-time num"></div>
        </div>
        <div class="row center">
          <button class="icon-btn reset" title="Сначала">${icons.reset}</button>
          <button class="icon-btn play big" title="Старт/пауза"></button>
          <span class="muted done-count"></span>
        </div>
      </div>
    </div>`);
  let mode = "focus";
  let total = POMO.focus[0] * 60e3;
  let left = total;
  let endsAt = 0; // running when > 0
  let rounds = 0;
  let fast = 0; // 250 ms timer while running
  const C = 2 * Math.PI * 52;

  function setMode(m) {
    mode = m;
    total = left = POMO[m][0] * 60e3;
    endsAt = 0;
    clearInterval(fast);
    paint();
  }
  function paint() {
    const ms = endsAt ? Math.max(0, endsAt - Date.now()) : left;
    const sec = Math.ceil(ms / 1000);
    $(el, ".pomo-time").textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    $(el, ".fill").style.strokeDasharray = `${(C * ms) / total} ${C}`;
    $(el, ".play").innerHTML = endsAt ? icons.pause : icons.play;
    el.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
    $(el, ".done-count").textContent = rounds ? `🍅 ${rounds}` : "";
    el.classList.toggle("running", Boolean(endsAt));
  }
  $(el, ".modes").onclick = (e) => e.target.closest("[data-m]") && setMode(e.target.closest("[data-m]").dataset.m);
  const run = (on) => {
    clearInterval(fast);
    // Smooth, immediate countdown while running (the shared tick is 1 s).
    if (on) fast = setInterval(() => update("tick"), 250);
  };
  $(el, ".play").onclick = () => {
    if (endsAt) {
      left = Math.max(0, endsAt - Date.now());
      endsAt = 0;
    } else endsAt = Date.now() + left;
    run(Boolean(endsAt));
    paint();
  };
  $(el, ".reset").onclick = () => setMode(mode);

  function update(kind) {
    if (kind === "init") return paint();
    if (kind !== "tick" || !endsAt) return;
    if (Date.now() >= endsAt) {
      chime();
      if (mode === "focus") {
        rounds++;
        window.cozy.notify("Помидор готов 🍅", "Время сделать перерыв");
        setMode(rounds % 4 === 0 ? "long" : "short");
      } else {
        window.cozy.notify("Перерыв окончен", "Снова за дело");
        setMode("focus");
      }
      return;
    }
    paint();
  }
  return { el, update, destroy: () => clearInterval(fast) };
}

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
  const el = h(`
    <div class="widget w-photo">
      <div class="glass">
        <img class="a" alt="" /><img class="b" alt="" />
        <button class="pill pick">${icons.folder}Выбрать папку с фото</button>
      </div>
    </div>`);
  let list = [];
  let idx = 0;
  let front = "a";
  let folder = null;
  let since = 0;

  async function load() {
    folder = ctx.s.photoFolder;
    list = folder ? await window.cozy.photosList() : [];
    // Shuffle so a big folder doesn't always start with the same pictures.
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    idx = 0;
    $(el, ".pick").hidden = list.length > 0;
    el.classList.toggle("empty", !list.length);
    show();
  }
  function show() {
    if (!list.length) return;
    const back = front === "a" ? "b" : "a";
    const img = $(el, "." + back);
    img.onload = () => {
      img.classList.add("on");
      $(el, "." + front).classList.remove("on");
      front = back;
    };
    img.src = list[idx % list.length];
    idx++;
    since = Date.now();
  }
  $(el, ".pick").onclick = async (e) => {
    e.stopPropagation();
    const dir = await window.cozy.pickFile("folder");
    if (dir) ctx.save({ photoFolder: dir });
  };
  $(el, ".glass").addEventListener("click", () => list.length && show());
  return {
    el,
    update(kind) {
      if (kind === "init" || (kind === "settings" && ctx.s.photoFolder !== folder)) load();
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
