@echo off
rem ============================================================
rem  windows-smoke.cmd - ShieldEar v1.3.8 espeak-ng smoke test
rem  Verifies the bundled local synthesis engine in ~10 seconds
rem  WITHOUT starting the full application.
rem
rem  Background: v1.3.7 shipped libespeak_ng.dll (underscore)
rem  while espeak-ng.exe imports libespeak-ng.dll (hyphen),
rem  which made the engine fail with 0xC0000135 on EVERY
rem  Windows machine. v1.3.8 ships both names. This script
rem  also auto-repairs v1.3.7 packages in place (step 0).
rem ============================================================
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo   ShieldEar windows-smoke  -  local synthesis engine test
echo ============================================================
echo.

rem -- [0/3] bundled DLL file-name check (v1.3.7 defect detector)
echo [0/3] Checking espeak-ng DLL file names ...
if exist "espeak-ng\libespeak-ng.dll" (
    echo       OK: espeak-ng\libespeak-ng.dll present
) else (
    if exist "espeak-ng\libespeak_ng.dll" (
        echo       Found libespeak_ng.dll ^(underscore^) but MISSING
        echo       libespeak-ng.dll ^(hyphen^) - this is the v1.3.7 defect.
        echo       Attempting in-place repair ...
        copy /y "espeak-ng\libespeak_ng.dll" "espeak-ng\libespeak-ng.dll" >nul
        if errorlevel 1 goto :fail
        echo       Repaired: both file names now present.
    ) else (
        echo       NEITHER libespeak-ng.dll NOR libespeak_ng.dll found
        echo       inside espeak-ng\ - the package is incomplete.
        goto :fail
    )
)
echo.

rem -- [1/3] version probe (exit 0 proves all DLL imports resolve)
echo [1/3] espeak-ng.exe --version ...
set "ESPEAK_DATA_PATH=%~dp0espeak-ng"
espeak-ng\espeak-ng.exe --version
if errorlevel 1 goto :fail
echo.

rem -- [2/3] Chinese synthesis test (cmn voice, formant engine)
echo [2/3] Synthesizing a Chinese test sentence ...
set "SMOKE_WAV=%TEMP%\shieldear-smoke.wav"
espeak-ng\espeak-ng.exe -v cmn -s 160 -w "%SMOKE_WAV%" "nin hao, zhe shi sheng dun ben di he cheng yin qing de mao yan ce shi"
if errorlevel 1 goto :fail
echo.

rem -- [3/3] output file check
echo [3/3] Checking synthesized WAV ...
if not exist "%SMOKE_WAV%" goto :fail_noout
for %%A in ("%SMOKE_WAV%") do set "SZ=%%~zA"
if "%SZ%"=="" goto :fail_noout
echo       %SMOKE_WAV%   (%SZ% bytes)
if %SZ% LSS 10000 goto :fail_short
echo.

echo ============================================================
echo   PASS  -  the local synthesis engine is HEALTHY.
echo   The "live synthesis" challenge will run for real.
echo.
echo   If the in-app self-check page still shows a red item,
echo   the folder was extracted incompletely or antivirus
echo   quarantined a file: re-extract the full release zip and
echo   add this folder to antivirus exclusions.
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   FAIL  -  last exit code: %ERRORLEVEL%
echo   0xC0000135 (aka -1073741515) means a bundled DLL is
echo   missing or has a wrong file name inside espeak-ng\ :
echo   re-download the FULL release package and re-extract.
echo   Do NOT install any VC++ runtime for this - it will not
echo   help (v1.3.7 misdiagnosed this error code).
echo ============================================================
pause
exit /b 1

:fail_noout
echo   FAIL - no output WAV was produced.
pause
exit /b 1

:fail_short
echo   FAIL - output suspiciously small (%SZ% bytes).
pause
exit /b 1
