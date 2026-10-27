//! Network kind, Wi-Fi details and per-second traffic of the physical
//! adapters. Everything goes through `GetIfTable2`, so "is this adapter
//! physical and up" is decided exactly the same way for the kind and for the
//! byte counters. `NotifyIpInterfaceChange` wakes the owner on up/down or
//! address changes; the owner loop also re-derives the kind every 10th tick,
//! like status.ps1 does.
//!
//! Like the script, an adapter only counts for the kind when it also holds
//! a connected network (Network List Manager, the source behind
//! Get-NetConnectionProfile): a Wi-Fi card can be Up with no network while
//! the machine is online over Ethernet.

use super::{wifi, Msg};
use crate::proto::Wake;
use crate::state::{self, Net};
use std::ffi::c_void;
use std::time::Instant;
use windows::Win32::Foundation::{BOOLEAN, HANDLE};
use windows::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, NotifyIpInterfaceChange, CancelMibChangeNotify2, MIB_IF_ROW2,
    MIB_IF_TABLE2, MIB_NOTIFICATION_TYPE, MIB_IPINTERFACE_ROW, IF_TYPE_ETHERNET_CSMACD,
    IF_TYPE_IEEE80211,
};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::core::GUID;
use windows::Win32::Networking::NetworkListManager::{INetworkListManager, NetworkListManager};
use windows::Win32::Networking::WinSock::AF_UNSPEC;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// Physical adapters that are Up: hardware interfaces of the two types the
/// top bar understands (Ethernet 6, Wi-Fi 71). Loopback, tunnels, vEthernet
/// bridges and WAN Miniports are filtered out by the type + hardware flag.
/// InterfaceAndOperStatusFlags: bit 0 = HardwareInterface, bit 1 =
/// FilterInterface. Filter layers (WFP, QoS, ...) repeat the adapter with
/// their own GUID and the same byte counters, so they must be left out.
fn is_physical_up(row: &MIB_IF_ROW2) -> bool {
    let flags = row.InterfaceAndOperStatusFlags._bitfield;
    row.OperStatus == IfOperStatusUp
        && flags & 1 == 1
        && (flags >> 1) & 1 == 0
        && (row.Type == IF_TYPE_ETHERNET_CSMACD || row.Type == IF_TYPE_IEEE80211)
}

/// Run `f` over a snapshot of all interface rows, freeing the table after.
fn with_rows<T>(f: impl FnOnce(&[MIB_IF_ROW2]) -> T) -> Option<T> {
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table).0 != 0 || table.is_null() {
            return None;
        }
        let t = &*table;
        let rows = std::slice::from_raw_parts(t.Table.as_ptr(), t.NumEntries as usize);
        let out = f(rows);
        FreeMibTable(table as _);
        Some(out)
    }
}

/// status.ps1 shows Wi-Fi whenever a physical Wi-Fi adapter is up, ahead of
/// Ethernet; SSID/signal come from wlanapi (with the profile-name fallback).
fn compute_kind(rows: &[MIB_IF_ROW2]) -> Net {
    // Only physical, up adapters that hold a network connection count: a
    // Wi-Fi card can be Up with no network while the machine is online over
    // Ethernet. Without the connection list (NLM failed) every up adapter
    // counts, which is the best guess left.
    let connected = connected_adapters();
    let mut up = rows.iter().filter(|r| {
        is_physical_up(r) && connected.as_ref().map_or(true, |ids| ids.contains(&r.InterfaceGuid))
    });
    if up.clone().any(|r| r.Type == IF_TYPE_IEEE80211) {
        let (ssid, signal) = wifi::query();
        return Net::Wifi { ssid, signal };
    }
    if up.any(|r| r.Type == IF_TYPE_ETHERNET_CSMACD) {
        return Net::Ethernet;
    }
    Net::None
}

/// Adapters with a connected network (Network List Manager — the source
/// Get-NetConnectionProfile reads in status.ps1). None if NLM is unavailable.
fn connected_adapters() -> Option<Vec<GUID>> {
    unsafe {
        let nlm: INetworkListManager = CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL).ok()?;
        let conns = nlm.GetNetworkConnections().ok()?;
        let mut ids = Vec::new();
        loop {
            let mut slot = [None];
            let mut fetched = 0u32;
            if conns.Next(&mut slot, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let Some(conn) = slot[0].take() else { break };
            if conn.IsConnected().map(|c| c.as_bool()).unwrap_or(false) {
                if let Ok(id) = conn.GetAdapterId() {
                    ids.push(id);
                }
            }
        }
        Some(ids)
    }
}

extern "system" fn on_ip_change(
    ctx: *const c_void,
    _row: *const MIB_IPINTERFACE_ROW,
    _ntype: MIB_NOTIFICATION_TYPE,
) {
    // The context is a leaked Wake<Msg>: the registration lives for the
    // process lifetime, so the box must too.
    unsafe {
        (*(ctx as *const Wake<Msg>)).send(Msg::Net);
    }
}

struct Sample {
    rx: u64,
    tx: u64,
    at: Instant,
}

pub struct NetMon {
    enabled: bool,
    sample: Option<Sample>,
    notify: Option<HANDLE>,
}

impl NetMon {
    pub fn new(wake: Wake<Msg>) -> Self {
        let mut mon = NetMon {
            enabled: false,
            sample: None,
            notify: None,
        };
        // Register for change events (family = AF_UNSPEC). The initial
        // notification fires right away; extra wakes are harmless.
        unsafe {
            let ctx = Box::into_raw(Box::new(wake)) as *const Wake<Msg>;
            let mut handle = HANDLE::default();
            if NotifyIpInterfaceChange(AF_UNSPEC, Some(on_ip_change), Some(ctx as *const c_void), BOOLEAN::from(true), &mut handle).0 == 0 {
                mon.notify = Some(handle);
            } else {
                drop(Box::from_raw(ctx as *mut Wake<Msg>));
            }
        }
        mon
    }

    /// Recompute the network kind from a fresh interface snapshot.
    pub fn refresh(&mut self) -> Net {
        with_rows(|rows| compute_kind(rows)).unwrap_or(Net::None)
    }

    /// `net 0|1` — throughput on/off. Resetting the sample makes the first
    /// read after re-enabling emit null, as the contract requires.
    pub fn set_traffic(&mut self, on: bool) {
        self.enabled = on;
        if !on {
            self.sample = None;
        }
    }

    /// Bytes/s over the physical Up adapters, summed like
    /// Get-NetAdapterStatistics in the script. Returns (null, null) while
    /// disabled and for the first sample after enabling.
    pub fn rates(&mut self) -> (Option<u64>, Option<u64>) {
        if !self.enabled {
            self.sample = None;
            return (None, None);
        }
        let Some(total) = with_rows(|rows| {
            rows.iter()
                .filter(|r| is_physical_up(r))
                .fold((0u64, 0u64), |acc, r| {
                    (acc.0.wrapping_add(r.InOctets), acc.1.wrapping_add(r.OutOctets))
                })
        }) else {
            return (None, None);
        };
        match self.sample.take() {
            None => {
                self.sample = Some(Sample { rx: total.0, tx: total.1, at: Instant::now() });
                (None, None)
            }
            Some(prev) => {
                let dt = prev.at.elapsed().as_secs_f64();
                self.sample = Some(Sample { rx: total.0, tx: total.1, at: Instant::now() });
                (
                    Some(state::rate(total.0, prev.rx, dt)),
                    Some(state::rate(total.1, prev.tx, dt)),
                )
            }
        }
    }
}

impl Drop for NetMon {
    fn drop(&mut self) {
        if let Some(h) = self.notify {
            unsafe {
                let _ = CancelMibChangeNotify2(h);
            }
        }
    }
}
