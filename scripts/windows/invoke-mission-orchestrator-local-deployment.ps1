[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StephanosRepositoryRoot,
    [Parameter(Mandatory = $true)][string]$MissionId,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedMergeCommit,
    [string]$MissionRunnerRoot = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$receiptRoot = Join-Path ([System.IO.Path]::GetFullPath($MissionRunnerRoot)) "proof\mission-deployments\$MissionId"
$backupRoot = Join-Path $receiptRoot 'runtime-backup'
$logPath = Join-Path $receiptRoot 'deployment.log'
$steps = [ordered]@{}
$runtimeRestored = $false
[System.IO.Directory]::CreateDirectory($backupRoot) | Out-Null

function Add-Log([string]$Message) {
    $line = "[$([DateTime]::UtcNow.ToString('o'))] $Message"
    [System.IO.File]::AppendAllText($logPath, "$line`r`n", [System.Text.UTF8Encoding]::new($false))
}
function Get-Hash([string]$Value) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $sha.Dispose() }
}
function Invoke-Captured([string]$Executable, [string[]]$Arguments) {
    $output = & $Executable @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    Add-Log "$Executable $($Arguments -join ' ')"
    Add-Log $output.Trim()
    if ($exitCode -ne 0) { throw "$Executable exited with code $exitCode" }
    return $output
}
function Complete-Step([string]$Name, [string]$Evidence) {
    $steps[$Name] = [ordered]@{
        success = $true
        commandOutputHash = Get-Hash $Evidence
        receiptPath = "proof/mission-deployments/$MissionId/deployment.log"
        completedAt = [DateTime]::UtcNow.ToString('o')
    }
}
function Test-RuntimePath([string]$Path) {
    $p = $Path.Replace('\', '/')
    return $p -eq 'stephanos-server/data/memory/durable-memory.json' -or $p -eq 'data' -or $p.StartsWith('data/') -or $p -eq 'tmp' -or $p.StartsWith('tmp/')
}
function Test-GeneratedPath([string]$Path) { return $Path.Replace('\', '/').StartsWith('apps/stephanos/dist/') }
function Copy-RelativePath([string]$RelativePath) {
    $source = Join-Path $repo $RelativePath
    if (-not (Test-Path -LiteralPath $source)) { return }
    $destination = Join-Path $backupRoot $RelativePath
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $destination)) | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}
function Restore-RuntimeBackup {
    if ($script:runtimeRestored -or -not (Test-Path -LiteralPath $backupRoot -PathType Container)) { return }
    Get-ChildItem -LiteralPath $backupRoot -Force | ForEach-Object {
        $destination = Join-Path $repo $_.Name
        if ($_.PSIsContainer) {
            [System.IO.Directory]::CreateDirectory($destination) | Out-Null
            Copy-Item -Path (Join-Path $_.FullName '*') -Destination $destination -Recurse -Force -ErrorAction SilentlyContinue
        } else { Copy-Item -LiteralPath $_.FullName -Destination $destination -Force }
    }
    $script:runtimeRestored = $true
    Add-Log 'Archived runtime state restored.'
}
function Get-TailscaleExecutable {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @('C:\Program Files\Tailscale\tailscale.exe', 'C:\Program Files (x86)\Tailscale\tailscale.exe')) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return ''
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { throw 'Stephanos primary repository checkout is missing.' }
    Set-Location -LiteralPath $repo
    $branch = (Invoke-Captured 'git.exe' @('-C', $repo, 'branch', '--show-current')).Trim()
    if ($branch -ne 'main') { throw "Local deployment requires main; found ${branch}." }
    $statusText = Invoke-Captured 'git.exe' @('-C', $repo, 'status', '--porcelain=v1', '--untracked-files=normal')
    $runtimePaths = New-Object System.Collections.Generic.List[string]
    $generatedPaths = New-Object System.Collections.Generic.List[string]
    $unsafePaths = New-Object System.Collections.Generic.List[string]
    foreach ($line in @($statusText -split "`r?`n" | Where-Object { $_ })) {
        if ($line.Length -lt 4 -or $line.Contains(' -> ')) { $unsafePaths.Add($line); continue }
        $path = $line.Substring(3).Trim('"')
        if (Test-RuntimePath $path) { $runtimePaths.Add($path) }
        elseif (Test-GeneratedPath $path) { $generatedPaths.Add($path) }
        else { $unsafePaths.Add($path) }
    }
    if ($unsafePaths.Count -gt 0) { throw "Deployment blocked by source or unknown dirt: $($unsafePaths -join ', ')" }
    foreach ($path in @($runtimePaths | Select-Object -Unique)) { Copy-RelativePath $path }
    if ($runtimePaths.Count -gt 0) {
        & git.exe -C $repo restore --worktree --staged -- stephanos-server/data/memory/durable-memory.json 2>$null
        & git.exe -C $repo clean -fd -- data tmp 2>$null | Out-Null
    }
    if ($generatedPaths.Count -gt 0) {
        & git.exe -C $repo restore --worktree --staged -- apps/stephanos/dist 2>$null
        & git.exe -C $repo clean -fd -- apps/stephanos/dist 2>$null | Out-Null
    }
    $postArchiveStatus = (Invoke-Captured 'git.exe' @('-C', $repo, 'status', '--porcelain=v1', '--untracked-files=normal')).Trim()
    if ($postArchiveStatus) { throw "Working tree remains dirty after bounded archive: $postArchiveStatus" }

    $syncEvidence = Invoke-Captured 'git.exe' @('-C', $repo, 'fetch', 'origin', 'main')
    & git.exe -C $repo merge-base --is-ancestor $ExpectedMergeCommit origin/main 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Expected merge commit is not contained in origin/main.' }
    $syncEvidence += Invoke-Captured 'git.exe' @('-C', $repo, 'pull', '--ff-only', 'origin', 'main')
    $actualHead = (Invoke-Captured 'git.exe' @('-C', $repo, 'rev-parse', 'HEAD')).Trim()
    Complete-Step 'sync' "$syncEvidence`nHEAD=$actualHead"
    Complete-Step 'build' (Invoke-Captured 'npm.cmd' @('run', 'stephanos:build'))
    Complete-Step 'verify' (Invoke-Captured 'npm.cmd' @('run', 'stephanos:verify'))

    $restartEvidence = ''
    try {
        $response = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:4173/__stephanos/restart' -UseBasicParsing -TimeoutSec 10
        $restartEvidence += "static-restart=$($response.StatusCode)`n"
    } catch {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        Start-Process -FilePath $node -ArgumentList @('scripts/serve-stephanos-dist.mjs') -WorkingDirectory $repo -WindowStyle Hidden
        Start-Sleep -Seconds 3
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/__stephanos/health' -UseBasicParsing -TimeoutSec 10
        $restartEvidence += "static-start=$($health.StatusCode)`n"
    }
    $task = Get-ScheduledTask -TaskName 'Stephanos Battle Bridge Backend' -ErrorAction SilentlyContinue
    if (-not $task) { throw 'Stephanos Battle Bridge Backend scheduled task is missing.' }
    Stop-ScheduledTask -TaskName 'Stephanos Battle Bridge Backend' -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName 'Stephanos Battle Bridge Backend'
    Start-Sleep -Seconds 3
    $backend = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/health' -UseBasicParsing -TimeoutSec 15
    $restartEvidence += "backend=$($backend.StatusCode)`n"

    $tailscale = Get-TailscaleExecutable
    if (-not $tailscale) { throw 'Tailscale CLI is not installed or discoverable.' }
    $tailscaleStatus = Invoke-Captured $tailscale @('status')
    if ($tailscaleStatus -match 'Logged out|NeedsLogin') { throw 'Tailscale requires interactive login.' }
    $serveStatus = Invoke-Captured $tailscale @('serve', 'status')
    if ($serveStatus -notmatch 'http://127\.0\.0\.1:8787') {
        $restartEvidence += Invoke-Captured $tailscale @('serve', '--bg', 'http://127.0.0.1:8787')
        $serveStatus = Invoke-Captured $tailscale @('serve', 'status')
    }
    if ($serveStatus -notmatch 'http://127\.0\.0\.1:8787') { throw 'Tailscale Serve mapping was not restored.' }
    Complete-Step 'restart' "$restartEvidence`n$tailscaleStatus`n$serveStatus"
    Restore-RuntimeBackup
    [ordered]@{ schemaVersion='stephanos.local-deployment-result.v1'; missionId=$MissionId; success=$true; mergeCommitSha=$ExpectedMergeCommit; deployedHeadSha=$actualHead; completedAt=[DateTime]::UtcNow.ToString('o'); steps=$steps; error='' } | ConvertTo-Json -Depth 8 -Compress
    exit 0
} catch {
    Add-Log "BLOCKED: $($_.Exception.Message)"
    Restore-RuntimeBackup
    [ordered]@{ schemaVersion='stephanos.local-deployment-result.v1'; missionId=$MissionId; success=$false; mergeCommitSha=$ExpectedMergeCommit; completedAt=[DateTime]::UtcNow.ToString('o'); steps=$steps; error=$_.Exception.Message } | ConvertTo-Json -Depth 8 -Compress
    exit 1
}
