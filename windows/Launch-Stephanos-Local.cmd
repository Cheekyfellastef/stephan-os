@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Local.ps1"

echo [LAUNCHER LIVE] PowerShell target: %POWERSHELL_TARGET%
if "%~1"=="" (
  echo [LAUNCHER LIVE] No arguments supplied; defaulting to -Mode launcher-root -BootMode cockpit (auto-open is default in launcher-root).
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" -Mode launcher-root -BootMode cockpit
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [LAUNCHER LIVE] Launcher failed in PowerShell step.
  echo Press any key to keep this window open and review the failure.
  pause >nul
)

exit /b %EXIT_CODE%
