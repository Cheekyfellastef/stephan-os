[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [int]$StartupTimeoutSeconds = 90,
    [int]$PollIntervalSeconds = 3,
    [string]$ExpectedHead = ''
)

$ErrorActionPreference = 'Stop'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNpm = 'C:\Program Files\nodejs\npm.cmd'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalBootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)"
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
    $expectedCommands = @(
        "`"$canonicalNode`" --input-type=module --eval `"$canonicalBootstrapEval`"",
        "$canonicalNode --input-type=module --eval `"$canonicalBootstrapEval`""
    )
    foreach ($expectedCommand in $expectedCommands) {
        if ([string]::Equals($commandLine, $expectedCommand, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
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
$canonicalGitDirectory = Join-Path $repoRoot '.git'
if (-not (Test-Path -LiteralPath $canonicalGitDirectory -PathType Container)) {
    throw 'Backend startup requires the canonical repository Git directory.'
}
$canonicalGitArguments = @("--git-dir=$canonicalGitDirectory", "--work-tree=$repoRoot")
foreach ($entry in @(Get-ChildItem Env:)) {
    if ([string]$entry.Name -like 'GIT_*') {
        Remove-Item -LiteralPath ("Env:{0}" -f [string]$entry.Name) -Force -ErrorAction SilentlyContinue
    }
}
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_CONFIG_GLOBAL = 'NUL'
$env:GIT_ATTR_NOSYSTEM = '1'
$env:GIT_NO_REPLACE_OBJECTS = '1'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'

function Assert-ExpectedHeadImmediatelyBeforeMutation {
    param([Parameter(Mandatory = $true)][string]$Mutation)
    $headOutput = @(& $canonicalGit @canonicalGitArguments rev-parse HEAD 2>$null)
    $headExitCode = $LASTEXITCODE
    if ($headExitCode -ne 0) { throw "Canonical Git head proof failed before ${Mutation}." }
    $observedHead = [string]($headOutput | Select-Object -First 1)
    $observedHead = $observedHead.Trim().ToLowerInvariant()
    if ($observedHead -ne $boundExpectedHead) {
        throw "BACKEND_START_EXPECTED_HEAD_MISMATCH before ${Mutation}: expected=$boundExpectedHead observed=$observedHead"
    }
    return $observedHead
}

function Read-BackendExpectedHeadHandoff {
    if (-not $env:USERPROFILE) { return $null }
    $handoffPath = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace\control\backend-expected-head-handoff.json'
    if (-not (Test-Path -LiteralPath $handoffPath -PathType Leaf)) { return $null }
    $consumedPath = "${handoffPath}.consumed-$PID"
    try {
        Move-Item -LiteralPath $handoffPath -Destination $consumedPath -ErrorAction Stop
    }
    catch { throw 'BACKEND_EXPECTED_HEAD_HANDOFF_CONSUME_FAILED' }
    try {
        $handoff = Get-Content -LiteralPath $consumedPath -Raw | ConvertFrom-Json
        if ([string]$handoff.schemaVersion -ne 'stephanos.backend-expected-head-handoff.v1') { throw 'BACKEND_EXPECTED_HEAD_HANDOFF_SCHEMA_INVALID' }
        if ([string]$handoff.target -ne 'backend') { throw 'BACKEND_EXPECTED_HEAD_HANDOFF_TARGET_INVALID' }
        $handoffHead = ([string]$handoff.expectedHead).Trim().ToLowerInvariant()
        if ($handoffHead -notmatch '^[0-9a-f]{40}$') { throw 'BACKEND_EXPECTED_HEAD_HANDOFF_HEAD_INVALID' }
        $issuedAtUtc = [datetime]::Parse([string]$handoff.issuedAtUtc).ToUniversalTime()
        $expiresAtUtc = [datetime]::Parse([string]$handoff.expiresAtUtc).ToUniversalTime()
        $nowUtc = [datetime]::UtcNow
        if ($expiresAtUtc -le $nowUtc) { throw 'BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED' }
        if ($expiresAtUtc -le $issuedAtUtc -or $issuedAtUtc -gt $nowUtc.AddSeconds(30) -or $expiresAtUtc -gt $issuedAtUtc.AddMinutes(2).AddSeconds(5)) {
            throw 'BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID'
        }
        return $handoffHead
    }
    finally {
        Remove-Item -LiteralPath $consumedPath -Force -ErrorAction SilentlyContinue
    }
}

foreach ($requiredExecutable in @($canonicalGit, $canonicalNpm, $canonicalNode)) {
    if (-not (Test-Path -LiteralPath $requiredExecutable -PathType Leaf)) {
        throw "Required canonical executable is missing: $requiredExecutable"
    }
}

$branchOutput = @(& $canonicalGit @canonicalGitArguments branch --show-current 2>$null)
$branchExitCode = $LASTEXITCODE
if ($branchExitCode -ne 0) { throw 'Backend startup could not inspect the canonical Git branch.' }
$branchRaw = $branchOutput | Select-Object -First 1
$headOutput = @(& $canonicalGit @canonicalGitArguments rev-parse HEAD 2>$null)
$headExitCode = $LASTEXITCODE
if ($headExitCode -ne 0) { throw 'Backend startup could not inspect the canonical Git head.' }
$headRaw = $headOutput | Select-Object -First 1
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
$headSha = if ($headRaw) { ([string]$headRaw).Trim().ToLowerInvariant() } else { '' }
if ($branch -ne 'main') { throw 'Backend startup requires canonical branch main.' }
if ($headSha -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup could not prove a canonical 40-character Git head.' }
$providedExpectedHead = ([string]$ExpectedHead).Trim().ToLowerInvariant()
if ($providedExpectedHead -and $providedExpectedHead -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup received an invalid expected-head binding.' }
if (-not $providedExpectedHead) {
    $providedExpectedHead = [string](Read-BackendExpectedHeadHandoff)
}
$upstreamOutput = @(& $canonicalGit @canonicalGitArguments rev-parse '--abbrev-ref' '--symbolic-full-name' '@{u}' 2>$null)
$upstreamExitCode = $LASTEXITCODE
if ($upstreamExitCode -ne 0) { throw 'Backend startup could not prove the canonical upstream.' }
$upstream = [string]($upstreamOutput | Select-Object -First 1)
$upstream = $upstream.Trim()
if ($upstream -ne 'origin/main') { throw "Backend startup requires canonical upstream origin/main; observed=$upstream" }
$originHeadOutput = @(& $canonicalGit @canonicalGitArguments rev-parse origin/main 2>$null)
$originHeadExitCode = $LASTEXITCODE
if ($originHeadExitCode -ne 0) { throw 'Backend startup could not prove origin/main.' }
$originHead = [string]($originHeadOutput | Select-Object -First 1)
$originHead = $originHead.Trim().ToLowerInvariant()
if ($originHead -ne $headSha) { throw "Backend startup requires synchronized main: head=$headSha origin/main=$originHead" }
$boundExpectedHead = if ($providedExpectedHead) { $providedExpectedHead } else { $headSha }
if ($headSha -ne $boundExpectedHead) { throw "Backend startup expected-head binding mismatch: expected=$boundExpectedHead observed=$headSha" }
$trackedStatus = @(& $canonicalGit @canonicalGitArguments status '--porcelain=v1' '--untracked-files=no' 2>$null)
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

function Get-ExactHeadBackendBootstrapBase64 {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$HeadSha
    )
    if ($RepositoryRoot.Contains('"')) {
        throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_PATH_INVALID'
    }
    if (-not [string]::Equals([System.IO.Path]::GetFullPath($RepositoryRoot), $repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_REPOSITORY_MISMATCH'
    }
    $bootstrapGitPath = 'stephanos-server/backend-bootstrap.mjs'
    $expectedBlobOutput = @(& $canonicalGit @canonicalGitArguments rev-parse "${HeadSha}:$bootstrapGitPath" 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_BLOB_PROOF_FAILED' }
    $expectedBlob = ([string]($expectedBlobOutput | Select-Object -First 1)).Trim().ToLowerInvariant()
    if ($expectedBlob -notmatch '^[0-9a-f]{40}$') { throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_BLOB_PROOF_INVALID' }

    $temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) "stephanos-backend-bootstrap-$PID-$([guid]::NewGuid().ToString('N')).tmp"
    $temporaryErrorPath = "${temporaryPath}.stderr"
    try {
        Remove-Item -LiteralPath $temporaryPath, $temporaryErrorPath -Force -ErrorAction SilentlyContinue
        $gitArguments = @("--git-dir=`"$canonicalGitDirectory`"", "--work-tree=`"$repoRoot`"", 'show', "${HeadSha}:$bootstrapGitPath")
        $materialization = Start-Process -FilePath $canonicalGit `
            -ArgumentList $gitArguments `
            -WorkingDirectory $RepositoryRoot `
            -RedirectStandardOutput $temporaryPath `
            -RedirectStandardError $temporaryErrorPath `
            -WindowStyle Hidden `
            -Wait `
            -PassThru
        if ($materialization.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
            throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_MATERIALIZATION_FAILED'
        }
        $bootstrapBytes = [System.IO.File]::ReadAllBytes($temporaryPath)
        if ($bootstrapBytes.Length -le 0 -or $bootstrapBytes.Length -gt 524288) {
            throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_SIZE_INVALID'
        }
        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes("blob $($bootstrapBytes.Length)`0")
        $blobBytes = New-Object byte[] ($headerBytes.Length + $bootstrapBytes.Length)
        [System.Buffer]::BlockCopy($headerBytes, 0, $blobBytes, 0, $headerBytes.Length)
        [System.Buffer]::BlockCopy($bootstrapBytes, 0, $blobBytes, $headerBytes.Length, $bootstrapBytes.Length)
        $sha1 = [System.Security.Cryptography.SHA1]::Create()
        try {
            $observedBlob = -join ($sha1.ComputeHash($blobBytes) | ForEach-Object { $_.ToString('x2') })
        }
        finally {
            $sha1.Dispose()
        }
        if ($observedBlob -ne $expectedBlob) { throw 'BACKEND_EXACT_HEAD_BOOTSTRAP_HASH_MISMATCH' }
        return [Convert]::ToBase64String($bootstrapBytes)
    }
    finally {
        Remove-Item -LiteralPath $temporaryPath, $temporaryErrorPath -Force -ErrorAction SilentlyContinue
    }
}

function Start-BackendNodeWithMinimalEnvironment {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$StandardOutputPath,
        [Parameter(Mandatory = $true)][string]$StandardErrorPath,
        [Parameter(Mandatory = $true)][string]$SourceHead,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$BootstrapBase64
    )
    $originalEnvironment = @{}
    foreach ($entry in @(Get-ChildItem Env:)) {
        $originalEnvironment[[string]$entry.Name] = [string]$entry.Value
    }

    $minimalEnvironment = @{}
    $allowedWindowsEnvironmentNames = @(
        'SystemRoot', 'WINDIR', 'TEMP', 'TMP',
        'SystemDrive', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
        'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
        'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'CommonProgramFiles(x86)'
    )
    foreach ($name in $allowedWindowsEnvironmentNames) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $minimalEnvironment[$name] = $value
        }
    }
    $minimalEnvironment['PATH'] = 'C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI'
    $minimalEnvironment['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
    $minimalEnvironment['GIT_NO_REPLACE_OBJECTS'] = '1'
    $minimalEnvironment['STEPHANOS_BACKEND_SOURCE_HEAD'] = $SourceHead
    $minimalEnvironment['STEPHANOS_BACKEND_REPO_ROOT'] = $RepositoryRoot
    $minimalEnvironment['STEPHANOS_BACKEND_BOOTSTRAP_BASE64'] = $BootstrapBase64

    try {
        foreach ($entry in @(Get-ChildItem Env:)) {
            [Environment]::SetEnvironmentVariable([string]$entry.Name, $null, 'Process')
        }
        foreach ($name in $minimalEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable([string]$name, [string]$minimalEnvironment[$name], 'Process')
        }
        return Start-Process -FilePath $canonicalNode `
            -ArgumentList $Arguments `
            -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $StandardOutputPath `
            -RedirectStandardError $StandardErrorPath `
            -WindowStyle Hidden `
            -PassThru
    }
    finally {
        foreach ($entry in @(Get-ChildItem Env:)) {
            [Environment]::SetEnvironmentVariable([string]$entry.Name, $null, 'Process')
        }
        foreach ($name in $originalEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable([string]$name, [string]$originalEnvironment[$name], 'Process')
        }
    }
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

$arguments = @('--input-type=module', '--eval', "`"$canonicalBootstrapEval`"")
Write-Log ("Starting backend with fixed Node and process-bound exact-head bootstrap: {0} {1}" -f $canonicalNode, ($arguments -join ' '))
if ($PSCmdlet.ShouldProcess("$canonicalNode $($arguments -join ' ')", 'Start Stephanos backend')) {
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'exact-head bootstrap capture' | Out-Null
    $bootstrapBase64 = Get-ExactHeadBackendBootstrapBase64 -RepositoryRoot $repoRoot -HeadSha $headSha
    Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start' | Out-Null
    $process = Start-BackendNodeWithMinimalEnvironment `
        -Arguments $arguments `
        -WorkingDirectory $repoRoot `
        -StandardOutputPath $stdoutLogPath `
        -StandardErrorPath $stderrLogPath `
        -SourceHead $headSha `
        -RepositoryRoot $repoRoot `
        -BootstrapBase64 $bootstrapBase64
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
