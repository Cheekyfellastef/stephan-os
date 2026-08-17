[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repository = 'Cheekyfellastef/stephan-os'
$issueNumber = 1814
$ownerLogin = 'Cheekyfellastef'
$workflowPath = '.github/workflows/battle-bridge-mobile-recovery-attestation-v1.yml'
$requestSchema = 'stephanos.battle-bridge-mobile-recovery-request.v1'
$attestationSchema = 'stephanos.battle-bridge-mobile-recovery-attestation.v1'
$claimSchema = 'stephanos.battle-bridge-lifeboat-github-claim.v1'
$statusSchema = 'stephanos.battle-bridge-recovery-lifeboat-remote-status.v1'
$requestMarker = '<!-- stephanos-battle-bridge-mobile-recovery-request -->'
$attestationMarker = '<!-- stephanos-battle-bridge-mobile-recovery-attestation -->'
$apiUrl = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1814/comments?per_page=100&page=1'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$allowedActions = @('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')
$fence = ([string][char]96) * 3

$consumerRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$bankRoot = [System.IO.Path]::GetFullPath((Join-Path $consumerRoot '..'))
$bankId = Split-Path -Leaf $bankRoot
if ($bankId -notin @('A', 'B')) { throw 'GitHub recovery consumer must execute from fixed bank A or B.' }
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $bankRoot '..\..'))
$actionPath = Join-Path $bankRoot 'actions\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$stateRoot = Join-Path $lifeboatRoot 'state'
$claimsRoot = Join-Path $stateRoot 'claims'
$consumedRoot = Join-Path $stateRoot 'consumed'
$receiptRoot = Join-Path $lifeboatRoot 'receipts\github-recovery'
$statusRoot = Join-Path $lifeboatRoot 'status'
$statusPath = Join-Path $statusRoot 'mobile-recovery-current.json'

foreach ($required in @($powershellExe, $actionPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Fixed lifeboat component is missing: $required" }
}
foreach ($directory in @($claimsRoot, $consumedRoot, $receiptRoot, $statusRoot)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $directory = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temp = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Write-CreateNewJson([string]$Path, [object]$Value) {
    $json = ($Value | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        return $true
    } catch [System.IO.IOException] {
        return $false
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Get-Sha256Text([string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-CanonicalUtc([object]$Value) {
    if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') { return $null }
    $parsed = [DateTimeOffset]::MinValue
    $ok = [DateTimeOffset]::TryParseExact(
        $Value,
        "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
        [ref]$parsed
    )
    if (-not $ok -or $parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") -cne $Value) { return $null }
    return $parsed
}

function Test-ExactProperties([object]$Value, [string[]]$Expected) {
    if ($null -eq $Value) { return $false }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if ($actual.Count -ne $wanted.Count) { return $false }
    for ($index = 0; $index -lt $wanted.Count; $index++) {
        if ($actual[$index] -cne $wanted[$index]) { return $false }
    }
    return $true
}

function Read-FencedJson([string]$Body, [string]$Marker) {
    if ([string]::IsNullOrWhiteSpace($Body) -or [Text.Encoding]::UTF8.GetByteCount($Body) -gt 16384) { return $null }
    $normalized = $Body.Replace("`r`n", "`n").Trim()
    $prefix = "$Marker`n${fence}json`n"
    $suffix = "`n$fence"
    if (-not $normalized.StartsWith($prefix, [StringComparison]::Ordinal) -or -not $normalized.EndsWith($suffix, [StringComparison]::Ordinal)) { return $null }
    $jsonText = $normalized.Substring($prefix.Length, $normalized.Length - $prefix.Length - $suffix.Length)
    try { return $jsonText | ConvertFrom-Json } catch { return $null }
}

function Normalize-Request([object]$Request, [DateTimeOffset]$Now) {
    $keys = @('schemaVersion','repository','issueNumber','requestId','nonce','action','requesterLogin','authorAssociation','requestedAtUtc','expiresAtUtc')
    if (-not (Test-ExactProperties $Request $keys)) { return $null }
    if ([string]$Request.schemaVersion -cne $requestSchema -or [string]$Request.repository -cne $repository -or [int]$Request.issueNumber -ne $issueNumber) { return $null }
    if ([string]$Request.requesterLogin -cne $ownerLogin -or [string]$Request.authorAssociation -cne 'OWNER') { return $null }
    $requestId = [string]$Request.requestId
    if ($requestId -notmatch '^mobile-recovery-[a-z0-9][a-z0-9-]{7,63}$' -or [string]$Request.nonce -notmatch '^[a-f0-9]{32}$') { return $null }
    $action = [string]$Request.action
    if ($allowedActions -cnotcontains $action) { return $null }
    $requested = Get-CanonicalUtc $Request.requestedAtUtc
    $expires = Get-CanonicalUtc $Request.expiresAtUtc
    if ($null -eq $requested -or $null -eq $expires) { return $null }
    if ($requested -gt $Now.AddSeconds(30) -or $expires -le $Now -or $expires -le $requested -or ($expires - $requested).TotalMinutes -gt 5) { return $null }
    $consumedPath = Join-Path $consumedRoot "$requestId.json"
    if (Test-Path -LiteralPath $consumedPath -PathType Leaf) { return $null }
    return [pscustomobject]@{
        schemaVersion = [string]$Request.schemaVersion
        repository = [string]$Request.repository
        issueNumber = [int]$Request.issueNumber
        requestId = $requestId
        nonce = [string]$Request.nonce
        action = $action
        requesterLogin = [string]$Request.requesterLogin
        authorAssociation = [string]$Request.authorAssociation
        requestedAtUtc = [string]$Request.requestedAtUtc
        expiresAtUtc = [string]$Request.expiresAtUtc
    }
}

function Get-RequestHash([object]$Request) {
    $ordered = [ordered]@{
        schemaVersion = [string]$Request.schemaVersion
        repository = [string]$Request.repository
        issueNumber = [int]$Request.issueNumber
        requestId = [string]$Request.requestId
        nonce = [string]$Request.nonce
        action = [string]$Request.action
        requesterLogin = [string]$Request.requesterLogin
        authorAssociation = [string]$Request.authorAssociation
        requestedAtUtc = [string]$Request.requestedAtUtc
        expiresAtUtc = [string]$Request.expiresAtUtc
    }
    return Get-Sha256Text ($ordered | ConvertTo-Json -Compress)
}

function Read-AttestationComment([object]$Comment) {
    if ($null -eq $Comment -or [string]$Comment.user.login -cne 'github-actions[bot]') { return $null }
    $body = ([string]$Comment.body).Replace("`r`n", "`n").Trim()
    if ([Text.Encoding]::UTF8.GetByteCount($body) -gt 16384) { return $null }
    $lines = @($body -split "`n")
    if ($lines.Count -lt 6 -or $lines[0] -cne $attestationMarker -or $lines[3] -cne "${fence}json" -or $lines[$lines.Count - 1] -cne $fence) { return $null }
    if (-not $lines[1].StartsWith('requestId: ', [StringComparison]::Ordinal) -or -not $lines[2].StartsWith('sourceCommentId: ', [StringComparison]::Ordinal)) { return $null }
    $requestId = $lines[1].Substring(11)
    $sourceCommentId = $lines[2].Substring(17)
    if ($requestId -notmatch '^mobile-recovery-[a-z0-9][a-z0-9-]{7,63}$' -or $sourceCommentId -notmatch '^[1-9][0-9]{0,18}$') { return $null }
    try { $payload = ($lines[4..($lines.Count - 2)] -join "`n") | ConvertFrom-Json } catch { return $null }
    if (-not (Test-ExactProperties $payload @('attestation','eventBinding'))) { return $null }
    if (-not (Test-ExactProperties $payload.eventBinding @('commentId','commentCreatedAtUtc','commentAuthor','authorAssociation'))) { return $null }
    if ([int64]$payload.eventBinding.commentId -ne [int64]$sourceCommentId -or [string]$payload.attestation.requestId -cne $requestId) { return $null }
    return [pscustomobject]@{ comment = $Comment; payload = $payload; requestId = $requestId; sourceCommentId = [int64]$sourceCommentId }
}

function Test-Attestation([object]$Entry, [object]$Request, [object]$SourceComment, [DateTimeOffset]$Now) {
    $att = $Entry.payload.attestation
    $keys = @('schemaVersion','repository','issueNumber','requestId','requestSha256','action','workflowPath','reviewerLogin','verdict','attestedAtUtc','expiresAtUtc')
    if (-not (Test-ExactProperties $att $keys)) { return $false }
    if ([string]$att.schemaVersion -cne $attestationSchema -or [string]$att.repository -cne $repository -or [int]$att.issueNumber -ne $issueNumber) { return $false }
    if ([string]$att.workflowPath -cne $workflowPath -or [string]$att.reviewerLogin -cne 'github-actions[bot]' -or [string]$att.verdict -cne 'ATTESTED') { return $false }
    if ([string]$att.requestId -cne [string]$Request.requestId -or [string]$att.action -cne [string]$Request.action -or [string]$att.requestSha256 -cne (Get-RequestHash $Request)) { return $false }
    if ([string]$Entry.payload.eventBinding.commentAuthor -cne $ownerLogin -or [string]$Entry.payload.eventBinding.authorAssociation -cne 'OWNER') { return $false }
    if ([int64]$Entry.payload.eventBinding.commentId -ne [int64]$SourceComment.id -or [string]$Entry.payload.eventBinding.commentCreatedAtUtc -cne [string]$SourceComment.created_at) { return $false }
    $attested = Get-CanonicalUtc $att.attestedAtUtc
    $expires = Get-CanonicalUtc $att.expiresAtUtc
    if ($null -eq $attested -or $null -eq $expires -or $attested -gt $Now.AddSeconds(30) -or $expires -le $Now -or $expires -le $attested -or ($expires - $attested).TotalMinutes -gt 5) { return $false }
    if ([string]$att.expiresAtUtc -cne [string]$Request.expiresAtUtc) { return $false }
    return $true
}

function Publish-Status([string]$Verdict, [string]$Blocker, [object]$Request = $null, [object]$Receipt = $null) {
    $status = [ordered]@{
        schemaVersion = $statusSchema
        bankId = $bankId
        observedAtUtc = [DateTime]::UtcNow.ToString('o')
        source = 'GITHUB_ISSUE_1814_ATTESTATION'
        verdict = $Verdict
        blocker = $Blocker
        requestId = if ($null -eq $Request) { '' } else { [string]$Request.requestId }
        action = if ($null -eq $Request) { '' } else { [string]$Request.action }
        receiptId = if ($null -eq $Receipt) { '' } else { [string]$Receipt.receiptId }
        postActionProofRequired = $true
        arbitraryShellAllowed = $false
        callerSelectedUrlAllowed = $false
        callerSelectedPathAllowed = $false
        callerSelectedTaskAllowed = $false
        gitMutationAllowed = $false
        sourceMutationAllowed = $false
        mergeAllowed = $false
        pcRestartAllowed = $false
    }
    Write-AtomicJson -Path $statusPath -Value $status
    return $status
}

$headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'Stephanos-Battle-Bridge-Recovery-Lifeboat/1.0' }
$response = $null
try {
    $response = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -Headers $headers -Method Get -TimeoutSec 20
} catch {
    Publish-Status -Verdict 'RECOVERY_SOURCE_UNAVAILABLE' -Blocker 'GITHUB_RECOVERY_FETCH_FAILED' | ConvertTo-Json -Depth 8
    exit 0
}
$contentType = [string]$response.Headers['Content-Type']
if ($contentType -notmatch '(?i)application/(?:json|vnd\.github\+json)' -or [string]::IsNullOrWhiteSpace([string]$response.Content)) {
    Publish-Status -Verdict 'RECOVERY_SOURCE_INVALID' -Blocker 'GITHUB_RECOVERY_RESPONSE_NOT_JSON' | ConvertTo-Json -Depth 8
    exit 0
}
try { $comments = @(([string]$response.Content | ConvertFrom-Json)) } catch {
    Publish-Status -Verdict 'RECOVERY_SOURCE_INVALID' -Blocker 'GITHUB_RECOVERY_JSON_INVALID' | ConvertTo-Json -Depth 8
    exit 0
}
if ($comments.Count -gt 100) {
    Publish-Status -Verdict 'RECOVERY_SOURCE_INVALID' -Blocker 'GITHUB_RECOVERY_COMMENT_WINDOW_INVALID' | ConvertTo-Json -Depth 8
    exit 0
}

$now = [DateTimeOffset]::UtcNow
$attestations = @()
foreach ($comment in $comments) {
    $entry = Read-AttestationComment $comment
    if ($null -ne $entry) { $attestations += $entry }
}
$requests = @()
foreach ($comment in $comments) {
    if ([string]$comment.user.login -cne $ownerLogin -or [string]$comment.author_association -cne 'OWNER') { continue }
    $candidate = Read-FencedJson ([string]$comment.body) $requestMarker
    if ($null -eq $candidate) { continue }
    $normalized = Normalize-Request $candidate $now
    if ($null -eq $normalized) { continue }
    $requests += [pscustomobject]@{ comment = $comment; request = $normalized }
}
$requests = @($requests | Sort-Object { [int64]$_.comment.id } -Descending)

$selected = $null
foreach ($entry in $requests) {
    foreach ($attestationEntry in $attestations) {
        if ($attestationEntry.requestId -cne $entry.request.requestId -or [int64]$attestationEntry.sourceCommentId -ne [int64]$entry.comment.id) { continue }
        if (Test-Attestation $attestationEntry $entry.request $entry.comment $now) {
            $selected = [pscustomobject]@{ requestEntry = $entry; attestationEntry = $attestationEntry }
            break
        }
    }
    if ($null -ne $selected) { break }
}

if ($null -eq $selected) {
    Publish-Status -Verdict 'NO_FRESH_ATTESTED_RECOVERY_REQUEST' -Blocker '' | ConvertTo-Json -Depth 8
    exit 0
}

$request = $selected.requestEntry.request
$claimPath = Join-Path $claimsRoot "$($request.requestId).json"
$claim = [ordered]@{
    schemaVersion = $claimSchema
    repository = $repository
    issueNumber = $issueNumber
    requestId = $request.requestId
    action = $request.action
    requestCommentId = [int64]$selected.requestEntry.comment.id
    attestationCommentId = [int64]$selected.attestationEntry.comment.id
    claimedAtUtc = [DateTime]::UtcNow.ToString('o')
    expiresAtUtc = $request.expiresAtUtc
    bankId = $bankId
    exclusiveCreateNew = $true
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    pcRestartAllowed = $false
}
if (-not (Write-CreateNewJson -Path $claimPath -Value $claim)) {
    Publish-Status -Verdict 'RECOVERY_REQUEST_ALREADY_CLAIMED' -Blocker 'EXCLUSIVE_CLAIM_EXISTS' -Request $request | ConvertTo-Json -Depth 8
    exit 0
}

$actionOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action $request.action 2>&1)
$actionExitCode = $LASTEXITCODE
$actionText = $actionOutput -join [Environment]::NewLine
$actionReceipt = $null
try { $actionReceipt = $actionText | ConvertFrom-Json } catch { }
$executionOk = $actionExitCode -eq 0 -and $null -ne $actionReceipt -and [bool]$actionReceipt.ok -and [string]$actionReceipt.action -ceq [string]$request.action
$receiptId = "github-recovery-$($request.requestId)-$([Guid]::NewGuid().ToString('N'))"
$terminal = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-github-execution-receipt.v1'
    receiptId = $receiptId
    requestId = $request.requestId
    action = $request.action
    bankId = $bankId
    executedAtUtc = [DateTime]::UtcNow.ToString('o')
    executionOk = [bool]$executionOk
    actionFinalVerdict = if ($null -eq $actionReceipt) { 'ACTION_RECEIPT_INVALID' } else { [string]$actionReceipt.finalVerdict }
    blocker = if ($executionOk) { '' } elseif ($null -eq $actionReceipt) { 'FIXED_ACTION_RECEIPT_INVALID' } else { [string]$actionReceipt.blocker }
    startRequested = if ($null -eq $actionReceipt) { $false } else { [bool]$actionReceipt.startRequested }
    postActionProofRequired = $true
    recoveredHealthClaimed = $false
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    pcRestartAllowed = $false
}
$receiptPath = Join-Path $receiptRoot "$receiptId.json"
if (-not (Write-CreateNewJson -Path $receiptPath -Value $terminal)) { throw 'Recovery terminal receipt collision.' }

if ($executionOk) {
    $consumed = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-consumed-request.v1'
        requestId = $request.requestId
        action = $request.action
        receiptId = $receiptId
        consumedAtUtc = [DateTime]::UtcNow.ToString('o')
        bankId = $bankId
    }
    $consumedPath = Join-Path $consumedRoot "$($request.requestId).json"
    if (-not (Write-CreateNewJson -Path $consumedPath -Value $consumed)) { throw 'Recovery consumed-request receipt collision.' }
}

$verdict = if ($executionOk) { 'RECOVERY_ACTION_DISPATCHED_PROOF_PENDING' } else { 'RECOVERY_ACTION_BLOCKED' }
Publish-Status -Verdict $verdict -Blocker ([string]$terminal.blocker) -Request $request -Receipt $terminal | ConvertTo-Json -Depth 8
exit 0
