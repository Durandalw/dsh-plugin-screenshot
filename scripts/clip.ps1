# clip.ps1 — put a PNG file on the system clipboard as an image.
#
# Output: {"status":"ok","data":{"file":"..","bytes":123}}
#
# Clipboard access needs a single-threaded apartment; the host invokes this script
# with -STA. A short retry loop covers the case where another process is holding
# the clipboard open for a moment.

param(
  [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

try {
  if (-not (Test-Path $File)) { throw "image not found: $File" }
  $img = [System.Drawing.Image]::FromFile($File)
  $copied = $false
  try {
    for ($i = 0; $i -lt 8; $i++) {
      try {
        [System.Windows.Forms.Clipboard]::SetImage($img)
        $copied = $true
        break
      } catch {
        Start-Sleep -Milliseconds 120
      }
    }
    if (-not $copied) { throw 'clipboard is busy (another process holds it)' }
  } finally { $img.Dispose() }

  $bytes = (Get-Item $File).Length
  $safe = $File -replace '\\', '\\'
  Write-Output ('{"status":"ok","data":{"file":"' + $safe + '","bytes":' + $bytes + '}}')
}
catch {
  $msg = $_.Exception.Message
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $msg.ToCharArray()) {
    $c = [int]$ch
    if ($c -ge 0x20 -and $c -le 0x7E) { if ($ch -eq '"' -or $ch -eq '\') { [void]$sb.Append('\') }; [void]$sb.Append($ch) }
    else { [void]$sb.Append(' ') }
  }
  Write-Output ('{"status":"error","error":"' + $sb.ToString() + '"}')
  exit 1
}
