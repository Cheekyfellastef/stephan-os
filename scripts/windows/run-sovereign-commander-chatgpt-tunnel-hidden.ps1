[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$profileName = 'stephanos-sovereign-commander'
$healthPort = 18792
$tunnelRoot = Join-Path $env:USERPROFILE 'Documents\OpenAI-Secure-MCP-Tunnel'
$tunnelExe = Join-Path $tunnelRoot 'bin\tunnel-client.exe'
$configDir = Join-Path $tunnelRoot 'stephanos'
$profileDir = Join-Path $configDir 'profiles'
$profilePath = Join-Path $profileDir "$profileName.yaml"
$tunnelIdPath = Join-Path $configDir 'tunnel-id.txt'
$keyPath = Join-Path $configDir 'runtime-api-key.dpapi'
$restartMarkerPath = Join-Path $configDir 'restart-required.marker'

function Test-TunnelReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$healthPort/readyz" -TimeoutSec 3
        return ($response.StatusCode -eq 200 -and [string]$response.Content -match '^\s*ready\s*$')
    } catch {
        return $false
    }
}

function Get-ManagedTunnelProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'tunnel-client.exe' -and
                [string]$_.ExecutablePath -eq $tunnelExe -and
                [string]$_.CommandLine -match 'run' -and
                [string]$_.CommandLine -match [regex]::Escape($profileName) -and
                [string]$_.CommandLine -match [regex]::Escape($profileDir)
            }
    )
}

function Wait-ProcessIdsGone {
    param(
        [int[]]$ProcessIds,
        [int]$Attempts = 20,
        [int]$DelayMilliseconds = 250
    )

    if (-not $ProcessIds -or $ProcessIds.Count -eq 0) { return $true }

    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        $remaining = @(
            foreach ($processId in $ProcessIds) {
                if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { $processId }
            }
        )
        if ($remaining.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds $DelayMilliseconds
    }
    return $false
}

foreach ($required in @($tunnelExe, $profilePath, $tunnelIdPath, $keyPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "CHATGPT_TUNNEL_DEPENDENCY_MISSING:$required"
    }
}

$tunnelId = [System.IO.File]::ReadAllText($tunnelIdPath, [System.Text.Encoding]::ASCII).Trim()
if ($tunnelId -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'CHATGPT_TUNNEL_ID_INVALID' }

$before = Get-ManagedTunnelProcesses
$beforePids = @($before | ForEach-Object { [int]$_.ProcessId })
$healthyBefore = Test-TunnelReady
$configRestartRequested = Test-Path -LiteralPath $restartMarkerPath -PathType Leaf
$restartedForConfigChange = $false
$restartedStale = $false
$oldProcessesProvenGone = $before.Count -eq 0

if ($configRestartRequested -and $before.Count -gt 0) {
    foreach ($process in $before) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    $oldProcessesProvenGone = Wait-ProcessIdsGone -ProcessIds $beforePids
    if (-not $oldProcessesProvenGone) {
        throw 'CHATGPT_TUNNEL_OLD_PROCESS_DID_NOT_EXIT'
    }
    $restartedForConfigChange = $true
} elseif ($before.Count -gt 0 -and -not $healthyBefore) {
    foreach ($process in $before) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    $oldProcessesProvenGone = Wait-ProcessIdsGone -ProcessIds $beforePids
    if (-not $oldProcessesProvenGone) {
        throw 'CHATGPT_TUNNEL_STALE_PROCESS_DID_NOT_EXIT'
    }
    $restartedStale = $true
}

$managedStartRequired = $configRestartRequested -or $restartedStale -or $before.Count -eq 0 -or -not $healthyBefore
$startedPid = 0
if ($managedStartRequired) {
    $secureKey = ConvertTo-SecureString ([System.IO.File]::ReadAllText($keyPath, [System.Text.Encoding]::UTF8))
    $credential = New-Object System.Management.Automation.PSCredential('tunnel-client', $secureKey)
    $plainKey = $credential.GetNetworkCredential().Password
    $previousKey = $env:CONTROL_PLANE_API_KEY
    try {
        $env:CONTROL_PLANE_API_KEY = $plainKey
        $started = Start-Process -FilePath $tunnelExe -ArgumentList @(
            'run',
            '--profile', $profileName,
            '--profile-dir', $profileDir,
            '--health.listen-addr', "127.0.0.1:$healthPort",
            '--log.level=info',
            '--log.format=struct-text'
        ) -WorkingDirectory $tunnelRoot -WindowStyle Hidden -PassThru
        $startedPid = [int]$started.Id
    } finally {
        if ($null -eq $previousKey) {
            Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
        } else {
            $env:CONTROL_PLANE_API_KEY = $previousKey
        }
        $plainKey = $null
    }
}

$healthyAfter = $false
$replacementObserved = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $managedNow = Get-ManagedTunnelProcesses
    if ($managedStartRequired) {
        $matchingReplacement = @($managedNow | Where-Object { [int]$_.ProcessId -eq $startedPid })
        if ($matchingReplacement.Count -eq 1 -and $managedNow.Count -eq 1 -and (Test-TunnelReady)) {
            $healthyAfter = $true
            $replacementObserved = $true
            break
        }
    } elseif ($managedNow.Count -eq 1 -and (Test-TunnelReady)) {
        $healthyAfter = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

$after = Get-ManagedTunnelProcesses
$afterPids = @($after | ForEach-Object { [int]$_.ProcessId })
$ok = if ($managedStartRequired) {
    $startedPid -gt 0
        -and $oldProcessesProvenGone
        -and $replacementObserved
        -and $after.Count -eq 1
        -and $afterPids[0] -eq $startedPid
        -and $healthyAfter
} else {
    $after.Count -eq 1 -and $healthyAfter
}

$markerClearFailed = $false
if ($ok -and $configRestartRequested) {
    try {
        Remove-Item -LiteralPath $restartMarkerPath -Force -ErrorAction Stop
    } catch {
        $markerClearFailed = $true
    }
}
$restartMarkerRemaining = Test-Path -LiteralPath $restartMarkerPath -PathType Leaf
if ($configRestartRequested -and ($markerClearFailed -or $restartMarkerRemaining)) {
    $ok = $false
}

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-chatgpt-tunnel-watchdog.v1'
    tunnelId = $tunnelId
    profileName = $profileName
    profileDir = $profileDir
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    beforePids = $beforePids
    afterPids = $afterPids
    healthyBefore = [bool]$healthyBefore
    healthyAfter = [bool]$healthyAfter
    configRestartRequested = [bool]$configRestartRequested
    restartedForConfigChange = [bool]$restartedForConfigChange
    restartedStaleProcess = [bool]$restartedStale
    oldProcessesProvenGone = [bool]$oldProcessesProvenGone
    managedStartRequired = [bool]$managedStartRequired
    replacementObserved = [bool]$replacementObserved
    restartMarkerRemaining = [bool]$restartMarkerRemaining
    markerClearFailed = [bool]$markerClearFailed
    startedPid = $startedPid
    healthUrl = "http://127.0.0.1:$healthPort/readyz"
    runtimeApiKeyStoredPlaintext = $false
    inboundFirewallPortRequired = $false
    publicMcpEndpointRequired = $false
    arbitraryShellAllowed = $false
    mergeAuthority = $false
    pcRestartAuthority = $false
    finalVerdict = if ($ok) { 'CHATGPT_SECURE_MCP_TUNNEL_HEALTHY' } else { 'CHATGPT_SECURE_MCP_TUNNEL_BLOCKED' }
} | ConvertTo-Json -Depth 5

if (-not $ok) { exit 2 }
