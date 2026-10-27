//! haze-sys — native helper for Haze, byte-compatible with the two
//! long-lived PowerShell helpers it replaces:
//!
//! * `haze-sys.exe status` — volume/mute, network kind, Wi-Fi SSID/signal,
//!   Bluetooth radio, mic/cam in use, rx/tx traffic (status.ps1);
//! * `haze-sys.exe media` — SMTC "now playing" plus player commands
//!   (media.ps1).
//!
//! Protocol for both: one JSON object per line on stdout, one command per
//! line on stdin, EOF on stdin = stop. psbridge.js owns the restart/backoff
//! logic, so panics are survivable — but sources are written to degrade to
//! `null`/defaults instead of panicking.

#![cfg_attr(windows, windows_subsystem = "windows")]

mod b64;
mod cmd;
mod proto;
mod state;

#[cfg(windows)]
mod media;
#[cfg(windows)]
mod status;

fn main() {
    match std::env::args().nth(1).as_deref() {
        #[cfg(windows)]
        Some("status") => status::run(),
        #[cfg(windows)]
        Some("media") => media::run(),
        #[cfg(windows)]
        Some(other) => {
            eprintln!("haze-sys: unknown mode {other:?}, expected \"status\" or \"media\"");
            std::process::exit(2);
        }
        #[cfg(windows)]
        None => {
            eprintln!("usage: haze-sys.exe <status|media>");
            std::process::exit(2);
        }
        #[cfg(not(windows))]
        _ => {
            eprintln!("haze-sys: Windows-only helper");
            std::process::exit(1);
        }
    }
}
