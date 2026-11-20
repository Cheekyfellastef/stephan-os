[CmdletBinding()]
param(
    [switch]$ApproveNetworkInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ApproveNetworkInstall) { throw 'APPROVE_OPENAI_TUNNEL_CLIENT_NETWORK_INSTALL_REQUIRED' }
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }

$repo = 'openai/tunnel-client'
$api = "https://api.github.com/repos/$repo/releases/latest"
$installRoot = Join-Path $env:USERPROFILE 'Documents\OpenAI-Secure-MCP-Tunnel'
$binDir = Join-Path $installRoot 'bin'
$tunnelExe = Join-Path $binDir 'tunnel-client.exe'
$tempRoot = Join-Path $env:TEMP ("stephanos-tunnel-client-" + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $tempRoot 'tunnel-client.zip'
$sumsPath = Join-Path $tempRoot 'SHA256SUMS.txt'
$extractDir = Join-Path $tempRoot 'extract'
$backupExe = Join-Path $tempRoot 'previous-tunnel-client.exe'
$headers = @{ 'User-Agent' = 'Stephanos-Sovereign-Commander' }

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$previousExeExists = Test-Path -LiteralPath $tunnelExe -PathType Leaf
$previousExeHash = ''
$replacementCommitted = $false

try {
    $release = Invoke-RestMethod -Method Get -Uri $api -Headers $headers
    $asset = @($release.assets | Where-Object { $_.name -match '^tunnel-client-v[0-9.]+-windows-amd64\.zip$' }) | Select-Object -First 1
    $sumsAsset = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' }) | Select-Object -First 1
    if (-not $asset -or -not $sumsAsset) { throw 'OPENAI_TUNNEL_CLIENT_WINDOWS_ASSET_NOT_FOUND' }

    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -Headers $headers -OutFile $zipPath
    Invoke-WebRequest -UseBasicParsing -Uri $sumsAsset.browser_download_url -Headers $headers -OutFile $sumsPath

    $expectedHash = ''
    foreach ($line in [System.IO.File]::ReadAllLines($sumsPath)) {
        $parts = $line.Trim() -split '\s+', 2
        if ($parts.Count -ne 2) { continue }
        $name = $parts[1].Trim().TrimStart('*')
        if ($name -eq [string]$asset.name) {
            $expectedHash = $parts[0].ToLowerInvariant()
            break
        }
    }
    if (-not $expectedHash -or $expectedHash -notmatch '^[0-9a-f]{64}$') {
        throw 'OPENAI_TUNNEL_CLIENT_SHA256_NOT_FOUND'
    }

    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw 'OPENAI_TUNNEL_CLIENT_SHA256_MISMATCH' }

    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
    $extracted = Get-ChildItem -LiteralPath $extractDir -Filter 'tunnel-client.exe' -File -Recurse | Select-Object -First 1
    if (-not $extracted) { throw 'OPENAI_TUNNEL_CLIENT_EXE_NOT_FOUND_IN_ARCHIVE' }

    # Prove the downloaded candidate can execute before touching any installed client.
    $candidateVersion = @(& $extracted.FullName --version 2>&1) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_CANDIDATE_VERSION_PROBE_FAILED' }

    if ($previousExeExists) {
        $previousExeHash = (Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash.ToLowerInvariant()
        Copy-Item -LiteralPath $tunnelExe -Destination $backupExe -Force
        $backupHash = (Get-FileHash -LiteralPath $backupExe -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($backupHash -ne $previousExeHash) { throw 'OPENAI_TUNNEL_CLIENT_BACKUP_VERIFY_FAILED' }
    }

    try {
        Copy-Item -LiteralPath $extracted.FullName -Destination $tunnelExe -Force
        $version = @(& $tunnelExe --version 2>&1) -join [Environment]::NewLine
        if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_INSTALLED_VERSION_PROBE_FAILED' }
        $replacementCommitted = $true
    } catch {
        $installError = $_
        try {
            if ($previousExeExists) {
                Copy-Item -LiteralPath $backupExe -Destination $tunnelExe -Force
                $restoredHash = (Get-FileHash -LiteralPath $tunnelExe -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($restoredHash -ne $previousExeHash) {
                    throw 'OPENAI_TUNNEL_CLIENT_ROLLBACK_HASH_MISMATCH'
                }
            } else {
                Remove-Item -LiteralPath $tunnelExe -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $tunnelExe -PathType Leaf) {
                    throw 'OPENAI_TUNNEL_CLIENT_ROLLBACK_NEW_EXE_STILL_PRESENT'
                }
            }
        } catch {
            throw "OPENAI_TUNNEL_CLIENT_INSTALL_FAILED_AND_ROLLBACK_FAILED: $($installError.Exception.Message); rollback: $($_.Exception.Message)"
        }
        throw "OPENAI_TUNNEL_CLIENT_INSTALL_FAILED_ROLLED_BACK: $($installError.Exception.Message)"
    }

    if (-not $replacementCommitted) { throw 'OPENAI_TUNNEL_CLIENT_INSTALL_NOT_COMMITTED' }

    [pscustomobject]@{
        schemaVersion = 'stephanos.openai-secure-mcp-tunnel-install.v1'
        installed = $true
        upgradedExistingClient = [bool]$previousExeExists
        sourceRepository = $repo
        releaseTag = [string]$release.tag_name
        asset = [string]$asset.name
        sha256 = $actualHash
        executable = $tunnelExe
        candidateVersionOutput = $candidateVersion.Trim()
        versionOutput = $version.Trim()
        previousExecutablePreservedUntilCandidateProof = $true
        replacementCommitted = $replacementCommitted
        inboundFirewallPortRequired = $false
        publicMcpEndpointRequired = $false
        arbitraryPackageManagerUsed = $false
        finalVerdict = 'OPENAI_TUNNEL_CLIENT_INSTALLED_AND_VERIFIED'
    } | ConvertTo-Json -Depth 5
} finally {
    Remove-Item -LiteralPath $tempRoot -Force -Recurse -ErrorAction SilentlyContinue
}
