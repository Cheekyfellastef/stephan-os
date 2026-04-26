[CmdletBinding()]
param(
    [int]$HttpTimeoutSeconds = 8
)

$ErrorActionPreference = 'Stop'

$taskName = 'Stephanos Battle Bridge Backend'
$expectedServeHost = 'https://desktop-9flonkj.taild6f215.ts.net'
$expectedServeTarget = 'http://127.0.0.1:8787'
$expectedServeHealthUrl = "$expectedServeHost/api/health"
$localHealthUrl = 'http://127.0.0.1:8787/api/health'

function Test-Url {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSeconds = 8
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
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

function Format-Boolean {
    param([bool]$Value)
    if ($Value) { return 'yes' }
    return 'no'
}

function Find-TailscaleDnsWarnings {
    param([string]$StatusText)

    if ([string]::IsNullOrWhiteSpace($StatusText)) {
        return @()
    }

    $warningPatterns = @(
        'warning',
        'dns',
        'resolv',
        'magicdns',
        'health check'
    )

    $lines = $StatusText -split "`r?`n"
    $warnings = foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed) {
            continue
        }

        foreach ($pattern in $warningPatterns) {
            if ($trimmed.ToLowerInvariant().Contains($pattern)) {
                $trimmed
                break
            }
        }
    }

    return $warnings | Select-Object -Unique
}

function Test-ExpectedServeMapping {
    param(
        [string]$ServeStatusText,
        [string]$ExpectedHost,
        [string]$ExpectedTarget
    )

    if ([string]::IsNullOrWhiteSpace($ServeStatusText)) {
        return $false
    }

    $normalized = $ServeStatusText.ToLowerInvariant()
    $hostOk = $normalized.Contains($ExpectedHost.ToLowerInvariant())
    $targetOk = $normalized.Contains($ExpectedTarget.ToLowerInvariant())

    return ($hostOk -and $targetOk)
}

Write-Host '=== Stephanos Battle Bridge Status ==='

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskInfo = $null
if ($task) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
}

$localResult = Test-Url -Url $localHealthUrl -TimeoutSeconds $HttpTimeoutSeconds

$tailscaleCommand = Get-Command tailscale -ErrorAction SilentlyContinue
$tailscaleCliPresent = $null -ne $tailscaleCommand
$tailscaleStatusText = $null
$tailscaleServeStatusText = $null
$tailscaleStatusError = $null
$tailscaleServeStatusError = $null

if ($tailscaleCliPresent) {
    try {
        $tailscaleStatusText = tailscale status 2>&1 | Out-String
    }
    catch {
        $tailscaleStatusError = $_.Exception.Message
    }

    try {
        $tailscaleServeStatusText = tailscale serve status 2>&1 | Out-String
    }
    catch {
        $tailscaleServeStatusError = $_.Exception.Message
    }
}

$serveMappingPresent = Test-ExpectedServeMapping -ServeStatusText $tailscaleServeStatusText -ExpectedHost $expectedServeHost -ExpectedTarget $expectedServeTarget
$dnsWarnings = Find-TailscaleDnsWarnings -StatusText $tailscaleStatusText
$hostedResult = Test-Url -Url $expectedServeHealthUrl -TimeoutSeconds $HttpTimeoutSeconds

$usableBridge = $localResult.Healthy -and $hostedResult.Healthy

Write-Host ''
Write-Host '--- Scheduled Task ---'
[PSCustomObject]@{
    TaskName = $taskName
    Present = Format-Boolean -Value ($null -ne $task)
    State = if ($task) { [string]$task.State } else { 'missing' }
    LastTaskResult = if ($taskInfo) { [string]$taskInfo.LastTaskResult } else { 'n/a' }
    LastRunTime = if ($taskInfo) { [string]$taskInfo.LastRunTime } else { 'n/a' }
    NextRunTime = if ($taskInfo) { [string]$taskInfo.NextRunTime } else { 'n/a' }
} | Format-List

Write-Host '--- Local Backend ---'
[PSCustomObject]@{
    HealthUrl = $localHealthUrl
    Healthy = Format-Boolean -Value $localResult.Healthy
    StatusCode = if ($null -ne $localResult.StatusCode) { [string]$localResult.StatusCode } else { 'n/a' }
    Error = if ($localResult.Error) { $localResult.Error } else { 'none' }
} | Format-List

Write-Host '--- Tailscale CLI + Status ---'
[PSCustomObject]@{
    TailscaleCliPresent = Format-Boolean -Value $tailscaleCliPresent
    StatusCommandOk = if ($tailscaleCliPresent) { Format-Boolean -Value (-not $tailscaleStatusError) } else { 'no' }
    ServeStatusCommandOk = if ($tailscaleCliPresent) { Format-Boolean -Value (-not $tailscaleServeStatusError) } else { 'no' }
    DnsWarningsCount = [string]($dnsWarnings.Count)
    DnsWarningsAreFatal = if ($hostedResult.Healthy) { 'no' } else { 'yes (only because hosted health failed)' }
} | Format-List

if ($tailscaleStatusError) {
    Write-Host "tailscale status error: $tailscaleStatusError"
}

if ($tailscaleServeStatusError) {
    Write-Host "tailscale serve status error: $tailscaleServeStatusError"
}

if ($dnsWarnings.Count -gt 0) {
    Write-Host 'tailscale DNS/health warnings:'
    $dnsWarnings | ForEach-Object { Write-Host "  - $_" }
}

Write-Host '--- Tailscale Serve ---'
[PSCustomObject]@{
    ExpectedHost = $expectedServeHost
    ExpectedPath = '/'
    ExpectedProxyTarget = $expectedServeTarget
    ExpectedMappingPresent = Format-Boolean -Value $serveMappingPresent
} | Format-List

if ($tailscaleServeStatusText) {
    Write-Host 'tailscale serve status output:'
    Write-Host $tailscaleServeStatusText.Trim()
}

Write-Host '--- Hosted Bridge ---'
[PSCustomObject]@{
    HealthUrl = $expectedServeHealthUrl
    Healthy = Format-Boolean -Value $hostedResult.Healthy
    StatusCode = if ($null -ne $hostedResult.StatusCode) { [string]$hostedResult.StatusCode } else { 'n/a' }
    Error = if ($hostedResult.Error) { $hostedResult.Error } else { 'none' }
} | Format-List

Write-Host '--- Overall ---'
[PSCustomObject]@{
    BridgeUsable = Format-Boolean -Value $usableBridge
    Notes = if ($dnsWarnings.Count -gt 0 -and $hostedResult.Healthy) {
        'DNS/health warnings present in tailscale status, but hosted bridge is healthy.'
    }
    elseif ($dnsWarnings.Count -gt 0 -and -not $hostedResult.Healthy) {
        'DNS/health warnings present and hosted bridge health is failing.'
    }
    else {
        'No DNS/health warnings detected from tailscale status output.'
    }
} | Format-List
