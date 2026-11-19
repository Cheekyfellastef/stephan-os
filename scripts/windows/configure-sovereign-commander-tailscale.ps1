[CmdletBinding()]
param(
    [switch]$ApproveTailnetExposure,
    [switch]$ObserveExistingOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-SovereignCommanderPrivateOriginObservationV1 {
    param([string]$DnsName, [object]$ServeConfig)
    # Tailscale's raw ServeConfig uses TCP, Web and AllowFunnel maps. This
    # observation conveys no bearer, Windows enrollment or execution authority.
    $label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
    if ($DnsName.Length -gt 253 -or $DnsName -cnotmatch "^(?:$label\.){2,}ts\.net$") {
        throw 'TAILSCALE_PRIVATE_DNS_NAME_REQUIRED'
    }
    $endpoint = "${DnsName}:18791"
    $tcp = $ServeConfig.PSObject.Properties['TCP']
    $web = $ServeConfig.PSObject.Properties['Web']
    if (-not $tcp -or -not $web) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $port = $tcp.Value.PSObject.Properties['18791']
    $site = $web.Value.PSObject.Properties[$endpoint]
    if (-not $port -or -not $site) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $https = $port.Value.PSObject.Properties['HTTPS']
    if (-not $https -or $https.Value -isnot [bool] -or $https.Value -cne $true -or @($port.Value.PSObject.Properties).Count -ne 1) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $handlers = $site.Value.PSObject.Properties['Handlers']
    if (-not $handlers -or @($handlers.Value.PSObject.Properties).Count -ne 1) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $rootHandler = $handlers.Value.PSObject.Properties['/']
    if (-not $rootHandler) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $proxy = $rootHandler.Value.PSObject.Properties['Proxy']
    if (-not $proxy -or [string]$proxy.Value -cne 'http://127.0.0.1:18791' -or @($rootHandler.Value.PSObject.Properties).Count -ne 1) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    $funnel = $ServeConfig.PSObject.Properties['AllowFunnel']
    if ($funnel) {
        $allowed = $funnel.Value.PSObject.Properties[$endpoint]
        if ($allowed -and ($allowed.Value -isnot [bool] -or $allowed.Value -cne $false)) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
    }
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-commander-tailnet-origin.v1'
        origin = "https://${endpoint}"
        localTarget = 'http://127.0.0.1:18791'
        tailnetOnly = $true
        observedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        source = 'TAILSCALE_SERVE_STATUS'
        executionAuthorityGranted = $false
        enrollmentQualified = $false
    }
}

function Write-SovereignCommanderPrivateOriginObservationV1 {
    param([Parameter(Mandatory = $true)][object]$Observation)
    if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
    $directory = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner'
    $path = Join-Path $directory 'sovereign-commander-tailnet-origin.v1.json'
    # Refuse redirection before and after creating the fixed configuration parent.
    $candidate = $directory
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            $item = Get-Item -Force -LiteralPath $candidate
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'TAILNET_ORIGIN_PARENT_REDIRECTED' }
        }
        $parent = Split-Path -Parent $candidate
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
    [void][IO.Directory]::CreateDirectory($directory)
    $current = Get-Item -Force -LiteralPath $directory
    while ($null -ne $current) {
        # Parent is a native DirectoryInfo, without Get-Item's provider properties.
        if ($current -isnot [IO.DirectoryInfo] -or ($current.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'TAILNET_ORIGIN_PARENT_REDIRECTED' }
        $current = $current.Parent
    }
    if (Test-Path -LiteralPath $path) {
        $leaf = Get-Item -Force -LiteralPath $path
        if ($leaf.PSIsContainer -or ($leaf.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'TAILNET_ORIGIN_FILE_REDIRECTED' }
    }
    $json = $Observation | ConvertTo-Json -Compress -Depth 4
    $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($json)
    if ($bytes.Length -gt 2048) { throw 'TAILNET_ORIGIN_OBSERVATION_OVERSIZE' }
    $temporary = Join-Path $directory ('sovereign-commander-tailnet-origin.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $stream = $null
    try {
        $stream = [IO.FileStream]::new($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose(); $stream = $null
        Move-Item -LiteralPath $temporary -Destination $path -Force
    } finally {
        if ($stream) { $stream.Dispose() }
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

if ($ObserveExistingOnly -and $ApproveTailnetExposure) { throw 'TAILNET_ROUTE_MODE_AMBIGUOUS' }
if (-not $ObserveExistingOnly -and -not $ApproveTailnetExposure) { throw 'APPROVE_TAILNET_EXPOSURE_REQUIRED' }
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$localPort = 18791
$servePort = 18791
$target = "http://127.0.0.1:$localPort"

$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
if (-not $tailscale) { $tailscale = Get-Command tailscale -ErrorAction SilentlyContinue }
if (-not $tailscale) { throw 'TAILSCALE_CLI_NOT_FOUND' }

try {
    $health = Invoke-RestMethod -Method Get -Uri "$target/health" -TimeoutSec 3
} catch {
    throw 'SOVEREIGN_COMMANDER_LOCAL_HEALTH_REQUIRED'
}
if ($health.ok -ne $true -or [string]$health.service -ne 'stephanos-sovereign-commander') {
    throw 'SOVEREIGN_COMMANDER_LOCAL_HEALTH_INVALID'
}
if ([string]$health.remoteIgnitionPath -ne '/ignite' -or $health.remoteIgnitionCsrfProtected -ne $true) {
    throw 'SOVEREIGN_COMMANDER_REMOTE_IGNITION_CAPABILITY_REQUIRED'
}
try {
    $ignitionPage = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$target/ignite" -TimeoutSec 3
} catch {
    throw 'SOVEREIGN_COMMANDER_REMOTE_IGNITION_PAGE_REQUIRED'
}
if ($ignitionPage.StatusCode -ne 200 -or [string]$ignitionPage.Content -notmatch 'Ignite Stephanos') {
    throw 'SOVEREIGN_COMMANDER_REMOTE_IGNITION_PAGE_INVALID'
}

$statusJson = & $tailscale.Source status --json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_STATUS_FAILED' }
try { $status = $statusJson | ConvertFrom-Json } catch { throw 'TAILSCALE_STATUS_INVALID_JSON' }
if ([string]$status.BackendState -ne 'Running') { throw 'TAILSCALE_NOT_RUNNING' }
$dnsName = [string]$status.Self.DNSName
$dnsName = $dnsName.Trim().TrimEnd('.')
if (-not $dnsName) { throw 'TAILSCALE_DNS_NAME_REQUIRED' }

if (-not $ObserveExistingOnly) {
    & $tailscale.Source serve --bg --https=$servePort $target
    if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_SERVE_CONFIGURATION_FAILED' }
}

$serveStatus = @(& $tailscale.Source serve status 2>&1) -join [Environment]::NewLine
$ok = $LASTEXITCODE -eq 0 -and $serveStatus -match [regex]::Escape($target)
if (-not $ok) { throw 'TAILSCALE_SERVE_PROOF_FAILED' }
$serveJson = @(& $tailscale.Source serve status --json 2>$null) -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0 -or $serveJson.Length -gt 65536) { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
try { $serveConfig = $serveJson | ConvertFrom-Json } catch { throw 'TAILSCALE_PRIVATE_SERVE_PROOF_FAILED' }
$originObservation = Get-SovereignCommanderPrivateOriginObservationV1 -DnsName $dnsName -ServeConfig $serveConfig
Write-SovereignCommanderPrivateOriginObservationV1 -Observation $originObservation
$remoteIgnitionUrl = "https://${dnsName}:$servePort/ignite"

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-tailnet-route.v1'
    configured = -not $ObserveExistingOnly
    observedExistingOnly = [bool]$ObserveExistingOnly
    privateOriginObservationWritten = $true
    localTarget = $target
    tailnetHttpsPort = $servePort
    tailscaleBackendState = [string]$status.BackendState
    remoteIgnitionPath = '/ignite'
    remoteIgnitionUrl = $remoteIgnitionUrl
    remoteIgnitionTailnetOnly = $true
    remoteIgnitionCsrfProtected = $true
    remoteIgnitionAction = 'ignite-stephanos'
    remoteIgnitionArbitraryCommandAllowed = $false
    remoteIgnitionPcRestartAllowed = $false
    serveStatus = $serveStatus
    publicFunnelEnabledByThisAction = $false
    bearerAuthenticationStillRequired = $true
    mcpBearerAuthenticationStillRequired = $true
    remoteIgnitionBearerRequired = $false
    backendLoopbackOnly = $true
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    finalVerdict = $(if ($ObserveExistingOnly) { 'SOVEREIGN_COMMANDER_TAILNET_ROUTE_OBSERVED' } else { 'SOVEREIGN_COMMANDER_TAILNET_ROUTE_CONFIGURED' })
} | ConvertTo-Json -Depth 5
