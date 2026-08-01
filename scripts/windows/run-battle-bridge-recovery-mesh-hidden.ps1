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

    # Only the OS-owned named mutex may reclaim a dead runner's fixed lock.
    $lockPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\locks\battle-bridge-recovery-mesh.lock'
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        try {
            $lockRecord = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            $ownerAlive = $null -ne (Get-Process -Id ([int]$lockRecord.pid) -ErrorAction SilentlyContinue)
            if (-not $ownerAlive) { [System.IO.File]::Delete($lockPath) }
        } catch { exit 4 }
    }

    $env:STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'
    & $node.Source $runnerPath *> $null
    exit $LASTEXITCODE
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
