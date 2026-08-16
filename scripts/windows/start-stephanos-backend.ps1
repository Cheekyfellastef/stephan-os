[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$StartupTimeoutSeconds = 90,
    [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = 'Stop'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNpm = 'C:\Program Files\nodejs\npm.cmd'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'

function Test-BackendHealth {
    param([string]$Url, [string]$ExpectedSourceHead)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
        $body = $response.Content | ConvertFrom-Json
        return $response.StatusCode -eq 200 `
            -and [string]$body.schemaVersion -eq 'stephanos.backend-health.v1' `
            -and [string]$body.backendIdentity.runtimeId -eq 'stephanos-battle-bridge-backend' `
            -and ([string]$body.backendIdentity.sourceHead).ToLowerInvariant() -eq $ExpectedSourceHead
    }
    catch { return $false }
}

function Get-VerifiedBackendListener {
    try {
        $connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop)
        $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($processIds.Count -ne 1) { return $null }
        $processId = [int]$processIds[0]
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        if (-not $process) { return $null }
        $executable = [System.IO.Path]::GetFullPath([string]$process.ExecutablePath)
        if (-not [string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        $commandLine = ([string]$process.CommandLine).Trim()
        $expectedQuotedCommand = "`"$canonicalNode`" stephanos-server/server.js"
        $expectedUnquotedCommand = "$canonicalNode stephanos-server/server.js"
        if (-not [string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase) `
            -and -not [string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
        $processStartTimeUtc = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$process.CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        return [PSCustomObject]@{ ProcessId = $processId; ProcessStartTimeUtc = $processStartTimeUtc }
    }
    catch { return $null }
}

function Write-BackendRuntimeReceipt {
    param(
        [string]$WorkspaceRoot,
        [string]$Branch,
        [string]$HeadSha,
        [int]$ProcessId,
        [string]$ProcessStartTimeUtc,
        [string]$HealthUrl
    )
    $statusDir = Join-Path $WorkspaceRoot 'status'
    [System.IO.Directory]::CreateDirectory($statusDir) | Out-Null
    $statusPath = Join-Path $statusDir 'stephanos-backend-runtime.json'
    $temporaryPath = "${statusPath}.$PID.tmp"
    [PSCustomObject]@{
        schemaVersion = 'stephanos.backend-runtime.v1'
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        branch = $Branch
        headSha = $HeadSha
        taskName = 'Stephanos Battle Bridge Backend'
        pid = $ProcessId
        processStartTimeUtc = $ProcessStartTimeUtc
        healthUrl = 'loopback-backend-health'
        exactHeadProofOk = $true
        trackedWorktreeClean = $true
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        pathValuesPublished = $false
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
}

function Publish-VerifiedBackendRuntimeReceipt {
    param(
        [object]$Listener,
        [string]$WorkspaceRoot,
        [string]$Branch,
        [string]$HeadSha,
        [string]$HealthUrl
    )
    if (-not $Listener) { throw 'Backend listener identity is required before publishing its runtime receipt.' }
    Write-BackendRuntimeReceipt `
        -WorkspaceRoot $WorkspaceRoot `
        -Branch $Branch `
        -HeadSha $HeadSha `
        -ProcessId $Listener.ProcessId `
        -ProcessStartTimeUtc $Listener.ProcessStartTimeUtc `
        -HealthUrl $HealthUrl
    $confirmedListener = Get-VerifiedBackendListener
    if (-not $confirmedListener `
        -or $confirmedListener.ProcessId -ne $Listener.ProcessId `
        -or $confirmedListener.ProcessStartTimeUtc -ne $Listener.ProcessStartTimeUtc `
        -or -not (Test-BackendHealth -Url $HealthUrl -ExpectedSourceHead $HeadSha)) {
        throw 'Backend listener identity or exact-head health changed while publishing the runtime receipt.'
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
Set-Location -Path $repoRoot

foreach ($requiredExecutable in @($canonicalGit, $canonicalNpm, $canonicalNode)) {
    if (-not (Test-Path -LiteralPath $requiredExecutable -PathType Leaf)) {
        throw "Required canonical executable is missing: $requiredExecutable"
    }
}

$branchOutput = @(& $canonicalGit -C $repoRoot branch --show-current 2>$null)
$branchExitCode = $LASTEXITCODE
if ($branchExitCode -ne 0) { throw 'Backend startup could not inspect the canonical Git branch.' }
$branchRaw = $branchOutput | Select-Object -First 1
$headOutput = @(& $canonicalGit -C $repoRoot rev-parse HEAD 2>$null)
$headExitCode = $LASTEXITCODE
if ($headExitCode -ne 0) { throw 'Backend startup could not inspect the canonical Git head.' }
$headRaw = $headOutput | Select-Object -First 1
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
$headSha = if ($headRaw) { ([string]$headRaw).Trim().ToLowerInvariant() } else { '' }
if ($branch -ne 'main') { throw 'Backend startup requires canonical branch main.' }
if ($headSha -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup could not prove a canonical 40-character Git head.' }
$trackedStatus = @(& $canonicalGit -C $repoRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Backend startup could not inspect tracked worktree state.' }
if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0) {
    throw 'Backend startup requires an unmodified tracked worktree at exact head.'
}

$healthUrl = 'http://127.0.0.1:8787/api/health'
$userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { throw 'USERPROFILE or HOME is required.' }
$workspaceRoot = Join-Path $userHome 'Documents\Stephanos-openclaw-workspace'
$logsDir = Join-Path $repoRoot 'logs\battle-bridge'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logPath = Join-Path $logsDir "backend-start-$timestamp.log"
$stdoutLogPath = Join-Path $logsDir "backend-start-$timestamp.stdout.log"
$stderrLogPath = Join-Path $logsDir "backend-start-$timestamp.stderr.log"

function Write-Log {
    param([string]$Message)
    $entry = "[{0}] {1}" -f (Get-Date -Format 's'), $Message
    $entry | Tee-Object -FilePath $logPath -Append
}

function Write-LatestBackendErrorTail {
    param([string]$RootLogsDir, [int]$TailLineCount = 80)
    if (-not (Test-Path -LiteralPath $RootLogsDir)) {
        Write-Log "No backend log directory found at $RootLogsDir"
        return
    }
    $latestStderr = Get-ChildItem -Path $RootLogsDir -Filter 'backend-start-*.stderr.log' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latestStderr) {
        Write-Log 'No backend stderr log found to tail.'
        return
    }
    Write-Log ("Latest backend stderr log: {0}" -f $latestStderr.FullName)
    Get-Content -Path $latestStderr.FullName -Tail $TailLineCount | ForEach-Object { Write-Log $_ }
}

Write-Log "Stephanos Battle Bridge backend start requested from canonical main ${headSha}."
Write-Log "Backend health endpoint: $healthUrl"
Write-Log 'Frontend/dist server not started by this backend script (port 4173).'
Write-Log 'Ensuring OpenClaw readonly adapter stub lifecycle (execution remains disabled).'

try {
    $openClawEnsureOutput = & $canonicalNpm run --silent openclaw:stub:ensure 2>&1 | Out-String
    Write-Log ("openclaw:stub:ensure -> {0}" -f $openClawEnsureOutput.Trim())
}
catch {
    Write-Log ("WARNING: OpenClaw readonly stub ensure failed: {0}" -f $_.Exception.Message)
    Write-Log 'WARNING: Continuing backend startup. OpenClaw execution remains disabled.'
}

$existingListener = if (Test-BackendHealth -Url $healthUrl -ExpectedSourceHead $headSha) {
    Get-VerifiedBackendListener
} else { $null }
if ($existingListener) {
    Publish-VerifiedBackendRuntimeReceipt -Listener $existingListener -WorkspaceRoot $workspaceRoot -Branch $branch -HeadSha $headSha -HealthUrl $healthUrl
    Write-Log 'Backend already healthy; exact listener receipt refreshed without starting a new process.'
    exit 0
}

$arguments = @('run', 'stephanos:backend')
$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha
Write-Log ("Starting backend with command: {0} {1}" -f $canonicalNpm, ($arguments -join ' '))
if ($PSCmdlet.ShouldProcess("$canonicalNpm $($arguments -join ' ')", 'Start Stephanos backend')) {
    $process = Start-Process -FilePath $canonicalNpm `
        -ArgumentList $arguments `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutLogPath `
        -RedirectStandardError $stderrLogPath `
        -WindowStyle Hidden `
        -PassThru
    Write-Log ("Start-Process launched with PID {0}." -f $process.Id)
}
else {
    Write-Log 'WhatIf: backend start command was not executed.'
    exit 0
}

$deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
$listener = $null
while ((Get-Date) -lt $deadline) {
    if (Test-BackendHealth -Url $healthUrl -ExpectedSourceHead $headSha) {
        $listener = Get-VerifiedBackendListener
        if ($listener) { break }
    }
    Start-Sleep -Seconds $PollIntervalSeconds
}

if ($listener) {
    Publish-VerifiedBackendRuntimeReceipt -Listener $listener -WorkspaceRoot $workspaceRoot -Branch $branch -HeadSha $headSha -HealthUrl $healthUrl
    Write-Log "Backend health, stable listener identity and exact-head runtime receipt succeeded within $StartupTimeoutSeconds seconds."
    exit 0
}

Write-Log "ERROR: Backend health or verified listener did not succeed within $StartupTimeoutSeconds seconds."
Write-LatestBackendErrorTail -RootLogsDir $logsDir
exit 1
