# crop.ps1 — crop a PNG to a rectangle and write the result to another PNG.
#
# Output: {"status":"ok","data":{"file":"..","bytes":123,"width":..,"height":..}}
#
# The source rectangle is clamped to the image bounds so a slightly-off selection
# never fails the whole capture.

param(
  [Parameter(Mandatory = $true)][string]$InFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

try {
  if (-not (Test-Path $InFile)) { throw "input not found: $InFile" }
  $src = [System.Drawing.Image]::FromFile($InFile)
  try {
    # Clamp the requested rectangle into the image.
    $x0 = [Math]::Max(0, [Math]::Min($X, $src.Width - 1))
    $y0 = [Math]::Max(0, [Math]::Min($Y, $src.Height - 1))
    $w0 = [Math]::Max(1, [Math]::Min($W, $src.Width - $x0))
    $h0 = [Math]::Max(1, [Math]::Min($H, $src.Height - $y0))

    $dst = New-Object System.Drawing.Bitmap($w0, $h0, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w0, $h0)),
        (New-Object System.Drawing.Rectangle($x0, $y0, $w0, $h0)),
        [System.Drawing.GraphicsUnit]::Pixel)
    } finally { $g.Dispose() }

    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $dst.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
  } finally { $src.Dispose() }

  $bytes = (Get-Item $OutFile).Length
  $safe = $OutFile -replace '\\', '\\'
  Write-Output ('{"status":"ok","data":{"file":"' + $safe + '","bytes":' + $bytes +
    ',"width":' + $w0 + ',"height":' + $h0 + '}}')
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
