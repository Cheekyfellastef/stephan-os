[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$uiUrl = 'http://127.0.0.1:4173/'
$launcherStateDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Stephanos'
$launcherStatePath = Join-Path $launcherStateDir 'launcher-state.json'

function Write-LiveLog([string]$Message) {
  Write-Host "[LAUNCHER LIVE] $Message"
}

function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord) {
  Write-Host "[LAUNCHER LIVE] Failed step: $Step" -ForegroundColor Red
  if ($null -ne $ErrorRecord) {
    Write-Host ($ErrorRecord | Out-String).Trim() -ForegroundColor Red
  }
  Write-Host ''
  Read-Host 'Launcher failed. Press Enter to keep this window open and review the error'
  exit 1
}

function Get-LauncherState {
  if (-not (Test-Path $launcherStatePath)) {
    return @{}
  }

  try {
    return (Get-Content $launcherStatePath -Raw | ConvertFrom-Json -AsHashtable)
  }
  catch {
    Write-LiveLog 'Launcher state was unreadable; starting with a fresh local launcher cache'
    return @{}
  }
}

function Save-LauncherState([hashtable]$State) {
  if (-not (Test-Path $launcherStateDir)) {
    New-Item -ItemType Directory -Path $launcherStateDir -Force | Out-Null
  }

  ($State | ConvertTo-Json -Depth 6) | Set-Content -Path $launcherStatePath -Encoding UTF8
}

function Get-FileSha256([string]$Path) {
  if (-not (Test-Path $Path)) {
    return ''
  }

  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-DependencyFingerprint([string]$RelativePath) {
  $targetPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { $repoRoot } else { Join-Path $repoRoot $RelativePath }
  $files = @(
    (Join-Path $targetPath 'package.json'),
    (Join-Path $targetPath 'package-lock.json'),
    (Join-Path $targetPath 'npm-shrinkwrap.json'),
    (Join-Path $targetPath 'yarn.lock'),
    (Join-Path $targetPath 'pnpm-lock.yaml')
  ) | Where-Object { Test-Path $_ }

  if ($files.Count -eq 0) {
    return ''
  }

  return ($files | ForEach-Object { "$(Split-Path $_ -Leaf):$(Get-FileSha256 $_)" }) -join '|'
}

function Ensure-NpmDependencies([string]$RelativePath, [hashtable]$LauncherState) {
  $targetPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { $repoRoot } else { Join-Path $repoRoot $RelativePath }
  $packageJsonPath = Join-Path $targetPath 'package.json'
  $nodeModulesPath = Join-Path $targetPath 'node_modules'
  $displayPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { 'root' } else { $RelativePath }

  if (-not (Test-Path $packageJsonPath)) {
    return
  }

  $fingerprints = if ($LauncherState.ContainsKey('dependencyFingerprints')) {
    $LauncherState.dependencyFingerprints
  }
  else {
    @{}
  }

  $currentFingerprint = Get-DependencyFingerprint -RelativePath $RelativePath
  $previousFingerprint = ''
  if ($fingerprints.ContainsKey($displayPath)) {
    $previousFingerprint = [string]$fingerprints[$displayPath]
  }

  $needsInstall = -not (Test-Path $nodeModulesPath) -or [string]::IsNullOrWhiteSpace($currentFingerprint) -or $currentFingerprint -ne $previousFingerprint

  if (-not $needsInstall) {
    Write-LiveLog "dependencies unchanged ($displayPath); reusing existing node_modules"
    return
  }

  $reason = if (-not (Test-Path $nodeModulesPath)) { 'node_modules missing' } else { 'package metadata changed' }
  Write-LiveLog "installing dependencies ($displayPath) - $reason"
  Push-Location $repoRoot
  try {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
      & npm install
    }
    else {
      & npm --prefix $RelativePath install
    }

    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed in $displayPath"
    }
  }
  finally {
    Pop-Location
  }

  if (-not $LauncherState.ContainsKey('dependencyFingerprints')) {
    $LauncherState.dependencyFingerprints = @{}
  }
  $LauncherState.dependencyFingerprints[$displayPath] = Get-DependencyFingerprint -RelativePath $RelativePath
}

function Get-GitBranchName {
  $branchName = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null)
  if ($LASTEXITCODE -ne 0) {
    return 'unknown'
  }

  return ($branchName | Out-String).Trim()
}

function Update-RepoIfSafe {
  $isGitRepo = (& git -C $repoRoot rev-parse --is-inside-work-tree 2>$null)
  if ($LASTEXITCODE -ne 0 -or (($isGitRepo | Out-String).Trim()) -ne 'true') {
    Write-LiveLog 'repo status unavailable (not a git working tree); skipping auto-update'
    return
  }

  $repoStatus = (& git -C $repoRoot status --short --untracked-files=all 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw 'git status failed while checking repo cleanliness'
  }

  $branchName = Get-GitBranchName
  if ([string]::IsNullOrWhiteSpace($repoStatus.Trim())) {
    Write-LiveLog 'repo clean'
    Write-LiveLog "repo clean on branch $branchName"
  }
  else {
    Write-LiveLog 'repo dirty'
    Write-LiveLog "repo dirty on branch $branchName"
    Write-LiveLog 'update skipped to protect local changes'
    Write-LiveLog 'blocked update details:'
    Write-Host ($repoStatus.TrimEnd())
    return
  }

  Write-LiveLog 'running git fetch --all --prune'
  & git -C $repoRoot fetch --all --prune
  if ($LASTEXITCODE -ne 0) {
    throw 'git fetch --all --prune failed'
  }

  Write-LiveLog 'running git pull --ff-only'
  & git -C $repoRoot pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    throw 'git pull --ff-only failed'
  }

  Write-LiveLog 'latest code pulled'
}

function Start-DevWindow([string]$Title, [string]$Command) {
  $escapedRepoRoot = $repoRoot.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $psCommand = "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'; Set-Location '$escapedRepoRoot'; & $escapedCommand"
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoRoot -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $psCommand
  ) | Out-Null
}

function Test-UrlReady([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  }
  catch {
    return $false
  }
}

function Wait-ForUrl([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-UrlReady -Url $Url) {
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for $StepLabel at $Url"
}

function Ensure-ProcessRunning([string]$StepLabel, [string]$HealthUrl, [string]$WindowTitle, [string]$Command) {
  Write-LiveLog "starting $StepLabel"
  if (Test-UrlReady -Url $HealthUrl) {
    Write-LiveLog "$StepLabel already responding; reusing existing process"
    return
  }

  Start-DevWindow -Title $WindowTitle -Command $Command
}

try {
  $launcherState = Get-LauncherState

  Update-RepoIfSafe

  Ensure-NpmDependencies -RelativePath '' -LauncherState $launcherState
  Ensure-NpmDependencies -RelativePath 'stephanos-ui' -LauncherState $launcherState
  Ensure-NpmDependencies -RelativePath 'stephanos-server' -LauncherState $launcherState
  Save-LauncherState -State $launcherState

  Ensure-ProcessRunning -StepLabel 'backend' -HealthUrl $backendHealthUrl -WindowTitle 'Stephanos Backend' -Command 'npm --prefix stephanos-server run dev'
  Ensure-ProcessRunning -StepLabel 'launcher shell' -HealthUrl 'http://127.0.0.1:4173/__stephanos/health' -WindowTitle 'Stephanos Launcher Shell' -Command 'npm run stephanos:serve'

  Write-LiveLog 'waiting for backend'
  Wait-ForUrl -StepLabel 'backend' -Url $backendHealthUrl

  Write-LiveLog 'waiting for launcher shell'
  Wait-ForUrl -StepLabel 'launcher shell' -Url $uiUrl

  Write-LiveLog 'opening browser'
  Start-Process $uiUrl | Out-Null
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
