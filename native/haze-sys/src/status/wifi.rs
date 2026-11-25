//! Wi-Fi SSID and signal via wlanapi — the native counterpart of the netsh
//! parsing in status.ps1, including the 24H2 fallback: when the SSID is
//! withheld (location permission), the profile name is used instead.
//! Signal is the raw `wlanSignalQuality` percent (0–100), same scale the
//! script scrapes from netsh.

use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::{
    WLAN_INTERFACE_INFO_LIST, WlanCloseHandle, WlanEnumInterfaces, WlanFreeMemory, WlanOpenHandle,
    WlanQueryInterface, WLAN_CONNECTION_ATTRIBUTES, wlan_intf_opcode_current_connection,
    wlan_interface_state_connected,
};

/// (ssid, signal) of the first connected WLAN interface, (null, null) on any
/// failure or when Wi-Fi is simply not associated — matching the script's
/// `$ssid = $null; $signal = $null` defaults.
pub fn query() -> (Option<String>, Option<i64>) {
    unsafe {
        let mut handle = HANDLE::default();
        let mut negotiated = 0u32;
        // Client version 2 (Vista+); returns ERROR_SUCCESS (0) as plain u32.
        if WlanOpenHandle(2, None, &mut negotiated, &mut handle) != 0 {
            return (None, None);
        }
        let result = query_interfaces(handle);
        let _ = WlanCloseHandle(handle, None);
        result
    }
}

unsafe fn query_interfaces(handle: HANDLE) -> (Option<String>, Option<i64>) {
    unsafe {
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, None, &mut list) != 0 || list.is_null() {
            return (None, None);
        }
        let interfaces = &*list;
        let mut result = (None, None);
        for i in 0..interfaces.dwNumberOfItems as usize {
            let guid = &interfaces.InterfaceInfo[i].InterfaceGuid;
            let mut size = 0u32;
            let mut data: *mut std::ffi::c_void = std::ptr::null_mut();
            if WlanQueryInterface(
                handle,
                guid,
                wlan_intf_opcode_current_connection,
                None,
                &mut size,
                &mut data,
                None,
            ) != 0
                || data.is_null()
            {
                continue;
            }
            let attr = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
            if attr.isState == wlan_interface_state_connected {
                result = (
                    Some(ssid_or_profile(attr)),
                    Some(attr.wlanAssociationAttributes.wlanSignalQuality as i64),
                );
                WlanFreeMemory(data as _);
                break;
            }
            WlanFreeMemory(data as _);
        }
        WlanFreeMemory(list as _);
        result
    }
}

/// Connected SSID; an empty DOT11_SSID means the system withheld it
/// (24H2 location permission) — fall back to the profile name, like the
/// script does with the Get-NetConnectionProfile name.
unsafe fn ssid_or_profile(attr: &WLAN_CONNECTION_ATTRIBUTES) -> String {
    let ssid = &attr.wlanAssociationAttributes.dot11Ssid;
    let len = ssid.uSSIDLength as usize;
    if len > 0 {
        return String::from_utf8_lossy(&ssid.ucSSID[..len]).into_owned();
    }
    let end = attr
        .strProfileName
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(attr.strProfileName.len());
    String::from_utf16_lossy(&attr.strProfileName[..end])
}
