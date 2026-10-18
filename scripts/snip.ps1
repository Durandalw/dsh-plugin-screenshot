# snip.ps1 — capture the desktop with the owning window kept out of the frame,
# doing the whole hide / capture / restore sequence inside ONE PowerShell process.
#
# Why one process matters: performing the three steps as three separate pwsh calls
# costs ~1.1s of startup each, so the window stays invisible for over a second and
# the restore step can fail on its own, leaving the window hidden for good. Doing it
# here drops the invisible window to ~380ms and makes the restore part of a finally
# block, so it cannot be skipped.
#
# Reported as a single JSON line, like the other helpers in this directory.
#
# Usage:
#   pwsh -File snip.ps1 -Hwnd <handle> -OutFile <png> -HideOwn
#   pwsh -File snip.ps1 -Hwnd <handle> -OutFile <png>              # leave it in frame

param(
  [long]$Hwnd = 0,
  [Parameter(Mandatory = $true)][string]$OutFile,
  # Hide the window for the capture. Without it the window stays in the picture.
  [switch]$HideOwn,
  # Extra wait after DwmFlush, in milliseconds.
  #
  # SW_HIDE only clears WS_VISIBLE; actually removing the pixels from the screen is
  # DWM's asynchronous job. A wait that is too short captures a mid-composition frame,
  # which shows the window ghosting/torn in the result. The default is deliberately
  # generous rather than tuned to one machine: an earlier 50ms default worked on a
  # 150%-scaled 2560x1600 desktop with pwsh 7 but produced exactly that ghosting on a
  # different machine, because the required delay depends on the compositor, not on us.
  # DwmFlush below absorbs most of it; this is the safety margin on top.
  [int]$Settle = 250
)

$ErrorActionPreference = 'Stop'

# Required explicitly: Windows PowerShell 5.1 does not auto-load System.Drawing, and
# this script was the only one using its types without asking for the assembly.
# (shot/crop/clip all load it; PowerShell 7 auto-loads it, so the omission only
# surfaces on machines that have no pwsh — where this script is the whole capture path.)
Add-Type -AssemblyName System.Drawing

Add-Type -Namespace SN -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("dwmapi.dll")] public static extern int DwmFlush();
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

function Get-ScreenSize {
  # SM_CXVIRTUALSCREEN(78) / SM_CYVIRTUALSCREEN(79), in real pixels for a DPI-aware
  # process — the same coordinate space the capture uses.
  $w = [SN.Native]::GetSystemMetrics(78)
  $h = [SN.Native]::GetSystemMetrics(79)
  # Physical-pixel fallback if the virtual metrics are unavailable.
  if ($w -le 0) { $w = [SN.Native]::GetSystemMetrics(0) }
  if ($h -le 0) { $h = [SN.Native]::GetSystemMetrics(1) }
  return @($w, $h)
}

function Get-Rect([IntPtr]$h) {
  $r = New-Object SN.Native+RECT
  [void][SN.Native]::GetWindowRect($h, [ref]$r)
  return $r
}

try {
  [void][SN.Native]::SetProcessDPIAware()

  $h = [IntPtr]$Hwnd
  $size = Get-ScreenSize
  $screenW = $size[0]
  $screenH = $size[1]

  $orig = $null
  $hidden = $false
  if ($HideOwn -and $Hwnd -ne 0) {
    $orig = Get-Rect $h
    [void][SN.Native]::ShowWindow($h, 0)   # SW_HIDE
    $hidden = $true
    # Block until DWM has completed a composition pass, so the removal of the window
    # is actually on screen before GDI reads the framebuffer. Without this the capture
    # can land on a half-composed frame and show the window as a ghost.
    [void][SN.Native]::DwmFlush()
    if ($Settle -gt 0) { Start-Sleep -Milliseconds $Settle }
  }

  try {
    $bmp = New-Object System.Drawing.Bitmap($screenW, $screenH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size($screenW, $screenH)), [System.Drawing.CopyPixelOperation]::SourceCopy)
    } finally { $g.Dispose() }

    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  } finally {
    if ($hidden) {
      # A window hidden with SW_HIDE loses its activation, so SW_SHOW alone can leave
      # it visible-but-buried. Restore the frame, re-assert visibility, then take the
      # foreground back — the same sequence win.ps1 -Action show uses. This lives in
      # `finally` so an exception during capture can never leave the window hidden.
      [void][SN.Native]::ShowWindow($h, 9)   # SW_RESTORE
      [void][SN.Native]::ShowWindow($h, 5)   # SW_SHOW
      [void][SN.Native]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0003)  # TOPMOST | NOSIZE | NOMOVE
      [void][SN.Native]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0003)  # NOTOPMOST
      [void][SN.Native]::SetForegroundWindow($h)
      [void][SN.Native]::ShowWindow($h, 5)
    }
  }

  $bytes = (Get-Item $OutFile).Length
  $safePath = $OutFile -replace '\\', '\\'
  $vis = if ($Hwnd -ne 0) { [SN.Native]::IsWindowVisible($h) } else { $false }
  $restored = $true
  if ($hidden -and $orig -ne $null) {
    $now = Get-Rect $h
    $restored = ($now.Left -eq $orig.Left) -and ($now.Top -eq $orig.Top)
  }

  Write-Output ('{"status":"ok","data":{"file":"' + $safePath + '","bytes":' + $bytes +
    ',"width":' + $screenW + ',"height":' + $screenH +
    ',"x":0,"y":0' +
    ',"hidOwn":' + $(if ($hidden) { 'true' } else { 'false' }) +
    ',"origAt":' + $(if ($orig -ne $null) { '{"x":' + $orig.Left + ',"y":' + $orig.Top + '}' } else { 'null' }) +
    ',"windowVisible":' + $(if ($vis) { 'true' } else { 'false' }) +
    ',"restored":' + $(if ($restored) { 'true' } else { 'false' }) +
    ',"screen":{"x":0,"y":0,"width":' + $screenW + ',"height":' + $screenH + '}}}')
}
catch {
  $msg = $_.Exception.Message
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $msg.ToCharArray()) {
    $c = [int]$ch
    if ($c -ge 0x20 -and $c -le 0x7E) {
      if ($ch -eq '"' -or $ch -eq '\') { [void]$sb.Append('\') }
      [void]$sb.Append($ch)
    }
  }
  Write-Output ('{"status":"error","error":"' + $sb.ToString() + '"}')
  exit 1
}
