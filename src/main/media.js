// Relays SMTC "now playing" state from media.ps1.
const path = require("node:path");
const { startPsBridge } = require("./psbridge");

function startMediaBridge(onState) {
  const bridge = startPsBridge(path.join(__dirname, "media.ps1"), onState);
  return {
    send(cmd) {
      if (["toggle", "next", "prev"].includes(cmd)) bridge.send(cmd);
    },
    stop: bridge.stop,
  };
}

module.exports = { startMediaBridge };
