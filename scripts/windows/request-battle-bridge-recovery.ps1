[CmdletBinding(DefaultParameterSetName = 'Wake')]
param(
    [Parameter(ParameterSetName = 'Wake', Mandatory = $true)]
    [ValidateSet('GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')]
    [string]$Route,
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
$noncePath = Join-Path $workspaceRoot 'status\battle-bridge-break-glass-nonce.json'
$taskName = 'Stephanos Battle Bridge Recovery Mesh'

if ($IssueBreakGlassNonce) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $noncePath) -Force | Out-Null
    $nonce = ([Guid]::NewGuid().ToString('N')).Substring(0,16)
    $record = [ordered]@{ schemaVersion = 'stephanos.battle-bridge-break-glass-nonce.v1'; nonce = $nonce; issuedAtUtc = (Get-Date).ToUniversalTime().ToString('o'); expiresAtUtc = (Get-Date).ToUniversalTime().AddMinutes(5).ToString('o'); consumed = $false }
    $temporary = "${noncePath}.$PID.tmp"
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
    $nonceRecord.consumed = $true
    $nonceRecord.consumedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $consumedTemporary = "${noncePath}.$PID.consumed.tmp"
    $nonceRecord | ConvertTo-Json | Set-Content -LiteralPath $consumedTemporary -Encoding UTF8
    Move-Item -LiteralPath $consumedTemporary -Destination $noncePath -Force
}

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) { throw 'RECOVERY_MESH_TASK_NOT_INSTALLED' }
$now = [DateTimeOffset]::UtcNow
$slug = $Route.ToLowerInvariant()
$requestId = "recovery-$slug-$($now.ToString('yyyyMMddTHHmmss'))-$(([Guid]::NewGuid().ToString('N')).Substring(0,8))"
$request = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-ingress.v1'
    requestId = $requestId
    route = $Route
    action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'
    issuedAtUtc = $now.ToString('o')
    expiresAtUtc = $now.AddMinutes(5).ToString('o')
    sourceReceipt = "fixed-adapter/$slug/$($now.ToString('yyyyMMddTHHmmss'))"
    scheduledTaskVerified = $false
    ownerAuthenticated = $Route -eq 'GITHUB_MAILBOX'
    tailnetIdentityVerified = $Route -eq 'TAILSCALE_CONTROL'
    operatorIdentityVerified = $Route -eq 'OPENCLAW_WHATSAPP'
    nonceConfirmed = $Route -eq 'AUTHENTICATED_BREAK_GLASS'
    arbitraryShellAllowed = $false
    arbitraryTaskNameAllowed = $false
    sourceMutationAllowed = $false
}
New-Item -ItemType Directory -Path $requestRoot -Force | Out-Null
$requestPath = Join-Path $requestRoot "$slug.json"
$temporaryPath = "${requestPath}.$PID.tmp"
$request | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force
Start-ScheduledTask -TaskName $taskName
[pscustomobject]@{ requestId = $requestId; route = $Route; queued = $true; coordinatorTask = $taskName; arbitraryShellAllowed = $false; sourceMutationAllowed = $false } | ConvertTo-Json
