@echo off
setlocal

title Update + Launch Local Stephanos (Ollama)
set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_TARGET=%SCRIPT_DIR%Launch-Stephanos-Local.ps1"
set "LOG_FILE="

echo [LAUNCHER LIVE] CMD path: %~f0
echo [LAUNCHER LIVE] Script directory: %SCRIPT_DIR%
echo [LAUNCHER LIVE] PowerShell target: %POWERSHELL_TARGET%
echo Update + Launch Local Stephanos (Ollama)

for %%F in (
  "%SCRIPT_DIR%Launch-Stephanos-Local.log"
  "%SCRIPT_DIR%Launch-Stephanos-Local.ps1.log"
  "%SCRIPT_DIR%logs\Launch-Stephanos-Local.log"
  "%SCRIPT_DIR%..\logs\Launch-Stephanos-Local.log"
) do (
  if not defined LOG_FILE if exist "%%~fF" set "LOG_FILE=%%~fF"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%POWERSHELL_TARGET%"
set "EXIT_CODE=%ERRORLEVEL%"

for %%F in (
  "%SCRIPT_DIR%Launch-Stephanos-Local.log"
  "%SCRIPT_DIR%Launch-Stephanos-Local.ps1.log"
  "%SCRIPT_DIR%logs\Launch-Stephanos-Local.log"
  "%SCRIPT_DIR%..\logs\Launch-Stephanos-Local.log"
) do (
  if not defined LOG_FILE if exist "%%~fF" set "LOG_FILE=%%~fF"
)

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Stephanos launcher failed. Press any key to close.
  if defined LOG_FILE (
    echo Log file: %LOG_FILE%
  )
  pause
)

exit /b %EXIT_CODE%
