[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Standalone', 'Local')]
    [string]$Target
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$agentId = if ($Target -eq 'Standalone') { 'openclaw-standalone' } else { 'stephanos-scout-coder' }
$workspace = Join-Path $env:USERPROFILE ('.openclaw\workspace-' + $agentId)
$agentDir = Join-Path $env:USERPROFILE ('.openclaw\agents\' + $agentId)

$script:openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $script:openclaw) {
    $script:openclaw = Get-Command openclaw -ErrorAction Stop
}

function Invoke-OpenClawFixed {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $captured = (& $script:openclaw.Source @Arguments 2>&1 | Out-String)
    return [pscustomobject]@{
        ExitCode = [int]$LASTEXITCODE
        Output = [string]$captured
    }
}

function Convert-OpenClawJson {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    try { return ($Raw | ConvertFrom-Json) } catch { return $null }
}

function Get-AgentIds {
    param($Payload)
    $rows = @()
    if ($Payload -is [System.Array]) {
        $rows = @($Payload)
    }
    elseif ($null -ne $Payload -and $null -ne $Payload.agents) {
        $rows = @($Payload.agents)
    }
    elseif ($null -ne $Payload) {
        $rows = @($Payload)
    }

    return @($rows | ForEach-Object {
        $candidate = ''
        if ($null -ne $_.id) { $candidate = [string]$_.id }
        elseif ($null -ne $_.agentId) { $candidate = [string]$_.agentId }
        elseif ($null -ne $_.name) { $candidate = [string]$_.name }
        $candidate.Trim().ToLowerInvariant()
    } | Where-Object { $_ })
}

$doctorFixApplied = $false
$agentRecreated = $false
$gatewayRecovered = $false

$doctorLint = Invoke-OpenClawFixed @('doctor', '--lint', '--json')
if ($doctorLint.ExitCode -ne 0) {
    $doctorFix = Invoke-OpenClawFixed @('doctor', '--fix', '--non-interactive')
    if ($doctorFix.ExitCode -ne 0) { throw 'OPENCLAW_DOCTOR_FIX_FAILED' }
    $doctorFixApplied = $true
}

$agentList = Invoke-OpenClawFixed @('agents', 'list', '--json')
if ($agentList.ExitCode -ne 0) { throw 'OPENCLAW_AGENT_LIST_FAILED' }
$agentIds = Get-AgentIds (Convert-OpenClawJson $agentList.Output)

if ($agentIds -notcontains $agentId.ToLowerInvariant()) {
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    $create = Invoke-OpenClawFixed @(
        'agents', 'add', $agentId,
        '--workspace', $workspace,
        '--agent-dir', $agentDir,
        '--non-interactive',
        '--json'
    )
    if ($create.ExitCode -ne 0) { throw 'OPENCLAW_AGENT_RECREATE_FAILED' }
    $agentRecreated = $true

    $agentList = Invoke-OpenClawFixed @('agents', 'list', '--json')
    if ($agentList.ExitCode -ne 0) { throw 'OPENCLAW_AGENT_RELIST_FAILED' }
    $agentIds = Get-AgentIds (Convert-OpenClawJson $agentList.Output)
    if ($agentIds -notcontains $agentId.ToLowerInvariant()) { throw 'OPENCLAW_AGENT_NOT_PRESENT_AFTER_REPAIR' }
}

$gateway = Invoke-OpenClawFixed @('gateway', 'status', '--deep', '--json')
if ($gateway.ExitCode -ne 0) {
    $restart = Invoke-OpenClawFixed @('gateway', 'restart', '--wait', '20s', '--json')
    if ($restart.ExitCode -ne 0) {
        $start = Invoke-OpenClawFixed @('gateway', 'start', '--json')
        if ($start.ExitCode -ne 0) { throw 'OPENCLAW_GATEWAY_RECOVERY_FAILED' }
    }
    $gatewayRecovered = $true
    $gateway = Invoke-OpenClawFixed @('gateway', 'status', '--deep', '--json')
    if ($gateway.ExitCode -ne 0) { throw 'OPENCLAW_GATEWAY_NOT_HEALTHY_AFTER_REPAIR' }
}

$model = Invoke-OpenClawFixed @('models', 'status', '--agent', $agentId)
if ($model.ExitCode -ne 0) { throw 'OPENCLAW_AGENT_MODEL_ROUTE_UNHEALTHY' }

[ordered]@{
    ok = $true
    schemaVersion = 'stephanos.sovereign-openclaw-agent-repair.v1'
    target = $Target
    agentId = $agentId
    doctorFixApplied = $doctorFixApplied
    agentRecreated = $agentRecreated
    gatewayRecovered = $gatewayRecovered
    gatewayHealthy = $true
    agentPresent = $true
    modelRouteHealthy = $true
    arbitraryShellAccepted = $false
    callerSelectedPathAccepted = $false
    finalVerdict = if ($Target -eq 'Standalone') {
        'SOVEREIGN_OPENCLAW_STANDALONE_REPAIR_GREEN'
    } else {
        'SOVEREIGN_OPENCLAW_LOCAL_REPAIR_GREEN'
    }
} | ConvertTo-Json -Compress
