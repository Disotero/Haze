//! stdin command parsing, mirroring status.ps1 / media.ps1:
//!
//! * status: `mute` | `vol <n>` | `volstep <±n>` | `net <0|1>` | `slow <0|1>`
//! * media:  `toggle` | `next` | `prev`
//!
//! Matching is case-sensitive and unknown or malformed lines are ignored —
//! the scripts behave the same (switch on the first word inside try/catch).
//! Numbers parse loosely and are clamped later, at the audio API, which is
//! where the scripts clamp too (`vol 150` ends up at 100).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusCmd {
    Mute,
    Vol(i64),
    VolStep(i64),
    Net(bool),
    Slow(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaCmd {
    Toggle,
    Next,
    Prev,
}

/// `net`/`slow` take strictly `0` or `1`, like `$parts[1] -eq '1'` / `-eq '0'`.
fn onoff(word: Option<&str>) -> Option<bool> {
    match word? {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

fn number(word: Option<&str>) -> Option<i64> {
    word?.parse::<i64>().ok()
}

pub fn parse_status(line: &str) -> Option<StatusCmd> {
    let mut parts = line.trim().split_whitespace();
    match parts.next()? {
        "mute" => Some(StatusCmd::Mute),
        "vol" => number(parts.next()).map(StatusCmd::Vol),
        "volstep" => number(parts.next()).map(StatusCmd::VolStep),
        "net" => onoff(parts.next()).map(StatusCmd::Net),
        "slow" => onoff(parts.next()).map(StatusCmd::Slow),
        _ => None,
    }
}

pub fn parse_media(line: &str) -> Option<MediaCmd> {
    match line.trim() {
        "toggle" => Some(MediaCmd::Toggle),
        "next" => Some(MediaCmd::Next),
        "prev" => Some(MediaCmd::Prev),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_commands() {
        assert_eq!(parse_status("mute"), Some(StatusCmd::Mute));
        assert_eq!(parse_status("  mute  "), Some(StatusCmd::Mute));
        assert_eq!(parse_status("vol 42"), Some(StatusCmd::Vol(42)));
        assert_eq!(parse_status("vol 0"), Some(StatusCmd::Vol(0)));
        assert_eq!(parse_status("vol 100"), Some(StatusCmd::Vol(100)));
        // Out-of-range values still parse; clamping happens at the audio API.
        assert_eq!(parse_status("vol 150"), Some(StatusCmd::Vol(150)));
        assert_eq!(parse_status("volstep -999"), Some(StatusCmd::VolStep(-999)));
        assert_eq!(parse_status("volstep +5"), Some(StatusCmd::VolStep(5)));
        assert_eq!(parse_status("net 1"), Some(StatusCmd::Net(true)));
        assert_eq!(parse_status("net 0"), Some(StatusCmd::Net(false)));
        assert_eq!(parse_status("slow 1"), Some(StatusCmd::Slow(true)));
        assert_eq!(parse_status("slow 0"), Some(StatusCmd::Slow(false)));
    }

    #[test]
    fn status_garbage_is_ignored() {
        // Case-sensitive, like the switch in status.ps1.
        assert_eq!(parse_status("MUTE"), None);
        assert_eq!(parse_status("vol"), None); // no argument
        assert_eq!(parse_status("vol abc"), None);
        assert_eq!(parse_status("vol 42 extra"), Some(StatusCmd::Vol(42))); // extras ignored
        assert_eq!(parse_status("net true"), None); // only 0/1, like the script
        assert_eq!(parse_status("net"), None);
        assert_eq!(parse_status(""), None);
        assert_eq!(parse_status("   "), None);
        assert_eq!(parse_status("reboot"), None);
    }

    #[test]
    fn media_commands() {
        assert_eq!(parse_media("toggle"), Some(MediaCmd::Toggle));
        assert_eq!(parse_media(" next"), Some(MediaCmd::Next));
        assert_eq!(parse_media("prev\n"), Some(MediaCmd::Prev));
        assert_eq!(parse_media("STOP"), None);
        assert_eq!(parse_media("toggle now"), None); // media commands are exact
        assert_eq!(parse_media(""), None);
    }
}
