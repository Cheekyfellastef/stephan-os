# Stephanos OpenClaw GitHub Operator Bridge
# Publishes sanitized mission progress around the signed Stephanos GitHub executor.

param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath,

    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os",
    [string]$PublicKeyPath = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner\keys\stephanos-github-authorization-public.pem",
    [string]$AuthorizationReceiptDirectory = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner\proof\openclaw-github-authorizations",
    [string]$MissionOperationsDirectory = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner\proof\mission-operations"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-Sha256TextLower([string]$Text) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
        $sha.Dispose()
    }
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $directory = [System.IO.Path]::GetDirectoryName($Path)
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    $json = $Value | ConvertTo-Json -Depth 20
    $temporaryPath = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Get-SafeId([string]$Value) {
    $safe = ($Value -replace '[^a-zA-Z0-9_.-]', '-').Trim('-')
    if ([string]::IsNullOrWhiteSpace($safe)) {
        throw "Mission or authorization id is invalid."
    }
    return $safe
}

function Get-SanitizedCommandReceipts([object[]]$Receipts) {
    $result = @()
    foreach ($receipt in @($Receipts)) {
        $stdout = [string]$receipt.stdout
        $stderr = [string]$receipt.stderr
        $combined = $stdout + [Environment]::NewLine + $stderr
        $result += [ordered]@{
            executable        = [System.IO.Path]::GetFileName([string]$receipt.executable)
            exitCode          = [int]$receipt.exitCode
            commandOutputHash = Get-Sha256TextLower $combined
            stdoutLength      = $stdout.Length
            stderrLength      = $stderr.Length
        }
    }
    return $result
}

$requestFullPath = [System.IO.Path]::GetFullPath($RequestPath)
$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$operatorScript = Join-Path $repositoryRoot "scripts\openclaw-github-operator.mjs"
$publicKeyFullPath = [System.IO.Path]::GetFullPath($PublicKeyPath)
$authorizationReceiptRoot = [System.IO.Path]::GetFullPath($AuthorizationReceiptDirectory)
$missionOperationsRoot = [System.IO.Path]::GetFullPath($MissionOperationsDirectory)

if (-not (Test-Path -LiteralPath $requestFullPath -PathType Leaf)) {
    throw "Signed OpenClaw GitHub request is missing."
}
if (-not (Test-Path -LiteralPath $operatorScript -PathType Leaf)) {
    throw "Stephanos OpenClaw GitHub operator script is missing."
}
if (-not (Test-Path -LiteralPath $publicKeyFullPath -PathType Leaf)) {
    throw "Stephanos GitHub authorization public key is missing."
}

$request = Get-Content -LiteralPath $requestFullPath -Raw | ConvertFrom-Json
$missionId = [string]$request.authorization.claims.missionId
$authorizationId = [string]$request.authorization.claims.authorizationId
$operation = [string]$request.authorization.claims.operation
$repository = [string]$request.authorization.claims.repository
$branch = [string]$request.authorization.claims.branch
$baseBranch = [string]$request.authorization.claims.baseBranch
$worktreePath = [string]$request.authorization.claims.worktreePath
$changedFiles = @($request.authorization.claims.changedFiles)
$claimsSha256 = [string]$request.authorization.claimsSha256

$safeMissionId = Get-SafeId $missionId
$safeAuthorizationId = Get-SafeId $authorizationId
$snapshotPath = Join-Path $missionOperationsRoot "$safeMissionId.snapshot.json"
$resultPath = Join-Path $missionOperationsRoot "$safeAuthorizationId.operation.json"
$startedAt = [DateTime]::UtcNow.ToString("o")

$runningSnapshot = [ordered]@{
    schemaVersion   = "stephanos.mission-operations-snapshot.v1"
    missionId       = $missionId
    title           = "OpenClaw GitHub $operation"
    intendedOutcome = "Complete the exact signed GitHub operation and return deterministic receipts."
    state           = "RUNNING"
    currentPhase    = $operation
    nextAction      = "Wait for the signed OpenClaw operation completion receipt."
    startedAt       = $startedAt
    updatedAt       = $startedAt
    source          = "openclaw-standalone"
    activeAgent     = [ordered]@{
        agentId = "openclaw-standalone"
        label   = "OpenClaw Standalone"
        role    = "executor"
        status  = "active"
    }
    github          = [ordered]@{
        repository   = $repository
        branch       = $branch
        baseBranch   = $(if ($baseBranch) { $baseBranch } else { "main" })
        worktreePath = $worktreePath
        changedFiles = $changedFiles
    }
    receipts        = @(
        [ordered]@{
            receiptId   = $authorizationId
            receiptType = "stephanos.openclaw-github-authorization.v1"
            source      = "stephanos"
            status      = "verified-by-executor"
            sha256      = $claimsSha256
            createdAt   = $startedAt
        }
    )
    finalVerdict    = "RUNNING"
}

Write-AtomicJson -Path $snapshotPath -Value $runningSnapshot

$env:STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH = $publicKeyFullPath
$env:STEPHANOS_GITHUB_AUTH_RECEIPT_DIR = $authorizationReceiptRoot
$env:STEPHANOS_MISSION_OPERATIONS_DIR = $missionOperationsRoot

$nativeErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$outputLines = @(
    & node.exe $operatorScript $requestFullPath 2>&1 | ForEach-Object { [string]$_ }
)
$executorExitCode = $LASTEXITCODE
$ErrorActionPreference = $nativeErrorPreference
$rawOutput = $outputLines -join [Environment]::NewLine
$completedAt = [DateTime]::UtcNow.ToString("o")

$executorResult = $null
try {
    $executorResult = $rawOutput | ConvertFrom-Json
} catch {
    $executorResult = [ordered]@{
        finalVerdict = "BLOCKED"
        message      = "OpenClaw GitHub operator returned non-JSON output."
        blockers     = @("Executor output could not be parsed.")
    }
}

$sanitizedReceipts = Get-SanitizedCommandReceipts @($executorResult.receipts)
$passed = ($executorExitCode -eq 0) -and ([string]$executorResult.finalVerdict -eq "OPENCLAW_GITHUB_OPERATION_PASS")
$finalState = $(if ($passed) { "COMPLETE" } else { "BLOCKED" })
$finalVerdict = $(if ($passed) { "OPENCLAW_GITHUB_OPERATION_PASS" } else { "OPENCLAW_GITHUB_OPERATION_BLOCKED" })
$blockers = @()
if (-not $passed) {
    $blockers += @($executorResult.blockers)
    if ($executorResult.message) {
        $blockers += [string]$executorResult.message
    }
    if ($blockers.Count -eq 0) {
        $blockers += "OpenClaw GitHub operator failed without a structured blocker."
    }
}

$operationReceipt = [ordered]@{
    schemaVersion     = "stephanos.openclaw-github-operation-result.v1"
    missionId         = $missionId
    authorizationId   = $authorizationId
    operation         = $operation
    repository        = $repository
    branch            = $branch
    baseBranch        = $(if ($baseBranch) { $baseBranch } else { "main" })
    worktreePath      = $worktreePath
    changedFiles      = $changedFiles
    startedAt         = $startedAt
    completedAt       = $completedAt
    executorExitCode  = $executorExitCode
    executorOutputHash = Get-Sha256TextLower $rawOutput
    receipts          = $sanitizedReceipts
    blockers          = $blockers
    finalVerdict      = $finalVerdict
}
Write-AtomicJson -Path $resultPath -Value $operationReceipt

$finalSnapshot = [ordered]@{
    schemaVersion   = "stephanos.mission-operations-snapshot.v1"
    missionId       = $missionId
    title           = "OpenClaw GitHub $operation"
    intendedOutcome = "Complete the exact signed GitHub operation and return deterministic receipts."
    state           = $finalState
    currentPhase    = $operation
    nextAction      = $(if ($passed) {
        "Review the operation receipt and issue the next signed action."
    } else {
        "Inspect blockers and executor output hash before authorizing a retry."
    })
    startedAt       = $startedAt
    updatedAt       = $completedAt
    source          = "openclaw-standalone"
    activeAgent     = [ordered]@{
        agentId = "openclaw-standalone"
        label   = "OpenClaw Standalone"
        role    = "executor"
        status  = "idle"
    }
    github          = [ordered]@{
        repository   = $repository
        branch       = $branch
        baseBranch   = $(if ($baseBranch) { $baseBranch } else { "main" })
        worktreePath = $worktreePath
        changedFiles = $changedFiles
    }
    blockers        = $blockers
    receipts        = @(
        [ordered]@{
            receiptId   = $authorizationId
            receiptType = "stephanos.openclaw-github-operation-result.v1"
            source      = "openclaw-standalone"
            status      = $finalVerdict
            sha256      = Get-Sha256TextLower (($operationReceipt | ConvertTo-Json -Depth 20))
            receiptPath = $resultPath
            createdAt   = $completedAt
        }
    )
    finalVerdict    = $finalVerdict
}
Write-AtomicJson -Path $snapshotPath -Value $finalSnapshot

Write-Output "MISSION=STEPHANOS_OPENCLAW_GITHUB_OPERATOR_BRIDGE"
Write-Output "MISSION_ID=$missionId"
Write-Output "AUTHORIZATION_ID=$authorizationId"
Write-Output "OPERATION=$operation"
Write-Output "EXECUTOR_EXIT_CODE=$executorExitCode"
Write-Output "EXECUTOR_OUTPUT_SHA256=$(Get-Sha256TextLower $rawOutput)"
Write-Output "SNAPSHOT_PATH=$snapshotPath"
Write-Output "RESULT_PATH=$resultPath"
Write-Output "FINAL_VERDICT=$finalVerdict"

if (-not $passed) {
    exit 1
}
