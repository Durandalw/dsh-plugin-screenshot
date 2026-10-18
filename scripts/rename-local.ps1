# rename-local.ps1 — align the locally installed copy with the npm package name.
#
# The manifest now publishes as `dsh-plugin-screenshot`, while the desktop profile
# still registers the old bare name `dsh-screenshot` and a directory of that name.
# A mismatch makes the loader fail to resolve the row on the next start, which can
# cascade into the profile bundle list being reset. This script performs the whole
# rename in one step and verifies the result.
#
# Usage:
#   pwsh -File rename-local.ps1            # rename + verify
#   pwsh -File rename-local.ps1 -DryRun    # show what would change

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'

$Old = 'dsh-screenshot'
$New = 'dsh-plugin-screenshot'
$ProfileDir = Join-Path $env:DSH_HOME 'profiles\desktop'
$NodeModules = Join-Path $ProfileDir 'node_modules'
$Manifest = Join-Path $ProfileDir 'package.json'
$BackupDir = 'E:\DeepSeek Harness 工作区\_dsh_upgrade\backup\desktop-profile'
$Source = 'E:\DeepSeek Harness 工作区\dsh-screenshot'

function Step($text) { Write-Output ''; Write-Output "── $text ──" }

Step '0) 前置检查'
$oldDir = Join-Path $NodeModules $Old
$newDir = Join-Path $NodeModules $New
Write-Output ("  旧目录存在 : {0}  {1}" -f (Test-Path $oldDir), $oldDir)
Write-Output ("  新目录存在 : {0}  {1}" -f (Test-Path $newDir), $newDir)
if (-not (Test-Path $oldDir) -and -not (Test-Path $newDir)) {
  throw "两个目录都不存在，无法改名：$oldDir"
}

Step '1) 备份 profile manifest'
if (-not (Test-Path $BackupDir)) { [void](New-Item -ItemType Directory -Path $BackupDir -Force) }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupDir "package.json.before-rename-$stamp"
if (-not $DryRun) {
  Copy-Item $Manifest $backup -Force
  Write-Output "  ✅ 已备份到 $backup"
} else {
  Write-Output "  (dry-run) 将备份到 $backup"
}

Step '2) 重命名 node_modules 目录'
if (Test-Path $newDir) {
  Write-Output '  新目录已存在，跳过'
} elseif ($DryRun) {
  Write-Output "  (dry-run) $oldDir  ->  $newDir"
} else {
  Move-Item $oldDir $newDir
  Write-Output "  ✅ $Old  ->  $New"
}

Step '3) 用最新源码覆盖（保证与发布的包同一份代码）'
if ($DryRun) {
  Write-Output "  (dry-run) 复制 $Source\*  ->  $newDir"
} else {
  Copy-Item (Join-Path $Source '*') $newDir -Recurse -Force
  Write-Output '  ✅ 已同步'
}

Step '4) 更新 profile 的 bundles 与 dependencies'
$pkg = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$bundles = @($pkg.dsh.profile.bundles)
$hadOld = $bundles -contains $Old
$bundles = @($bundles | Where-Object { $_ -ne $Old })
if (-not ($bundles -contains $New)) { $bundles += $New }
Write-Output ("  bundles: 移除 {0} / 新增 {1}" -f $Old, $New)
Write-Output ("  bundles 数量: {0}" -f $bundles.Count)

$deps = $pkg.dependencies
$oldDep = $deps.$Old
if ($oldDep -ne $null) { $deps.PSObject.Properties.Remove($Old) }
$deps | Add-Member -NotePropertyName $New -NotePropertyValue "file:./node_modules/$New" -Force
Write-Output ("  依赖: {0} -> file:./node_modules/{1}" -f $Old, $New)

if ($DryRun) {
  Write-Output '  (dry-run) 未写入 manifest'
} else {
  $pkg.dsh.profile.bundles = $bundles
  $pkg.dependencies = $deps
  $json = $pkg | ConvertTo-Json -Depth 20
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Manifest, $json, $utf8)
  Write-Output '  ✅ manifest 已写入'
}

Step '5) 验证'
if ($DryRun) {
  Write-Output '  (dry-run) 跳过验证'
} else {
  $check = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
  $b = @($check.dsh.profile.bundles)
  Write-Output ("  bundles 含 {0} : {1}" -f $New, ($b -contains $New))
  Write-Output ("  bundles 含 {0} : {1}" -f $Old, ($b -contains $Old))
  Write-Output ("  新目录存在        : {0}" -f (Test-Path (Join-Path $newDir 'lib\index.js')))
  $patch = Get-Content (Join-Path $newDir 'cordis.patch.yml') -Raw
  $m = [regex]::Match($patch, "name:\s*'([^']+)'")
  Write-Output ("  patch 内 name     : {0}" -f $m.Groups[1].Value)
  $man = Get-Content (Join-Path $newDir 'package.json') -Raw | ConvertFrom-Json
  Write-Output ("  包 manifest name  : {0}" -f $man.name)
  Write-Output ("  三者一致          : {0}" -f (($m.Groups[1].Value -eq $New) -and ($man.name -eq $New)))
}

Write-Output ''
Write-Output '完成。重启 DeepSeek Harness 后生效。'
