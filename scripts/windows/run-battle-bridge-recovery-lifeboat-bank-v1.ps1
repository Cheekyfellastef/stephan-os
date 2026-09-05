[CmdletBinding()]
param(
    [switch]$SelfTestOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershellExe -PathType Leaf)) { throw 'Canonical Windows PowerShell host is missing.' }
$bankRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$bankId = Split-Path -Leaf $bankRoot
if ($bankId -notin @('A', 'B')) { throw 'Lifeboat bank runner must execute from fixed bank A or B.' }
$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $bankRoot '..\..'))
$actionPath = Join-Path $bankRoot 'actions\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$claimConsumerPath = Join-Path $bankRoot 'github\invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1'
$versionPath = Join-Path $bankRoot 'version.txt'
$manifestPath = Join-Path $bankRoot 'manifest.sha256'
$statusRoot = Join-Path $lifeboatRoot 'status'
$heartbeatPath = Join-Path $statusRoot "bank-$bankId-heartbeat.json"

foreach ($required in @($actionPath, $claimConsumerPath, $versionPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required lifeboat bank component is missing: $required" }
}
[System.IO.Directory]::CreateDirectory($statusRoot) | Out-Null

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256([string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

$version = (Get-Content -LiteralPath $versionPath -Raw).Trim()
if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Lifeboat bank version is invalid.' }
$expectedManifest = (Get-Content -LiteralPath $manifestPath -Raw).Trim().ToLowerInvariant()
if ($expectedManifest -notmatch '^[a-f0-9]{64}$') { throw 'Lifeboat bank manifest is invalid.' }
$runnerHash = Get-Sha256 $PSCommandPath
$actionHash = Get-Sha256 $actionPath
$claimConsumerHash = Get-Sha256 $claimConsumerPath
$manifestMaterial = "runner=$runnerHash`naction=$actionHash`nclaim=$claimConsumerHash`nversion=$version`n"
$observedManifest = Get-TextSha256 $manifestMaterial
if ($observedManifest -ne $expectedManifest) { throw 'Lifeboat bank payload hash does not match its immutable manifest.' }

$startedAt = [DateTime]::UtcNow
$probeOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action PROBE_BATTLE_BRIDGE 2>&1)
$probeExitCode = $LASTEXITCODE
$probeText = $probeOutput -join [Environment]::NewLine
$probe = $null
try { $probe = $probeText | ConvertFrom-Json } catch { }

$ok = $probeExitCode -eq 0 -and $null -ne $probe -and [bool]$probe.ok
$claimVerdict = if ($SelfTestOnly) { 'SELF_TEST_ONLY' } else { 'NOT_ATTEMPTED' }
$claimBlocker = ''
if (-not $SelfTestOnly -and $ok) {
    try {
        $claimOutput = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $claimConsumerPath 2>&1)
        $claimExitCode = $LASTEXITCODE
        $claimText = $claimOutput -join [Environment]::NewLine
        $claimStatus = $null
        try { $claimStatus = $claimText | ConvertFrom-Json } catch { }
        if ($claimExitCode -eq 0 -and $null -ne $claimStatus) {
            $claimVerdict = [string]$claimStatus.verdict
            $claimBlocker = [string]$claimStatus.blocker
        } else {
            $claimVerdict = 'GITHUB_CLAIM_CONSUMER_FAILED'
            $claimBlocker = 'GITHUB_CLAIM_CONSUMER_RESPONSE_INVALID'
        }
    } catch {
        $claimVerdict = 'GITHUB_CLAIM_CONSUMER_FAILED'
        $claimBlocker = 'GITHUB_CLAIM_CONSUMER_EXCEPTION'
    }
}

$heartbeat = [ordered]@{
    schemaVersion = 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1'
    bankId = $bankId
    version = $version
    manifestSha256 = $observedManifest
    payloadVerified = $true
    lifeboatRoot = $lifeboatRoot
    repoCheckoutRequired = $false
    openClawGatewayRequired = $false
    startedAtUtc = $startedAt.ToString('o')
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    probeVerdict = if ($null -ne $probe) { [string]$probe.finalVerdict } else { 'PROBE_RESPONSE_INVALID' }
    githubClaimVerdict = $claimVerdict
    githubClaimBlocker = $claimBlocker
    selfTestOnly = [bool]$SelfTestOnly
    healthy = [bool]$ok
    arbitraryShellAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    pcRestartAllowed = $false
}

$temp = "$heartbeatPath.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
$heartbeat | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
Move-Item -LiteralPath $temp -Destination $heartbeatPath -Force
$heartbeat | ConvertTo-Json -Depth 6
if (-not $ok) { exit 1 }
