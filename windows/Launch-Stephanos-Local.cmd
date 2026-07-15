@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Ignition.ps1"

echo [LAUNCHER LIVE] Ignition target: %POWERSHELL_TARGET%
if "%~1"=="" (
  echo [LAUNCHER LIVE] Starting splash-driven Stephanos ignition.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [LAUNCHER LIVE] Stephanos ignition stopped safely.
  echo Review the splash screen for the exact blocker.
  pause >nul
)

exit /b %EXIT_CODE%
