[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if ([System.IO.Path]::GetFullPath($repoRoot) -ne $expectedRepoRoot) { throw "Recovery mesh must run from $expectedRepoRoot" }
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\battle-bridge-recovery-mesh.mjs')).Path
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction Stop }
$mutex = New-Object System.Threading.Mutex($false, 'Local\StephanosBattleBridgeRecoveryMeshV1')
$mutexHeld = $false
try {
    try { $mutexHeld = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) { exit 3 }

    # Holding the OS-owned named mutex proves that no recovery runner owns the
    # advisory Node lock. Reclaim it regardless of PID reuse.
    $lockPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\locks\battle-bridge-recovery-mesh.lock'
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        try {
            $lockRecord = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            if ([int]$lockRecord.pid -le 0 -or [string]$lockRecord.token -notmatch '^[a-f0-9-]{36}$') { exit 4 }
            $lockItem = Get-Item -LiteralPath $lockPath -Force
            if (($lockItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { exit 4 }
            [System.IO.File]::Delete($lockPath)
        } catch { exit 4 }
    }

    $env:STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'
    $env:STEPHANOS_RECOVERY_MESH_LAUNCHER_PID = [string]$PID
    & $node.Source $runnerPath *> $null
    exit $LASTEXITCODE
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
