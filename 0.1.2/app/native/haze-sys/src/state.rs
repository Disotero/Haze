//! JSON shapes, key-for-key compatible with what status.ps1 and media.ps1
//! print via ConvertTo-Json (key order does not matter to psbridge; presence
//! and null-ness do):
//!
//! * status: every key is always present; `net` is `{"kind":"wifi","ssid":..,
//!   "signal":..}` (nulls included), `{"kind":"ethernet"}` or
//!   `{"kind":"none"}`; `volume`/`bt`/`rx`/`tx` are null on failure.
//! * media: `{"active":false}` with no session, otherwise all keys present
//!   (`thumb` may be null).
//!
//! Also holds the numeric helpers that reproduce .NET rounding exactly.

use serde::Serialize;

/// `net` of status.ps1. Wi-Fi always carries `ssid` and `signal` (possibly
/// null); the other two kinds serialize as just `{"kind":"..."}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum Net {
    #[serde(rename = "wifi")]
    Wifi {
        ssid: Option<String>,
        signal: Option<i64>,
    },
    #[serde(rename = "ethernet")]
    Ethernet,
    #[serde(rename = "none")]
    None,
}

impl Default for Net {
    fn default() -> Self {
        Net::None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StatusState {
    pub volume: Option<i64>,
    pub muted: bool,
    pub net: Net,
    pub bt: Option<bool>,
    pub mic: bool,
    pub cam: bool,
    pub rx: Option<u64>,
    pub tx: Option<u64>,
}

impl Default for StatusState {
    fn default() -> Self {
        StatusState {
            volume: None,
            muted: false,
            net: Net::None,
            bt: None,
            mic: false,
            cam: false,
            rx: None,
            tx: None,
        }
    }
}

/// media.ps1 with a session — every key present, `thumb` may be null.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MediaActive {
    pub active: bool,
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    #[serde(rename = "positionMs")]
    pub position_ms: i64,
    #[serde(rename = "durationMs")]
    pub duration_ms: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
    #[serde(rename = "canNext")]
    pub can_next: bool,
    #[serde(rename = "canPrev")]
    pub can_prev: bool,
    pub thumb: Option<String>,
}

/// media.ps1 with no session.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct MediaIdle {
    pub active: bool,
}

/// Round half to even — what .NET `Math.Round` and PowerShell's numeric
/// casts do, so emitted numbers match the scripts bit for bit.
pub fn round_half_even(x: f64) -> f64 {
    let r = x.round(); // half away from zero
    if (x - x.trunc()).abs() != 0.5 {
        return r;
    }
    if r % 2.0 != 0.0 {
        r - x.signum()
    } else {
        r
    }
}

/// Master volume scalar (0..1) → percent, as `[int][Math]::Round(v * 100)`:
/// PowerShell multiplies in Single and widens to Double for Round, so the
/// multiply is done in f32 here first.
pub fn volume_percent(v: f32) -> i64 {
    let x = (v * 100.0) as f64;
    round_half_even(x) as i64
}

/// Bytes/s between traffic samples, as `[long][Math]::Max(0, (cur-prev)/dt)`.
pub fn rate(cur: u64, prev: u64, dt: f64) -> u64 {
    if dt <= 0.0 {
        return 0;
    }
    let x = (cur as f64 - prev as f64) / dt;
    if x < 0.0 {
        0
    } else {
        round_half_even(x) as u64
    }
}

/// WinRT `DateTime` (100 ns ticks since 1601-01-01) → unix milliseconds,
/// like `DateTimeOffset.ToUnixTimeMilliseconds()`.
pub const UNIX_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;

pub fn datetime_to_unix_ms(filetime_100ns: i64) -> i64 {
    filetime_100ns / 10_000 - UNIX_EPOCH_OFFSET_MS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_value<T: Serialize>(v: &T) -> serde_json::Value {
        serde_json::to_value(v).expect("serialize")
    }

    #[test]
    fn net_shapes_match_the_script() {
        let wifi = to_value(&Net::Wifi {
            ssid: Some("Home".into()),
            signal: Some(78),
        });
        assert_eq!(wifi, serde_json::json!({"kind": "wifi", "ssid": "Home", "signal": 78}));

        // Nulls are emitted, not skipped — ConvertTo-Json prints them too.
        let wifi_empty = to_value(&Net::Wifi { ssid: None, signal: None });
        assert_eq!(wifi_empty, serde_json::json!({"kind": "wifi", "ssid": null, "signal": null}));

        assert_eq!(to_value(&Net::Ethernet), serde_json::json!({"kind": "ethernet"}));
        assert_eq!(to_value(&Net::None), serde_json::json!({"kind": "none"}));
    }

    #[test]
    fn status_shape_matches_the_script() {
        let st = to_value(&StatusState {
            volume: Some(42),
            muted: false,
            net: Net::Ethernet,
            bt: None,
            mic: false,
            cam: true,
            rx: Some(1234),
            tx: None,
        });
        assert_eq!(
            st,
            serde_json::json!({
                "volume": 42, "muted": false,
                "net": {"kind": "ethernet"},
                "bt": null, "mic": false, "cam": true,
                "rx": 1234, "tx": null
            })
        );
    }

    #[test]
    fn media_shapes_match_the_script() {
        let idle = to_value(&MediaIdle { active: false });
        assert_eq!(idle, serde_json::json!({"active": false}));

        let active = to_value(&MediaActive {
            active: true,
            app: "Spotify.exe".into(),
            title: "Song".into(),
            artist: "A".into(),
            album: "Al".into(),
            playing: true,
            position_ms: 12_345,
            duration_ms: 200_000,
            updated_at: 1_761_500_000_000,
            can_next: true,
            can_prev: false,
            thumb: None,
        });
        assert_eq!(
            active,
            serde_json::json!({
                "active": true, "app": "Spotify.exe", "title": "Song", "artist": "A",
                "album": "Al", "playing": true, "positionMs": 12345,
                "durationMs": 200000, "updatedAt": 1761500000000i64,
                "canNext": true, "canPrev": false, "thumb": null
            })
        );
    }

    #[test]
    fn rounding_is_half_to_even_like_dotnet() {
        assert_eq!(round_half_even(2.5), 2.0);
        assert_eq!(round_half_even(3.5), 4.0);
        assert_eq!(round_half_even(0.5), 0.0);
        assert_eq!(round_half_even(-0.5), 0.0);
        assert_eq!(round_half_even(-2.5), -2.0);
        assert_eq!(round_half_even(2.4), 2.0);
        assert_eq!(round_half_even(2.6), 3.0);
    }

    #[test]
    fn volume_percent_matches_powershell_math() {
        assert_eq!(volume_percent(0.0), 0);
        assert_eq!(volume_percent(1.0), 100);
        assert_eq!(volume_percent(0.42), 42);
        // 0.435f * 100 is not exactly 43.5 in f32 — both sides must agree.
        assert_eq!(volume_percent(0.435), 44);
        assert_eq!(volume_percent(0.5), 50);
    }

    #[test]
    fn traffic_rate_matches_powershell_math() {
        assert_eq!(rate(2000, 1000, 1.0), 1000);
        assert_eq!(rate(1000, 2000, 1.0), 0); // counter reset → clamp, not panic
        assert_eq!(rate(1500, 1000, 2.0), 250);
        assert_eq!(rate(10, 0, 0.0), 0); // degenerate dt
        // .5 exact midpoint rounds to even.
        assert_eq!(rate(5, 0, 2.0), 2);
        assert_eq!(rate(7, 0, 2.0), 4);
    }

    #[test]
    fn winrt_datetime_to_unix() {
        // 1601-01-01 00:00:00 UTC is 11_644_473_600 s before the unix epoch.
        assert_eq!(datetime_to_unix_ms(0), -UNIX_EPOCH_OFFSET_MS);
        // 1970-01-01 00:00:00 UTC in filetime = 11_644_473_600 s → 0 ms.
        assert_eq!(datetime_to_unix_ms(11_644_473_600_000 * 10_000), 0);
        // 2025-10-26T00:00:00Z = 1761436800 s.
        let ft = (1_761_436_800 + UNIX_EPOCH_OFFSET_MS / 1000) * 10_000_000;
        assert_eq!(datetime_to_unix_ms(ft), 1_761_436_800_000);
    }
}
