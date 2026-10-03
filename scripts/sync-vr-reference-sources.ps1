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
$cacheRoot = Join-Path $RepoRoot ($lock.local_cache_root -replace "/", "\")
New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null

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

foreach ($source in $selected) {
  $reuseAllowed = [bool]$source.code_reuse_allowed
  if (-not $reuseAllowed -and -not $IncludeAnalysisOnly) {
    Write-Host "[SKIP] $($source.source_id): $($source.intake_mode) ($($source.licence))"
    continue
  }

  if (-not $reuseAllowed) {
    Write-Host "[REFERENCE ONLY] $($source.source_id): public metadata/docs may be inspected, but source reuse is blocked ($($source.licence))."
    continue
  }

  if ($source.licence -ne "MIT") {
    throw "Refusing reusable source intake for $($source.source_id): expected MIT, got '$($source.licence)'."
  }

  $dest = Join-Path $cacheRoot $source.source_id
  if (-not (Test-Path (Join-Path $dest ".git"))) {
    Write-Host "[CLONE] $($source.repository)"
    git clone --origin origin $source.url $dest
    if ($LASTEXITCODE -ne 0) { throw "git clone failed for $($source.source_id)" }
  }

  Write-Host "[FETCH] $($source.source_id)"
  git -C $dest remote set-url origin $source.url
  git -C $dest fetch --prune --tags origin
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed for $($source.source_id)" }

  git -C $dest cat-file -e "$($source.commit)^{commit}"
  if ($LASTEXITCODE -ne 0) {
    git -C $dest fetch origin $source.commit
    if ($LASTEXITCODE -ne 0) { throw "Pinned commit unavailable for $($source.source_id): $($source.commit)" }
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

  Write-Host "[PINNED] $($source.source_id) @ $actual"
}

Write-Host "VR reference source intake complete. Cache: $cacheRoot"
