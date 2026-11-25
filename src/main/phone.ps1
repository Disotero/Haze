# Phones for the phone widget, printed as one JSON line after an @@JSON@@
# marker (anything else on stdout is ignored):
#  - devices connected over USB (MTP): name, storages, newest camera files;
#  - Bluetooth devices that report a battery level (paired phones, earbuds).
# Phone Link itself has no public API, so this is what Windows exposes.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$shell = New-Object -ComObject Shell.Application
$devices = @()
foreach ($item in $shell.Namespace(17).Items()) {
  # Drives are file-system items; portable (MTP) devices are shell-only.
  if ($item.IsFileSystem -or $item.Path -notmatch '\\\\\?\\') { continue }
  $dev = [ordered]@{ name = $item.Name; path = $item.Path; storages = @(); camera = $null; recent = @(); total = 0 }
  foreach ($st in @($item.GetFolder.Items())) {
    $dev.storages += $st.Name
    $dcim = @($st.GetFolder.Items()) | Where-Object { $_.Name -eq 'DCIM' } | Select-Object -First 1
    if (-not $dcim) { continue }
    $cam = @($dcim.GetFolder.Items()) | Where-Object { $_.Name -eq 'Camera' } | Select-Object -First 1
    if (-not $cam) { $cam = $dcim }
    $files = @($cam.GetFolder.Items()) | Where-Object { -not $_.IsFolder }
    $dev.camera = $cam.Path
    $dev.total += $files.Count
    $dev.recent += @($files | Sort-Object { $_.ModifyDate } -Descending | Select-Object -First 8 | ForEach-Object {
        [ordered]@{ name = $_.Name; date = ([datetime]$_.ModifyDate).ToString('o'); video = ($_.Name -match '\.(mp4|mov|3gp|mkv|webm)$') }
      })
  }
  $devices += $dev
}

$battery = @()
$key = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
foreach ($d in @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTHENUM*' })) {
  $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName $key
  if ($p -and $null -ne $p.Data -and $p.Type -ne 'Empty') {
    $battery += [ordered]@{ name = $d.FriendlyName; battery = [int]$p.Data }
  }
}

[Console]::Out.WriteLine('@@JSON@@' + (@{ devices = $devices; bluetooth = $battery } | ConvertTo-Json -Compress -Depth 6))
