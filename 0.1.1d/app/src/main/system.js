// CPU / RAM / battery / disk sampling.
const os = require("node:os");
const fs = require("node:fs");
const { powerStatus } = require("./desktop");

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

let prev = cpuTimes();

// Disk fill barely moves: read it off the main thread, every 30 s at most.
let disk = null;
let diskAt = 0;
function diskPercent() {
  if (Date.now() - diskAt > 30e3) {
    diskAt = Date.now();
    fs.promises
      .statfs(process.env.SystemDrive ? process.env.SystemDrive + "\\" : "C:\\")
      .then((s) => (disk = Math.round((1 - s.bavail / s.blocks) * 100)))
      .catch(() => (disk = null));
  }
  return disk;
}

function sample() {
  const now = cpuTimes();
  const dTotal = now.total - prev.total;
  const cpu = dTotal > 0 ? Math.round((1 - (now.idle - prev.idle) / dTotal) * 100) : 0;
  prev = now;
  const ram = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  return {
    cpu: Math.max(0, Math.min(100, cpu)),
    ram,
    ramUsedGb: (os.totalmem() - os.freemem()) / 2 ** 30,
    ramTotalGb: os.totalmem() / 2 ** 30,
    battery: powerStatus(),
    disk: diskPercent(),
    uptimeSec: os.uptime(),
  };
}

module.exports = { sample };
