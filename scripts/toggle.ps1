# toggle.ps1 — enable or disable the dsh-screenshot plugin in the desktop profile.
#
# Usage:
#   pwsh -File toggle.ps1 -Action enable     # add it to the bundle list
#   pwsh -File toggle.ps1 -Action disable    # remove it from the bundle list
#   pwsh -File toggle.ps1 -Action status     # report current state
#   pwsh -File toggle.ps1 -Action restore    # restore the pre-change package.json
#
# Only `dsh.profile.bundles` decides what loads. Editing that single array is the
# whole switch, so a broken plugin can always be turned off without touching
# anything else. A restart is required for either direction.

param(
  [ValidateSet('enable', 'disable', 'status', 'restore')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$ProfileDir = Join-Path $env:DSH_HOME 'profiles\desktop'
$Manifest = Join-Path $ProfileDir 'package.json'
$Backup = 'E:\DeepSeek Harness 工作区\_dsh_upgrade\backup\desktop-profile\package.json.before-screenshot'
$Entry = 'dsh-screenshot'

function Read-Manifest {
  if (-not (Test-Path $Manifest)) { throw "manifest not found: $Manifest" }
  return (Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Write-Manifest($obj) {
  $json = $obj | ConvertTo-Json -Depth 20
  # ConvertTo-Json escapes non-ASCII; write UTF-8 without BOM to keep the file tidy.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Manifest, $json, $utf8)
}

function Get-Bundles($m) { return @($m.dsh.profile.bundles) }

switch ($Action) {
  'status' {
    $m = Read-Manifest
    $bundles = Get-Bundles $m
    $on = $bundles -contains $Entry
    $installed = Test-Path (Join-Path $ProfileDir "node_modules\$Entry")
    Write-Output ("installed: " + $installed)
    Write-Output ("enabled  : " + $on)
    Write-Output ("bundles  : " + $bundles.Count)
    Write-Output ("backup   : " + (Test-Path $Backup))
  }
  'enable' {
    $m = Read-Manifest
    $bundles = Get-Bundles $m
    if ($bundles -contains $Entry) {
      Write-Output 'already enabled'
      break
    }
    $m.dsh.profile.bundles = @($bundles + $Entry)
    Write-Manifest $m
    Write-Output 'enabled (restart DSH to load it)'
  }
  'disable' {
    $m = Read-Manifest
    $bundles = Get-Bundles $m
    if (-not ($bundles -contains $Entry)) {
      Write-Output 'already disabled'
      break
    }
    $m.dsh.profile.bundles = @($bundles | Where-Object { $_ -ne $Entry })
    Write-Manifest $m
    Write-Output 'disabled (restart DSH to unload it)'
  }
  'restore' {
    if (-not (Test-Path $Backup)) { throw "backup not found: $Backup" }
    Copy-Item $Backup $Manifest -Force
    Write-Output 'restored the pre-change package.json (restart DSH)'
  }
}
