[CmdletBinding(DefaultParameterSetName = 'Wake')]
param(
    [Parameter(ParameterSetName = 'Wake', Mandatory = $true)]
    [ValidateSet('GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')]
    [string]$Route,
    [Parameter(ParameterSetName = 'Wake')]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$')]
    [string]$EvidenceIssuer = '',
    [Parameter(ParameterSetName = 'Wake')]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,160}$')]
    [string]$EvidenceSubject = '',
    [Parameter(ParameterSetName = 'Wake')]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:/#-]{7,180}$')]
    [string]$EvidenceProofRef = '',
    [Parameter(ParameterSetName = 'IssueBreakGlass', Mandatory = $true)]
    [switch]$IssueBreakGlassNonce,
    [Parameter(ParameterSetName = 'Wake')]
    [ValidatePattern('^[a-f0-9]{16}$')]
    [string]$ConfirmationNonce = '',
    [Parameter(ParameterSetName = 'Wake')]
    [ValidatePattern('^[a-f0-9]{32}$')]
    [string]$OpenClawHostProofId = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$requestRoot = Join-Path $workspaceRoot 'requests\battle-bridge-recovery'
$evidenceRoot = Join-Path $workspaceRoot 'receipts\battle-bridge-recovery-auth'
$openClawProofRoot = Join-Path $workspaceRoot 'receipts\openclaw-authenticated-command'
$noncePath = Join-Path $workspaceRoot 'status\battle-bridge-break-glass-nonce.json'
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$wscriptPath = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32\wscript.exe'))
$authorityHead = ''
$hostProofConsumed = $false

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

if (-not ('StephanosRecoveryPathIdentity' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class StephanosRecoveryPathIdentity {
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
            if (Test-Path -LiteralPath $cursor) { $baseline[$cursor] = [StephanosRecoveryPathIdentity]::Read($cursor) }
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
        if (-not [string]::Equals([StephanosRecoveryPathIdentity]::Read($entry.Key), [string]$entry.Value, [System.StringComparison]::Ordinal)) {
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

Assert-NoReparseAncestor -TargetPath $workspaceRoot
Assert-NoReparseAncestor -TargetPath $requestRoot
Assert-NoReparseAncestor -TargetPath $evidenceRoot
Assert-NoReparseAncestor -TargetPath $openClawProofRoot
Assert-NoReparseAncestor -TargetPath $noncePath
foreach ($directory in @($requestRoot, $evidenceRoot, $openClawProofRoot, (Split-Path -Parent $noncePath))) {
    Assert-NoReparseAncestor -TargetPath $directory
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$pathBaseline = Get-PathIdentityBaseline -TargetPaths @($workspaceRoot, $requestRoot, $evidenceRoot, $openClawProofRoot, $noncePath)

if ($IssueBreakGlassNonce) {
    Assert-StablePathBaseline -Baseline $pathBaseline
    $nonce = ([Guid]::NewGuid().ToString('N')).Substring(0,16)
    $record = [ordered]@{ schemaVersion = 'stephanos.battle-bridge-break-glass-nonce.v1'; nonce = $nonce; issuedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); expiresAtUtc = (Get-Date).ToUniversalTime().AddMinutes(5).ToString('o'); consumed = $false }
    $temporary = "${noncePath}.${PID}.tmp"
    Write-ExclusiveUtf8Json -Path $temporary -Value $record
    Assert-StablePathBaseline -Baseline $pathBaseline
    Move-Item -LiteralPath $temporary -Destination $noncePath -Force
    Write-Output "CONFIRMATION_REQUIRED=CONFIRM_BATTLE_BRIDGE_RECOVERY:$nonce"
    exit 0
}

if ($Route -eq 'AUTHENTICATED_BREAK_GLASS') {
    if (-not (Test-Path -LiteralPath $noncePath -PathType Leaf)) { throw 'BREAK_GLASS_NONCE_REQUIRED' }
    $nonceRecord = Get-Content -LiteralPath $noncePath -Raw | ConvertFrom-Json
    if ($nonceRecord.consumed -eq $true -or [DateTimeOffset]::Parse([string]$nonceRecord.expiresAtUtc) -le [DateTimeOffset]::UtcNow) { throw 'BREAK_GLASS_NONCE_EXPIRED' }
    if (-not [string]::Equals([string]$nonceRecord.nonce, $ConfirmationNonce, [System.StringComparison]::Ordinal)) { throw 'BREAK_GLASS_NONCE_MISMATCH' }
    $claimPath = "${noncePath}.${ConfirmationNonce}.claim"
    Assert-StablePathBaseline -Baseline $pathBaseline
    try {
        $claim = [System.IO.File]::Open($claimPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $claimBytes = [System.Text.Encoding]::UTF8.GetBytes(([DateTimeOffset]::UtcNow.ToString('o')))
            $claim.Write($claimBytes, 0, $claimBytes.Length)
            $claim.Flush($true)
        } finally { $claim.Dispose() }
    } catch [System.IO.IOException] { throw 'BREAK_GLASS_NONCE_ALREADY_CLAIMED' }
    $nonceRecord.consumed = $true
    $nonceRecord.consumedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $consumedTemporary = "${noncePath}.${PID}.consumed.tmp"
    Assert-StablePathBaseline -Baseline $pathBaseline
    Write-ExclusiveUtf8Json -Path $consumedTemporary -Value $nonceRecord
    Assert-StablePathBaseline -Baseline $pathBaseline
    Move-Item -LiteralPath $consumedTemporary -Destination $noncePath -Force
    $EvidenceIssuer = 'battle-bridge-break-glass-nonce'
    $EvidenceSubject = "nonce:$ConfirmationNonce"
    $EvidenceProofRef = "status/battle-bridge-break-glass-nonce.json#$ConfirmationNonce"
} elseif ($Route -eq 'TAILSCALE_CONTROL') {
    if ([string]::IsNullOrWhiteSpace($env:SSH_CONNECTION)) { throw 'TAILSCALE_SSH_CONNECTION_REQUIRED' }
    $remoteIp = ($env:SSH_CONNECTION -split '\s+')[0]
    $processCursor = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    $sshAncestor = $null
    for ($depth = 0; $depth -lt 8 -and $processCursor; $depth++) {
        $processCursor = Get-CimInstance Win32_Process -Filter "ProcessId = $($processCursor.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($processCursor -and ([string]$processCursor.Name -in @('sshd.exe','sshd'))) { $sshAncestor = $processCursor; break }
    }
    if (-not $sshAncestor) { throw 'TAILSCALE_SSH_PROCESS_ANCESTOR_REQUIRED' }
    $sshConnection = Get-NetTCPConnection -State Established -ErrorAction Stop | Where-Object {
        $_.OwningProcess -eq [int]$sshAncestor.ProcessId -and $_.LocalPort -eq 22 -and $_.RemoteAddress -eq $remoteIp
    } | Select-Object -First 1
    if (-not $sshConnection) { throw 'TAILSCALE_SSH_SOCKET_IDENTITY_NOT_VERIFIED' }
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if (-not $tailscale) { $tailscale = Get-Command tailscale -ErrorAction Stop }
    $tailnet = (& $tailscale.Source status --json | ConvertFrom-Json)
    $peer = @($tailnet.Peer.PSObject.Properties.Value) | Where-Object {
        $_.Online -eq $true -and @($_.TailscaleIPs) -contains $remoteIp
    } | Select-Object -First 1
    if (-not $peer) { throw 'TAILSCALE_SSH_IDENTITY_NOT_VERIFIED' }
    $peerName = if ($peer.DNSName) { [string]$peer.DNSName } else { [string]$peer.HostName }
    $safePeerName = ($peerName -replace '[^A-Za-z0-9._-]', '-').Trim('-')
    if ([string]::IsNullOrWhiteSpace($safePeerName)) { throw 'TAILSCALE_SSH_IDENTITY_INVALID' }
    $EvidenceIssuer = 'tailscale-ssh-identity-probe'
    $EvidenceSubject = "tailnet:$safePeerName"
    $EvidenceProofRef = "tailscale-status/$safePeerName/sshd-$($sshAncestor.ProcessId)/$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmss'))"
} elseif ($Route -eq 'OPENCLAW_WHATSAPP') {
    if (-not [string]::IsNullOrWhiteSpace($EvidenceIssuer) -or -not [string]::IsNullOrWhiteSpace($EvidenceSubject) -or -not [string]::IsNullOrWhiteSpace($EvidenceProofRef)) {
        throw 'OPENCLAW_CALLER_SUPPLIED_EVIDENCE_REJECTED'
    }
    if ([string]::IsNullOrWhiteSpace($OpenClawHostProofId)) { throw 'OPENCLAW_HOST_PROOF_REQUIRED' }
    $hostProofPath = Join-Path $openClawProofRoot "$OpenClawHostProofId.json"
    Assert-NoReparseAncestor -TargetPath $hostProofPath
    $hostProofBaseline = Get-PathIdentityBaseline -TargetPaths @($hostProofPath)
    $hostProof = Get-Content -LiteralPath $hostProofPath -Raw | ConvertFrom-Json
    Assert-StablePathBaseline -Baseline $hostProofBaseline
    $hostNow = [DateTimeOffset]::UtcNow
    $hostIssuedAt = [DateTimeOffset]::Parse([string]$hostProof.issuedAtUtc)
    $hostExpiresAt = [DateTimeOffset]::Parse([string]$hostProof.expiresAtUtc)
    if ([string]$hostProof.schemaVersion -ne 'stephanos.openclaw-authenticated-recovery-command.v1'
        -or [string]$hostProof.proofId -ne $OpenClawHostProofId -or [string]$hostProof.route -ne 'OPENCLAW_WHATSAPP'
        -or [string]$hostProof.command -ne 'wake' -or [string]$hostProof.subject -ne 'openclaw:authenticated-operator'
        -or [string]$hostProof.commandSurface -ne 'openclaw.plugin-sdk.authenticated-command' -or $hostProof.authenticatedByHost -ne $true
        -or $hostIssuedAt -lt $hostNow.AddSeconds(-60) -or $hostIssuedAt -gt $hostNow.AddSeconds(30)
        -or $hostExpiresAt -le $hostNow -or $hostExpiresAt -le $hostIssuedAt -or ($hostExpiresAt - $hostIssuedAt).TotalSeconds -gt 60) {
        throw 'OPENCLAW_HOST_PROOF_INVALID'
    }
    $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
    $hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($currentProcess.ParentProcessId)" -ErrorAction SilentlyContinue
    if (-not $hostProcess -or [int]$hostProof.hostPid -ne [int]$hostProcess.ProcessId
        -or [string]$hostProcess.Name -notin @('node.exe','node','openclaw.exe','openclaw')
        -or [string]$hostProcess.CommandLine -notmatch '(?i)openclaw') { throw 'OPENCLAW_HOST_PROCESS_IDENTITY_INVALID' }
    $hostClaimPath = "$hostProofPath.claim"
    Assert-StablePathBaseline -Baseline $pathBaseline
    Assert-StablePathBaseline -Baseline $hostProofBaseline
    try {
        $hostClaim = [System.IO.File]::Open($hostClaimPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try { $hostClaim.Flush($true) } finally { $hostClaim.Dispose() }
    } catch [System.IO.IOException] { throw 'OPENCLAW_HOST_PROOF_ALREADY_CONSUMED' }
    $EvidenceIssuer = 'openclaw-authenticated-command'
    $EvidenceSubject = [string]$hostProof.subject
    $EvidenceProofRef = "receipts/openclaw-authenticated-command/$OpenClawHostProofId.json"
    $hostProofConsumed = $true
} else {
    if (-not [string]::Equals($EvidenceIssuer, 'battle-bridge-github-command-mailbox', [System.StringComparison]::Ordinal)) { throw 'RECOVERY_ROUTE_EVIDENCE_ISSUER_INVALID' }
    if ([string]::IsNullOrWhiteSpace($EvidenceSubject) -or [string]::IsNullOrWhiteSpace($EvidenceProofRef)) { throw 'RECOVERY_ROUTE_EVIDENCE_REQUIRED' }
    if ($EvidenceProofRef -notmatch '^receipts/github-command-mailbox/[A-Za-z0-9._-]+\.json$') { throw 'RECOVERY_GITHUB_RECEIPT_REF_INVALID' }
    $mailboxReceiptPath = Join-Path $workspaceRoot ($EvidenceProofRef -replace '/', '\')
    Assert-NoReparseAncestor -TargetPath $mailboxReceiptPath
    $mailboxBaseline = Get-PathIdentityBaseline -TargetPaths @($mailboxReceiptPath)
    $mailboxReceipt = Get-Content -LiteralPath $mailboxReceiptPath -Raw | ConvertFrom-Json
    Assert-StablePathBaseline -Baseline $mailboxBaseline
    $authorityTimeText = if ([string]$mailboxReceipt.state -eq 'DONE') { [string]$mailboxReceipt.completedAt } else { [string]$mailboxReceipt.acceptedAt }
    $authorityTime = [DateTimeOffset]::Parse($authorityTimeText)
    $sourceControlExecutable = Get-Command git.exe -ErrorAction Stop
    $currentSourceHead = [string](& $sourceControlExecutable.Source -C $repoRoot rev-parse HEAD)
    if ([string]$mailboxReceipt.schemaVersion -ne 'stephanos.battle-bridge-github-command-receipt.v1'
        -or [string]$mailboxReceipt.requestId -ne $EvidenceSubject -or [string]$mailboxReceipt.operation -ne 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH'
        -or [string]$mailboxReceipt.repository -ne 'Cheekyfellastef/stephan-os' -or [int]$mailboxReceipt.issueNumber -ne 1507
        -or [string]$mailboxReceipt.state -notin @('ACCEPTED','DONE') -or $authorityTime -lt [DateTimeOffset]::UtcNow.AddMinutes(-5)
        -or $authorityTime -gt [DateTimeOffset]::UtcNow.AddSeconds(30) -or [string]$mailboxReceipt.expectedHead -notmatch '^[0-9a-f]{40}$'
        -or -not [string]::Equals([string]$mailboxReceipt.expectedHead, $currentSourceHead.Trim(), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID'
    }
    $authorityHead = ([string]$mailboxReceipt.expectedHead).ToLowerInvariant()
}

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
$slug = $Route.ToLowerInvariant()
$requestId = if ($Route -eq 'GITHUB_MAILBOX') {
    $hashInput = [System.Text.Encoding]::UTF8.GetBytes("$EvidenceSubject|$EvidenceProofRef")
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { "recovery-github-$(([BitConverter]::ToString($hash.ComputeHash($hashInput))).Replace('-','').ToLowerInvariant().Substring(0,24))" } finally { $hash.Dispose() }
} elseif ($Route -eq 'OPENCLAW_WHATSAPP') { "recovery-openclaw-$OpenClawHostProofId" }
elseif ($Route -eq 'AUTHENTICATED_BREAK_GLASS') { "recovery-breakglass-$ConfirmationNonce" }
else { "recovery-$slug-$($now.ToString('yyyyMMddTHHmmss'))-$(([Guid]::NewGuid().ToString('N')).Substring(0,8))" }
$upstreamProofRef = $EvidenceProofRef
$authenticationProofRef = "receipts/battle-bridge-recovery-auth/${requestId}.json"
$authenticationRecord = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-auth-receipt.v1'
    requestId = $requestId
    route = $Route
    issuer = $EvidenceIssuer
    subject = $EvidenceSubject
    upstreamProofRef = $upstreamProofRef
    issuedAtUtc = $now.ToString('o')
    expiresAtUtc = $now.AddMinutes(5).ToString('o')
    verifiedByFixedAdapter = $true
    authorityHead = if ($Route -eq 'GITHUB_MAILBOX') { $authorityHead } else { '' }
    hostProofConsumed = ($Route -eq 'OPENCLAW_WHATSAPP' -and $hostProofConsumed -eq $true)
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
    route = $Route
    action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'
    issuedAtUtc = $now.ToString('o')
    expiresAtUtc = $now.AddMinutes(5).ToString('o')
    sourceReceipt = $upstreamProofRef
    authenticationEvidence = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-auth-evidence.v1'
        route = $Route
        issuer = $EvidenceIssuer
        subject = $EvidenceSubject
        proofRef = $authenticationProofRef
        verified = $true
    }
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    sourceMutationAllowed = $false
}
$requestPath = Join-Path $requestRoot "${slug}.json"
$temporaryPath = "${requestPath}.${PID}.$([Guid]::NewGuid().ToString('N')).tmp"
Assert-StablePathBaseline -Baseline $pathBaseline
Write-ExclusiveUtf8Json -Path $temporaryPath -Value $request
Assert-StablePathBaseline -Baseline $pathBaseline
Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force
Start-ScheduledTask -TaskName $taskName
[pscustomobject]@{ requestId = $requestId; route = $Route; queued = $true; coordinatorTask = $taskName; arbitraryShellAllowed = $false; sourceMutationAllowed = $false } | ConvertTo-Json
