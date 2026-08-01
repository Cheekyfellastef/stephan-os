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
$expectedCommandLine = '"{0}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{1}"' -f $canonicalPowerShell, $expectedLauncher
$verifier = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$node = Get-CimInstance Win32_Process -Filter "ProcessId = $NodePid"
$launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $LauncherPid"
if (-not $verifier -or -not $node -or -not $launcher
    -or [int]$verifier.ParentProcessId -ne $NodePid -or [int]$node.ParentProcessId -ne $LauncherPid
    -or -not [string]::Equals([string]$node.ExecutablePath, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
    -or -not [string]::Equals([string]$launcher.ExecutablePath, $canonicalPowerShell, [System.StringComparison]::OrdinalIgnoreCase)
    -or -not [string]::Equals([string]$launcher.CommandLine, $expectedCommandLine, [System.StringComparison]::OrdinalIgnoreCase)) {
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
