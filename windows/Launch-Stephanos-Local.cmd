@echo off
setlocal
title Update + Launch Local Stephanos (Ollama)
set "SCRIPT_DIR=%~dp0"
echo [LAUNCHER LIVE] CMD path: %~f0
echo [LAUNCHER LIVE] Script directory: %SCRIPT_DIR%
echo [LAUNCHER LIVE] PowerShell target: %SCRIPT_DIR%Launch-Stephanos-Local.ps1
echo Update + Launch Local Stephanos (Ollama)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Launch-Stephanos-Local.ps1"
