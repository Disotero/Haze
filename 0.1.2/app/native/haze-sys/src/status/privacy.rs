//! Microphone / camera "in use" from the CapabilityAccessManager ConsentStore
//! registry tree — the native twin of In-Use in status.ps1: any key
//! (recursively, NonPackaged included) whose `LastUsedTimeStart` is set and
//! whose `LastUsedTimeStop` is exactly 0. A key without the Stop value does
//! not count ($null -eq 0 is false in PowerShell, so the script skips it).

use windows::core::{PWSTR, PCWSTR, w};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryInfoKeyW,
    RegQueryValueExW, KEY_READ, REG_VALUE_TYPE,
};

pub fn in_use() -> (bool, bool) {
    let mic = walk(w!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"));
    let cam = walk(w!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam"));
    (mic, cam)
}

fn walk(path: PCWSTR) -> bool {
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(HKEY_CURRENT_USER, path, 0, KEY_READ, &mut key) != ERROR_SUCCESS {
            return false;
        }
        let used = walk_key(key, 0);
        let _ = RegCloseKey(key);
        used
    }
}

/// ConsentStore trees are at most a few levels deep (app → NonPackaged or a
/// package → its entries); the depth limit bounds a pathological hive.
const MAX_DEPTH: u32 = 4;

fn walk_key(key: HKEY, depth: u32) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    if let Some((start, stop)) = last_used(key) {
        if start != 0 && stop == 0 {
            return true;
        }
    }
    unsafe {
        let mut subkeys = 0u32;
        let mut max_len = 0u32;
        if RegQueryInfoKeyW(
            key,
            PWSTR::null(),
            None,
            None,
            Some(&mut subkeys),
            Some(&mut max_len),
            None,
            None,
            None,
            None,
            None,
            None,
        ) != ERROR_SUCCESS
        {
            return false;
        }
        let mut name = [0u16; 256];
        for i in 0..subkeys {
            let mut len = name.len() as u32;
            if RegEnumKeyExW(
                key,
                i,
                PWSTR(name.as_mut_ptr()),
                &mut len,
                None,
                PWSTR::null(),
                None,
                None,
            ) != ERROR_SUCCESS
            {
                continue;
            }
            let mut sub = HKEY::default();
            if RegOpenKeyExW(key, PCWSTR(name.as_ptr()), 0, KEY_READ, &mut sub) != ERROR_SUCCESS {
                continue;
            }
            let used = walk_key(sub, depth + 1);
            let _ = RegCloseKey(sub);
            if used {
                return true;
            }
        }
    }
    false
}

/// (LastUsedTimeStart, LastUsedTimeStop) — None unless both QWORDs exist.
fn last_used(key: HKEY) -> Option<(u64, u64)> {
    unsafe {
        let mut ty = REG_VALUE_TYPE(0);
        // In: the buffer size (0 would make every read fail with
        // ERROR_MORE_DATA); out: the bytes written. Reset before each read.
        let mut cb = 8u32;
        let mut start = 0u64;
        if RegQueryValueExW(
            key,
            w!("LastUsedTimeStart"),
            None,
            Some(&mut ty),
            Some(&mut start as *mut u64 as _),
            Some(&mut cb),
        ) != ERROR_SUCCESS
            || cb != 8
        {
            return None;
        }
        let mut stop = 0u64;
        cb = 8;
        if RegQueryValueExW(
            key,
            w!("LastUsedTimeStop"),
            None,
            Some(&mut ty),
            Some(&mut stop as *mut u64 as _),
            Some(&mut cb),
        ) != ERROR_SUCCESS
            || cb != 8
        {
            return None;
        }
        Some((start, stop))
    }
}
