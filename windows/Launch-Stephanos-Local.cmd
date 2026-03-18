@echo off
setlocal
title Update + Launch Local Stephanos (Ollama)
set "SCRIPT_DIR=%~dp0"
echo Update + Launch Local Stephanos (Ollama)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Launch-Stephanos-Local.ps1"
