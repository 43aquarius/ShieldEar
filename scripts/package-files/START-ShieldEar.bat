@echo off
chcp 65001 >nul
title ShieldEar v1.3.5 - Offline Edition
cd /d "%~dp0server"

rem ============================================================
rem  ShieldEar v1.3.5 - Pure Offline Edition
rem  This release contains NO cloud channels at all:
rem  synthesis / detection / evidence - all local, zero network.
rem  (SHIELD_RELEASE_OFFLINE is set by server\boot.js)
rem ============================================================
set "DATABASE_URL=file:./db/custom.db"
set "PORT=3000"
set "HOSTNAME=127.0.0.1"

echo ============================================================
echo   ShieldEar v1.3.5 - AI Voice Fraud Detection Platform
echo   Dalian University of Technology - InfoSec Competition
echo ============================================================
echo.
echo   [Mode]  Pure Offline - no cloud channels in this build
echo   [URL]   http://127.0.0.1:3000  (browser opens shortly)
echo   [Stop]  Close this window to exit
echo.
echo   Starting, please wait 3-8 seconds...
echo.

start "" /b cmd /c "timeout /t 4 >nul & start http://127.0.0.1:3000"

"..\node.exe" boot.js
pause
