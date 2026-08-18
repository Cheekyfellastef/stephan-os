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
$journalSchema = 'stephanos.battle-bridge-recovery-lifeboat-execution-journal.v1'
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
$journalRoot = Join-Path $stateRoot 'execution-journal'
$consumedRoot = Join-Path $stateRoot 'consumed'
$receiptRoot = Join-Path $lifeboatRoot 'receipts\github-recovery'
$statusRoot = Join-Path $lifeboatRoot 'status'
$statusPath = Join-Path $statusRoot 'mobile-recovery-current.json'

foreach ($required in @($powershellExe, $actionPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Fixed lifeboat component is missing: $required" }
}
foreach ($directory in @($claimsRoot, $journalRoot, $consumedRoot, $receiptRoot, $statusRoot)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $directory = Split-Path -Parent $Path
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temp = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    $Value | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Write-CreateNewJson([string]$Path, [object]$Value) {
    $json = ($Value | ConvertTo-Json -Depth 14) + [Environment]::NewLine
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

function Get-ProbeUtc([object]$Value) {
    if ($Value -isnot [string] -or $Value -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$') { return $null }
    $parsed = [DateTimeOffset]::MinValue
    $ok = [DateTimeOffset]::TryParseExact(
        $Value,
        "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'",
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal,
        [ref]$parsed
    )
    if (-not $ok -or $parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'") -cne $Value) { return $null }
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

function Invoke-ReadOnlyProbe() {
    $probeOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action PROBE_BATTLE_BRIDGE 2>&1)
    $probeExitCode = $LASTEXITCODE
    $probeText = $probeOutput -join [Environment]::NewLine
    $probe = $null
    try { $probe = $probeText | ConvertFrom-Json } catch { }
    return [pscustomobject]@{
        ok = [bool]($probeExitCode -eq 0 -and $null -ne $probe -and [bool]$probe.ok -and [string]$probe.action -ceq 'PROBE_BATTLE_BRIDGE')
        receipt = $probe
    }
}

function Test-TaskCurrentlyHealthy([object]$TaskSnapshot, [object]$BaselineSnapshot) {
    if ($null -eq $TaskSnapshot -or -not [bool]$TaskSnapshot.present -or -not [bool]$TaskSnapshot.actionIdentityValid) { return $false }
    if ([string]$TaskSnapshot.state -ceq 'Running') { return $true }
    if ($null -eq $BaselineSnapshot -or -not [bool]$BaselineSnapshot.present -or -not [bool]$BaselineSnapshot.actionIdentityValid) { return $false }
    if ($null -eq $TaskSnapshot.lastTaskResult -or [int64]$TaskSnapshot.lastTaskResult -ne 0) { return $false }
    $postRun = Get-ProbeUtc $TaskSnapshot.lastRunTimeUtc
    if ($null -eq $postRun) { return $false }
    if ($null -eq $BaselineSnapshot.lastRunTimeUtc) { return $true }
    $baselineRun = Get-ProbeUtc $BaselineSnapshot.lastRunTimeUtc
    if ($null -eq $baselineRun) { return $false }
    return $postRun -gt $baselineRun
}

function Verify-PostAction([string]$Action, [object]$ActionReceipt) {
    if ($Action -ne 'PROBE_BATTLE_BRIDGE') { Start-Sleep -Milliseconds 1500 }
    $probeResult = Invoke-ReadOnlyProbe
    if (-not $probeResult.ok) {
        return [pscustomobject]@{
            verified = $false
            verdict = 'POST_ACTION_PROBE_INVALID'
            blocker = 'POST_ACTION_PROBE_INVALID'
            targetComponentHealthy = $false
            battleBridgeHealthyClaimed = $false
            probe = $probeResult.receipt
        }
    }
    $probe = $probeResult.receipt
    $mailbox = $probe.mailbox.after
    $mesh = $probe.recoveryMesh.after
    if ($Action -eq 'PROBE_BATTLE_BRIDGE') {
        return [pscustomobject]@{
            verified = $true
            verdict = 'BATTLE_BRIDGE_PROBE_VERIFIED'
            blocker = ''
            targetComponentHealthy = $false
            battleBridgeHealthyClaimed = $false
            probe = $probe
        }
    }
    $target = if ($Action -eq 'WAKE_CANONICAL_MAILBOX') { $mailbox } else { $mesh }
    $baseline = if ($Action -eq 'WAKE_CANONICAL_MAILBOX') { $ActionReceipt.mailbox.before } else { $ActionReceipt.recoveryMesh.before }
    $healthy = Test-TaskCurrentlyHealthy $target $baseline
    return [pscustomobject]@{
        verified = [bool]$healthy
        verdict = if ($healthy) { 'RECOVERY_WAKE_TARGET_COMPONENT_VERIFIED' } else { 'RECOVERY_WAKE_TARGET_COMPONENT_NOT_VERIFIED' }
        blocker = if ($healthy) { '' } else { 'TARGET_COMPONENT_NOT_HEALTHY_AFTER_WAKE' }
        targetComponentHealthy = [bool]$healthy
        battleBridgeHealthyClaimed = $false
        probe = $probe
    }
}

function Write-Consumed([string]$RequestId, [string]$Action, [string]$ReceiptId, [string]$TerminalVerdict, [string]$BankId = $bankId) {
    $consumedPath = Join-Path $consumedRoot "$RequestId.json"
    if (Test-Path -LiteralPath $consumedPath -PathType Leaf) { return $true }
    $consumed = [ordered]@{
        schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-consumed-request.v1'
        requestId = $RequestId
        action = $Action
        receiptId = $ReceiptId
        consumedAtUtc = [DateTime]::UtcNow.ToString('o')
        bankId = $BankId
        terminalVerdict = $TerminalVerdict
    }
    return Write-CreateNewJson -Path $consumedPath -Value $consumed
}

function Write-TerminalReceipt([object]$Terminal) {
    $receiptPath = Join-Path $receiptRoot "$($Terminal.receiptId).json"
    if (Test-Path -LiteralPath $receiptPath -PathType Leaf) { return $receiptPath }
    if (-not (Write-CreateNewJson -Path $receiptPath -Value $Terminal)) { throw 'Recovery terminal receipt collision.' }
    return $receiptPath
}

function Terminalize-InterruptedClaims() {
    $claimFiles = @(Get-ChildItem -LiteralPath $claimsRoot -Filter 'mobile-recovery-*.json' -File -ErrorAction SilentlyContinue)
    if ($claimFiles.Count -gt 100) { throw 'Recovery interrupted-claim window exceeds fixed bound.' }
    foreach ($claimFile in $claimFiles) {
        $requestId = [System.IO.Path]::GetFileNameWithoutExtension($claimFile.Name)
        if ($requestId -notmatch '^mobile-recovery-[a-z0-9][a-z0-9-]{7,63}$') { continue }
        $consumedPath = Join-Path $consumedRoot "$requestId.json"
        if (Test-Path -LiteralPath $consumedPath -PathType Leaf) { continue }
        $claim = $null
        try {
            $claim = Get-Content -LiteralPath $claimFile.FullName -Raw | ConvertFrom-Json
        } catch {
            Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_CLAIM_MALFORMED' | ConvertTo-Json -Depth 8
            throw 'Interrupted recovery claim is malformed.'
        }
        if ([string]$claim.schemaVersion -cne $claimSchema -or [string]$claim.requestId -cne $requestId -or [string]$claim.bankId -notin @('A','B')) {
            Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_CLAIM_IDENTITY_INVALID' | ConvertTo-Json -Depth 8
            throw 'Interrupted recovery claim identity is invalid.'
        }
        $action = [string]$claim.action
        if ($allowedActions -cnotcontains $action) {
            Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_CLAIM_ACTION_INVALID' | ConvertTo-Json -Depth 8
            throw 'Interrupted recovery claim action is invalid.'
        }
        $journalPath = Join-Path $journalRoot "$requestId.json"
        $journal = $null
        if (Test-Path -LiteralPath $journalPath -PathType Leaf) {
            try {
                $journal = Get-Content -LiteralPath $journalPath -Raw | ConvertFrom-Json
            } catch {
                Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_JOURNAL_MALFORMED' | ConvertTo-Json -Depth 8
                throw 'Interrupted recovery journal is malformed.'
            }
            if ([string]$journal.schemaVersion -cne $journalSchema -or [string]$journal.requestId -cne $requestId -or [string]$journal.action -cne $action -or [string]$journal.bankId -cne [string]$claim.bankId) {
                Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_JOURNAL_IDENTITY_INVALID' | ConvertTo-Json -Depth 8
                throw 'Interrupted recovery journal identity is invalid.'
            }
            $journalState = [string]$journal.state
            if ($journalState -notin @('CLAIMED','ACTION_RETURNED','TERMINAL')) {
                Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_JOURNAL_STATE_INVALID' | ConvertTo-Json -Depth 8
                throw 'Interrupted recovery journal state is invalid.'
            }
            if ($journalState -ceq 'TERMINAL') {
                $existingReceiptId = [string]$journal.receiptId
                $existingTerminalVerdict = [string]$journal.terminalVerdict
                $validTerminalVerdicts = @(
                    'RECOVERY_ACTION_BLOCKED',
                    'RECOVERY_PROBE_VERIFIED',
                    'RECOVERY_ACTION_TARGET_VERIFIED',
                    'RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED',
                    'RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY'
                )
                if ($existingReceiptId -notmatch "^github-recovery-$([regex]::Escape($requestId))-(?:[a-f0-9]{32}|interrupted)$" -or $validTerminalVerdicts -cnotcontains $existingTerminalVerdict) {
                    Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_JOURNAL_TERMINAL_INVALID' | ConvertTo-Json -Depth 8
                    throw 'Interrupted recovery terminal journal is invalid.'
                }
                $existingReceiptPath = Join-Path $receiptRoot "$existingReceiptId.json"
                if (-not (Test-Path -LiteralPath $existingReceiptPath -PathType Leaf)) {
                    Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_TERMINAL_RECEIPT_MISSING' | ConvertTo-Json -Depth 8
                    throw 'Interrupted recovery terminal receipt is missing.'
                }
                $terminalReceipt = $null
                try {
                    $terminalReceipt = Get-Content -LiteralPath $existingReceiptPath -Raw | ConvertFrom-Json
                } catch {
                    Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_TERMINAL_RECEIPT_INVALID' | ConvertTo-Json -Depth 8
                    throw 'Interrupted recovery terminal receipt is invalid.'
                }
                $terminalReceiptKeys = @('schemaVersion','receiptId','requestId','action','bankId','executedAtUtc','executionOk','actionFinalVerdict','blocker','startRequested','verificationPerformed','verificationVerdict','targetComponentHealthy','postActionProofRequired','recoveredHealthClaimed','replayAllowed','arbitraryShellAllowed','gitMutationAllowed','sourceMutationAllowed','mergeAllowed','pcRestartAllowed')
                if (-not (Test-ExactProperties $terminalReceipt $terminalReceiptKeys) -or [string]$terminalReceipt.schemaVersion -cne 'stephanos.battle-bridge-recovery-lifeboat-github-execution-receipt.v1' -or [string]$terminalReceipt.receiptId -cne $existingReceiptId -or [string]$terminalReceipt.requestId -cne $requestId -or [string]$terminalReceipt.action -cne $action -or [string]$terminalReceipt.bankId -cne [string]$claim.bankId -or -not [bool]$terminalReceipt.postActionProofRequired -or [bool]$terminalReceipt.recoveredHealthClaimed -or [bool]$terminalReceipt.replayAllowed -or [bool]$terminalReceipt.arbitraryShellAllowed -or [bool]$terminalReceipt.gitMutationAllowed -or [bool]$terminalReceipt.sourceMutationAllowed -or [bool]$terminalReceipt.mergeAllowed -or [bool]$terminalReceipt.pcRestartAllowed) {
                    Publish-Status -Verdict 'RECOVERY_LOCAL_STATE_BLOCKED' -Blocker 'INTERRUPTED_TERMINAL_RECEIPT_INVALID' | ConvertTo-Json -Depth 8
                    throw 'Interrupted recovery terminal receipt identity is invalid.'
                }
                if (-not (Write-Consumed -RequestId $requestId -Action $action -ReceiptId $existingReceiptId -TerminalVerdict $existingTerminalVerdict -BankId ([string]$claim.bankId))) { throw 'Interrupted terminal recovery request could not be consumed.' }
                continue
            }
        }
        $probeResult = Invoke-ReadOnlyProbe
        $receiptId = "github-recovery-$requestId-interrupted"
        $terminalVerdict = 'RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY'
        $claimBankId = [string]$claim.bankId
        $terminal = [ordered]@{
            schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-github-execution-receipt.v1'
            receiptId = $receiptId
            requestId = $requestId
            action = $action
            bankId = $claimBankId
            executedAtUtc = [DateTime]::UtcNow.ToString('o')
            executionOk = $false
            actionFinalVerdict = 'INTERRUPTED_EXECUTION_STATE_UNKNOWN'
            blocker = 'PREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM'
            startRequested = $false
            verificationPerformed = [bool]$probeResult.ok
            verificationVerdict = if ($probeResult.ok) { 'READ_ONLY_POST_CRASH_PROBE_COMPLETE' } else { 'READ_ONLY_POST_CRASH_PROBE_INVALID' }
            targetComponentHealthy = $false
            postActionProofRequired = $true
            recoveredHealthClaimed = $false
            replayAllowed = $false
            arbitraryShellAllowed = $false
            gitMutationAllowed = $false
            sourceMutationAllowed = $false
            mergeAllowed = $false
            pcRestartAllowed = $false
        }
        $null = Write-TerminalReceipt -Terminal $terminal
        $terminalJournal = [ordered]@{
            schemaVersion = $journalSchema
            requestId = $requestId
            action = $action
            bankId = $claimBankId
            state = 'TERMINAL'
            claimedAtUtc = [string]$claim.claimedAtUtc
            terminalizedAtUtc = [DateTime]::UtcNow.ToString('o')
            terminalVerdict = $terminalVerdict
            receiptId = $receiptId
            executionReplayAllowed = $false
            postCrashProbePerformed = [bool]$probeResult.ok
        }
        Write-AtomicJson -Path $journalPath -Value $terminalJournal
        if (-not (Write-Consumed -RequestId $requestId -Action $action -ReceiptId $receiptId -TerminalVerdict $terminalVerdict -BankId $claimBankId)) { throw 'Interrupted recovery request could not be terminalized.' }
    }
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
        verificationVerdict = if ($null -eq $Receipt) { '' } else { [string]$Receipt.verificationVerdict }
        targetComponentHealthy = if ($null -eq $Receipt) { $false } else { [bool]$Receipt.targetComponentHealthy }
        postActionProofRequired = $true
        recoveredHealthClaimed = $false
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

Terminalize-InterruptedClaims

$headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'Stephanos-Battle-Bridge-Recovery-Lifeboat/1.1' }
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
$journalPath = Join-Path $journalRoot "$($request.requestId).json"
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

$journal = [ordered]@{
    schemaVersion = $journalSchema
    requestId = $request.requestId
    action = $request.action
    bankId = $bankId
    state = 'CLAIMED'
    claimedAtUtc = [string]$claim.claimedAtUtc
    actionReturnedAtUtc = ''
    terminalizedAtUtc = ''
    executionOk = $false
    verificationPerformed = $false
    verificationVerdict = ''
    terminalVerdict = ''
    receiptId = ''
    executionReplayAllowed = $false
}
if (-not (Write-CreateNewJson -Path $journalPath -Value $journal)) { throw 'Recovery execution journal collision.' }

$actionOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action $request.action 2>&1)
$actionExitCode = $LASTEXITCODE
$actionText = $actionOutput -join [Environment]::NewLine
$actionReceipt = $null
try { $actionReceipt = $actionText | ConvertFrom-Json } catch { }
$executionOk = $actionExitCode -eq 0 -and $null -ne $actionReceipt -and [bool]$actionReceipt.ok -and [string]$actionReceipt.action -ceq [string]$request.action
$journal.state = 'ACTION_RETURNED'
$journal.actionReturnedAtUtc = [DateTime]::UtcNow.ToString('o')
$journal.executionOk = [bool]$executionOk
Write-AtomicJson -Path $journalPath -Value $journal

$verification = $null
if ($executionOk) { $verification = Verify-PostAction -Action $request.action -ActionReceipt $actionReceipt }
$verificationPerformed = $null -ne $verification
$verificationOk = $verificationPerformed -and [bool]$verification.verified
$receiptId = "github-recovery-$($request.requestId)-$([Guid]::NewGuid().ToString('N'))"
$terminalVerdict = if (-not $executionOk) {
    'RECOVERY_ACTION_BLOCKED'
} elseif ($verificationOk -and $request.action -eq 'PROBE_BATTLE_BRIDGE') {
    'RECOVERY_PROBE_VERIFIED'
} elseif ($verificationOk) {
    'RECOVERY_ACTION_TARGET_VERIFIED'
} elseif ($verificationPerformed) {
    'RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED'
} else {
    'RECOVERY_ACTION_DISPATCHED_PROOF_PENDING'
}
$terminal = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-github-execution-receipt.v1'
    receiptId = $receiptId
    requestId = $request.requestId
    action = $request.action
    bankId = $bankId
    executedAtUtc = [DateTime]::UtcNow.ToString('o')
    executionOk = [bool]$executionOk
    actionFinalVerdict = if ($null -eq $actionReceipt) { 'ACTION_RECEIPT_INVALID' } else { [string]$actionReceipt.finalVerdict }
    blocker = if (-not $executionOk) { if ($null -eq $actionReceipt) { 'FIXED_ACTION_RECEIPT_INVALID' } else { [string]$actionReceipt.blocker } } elseif ($verificationPerformed) { [string]$verification.blocker } else { 'POST_ACTION_VERIFICATION_NOT_PERFORMED' }
    startRequested = if ($null -eq $actionReceipt) { $false } else { [bool]$actionReceipt.startRequested }
    verificationPerformed = [bool]$verificationPerformed
    verificationVerdict = if ($verificationPerformed) { [string]$verification.verdict } else { '' }
    targetComponentHealthy = if ($verificationPerformed) { [bool]$verification.targetComponentHealthy } else { $false }
    postActionProofRequired = $true
    recoveredHealthClaimed = $false
    replayAllowed = $false
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    pcRestartAllowed = $false
}
$null = Write-TerminalReceipt -Terminal $terminal
$journal.state = 'TERMINAL'
$journal.terminalizedAtUtc = [DateTime]::UtcNow.ToString('o')
$journal.verificationPerformed = [bool]$verificationPerformed
$journal.verificationVerdict = [string]$terminal.verificationVerdict
$journal.terminalVerdict = $terminalVerdict
$journal.receiptId = $receiptId
Write-AtomicJson -Path $journalPath -Value $journal
if (-not (Write-Consumed -RequestId $request.requestId -Action $request.action -ReceiptId $receiptId -TerminalVerdict $terminalVerdict)) { throw 'Recovery consumed-request receipt collision.' }

Publish-Status -Verdict $terminalVerdict -Blocker ([string]$terminal.blocker) -Request $request -Receipt $terminal | ConvertTo-Json -Depth 10
exit 0
