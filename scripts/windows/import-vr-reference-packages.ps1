[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$DownloadsPath = (Join-Path $env:USERPROFILE 'Downloads'),
    [string]$RepositoryPath = (Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'),
    [switch]$IncludeUnknownVrArchives
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SafeSlug {
    param([Parameter(Mandatory)][string]$Value)
    $slug = $Value.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    return $slug.Trim('-')
}

function Resolve-PackageRoute {
    param([Parameter(Mandatory)][System.IO.FileInfo]$File)

    $name = $File.Name.ToLowerInvariant()
    if ($name -match 'mutar|nomoreflat' -and $name -match 'starfield') {
        return [pscustomobject]@{ Creator = 'mutar'; Game = 'starfield'; Confidence = 'high' }
    }
    if ($name -match 'luke.?ross|real.?vr' -and $name -match 'red.?dead|rdr2') {
        return [pscustomobject]@{ Creator = 'luke-ross'; Game = 'red-dead-redemption-2'; Confidence = 'high' }
    }
    if ($name -match 'starfield' -and $name -match 'vr') {
        return [pscustomobject]@{ Creator = 'unknown'; Game = 'starfield'; Confidence = 'medium' }
    }
    if ($name -match 'red.?dead|rdr2' -and $name -match 'vr') {
        return [pscustomobject]@{ Creator = 'unknown'; Game = 'red-dead-redemption-2'; Confidence = 'medium' }
    }
    if ($IncludeUnknownVrArchives -and $name -match 'vr|openxr|openvr|stereo') {
        return [pscustomobject]@{ Creator = 'unknown'; Game = 'unclassified'; Confidence = 'low' }
    }
    return $null
}

if (-not (Test-Path -LiteralPath $DownloadsPath -PathType Container)) {
    throw "Downloads folder not found: $DownloadsPath"
}
if (-not (Test-Path -LiteralPath $RepositoryPath -PathType Container)) {
    throw "Repository folder not found: $RepositoryPath"
}

$labRoot = Join-Path $RepositoryPath 'VR-Research-Lab'
$privateRoot = Join-Path $labRoot 'private-reference-packages'
$manifestRoot = Join-Path $labRoot 'local-manifests'
$reportRoot = Join-Path $labRoot 'docs\experiment-logs'

foreach ($path in @($privateRoot, $manifestRoot, $reportRoot)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

$allowedExtensions = @('.zip', '.7z', '.rar', '.exe', '.msi', '.dll')
$candidates = Get-ChildItem -LiteralPath $DownloadsPath -File | Where-Object {
    $allowedExtensions -contains $_.Extension.ToLowerInvariant()
}

$results = [System.Collections.Generic.List[object]]::new()

foreach ($file in $candidates) {
    $route = Resolve-PackageRoute -File $file
    if ($null -eq $route) { continue }

    $sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $packageSlug = Get-SafeSlug -Value ([System.IO.Path]::GetFileNameWithoutExtension($file.Name))
    $destinationDir = Join-Path $privateRoot (Join-Path $route.Game (Join-Path $route.Creator $sha256.Substring(0, 12)))
    $destinationFile = Join-Path $destinationDir $file.Name

    $manifest = [ordered]@{
        schemaVersion = 1
        importedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        sourcePath = $file.FullName
        originalFileName = $file.Name
        extension = $file.Extension
        sizeBytes = $file.Length
        lastWriteTimeUtc = $file.LastWriteTimeUtc.ToString('o')
        sha256 = $sha256
        creator = $route.Creator
        game = $route.Game
        routingConfidence = $route.Confidence
        storageClass = 'local-private-reference'
        redistributionAllowed = $false
        analysisStatus = 'queued'
        notes = 'Original package retained locally. Do not commit package binaries. Derived notes and licence-compatible source excerpts only.'
    }

    if ($PSCmdlet.ShouldProcess($file.FullName, "Import to $destinationFile")) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destinationFile -Force

        $manifestPath = Join-Path $manifestRoot ("{0}-{1}.json" -f $packageSlug, $sha256.Substring(0, 12))
        $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

        $results.Add([pscustomobject]@{
            File = $file.Name
            Creator = $route.Creator
            Game = $route.Game
            Sha256 = $sha256
            Destination = $destinationFile
            Manifest = $manifestPath
        })
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $reportRoot "battle-bridge-vr-import-$timestamp.md"
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# Battle Bridge VR Reference Import')
$lines.Add('')
$lines.Add("Generated: $((Get-Date).ToUniversalTime().ToString('u')) UTC")
$lines.Add('')
$lines.Add('Original packages are stored under the gitignored local-private area. This report contains metadata only.')
$lines.Add('')
if ($results.Count -eq 0) {
    $lines.Add('No matching VR reference packages were found.')
} else {
    $lines.Add('| File | Creator | Game | SHA-256 |')
    $lines.Add('|---|---|---|---|')
    foreach ($item in $results) {
        $lines.Add("| $($item.File) | $($item.Creator) | $($item.Game) | ``$($item.Sha256)`` |")
    }
}
$lines | Set-Content -LiteralPath $reportPath -Encoding UTF8

[pscustomobject]@{
    Verdict = if ($results.Count -gt 0) { 'IMPORTED' } else { 'NO_MATCHES' }
    ImportedCount = $results.Count
    ReportPath = $reportPath
    PrivateRoot = $privateRoot
    Results = $results
} | ConvertTo-Json -Depth 6
