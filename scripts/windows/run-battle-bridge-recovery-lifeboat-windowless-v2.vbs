Option Explicit

Dim shell
Dim localAppData
Dim systemRoot
Dim powerShell
Dim launcher
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")

localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")

powerShell = systemRoot & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcher = localAppData & "\Stephanos\BattleBridgeRecoveryLifeboat\run-battle-bridge-recovery-lifeboat-active-v1.ps1"

command = """" & powerShell & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & launcher & """"
exitCode = shell.Run(command, 0, True)

WScript.Quit exitCode
