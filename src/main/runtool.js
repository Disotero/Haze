// One way to run Windows' own command-line tools: absolute paths (never
// whatever a PATH lookup finds first), a timeout, a bounded output buffer and
// an error handler on every call. Expected failures — `shutdown /a` with
// nothing pending, `taskkill` of an app that already quit — are not logged.
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const WINDIR = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const SYS32 = path.join(WINDIR, "System32");

const TOOLS = {
  cmd: path.join(SYS32, "cmd.exe"),
  explorer: path.join(WINDIR, "explorer.exe"),
  powershell: path.join(SYS32, "WindowsPowerShell", "v1.0", "powershell.exe"),
  reg: path.join(SYS32, "reg.exe"),
  shutdown: path.join(SYS32, "shutdown.exe"),
  taskkill: path.join(SYS32, "taskkill.exe"),
  tasklist: path.join(SYS32, "tasklist.exe"),
  whoami: path.join(SYS32, "whoami.exe"),
};

let log = (kind, err) => console.error(`[${kind}]`, err);
/** Where failures go (main.js passes its errors.log writer). */
function setLogger(fn) {
  log = fn;
}

/** Absolute path of a known tool, or the given path as is. */
function toolPath(name) {
  return TOOLS[name] || name;
}

/**
 * Run a tool and wait for it. Never rejects: resolves
 * { ok, stdout, stderr, error }. `expectFail` keeps non-zero exits out of the log.
 */
function runTool(name, args = [], { timeout = 10000, maxBuffer = 4 << 20, expectFail = false, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(toolPath(name), args, { windowsHide: true, timeout, maxBuffer, cwd }, (error, stdout, stderr) => {
        if (error && !expectFail) log(`tool ${name}`, error.message);
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || ""), error });
      });
    } catch (error) {
      log(`tool ${name}`, error.message);
      return resolve({ ok: false, stdout: "", stderr: "", error });
    }
    // A spawn failure also reaches the callback; this only stops it from
    // becoming an uncaught 'error' event.
    child.on("error", () => {});
  });
}

/** A PowerShell script file, the way every Haze helper runs. */
function runPowerShell(script, opts) {
  return runTool("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], opts);
}

/** Start a program and let it live on its own (Wallpaper Engine). */
function spawnDetached(file, args = [], opts = {}) {
  try {
    const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true, ...opts });
    child.on("error", (e) => log(`spawn ${path.basename(file)}`, e.message));
    child.unref();
    return true;
  } catch (e) {
    log(`spawn ${path.basename(file)}`, e.message);
    return false;
  }
}

module.exports = { runTool, runPowerShell, spawnDetached, toolPath, setLogger, SYS32 };
