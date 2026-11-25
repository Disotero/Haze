// Power and notifications: battery state, sleep, Focus assist quiet hours.
const koffi = require("koffi");
const { GetSystemPowerStatus } = require("./win32");

const ntdll = koffi.load("ntdll.dll");

const NtUpdateWnfStateData = ntdll.func(
  "long __stdcall NtUpdateWnfStateData(_In_ uint64_t *name, _In_ uint8_t *buf, uint32 len, intptr type, intptr scope, uint32 match, uint32 check)"
);

// WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED: Focus assist profile (0 off, 1 priority, 2 alarms only).
const WNF_QUIET_HOURS = [0x0d83063ea3bf1c75n];

/**
 * Quiet hours via the (undocumented) Focus assist state. Newer Windows 11
 * builds keep Do Not Disturb elsewhere, so callers also switch toasts off.
 */
function setQuietHours(on) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(on ? 2 : 0);
  return NtUpdateWnfStateData(WNF_QUIET_HOURS, buf, 4, 0, 0, 0, 0) === 0;
}

const powrprof = koffi.load("powrprof.dll");

const SetSuspendState = powrprof.func("bool __stdcall SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled)");

/**
 * Put the PC to sleep (what the Start menu's "Sleep" does). Called on a
 * worker thread: the call only returns after the PC wakes up again.
 */
function suspend() {
  SetSuspendState.async(false, false, false, (err) => err && console.error("[power] sleep failed:", err.message));
}

/** { hasBattery, percent, charging } */
function powerStatus() {
  const s = {};
  if (!GetSystemPowerStatus(s)) return { hasBattery: false };
  const hasBattery = (s.BatteryFlag & 128) === 0 && s.BatteryLifePercent !== 255;
  return { hasBattery, percent: s.BatteryLifePercent, charging: s.ACLineStatus === 1 };
}

module.exports = { NtUpdateWnfStateData, SetSuspendState, WNF_QUIET_HOURS, ntdll, powerStatus, powrprof, setQuietHours, suspend };
