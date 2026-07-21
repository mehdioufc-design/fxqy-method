@echo off
setlocal
cd /d "%~dp0"
title TikTok Optimizer - Install

echo.
echo  TikTok Optimizer installer
echo  ==========================
echo.

set "NEED_RESTART=0"

where node.exe >nul 2>&1
if errorlevel 1 (
  where winget.exe >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Node.js is not installed and Windows Package Manager was not found.
    echo Install Node.js 22 or newer from https://nodejs.org/ then run this file again.
    pause
    exit /b 1
  )
  echo Installing Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :install_failed
  set "NEED_RESTART=1"
)

where ffmpeg.exe >nul 2>&1
if errorlevel 1 (
  where winget.exe >nul 2>&1
  if errorlevel 1 (
    echo ERROR: FFmpeg is not installed and Windows Package Manager was not found.
    echo Install FFmpeg from https://ffmpeg.org/download.html then run this file again.
    pause
    exit /b 1
  )
  echo Installing FFmpeg...
  winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :install_failed
  set "NEED_RESTART=1"
)

if "%NEED_RESTART%"=="1" (
  echo.
  echo Prerequisites were installed. Close this window, open the app folder again,
  echo and double-click INSTALL-WINDOWS.cmd one more time to finish installation.
  pause
  exit /b 0
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<13)){console.error('Node.js 22.13 or newer is required. Installed: '+process.versions.node);process.exit(1)}"
if errorlevel 1 (
  echo Update Node.js, then run this installer again.
  pause
  exit /b 1
)

echo Installing application dependencies...
call npm.cmd ci
if errorlevel 1 goto :install_failed

echo Building the application...
call npm.cmd run build
if errorlevel 1 goto :install_failed

echo Creating the desktop shortcut...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-desktop-shortcut.ps1"
if errorlevel 1 echo The shortcut could not be created, but the app is installed.

echo.
echo Installation complete. No account, password, passcode, or secret is required.
echo Open TikTok Optimizer from your desktop, or run START-TIKTOK-OPTIMIZER.cmd.
pause
exit /b 0

:install_failed
echo.
echo Installation did not complete. Review the error above, then run this file again.
pause
exit /b 1
