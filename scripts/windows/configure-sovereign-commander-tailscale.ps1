[CmdletBinding()]
param(
    [switch]$ApproveTailnetExposure
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ApproveTailnetExposure) { throw 'APPROVE_TAILNET_EXPOSURE_REQUIRED' }
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

$statusJson = & $tailscale.Source status --json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_STATUS_FAILED' }
try { $status = $statusJson | ConvertFrom-Json } catch { throw 'TAILSCALE_STATUS_INVALID_JSON' }
if ([string]$status.BackendState -ne 'Running') { throw 'TAILSCALE_NOT_RUNNING' }

& $tailscale.Source serve --bg --https=$servePort $target
if ($LASTEXITCODE -ne 0) { throw 'TAILSCALE_SERVE_CONFIGURATION_FAILED' }

$serveStatus = @(& $tailscale.Source serve status 2>&1) -join [Environment]::NewLine
$ok = $LASTEXITCODE -eq 0 -and $serveStatus -match [regex]::Escape($target)
if (-not $ok) { throw 'TAILSCALE_SERVE_PROOF_FAILED' }

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-tailnet-route.v1'
    configured = $true
    localTarget = $target
    tailnetHttpsPort = $servePort
    tailscaleBackendState = [string]$status.BackendState
    serveStatus = $serveStatus
    publicFunnelEnabledByThisAction = $false
    bearerAuthenticationStillRequired = $true
    backendLoopbackOnly = $true
    vendorMeterRequired = $false
    externalSaasRelayRequired = $false
    finalVerdict = 'SOVEREIGN_COMMANDER_TAILNET_ROUTE_CONFIGURED'
} | ConvertTo-Json -Depth 5
