param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string[]]$SourceId = @(),
  [switch]$IncludeAnalysisOnly
)

$ErrorActionPreference = "Stop"

$lockPath = Join-Path $RepoRoot "VR-Research-Lab\reference-source-lock.json"
if (-not (Test-Path $lockPath)) {
  throw "Reference source lock not found: $lockPath"
}

$lock = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
if ([string]$lock.schema -ne "stephanos.vr-reference-source-lock.v2") {
  throw "Unsupported VR source lock schema: $($lock.schema)"
}

$cacheRoot = Join-Path $RepoRoot ($lock.local_cache_root -replace "/", "\")
$receiptRoot = Join-Path $cacheRoot "_receipts"
New-Item -ItemType Directory -Force -Path $cacheRoot, $receiptRoot | Out-Null

$selected = @($lock.sources)
if ($SourceId.Count -gt 0) {
  $wanted = [System.Collections.Generic.HashSet[string]]::new([string[]]$SourceId, [System.StringComparer]::OrdinalIgnoreCase)
  $selected = @($selected | Where-Object { $wanted.Contains([string]$_.source_id) })
  if ($selected.Count -ne $wanted.Count) {
    $found = @($selected | ForEach-Object source_id)
    $missing = @($SourceId | Where-Object { $_ -notin $found })
    throw "Unknown source id(s): $($missing -join ', ')"
  }
}

$allowedCacheClasses = @("permissive", "copyleft-separate-component")

foreach ($source in $selected) {
  $cacheAllowed = [bool]$source.local_cache_allowed
  $reuseClass = [string]$source.reuse_class

  if (-not $cacheAllowed) {
    if ($IncludeAnalysisOnly) {
      Write-Host "[REFERENCE ONLY] $($source.source_id): $($source.intake_mode) ($($source.licence)); no local source clone."
    } else {
      Write-Host "[SKIP] $($source.source_id): analysis-only / no cache permission."
    }
    continue
  }

  if ($reuseClass -notin $allowedCacheClasses) {
    throw "Refusing source cache for $($source.source_id): unsupported reuse class '$reuseClass'."
  }
  if ([string]::IsNullOrWhiteSpace([string]$source.licence) -or [string]$source.licence -match "NOASSERTION|All rights reserved|proprietary") {
    throw "Refusing source cache for $($source.source_id): explicit reusable licence required, got '$($source.licence)'."
  }

  $dest = Join-Path $cacheRoot $source.source_id
  if (-not (Test-Path (Join-Path $dest ".git"))) {
    Write-Host "[CLONE] $($source.repository)"
    git clone --origin origin $source.url $dest
    if ($LASTEXITCODE -ne 0) { throw "git clone failed for $($source.source_id)" }
  }

  Write-Host "[FETCH] $($source.source_id)"
  git -C $dest remote set-url origin $source.url

  $declaredRef = [string]$source.ref
  if ([string]::IsNullOrWhiteSpace($declaredRef)) {
    throw "Declared ref missing for $($source.source_id)."
  }
  $remoteTrackingRef = "refs/remotes/origin/$declaredRef"

  git -C $dest fetch --prune --tags origin "+refs/heads/$($declaredRef):$remoteTrackingRef"
  if ($LASTEXITCODE -ne 0) {
    throw "Declared ref unavailable for $($source.source_id): $declaredRef"
  }

  git -C $dest cat-file -e "$($source.commit)^{commit}"
  if ($LASTEXITCODE -ne 0) {
    throw "Pinned commit unavailable for $($source.source_id): $($source.commit)"
  }

  git -C $dest merge-base --is-ancestor $source.commit $remoteTrackingRef
  if ($LASTEXITCODE -ne 0) {
    throw "Pinned commit $($source.commit) is not reachable from declared ref '$declaredRef' for $($source.source_id)."
  }

  git -C $dest checkout --detach $source.commit
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed for $($source.source_id)" }

  git -C $dest submodule sync --recursive
  git -C $dest submodule update --init --recursive
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Submodule hydration was incomplete for $($source.source_id); parent source remains pinned."
  }

  $actual = (git -C $dest rev-parse HEAD).Trim()
  if ($actual -ne $source.commit) {
    throw "Source pin mismatch for $($source.source_id): expected $($source.commit), got $actual"
  }

  $receipt = [ordered]@{
    schema = "stephanos.vr-reference-source-receipt.v1"
    source_id = [string]$source.source_id
    repository = [string]$source.repository
    expected_commit = [string]$source.commit
    actual_commit = $actual
    licence = [string]$source.licence
    reuse_class = $reuseClass
    core_reuse_policy = [string]$source.core_reuse_policy
    hydrated_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
  }
  $receiptPath = Join-Path $receiptRoot "$($source.source_id).json"
  $receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $receiptPath -Encoding utf8

  if ($reuseClass -eq "copyleft-separate-component") {
    Write-Host "[PINNED / COPYLEFT BOUNDARY] $($source.source_id) @ $actual"
  } else {
    Write-Host "[PINNED] $($source.source_id) @ $actual"
  }
}

Write-Host "VR reference source intake complete. Cache: $cacheRoot"
