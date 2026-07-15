@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Ignition.ps1"

echo [LAUNCHER LIVE] Full ignition wrapper: %POWERSHELL_TARGET%
if "%~1"=="" (
  echo [LAUNCHER LIVE] No arguments supplied; preserving the full launcher-root cockpit flow and adding the visible AI Core window.
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" -Mode launcher-root -BootMode cockpit
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [LAUNCHER LIVE] Launcher failed in PowerShell step.
  echo Review the full Stephanos ignition splash and bounded logs for the exact blocker.
  pause >nul
)

exit /b %EXIT_CODE%
