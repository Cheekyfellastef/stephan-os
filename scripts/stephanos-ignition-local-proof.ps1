param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedHead,
    [string]$RuntimeUrl = "http://127.0.0.1:4173/apps/stephanos/dist/index.html",
    [int]$ProbeSeconds = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Command)
    Write-Step $Label
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Write-ProofCommentBlock {
    param([string]$TranscriptPath)
    if (-not (Test-Path -LiteralPath $TranscriptPath)) { throw "Proof transcript was not found at $TranscriptPath" }
    $transcript = Get-Content -LiteralPath $TranscriptPath -Raw | ConvertFrom-Json
    $commentPath = Join-Path (Split-Path -Parent $TranscriptPath) "local-proof-github-comment.md"
    $comment = @"
``````text
$($transcript.marker)
ISSUE = #1281
EXPECTED_HEAD = $($transcript.exactHead.expected)
ACTUAL_HEAD = $($transcript.exactHead.actual)
EXACT_HEAD_MATCHED = $($transcript.exactHead.matched)
RUNTIME_URL = $($transcript.runtime.url)
RUNTIME_STATUS = $($transcript.runtime.statusCode)
RUNTIME_PASSED = $($transcript.runtime.passed)
BROWSER_RUNTIME_PROOF = $($transcript.proofScope.browserRuntimeProof)
BROWSER_RUNTIME_DOM_PROOF = $($transcript.proofScope.browserRuntimeDomProof)
OPERATOR_ACTION = $($transcript.operatorAction)
TRANSCRIPT = tmp/stephanos-ignition/ignition-proof-runner-transcript.json
COMMENT_ARTIFACT = tmp/stephanos-ignition/local-proof-github-comment.md
EXACT_HEAD_OPERATOR_APPROVAL_REQUIRED = YES
MERGE_ALLOWED = NO
``````
"@
    Set-Content -LiteralPath $commentPath -Value $comment -Encoding UTF8
    Write-Step "Copyable GitHub milestone/proof comment"
    Write-Host $comment
    Write-Host "commentArtifact=$commentPath"
    try {
        Set-Clipboard -Value $comment
        Write-Host "clipboard=proof-comment-ready"
    } catch {
        Write-Host "clipboard=unavailable $($_.Exception.Message)"
    }
}

function Write-BlockedTranscript {
    param(
        [string]$TranscriptPath,
        [string]$Marker,
        [string]$ExpectedHead,
        [string]$ActualHead,
        [string]$RuntimeUrl,
        [string]$RuntimeStatus,
        [string]$OperatorAction
    )
    $transcriptDir = Split-Path -Parent $TranscriptPath
    New-Item -ItemType Directory -Force -Path $transcriptDir | Out-Null
    $blockedTranscript = [ordered]@{
        marker = $Marker
        exactHead = [ordered]@{ expected = $ExpectedHead; actual = $ActualHead; matched = ($ExpectedHead -eq $ActualHead) }
        runtime = [ordered]@{
            passed = $false
            url = $RuntimeUrl
            statusCode = $RuntimeStatus
            domSignals = [ordered]@{ title = ""; hasHtmlShell = $false; bodyContainsStephanos = $false; contentLength = 0 }
        }
        proofScope = [ordered]@{ browserRuntimeProof = $false; browserRuntimeDomProof = $false }
        operatorAction = $OperatorAction
    }
    $blockedTranscript | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $TranscriptPath -Encoding UTF8
    Write-ProofCommentBlock -TranscriptPath $TranscriptPath
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$TranscriptPath = Join-Path $RepoRoot "tmp\stephanos-ignition\ignition-proof-runner-transcript.json"

Write-Step "Ignition local proof preflight"
$currentHead = (git rev-parse HEAD).Trim()
Write-Host "expectedHead=$ExpectedHead"
Write-Host "actualHead=$currentHead"
if ($currentHead -ne $ExpectedHead) {
    Write-BlockedTranscript -TranscriptPath $TranscriptPath -Marker "MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_BLOCKED" -ExpectedHead $ExpectedHead -ActualHead $currentHead -RuntimeUrl $RuntimeUrl -RuntimeStatus "exact-head-mismatch" -OperatorAction "Exact-head guard failed. Switch to the expected PR head before running proof."
    throw "Exact-head guard failed. Copyable blocker comment was emitted from the emergency transcript."
}

Write-Step "Classify worktree dirt before any cleanup"
$status = git status --porcelain=v1
if ($status) { $status | ForEach-Object { Write-Host $_ } } else { Write-Host "workspace=clean" }

$env:STEPHANOS_IGNITION_EXPECTED_HEAD = $ExpectedHead
$env:STEPHANOS_IGNITION_RUNTIME_URL = $RuntimeUrl
Invoke-Checked "Run ignition concierge unit tests" { npm run stephanos:ignition-concierge:test }
Invoke-Checked "Run ignition concierge proof mode" { npm run stephanos:ignition-concierge:proof }

Write-Step "Start Stephanos through existing ignition path"
$launcher = Start-Process -FilePath "powershell.exe" -WindowStyle Minimized -ArgumentList @("-NoExit", "-Command", "cd `"$RepoRoot`"; npm run stephanos") -PassThru
Write-Host "launcherPid=$($launcher.Id)"
Write-Host "launcherWindow=minimized-background-proof"

Write-Step "Probe browser/runtime URL"
$deadline = (Get-Date).AddSeconds($ProbeSeconds)
$runtimeReady = $false
$lastProbeError = "not-started"
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri $RuntimeUrl -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
            $runtimeReady = $true
            Write-Host "runtimeStatus=$($response.StatusCode)"
            break
        }
    } catch {
        $lastProbeError = $_.Exception.Message
        Write-Host "runtimeProbe=pending $lastProbeError"
        Start-Sleep -Seconds 3
    }
}

if (-not $runtimeReady) {
    Write-BlockedTranscript -TranscriptPath $TranscriptPath -Marker "MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_BLOCKED" -ExpectedHead $ExpectedHead -ActualHead $currentHead -RuntimeUrl $RuntimeUrl -RuntimeStatus "probe-timeout" -OperatorAction "Runtime URL did not become ready inside $ProbeSeconds seconds. Leave the minimized launcher open and inspect the concierge splash/support snapshot. Last probe error: $lastProbeError"
    throw "Runtime proof did not become ready inside $ProbeSeconds seconds. Copyable blocker comment was emitted from the emergency transcript."
}

Write-Step "Run exact-head browser/runtime proof runner"
npm run stephanos:ignition-concierge:proof-runner
$proofExitCode = $LASTEXITCODE
if (Test-Path -LiteralPath $TranscriptPath) {
    Write-Step "Ignition proof transcript ready"
    Write-Host "transcript=tmp/stephanos-ignition/ignition-proof-runner-transcript.json"
    Write-Host "MERGE_ALLOWED=NO until exact-head operator approval is given."
    Write-ProofCommentBlock -TranscriptPath $TranscriptPath
} else {
    throw "Proof runner did not write transcript at $TranscriptPath"
}
if ($proofExitCode -ne 0) { throw "Exact-head browser/runtime proof runner failed with exit code $proofExitCode. The copyable blocker comment above is the next proof packet." }
