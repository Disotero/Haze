// Runs a long-lived helper — the native haze-sys.exe when it ships with the
// app, otherwise a PowerShell script — that prints one JSON object per line
// on stdout and reads commands line by line from stdin.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { toolPath } = require("./runtool");

/** Scripts haze-sys.exe can stand in for (its mode = the script's name). */
const NATIVE_MODES = new Set(["status", "media"]);
/** A native helper that dies this many times in a row without a single line goes back to PowerShell. */
const NATIVE_STRIKES = 3;

// A packaged build gets the exe through electron-builder's extraResources;
// in dev it is the crate's cargo output inside the app folder.
function findHazeSys() {
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, "haze-sys.exe"),
    path.join(__dirname, "..", "..", "native", "haze-sys", "target", "release", "haze-sys.exe"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

function psHelper(script) {
  return {
    file: toolPath("powershell"),
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
  };
}

/**
 * Commands sent while the helper is (re)starting wait for it. Only the latest
 * of each kind matters — `net 1` then `net 0` is just `net 0` — so the queue
 * keeps one per command word and never grows. `spawnFn` stands in for
 * `spawn` in tests (same signature, same process contract). `fallback` is
 * the helper to switch to once the first one keeps dying silently.
 */
function startBridge(helper, onState, spawnFn = spawn, fallback = null) {
  let child = null;
  let stopped = false;
  let lastJson = "";
  let restartDelay = 2000;
  let strikes = 0;
  let spoke = false;
  const pending = new Map(); // command word → full line

  function flush() {
    // Only entries that actually went into the pipe leave the queue: if the
    // helper died before its stdin was writable, they wait for the relaunch
    // instead of vanishing (volstep sums keep adding up on top of them).
    for (const [word, line] of pending) if (write(line)) pending.delete(word);
  }

  function write(line) {
    if (!child || !child.stdin || child.stdin.destroyed || !child.stdin.writable) return false;
    try {
      child.stdin.write(line + "\n");
      return true;
    } catch {
      return false;
    }
  }

  function exited(proc) {
    if (child !== proc) return; // 'error' and 'exit' can both arrive
    child = null;
    if (stopped) return;
    strikes = spoke ? 0 : strikes + 1;
    if (fallback && strikes >= NATIVE_STRIKES) {
      console.error("[psbridge]", path.basename(helper.file), "keeps failing, back to", path.basename(fallback.args.at(-1)));
      helper = fallback;
      fallback = null;
      restartDelay = 2000;
      return launch();
    }
    setTimeout(launch, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 60000);
  }

  function launch() {
    if (stopped) return;
    spoke = false;
    let proc;
    try {
      proc = spawnFn(helper.file, helper.args, { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    } catch (e) {
      console.error("[psbridge] spawn failed:", e.message);
      child = proc = {};
      return exited(proc);
    }
    child = proc;
    // A dead pipe (the helper crashed mid-write) must not become an uncaught EPIPE.
    proc.stdin.on("error", () => {});
    proc.on("error", (e) => {
      console.error("[psbridge]", helper.file, e.message);
      exited(proc);
    });
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.startsWith("{")) return;
      spoke = true;
      if (line === lastJson) return;
      lastJson = line;
      restartDelay = 2000;
      try {
        onState(JSON.parse(line));
      } catch {
        // Partial or malformed line: wait for the next tick.
      }
    });
    proc.on("exit", () => exited(proc));
    flush();
  }

  launch();

  return {
    send(line) {
      if (write(line)) return;
      // Relative volume steps add up; anything else is "the latest wins".
      const word = line.split(" ")[0];
      if (word === "volstep" && pending.has(word)) {
        const sum = Number(pending.get(word).split(" ")[1]) + Number(line.split(" ")[1]);
        pending.set(word, `volstep ${Math.max(-100, Math.min(100, sum))}`);
      } else pending.set(word, line);
    },
    stop() {
      stopped = true;
      pending.clear();
      const proc = child;
      child = null;
      if (proc && proc.kill) {
        try {
          proc.stdin.end();
        } catch {
          // Already closed.
        }
        proc.kill();
      }
    },
  };
}

/**
 * status.ps1 / media.ps1 by path, as before: haze-sys.exe runs in their
 * place whenever it is present, with the script itself as the fallback.
 */
function startPsBridge(script, onState, spawnFn = spawn) {
  const mode = path.basename(script, ".ps1");
  const exe = NATIVE_MODES.has(mode) ? findHazeSys() : null;
  if (!exe) return startBridge(psHelper(script), onState, spawnFn);
  return startBridge({ file: exe, args: [mode] }, onState, spawnFn, psHelper(script));
}

module.exports = { startBridge, startPsBridge };
