// node --test: IPC-boundary validators (menu templates, rects). Pure CommonJS.
const test = require("node:test");
const assert = require("node:assert");
const { checkMenuTemplate, sanitizeRect, sanitizeRects, MENU_MAX_DEPTH, MENU_MAX_ITEMS } = require("../src/main/validate");

test("menu: valid template passes through with types and ids", () => {
  const picked = [];
  const out = checkMenuTemplate(
    [
      { id: "open", label: "Открыть" },
      { type: "separator" },
      { id: "lock", label: "Закрепить", checked: true },
      { id: "radio", label: "Радио", radio: true, checked: false },
      { id: "sub", label: "Ещё", submenu: [{ id: "inner", label: "Внутри" }] },
    ],
    (id) => picked.push(id)
  );
  assert.strictEqual(out[0].label, "Открыть");
  assert.strictEqual(out[0].type, "normal");
  assert.strictEqual(out[1].type, "separator");
  assert.strictEqual(out[2].type, "checkbox");
  assert.strictEqual(out[2].checked, true);
  assert.strictEqual(out[3].type, "radio");
  assert.strictEqual(out[4].submenu[0].label, "Внутри");
  out[0].click();
  out[2].click();
  out[4].submenu[0].click();
  assert.deepStrictEqual(picked, ["open", "lock", "inner"]);
});

test("menu: long labels are cut, missing labels become empty", () => {
  const out = checkMenuTemplate([{ id: 1, label: "ж".repeat(500) }, { id: 2 }]);
  assert.strictEqual(out[0].label.length, 200);
  assert.strictEqual(out[1].label, "");
});

test("menu: unknown fields (role, accelerator) are dropped", () => {
  const out = checkMenuTemplate([{ id: 1, label: "x", role: "quit", accelerator: "Ctrl+Q", evil: {} }]);
  assert.deepStrictEqual(Object.keys(out[0]), ["label", "type", "checked", "click"]);
});

test("menu: junk shapes are rejected, not crashed on", () => {
  assert.throws(() => checkMenuTemplate("not an array"), /array/);
  assert.throws(() => checkMenuTemplate([null]), /plain object/);
  assert.throws(() => checkMenuTemplate([42]), /plain object/);
  assert.throws(() => checkMenuTemplate([{ label: { deep: 1 } }]), /label/);
  assert.throws(() => checkMenuTemplate([{ label: "x", submenu: "nope" }]), /submenu/);
});

test("menu: a cyclic submenu is rejected (no infinite recursion)", () => {
  const cyc = { label: "loop", submenu: [] };
  cyc.submenu.push(cyc);
  assert.throws(() => checkMenuTemplate([cyc]), /deeper|items/);
});

test("menu: depth and size caps", () => {
  const deep = { label: "0", submenu: [{ label: "1", submenu: [{ label: "2", submenu: [{ label: "3" }] }] }] };
  assert.throws(() => checkMenuTemplate([deep]), new RegExp(`deeper than ${MENU_MAX_DEPTH}`));
  const many = Array.from({ length: MENU_MAX_ITEMS + 1 }, (_, i) => ({ id: i, label: `x${i}` }));
  assert.throws(() => checkMenuTemplate(many), new RegExp(`more than ${MENU_MAX_ITEMS}`));
});

test("sanitizeRect: finite numbers only, rounded and clamped", () => {
  const b = { w: 1000, h: 500 };
  assert.deepStrictEqual(sanitizeRect({ x: 10.4, y: -5, width: 400, height: 300 }, b), { x: 10, y: 0, width: 400, height: 300 });
  assert.deepStrictEqual(sanitizeRect({ x: 2000, y: 600, width: 400, height: 300 }, b), { x: 1000, y: 500, width: 400, height: 300 });
  assert.strictEqual(sanitizeRect({ x: NaN, y: 1, width: 2, height: 3 }, b), null);
  assert.strictEqual(sanitizeRect({ x: 1, y: "2", width: 2, height: 3 }, b), null);
  assert.strictEqual(sanitizeRect(null, b), null);
  assert.strictEqual(sanitizeRect([1, 2, 3, 4], b), null);
});

test("sanitizeRects: bad entries are dropped and counted, radius stays sub-pixel", () => {
  const b = { w: 800, h: 600 };
  const { rects, dropped } = sanitizeRects(
    [
      { x: 1, y: 2, w: 300.6, h: 200, r: 26.4 },
      { x: NaN, y: 2, w: 3, h: 4 },
      "junk",
      { x: -10, y: 2, w: 3, h: 4 },
    ],
    b
  );
  assert.strictEqual(dropped, 2);
  assert.deepStrictEqual(rects, [
    { x: 1, y: 2, w: 301, h: 200, r: 26.4 },
    { x: 0, y: 2, w: 3, h: 4, r: 0 },
  ]);
  assert.throws(() => sanitizeRects({ x: 1 }, b), /array/);
});
