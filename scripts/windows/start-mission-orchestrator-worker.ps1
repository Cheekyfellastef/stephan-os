[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "",
    [string]$MissionRunnerRoot = ""
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

# WORKER_LOG_RETENTION_FUNCTION_START
function Invoke-BoundedWorkerLogRetention {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$LogRoot,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [Parameter(Mandatory = $true)][string]$ArchivePath
    )

    $maximumLogBytes = 64MB
    $retainedArchiveBytes = 8MB
    $resolvedRoot = [System.IO.Path]::GetFullPath($LogRoot)
    $resolvedLogPath = [System.IO.Path]::GetFullPath($LogPath)
    $resolvedArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
    if ((Split-Path -Parent $resolvedLogPath) -ne $resolvedRoot -or (Split-Path -Leaf $resolvedLogPath) -ne 'worker.log') {
        throw 'Mission worker log retention requires the exact worker.log path below the fixed log root.'
    }
    if ((Split-Path -Parent $resolvedArchivePath) -ne $resolvedRoot -or (Split-Path -Leaf $resolvedArchivePath) -ne 'worker.previous.log') {
        throw 'Mission worker log retention requires the exact worker.previous.log path below the fixed log root.'
    }
    if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) {
        throw 'Mission worker log retention requires the fixed log root to exist.'
    }
    $rootItem = Get-Item -LiteralPath $resolvedRoot -Force
    if (($rootItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Mission worker log retention refuses a redirected log root.'
    }
    $replacementBackupPath = Join-Path $resolvedRoot '.worker.previous.replaced.log'
    if (Test-Path -LiteralPath $replacementBackupPath) {
        $replacementBackupItem = Get-Item -LiteralPath $replacementBackupPath -Force
        if ($replacementBackupItem.PSIsContainer -or (($replacementBackupItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'Mission worker replacement backup must be one plain file.'
        }
        [System.IO.File]::Delete($replacementBackupPath)
    }

    $logItem = $null
    if (Test-Path -LiteralPath $resolvedLogPath) {
        $logItem = Get-Item -LiteralPath $resolvedLogPath -Force
        if ($logItem.PSIsContainer -or (($logItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'Mission worker current log must be one plain file.'
        }
    }
    $archiveItem = $null
    if (Test-Path -LiteralPath $resolvedArchivePath) {
        $archiveItem = Get-Item -LiteralPath $resolvedArchivePath -Force
        if ($archiveItem.PSIsContainer -or (($archiveItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'Mission worker retained log must be one plain file.'
        }
    }

    if ($logItem -and [long]$logItem.Length -gt $maximumLogBytes) {
        if ($archiveItem) {
            [System.IO.File]::Delete($resolvedArchivePath)
        }
        [System.IO.File]::Move($resolvedLogPath, $resolvedArchivePath)
        $archiveItem = Get-Item -LiteralPath $resolvedArchivePath -Force
    }

    if (-not $archiveItem -or [long]$archiveItem.Length -le $retainedArchiveBytes) {
        return
    }

    $temporaryArchivePath = Join-Path $resolvedRoot ('.worker.previous.{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    $sourceStream = $null
    $destinationStream = $null
    try {
        $sourceStream = [System.IO.File]::Open(
            $resolvedArchivePath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::Read
        )
        $bytesToRetain = [Math]::Min([long]$retainedArchiveBytes, [long]$sourceStream.Length)
        [void]$sourceStream.Seek(-$bytesToRetain, [System.IO.SeekOrigin]::End)
        $destinationStream = [System.IO.File]::Open(
            $temporaryArchivePath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $buffer = [byte[]]::new(64KB)
        $remaining = $bytesToRetain
        while ($remaining -gt 0) {
            $readLength = [int][Math]::Min([long]$buffer.Length, [long]$remaining)
            $read = $sourceStream.Read($buffer, 0, $readLength)
            if ($read -le 0) {
                throw 'Mission worker retained log ended before its bounded tail was copied.'
            }
            $destinationStream.Write($buffer, 0, $read)
            $remaining -= $read
        }
        $destinationStream.Flush($true)
        $destinationStream.Dispose()
        $destinationStream = $null
        $sourceStream.Dispose()
        $sourceStream = $null
        [System.IO.File]::Replace($temporaryArchivePath, $resolvedArchivePath, $replacementBackupPath, $true)
        $temporaryArchivePath = $null
        [System.IO.File]::Delete($replacementBackupPath)
    }
    finally {
        if ($destinationStream) { $destinationStream.Dispose() }
        if ($sourceStream) { $sourceStream.Dispose() }
        if ($temporaryArchivePath -and (Test-Path -LiteralPath $temporaryArchivePath -PathType Leaf)) {
            [System.IO.File]::Delete($temporaryArchivePath)
        }
    }
}

function Write-BoundedWorkerLogLine {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$LogRoot,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [AllowEmptyString()][string]$Line
    )

    $maximumLineCharacters = 4000
    $truncationMarker = '...[worker-log-line-truncated]'
    $singleLine = ([string]$Line).Replace("`r", ' ').Replace("`n", ' ')
    if ($singleLine.Length -gt $maximumLineCharacters) {
        $singleLine = $singleLine.Substring(0, $maximumLineCharacters - $truncationMarker.Length) + $truncationMarker
    }
    Invoke-BoundedWorkerLogRetention -LogRoot $LogRoot -LogPath $LogPath -ArchivePath $ArchivePath
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::AppendAllText([System.IO.Path]::GetFullPath($LogPath), "$singleLine`r`n", $utf8WithoutBom)
    Invoke-BoundedWorkerLogRetention -LogRoot $LogRoot -LogPath $LogPath -ArchivePath $ArchivePath
}
# WORKER_LOG_RETENTION_FUNCTION_END

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
$workerLogArchivePath = Join-Path $logRoot 'worker.previous.log'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
$heartbeatPath = Join-Path $workspaceRoot 'status\mission-orchestrator-worker-heartbeat.json'

foreach ($requiredFile in @($workerScript, $privateKeyPath, $publicKeyPath)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Mission Orchestrator worker file is missing: $requiredFile"
    }
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { $node = Get-Command node -ErrorAction Stop }
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $git) { $git = Get-Command git -ErrorAction Stop }
$branch = (& $git.Source -C $repositoryRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw 'Mission Orchestrator worker requires the canonical checkout on branch main.'
}
$headSha = (& $git.Source -C $repositoryRoot rev-parse HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or $headSha -notmatch '^[0-9a-f]{40}$') {
    throw 'Mission Orchestrator worker could not prove a canonical 40-character Git head.'
}

[System.IO.Directory]::CreateDirectory($receiptRoot) | Out-Null
[System.IO.Directory]::CreateDirectory($logRoot) | Out-Null
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $heartbeatPath)) | Out-Null
Invoke-BoundedWorkerLogRetention -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath

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

Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line "[$([DateTime]::UtcNow.ToString('o'))] Mission Orchestrator worker starting from canonical main $headSha"
& $node.Source $workerScript 2>&1 | ForEach-Object {
    Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line ([string]$_)
}
$exitCode = $LASTEXITCODE
Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line "[$([DateTime]::UtcNow.ToString('o'))] Mission Orchestrator worker exited with code $exitCode"
exit $exitCode
