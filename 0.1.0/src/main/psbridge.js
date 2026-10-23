// Runs a PowerShell script as a long-lived helper: it prints one JSON object
// per line on stdout and reads commands line by line from stdin.
const { spawn } = require("node:child_process");
const readline = require("node:readline");

function startPsBridge(script, onState) {
  let child = null;
  let stopped = false;
  let lastJson = "";
  let restartDelay = 2000;

  function launch() {
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] }
    );
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.startsWith("{") || line === lastJson) return;
      lastJson = line;
      restartDelay = 2000;
      try {
        onState(JSON.parse(line));
      } catch {
        // Partial or malformed line: wait for the next tick.
      }
    });
    child.on("exit", () => {
      child = null;
      if (stopped) return;
      setTimeout(launch, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 60000);
    });
  }

  launch();

  return {
    send(line) {
      if (child) child.stdin.write(line + "\n");
    },
    stop() {
      stopped = true;
      if (child) {
        child.stdin.end();
        child.kill();
      }
    },
  };
}

module.exports = { startPsBridge };
