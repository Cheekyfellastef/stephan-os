[CmdletBinding()]
param(
    [string]$StephanosRepositoryRoot = "$env:USERPROFILE\Documents\GitHub\stephan-os",
    [string]$MissionRunnerRoot = "$env:USERPROFILE\Documents\OpenClaw-Standalone\mission-runner",
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedMainHead,
    [string]$MissionId = '',
    [switch]$RequireCompletedMission,
    [int]$WorkerFreshnessSeconds = 180
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = [System.IO.Path]::GetFullPath($StephanosRepositoryRoot)
$runner = [System.IO.Path]::GetFullPath($MissionRunnerRoot)
$proofRoot = Join-Path $runner 'proof\mission-orchestrator-acceptance'
$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$receiptPath = Join-Path $proofRoot "acceptance-$timestamp.json"
$latestPath = Join-Path $proofRoot 'latest.json'
$checks = New-Object System.Collections.Generic.List[object]
[System.IO.Directory]::CreateDirectory($proofRoot) | Out-Null

function Add-Check([string]$Name, [bool]$Pass, [object]$Evidence) {
    $checks.Add([ordered]@{ name=$Name; pass=$Pass; evidence=$Evidence })
    if (-not $Pass) { throw "Acceptance check failed: $Name" }
}
function Invoke-Text([string]$Executable, [string[]]$Arguments) {
    $output = & $Executable @Arguments 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed: $output" }
    return $output.Trim()
}
function Get-TailscaleExecutable {
    $command = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @('C:\Program Files\Tailscale\tailscale.exe', 'C:\Program Files (x86)\Tailscale\tailscale.exe')) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return ''
}
function Write-Receipt([bool]$Success, [string]$ErrorMessage) {
    $document = [ordered]@{
        schemaVersion = 'stephanos.mission-orchestrator-windows-acceptance.v1'
        success = $Success
        expectedMainHead = $ExpectedMainHead
        missionId = $MissionId
        checkedAt = [DateTime]::UtcNow.ToString('o')
        checks = $checks
        error = $ErrorMessage
        finalVerdict = if ($Success) { 'MISSION_ORCHESTRATOR_WINDOWS_ACCEPTANCE_PASS' } else { 'MISSION_ORCHESTRATOR_WINDOWS_ACCEPTANCE_BLOCKED' }
    }
    $json = $document | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($receiptPath, $json, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::WriteAllText($latestPath, $json, [System.Text.UTF8Encoding]::new($false))
    return $document
}

try {
    Add-Check 'repository-exists' (Test-Path -LiteralPath (Join-Path $repo '.git')) $repo
    $branch = Invoke-Text 'git.exe' @('-C', $repo, 'branch', '--show-current')
    Add-Check 'main-branch' ($branch -eq 'main') $branch
    $head = Invoke-Text 'git.exe' @('-C', $repo, 'rev-parse', 'HEAD')
    Add-Check 'exact-main-head' ($head -eq $ExpectedMainHead) $head
    $status = Invoke-Text 'git.exe' @('-C', $repo, 'status', '--porcelain=v1', '--untracked-files=normal')
    $unsafeStatus = @($status -split "`r?`n" | Where-Object { $_ -and $_ -notmatch '^.. apps/stephanos/dist/' -and $_ -notmatch '^.. stephanos-server/data/memory/durable-memory.json$' -and $_ -notmatch '^.. (data|tmp)/' })
    Add-Check 'no-source-dirt' ($unsafeStatus.Count -eq 0) $unsafeStatus

    $taskName = 'Stephanos Mission Orchestrator Worker'
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Add-Check 'worker-task-installed' ($null -ne $task) $(if ($task) { $task.State.ToString() } else { 'missing' })
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    Add-Check 'worker-task-last-result' ($taskInfo.LastTaskResult -eq 0) $taskInfo.LastTaskResult
    $taskAction = @($task.Actions | Select-Object -First 1)
    Add-Check 'worker-task-action' ($taskAction.Execute -match 'powershell' -and $taskAction.Arguments -match 'start-mission-orchestrator-worker.ps1') "$($taskAction.Execute) $($taskAction.Arguments)"

    $workerLog = Join-Path $runner 'logs\mission-orchestrator-worker\worker.log'
    Add-Check 'worker-log-exists' (Test-Path -LiteralPath $workerLog -PathType Leaf) $workerLog
    $logInfo = Get-Item -LiteralPath $workerLog
    $logAge = ([DateTime]::UtcNow - $logInfo.LastWriteTimeUtc).TotalSeconds
    Add-Check 'worker-log-fresh' ($logAge -le $WorkerFreshnessSeconds) ([math]::Round($logAge, 1))

    $localHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 15
    Add-Check 'local-backend-health' ($localHealth.service -eq 'stephanos-server') $localHealth.service
    $feed = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/mission-operations' -TimeoutSec 15
    $feedJson = $feed | ConvertTo-Json -Depth 20
    Add-Check 'mission-feed-schema' ($feed.schemaVersion -eq 'stephanos.mission-operations-feed.v1') $feed.schemaVersion
    Add-Check 'public-feed-token-redaction' ($feedJson -notmatch 'APPROVE_OPENCLAW_SQUASH_MERGE:') 'raw approval token absent'

    $tailscale = Get-TailscaleExecutable
    Add-Check 'tailscale-cli' (-not [string]::IsNullOrWhiteSpace($tailscale)) $tailscale
    $tailscaleStatus = Invoke-Text $tailscale @('status')
    Add-Check 'tailscale-login' ($tailscaleStatus -notmatch 'Logged out|NeedsLogin') 'logged in'
    $serveStatus = Invoke-Text $tailscale @('serve', 'status')
    Add-Check 'tailscale-serve-target' ($serveStatus -match 'http://127\.0\.0\.1:8787') $serveStatus
    $hostMatch = [regex]::Match($serveStatus, 'https://[^\s]+\.ts\.net')
    Add-Check 'tailscale-serve-host' $hostMatch.Success $hostMatch.Value
    $hostedHealth = Invoke-RestMethod -Uri "$($hostMatch.Value)/api/health" -TimeoutSec 20
    Add-Check 'tailscale-hosted-health' ($hostedHealth.service -eq 'stephanos-server') $hostedHealth.service

    if ($MissionId) {
        $statePath = Join-Path $runner "orchestrator\$MissionId.state.json"
        Add-Check 'mission-state-exists' (Test-Path -LiteralPath $statePath -PathType Leaf) $statePath
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        Add-Check 'mission-identity' ($state.missionId -eq $MissionId) $state.missionId
        Add-Check 'single-active-writer' (-not $state.simultaneousWritersAllowed) $state.activeWriter
        Add-Check 'repair-bound' ($state.repair.maximumRounds -eq 3 -and $state.repair.currentRound -le 3) "$($state.repair.currentRound)/$($state.repair.maximumRounds)"
        Add-Check 'evidence-present' (@($state.evidenceReceipts).Count -gt 0) @($state.evidenceReceipts).Count
        if ($RequireCompletedMission) {
            Add-Check 'mission-complete' ($state.currentPhase -eq 'COMPLETE' -and $state.finalVerdict -eq 'MISSION_ORCHESTRATOR_COMPLETE') "$($state.currentPhase)/$($state.finalVerdict)"
            foreach ($step in @('sync', 'build', 'verify', 'restart')) { Add-Check "deployment-$step" ($state.deployment.$step.status -eq 'success') $state.deployment.$step.status }
        }
    }

    $receipt = Write-Receipt $true ''
    $receipt.finalVerdict
    "RECEIPT_PATH=$receiptPath"
    exit 0
} catch {
    $receipt = Write-Receipt $false $_.Exception.Message
    $receipt.finalVerdict
    "ERROR=$($_.Exception.Message)"
    "RECEIPT_PATH=$receiptPath"
    exit 1
}
