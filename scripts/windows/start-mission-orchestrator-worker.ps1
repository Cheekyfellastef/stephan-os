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
$statusRoot = Split-Path -Parent $heartbeatPath
$restartRequestPath = Join-Path $statusRoot 'mission-orchestrator-worker-restart-request.json'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'

function Write-BoundedAtomicJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 6 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 8192) { throw 'Mission worker restart record exceeds the fixed bound.' }
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    $temporaryPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporaryPath, "$json`n", $encoding)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
}

function Write-BoundedCreateOnlyJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 6 -Compress
    if ([Text.Encoding]::UTF8.GetByteCount($json) -gt 8192) { throw 'Mission worker immutable launch record exceeds the fixed bound.' }
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    if (Test-Path -LiteralPath $Path) { throw 'Mission worker immutable launch record already exists.' }
    $temporaryPath = "$Path.$PID.$([guid]::NewGuid().ToString('N')).tmp"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporaryPath, "$json`n", $encoding)
        [System.IO.File]::Move($temporaryPath, $Path)
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function New-CryptographicLaunchIdentityId {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) }
    finally { $generator.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Read-ExactInvocationSignal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$SchemaVersion,
        [Parameter(Mandatory = $true)][string]$InvocationId,
        [Parameter(Mandatory = $true)][int]$WorkerPid,
        [Parameter(Mandatory = $true)][datetime]$WorkerStartedAtUtc
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $record = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        if ([string]$record.schemaVersion -ne $SchemaVersion) { return $null }
        if ([string]$record.invocationId -ne $InvocationId) { return $null }
        if ([string]$record.taskName -ne 'Stephanos Mission Orchestrator Worker') { return $null }
        if ([string]$record.repositoryRoot -ne $repositoryRoot) { return $null }
        if ([string]$record.headSha -ne $headSha) { return $null }
        if ([string]$record.deadlineUtc -ne $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')) { return $null }
        $recordPid = [int]$record.workerPid
        if ($recordPid -ne $WorkerPid) { return $null }
        $recordStartedAtUtc = [datetime]::Parse([string]$record.workerStartedAtUtc).ToUniversalTime()
        if ($recordStartedAtUtc.Ticks -ne $WorkerStartedAtUtc.ToUniversalTime().Ticks) { return $null }
        return $record
    }
    catch { return $null }
}

function Stop-ExactOwnedWorkerProcess {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$OwnedProcess,
        [Parameter(Mandatory = $true)][string]$ExpectedNode,
        [Parameter(Mandatory = $true)][string]$ExpectedWorkerScript,
        [datetime]$ExpectedStartedAtUtc = [datetime]::MinValue
    )

    if (-not [object]::ReferenceEquals($Process, $OwnedProcess)) {
        throw 'Mission worker launcher cleanup process capability changed.'
    }
    if (-not [string]::Equals([System.IO.Path]::GetFullPath([string]$Process.StartInfo.FileName), $ExpectedNode, [System.StringComparison]::OrdinalIgnoreCase) `
        -or [string]$Process.StartInfo.Arguments -ne ('"' + $ExpectedWorkerScript + '"') `
        -or -not [string]::Equals([System.IO.Path]::GetFullPath([string]$Process.StartInfo.WorkingDirectory), $repositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) `
        -or $Process.StartInfo.UseShellExecute `
        -or -not $Process.StartInfo.CreateNoWindow) {
        throw 'Mission worker launcher cleanup command identity changed.'
    }
    if ($Process.HasExited) { return }
    if ($Process.Id -le 0) {
        throw 'Mission worker launcher cleanup process identity is invalid.'
    }
    if ($ExpectedStartedAtUtc -ne [datetime]::MinValue) {
        $observedStartedAtUtc = $Process.StartTime.ToUniversalTime()
        if ($observedStartedAtUtc.Ticks -ne $ExpectedStartedAtUtc.ToUniversalTime().Ticks) {
            throw 'Mission worker launcher cleanup process start identity changed.'
        }
    }
    $Process.Kill()
    if (-not $Process.WaitForExit(5000)) {
        throw 'Mission worker launcher cleanup timed out.'
    }
}

function Start-ExactWorkerWithLaunchIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$LaunchIdentityId,
        [Parameter(Mandatory = $true)][ValidateSet('ordinary', 'guarded-restart')][string]$LaunchKind,
        [string]$RestartInvocationId = '',
        [switch]$CaptureOutput
    )

    if ($LaunchIdentityId -notmatch '^[0-9a-f]{64}$') {
        throw 'Mission worker launch identity is invalid.'
    }
    if (($LaunchKind -eq 'guarded-restart' -and $RestartInvocationId -ne $LaunchIdentityId) `
        -or ($LaunchKind -eq 'ordinary' -and -not [string]::IsNullOrEmpty($RestartInvocationId))) {
        throw 'Mission worker launch identity kind is invalid.'
    }
    $launchReceiptPath = Join-Path $statusRoot "mission-orchestrator-worker-launch-identity-$LaunchIdentityId.json"
    if (Test-Path -LiteralPath $launchReceiptPath) {
        throw 'Mission worker launch identity was already used.'
    }
    if ($workerScript.Contains('"')) { throw 'Canonical worker path contains an unsupported quote.' }
    $processStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processStartInfo.FileName = $canonicalNode
    $processStartInfo.Arguments = '"' + $workerScript + '"'
    $processStartInfo.WorkingDirectory = $repositoryRoot
    $processStartInfo.UseShellExecute = $false
    $processStartInfo.CreateNoWindow = $true
    $processStartInfo.RedirectStandardOutput = [bool]$CaptureOutput
    $processStartInfo.RedirectStandardError = [bool]$CaptureOutput
    $processStartInfo.EnvironmentVariables['STEPHANOS_MISSION_WORKER_LAUNCH_ID'] = $LaunchIdentityId
    $processStartInfo.EnvironmentVariables['STEPHANOS_MISSION_WORKER_LAUNCH_RECEIPT_PATH'] = $launchReceiptPath
    if ($LaunchKind -eq 'guarded-restart') {
        $processStartInfo.EnvironmentVariables['STEPHANOS_MISSION_WORKER_INVOCATION_ID'] = $RestartInvocationId
    }
    else {
        [void]$processStartInfo.EnvironmentVariables.Remove('STEPHANOS_MISSION_WORKER_INVOCATION_ID')
    }

    $workerProcess = New-Object System.Diagnostics.Process
    $workerProcess.StartInfo = $processStartInfo
    $workerProcessStarted = $false
    $ownedWorkerProcess = $null
    $workerStartedAtUtc = [datetime]::MinValue
    try {
        if (-not $workerProcess.Start()) { throw 'Mission worker process did not start.' }
        $workerProcessStarted = $true
        $ownedWorkerProcess = $workerProcess
        $workerStartedAtUtc = $workerProcess.StartTime.ToUniversalTime()
        Write-BoundedCreateOnlyJson -Path $launchReceiptPath -Value ([PSCustomObject]@{
            schemaVersion = 'stephanos.mission-worker-launch-identity.v1'
            launchIdentityId = $LaunchIdentityId
            launchKind = $LaunchKind
            restartInvocationId = $RestartInvocationId
            taskName = 'Stephanos Mission Orchestrator Worker'
            repositoryRoot = $repositoryRoot
            branch = $branch
            headSha = $headSha
            workerPid = $workerProcess.Id
            workerStartedAtUtc = $workerStartedAtUtc.ToString('o')
            canonicalNode = $canonicalNode
            canonicalWorkerScript = $workerScript
            createdAtUtc = [datetime]::UtcNow.ToString('o')
        })
        return [PSCustomObject]@{
            Process = $workerProcess
            OwnedProcess = $ownedWorkerProcess
            StartedAtUtc = $workerStartedAtUtc
            LaunchIdentityId = $LaunchIdentityId
            LaunchReceiptPath = $launchReceiptPath
        }
    }
    catch {
        $launchFailure = $_
        if ($workerProcessStarted) {
            try {
                Stop-ExactOwnedWorkerProcess `
                    -Process $workerProcess `
                    -OwnedProcess $ownedWorkerProcess `
                    -ExpectedNode $canonicalNode `
                    -ExpectedWorkerScript $workerScript `
                    -ExpectedStartedAtUtc $workerStartedAtUtc
            }
            catch {
                throw "Mission worker launch-identity cleanup failed: $($_.Exception.Message)"
            }
        }
        throw $launchFailure
    }
}

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
$canonicalNodeItem = Get-Item -LiteralPath $canonicalNode -Force
if ($canonicalNodeItem.PSIsContainer `
    -or $canonicalNodeItem.LinkType `
    -or (($canonicalNodeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) `
    -or -not [string]::Equals([System.IO.Path]::GetFullPath($canonicalNodeItem.FullName), $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Canonical Node executable identity is invalid.'
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
$restartRequest = $null
if (Test-Path -LiteralPath $restartRequestPath -PathType Leaf) {
    $restartRequest = Get-Content -LiteralPath $restartRequestPath -Raw | ConvertFrom-Json
    $invocationId = [string]$restartRequest.invocationId
    $restartDeadlineUtc = [datetime]::MinValue
    if ([string]$restartRequest.schemaVersion -ne 'stephanos.mission-worker-restart-request.v1' `
        -or $invocationId -notmatch '^[0-9a-f]{64}$' `
        -or [string]$restartRequest.taskName -ne 'Stephanos Mission Orchestrator Worker' `
        -or [string]$restartRequest.repositoryRoot -ne $repositoryRoot `
        -or [string]$restartRequest.headSha -ne $headSha `
        -or -not [datetime]::TryParse([string]$restartRequest.deadlineUtc, [ref]$restartDeadlineUtc)) {
        throw 'Mission worker restart request is invalid.'
    }
    $restartDeadlineUtc = $restartDeadlineUtc.ToUniversalTime()
    if ($restartDeadlineUtc -le [datetime]::UtcNow -or $restartDeadlineUtc -gt [datetime]::UtcNow.AddSeconds(95)) {
        throw 'Mission worker restart request deadline is invalid.'
    }
    $claimPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-claim-$invocationId.json"
    if (Test-Path -LiteralPath $claimPath) { throw 'Mission worker restart invocation was already claimed.' }
    Move-Item -LiteralPath $restartRequestPath -Destination $claimPath
    $launcherProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
    $launcherStartedAtUtc = ([datetime]$launcherProcess.CreationDate).ToUniversalTime()
    Write-BoundedAtomicJson -Path $claimPath -Value ([PSCustomObject]@{
        schemaVersion = 'stephanos.mission-worker-restart-claim.v1'
        invocationId = $invocationId
        taskName = 'Stephanos Mission Orchestrator Worker'
        repositoryRoot = $repositoryRoot
        headSha = $headSha
        launcherPid = $PID
        launcherStartedAtUtc = $launcherStartedAtUtc.ToString('o')
        claimedAtUtc = [datetime]::UtcNow.ToString('o')
        deadlineUtc = $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    })

    $workerProcess = $null
    $workerProcessStarted = $false
    $ownedWorkerProcess = $null
    $workerStartedAtUtc = [datetime]::MinValue
    $restartConfirmed = $false
    try {
        $launchedWorker = Start-ExactWorkerWithLaunchIdentity `
            -LaunchIdentityId $invocationId `
            -LaunchKind 'guarded-restart' `
            -RestartInvocationId $invocationId
        $workerProcess = $launchedWorker.Process
        $workerProcessStarted = $true
        $ownedWorkerProcess = $launchedWorker.OwnedProcess
        $workerStartedAtUtc = $launchedWorker.StartedAtUtc
        $receiptPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-receipt-$invocationId.json"
        Write-BoundedAtomicJson -Path $receiptPath -Value ([PSCustomObject]@{
            schemaVersion = 'stephanos.mission-worker-restart-receipt.v1'
            invocationId = $invocationId
            taskName = 'Stephanos Mission Orchestrator Worker'
            repositoryRoot = $repositoryRoot
            headSha = $headSha
            launcherPid = $PID
            launcherStartedAtUtc = $launcherStartedAtUtc.ToString('o')
            workerPid = $workerProcess.Id
            workerStartedAtUtc = $workerStartedAtUtc.ToString('o')
            canonicalNode = $canonicalNode
            canonicalWorkerScript = $workerScript
            deadlineUtc = $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        })

        $confirmationPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-confirm-$invocationId.json"
        $cancelPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-cancel-$invocationId.json"
        $invocationHeartbeatPath = Join-Path $statusRoot "mission-orchestrator-worker-restart-heartbeat-$invocationId.json"
        $invocationHeartbeatBound = $false
        while (-not $workerProcess.HasExited -and [datetime]::UtcNow -lt $restartDeadlineUtc) {
            if (-not $invocationHeartbeatBound -and (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) {
                try {
                    $heartbeatObservedAtUtc = [datetime]::UtcNow
                    $workerHeartbeat = Get-Content -LiteralPath $heartbeatPath -Raw | ConvertFrom-Json
                    $heartbeatTimestampUtc = [datetime]::Parse([string]$workerHeartbeat.timestampUtc).ToUniversalTime()
                    if ([string]$workerHeartbeat.schemaVersion -eq 'stephanos.mission-orchestrator-worker-heartbeat.v1' `
                        -and [string]$workerHeartbeat.repositoryRoot -eq $repositoryRoot `
                        -and [string]$workerHeartbeat.branch -eq 'main' `
                        -and [string]$workerHeartbeat.headSha -eq $headSha `
                        -and [string]$workerHeartbeat.taskName -eq 'Stephanos Mission Orchestrator Worker' `
                        -and [int]$workerHeartbeat.pid -eq $workerProcess.Id `
                        -and [string]$workerHeartbeat.launchIdentityId -eq $invocationId `
                        -and ([datetime]::Parse([string]$workerHeartbeat.workerStartedAtUtc).ToUniversalTime()).Ticks -eq $workerStartedAtUtc.Ticks `
                        -and $heartbeatTimestampUtc -gt $workerStartedAtUtc `
                        -and $heartbeatTimestampUtc -le $heartbeatObservedAtUtc `
                        -and $workerProcess.StartTime.ToUniversalTime().Ticks -eq $workerStartedAtUtc.Ticks) {
                        Write-BoundedAtomicJson -Path $invocationHeartbeatPath -Value ([PSCustomObject]@{
                            schemaVersion = 'stephanos.mission-worker-restart-heartbeat.v1'
                            invocationId = $invocationId
                            taskName = 'Stephanos Mission Orchestrator Worker'
                            repositoryRoot = $repositoryRoot
                            headSha = $headSha
                            workerPid = $workerProcess.Id
                            workerStartedAtUtc = $workerStartedAtUtc.ToString('o')
                            heartbeatTimestampUtc = $heartbeatTimestampUtc.ToString('o')
                            deadlineUtc = $restartDeadlineUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
                        })
                        $invocationHeartbeatBound = $true
                    }
                }
                catch {
                    $invocationHeartbeatBound = $false
                }
            }
            $confirmation = Read-ExactInvocationSignal `
                -Path $confirmationPath `
                -SchemaVersion 'stephanos.mission-worker-restart-confirmation.v1' `
                -InvocationId $invocationId `
                -WorkerPid $workerProcess.Id `
                -WorkerStartedAtUtc $workerStartedAtUtc
            if ($confirmation -and $invocationHeartbeatBound) { $restartConfirmed = $true; break }
            $cancel = Read-ExactInvocationSignal `
                -Path $cancelPath `
                -SchemaVersion 'stephanos.mission-worker-restart-cancel.v1' `
                -InvocationId $invocationId `
                -WorkerPid $workerProcess.Id `
                -WorkerStartedAtUtc $workerStartedAtUtc
            if ($cancel) { break }
            [void]$workerProcess.WaitForExit(250)
        }
        if (-not $restartConfirmed) {
            throw 'Mission worker restart was not confirmed before its deadline.'
        }
        $workerProcess.WaitForExit()
        $exitCode = $workerProcess.ExitCode
    }
    catch {
        $launchFailure = $_
        if ($workerProcessStarted -and -not $restartConfirmed) {
            try {
                Stop-ExactOwnedWorkerProcess `
                    -Process $workerProcess `
                    -OwnedProcess $ownedWorkerProcess `
                    -ExpectedNode $canonicalNode `
                    -ExpectedWorkerScript $workerScript `
                    -ExpectedStartedAtUtc $workerStartedAtUtc
            }
            catch {
                throw "Mission worker launcher owned cleanup failed: $($_.Exception.Message)"
            }
        }
        throw $launchFailure
    }
}
else {
    $ordinaryLaunchId = New-CryptographicLaunchIdentityId
    $ordinaryWorker = $null
    try {
        $ordinaryWorker = Start-ExactWorkerWithLaunchIdentity `
            -LaunchIdentityId $ordinaryLaunchId `
            -LaunchKind 'ordinary' `
            -CaptureOutput
        $stdoutRead = $ordinaryWorker.Process.StandardOutput.ReadToEndAsync()
        $stderrRead = $ordinaryWorker.Process.StandardError.ReadToEndAsync()
        $ordinaryWorker.Process.WaitForExit()
        $stdoutText = $stdoutRead.GetAwaiter().GetResult()
        $stderrText = $stderrRead.GetAwaiter().GetResult()
        foreach ($line in @($stdoutText, $stderrText)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
                [string]$line | Out-File -LiteralPath $logPath -Append -Encoding utf8
            }
        }
        $exitCode = $ordinaryWorker.Process.ExitCode
    }
    catch {
        $ordinaryFailure = $_
        if ($ordinaryWorker -and $ordinaryWorker.Process) {
            try {
                Stop-ExactOwnedWorkerProcess `
                    -Process $ordinaryWorker.Process `
                    -OwnedProcess $ordinaryWorker.OwnedProcess `
                    -ExpectedNode $canonicalNode `
                    -ExpectedWorkerScript $workerScript `
                    -ExpectedStartedAtUtc $ordinaryWorker.StartedAtUtc
            }
            catch {
                throw "Mission worker ordinary-launch cleanup failed: $($_.Exception.Message)"
            }
        }
        throw $ordinaryFailure
    }
}
"[$([DateTime]::UtcNow.ToString('o'))] Mission Orchestrator worker exited with code $exitCode" | Out-File -LiteralPath $logPath -Append -Encoding utf8
exit $exitCode
