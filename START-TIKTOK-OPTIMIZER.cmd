@echo off
setlocal
cd /d "%~dp0"
title TikTok Optimizer

if not exist "node_modules\next\dist\bin\next" (
  echo TikTok Optimizer is not installed yet.
  echo Double-click INSTALL-WINDOWS.cmd first.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo The production build is missing. Running the installer...
  call INSTALL-WINDOWS.cmd
  if errorlevel 1 exit /b 1
)

echo Starting TikTok Optimizer at http://127.0.0.1:3000
echo Keep this window open. Press Ctrl+C here to stop the app.
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-desktop.ps1"
call npm.cmd run start
