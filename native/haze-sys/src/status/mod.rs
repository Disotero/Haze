//! `haze-sys.exe status` — the top-bar data source that replaces status.ps1.
//!
//! One state-owner thread (this one) receives stdin commands and change
//! notifications from the collectors (audio, network, Bluetooth), re-checks
//! the slow sources on their schedules (registry mic/cam every 3 ticks,
//! network state every 10, Bluetooth rescan every 30 — the exact cadence of
//! status.ps1) and emits one JSON line per loop iteration: after every
//! command and event immediately, plus once per tick (1 s, 3 s in slow
//! mode). Repeats are harmless: psbridge drops identical consecutive lines.

mod audio;
mod bt;
mod net;
mod privacy;
mod wifi;

use crate::cmd::{parse_status, StatusCmd};
use crate::proto::{self, Wake};
use crate::state::StatusState;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};

use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

pub enum Msg {
    /// A raw stdin line.
    Command(String),
    /// Volume/mute endpoint event — re-read the endpoint values.
    Audio,
    /// Default render device changed — resubscribe, then re-read.
    Devices,
    /// Interface up/down or address change — recompute the network kind.
    Net,
    /// A Bluetooth radio flipped — rescan (the first BT radio decides).
    RescanBluetooth,
    /// Result of a Bluetooth scan: None = no radio / scan failed.
    Bluetooth(Option<bool>),
}

pub fn run() {
    // MTA: the collectors and WinRT event handlers run on their own threads
    // and only send into the channel; the owner thread does all querying.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() {
        // RPC_E_CHANGED_MODE means COM is already up — fine; anything else
        // still leaves most collectors usable, so only log.
        eprintln!("[status] CoInitializeEx: {hr:?}");
    }

    let (tx, rx) = channel::<Msg>();
    proto::spawn_stdin(tx.clone(), Msg::Command);
    let wake = Wake::new(tx);

    let mut audio = audio::Audio::new(wake.clone());
    let mut netmon = net::NetMon::new(wake.clone());
    let mut radios = bt::Bluetooth::new(wake.clone());

    // status.ps1 primes every source before its first line: network kind,
    // mic/cam, radios and (via the first tick) the traffic baseline.
    let (mic, cam) = privacy::in_use();
    let mut state = StatusState {
        volume: audio.volume(),
        muted: audio.muted(),
        net: netmon.refresh(),
        bt: radios.snapshot(),
        mic,
        cam,
        rx: None,
        tx: None,
    };

    let mut period = Duration::from_secs(1);
    // Deadline = now: the first line goes out immediately, like the script's
    // first loop iteration (the sources were primed above).
    let mut deadline = Instant::now();
    let mut tick: u64 = 0;
    loop {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1));
        match rx.recv_timeout(wait) {
            Ok(Msg::Command(line)) => {
                apply_command(&audio, &mut netmon, &mut period, &line);
                // The new line goes out at once, without waiting for a tick.
                state.volume = audio.volume();
                state.muted = audio.muted();
            }
            Ok(Msg::Audio) => {
                state.volume = audio.volume();
                state.muted = audio.muted();
            }
            Ok(Msg::Devices) => {
                audio.resubscribe();
                state.volume = audio.volume();
                state.muted = audio.muted();
            }
            Ok(Msg::Net) => state.net = netmon.refresh(),
            Ok(Msg::RescanBluetooth) => radios.rescan(),
            Ok(Msg::Bluetooth(v)) => {
                radios.on_scan_done(v);
                state.bt = v;
            }
            Err(RecvTimeoutError::Timeout) => {
                tick += 1;
                deadline = Instant::now() + period;
                // The script re-reads volume every tick, which also recovers
                // from an audio device appearing without a notification.
                if audio.detached() {
                    audio.resubscribe();
                }
                state.volume = audio.volume();
                state.muted = audio.muted();
                if tick % 10 == 0 {
                    state.net = netmon.refresh();
                }
                if tick % 3 == 0 {
                    let (mic, cam) = privacy::in_use();
                    state.mic = mic;
                    state.cam = cam;
                }
                if tick % 30 == 0 {
                    radios.rescan();
                }
                let (rx_bps, tx_bps) = netmon.rates();
                state.rx = rx_bps;
                state.tx = tx_bps;
            }
            // The stdin reader is gone: exit right behind it.
            Err(_) => std::process::exit(0),
        }
        proto::emit(&serde_json::to_string(&state).unwrap_or_else(|_| "{}".into()));
    }
}

fn apply_command(audio: &audio::Audio, netmon: &mut net::NetMon, period: &mut Duration, line: &str) {
    match parse_status(line) {
        Some(StatusCmd::Mute) => audio.toggle_mute(),
        Some(StatusCmd::Vol(v)) => audio.set_volume(v.clamp(0, 100)),
        Some(StatusCmd::VolStep(v)) => audio.step_volume(v.clamp(-100, 100)),
        Some(StatusCmd::Net(on)) => netmon.set_traffic(on),
        Some(StatusCmd::Slow(on)) => {
            *period = if on { Duration::from_secs(3) } else { Duration::from_secs(1) };
        }
        None => {} // unknown or malformed — ignored, like the scripts
    }
}
