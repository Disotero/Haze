# Bridge to Windows System Media Transport Controls (SMTC).
# Emits one JSON line per second describing the current media session and
# accepts commands on stdin: "toggle", "next", "prev".
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1

function Await($op, [Type]$type) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(5000)
  return $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
  ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Read-Thumbnail($props) {
  if (-not $props.Thumbnail) { return $null }
  try {
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    # The stream arrives as a bare __ComObject that PowerShell's binder won't
    # cast; reflection Invoke lets the CLR QueryInterface it instead.
    $net = $asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    $bytes = $ms.ToArray()
    $type = 'image/png'
    if ($bytes.Length -gt 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { $type = 'image/jpeg' }
    return "data:$type;base64," + [Convert]::ToBase64String($bytes)
  } catch { return $null }
}

# [Console]::In is a synchronized reader whose ReadLineAsync blocks; a raw
# StreamReader over stdin gives a truly asynchronous read.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = ''
$lastThumb = $null
$ticks = 0

while ($true) {
  $session = $null
  try { $session = $manager.GetCurrentSession() } catch {}

  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }  # parent closed stdin
    if ($session) {
      try {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
          'next' { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
          'prev' { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
        }
      } catch {}
    }
    $pending = $stdin.ReadLineAsync()
  }

  $state = @{ active = $false }
  if ($session) {
    try {
      $props = Await ($session.TryGetMediaPropertiesAsync()) `
        ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $key = "$($props.Title)|$($props.Artist)"
      if ($key -ne $lastKey) { $lastKey = $key; $lastThumb = Read-Thumbnail $props }
      $state = @{
        active     = $true
        app        = $session.SourceAppUserModelId
        title      = $props.Title
        artist     = $props.Artist
        album      = $props.AlbumTitle
        playing    = ($playback.PlaybackStatus.ToString() -eq 'Playing')
        positionMs = [long]$timeline.Position.TotalMilliseconds
        durationMs = [long]$timeline.EndTime.TotalMilliseconds
        updatedAt  = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
        canNext    = $playback.Controls.IsNextEnabled
        canPrev    = $playback.Controls.IsPreviousEnabled
        thumb      = $lastThumb
      }
    } catch { $state = @{ active = $false } }
  } else { $lastKey = ''; $lastThumb = $null }

  [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  if ((++$ticks % 60) -eq 0) { [GC]::Collect(); [GC]::WaitForPendingFinalizers() }
  Start-Sleep -Milliseconds 1000
}
