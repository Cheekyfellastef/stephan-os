[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$LauncherPid,
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$NodePid
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$expectedLauncher = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os\scripts\windows\run-battle-bridge-recovery-mesh-hidden.ps1'))
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
# WScript.Shell.Run records one additional ASCII separator after the quoted
# executable in Win32_Process.CommandLine. Keep strict full-string equality to
# that observed scheduled-task representation; do not normalize or parse it.
$expectedCommandLine = '"{0}"  -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}"' -f $canonicalPowerShell, $expectedLauncher
$verifier = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$node = Get-CimInstance Win32_Process -Filter "ProcessId = $NodePid"
$launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $LauncherPid"
$nodeExecutableMatches = $node -and [string]::Equals([string]$node.ExecutablePath, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
$launcherExecutableMatches = $launcher -and [string]::Equals([string]$launcher.ExecutablePath, $canonicalPowerShell, [System.StringComparison]::OrdinalIgnoreCase)
$launcherCommandLineMatches = $launcher -and [string]::Equals([string]$launcher.CommandLine, $expectedCommandLine, [System.StringComparison]::OrdinalIgnoreCase)
$processLineageMatches = $false
if ($verifier -and $node -and $launcher) {
    $processLineageMatches = [int]$verifier.ParentProcessId -eq $NodePid -and [int]$node.ParentProcessId -eq $LauncherPid
}
if (-not $processLineageMatches -or -not $nodeExecutableMatches -or -not $launcherExecutableMatches -or -not $launcherCommandLineMatches) {
    throw 'RECOVERY_MESH_LAUNCHER_PROCESS_ATTESTATION_INVALID'
}

$mutex = [System.Threading.Mutex]::OpenExisting('Local\StephanosBattleBridgeRecoveryMeshV1')
try {
    $unexpectedAcquisition = $false
    try { $unexpectedAcquisition = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $unexpectedAcquisition = $true }
    if ($unexpectedAcquisition) {
        $mutex.ReleaseMutex()
        throw 'RECOVERY_MESH_MUTEX_NOT_OWNED_BY_LAUNCHER'
    }
    Write-Output 'MUTEX_OWNERSHIP_VERIFIED=true'
} finally { $mutex.Dispose() }
