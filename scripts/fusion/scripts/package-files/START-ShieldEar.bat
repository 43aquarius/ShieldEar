@echo off
chcp 65001 >nul
title ShieldEar v1.3.3 - Offline Mode
cd /d "%~dp0server"

rem ============================================================
rem  Default: OFFLINE mode (no SHIELD_TTS_ONLINE set)
rem  Cloud TTS channels stay OFF: zero network, zero wait.
rem  To enable cloud channels for comparison, remove the "rem"
rem  on the line below, or just use the switch in the web UI.
rem ============================================================
rem set "SHIELD_TTS_ONLINE=1"
set "DATABASE_URL=file:./db/custom.db"
set "PORT=3000"
set "HOSTNAME=127.0.0.1"

echo ============================================================
echo   ShieldEar v1.3.3 - AI Voice Fraud Detection Platform
echo   Dalian University of Technology - InfoSec Competition
echo ============================================================
echo.
echo   [Mode]  Offline - no external network access
echo   [URL]   http://127.0.0.1:3000  (browser opens shortly)
echo   [Stop]  Close this window to exit
echo.
echo   Starting, please wait 3-8 seconds...
echo.

start "" /b cmd /c "timeout /t 4 >nul & start http://127.0.0.1:3000"

"..\node.exe" boot.js
pause
