[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "",
    [string]$MissionRunnerRoot = ""
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) {
    throw 'USERPROFILE is required to resolve canonical Mission Orchestrator paths.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($StephanosRepositoryRoot)) {
    $StephanosRepositoryRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
}
if ([string]::IsNullOrWhiteSpace($MissionRunnerRoot)) {
    $MissionRunnerRoot = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner'
}

$repositoryRoot = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$missionRunnerRoot = [System.IO.Path]::GetFullPath($MissionRunnerRoot)
$expectedRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
$expectedMissionRunnerRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner'))
if ($repositoryRoot -ne $expectedRepositoryRoot) {
    throw "Mission Orchestrator worker must run from the canonical checkout: $expectedRepositoryRoot"
}
if ($missionRunnerRoot -ne $expectedMissionRunnerRoot) {
    throw "Mission Orchestrator worker must use the canonical mission runner root: $expectedMissionRunnerRoot"
}

$workerScript = Join-Path $repositoryRoot 'scripts\mission-orchestrator-worker-supervised.mjs'
$privateKeyPath = Join-Path $missionRunnerRoot 'keys\stephanos-github-authorization-private.pem'
$publicKeyPath = Join-Path $missionRunnerRoot 'keys\stephanos-github-authorization-public.pem'
$receiptRoot = Join-Path $missionRunnerRoot 'proof\openclaw-github-authorizations'
$logRoot = Join-Path $missionRunnerRoot 'logs\mission-orchestrator-worker'
$logPath = Join-Path $logRoot 'worker.log'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'

foreach ($requiredFile in @($workerScript, $privateKeyPath, $publicKeyPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Mission Orchestrator worker file is missing: $requiredFile"
    }
}

foreach ($requiredExecutable in @($canonicalNode, $canonicalGit)) {
    if (-not (Test-Path -LiteralPath $requiredExecutable -PathType Leaf)) {
        throw "Required canonical executable is missing: $requiredExecutable"
    }
}
$branch = (& $canonicalGit -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw 'Mission Orchestrator worker requires the canonical checkout on branch main.'
}
$headSha = (& $canonicalGit -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$') {
    throw 'Mission Orchestrator worker could not prove a canonical 40-character Git head.'
}
$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)
if ($LASTEXITCODE -ne 0 -or $trackedStatus.Count -ne 0) {
    throw 'Mission Orchestrator worker requires tracked-clean exact-head source.'
}
$remoteMain = @(& $canonicalGit 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>&1)
if ($LASTEXITCODE -ne 0 -or $remoteMain.Count -ne 1 `
    -or [string]$remoteMain[0] -notmatch '^([0-9a-fA-F]{40})\s+refs/heads/main$' `
    -or $Matches[1].ToLowerInvariant() -ne $headSha) {
    throw 'Mission Orchestrator worker requires the exact current public main head.'
}

[System.IO.Directory]::CreateDirectory($receiptRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($logRoot) | Out-Null
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $heartbeatPath)) | Out-Null

$env:STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH = $privateKeyPath
$env:STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH = $publicKeyPath
$env:STEPHANOS_GITHUB_AUTH_RECEIPT_DIR = $receiptRoot
$env:STEPHANOS_MISSION_ORCHESTRATOR_DIR = Join-Path $missionRunnerRoot 'orchestrator'
$env:STEPHANOS_MISSION_OPERATIONS_DIR = Join-Path $missionRunnerRoot 'proof\mission-operations'
$env:STEPHANOS_MISSION_WORKER_QUEUE_DIR = Join-Path $missionRunnerRoot 'orchestrator\worker-queue'
$env:STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT = $repositoryRoot
$env:STEPHANOS_MISSION_WORKER_BRANCH = $branch
$env:STEPHANOS_MISSION_WORKER_HEAD_SHA = $headSha
$env:STEPHANOS_MISSION_WORKER_TASK_NAME = 'Stephanos Mission Orchestrator Worker'

"[$([DateTime]::UtcNow.ToString('o'))] Mission Orchestrator worker starting from canonical main $headSha" | Out-File -LiteralPath $logPath -Append -Encoding utf8
& $canonicalNode $workerScript 2>&1 | ForEach-Object {
    [string]$_ | Out-File -LiteralPath $logPath -Append -Encoding utf8
}
$exitCode = $LASTEXITCODE
"[$([DateTime]::UtcNow.ToString('o'))] Mission Orchestrator worker exited with code $exitCode" | Out-File -LiteralPath $logPath -Append -Encoding utf8
exit $exitCode
