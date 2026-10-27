# Programs living in the notification area ("tray") that are running now.
# Windows 11 keeps every tray icon it has seen under NotifyIconSettings, with
# the program's path and a PNG snapshot of the icon; we keep the entries
# whose program is running. Prints one JSON line: [{ exe, name, icon }].
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Known-folder GUIDs Windows uses as path prefixes there.
$folders = @{
  '{6D809377-6AF0-444B-8957-A3773F02200E}' = $env:ProgramW6432
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:windir
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = [Environment]::GetFolderPath('System')
}

$running = @{}
foreach ($p in Get-Process) {
  if ($p.Path) { $running[$p.Path.ToLowerInvariant()] = $true }
}

$out = @()
$seen = @{}
foreach ($k in Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings') {
  $v = Get-ItemProperty $k.PSPath
  $exe = [string]$v.ExecutablePath
  if (-not $exe) { continue }
  if ($exe -match '^(\{[0-9A-Fa-f-]+\})\\(.*)$' -and $folders[$Matches[1].ToUpper()]) {
    $exe = Join-Path $folders[$Matches[1].ToUpper()] $Matches[2]
  }
  $key = $exe.ToLowerInvariant()
  # Explorer's own icons (volume, network…) are on the Haze bar already.
  if ($seen[$key] -or -not $running[$key] -or $key -like '*\explorer.exe') { continue }
  $seen[$key] = $true
  $name = ([string]$v.InitialTooltip -split "`n")[0].Trim()
  if (-not $name) { $name = (Get-Item $exe).VersionInfo.FileDescription }
  if (-not $name) { $name = [IO.Path]::GetFileNameWithoutExtension($exe) }
  $icon = $null
  if ($v.IconSnapshot) { $icon = 'data:image/png;base64,' + [Convert]::ToBase64String([byte[]]$v.IconSnapshot) }
  $out += [ordered]@{ exe = $exe; name = $name; icon = $icon; promoted = ($v.IsPromoted -eq 1) }
}
[Console]::Out.WriteLine((ConvertTo-Json @($out) -Compress -Depth 3))
