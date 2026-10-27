// node --test: settings merge, shape checks, and what happens to a bad file.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haze-test-"));
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return { app: { getPath: () => dir } };
  return load.call(this, request, ...rest);
};
const settings = require("../src/main/settings");
const logs = [];
settings.setLogger((kind, e) => logs.push(`${kind}: ${e?.message || e}`));
const file = path.join(dir, "settings.json");

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("merge never writes to a prototype", () => {
  const out = settings.merge(settings.DEFAULTS, JSON.parse('{"__proto__":{"x":1},"wallpaper":{"type":"shader"},"layout":{"constructor":{"x":1,"y":1}}}'));
  assert.strictEqual(Object.getPrototypeOf(out), Object.prototype);
  assert.strictEqual({}.x, undefined);
  assert.strictEqual(out.wallpaper.type, "shader");
  assert.ok(!Object.hasOwn(out.layout, "constructor"));
});

test("merge keeps deep defaults and replaces arrays", () => {
  const out = settings.merge(settings.DEFAULTS, { weather: { city: "Казань" }, alarms: [{ time: "07:00" }] });
  assert.strictEqual(out.weather.city, "Казань");
  assert.strictEqual(out.weather.lat, settings.DEFAULTS.weather.lat);
  assert.strictEqual(out.alarms.length, 1);
});

test("malformed arrays and maps are coerced, not crashed on", () => {
  fs.writeFileSync(
    file,
    JSON.stringify({
      dock: { pinned: [null, "chrome.exe", { path: "a.exe" }] },
      alarms: [null, "x", { time: "07:30", days: [1, "2", 9] }],
      launchers: { main: {}, bad: "x" },
      audioViz: "nope",
      layout: { a: { x: null, y: 1 }, b: { x: 0.1, y: 0.2 } },
      sizes: { a: { w: null }, b: { w: 300 } },
    })
  );
  const s = settings.load();
  assert.deepStrictEqual(s.dock.pinned.map((p) => p.path), ["chrome.exe", "a.exe"]);
  assert.strictEqual(s.alarms.length, 1);
  assert.deepStrictEqual(s.alarms[0].days, [1]);
  assert.deepStrictEqual(s.launchers, { main: { title: "", apps: [] } });
  assert.deepStrictEqual(s.audioViz, settings.DEFAULTS.audioViz);
  assert.deepStrictEqual(Object.keys(s.layout), ["b"]);
  assert.deepStrictEqual(s.sizes, { b: { w: 300 } });
});

test("a corrupt settings.json is kept aside, and the backup is used", () => {
  settings.update({ notes: "keep me" }); // writes settings.json
  settings.update({ notes: "keep me too" }); // …and settings.json.bak with "keep me"
  fs.writeFileSync(file, "{invalid json");
  const s = settings.load();
  assert.strictEqual(s.notes, "keep me");
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("settings.json.corrupt-")));
  assert.ok(logs.some((l) => l.includes("not valid JSON")));
});

test("a failed save leaves memory and disk as they were", () => {
  settings.update({ notes: "good" });
  fs.mkdirSync(file + ".tmp"); // opening the temp file now fails
  try {
    const after = settings.update({ notes: "bad" });
    assert.strictEqual(after.notes, "good");
    assert.ok(settings.lastError());
    assert.strictEqual(JSON.parse(fs.readFileSync(file, "utf8")).notes, "good");
  } finally {
    fs.rmdirSync(file + ".tmp");
  }
  settings.update({ notes: "ok again" });
  assert.strictEqual(settings.lastError(), null);
});

test("a BOM in front of the JSON is fine", () => {
  fs.writeFileSync(file, "﻿" + JSON.stringify({ notes: "bom" }));
  assert.strictEqual(settings.load().notes, "bom");
});
