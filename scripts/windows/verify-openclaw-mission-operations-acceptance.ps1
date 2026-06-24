# Stephanos Mission Operations production acceptance runner.
# Executes one signed, read-only OpenClaw GitHub inspect operation and verifies the dashboard feed.

param(
    [string]$StephanosRepositoryRoot = "",
    [string]$MissionRunnerRoot = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-AtomicJson([string]$Path, [object]$Value) {
    $directory = [System.IO.Path]::GetDirectoryName($Path)
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $temporaryPath = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    $json = $Value | ConvertTo-Json -Depth 30
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

if ([string]::IsNullOrWhiteSpace($StephanosRepositoryRoot)) {
    $StephanosRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
} else {
    $StephanosRepositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
}
$MissionRunnerRoot = [System.IO.Path]::GetFullPath($MissionRunnerRoot)

$bootstrapScript = Join-Path $StephanosRepositoryRoot "scripts\stephanos-bootstrap-openclaw-github-keys.mjs"
$issuerScript = Join-Path $StephanosRepositoryRoot "scripts\stephanos-issue-openclaw-github-authorization.mjs"
$bridgeScript = Join-Path $StephanosRepositoryRoot "scripts\windows\invoke-openclaw-github-operator-bridge.ps1"
$verifierScript = Join-Path $StephanosRepositoryRoot "scripts\verify-mission-operations-receipt.mjs"
$keyDirectory = Join-Path $MissionRunnerRoot "keys"
$privateKeyPath = Join-Path $keyDirectory "stephanos-github-authorization-private.pem"
$publicKeyPath = Join-Path $keyDirectory "stephanos-github-authorization-public.pem"
$requestDirectory = Join-Path $MissionRunnerRoot "proof\mission-operations-requests"
$missionOperationsDirectory = Join-Path $MissionRunnerRoot "proof\mission-operations"
$authorizationReceiptDirectory = Join-Path $MissionRunnerRoot "proof\openclaw-github-authorizations"
$missionId = "mission-operations-production-acceptance"
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssfffZ").ToLowerInvariant()
$authorizationId = "auth-mission-operations-$stamp"
$claimsPath = Join-Path $requestDirectory "$authorizationId.claims.json"
$requestPath = Join-Path $requestDirectory "$authorizationId.request.json"

foreach ($requiredPath in @($bootstrapScript, $issuerScript, $bridgeScript, $verifierScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required acceptance component is missing: $requiredPath"
    }
}
if (-not (Test-Path -LiteralPath $StephanosRepositoryRoot -PathType Container)) {
    throw "Stephanos repository root is missing."
}

Write-Output "MISSION=STEPHANOS_MISSION_OPERATIONS_PRODUCTION_ACCEPTANCE"
Write-Output "OPERATION=inspect"
Write-Output "READ_ONLY_OPERATION=True"
Write-Output "REPOSITORY_ROOT=$StephanosRepositoryRoot"

$keyOutput = @(& node.exe $bootstrapScript $privateKeyPath $publicKeyPath 2>&1)
$keyExitCode = $LASTEXITCODE
$keyJson = $keyOutput -join [Environment]::NewLine
if ($keyExitCode -ne 0) {
    throw "Signing key bootstrap failed: $keyJson"
}
$keyResult = $keyJson | ConvertFrom-Json
Write-Output "KEY_BOOTSTRAP_VERDICT=$($keyResult.finalVerdict)"
Write-Output "KEYS_CREATED=$($keyResult.keysCreated)"

$branchOutput = @(& git.exe -C $StephanosRepositoryRoot branch --show-current 2>$null)
if ($LASTEXITCODE -ne 0) {
    throw "Current Stephanos branch could not be read."
}
$branch = ($branchOutput -join "").Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
    $branch = [string]$env:GITHUB_HEAD_REF
}
if ([string]::IsNullOrWhiteSpace($branch)) {
    $headOutput = @(& git.exe -C $StephanosRepositoryRoot rev-parse --short=12 HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Detached Stephanos HEAD could not be read."
    }
    $branch = "detached/$((($headOutput -join '').Trim()))"
}
Write-Output "BRANCH_IDENTITY=$branch"

$issuedAt = [DateTime]::UtcNow
$claims = [ordered]@{
    authorizationId = $authorizationId
    missionId        = $missionId
    operation        = "inspect"
    repository       = "Cheekyfellastef/stephan-os"
    repositoryRoot   = $StephanosRepositoryRoot
    defaultBranch    = "main"
    baseBranch       = "main"
    branch           = $branch
    worktreePath     = $StephanosRepositoryRoot
    issuedAt         = $issuedAt.ToString("o")
    expiresAt        = $issuedAt.AddMinutes(15).ToString("o")
    singleUse        = $true
}
Write-AtomicJson -Path $claimsPath -Value $claims

$env:STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH = $privateKeyPath
try {
    $issuerOutput = @(& node.exe $issuerScript $claimsPath 2>&1)
    $issuerExitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
}
$issuerJson = $issuerOutput -join [Environment]::NewLine
if ($issuerExitCode -ne 0) {
    throw "Stephanos authorization issuer failed: $issuerJson"
}
$authorization = $issuerJson | ConvertFrom-Json
if ([string]$authorization.finalVerdict -ne "STEPHANOS_AUTHORIZATION_ISSUED") {
    throw "Stephanos did not issue the signed authorization."
}
Write-Output "AUTHORIZATION_ID=$authorizationId"
Write-Output "AUTHORIZATION_CLAIMS_SHA256=$($authorization.claimsSha256)"

$request = [ordered]@{
    authorization = $authorization
    approvalToken = ""
}
Write-AtomicJson -Path $requestPath -Value $request

$bridgeOutput = @(
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bridgeScript `
        -RequestPath $requestPath `
        -StephanosRepositoryRoot $StephanosRepositoryRoot `
        -PublicKeyPath $publicKeyPath `
        -AuthorizationReceiptDirectory $authorizationReceiptDirectory `
        -MissionOperationsDirectory $missionOperationsDirectory 2>&1
)
$bridgeExitCode = $LASTEXITCODE
$bridgeOutput | ForEach-Object { Write-Output ([string]$_) }
if ($bridgeExitCode -ne 0) {
    throw "Signed OpenClaw bridge operation failed."
}

$verificationOutput = @(& node.exe $verifierScript $missionOperationsDirectory $missionId 2>&1)
$verificationExitCode = $LASTEXITCODE
$verificationJson = $verificationOutput -join [Environment]::NewLine
if ($verificationExitCode -ne 0) {
    throw "Mission Operations feed verification failed: $verificationJson"
}
$verification = $verificationJson | ConvertFrom-Json

Write-Output "FEED_STATUS=$($verification.feedStatus)"
Write-Output "MISSION_FOUND=$($verification.missionFound)"
Write-Output "MISSION_STATE=$($verification.missionState)"
Write-Output "MISSION_VERDICT=$($verification.missionVerdict)"
Write-Output "RECEIPT_COUNT=$($verification.receiptCount)"
Write-Output "REQUEST_PATH=$requestPath"
Write-Output "FINAL_VERDICT=$($verification.finalVerdict)"
