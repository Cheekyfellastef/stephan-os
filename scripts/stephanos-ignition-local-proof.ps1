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

  Write-Step "Copyable GitHub milestone/proof comment"
  Write-Host "Paste this into #1281 / PR #1288 after local proof completes:"
  Write-Host ""
  Write-Host '```text'
  Write-Host $marker
  Write-Host "PR = #1288"
  Write-Host "EXPECTED_HEAD = $expectedHead"
  Write-Host "ACTUAL_HEAD = $actualHead"
  Write-Host "EXACT_HEAD_MATCHED = $exactHeadMatched"
  Write-Host "RUNTIME_URL = $runtimeUrl"
  Write-Host "RUNTIME_STATUS = $runtimeStatus"
  Write-Host "RUNTIME_PASSED = $runtimePassed"
  Write-Host "TRANSCRIPT = tmp/stephanos-ignition/ignition-proof-runner-transcript.json"
  Write-Host "MERGE_ALLOWED = NO"
  Write-Host '```'
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

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
$launcher = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy", "Bypass",
  "-Command",
  "cd `"$RepoRoot`"; npm run stephanos"
) -PassThru
Write-Host "launcherPid=$($launcher.Id)"

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

Invoke-Checked "Run exact-head browser/runtime proof runner" { npm run stephanos:ignition-concierge:proof-runner }

Write-Step "Ignition proof transcript ready"
Write-Host "MILESTONE_5_IGNITION_BROWSER_RUNTIME_PROOF_PASSED requires the proof runner marker above."
Write-Host "transcript=tmp/stephanos-ignition/ignition-proof-runner-transcript.json"
Write-Host "MERGE_ALLOWED=NO until exact-head operator approval is given."

Write-ProofCommentBlock -TranscriptPath (Join-Path $RepoRoot "tmp\stephanos-ignition\ignition-proof-runner-transcript.json")
