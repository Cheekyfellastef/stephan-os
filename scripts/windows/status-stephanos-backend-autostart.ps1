[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$taskName = 'Stephanos Battle Bridge Backend'
$localHealthUrl = 'http://127.0.0.1:8787/api/health'
$bridgeHealthUrl = 'https://desktop-9flonkj.taild6f215.ts.net/api/health'

function Test-Url {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
        return [PSCustomObject]@{
            Url = $Url
            Healthy = ($response.StatusCode -eq 200)
            StatusCode = $response.StatusCode
            Error = $null
        }
    }
    catch {
        return [PSCustomObject]@{
            Url = $Url
            Healthy = $false
            StatusCode = $null
            Error = $_.Exception.Message
        }
    }
}

Write-Host '=== Scheduled Task ==='
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    [PSCustomObject]@{
        TaskName = $task.TaskName
        State = $task.State
        LastRunTime = $taskInfo.LastRunTime
        LastTaskResult = $taskInfo.LastTaskResult
        NextRunTime = $taskInfo.NextRunTime
    } | Format-List
}
else {
    Write-Host "Task '$taskName' not found."
}

Write-Host ''
Write-Host '=== Local Backend Health ==='
$localResult = Test-Url -Url $localHealthUrl
if ($localResult.Healthy) {
    Write-Host "$($localResult.Url) -> healthy (HTTP $($localResult.StatusCode))"
}
else {
    Write-Host "$($localResult.Url) -> unhealthy ($($localResult.Error))"
}

Write-Host ''
Write-Host '=== Tailscale Serve Status ==='
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    tailscale serve status
}
else {
    Write-Host 'tailscale CLI not found in PATH.'
}

Write-Host ''
Write-Host '=== Hosted Bridge Health ==='
$bridgeResult = Test-Url -Url $bridgeHealthUrl
if ($bridgeResult.Healthy) {
    Write-Host "$($bridgeResult.Url) -> healthy (HTTP $($bridgeResult.StatusCode))"
}
else {
    Write-Host "$($bridgeResult.Url) -> unhealthy ($($bridgeResult.Error))"
}
