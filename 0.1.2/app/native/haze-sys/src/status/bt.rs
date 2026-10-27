//! Bluetooth radio state via WinRT `Windows.Devices.Radios.Radio` — the
//! first Bluetooth radio decides, exactly like `Select -First 1` in
//! status.ps1. Subscribes to `StateChanged` of that radio (events trigger a
//! fresh scan so the "first radio wins" rule stays honest) and the owner
//! loop rescans every 30 ticks, matching `Load-Radios`. No radio or a failed
//! scan → `null`, like the script's empty `$radios`.

use super::Msg;
use crate::proto::Wake;
use std::sync::{Arc, Mutex};
use windows::Devices::Radios::{Radio, RadioKind, RadioState};
use windows::Foundation::TypedEventHandler;
use windows::core::IInspectable;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

pub struct Bluetooth {
    wake: Wake<Msg>,
    state: Option<bool>,
    busy: bool,
    /// Name of the radio we subscribed to, shared with the scan thread.
    subscribed: Arc<Mutex<Option<String>>>,
}

impl Bluetooth {
    pub fn new(wake: Wake<Msg>) -> Self {
        let bt = Bluetooth {
            wake,
            state: None,
            busy: false,
            subscribed: Arc::new(Mutex::new(None)),
        };
        // status.ps1 loads radios before its first line — do the same
        // synchronously; later scans are async.
        let state = scan(bt.wake.clone(), bt.subscribed.clone());
        Bluetooth { state, ..bt }
    }

    pub fn snapshot(&self) -> Option<bool> {
        self.state
    }

    /// Fresh value of the first Bluetooth radio, in a worker thread so the
    /// owner loop never blocks on GetRadiosAsync.
    pub fn rescan(&mut self) {
        if self.busy {
            return;
        }
        self.busy = true;
        let wake = self.wake.clone();
        let subscribed = self.subscribed.clone();
        std::thread::spawn(move || {
            let value = scan(wake.clone(), subscribed);
            wake.send(Msg::Bluetooth(value));
        });
    }

    /// Called by the owner when a scan answer arrives.
    pub fn on_scan_done(&mut self, value: Option<bool>) {
        self.state = value;
        self.busy = false;
    }
}

/// Runs on a worker thread: enumerate radios, take the first Bluetooth one,
/// subscribe once, return its On/Off state (None = no radio or failure).
fn scan(wake: Wake<Msg>, subscribed: Arc<Mutex<Option<String>>>) -> Option<bool> {
    // WinRT activation wants an apartment on this fresh thread.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let radios = Radio::GetRadiosAsync().ok()?.get().ok()?;
    let count = radios.Size().unwrap_or(0);
    let mut first: Option<Radio> = None;
    for i in 0..count {
        let Ok(r) = radios.GetAt(i) else { continue };
        if r.Kind() == Ok(RadioKind::Bluetooth) {
            first = Some(r);
            break;
        }
    }
    let radio = first?;
    // Radio has no stable id accessor in 0.58; the (user-visible) Name is
    // stable enough to detect "subscribed to a different radio".
    let name = radio.Name().map(|s| s.to_string()).unwrap_or_default();
    let mut guard = subscribed.lock().ok()?;
    if guard.as_deref() != Some(name.as_str()) {
        *guard = Some(name);
        let w = wake.clone();
        let handler = TypedEventHandler::<Radio, IInspectable>::new(move |_, _| {
            w.send(Msg::RescanBluetooth);
            Ok(())
        });
        if let Err(e) = radio.StateChanged(&handler) {
            eprintln!("[status] Radio.StateChanged: {e}");
        }
    }
    drop(guard);
    Some(radio.State() == Ok(RadioState::On))
}
