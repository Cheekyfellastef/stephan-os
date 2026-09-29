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
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) { throw "Canonical Node executable missing: $nodeExecutable" }
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$launchStatusPath = Join-Path $workspaceRoot 'status\battle-bridge-recovery-mesh-launch-current.json'

function Write-RecoveryMeshLaunchStatus {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'RECOVERY_MESH_HIDDEN_WRAPPER_STARTED',
            'RECOVERY_MESH_MUTEX_BUSY',
            'RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED',
            'RECOVERY_MESH_RUNNER_STARTING',
            'RECOVERY_MESH_RUNNER_COMPLETED',
            'RECOVERY_MESH_RUNNER_FAILED',
            'RECOVERY_MESH_HIDDEN_WRAPPER_FAILED'
        )]
        [string]$Classification,
        [bool]$RunnerStarted = $false,
        [bool]$RunnerCompleted = $false,
        [int]$RunnerExitCode = -1,
        [bool]$RunnerResultParsed = $false,
        [string]$RunnerClassification = ''
    )

    $statusDirectory = Split-Path -Parent $launchStatusPath
    New-Item -ItemType Directory -Path $statusDirectory -Force | Out-Null
    $temporaryPath = "${launchStatusPath}.$PID.tmp"
    $isBlocked = $Classification -match '(?:FAILED|BUSY|BLOCKED)'
    $record = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-mesh-launch.v1'
        timestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        status = $Classification
        classification = $Classification
        blocker = if ($isBlocked) { $Classification } else { '' }
        hiddenWrapperStarted = $true
        runnerStarted = $RunnerStarted
        runnerCompleted = $RunnerCompleted
        runnerExitCode = $RunnerExitCode
        runnerResultParsed = $RunnerResultParsed
        runnerClassification = $RunnerClassification
        visiblePowerShellRequired = $false
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        sourceMutationAllowed = $false
        pcRestartAllowed = $false
    }
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $launchStatusPath -Force
}

trap {
    try { Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_HIDDEN_WRAPPER_FAILED' } catch {}
    exit 2
}

Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_HIDDEN_WRAPPER_STARTED'

if (-not ('StephanosRecoveryMeshLauncherPathIdentity' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class StephanosRecoveryMeshLauncherPathIdentity {
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION {
        public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime; public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber; public uint FileSizeHigh; public uint FileSizeLow; public uint NumberOfLinks;
        public uint FileIndexHigh; public uint FileIndexLow;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO { [MarshalAs(UnmanagedType.Bool)] public bool DeleteFile; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int fileInformationClass, ref FILE_DISPOSITION_INFO info, uint size);
    private const uint ShareAll = 1 | 2 | 4, OpenExisting = 3, BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    private const uint ReparsePoint = 0x400, DeleteAccess = 0x00010000;
    private static string Identity(BY_HANDLE_FILE_INFORMATION info) {
        return info.VolumeSerialNumber.ToString("x8") + ":" + info.FileIndexHigh.ToString("x8") + info.FileIndexLow.ToString("x8") + ":" + info.FileAttributes.ToString("x8") + ":" + info.NumberOfLinks;
    }
    private static BY_HANDLE_FILE_INFORMATION ReadInfo(SafeFileHandle handle, bool requireSingleLink) {
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.FileAttributes & ReparsePoint) != 0) throw new InvalidOperationException("RECOVERY_LOCK_REPARSE_ANCESTOR_REJECTED");
        if (requireSingleLink && info.NumberOfLinks != 1) throw new InvalidOperationException("RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED");
        return info;
    }
    public static string Read(string path, bool requireSingleLink) {
        using (var handle = CreateFile(path, 0, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            return Identity(ReadInfo(handle, requireSingleLink));
        }
    }
    public static SafeFileHandle OpenVerifiedForDelete(string path, string expectedIdentity) {
        var handle = CreateFile(path, DeleteAccess, 0, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            if (!String.Equals(Identity(ReadInfo(handle, true)), expectedIdentity, StringComparison.Ordinal)) {
                throw new InvalidOperationException("RECOVERY_LOCK_IDENTITY_CHANGED");
            }
            return handle;
        } catch { handle.Dispose(); throw; }
    }
    public static void DeleteByHandle(SafeFileHandle handle) {
        var disposition = new FILE_DISPOSITION_INFO { DeleteFile = true };
        if (!SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO)))) {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
}

function Get-RecoveryLockPathBaseline {
    param([string]$TargetPath)
    $baseline = @{}
    $cursor = [System.IO.Path]::GetFullPath($TargetPath)
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path -LiteralPath $cursor) { $baseline[$cursor] = [StephanosRecoveryMeshLauncherPathIdentity]::Read($cursor, $false) }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $baseline
}

function Assert-RecoveryLockPathBaseline {
    param([hashtable]$Baseline)
    foreach ($entry in $Baseline.GetEnumerator()) {
        if (-not (Test-Path -LiteralPath $entry.Key)) { throw 'RECOVERY_LOCK_ANCESTOR_IDENTITY_CHANGED' }
        if (-not [string]::Equals([StephanosRecoveryMeshLauncherPathIdentity]::Read($entry.Key, $false), [string]$entry.Value, [System.StringComparison]::Ordinal)) {
            throw 'RECOVERY_LOCK_ANCESTOR_IDENTITY_CHANGED'
        }
    }
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\StephanosBattleBridgeRecoveryMeshV1')
$mutexHeld = $false
try {
    try { $mutexHeld = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mutexHeld = $true }
    if (-not $mutexHeld) {
        Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_MUTEX_BUSY'
        exit 3
    }

    # Holding the OS-owned named mutex proves that no recovery runner owns the
    # advisory Node lock. Reclaim it regardless of PID reuse.
    $lockPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\locks\battle-bridge-recovery-mesh.lock'
    $lockPathBaseline = Get-RecoveryLockPathBaseline -TargetPath $lockPath
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        try {
            $lockRecord = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
            if ([int]$lockRecord.pid -le 0 -or [string]$lockRecord.token -notmatch '^[a-f0-9-]{36}$') { throw 'RECOVERY_LOCK_RECORD_INVALID' }
            $lockIdentity = [StephanosRecoveryMeshLauncherPathIdentity]::Read($lockPath, $true)
            Assert-RecoveryLockPathBaseline -Baseline $lockPathBaseline
            $lockHandle = [StephanosRecoveryMeshLauncherPathIdentity]::OpenVerifiedForDelete($lockPath, $lockIdentity)
            try {
                Assert-RecoveryLockPathBaseline -Baseline $lockPathBaseline
                [StephanosRecoveryMeshLauncherPathIdentity]::DeleteByHandle($lockHandle)
            } finally { $lockHandle.Dispose() }
        } catch {
            Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_STALE_LOCK_RECLAIM_FAILED'
            exit 4
        }
    }

    $env:STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'
    $env:STEPHANOS_RECOVERY_MESH_LAUNCHER_PID = [string]$PID
    Write-RecoveryMeshLaunchStatus -Classification 'RECOVERY_MESH_RUNNER_STARTING' -RunnerStarted $true
    $runnerOutput = @(& $nodeExecutable $runnerPath 2>&1)
    $runnerExitCode = $LASTEXITCODE
    $runnerText = ($runnerOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $runnerResult = $null
    try { $runnerResult = $runnerText | ConvertFrom-Json } catch { $runnerResult = $null }
    $runnerResultParsed = $null -ne $runnerResult
    $runnerClassification = if ($runnerResultParsed) { [string]$runnerResult.classification } else { '' }
    if ($runnerResultParsed -and $runnerExitCode -eq 0) {
        Write-RecoveryMeshLaunchStatus `
            -Classification 'RECOVERY_MESH_RUNNER_COMPLETED' `
            -RunnerStarted $true `
            -RunnerCompleted $true `
            -RunnerExitCode $runnerExitCode `
            -RunnerResultParsed $true `
            -RunnerClassification $runnerClassification
    } else {
        Write-RecoveryMeshLaunchStatus `
            -Classification 'RECOVERY_MESH_RUNNER_FAILED' `
            -RunnerStarted $true `
            -RunnerCompleted $true `
            -RunnerExitCode $runnerExitCode `
            -RunnerResultParsed $runnerResultParsed `
            -RunnerClassification $runnerClassification
    }
    exit $runnerExitCode
} finally {
    if ($mutexHeld) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
