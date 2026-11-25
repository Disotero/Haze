//! `haze-sys.exe media` — SMTC now-playing, replacing media.ps1. One JSON
//! line per event or second; commands on stdin. The thumbnail is re-read
//! only when `title|artist` changes (the script's `$lastKey` cache) and is
//! reset when the session goes away. WinRT events arrive on system threads
//! and only wake the owner loop; the owner re-reads everything from the
//! manager/session, so there is no state to reconcile.

use crate::b64;
use crate::cmd::parse_media;
use crate::proto::{self, Wake};
use crate::state::{MediaActive, MediaIdle, datetime_to_unix_ms};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Foundation::{EventRegistrationToken, TypedEventHandler};
use windows::Media::Control::{
    CurrentSessionChangedEventArgs, GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProps,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    MediaPropertiesChangedEventArgs, PlaybackInfoChangedEventArgs,
    TimelinePropertiesChangedEventArgs,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

enum Msg {
    Command(String),
    /// Any SMTC event: re-read the whole state.
    Dirty,
}

/// Runaway guard for cover art: real covers are well under 1 MiB; anything
/// beyond 32 MiB is pathological (the script has no cap and would ship it).
const MAX_THUMB_BYTES: u64 = 32 << 20;

pub fn run() {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() {
            // S_OK/S_FALSE are both fine; only a real failure (or a changed
            // mode) matters — everything still works, only log it.
            eprintln!("[media] CoInitializeEx: {hr:?}");
        }
    }
    let (tx, rx) = channel::<Msg>();
    proto::spawn_stdin(tx.clone(), Msg::Command);
    let wake = Wake::new(tx);

    // Same failure behavior as media.ps1: if the manager cannot be created
    // the process dies and psbridge restarts it with backoff.
    let manager = match Manager::RequestAsync().and_then(|op| op.get()) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[media] SessionManager::RequestAsync: {e}");
            std::process::exit(1);
        }
    };
    let _manager_token = manager.CurrentSessionChanged(&TypedEventHandler::new({
        let w = wake.clone();
        move |_: &Option<Manager>, _: &Option<CurrentSessionChangedEventArgs>| {
            w.send(Msg::Dirty);
            Ok(())
        }
    }));

    let mut session: Option<Session> = None;
    let mut session_tokens: Vec<EventRegistrationToken> = Vec::new();
    let mut cache_key = String::new();
    let mut thumb: Option<String> = None;
    // First line immediately, like media.ps1's first iteration.
    let mut deadline = Instant::now();

    loop {
        let wait = deadline
            .saturating_duration_since(Instant::now())
            .max(Duration::from_millis(1));
        match rx.recv_timeout(wait) {
            Ok(Msg::Command(line)) => {
                if let Some(cmd) = parse_media(&line) {
                    act(&session, cmd);
                }
            }
            Ok(Msg::Dirty) => {}
            Err(RecvTimeoutError::Timeout) => deadline = Instant::now() + Duration::from_secs(1),
            // stdin closed — exit immediately, like the script.
            Err(_) => std::process::exit(0),
        }

        // Rebind the session-level subscriptions when the session changes.
        let current = manager.GetCurrentSession().ok();
        let changed = match (&current, &session) {
            (Some(a), Some(b)) => !same_session(a, b),
            (None, None) => false,
            _ => true,
        };
        if changed {
            if let Some(old) = &session {
                unsubscribe(old, &session_tokens);
            }
            session_tokens = current
                .as_ref()
                .map(|s| subscribe_session(s, &wake))
                .unwrap_or_default();
        }
        session = current;

        // No session resets the art cache, like the script's else branch; an
        // error inside the build keeps the cache (the script's catch).
        let line = match &session {
            None => {
                cache_key.clear();
                thumb = None;
                serde_json::to_string(&MediaIdle { active: false })
            }
            Some(s) => match build(s, &mut cache_key, &mut thumb) {
                Some(st) => serde_json::to_string(&st),
                None => serde_json::to_string(&MediaIdle { active: false }),
            },
        };
        proto::emit(&line.unwrap_or_else(|_| r#"{"active":false}"#.into()));
    }
}

/// WinRT interface wrappers are agile; identity = underlying object pointer.
fn same_session(a: &Session, b: &Session) -> bool {
    a.as_raw() == b.as_raw()
}

fn subscribe_session(s: &Session, wake: &Wake<Msg>) -> Vec<EventRegistrationToken> {
    // Session events carry typed args; each needs its own handler type.
    let mut tokens = Vec::with_capacity(3);
    let media_handler = TypedEventHandler::<Session, MediaPropertiesChangedEventArgs>::new({
        let w = wake.clone();
        move |_, _| {
            w.send(Msg::Dirty);
            Ok(())
        }
    });
    let playback_handler = TypedEventHandler::<Session, PlaybackInfoChangedEventArgs>::new({
        let w = wake.clone();
        move |_, _| {
            w.send(Msg::Dirty);
            Ok(())
        }
    });
    let timeline_handler = TypedEventHandler::<Session, TimelinePropertiesChangedEventArgs>::new({
        let w = wake.clone();
        move |_, _| {
            w.send(Msg::Dirty);
            Ok(())
        }
    });
    if let Ok(t) = s.MediaPropertiesChanged(&media_handler) {
        tokens.push(t);
    }
    if let Ok(t) = s.PlaybackInfoChanged(&playback_handler) {
        tokens.push(t);
    }
    if let Ok(t) = s.TimelinePropertiesChanged(&timeline_handler) {
        tokens.push(t);
    }
    tokens
}

fn unsubscribe(s: &Session, tokens: &[EventRegistrationToken]) {
    // Tokens pair with their remove method by which subscription produced
    // them; keep the same order as subscribe_session.
    if let Some(t) = tokens.first() {
        let _ = s.RemoveMediaPropertiesChanged(*t);
    }
    if let Some(t) = tokens.get(1) {
        let _ = s.RemovePlaybackInfoChanged(*t);
    }
    if let Some(t) = tokens.get(2) {
        let _ = s.RemoveTimelinePropertiesChanged(*t);
    }
}

/// `toggle` / `next` / `prev`; without a session they are ignored, like the
/// script's `if ($session)`. Fire-and-forget: the operation runs on its own.
fn act(session: &Option<Session>, cmd: crate::cmd::MediaCmd) {
    if let Some(s) = session {
        use crate::cmd::MediaCmd::*;
        let result = match cmd {
            Toggle => s.TryTogglePlayPauseAsync(),
            Next => s.TrySkipNextAsync(),
            Prev => s.TrySkipPreviousAsync(),
        };
        if let Err(e) = result {
            eprintln!("[media] {cmd:?} failed: {e}");
        }
    }
}

/// Build the active state; any source failure yields None → the script's
/// catch → `{"active":false}` while keeping the thumb cache.
fn build(s: &Session, cache_key: &mut String, thumb: &mut Option<String>) -> Option<MediaActive> {
    let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let playback = s.GetPlaybackInfo().ok()?;
    let timeline = s.GetTimelineProperties().ok()?;

    let title = props.Title().ok()?.to_string();
    let artist = props.Artist().ok()?.to_string();
    let album = props.AlbumTitle().ok()?.to_string();
    let controls = playback.Controls().ok()?;

    let key = format!("{title}|{artist}");
    if key != *cache_key {
        *cache_key = key;
        *thumb = read_thumb(&props);
    }

    Some(MediaActive {
        active: true,
        app: s.SourceAppUserModelId().ok()?.to_string(),
        title,
        artist,
        album,
        playing: playback.PlaybackStatus().ok()? == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing,
        position_ms: timeline.Position().ok()?.Duration / 10_000,
        duration_ms: timeline.EndTime().ok()?.Duration / 10_000,
        updated_at: datetime_to_unix_ms(timeline.LastUpdatedTime().ok()?.UniversalTime),
        can_next: controls.IsNextEnabled().ok()?,
        can_prev: controls.IsPreviousEnabled().ok()?,
        thumb: thumb.clone(),
    })
}

/// Data URL of the cover: sniff FF D8 → jpeg, else png — exactly the
/// script's Read-Thumbnail. Fails → None → `"thumb":null`.
fn read_thumb(props: &MediaProps) -> Option<String> {
    let stream_ref = props.Thumbnail().ok()?;
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size > MAX_THUMB_BYTES {
        return None;
    }
    let input = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()? as usize;
    let mut bytes = vec![0u8; loaded];
    if reader.ReadBytes(&mut bytes).is_err() {
        return None;
    }
    let mime = if bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
        "image/jpeg"
    } else {
        "image/png"
    };
    Some(format!("data:{mime};base64,{}", b64::encode(&bytes)))
}
