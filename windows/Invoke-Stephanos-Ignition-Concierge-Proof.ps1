param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedHeadSha,
  [string]$RepositoryRoot = (Get-Location).Path,
  [string]$ArtifactPath = 'tmp/ignition-concierge-proof-comment.md'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-ProofLog([string]$Message) {
  Write-Host "[IGNITION CONCIERGE PROOF] $Message"
}

$repoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
Set-Location -LiteralPath $repoRoot

$currentHead = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentHead)) {
  throw 'Unable to resolve current git HEAD for exact-head proof.'
}

if ($currentHead -ne $ExpectedHeadSha) {
  throw "Exact-head proof blocked. Expected $ExpectedHeadSha but repository is at $currentHead. Fetch/check out the PR head before proving."
}

Write-ProofLog "exact HEAD confirmed: $currentHead"
Write-ProofLog 'running source proof runner; no merge, push, OpenClaw unlock, or approval bypass will be performed.'
$env:STEPHANOS_IGNITION_PROOF_COMMENT = $ArtifactPath
node scripts/ignition-concierge-proof-runner.mjs
if ($LASTEXITCODE -ne 0) {
  throw "Ignition concierge proof runner failed with exit code $LASTEXITCODE."
}

Write-ProofLog "proof runner transcript/comment artifact written to $ArtifactPath"
Write-ProofLog 'exact-head merge approval is still required before merge.'
