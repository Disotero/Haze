# System status for the top bar: volume, network, Bluetooth radio and whether
# the microphone / camera are in use. Emits one JSON line per second and
# accepts commands on stdin: "mute", "vol <0-100>", "volstep <+/-n>".
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, ref Guid ctx);
  int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
  int GetMasterVolumeLevel(out float l);
  int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint ch, float l, ref Guid ctx);
  int SetChannelVolumeLevelScalar(uint ch, float l, ref Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float l);
  int GetChannelVolumeLevelScalar(uint ch, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator { }

public static class CozyAudio {
  static IAudioEndpointVolume Endpoint() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev)); // eRender, eMultimedia
    var iid = typeof(IAudioEndpointVolume).GUID;
    object o;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o)); // CLSCTX_ALL
    return (IAudioEndpointVolume)o;
  }
  public static float GetVolume() { float v; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out v)); return v; }
  public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
  public static void SetVolume(float v) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref g)); }
  public static void SetMute(bool m) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, ref g)); }
}
'@

$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, [Type]$type) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(5000)
  return $task.Result
}

$radios = @()
function Load-Radios {
  try {
    $null = [Windows.Devices.Radios.Radio, Windows.Devices.Radios, ContentType = WindowsRuntime]
    $script:radios = @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
      ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
  } catch { $script:radios = @() }
}

function Bluetooth-State {
  $bt = $radios | Where-Object { $_.Kind.ToString() -eq 'Bluetooth' } | Select-Object -First 1
  if (-not $bt) { return $null }
  return ($bt.State.ToString() -eq 'On')
}

$oem = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)

function Network-State {
  # Only adapters that actually hold a network connection count: a Wi-Fi card
  # can report "Up" while the machine is online over Ethernet.
  $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
  $connected = @($profiles | ForEach-Object { $_.InterfaceIndex })
  $up = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Up' -and $connected -contains $_.ifIndex })
  $wifi = $up | Where-Object { $_.NdisPhysicalMedium -eq 9 -or $_.PhysicalMediaType -match '802\.11' } | Select-Object -First 1
  if ($wifi) {
    $ssid = $null; $signal = $null
    # netsh prints in the OEM code page; since Win11 24H2 it may also refuse
    # without location permission, in which case we fall back to the profile.
    try {
      [Console]::OutputEncoding = $oem
      $lines = netsh wlan show interfaces 2>$null
    } catch { $lines = @() } finally { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 }
    foreach ($l in $lines) {
      if ($l -match '^\s*SSID\s*:\s*(.+)$') { $ssid = $Matches[1].Trim() }
      elseif ($null -eq $signal -and $l -match ':\s*(\d+)\s*%') { $signal = [int]$Matches[1] }
    }
    if (-not $ssid) { $ssid = ($profiles | Where-Object { $_.InterfaceIndex -eq $wifi.ifIndex } | Select-Object -First 1).Name }
    return @{ kind = 'wifi'; ssid = $ssid; signal = $signal }
  }
  if ($up.Count -gt 0) { return @{ kind = 'ethernet' } }
  return @{ kind = 'none' }
}

function In-Use([string]$capability) {
  $base = "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\$capability"
  foreach ($k in @(Get-ChildItem $base -Recurse -ErrorAction SilentlyContinue)) {
    $start = $k.GetValue('LastUsedTimeStart')
    $stop = $k.GetValue('LastUsedTimeStop')
    if ($start -and $stop -eq 0) { return $true }
  }
  return $false
}

# Throughput of the physical adapters, as bytes/s since the previous sample.
$netOn = $false
$slow = $false
$physNames = @()
$lastRx = $null; $lastTx = $null
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$lastT = 0
function Net-Rates {
  if (-not $physNames.Count) { return @{ rx = $null; tx = $null } }
  $st = @(Get-NetAdapterStatistics -Name $physNames -ErrorAction SilentlyContinue)
  $rx = ($st | Measure-Object -Property ReceivedBytes -Sum).Sum
  $tx = ($st | Measure-Object -Property SentBytes -Sum).Sum
  $t = $clock.Elapsed.TotalSeconds
  $out = @{ rx = $null; tx = $null }
  if ($null -ne $script:lastRx -and $t -gt $script:lastT) {
    $dt = $t - $script:lastT
    $out = @{ rx = [long][Math]::Max(0, ($rx - $script:lastRx) / $dt); tx = [long][Math]::Max(0, ($tx - $script:lastTx) / $dt) }
  }
  $script:lastRx = $rx; $script:lastTx = $tx; $script:lastT = $t
  return $out
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$tick = 0
$net = @{ kind = 'none' }
$mic = $false
$cam = $false
Load-Radios

while ($true) {
  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }  # parent closed stdin
    try {
      $parts = $cmd.Trim() -split '\s+'
      switch ($parts[0]) {
        'mute' { [CozyAudio]::SetMute(-not [CozyAudio]::GetMute()) }
        'vol' { [CozyAudio]::SetVolume([float]$parts[1] / 100) }
        'volstep' { [CozyAudio]::SetVolume([CozyAudio]::GetVolume() + [float]$parts[1] / 100) }
        'net' { $netOn = ($parts[1] -eq '1') }
        'slow' { $slow = ($parts[1] -eq '1') }
      }
    } catch {}
    $pending = $stdin.ReadLineAsync()
  }

  if ($tick % 10 -eq 0) { $net = Network-State }
  if ($tick % 30 -eq 0) { $physNames = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { $_.Name }) }
  $rates = if ($netOn) { Net-Rates } else { @{ rx = $null; tx = $null } }
  if ($tick % 3 -eq 0) { $mic = In-Use 'microphone'; $cam = In-Use 'webcam' }
  if ($tick % 30 -eq 0 -and $tick -gt 0) { Load-Radios }

  $volume = $null; $muted = $false
  try { $volume = [int][Math]::Round([CozyAudio]::GetVolume() * 100); $muted = [CozyAudio]::GetMute() } catch {}

  $state = @{
    volume = $volume
    muted  = $muted
    net    = $net
    bt     = Bluetooth-State
    mic    = $mic
    cam    = $cam
    rx     = $rates.rx
    tx     = $rates.tx
  }
  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  $tick++
  # Hand freed .NET/COM memory back now and then; PowerShell is lazy about it.
  if ($tick % 60 -eq 0) { [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
  # Short sleeps keep volume changes from the keyboard feeling live.
  $steps = if ($slow) { 12 } else { 4 }
  for ($i = 0; $i -lt $steps -and -not $pending.IsCompleted; $i++) { Start-Sleep -Milliseconds 250 }
}
