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
    [string]$ConfirmationNonce = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'))
$requestRoot = Join-Path $workspaceRoot 'requests\battle-bridge-recovery'
$evidenceRoot = Join-Path $workspaceRoot 'receipts\battle-bridge-recovery-auth'
$noncePath = Join-Path $workspaceRoot 'status\battle-bridge-break-glass-nonce.json'
$taskName = 'Stephanos Battle Bridge Recovery Mesh'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$launcherPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs'))
$wscriptPath = [System.IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32\wscript.exe'))

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

Assert-NoReparseAncestor -TargetPath $workspaceRoot
Assert-NoReparseAncestor -TargetPath $requestRoot
Assert-NoReparseAncestor -TargetPath $evidenceRoot
Assert-NoReparseAncestor -TargetPath $noncePath

if ($IssueBreakGlassNonce) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $noncePath) -Force | Out-Null
    $nonce = ([Guid]::NewGuid().ToString('N')).Substring(0,16)
    $record = [ordered]@{ schemaVersion = 'stephanos.battle-bridge-break-glass-nonce.v1'; nonce = $nonce; issuedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); expiresAtUtc = (Get-Date).ToUniversalTime().AddMinutes(5).ToString('o'); consumed = $false }
    $temporary = "${noncePath}.${PID}.tmp"
    $record | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
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
    $nonceRecord | ConvertTo-Json | Set-Content -LiteralPath $consumedTemporary -Encoding UTF8
    Move-Item -LiteralPath $consumedTemporary -Destination $noncePath -Force
    $EvidenceIssuer = 'battle-bridge-break-glass-nonce'
    $EvidenceSubject = "nonce:$ConfirmationNonce"
    $EvidenceProofRef = "status/battle-bridge-break-glass-nonce.json#$ConfirmationNonce"
} elseif ($Route -eq 'TAILSCALE_CONTROL') {
    if ([string]::IsNullOrWhiteSpace($env:SSH_CONNECTION)) { throw 'TAILSCALE_SSH_CONNECTION_REQUIRED' }
    $remoteIp = ($env:SSH_CONNECTION -split '\s+')[0]
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
    $EvidenceProofRef = "tailscale-status/$safePeerName/$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmss'))"
} else {
    $expectedIssuer = if ($Route -eq 'GITHUB_MAILBOX') { 'battle-bridge-github-command-mailbox' } else { 'openclaw-authenticated-command' }
    if (-not [string]::Equals($EvidenceIssuer, $expectedIssuer, [System.StringComparison]::Ordinal)) { throw 'RECOVERY_ROUTE_EVIDENCE_ISSUER_INVALID' }
    if ([string]::IsNullOrWhiteSpace($EvidenceSubject) -or [string]::IsNullOrWhiteSpace($EvidenceProofRef)) { throw 'RECOVERY_ROUTE_EVIDENCE_REQUIRED' }
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
$now = [DateTimeOffset]::UtcNow
$slug = $Route.ToLowerInvariant()
$requestId = "recovery-$slug-$($now.ToString('yyyyMMddTHHmmss'))-$(([Guid]::NewGuid().ToString('N')).Substring(0,8))"
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
}
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$authenticationPath = Join-Path $evidenceRoot "${requestId}.json"
$authenticationTemporaryPath = "${authenticationPath}.${PID}.tmp"
$authenticationRecord | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $authenticationTemporaryPath -Encoding UTF8
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
New-Item -ItemType Directory -Path $requestRoot -Force | Out-Null
$requestPath = Join-Path $requestRoot "${slug}.json"
$temporaryPath = "${requestPath}.${PID}.tmp"
$request | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force
Start-ScheduledTask -TaskName $taskName
[pscustomobject]@{ requestId = $requestId; route = $Route; queued = $true; coordinatorTask = $taskName; arbitraryShellAllowed = $false; sourceMutationAllowed = $false } | ConvertTo-Json
