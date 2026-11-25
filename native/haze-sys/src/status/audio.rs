//! Volume and mute of the default render endpoint (eRender, eMultimedia) —
//! the same device pair status.ps1 queries. Event-driven:
//! `IAudioEndpointVolumeCallback` reports level/mute changes,
//! `IMMNotificationClient` catches default-device switches and triggers a
//! resubscribe. If there is no device at all, the endpoint reads come out
//! `null`/`false` (what the script's try/catch produces) and the owner loop
//! retries the attach once a tick until a device shows up.

use super::Msg;
use crate::proto::Wake;
use crate::state;
use windows::core::{implement, GUID, PCWSTR};
use windows::Win32::Foundation::BOOL;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    IMMDevice, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
    MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, EDataFlow, ERole,
    eMultimedia, eRender,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY;

/// Context GUID for Set* calls — Guid.Empty in the script.
fn null_ctx() -> GUID {
    GUID::from_u128(0)
}

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeCb {
    wake: Wake<Msg>,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeCb_Impl {
    fn OnNotify(&self, _pnotify: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        // Values are re-read from the endpoint on the owner thread, one code
        // path for events, commands and ticks.
        self.wake.send(Msg::Audio);
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceCb {
    wake: Wake<Msg>,
}

impl IMMNotificationClient_Impl for DeviceCb_Impl {
    fn OnDeviceStateChanged(&self, _device_id: &PCWSTR, _new_state: DEVICE_STATE) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnDeviceAdded(&self, _device_id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnDeviceRemoved(&self, _device_id: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }

    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _device_id: &PCWSTR,
    ) -> windows::core::Result<()> {
        // We follow (eRender, eMultimedia) — the pair the script activates.
        if flow == eRender && role == eMultimedia {
            self.wake.send(Msg::Devices);
        }
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _device_id: &PCWSTR, _key: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

struct Attached {
    _enum_dev: IMMDeviceEnumerator,
    _endpoint: IMMDevice,
    vol: IAudioEndpointVolume,
    /// Keep the registered callback objects alive for the endpoint's lifetime.
    _volume_cb: IAudioEndpointVolumeCallback,
    _device_cb: IMMNotificationClient,
}

pub struct Audio {
    wake: Wake<Msg>,
    inner: Option<Attached>,
}

impl Audio {
    pub fn new(wake: Wake<Msg>) -> Self {
        let mut audio = Audio { wake, inner: None };
        audio.attach();
        audio
    }

    pub fn detached(&self) -> bool {
        self.inner.is_none()
    }

    /// (Re)open the default endpoint and register both callbacks.
    pub fn attach(&mut self) {
        self.detach();
        unsafe {
            let Ok(enum_dev) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return;
            };
            let Ok(endpoint) = enum_dev.GetDefaultAudioEndpoint(eRender, eMultimedia) else {
                return;
            };
            let Ok(vol) = endpoint.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) else {
                return;
            };
            let volume_cb: IAudioEndpointVolumeCallback = VolumeCb { wake: self.wake.clone() }.into();
            let device_cb: IMMNotificationClient = DeviceCb { wake: self.wake.clone() }.into();
            // If registration fails the endpoint still works; only the
            // affected events are lost (ticks re-read the values anyway).
            if let Err(e) = vol.RegisterControlChangeNotify(&volume_cb) {
                eprintln!("[status] RegisterControlChangeNotify: {e}");
            }
            if let Err(e) = enum_dev.RegisterEndpointNotificationCallback(&device_cb) {
                eprintln!("[status] RegisterEndpointNotificationCallback: {e}");
            }
            self.inner = Some(Attached {
                _enum_dev: enum_dev,
                _endpoint: endpoint,
                vol,
                _volume_cb: volume_cb,
                _device_cb: device_cb,
            });
        }
    }

    fn detach(&mut self) {
        if let Some(attached) = self.inner.take() {
            unsafe {
                let _ = attached.vol.UnregisterControlChangeNotify(&attached._volume_cb);
                let _ = attached
                    ._enum_dev
                    .UnregisterEndpointNotificationCallback(&attached._device_cb);
            }
        }
    }

    /// Detach and re-attach: after a default-device change (or when a device
    /// showed up at all) the endpoint handle must be replaced.
    pub fn resubscribe(&mut self) {
        self.attach();
    }

    pub fn volume(&self) -> Option<i64> {
        let attached = self.inner.as_ref()?;
        unsafe {
            attached
                .vol
                .GetMasterVolumeLevelScalar()
                .ok()
                .map(state::volume_percent)
        }
    }

    pub fn muted(&self) -> bool {
        let Some(attached) = self.inner.as_ref() else {
            return false;
        };
        unsafe { attached.vol.GetMute().map(|m| m.as_bool()).unwrap_or(false) }
    }

    /// `mute` — flip the mute bit. No-op when there is no endpoint.
    pub fn toggle_mute(&self) {
        let Some(attached) = self.inner.as_ref() else {
            return;
        };
        unsafe {
            if let Ok(m) = attached.vol.GetMute() {
                let _ = attached.vol.SetMute(BOOL::from(!m.as_bool()), &null_ctx());
            }
        }
    }

    /// `vol <0-100>` — clamped here, like SetVolume clamps in the script.
    pub fn set_volume(&self, pct: i64) {
        let Some(attached) = self.inner.as_ref() else {
            return;
        };
        let scalar = (pct as f32 / 100.0).clamp(0.0, 1.0);
        unsafe {
            let _ = attached.vol.SetMasterVolumeLevelScalar(scalar, &null_ctx());
        }
    }

    /// `volstep <±n>` — relative to the raw scalar, clamped to 0..1
    /// (SetVolume in status.ps1 clamps the sum the same way).
    pub fn step_volume(&self, step: i64) {
        let Some(attached) = self.inner.as_ref() else {
            return;
        };
        unsafe {
            if let Ok(cur) = attached.vol.GetMasterVolumeLevelScalar() {
                let next = (cur + step as f32 / 100.0).clamp(0.0, 1.0);
                let _ = attached.vol.SetMasterVolumeLevelScalar(next, &null_ctx());
            }
        }
    }
}
