// node --test: psbridge queue survival. A fake spawn (same process contract)
// replaces PowerShell; no real process is started.
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { startBridge, startPsBridge } = require("../src/main/psbridge");

/** A child process double: controllable stdin, real readline-able stdout. */
function fakeProc({ writable = true } = {}) {
  const proc = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.writable = writable;
  stdin.destroyed = false;
  stdin.written = [];
  stdin.write = (chunk) => {
    stdin.written.push(chunk);
    return true;
  };
  stdin.end = () => {};
  proc.stdin = stdin;
  proc.stdout = new PassThrough();
  proc.kill = () => {};
  return proc;
}

function states() {
  const got = [];
  return { got, onState: (s) => got.push(s) };
}

test("lines from the helper arrive as JSON state objects", async () => {
  const s = states();
  const proc = fakeProc();
  const bridge = startPsBridge("x.ps1", s.onState, () => proc);
  proc.stdout.write('{"active":true}\n');
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(s.got, [{ active: true }]);
  bridge.stop();
});

test("commands sent before launch wait for a writable helper", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = states();
  const dead = fakeProc({ writable: false }); // died before its stdin opened up
  const live = fakeProc();
  const procs = [dead, live];
  const bridge = startPsBridge("x.ps1", s.onState, () => procs.shift());
  bridge.send("net 1");
  bridge.send("volstep 5");
  bridge.send("volstep 3"); // relative steps add up while queued
  assert.deepStrictEqual(dead.stdin.written, []); // nothing written into the dead pipe
  // Relaunch (the restart backoff fires): every queued command goes out once,
  // the two volsteps as one summed step — no double-apply.
  dead.emit("exit");
  t.mock.timers.tick(2000);
  assert.deepStrictEqual(live.stdin.written, ["net 1\n", "volstep 8\n"]);
  bridge.stop();
});

test("commands already handed to the pipe are never replayed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = states();
  const first = fakeProc(); // gets the command, then dies
  const second = fakeProc();
  const procs = [first, second];
  const bridge = startPsBridge("x.ps1", s.onState, () => procs.shift());
  bridge.send("volstep 5"); // handed over: written and out of the queue
  assert.deepStrictEqual(first.stdin.written, ["volstep 5\n"]);
  first.emit("exit");
  t.mock.timers.tick(2000);
  // The relaunch must not re-apply what the first helper already received.
  assert.deepStrictEqual(second.stdin.written, []);
  bridge.stop();
});

test("the latest of a kind wins for non-relative commands", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = states();
  const dead = fakeProc({ writable: false });
  const live = fakeProc();
  const procs = [dead, live];
  const bridge = startPsBridge("x.ps1", s.onState, () => procs.shift());
  bridge.send("net 1");
  bridge.send("net 0"); // supersedes "net 1": only the latest matters
  dead.emit("exit");
  t.mock.timers.tick(2000);
  assert.deepStrictEqual(live.stdin.written, ["net 0\n"]);
  bridge.stop();
});

test("a native helper that keeps dying silently hands over to the fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = states();
  const spawned = [];
  const spawnFn = (file) => {
    const proc = fakeProc();
    spawned.push({ file, proc });
    return proc;
  };
  const fallback = { file: "powershell.exe", args: ["-File", "status.ps1"] };
  const bridge = startBridge({ file: "haze-sys.exe", args: ["status"] }, s.onState, spawnFn, fallback);
  // Two silent deaths are retried with the same helper (after the backoff)...
  spawned.at(-1).proc.emit("exit");
  t.mock.timers.tick(2000);
  spawned.at(-1).proc.emit("exit");
  t.mock.timers.tick(4000);
  assert.deepStrictEqual(spawned.map((x) => x.file), ["haze-sys.exe", "haze-sys.exe", "haze-sys.exe"]);
  // ...the third one switches to the fallback at once.
  spawned.at(-1).proc.emit("exit");
  assert.strictEqual(spawned.at(-1).file, "powershell.exe");
  bridge.stop();
});

test("a native helper that has spoken is never swapped for the fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = states();
  const spawned = [];
  const spawnFn = (file) => {
    const proc = fakeProc();
    spawned.push({ file, proc });
    return proc;
  };
  const fallback = { file: "powershell.exe", args: ["-File", "status.ps1"] };
  const bridge = startBridge({ file: "haze-sys.exe", args: ["status"] }, s.onState, spawnFn, fallback);
  for (let i = 0; i < 4; i++) {
    const { proc } = spawned.at(-1);
    proc.stdout.write("{}\n");
    await new Promise((r) => setImmediate(r));
    proc.emit("exit");
    t.mock.timers.tick(2000);
  }
  assert.ok(spawned.every((x) => x.file === "haze-sys.exe"));
  bridge.stop();
});
