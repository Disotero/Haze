// node --test: pure renderer helpers (no DOM needed).
import test from "node:test";
import assert from "node:assert";
import { cssUrl, imageUrl, retry } from "../src/renderer/shared/util.js";
import { relTime, esc, plural } from "../src/renderer/widgets/dom.js";

test("cssUrl can't be broken out of", () => {
  assert.strictEqual(cssUrl("file:///C:/pics/pic).jpg"), 'url("file:///C:/pics/pic%29.jpg")');
  assert.strictEqual(cssUrl('data:image/png;base64,AA"),url(x'), 'url("data:image/png;base64,AA%22%29,url%28x")');
  assert.strictEqual(cssUrl("file:///C:/a'b c.png"), 'url("file:///C:/a%27b%20c.png")');
  assert.strictEqual(cssUrl("javascript:alert(1)"), "");
  assert.strictEqual(cssUrl(""), "");
  assert.strictEqual(imageUrl("data:text/html,x"), "");
});

test("relTime says — for unknown dates", () => {
  assert.strictEqual(relTime(NaN), "—");
  assert.strictEqual(relTime(0), "—");
  assert.strictEqual(relTime(undefined), "—");
  const now = Date.now();
  assert.strictEqual(relTime(now + 5 * 60e3, now), "через 5 мин");
  assert.strictEqual(relTime(now - 2 * 3600e3, now), "2 ч назад");
});

test("esc and plural", () => {
  assert.strictEqual(esc(`<a href="x">'&`), "&#60;a href=&#34;x&#34;&#62;&#39;&#38;");
  assert.strictEqual(plural(1, "файл", "файла", "файлов"), "файл");
  assert.strictEqual(plural(3, "файл", "файла", "файлов"), "файла");
  assert.strictEqual(plural(11, "файл", "файла", "файлов"), "файлов");
});

test("retry gives the fallback after the last failure", async () => {
  let n = 0;
  const v = await retry(() => (++n < 2 ? Promise.reject(new Error("x")) : "ok"), "fb", { delay: 1 });
  assert.strictEqual(v, "ok");
  assert.strictEqual(await retry(() => Promise.reject(new Error("x")), "fb", { tries: 2, delay: 1 }), "fb");
});
