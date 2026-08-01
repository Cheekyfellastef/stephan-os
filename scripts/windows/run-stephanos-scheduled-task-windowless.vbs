Option Explicit

Dim shell, fileSystem, taskId, scriptDir, repoRoot, expectedRepoRoot
Dim systemRoot, powershellExe, targetPath, command, exitCode

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

If WScript.Arguments.Count <> 1 Then
  WScript.Quit 2
End If

taskId = LCase(Trim(CStr(WScript.Arguments(0))))
scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fileSystem.GetAbsolutePathName(fileSystem.BuildPath(scriptDir, "..\.."))
expectedRepoRoot = fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%USERPROFILE%"), "Documents\GitHub\stephan-os")

If StrComp(repoRoot, expectedRepoRoot, vbTextCompare) <> 0 Then
  WScript.Quit 3
End If

systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
powershellExe = fileSystem.BuildPath(systemRoot, "System32\WindowsPowerShell\v1.0\powershell.exe")

Select Case taskId
  Case "worker-watchdog"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\run-battle-bridge-worker-watchdog-hidden.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "recovery-mesh"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\run-battle-bridge-recovery-mesh-hidden.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "github-sync"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\run-battle-bridge-github-sync-hidden.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "github-command-mailbox"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\run-battle-bridge-github-command-mailbox-hidden.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "mission-worker"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\start-mission-orchestrator-worker.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "backend"
    targetPath = fileSystem.BuildPath(repoRoot, "scripts\windows\start-stephanos-backend.ps1")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)
  Case "openclaw-gateway"
    targetPath = shell.ExpandEnvironmentStrings("%USERPROFILE%\.openclaw\gateway.cmd")
    command = Quote(powershellExe) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command " & Quote("& '" & Replace(targetPath, "'", "''") & "'")
  Case Else
    WScript.Quit 2
End Select

If Not fileSystem.FileExists(targetPath) Then
  WScript.Quit 4
End If

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
