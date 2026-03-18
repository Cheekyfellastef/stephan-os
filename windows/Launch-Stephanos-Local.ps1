[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$uiSourcePath = Join-Path $repoRoot 'stephanos-ui\src'
$builtRuntimePath = Join-Path $repoRoot 'apps\stephanos\dist'
$builtRuntimeIndexPath = Join-Path $builtRuntimePath 'index.html'
$runtimeStatusPath = Join-Path $repoRoot 'apps\stephanos\runtime-status.json'
$serverUrl = 'http://127.0.0.1:8787/api/health'
$appUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/'
$distHealthUrl = 'http://127.0.0.1:4173/__stephanos/health'
$ollamaHealthUrl = 'http://127.0.0.1:11434/api/tags'
$launcherWindowTitle = 'Update + Launch Local Stephanos (Ollama)'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Test-CommandAvailable([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-ContentHashHex([string[]]$Paths) {
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    foreach ($path in $Paths) {
      if (-not (Test-Path $path)) { continue }
      $bytes = [System.IO.File]::ReadAllBytes($path)
      [void]$hasher.TransformBlock($bytes, 0, $bytes.Length, $bytes, 0)
    }
    [void]$hasher.TransformFinalBlock([byte[]]::new(0), 0, 0)
    return ([System.BitConverter]::ToString($hasher.Hash)).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $hasher.Dispose()
  }
}

function Ensure-NpmDependencies([string]$WorkingDirectory, [string]$Label) {
  $packageJson = Join-Path $WorkingDirectory 'package.json'
  if (-not (Test-Path $packageJson)) {
    return
  }

  $lockFile = Join-Path $WorkingDirectory 'package-lock.json'
  $hashInputs = @($packageJson)
  if (Test-Path $lockFile) {
    $hashInputs += $lockFile
  }

  $nodeModules = Join-Path $WorkingDirectory 'node_modules'
  $stampFile = Join-Path $nodeModules '.stephanos-deps-hash'
  $desiredHash = Get-ContentHashHex -Paths $hashInputs
  $currentHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }

  if ((Test-Path $nodeModules) -and $currentHash -eq $desiredHash) {
    Write-Host "$Label dependencies are already current." -ForegroundColor DarkGray
    return
  }

  Write-Step "Installing/updating $Label dependencies only because package metadata changed"
  Push-Location $WorkingDirectory
  try {
    npm install
  }
  finally {
    Pop-Location
  }

  if (-not (Test-Path $nodeModules)) {
    throw "npm install did not create $nodeModules"
  }

  Set-Content -Path $stampFile -Value $desiredHash -Encoding ascii
}

function Test-HttpReady([string]$Url, [int]$TimeoutSeconds = 2) {
  try {
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds -Headers @{ 'Cache-Control' = 'no-cache' }
    return $true
  }
  catch {
    return $false
  }
}

function Get-Json([string]$Url, [int]$TimeoutSeconds = 2) {
  try {
    return Invoke-RestMethod -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds -Headers @{ 'Cache-Control' = 'no-cache' }
  }
  catch {
    return $null
  }
}

function Test-BackendHealthy() {
  $payload = Get-Json -Url $serverUrl -TimeoutSeconds 2
  return $null -ne $payload -and $payload.service -eq 'stephanos-server' -and $payload.ok -eq $true
}

function Get-DistHealthPayload() {
  return Get-Json -Url $distHealthUrl -TimeoutSeconds 2
}

function Sync-DistRuntimeUrl() {
  $payload = Get-DistHealthPayload
  if ($null -ne $payload -and -not [string]::IsNullOrWhiteSpace($payload.runtimeUrl)) {
    $script:appUrl = $payload.runtimeUrl
  }

  return $payload
}

function Test-DistHealthy() {
  $payload = Get-DistHealthPayload
  return $null -ne $payload -and $payload.service -eq 'stephanos-dist-server' -and $payload.distEntryExists -eq $true
}

function Test-DistRuntimeReady() {
  $payload = Sync-DistRuntimeUrl
  if ($null -eq $payload -or $payload.service -ne 'stephanos-dist-server') {
    return $false
  }

  $runtimeUrlToTest = if (-not [string]::IsNullOrWhiteSpace($payload.runtimeUrl)) { $payload.runtimeUrl } else { $appUrl }
  return Test-HttpReady -Url $runtimeUrlToTest -TimeoutSeconds 2
}

function Test-OllamaReachable() {
  $payload = Get-Json -Url $ollamaHealthUrl -TimeoutSeconds 2
  return $null -ne $payload -and $null -ne $payload.models
}

function Get-ProcessUsingPort([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if (-not $connection) { return $null }
    return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  }
  catch {
    return $null
  }
}

function Start-WindowedProcess([string]$Title, [string]$Command, [string]$WorkingDirectory) {
  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $psCommand = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$escapedWorkingDirectory'; $escapedCommand"
  Start-Process powershell.exe -WorkingDirectory $WorkingDirectory -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $psCommand
  ) | Out-Null
}

function Wait-ForCondition([string]$Label, [scriptblock]$Probe, [int]$TimeoutSeconds = 10, [int]$DelayMilliseconds = 1000) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $Probe) {
      return $true
    }
    Start-Sleep -Milliseconds $DelayMilliseconds
  }

  Write-Warning "$Label did not become ready within $TimeoutSeconds seconds."
  return $false
}

function Get-SubsystemSnapshot() {
  $buildPresent = Test-Path $builtRuntimeIndexPath
  $backendReachable = Test-BackendHealthy
  $uiHealthPayload = Sync-DistRuntimeUrl
  $uiHealthReachable = $null -ne $uiHealthPayload -and $uiHealthPayload.service -eq 'stephanos-dist-server' -and $uiHealthPayload.distEntryExists -eq $true
  $uiReachable = $uiHealthReachable -and (Test-DistRuntimeReady)
  $ollamaReachable = Test-OllamaReachable

  return [ordered]@{
    build = [ordered]@{
      state = if ($buildPresent) { 'present' } else { 'missing' }
      path = 'apps/stephanos/dist/index.html'
      ready = $buildPresent
    }
    backend = [ordered]@{
      state = if ($backendReachable) { 'up' } else { 'down' }
      url = 'http://localhost:8787'
      healthUrl = $serverUrl
      ready = $backendReachable
    }
    ui = [ordered]@{
      state = if ($uiReachable) { 'up' } elseif ($uiHealthReachable) { 'starting' } else { 'down' }
      url = $appUrl
      healthUrl = $distHealthUrl
      ready = $uiReachable
    }
    ollama = [ordered]@{
      state = if ($ollamaReachable) { 'reachable' } else { 'unreachable' }
      url = 'http://localhost:11434'
      healthUrl = $ollamaHealthUrl
      ready = $ollamaReachable
    }
  }
}

function Write-StatusFile([string]$State, [string]$Message, [hashtable]$Extra = @{}) {
  $payload = [ordered]@{
    appId = 'stephanos'
    launcherTitle = $launcherWindowTitle
    state = $State
    message = $Message
    runtimeUrl = $appUrl
    distEntryPath = 'apps/stephanos/dist/index.html'
    backendUrl = 'http://localhost:8787'
    browserUrl = $appUrl
    subsystems = Get-SubsystemSnapshot
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }

  foreach ($key in $Extra.Keys) {
    $payload[$key] = $Extra[$key]
  }

  $folder = Split-Path -Parent $runtimeStatusPath
  if (-not (Test-Path $folder)) {
    New-Item -Path $folder -ItemType Directory -Force | Out-Null
  }

  $payload | ConvertTo-Json -Depth 6 | Set-Content -Path $runtimeStatusPath -Encoding utf8
}

function Ensure-ExpectedPath([string]$Path, [string]$Label) {
  if (-not (Test-Path $Path)) {
    throw "$Label not found at $Path"
  }
}

function Invoke-NpmScript([string]$WorkingDirectory, [string[]]$Arguments, [string]$FailureMessage) {
  Push-Location $WorkingDirectory
  try {
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw $FailureMessage
    }
  }
  finally {
    Pop-Location
  }
}

function Update-RepoIfSafe() {
  Write-Step 'Checking repository state'
  Write-StatusFile -State 'checking-repo' -Message 'Checking repository state before update.'

  Push-Location $repoRoot
  try {
    $gitStatus = git status --porcelain --untracked-files=no
    if ([string]::IsNullOrWhiteSpace(($gitStatus | Out-String))) {
      Write-Step 'Pulling latest changes with fast-forward only'
      Write-StatusFile -State 'updating' -Message 'Pulling the latest safe fast-forward updates.'
      git fetch --all --prune
      if ($LASTEXITCODE -ne 0) {
        throw 'git fetch failed'
      }

      git pull --ff-only
      if ($LASTEXITCODE -ne 0) {
        throw 'git pull --ff-only failed'
      }

      return 'updated'
    }

    Write-Warning 'Skipping git pull because tracked local changes exist. This protects your work from being overwritten.'
    return 'skipped-local-changes'
  }
  finally {
    Pop-Location
  }
}

function Ensure-StephanosBuildReady() {
  Write-Step 'Checking whether the built Stephanos runtime is already current'
  Write-StatusFile -State 'verifying-build' -Message 'Checking the Stephanos build output.'

  try {
    Invoke-NpmScript -WorkingDirectory $repoRoot -Arguments @('run', 'stephanos:verify') -FailureMessage 'Stephanos dist verify failed'
    Write-Host 'Stephanos build output is already current.' -ForegroundColor DarkGray
  }
  catch {
    Write-Step 'Building Stephanos because the current dist output is missing or stale'
    Write-StatusFile -State 'building' -Message 'Building Stephanos from stephanos-ui/src.'
    Invoke-NpmScript -WorkingDirectory $repoRoot -Arguments @('run', 'stephanos:build') -FailureMessage 'Stephanos build failed'
    Invoke-NpmScript -WorkingDirectory $repoRoot -Arguments @('run', 'stephanos:verify') -FailureMessage 'Stephanos dist verify failed after build'
  }

  if (-not (Test-Path $builtRuntimeIndexPath)) {
    throw 'Stephanos build missing: apps/stephanos/dist/index.html not found'
  }

  Write-Host 'Verified build output: apps/stephanos/dist/index.html' -ForegroundColor Green
  Write-StatusFile -State 'build-ready' -Message 'Stephanos build is ready.'
}

function Ensure-BackendRunning() {
  if (Test-BackendHealthy) {
    Write-Host 'Stephanos backend already running on 8787, reusing' -ForegroundColor DarkGray
    return 'reused'
  }

  $existingProcess = Get-ProcessUsingPort -Port 8787
  if ($existingProcess) {
    $message = "Port 8787 is occupied by non-Stephanos process '$($existingProcess.ProcessName)', cannot continue"
    throw $message
  }

  Write-Step 'Starting the local Stephanos API server'
  Write-StatusFile -State 'starting-backend' -Message 'Starting the Stephanos backend on port 8787.'
  Start-WindowedProcess -Title 'Stephanos Local API' -WorkingDirectory (Join-Path $repoRoot 'stephanos-server') -Command 'npm run start'
  return 'started'
}

function Ensure-DistServerRunning() {
  if (Test-DistHealthy) {
    Write-Host 'Stephanos dist server already running on 4173, reusing' -ForegroundColor DarkGray
    return 'reused'
  }

  $existingProcess = Get-ProcessUsingPort -Port 4173
  if ($existingProcess) {
    $message = "Port 4173 is occupied by non-Stephanos process '$($existingProcess.ProcessName)', cannot continue"
    throw $message
  }

  Write-Step 'Starting the local Stephanos runtime server'
  Write-StatusFile -State 'starting-dist' -Message 'Starting the Stephanos dist server on port 4173.'
  Start-WindowedProcess -Title 'Stephanos Local Runtime' -WorkingDirectory $repoRoot -Command 'node scripts/serve-stephanos-dist.mjs'
  return 'started'
}

function Wait-ForStephanosReadiness([int]$TimeoutSeconds = 10) {
  Write-Step 'Waiting for Stephanos Local to become ready'
  Write-StatusFile -State 'waiting-ready' -Message 'Waiting for build, backend, and UI readiness to converge.'

  return Wait-ForCondition -Label 'Stephanos full readiness' -TimeoutSeconds $TimeoutSeconds -DelayMilliseconds 1000 -Probe {
    (Test-Path $builtRuntimeIndexPath) -and
    (Test-BackendHealthy) -and
    (Test-DistHealthy) -and
    (Test-DistRuntimeReady)
  }
}

function Open-BrowserUrl([string]$Url) {
  Write-Host "Opening browser at: $Url" -ForegroundColor Cyan
  try {
    Start-Process $Url -ErrorAction Stop | Out-Null
    return $true
  }
  catch {
    Write-Warning "Browser launch failed: $($_.Exception.Message)"
    Write-Host "Stephanos is running. Open this URL manually: $Url" -ForegroundColor Yellow
    return $false
  }
}

try {
  if (-not (Test-CommandAvailable git)) {
    throw 'Git is required but was not found in PATH.'
  }

  if (-not (Test-CommandAvailable npm)) {
    throw 'Node.js/npm is required but was not found in PATH.'
  }

  Write-Step 'Using the real live Stephanos paths'
  Write-Host "Source: $uiSourcePath"
  Write-Host "Built runtime: $builtRuntimePath"
  Write-Host 'Default Ollama target: http://localhost:11434'
  Write-StatusFile -State 'starting' -Message 'Stephanos local launch has started.'

  Write-Step 'Verifying repository paths'
  Ensure-ExpectedPath -Path $repoRoot -Label 'Repo root'
  Ensure-ExpectedPath -Path $uiSourcePath -Label 'Stephanos UI source'
  Ensure-ExpectedPath -Path (Join-Path $repoRoot 'stephanos-server') -Label 'Stephanos backend'

  $updateResult = Update-RepoIfSafe

  Ensure-NpmDependencies -WorkingDirectory $repoRoot -Label 'root launcher'
  Ensure-NpmDependencies -WorkingDirectory (Join-Path $repoRoot 'stephanos-server') -Label 'Stephanos server'
  Ensure-NpmDependencies -WorkingDirectory (Join-Path $repoRoot 'stephanos-ui') -Label 'Stephanos UI'

  Ensure-StephanosBuildReady
  $backendAction = Ensure-BackendRunning
  $distAction = Ensure-DistServerRunning

  $distHealth = Sync-DistRuntimeUrl
  if ($null -eq $distHealth -or -not (Test-DistRuntimeReady)) {
    throw "Stephanos dist server started, but the printed runtime URL did not return HTTP 200: $appUrl"
  }

  if (-not (Wait-ForStephanosReadiness -TimeoutSeconds 10)) {
    throw "Stephanos readiness check failed. Backend and UI did not both become reachable within 10 seconds."
  }

  Write-StatusFile -State 'ready' -Message 'Stephanos running normally' -Extra @{
    updateResult = $updateResult
    backendAction = $backendAction
    uiAction = $distAction
  }

  Write-Step 'Opening Stephanos Local in your default browser'
  $browserOpened = Open-BrowserUrl -Url $appUrl

  Write-Host "`nStephanos Local is ready." -ForegroundColor Green
  Write-Host "Backend health URL: $serverUrl"
  Write-Host "Dist health URL: $distHealthUrl"
  Write-Host 'Local AI Mode default: Ollama at http://localhost:11434'
  if ($browserOpened) {
    Write-Host "Browser URL: $appUrl"
  }
  else {
    Write-Host 'Browser auto-open: failed'
    Write-Host "Manual URL: $appUrl"
  }

  if (Test-OllamaReachable) {
    Write-Host 'Ollama status: reachable' -ForegroundColor Green
  }
  else {
    Write-Host 'Ollama status: unreachable (Stephanos still launched successfully).' -ForegroundColor Yellow
  }
}
catch {
  $message = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { $_ | Out-String }
  Write-StatusFile -State 'error' -Message $message
  throw
}
