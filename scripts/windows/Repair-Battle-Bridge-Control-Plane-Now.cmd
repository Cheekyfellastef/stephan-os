@echo off
setlocal
title Repair Stephanos Battle Bridge
set "SCRIPT=%USERPROFILE%\Documents\GitHub\stephan-os\scripts\windows\repair-battle-bridge-control-plane-now.ps1"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo.
echo Repairing the existing Stephanos Battle Bridge control plane.
echo This uses no Tailscale credential setup and creates no new worker.
echo.

if not exist "%POWERSHELL%" (
  echo BLOCKED: Fixed Windows PowerShell executable is missing.
  pause
  exit /b 1
)
if not exist "%SCRIPT%" (
  echo BLOCKED: Stephanos rescue source is missing from the canonical checkout.
  pause
  exit /b 1
)

"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo Stephanos rescue stopped safely. The blocker is shown above.
  pause
  exit /b %EXITCODE%
)

echo Battle Bridge control plane restored, the existing mailbox started, and Remote Codex attachment proven.
echo Forge remains gated until its real Windows proof completes.
pause
exit /b 0
