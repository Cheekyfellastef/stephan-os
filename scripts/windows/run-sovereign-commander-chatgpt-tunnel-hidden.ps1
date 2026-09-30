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
$tunnelIdPath = Join-Path $configDir 'tunnel-id.txt'
$keyPath = Join-Path $configDir 'runtime-api-key.dpapi'

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
                [string]$_.CommandLine -match [regex]::Escape($profileName)
            }
    )
}

foreach ($required in @($tunnelExe, $tunnelIdPath, $keyPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "CHATGPT_TUNNEL_DEPENDENCY_MISSING:$required"
    }
}

$tunnelId = [System.IO.File]::ReadAllText($tunnelIdPath, [System.Text.Encoding]::ASCII).Trim()
if ($tunnelId -notmatch '^tunnel_[0-9a-f]{32}$') { throw 'CHATGPT_TUNNEL_ID_INVALID' }

$before = Get-ManagedTunnelProcesses
$healthyBefore = Test-TunnelReady
$restartedStale = $false
if ($before.Count -gt 0 -and -not $healthyBefore) {
    foreach ($process in $before) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    $restartedStale = $true
}

$startedPid = 0
if (-not (Test-TunnelReady)) {
    $secureKey = ConvertTo-SecureString ([System.IO.File]::ReadAllText($keyPath, [System.Text.Encoding]::UTF8))
    $credential = New-Object System.Management.Automation.PSCredential('tunnel-client', $secureKey)
    $plainKey = $credential.GetNetworkCredential().Password
    $previousKey = $env:CONTROL_PLANE_API_KEY
    try {
        $env:CONTROL_PLANE_API_KEY = $plainKey
        $started = Start-Process -FilePath $tunnelExe -ArgumentList @(
            'run',
            '--profile', $profileName,
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
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Test-TunnelReady) {
        $healthyAfter = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

$after = Get-ManagedTunnelProcesses
$ok = ($after.Count -ge 1 -and $healthyAfter)

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-chatgpt-tunnel-watchdog.v1'
    tunnelId = $tunnelId
    profileName = $profileName
    beforeProcessCount = $before.Count
    afterProcessCount = $after.Count
    healthyBefore = [bool]$healthyBefore
    healthyAfter = [bool]$healthyAfter
    restartedStaleProcess = $restartedStale
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
