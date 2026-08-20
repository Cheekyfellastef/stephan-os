[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$StartupTimeoutSeconds = 90,
    [int]$PollIntervalSeconds = 3,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead
)

$ErrorActionPreference = 'Stop'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNpm = 'C:\Program Files\nodejs\npm.cmd'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$runtimeMemoryPath = 'stephanos-server/data/memory/durable-memory.json'
$runtimeDistPrefix = 'apps/stephanos/dist/'

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

function Test-CanonicalBackendCommandLine {
    param([string]$CommandLine)
    $commandLine = (([string]$CommandLine -replace '\s+', ' ').Trim())
    $expectedQuotedCommand = "`"$canonicalNode`" stephanos-server/server.js"
    $expectedUnquotedCommand = "$canonicalNode stephanos-server/server.js"
    if ([string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase) `
        -or [string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    $expectedNpmNodeCommand = 'node stephanos-server/server.js'
    $expectedNpmNodeExeCommand = 'node.exe stephanos-server/server.js'
    return [string]::Equals($commandLine, $expectedNpmNodeCommand, [System.StringComparison]::OrdinalIgnoreCase) `
        -or [string]::Equals($commandLine, $expectedNpmNodeExeCommand, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-RuntimeUiDistStatus {
    param([string]$Status)
    return $Status -eq ' M' -or $Status -eq ' D'
}

function Convert-ProcessCreationDateToUtcText {
    param([object]$CreationDate)
    if ($CreationDate -is [DateTime]) {
        return ([DateTime]$CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    if ($CreationDate -is [DateTimeOffset]) {
        return ([DateTimeOffset]$CreationDate).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    $creationText = [string]$CreationDate
    if ([string]::IsNullOrWhiteSpace($creationText)) { throw 'BACKEND_LISTENER_CREATION_TIME_MISSING' }
    return [System.Management.ManagementDateTimeConverter]::ToDateTime($creationText).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Get-TrackedWorktreeAssessment {
    param([string[]]$StatusLines)
    $runtimeMemoryDirty = $false
    $runtimeDistDirty = $false
    $sourceDirt = @()
    foreach ($raw in @($StatusLines)) {
        $line = [string]$raw
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line.Length -lt 4) {
            $sourceDirt += $line
            continue
        }
        $status = $line.Substring(0, 2)
        $pathSegment = $line.Substring(3).Trim()
        if ($pathSegment.Contains(' -> ')) {
            $sourceDirt += $line
            continue
        }
        $path = $pathSegment.Trim('"').Replace('\', '/')
        if ($status -eq ' M' -and $path -eq $runtimeMemoryPath) {
            $runtimeMemoryDirty = $true
            continue
        }
        if ((Test-RuntimeUiDistStatus -Status $status) -and $path.StartsWith($runtimeDistPrefix, [System.StringComparison]::Ordinal)) {
            $runtimeDistDirty = $true
            continue
        }
        $sourceDirt += $line
    }
    return [PSCustomObject]@{
        RuntimeMemoryDirty = [bool]$runtimeMemoryDirty
        RuntimeDistDirty = [bool]$runtimeDistDirty
        SourceDirt = @($sourceDirt)
    }
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
        if (-not (Test-CanonicalBackendCommandLine -CommandLine ([string]$process.CommandLine))) { return $null }
        $processStartTimeUtc = Convert-ProcessCreationDateToUtcText -CreationDate $process.CreationDate
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
        [string]$HealthUrl,
        [bool]$RuntimeMemoryDirty,
        [bool]$RuntimeDistDirty
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
        trackedWorktreeClean = -not ($RuntimeMemoryDirty -or $RuntimeDistDirty)
        sourceWorktreeClean = $true
        runtimeMemoryDirtTolerated = $RuntimeMemoryDirty
        runtimeDistDirtTolerated = $RuntimeDistDirty
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
        [string]$HealthUrl,
        [bool]$RuntimeMemoryDirty,
        [bool]$RuntimeDistDirty
    )
    if (-not $Listener) { throw 'Backend listener identity is required before publishing its runtime receipt.' }
    Write-BackendRuntimeReceipt `
        -WorkspaceRoot $WorkspaceRoot `
        -Branch $Branch `
        -HeadSha $HeadSha `
        -ProcessId $Listener.ProcessId `
        -ProcessStartTimeUtc $Listener.ProcessStartTimeUtc `
        -HealthUrl $HealthUrl `
        -RuntimeMemoryDirty $RuntimeMemoryDirty `
        -RuntimeDistDirty $RuntimeDistDirty
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

function Assert-ExpectedHeadImmediatelyBeforeMutation {
    param([Parameter(Mandatory = $true)][string]$Mutation)
    $headOutput = @(& $canonicalGit -C $repoRoot rev-parse HEAD 2>$null)
    $headExitCode = $LASTEXITCODE
    if ($headExitCode -ne 0) { throw "Canonical Git head proof failed before ${Mutation}." }
    $observedHead = [string]($headOutput | Select-Object -First 1)
    $observedHead = $observedHead.Trim().ToLowerInvariant()
    if ($observedHead -ne $ExpectedHead.ToLowerInvariant()) {
        throw "BACKEND_START_EXPECTED_HEAD_MISMATCH before ${Mutation}: expected=$ExpectedHead observed=$observedHead"
    }
    return $observedHead
}

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
if ($headSha -ne $ExpectedHead.ToLowerInvariant()) { throw "Backend startup expected-head binding mismatch: expected=$ExpectedHead observed=$headSha" }
$trackedStatus = @(& $canonicalGit -C $repoRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Backend startup could not inspect tracked worktree state.' }
$trackedAssessment = Get-TrackedWorktreeAssessment -StatusLines $trackedStatus
if ($trackedAssessment.SourceDirt.Count -ne 0) {
    throw 'Backend startup requires source-tracked files to be unmodified at exact head.'
}
$runtimeMemoryDirty = [bool]$trackedAssessment.RuntimeMemoryDirty
$runtimeDistDirty = [bool]$trackedAssessment.RuntimeDistDirty

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
Write-Log ("Runtime memory dirt tolerated: {0}" -f $runtimeMemoryDirty)
Write-Log ("Runtime UI dist dirt tolerated: {0}" -f $runtimeDistDirty)
Write-Log 'Frontend/dist server not started by this backend script (port 4173).'
Write-Log 'Ensuring OpenClaw readonly adapter stub lifecycle (execution remains disabled).'

try {
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure' | Out-Null
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
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend runtime receipt publication' | Out-Null
    Publish-VerifiedBackendRuntimeReceipt -Listener $existingListener -WorkspaceRoot $workspaceRoot -Branch $branch -HeadSha $headSha -HealthUrl $healthUrl -RuntimeMemoryDirty $runtimeMemoryDirty -RuntimeDistDirty $runtimeDistDirty
    Write-Log 'Backend already healthy; exact listener receipt refreshed without starting a new process.'
    exit 0
}

$arguments = @('run', 'stephanos:backend')
$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha
Write-Log ("Starting backend with command: {0} {1}" -f $canonicalNpm, ($arguments -join ' '))
if ($PSCmdlet.ShouldProcess("$canonicalNpm $($arguments -join ' ')", 'Start Stephanos backend')) {
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start' | Out-Null
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
    Publish-VerifiedBackendRuntimeReceipt -Listener $listener -WorkspaceRoot $workspaceRoot -Branch $branch -HeadSha $headSha -HealthUrl $healthUrl -RuntimeMemoryDirty $runtimeMemoryDirty -RuntimeDistDirty $runtimeDistDirty
    Write-Log "Backend health, stable listener identity and exact-head runtime receipt succeeded within $StartupTimeoutSeconds seconds."
    exit 0
}

Write-Log "ERROR: Backend health or verified listener did not succeed within $StartupTimeoutSeconds seconds."
Write-LatestBackendErrorTail -RootLogsDir $logsDir
exit 1
