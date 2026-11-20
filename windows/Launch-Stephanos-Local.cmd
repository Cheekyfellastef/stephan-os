@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Local.ps1"
set "HAS_LAUNCH_ARGUMENTS="
set "UNATTENDED_LAUNCH="
if not "%~1"=="" set "HAS_LAUNCH_ARGUMENTS=1"
:inspect_launch_mode
if "%~1"=="" goto launch_mode_inspected
if /I "%~1"=="-Unattended" set "UNATTENDED_LAUNCH=1"
shift
goto inspect_launch_mode
:launch_mode_inspected

echo [LAUNCHER LIVE] PowerShell target: %POWERSHELL_TARGET%
if not defined HAS_LAUNCH_ARGUMENTS (
  echo [LAUNCHER LIVE] No arguments supplied; defaulting to -Mode launcher-root -BootMode cockpit ^(splash, landing page, and AI Core browser surfaces^).
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" -Mode launcher-root -BootMode cockpit
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [LAUNCHER LIVE] Launcher failed in PowerShell step.
  echo Review the Stephanos ignition splash and bounded logs for the exact blocker.
  if not defined UNATTENDED_LAUNCH pause >nul
)

exit /b %EXIT_CODE%
