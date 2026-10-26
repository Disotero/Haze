// Runs a PowerShell script as a long-lived helper: it prints one JSON object
// per line on stdout and reads commands line by line from stdin.
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { toolPath } = require("./runtool");

/**
 * Commands sent while the helper is (re)starting wait for it. Only the latest
 * of each kind matters — `net 1` then `net 0` is just `net 0` — so the queue
 * keeps one per command word and never grows.
 */
function startPsBridge(script, onState) {
  let child = null;
  let stopped = false;
  let lastJson = "";
  let restartDelay = 2000;
  const pending = new Map(); // command word → full line

  function flush() {
    for (const line of pending.values()) write(line);
    pending.clear();
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
    setTimeout(launch, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 60000);
  }

  function launch() {
    if (stopped) return;
    let proc;
    try {
      proc = spawn(
        toolPath("powershell"),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }
      );
    } catch (e) {
      console.error("[psbridge] spawn failed:", e.message);
      child = proc = {};
      return exited(proc);
    }
    child = proc;
    // A dead pipe (the helper crashed mid-write) must not become an uncaught EPIPE.
    proc.stdin.on("error", () => {});
    proc.on("error", (e) => {
      console.error("[psbridge]", script, e.message);
      exited(proc);
    });
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.startsWith("{") || line === lastJson) return;
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

module.exports = { startPsBridge };
