@echo off
setlocal
cd /d "%~dp0"
title FXQY Method Local Worker

if not exist "runtime\node.exe" (
  echo FXQY Method is incomplete. Download and extract the portable package again.
  pause
  exit /b 1
)

set "NODE_ENV=production"
set "APP_HOST=127.0.0.1"
set "APP_PORT=3000"
set "APP_ORIGIN=http://127.0.0.1:3000"
set "NEXT_TELEMETRY_DISABLED=1"
set "DATA_ROOT=%LOCALAPPDATA%\FXQY Method\Data"

echo FXQY Method is starting locally on this computer.
echo Your videos are processed by this computer's CPU or supported GPU.
echo Keep the worker window open while using the application.
echo.

start "FXQY Method Local Worker" /min cmd.exe /d /c ""%CD%\runtime\node.exe" "%CD%\scripts\run.mjs" start"

echo Waiting for the local worker...
set "FXQY_READY="
for /l %%I in (1,1,60) do (
  curl.exe --silent --fail --output NUL "http://127.0.0.1:3000/login" >NUL 2>&1 && set "FXQY_READY=1" && goto :worker_ready
  timeout.exe /t 1 /nobreak >NUL
)

echo FXQY Method could not start. Check the worker window for the error.
pause
exit /b 1

:worker_ready
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE%" (
  start "FXQY Method" "%EDGE%" --app="http://127.0.0.1:3000" --start-maximized
) else (
  start "FXQY Method" "http://127.0.0.1:3000"
)

exit /b 0
