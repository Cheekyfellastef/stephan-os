param(
  [Parameter(Mandatory=$true)]
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
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Step $Label
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Write-ProofCommentBlock {
  param([string]$TranscriptPath)

  if (-not (Test-Path -LiteralPath $TranscriptPath)) {
    throw "Proof transcript was not found at $TranscriptPath"
  }

  $transcript = Get-Content -LiteralPath $TranscriptPath -Raw | ConvertFrom-Json
  $marker = [string]$transcript.marker
  $actualHead = [string]$transcript.exactHead.actual
  $expectedHead = [string]$transcript.exactHead.expected
  $exactHeadMatched = [string]$transcript.exactHead.matched
  $runtimePassed = [string]$transcript.runtime.passed
  $runtimeUrl = [string]$transcript.runtime.url
  $runtimeStatus = [string]$transcript.runtime.statusCode
  $browserRuntimeProof = [string]$transcript.proofScope.browserRuntimeProof
  $browserRuntimeDomProof = [string]$transcript.proofScope.browserRuntimeDomProof
  $operatorAction = [string]$transcript.operatorAction
  $domTitle = [string]$transcript.runtime.domSignals.title
  $domHasHtmlShell = [string]$transcript.runtime.domSignals.hasHtmlShell
  $domContainsStephanos = [string]$transcript.runtime.domSignals.bodyContainsStephanos
  $domContentLength = [string]$transcript.runtime.domSignals.contentLength
  $commentPath = Join-Path (Split-Path -Parent $TranscriptPath) "local-proof-github-comment.md"

  $comment = @"
```text
$marker
PR = #1288
EXPECTED_HEAD = $expectedHead
ACTUAL_HEAD = $actualHead
EXACT_HEAD_MATCHED = $exactHeadMatched
RUNTIME_URL = $runtimeUrl
RUNTIME_STATUS = $runtimeStatus
RUNTIME_PASSED = $runtimePassed
BROWSER_RUNTIME_PROOF = $browserRuntimeProof
BROWSER_RUNTIME_DOM_PROOF = $browserRuntimeDomProof
DOM_TITLE = $domTitle
DOM_HAS_HTML_SHELL = $domHasHtmlShell
DOM_CONTAINS_STEPHANOS = $domContainsStephanos
DOM_CONTENT_LENGTH = $domContentLength
OPERATOR_ACTION = $operatorAction
TRANSCRIPT = tmp/stephanos-ignition/ignition-proof-runner-transcript.json
COMMENT_ARTIFACT = tmp/stephanos-ignition/local-proof-github-comment.md
MERGE_ALLOWED = NO
```
"@

  Set-Content -LiteralPath $commentPath -Value $comment -Encoding UTF8

  Write-Step "Copyable GitHub milestone/proof comment"
  Write-Host "Paste this into #1281 / PR #1288 after local proof completes:"
  Write-Host ""
  Write-Host $comment
  Write-Host "commentArtifact=$commentPath"

  try {
    Set-Clipboard -Value $comment
    Write-Host "clipboard=proof-comment-ready"
  } catch {
    Write-Host "clipboard=unavailable $($_.Exception.Message)"
  }
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$TranscriptPath = Join-Path $RepoRoot "tmp\stephanos-ignition\ignition-proof-runner-transcript.json"

Write-Step "Ignition local proof preflight"
$currentHead = (git rev-parse HEAD).Trim()
Write-Host "expectedHead=$ExpectedHead"
Write-Host "actualHead=$currentHead"
if ($currentHead -ne $ExpectedHead) {
  throw "Exact-head guard failed. Fetch/switch PR #1288 again before running proof."
}

Write-Step "Classify worktree dirt before any cleanup"
$status = git status --porcelain=v1
if ($status) {
  $status | ForEach-Object { Write-Host $_ }
} else {
  Write-Host "workspace=clean"
}

$env:STEPHANOS_IGNITION_EXPECTED_HEAD = $ExpectedHead
$env:STEPHANOS_IGNITION_RUNTIME_URL = $RuntimeUrl

Invoke-Checked "Run ignition concierge unit tests" { npm run stephanos:ignition-concierge:test }
Invoke-Checked "Run ignition concierge proof mode" { npm run stephanos:ignition-concierge:proof }

Write-Step "Start Stephanos through one-button concierge path"
$launcher = Start-Process -FilePath "powershell.exe" -WindowStyle Minimized -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command",
  "cd `"$RepoRoot`"; npm run stephanos"
) -PassThru
Write-Host "launcherPid=$($launcher.Id)"
Write-Host "launcherWindow=minimized-background-proof"

Write-Step "Probe browser/runtime URL"
$deadline = (Get-Date).AddSeconds($ProbeSeconds)
$runtimeReady = $false
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $RuntimeUrl -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
      $runtimeReady = $true
      Write-Host "runtimeStatus=$($response.StatusCode)"
      break
    }
  } catch {
    Write-Host "runtimeProbe=pending $($_.Exception.Message)"
    Start-Sleep -Seconds 3
  }
}

if (-not $runtimeReady) {
  Write-Host "runtimeUrl=$RuntimeUrl"
  throw "Runtime proof did not become ready inside $ProbeSeconds seconds. Leave the launcher window open and inspect the concierge splash/support snapshot."
}

Write-Step "Run exact-head browser/runtime proof runner"
npm run stephanos:ignition-concierge:proof-runner
$proofExitCode = $LASTEXITCODE

if (Test-Path -LiteralPath $TranscriptPath) {
  Write-Step "Ignition proof transcript ready"
  Write-Host "MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_PASSED requires the proof runner marker above."
  Write-Host "transcript=tmp/stephanos-ignition/ignition-proof-runner-transcript.json"
  Write-Host "MERGE_ALLOWED=NO until exact-head operator approval is given."
  Write-ProofCommentBlock -TranscriptPath $TranscriptPath
} else {
  throw "Proof runner did not write transcript at $TranscriptPath"
}

if ($proofExitCode -ne 0) {
  throw "Exact-head browser/runtime proof runner failed with exit code ${proofExitCode}. The copyable blocker comment above is the next proof packet."
}
