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

function Test-UrlReachable([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  }
  catch {
    return $false
  }
}

function Test-LandingPageReady([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers @{
      'Cache-Control' = 'no-cache'
      'Pragma' = 'no-cache'
    }

    $statusCode = [int]$response.StatusCode
    $contentType = [string]$response.Headers['Content-Type']
    $body = [string]$response.Content
    $hasStephanosMarker = $body -match '<meta\s+name="stephanos-version"'

    return @{
      Ok = ($statusCode -ge 200 -and $statusCode -lt 300 -and $hasStephanosMarker)
      StatusCode = $statusCode
      ContentType = $contentType
      HasStephanosMarker = $hasStephanosMarker
      Error = ''
    }
  }
  catch {
    return @{
      Ok = $false
      StatusCode = $null
      ContentType = ''
      HasStephanosMarker = $false
      Error = $_.Exception.Message
    }
  }
}

function Test-JavaScriptMime([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -Headers @{
      'Cache-Control' = 'no-cache'
    }
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
      return @{
        Ok = $false
        StatusCode = $response.StatusCode
        ContentType = [string]$response.Headers['Content-Type']
      }
    }

    $contentType = ([string]$response.Headers['Content-Type']).ToLowerInvariant()
    return @{
      Ok = $contentType -eq 'text/javascript; charset=utf-8'
      StatusCode = $response.StatusCode
      ContentType = [string]$response.Headers['Content-Type']
    }
  }
  catch {
    return @{
      Ok = $false
      StatusCode = $null
      ContentType = ''
    }
  }
}

function Test-LauncherShellReusable {
  $healthReady = Test-UrlReachable -Url 'http://127.0.0.1:4173/__stephanos/health'
  if (-not $healthReady) {
    return @{
      Reusable = $false
      HealthReady = $false
      RuntimeStatusMime = $null
      LocalUrlsMime = $null
    }
  }

  $runtimeStatusMime = Test-JavaScriptMime -Url 'http://127.0.0.1:4173/shared/runtime/runtimeStatusModel.mjs'
  $localUrlsMime = Test-JavaScriptMime -Url 'http://127.0.0.1:4173/shared/runtime/stephanosLocalUrls.mjs?v=live-launcher-probe'
  return @{
    Reusable = $runtimeStatusMime.Ok -and $localUrlsMime.Ok
    HealthReady = $true
    RuntimeStatusMime = $runtimeStatusMime
    LocalUrlsMime = $localUrlsMime
  }
}

function Stop-ProcessOnTcpPort([int]$Port) {
  $connections = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  }

  if (-not $connections) {
    Write-LiveLog "no listening process found on port $Port"
    return @()
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  $killedProcessIds = @()
  foreach ($processId in $processIds) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      Write-LiveLog "detected old $Port PID $processId (name=$($process.ProcessName))"
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-LiveLog "killed old $Port PID $processId"
      $killedProcessIds += $processId
    }
    catch {
      Write-LiveLog "failed to stop process on port $Port (pid=$processId): $($_.Exception.Message)"
    }
  }

  return $killedProcessIds
}

function Wait-ForUrl([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-UrlReachable -Url $Url) {
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for $StepLabel at $Url"
}

function Wait-ForLandingPageReady([string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempt = 0

  while ((Get-Date) -lt $deadline) {
    $attempt += 1
    $probe = Test-LandingPageReady -Url $Url

    if ($probe.Ok) {
      Write-LiveLog "launcher shell readiness probe success (attempt $attempt): status=$($probe.StatusCode) marker=$($probe.HasStephanosMarker) contentType=$($probe.ContentType)"
      return
    }

    $reason = if (-not [string]::IsNullOrWhiteSpace([string]$probe.Error)) {
      $probe.Error
    }
    elseif ($null -eq $probe.StatusCode) {
      'no-http-response'
    }
    else {
      "status=$($probe.StatusCode) marker=$($probe.HasStephanosMarker) contentType=$($probe.ContentType)"
    }

    Write-LiveLog "launcher shell readiness probe attempt $attempt failed: $reason"
    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for launcher landing page readiness at $Url (timeout=${TimeoutSeconds}s)"
}

function Ensure-ProcessRunning([string]$StepLabel, [string]$HealthUrl, [string]$WindowTitle, [string]$Command) {
  Write-LiveLog "starting $StepLabel"
  if (Test-UrlReachable -Url $HealthUrl) {
    Write-LiveLog "$StepLabel already responding; reusing existing process"
    return
  }

  Start-DevWindow -Title $WindowTitle -Command $Command
  Write-LiveLog "$StepLabel process started (command=$Command)"
}

function Ensure-LauncherShellRunning {
  Write-LiveLog 'starting launcher shell'
  $isLocalhostDevLaunch = $uiUrl -like 'http://127.0.0.1:*' -or $uiUrl -like 'http://localhost:*'
  if ($isLocalhostDevLaunch) {
    Write-LiveLog 'localhost/dev mode: forcing hard reset of port 4173 launcher shell server (no reuse)'
    Stop-ProcessOnTcpPort -Port 4173 | Out-Null
  }

  Start-DevWindow -Title 'Stephanos Launcher Shell' -Command 'npm run stephanos:serve'
  Write-LiveLog 'launcher shell server process started (command=npm run stephanos:serve)'
}

function Get-ChromeExecutable {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Open-LocalStephanosBrowser([string]$Url) {
  $isLocalhostTarget = $Url -like 'http://127.0.0.1:*' -or $Url -like 'http://localhost:*'
  $chromeExecutable = if ($isLocalhostTarget) { Get-ChromeExecutable } else { $null }
  $isolatedProfileEnabled = $false
  $isolatedUserDataDir = ''
  $isolatedProfileDirectory = ''

  if ($chromeExecutable) {
    if ($isLocalhostTarget) {
      $isolatedProfileEnabled = $true
      $isolatedUserDataDir = Join-Path $launcherStateDir 'chrome-localhost-user-data'
      $isolatedProfileDirectory = 'StephanosLocalhost'
      if (-not (Test-Path $isolatedUserDataDir)) {
        New-Item -ItemType Directory -Path $isolatedUserDataDir -Force | Out-Null
      }
    }

    $chromeArgs = @(
      '--new-window',
      '--no-first-run',
      '--disable-session-crashed-bubble',
      '--disable-features=ErrorPageAutoReload'
    )
    if ($isolatedProfileEnabled) {
      $chromeArgs += @(
        "--user-data-dir=$isolatedUserDataDir",
        "--profile-directory=$isolatedProfileDirectory"
      )
    }
    $chromeArgs += $Url

    Write-LiveLog "opening browser with explicit Chrome top-level navigation"
    Write-LiveLog "isolated-profile mode active: $isolatedProfileEnabled"
    Write-LiveLog "browser executable: $chromeExecutable"
    Write-LiveLog "browser user-data-dir: $(if ($isolatedProfileEnabled) { $isolatedUserDataDir } else { '<default Chrome profile>' })"
    Write-LiveLog "browser profile-directory: $(if ($isolatedProfileEnabled) { $isolatedProfileDirectory } else { '<default profile>' })"
    Write-LiveLog "browser args: $($chromeArgs -join ' ')"
    Write-LiveLog "browser target URL: $Url"
    Write-LiveLog 'browser launch intent: fresh top-level navigation (no shell iframe, no recovery-tab reuse)'
    Start-Process -FilePath $chromeExecutable -ArgumentList $chromeArgs | Out-Null
    return
  }

  Write-LiveLog "isolated-profile mode active: $isolatedProfileEnabled"
  Write-LiveLog "browser executable: <not found>"
  Write-LiveLog "browser user-data-dir: <not used>"
  Write-LiveLog "browser profile-directory: <not used>"
  Write-LiveLog 'opening browser via system default handler (Chrome executable not found)'
  Write-LiveLog "browser command: Start-Process $Url"
  Write-LiveLog "browser args: <none>"
  Write-LiveLog "browser target URL: $Url"
  Write-LiveLog 'browser launch intent: top-level navigation request via shell URL handler'
  Start-Process -FilePath $Url | Out-Null
}

try {
  $launcherState = Get-LauncherState

  Update-RepoIfSafe

  Ensure-NpmDependencies -RelativePath '' -LauncherState $launcherState
  Ensure-NpmDependencies -RelativePath 'stephanos-ui' -LauncherState $launcherState
  Ensure-NpmDependencies -RelativePath 'stephanos-server' -LauncherState $launcherState
  Save-LauncherState -State $launcherState

  Ensure-ProcessRunning -StepLabel 'backend' -HealthUrl $backendHealthUrl -WindowTitle 'Stephanos Backend' -Command 'npm --prefix stephanos-server run dev'
  Ensure-LauncherShellRunning

  Write-LiveLog 'waiting for backend'
  Wait-ForUrl -StepLabel 'backend' -Url $backendHealthUrl

  Write-LiveLog "waiting for launcher shell landing page at $uiUrl"
  Wait-ForLandingPageReady -Url $uiUrl -TimeoutSeconds 120

  Write-LiveLog "opening browser at $uiUrl"
  Open-LocalStephanosBrowser -Url $uiUrl
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
