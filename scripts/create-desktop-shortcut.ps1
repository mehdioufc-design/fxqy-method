$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot "START-TIKTOK-OPTIMIZER.cmd"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "TikTok Optimizer.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Open TikTok Optimizer"
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,220"
$shortcut.Save()

Write-Output "Desktop shortcut created: $shortcutPath"
