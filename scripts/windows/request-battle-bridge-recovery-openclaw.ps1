[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-f0-9]{32}$')]
    [string]$OpenClawHostProofId
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$route = 'OPENCLAW_WHATSAPP'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$requestRoot = Join-Path $workspaceRoot 'requests\battle-bridge-recovery'
$evidenceRoot = Join-Path $workspaceRoot 'receipts\battle-bridge-recovery-auth'
$openClawProofRoot = Join-Path $workspaceRoot 'receipts\openclaw-authenticated-command'
$hostProofPath = Join-Path $openClawProofRoot "$OpenClawHostProofId.json"
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$wscriptPath = 'C:\Windows\System32\wscript.exe'

function Assert-NoReparseAncestor {
    param([string]$TargetPath)
    $cursor = [System.IO.Path]::GetFullPath($TargetPath)
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'RECOVERY_PATH_REPARSE_ANCESTOR_REJECTED' }
        }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
}

if (-not ('StephanosOpenClawRecoveryPathIdentity' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class StephanosOpenClawRecoveryPathIdentity {
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION {
        public uint FileAttributes; public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime; public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber; public uint FileSizeHigh; public uint FileSizeLow; public uint NumberOfLinks;
        public uint FileIndexHigh; public uint FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out BY_HANDLE_FILE_INFORMATION info);
    public static string Read(string path) {
        const uint shareAll = 1 | 2 | 4, openExisting = 3, backupSemantics = 0x02000000, openReparsePoint = 0x00200000, reparsePoint = 0x400;
        using (var handle = CreateFile(path, 0, shareAll, IntPtr.Zero, openExisting, backupSemantics | openReparsePoint, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.FileAttributes & reparsePoint) != 0) throw new InvalidOperationException("RECOVERY_PATH_REPARSE_ANCESTOR_REJECTED");
            return info.VolumeSerialNumber.ToString("x8") + ":" + info.FileIndexHigh.ToString("x8") + info.FileIndexLow.ToString("x8") + ":" + info.FileAttributes.ToString("x8");
        }
    }
}
'@
}

function Get-PathIdentityBaseline {
    param([string[]]$TargetPaths)
    $baseline = @{}
    foreach ($target in $TargetPaths) {
        $cursor = [System.IO.Path]::GetFullPath($target)
        while (-not [string]::IsNullOrWhiteSpace($cursor)) {
            if (Test-Path -LiteralPath $cursor) { $baseline[$cursor] = [StephanosOpenClawRecoveryPathIdentity]::Read($cursor) }
            $parent = Split-Path -Parent $cursor
            if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) { break }
            $cursor = $parent
        }
    }
    return $baseline
}

function Assert-StablePathBaseline {
    param([hashtable]$Baseline)
    foreach ($entry in $Baseline.GetEnumerator()) {
        if (-not (Test-Path -LiteralPath $entry.Key)) { throw 'RECOVERY_PATH_ANCESTOR_IDENTITY_CHANGED' }
        if (-not [string]::Equals([StephanosOpenClawRecoveryPathIdentity]::Read($entry.Key), [string]$entry.Value, [System.StringComparison]::Ordinal)) {
            throw 'RECOVERY_PATH_ANCESTOR_IDENTITY_CHANGED'
        }
    }
}

function Write-ExclusiveUtf8Json {
    param([string]$Path, [object]$Value)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8))
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

foreach ($target in @($workspaceRoot, $requestRoot, $evidenceRoot, $openClawProofRoot, $hostProofPath)) {
    Assert-NoReparseAncestor -TargetPath $target
}
foreach ($directory in @($requestRoot, $evidenceRoot, $openClawProofRoot)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$pathBaseline = Get-PathIdentityBaseline -TargetPaths @($workspaceRoot, $requestRoot, $evidenceRoot, $openClawProofRoot, $hostProofPath)

if (-not (Test-Path -LiteralPath $hostProofPath -PathType Leaf)) { throw 'OPENCLAW_HOST_PROOF_REQUIRED' }
$hostProof = Get-Content -LiteralPath $hostProofPath -Raw | ConvertFrom-Json
Assert-StablePathBaseline -Baseline $pathBaseline
$hostNow = [DateTimeOffset]::UtcNow
$hostIssuedAt = [DateTimeOffset]::Parse([string]$hostProof.issuedAtUtc)
$hostExpiresAt = [DateTimeOffset]::Parse([string]$hostProof.expiresAtUtc)
if ([string]$hostProof.schemaVersion -ne 'stephanos.openclaw-authenticated-recovery-command.v1'
    -or [string]$hostProof.proofId -ne $OpenClawHostProofId
    -or [string]$hostProof.route -ne $route
    -or [string]$hostProof.command -ne 'wake'
    -or [string]$hostProof.subject -ne 'openclaw:authenticated-operator'
    -or [string]$hostProof.commandSurface -ne 'openclaw.plugin-sdk.authenticated-command'
    -or [string]$hostProof.runtimeId -notmatch '^(openclaw-plugin-host:[1-9][0-9]*|[A-Za-z0-9][A-Za-z0-9._:-]{7,120})$'
    -or $hostProof.authenticatedByHost -ne $true
    -or $hostIssuedAt -lt $hostNow.AddSeconds(-60)
    -or $hostIssuedAt -gt $hostNow.AddSeconds(30)
    -or $hostExpiresAt -le $hostNow
    -or $hostExpiresAt -le $hostIssuedAt
    -or ($hostExpiresAt - $hostIssuedAt).TotalSeconds -gt 60) {
    throw 'OPENCLAW_HOST_PROOF_INVALID'
}

$currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
$hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)" -ErrorAction SilentlyContinue
if (-not $hostProcess
    -or [int]$hostProof.hostPid -ne [int]$hostProcess.ProcessId
    -or [string]$hostProcess.Name -notin @('node.exe','node','openclaw.exe','openclaw')
    -or [string]$hostProcess.CommandLine -notmatch '(?i)openclaw') {
    throw 'OPENCLAW_HOST_PROCESS_IDENTITY_INVALID'
}
$gatewayListener = Get-NetTCPConnection -State Listen -LocalPort 18789 -ErrorAction Stop | Where-Object {
    $_.OwningProcess -eq [int]$hostProof.hostPid -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::')
} | Select-Object -First 1
if (-not $gatewayListener) { throw 'OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID' }
if ([string]$hostProof.runtimeId -like 'openclaw-plugin-host:*'
    -and -not [string]::Equals([string]$hostProof.runtimeId, "openclaw-plugin-host:$($hostProcess.ProcessId)", [System.StringComparison]::Ordinal)) {
    throw 'OPENCLAW_GATEWAY_RUNTIME_IDENTITY_INVALID'
}

$hostClaimPath = "$hostProofPath.claim"
Assert-StablePathBaseline -Baseline $pathBaseline
try {
    $hostClaim = [System.IO.File]::Open($hostClaimPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $hostClaim.Flush($true) } finally { $hostClaim.Dispose() }
} catch [System.IO.IOException] { throw 'OPENCLAW_HOST_PROOF_ALREADY_CONSUMED' }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { throw 'RECOVERY_MESH_TASK_NOT_INSTALLED' }
if ([string]$task.TaskPath -ne '\' -or $task.Actions.Count -ne 1) { throw 'RECOVERY_MESH_TASK_ACTION_INVALID' }
$taskAction = $task.Actions[0]
$taskExecute = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$taskAction.Execute))
$expectedArguments = "//B //NoLogo `"$launcherPath`" recovery-mesh"
if (-not [string]::Equals($taskExecute, $wscriptPath, [System.StringComparison]::OrdinalIgnoreCase)
    -or -not [string]::Equals(([string]$taskAction.Arguments).Trim(), $expectedArguments, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'RECOVERY_MESH_TASK_ACTION_INVALID'
}
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
if (-not [string]::Equals([string]$task.Principal.UserId, $currentUser, [System.StringComparison]::OrdinalIgnoreCase)
    -or [string]$task.Principal.LogonType -ne 'Interactive'
    -or [string]$task.Principal.RunLevel -ne 'Limited') { throw 'RECOVERY_MESH_TASK_PRINCIPAL_INVALID' }
if ([string]$task.Settings.MultipleInstances -ne 'IgnoreNew'
    -or $task.Settings.Hidden -ne $true
    -or $task.Settings.StartWhenAvailable -ne $true
    -or $task.Settings.DisallowStartIfOnBatteries -ne $false
    -or $task.Settings.StopIfGoingOnBatteries -ne $false
    -or [string]$task.Settings.ExecutionTimeLimit -ne 'PT3M') { throw 'RECOVERY_MESH_TASK_SETTINGS_INVALID' }

$now = [DateTimeOffset]::UtcNow
$requestId = "recovery-openclaw-$OpenClawHostProofId"
$upstreamProofRef = "receipts/openclaw-authenticated-command/$OpenClawHostProofId.json"
$authenticationProofRef = "receipts/battle-bridge-recovery-auth/${requestId}.json"
$authenticationRecord = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-auth-receipt.v1'
    requestId = $requestId
    route = $route
    issuer = 'openclaw-authenticated-command'
    subject = 'openclaw:authenticated-operator'
    upstreamProofRef = $upstreamProofRef
    issuedAtUtc = $now.ToString('o')
    expiresAtUtc = $now.AddMinutes(5).ToString('o')
    verifiedByFixedAdapter = $true
    authorityHead = ''
    hostProofConsumed = $true
}
$authenticationPath = Join-Path $evidenceRoot "${requestId}.json"
$authenticationTemporaryPath = "${authenticationPath}.${PID}.$([Guid]::NewGuid().ToString('N')).tmp"
Assert-StablePathBaseline -Baseline $pathBaseline
Write-ExclusiveUtf8Json -Path $authenticationTemporaryPath -Value $authenticationRecord
Assert-StablePathBaseline -Baseline $pathBaseline
Move-Item -LiteralPath $authenticationTemporaryPath -Destination $authenticationPath

$request = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-ingress.v1'
    requestId = $requestId
    route = $route
    action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'
    issuedAtUtc = $now.ToString('o')
    expiresAtUtc = $now.AddMinutes(5).ToString('o')
    sourceReceipt = $upstreamProofRef
    authenticationEvidence = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-auth-evidence.v1'
        route = $route
        issuer = 'openclaw-authenticated-command'
        subject = 'openclaw:authenticated-operator'
        proofRef = $authenticationProofRef
        verified = $true
    }
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    sourceMutationAllowed = $false
}
$requestPath = Join-Path $requestRoot 'openclaw_whatsapp.json'
$temporaryPath = "${requestPath}.${PID}.$([Guid]::NewGuid().ToString('N')).tmp"
Assert-StablePathBaseline -Baseline $pathBaseline
Write-ExclusiveUtf8Json -Path $temporaryPath -Value $request
Assert-StablePathBaseline -Baseline $pathBaseline
Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force

$taskStateBefore = [string]$task.State
$startAttempted = $false
if ($taskStateBefore -ne 'Running') {
    $startAttempted = $true
    try {
        Start-ScheduledTask -TaskName $taskName
    } catch {
        $taskAfterFailure = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $taskAfterFailure -or [string]$taskAfterFailure.State -ne 'Running') { throw 'RECOVERY_MESH_TASK_START_FAILED' }
    }
}

[pscustomobject]@{
    requestId = $requestId
    route = $route
    queued = $true
    coordinatorTask = $taskName
    coordinatorStateBefore = $taskStateBefore
    startAttempted = $startAttempted
    arbitraryShellAllowed = $false
    sourceMutationAllowed = $false
} | ConvertTo-Json
