[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $repoRoot 'stephanos-ui'
$uiSourcePath = Join-Path $uiRoot 'src'
$serverRoot = Join-Path $repoRoot 'stephanos-server'
$builtRuntimePath = Join-Path $repoRoot 'apps\stephanos\dist'
$builtRuntimeIndexPath = Join-Path $builtRuntimePath 'index.html'
$runtimeStatusPath = Join-Path $repoRoot 'apps\stephanos\runtime-status.json'
$distMetadataPath = Join-Path $builtRuntimePath 'stephanos-build.json'
$serverUrl = 'http://127.0.0.1:8787/api/health'
$appUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/'
$distHealthUrl = 'http://127.0.0.1:4173/__stephanos/health'
$ollamaHealthUrl = 'http://127.0.0.1:11434/api/tags'
$launcherWindowTitle = 'Update + Launch Local Stephanos (Ollama)'
$global:Host.UI.RawUI.WindowTitle = $launcherWindowTitle

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-LiveLog([string]$Marker, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray) {
  Write-Host "[$Marker] $Message" -ForegroundColor $Color
}

function Write-StepLog([string]$Step, [string]$Phase, [string]$Message) {
  Write-LiveLog 'LAUNCHER LIVE' "$Step $Phase - $Message" Cyan
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

function Invoke-CmdCommand([string]$WorkingDirectory, [string]$Command, [string]$Marker, [string]$FailureMessage) {
  Push-Location $WorkingDirectory
  try {
    Write-LiveLog $Marker "Running in '$WorkingDirectory': cmd /c $Command" Cyan
    & cmd.exe '/d' '/s' '/c' $Command
    if ($LASTEXITCODE -ne 0) {
      throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
  }
  finally {
    Pop-Location
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
    Write-LiveLog 'LAUNCHER LIVE' "$Label dependencies already current; skipping npm install." DarkGray
    return
  }

  Write-LiveLog 'LAUNCHER LIVE' "$Label dependencies changed; running npm install." Yellow
  Invoke-CmdCommand -WorkingDirectory $WorkingDirectory -Command 'npm install' -Marker 'LAUNCHER LIVE' -FailureMessage "npm install failed for $Label"

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

function Get-DistMetadata() {
  if (-not (Test-Path $distMetadataPath)) {
    return $null
  }

  try {
    return Get-Content $distMetadataPath -Raw | ConvertFrom-Json
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
  return $null -ne $payload -and $payload.service -eq 'stephanos-dist-server' -and $payload.ok -eq $true -and $payload.distEntryExists -eq $true
}

function Test-DistRuntimeReady() {
  $payload = Sync-DistRuntimeUrl
  if ($null -eq $payload -or $payload.service -ne 'stephanos-dist-server' -or $payload.ok -ne $true) {
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

function Start-DetachedCommand([string]$Title, [string]$WorkingDirectory, [string]$Command) {
  $escapedWorkingDirectory = $WorkingDirectory.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $psCommand = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$escapedWorkingDirectory'; $escapedCommand"
  Write-LiveLog 'LAUNCHER LIVE' "Starting detached process '$Title' in '$WorkingDirectory' with command: $Command" Cyan
  Start-Process powershell.exe -WorkingDirectory $WorkingDirectory -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $psCommand
  ) | Out-Null
}

function Wait-ForCondition([string]$Label, [scriptblock]$Probe, [int]$TimeoutSeconds = 10, [int]$DelayMilliseconds = 1000) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $attempt = 0
  while ((Get-Date) -lt $deadline) {
    $attempt += 1
    if (& $Probe) {
      Write-LiveLog 'LAUNCHER LIVE' "$Label ready after $attempt probe(s)." Green
      return $true
    }

    Write-LiveLog 'LAUNCHER LIVE' "$Label not ready yet (attempt $attempt); retrying..." DarkGray
    Start-Sleep -Milliseconds $DelayMilliseconds
  }

  Write-Warning "$Label did not become ready within $TimeoutSeconds seconds."
  return $false
}

function Wait-ForBackendReady([int]$TimeoutSeconds = 10) {
  Write-StatusFile -State 'waiting-backend' -Message 'Waiting for the Stephanos backend health endpoint on port 8787.'
  return Wait-ForCondition -Label 'Backend health http://127.0.0.1:8787/api/health' -TimeoutSeconds $TimeoutSeconds -DelayMilliseconds 1000 -Probe {
    Test-BackendHealthy
  }
}

function Wait-ForDistReady([int]$TimeoutSeconds = 10) {
  Write-StatusFile -State 'waiting-dist' -Message 'Waiting for the Stephanos dist server health endpoint on port 4173.'
  return Wait-ForCondition -Label 'Dist health http://127.0.0.1:4173/__stephanos/health' -TimeoutSeconds $TimeoutSeconds -DelayMilliseconds 1000 -Probe {
    (Test-DistHealthy) -and (Test-DistRuntimeReady)
  }
}

function Get-SubsystemSnapshot() {
  $buildPresent = Test-Path $builtRuntimeIndexPath
  $backendReachable = Test-BackendHealthy
  $uiHealthPayload = Sync-DistRuntimeUrl
  $uiHealthReachable = $null -ne $uiHealthPayload -and $uiHealthPayload.service -eq 'stephanos-dist-server' -and $uiHealthPayload.ok -eq $true -and $uiHealthPayload.distEntryExists -eq $true
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
  $distMetadata = Get-DistMetadata
  $payload = [ordered]@{
    appId = 'stephanos'
    launcherTitle = $launcherWindowTitle
    state = $State
    message = $Message
    runtimeUrl = $appUrl
    distEntryPath = 'apps/stephanos/dist/index.html'
    backendUrl = 'http://localhost:8787'
    browserUrl = $appUrl
    runtimeMarker = if ($distMetadata) { $distMetadata.runtimeMarker } else { $null }
    gitCommit = if ($distMetadata) { $distMetadata.gitCommit } else { $null }
    buildTimestamp = if ($distMetadata) { $distMetadata.buildTimestamp } else { $null }
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

function Ensure-StephanosBuildReady() {
  Write-StepLog 'STEP 1 — Build' 'START' 'Installing UI deps if needed and building stephanos-ui via npm exec -- vite build.'
  Write-StatusFile -State 'building' -Message 'Building Stephanos from stephanos-ui with npm exec -- vite build.'

  Ensure-NpmDependencies -WorkingDirectory $uiRoot -Label 'Stephanos UI'
  Invoke-CmdCommand -WorkingDirectory $uiRoot -Command 'npm exec -- vite build' -Marker 'BUILD LIVE' -FailureMessage 'Stephanos UI build failed'

  if (-not (Test-Path $builtRuntimeIndexPath)) {
    throw 'STEP 1 — Build failed: apps/stephanos/dist/index.html does not exist after npm exec -- vite build'
  }

  Write-LiveLog 'BUILD LIVE' 'Verified apps/stephanos/dist/index.html exists.' Green
  Write-StepLog 'STEP 1 — Build' 'END' 'Build completed and dist index exists.'
  Write-StatusFile -State 'build-ready' -Message 'Stephanos build is ready.'
}

function Ensure-BackendRunning() {
  Write-StepLog 'STEP 2 — Start backend' 'START' 'Launching node stephanos-server/server.js and verifying /api/health.'

  if (Test-BackendHealthy) {
    Write-LiveLog 'BACKEND LIVE' 'Stephanos backend already healthy on port 8787; reusing existing process.' DarkGray
    Write-StepLog 'STEP 2 — Start backend' 'END' 'Existing backend already healthy.'
    return 'reused'
  }

  $existingProcess = Get-ProcessUsingPort -Port 8787
  if ($existingProcess) {
    $message = "Port 8787 is occupied by non-Stephanos process '$($existingProcess.ProcessName)', cannot continue"
    throw $message
  }

  Write-StatusFile -State 'starting-backend' -Message 'Starting the Stephanos backend on port 8787.'
  Write-LiveLog 'BACKEND LIVE' 'Launching command: node stephanos-server/server.js' Cyan
  Start-DetachedCommand -Title 'Stephanos Local API' -WorkingDirectory $repoRoot -Command 'node stephanos-server/server.js'

  if (-not (Wait-ForBackendReady -TimeoutSeconds 10)) {
    throw 'STEP 2 — Start backend failed: http://127.0.0.1:8787/api/health did not report ok within 10 seconds.'
  }

  Write-LiveLog 'BACKEND LIVE' 'Verified backend health endpoint returned ok.' Green
  Write-StepLog 'STEP 2 — Start backend' 'END' 'Backend is healthy on port 8787.'
  return 'started'
}

function Ensure-DistServerRunning() {
  Write-StepLog 'STEP 3 — Start static server' 'START' 'Launching node scripts/serve-stephanos-dist.mjs and verifying /__stephanos/health.'

  if (Test-DistHealthy) {
    Write-LiveLog 'DIST SERVER LIVE' 'Stephanos dist server already healthy on port 4173; reusing existing process.' DarkGray
    Write-StepLog 'STEP 3 — Start static server' 'END' 'Existing dist server already healthy.'
    return 'reused'
  }

  $existingProcess = Get-ProcessUsingPort -Port 4173
  if ($existingProcess) {
    $message = "Port 4173 is occupied by non-Stephanos process '$($existingProcess.ProcessName)', cannot continue"
    throw $message
  }

  Write-StatusFile -State 'starting-dist' -Message 'Starting the Stephanos dist server on port 4173.'
  Write-LiveLog 'DIST SERVER LIVE' 'Launching command: node scripts/serve-stephanos-dist.mjs' Cyan
  Start-DetachedCommand -Title 'Stephanos Local Runtime' -WorkingDirectory $repoRoot -Command 'node scripts/serve-stephanos-dist.mjs'

  if (-not (Wait-ForDistReady -TimeoutSeconds 10)) {
    throw 'STEP 3 — Start static server failed: http://127.0.0.1:4173/__stephanos/health did not report ok within 10 seconds.'
  }

  Write-LiveLog 'DIST SERVER LIVE' "Verified dist health endpoint returned ok and runtime URL responds: $appUrl" Green
  Write-StepLog 'STEP 3 — Start static server' 'END' 'Dist server is healthy on port 4173.'
  return 'started'
}

function Get-PortProof([int[]]$Ports) {
  $netstatOutput = netstat -ano -p tcp | Out-String
  $proof = [ordered]@{}

  foreach ($port in $Ports) {
    $proof["$port"] = @(
      $netstatOutput -split "`r?`n" | Where-Object { $_ -match ":$port\s+.*LISTENING" }
    )
  }

  return $proof
}

function Write-PortProof() {
  $proof = Get-PortProof -Ports @(4173, 8787)
  foreach ($port in $proof.Keys) {
    if ($proof[$port].Count -gt 0) {
      foreach ($line in $proof[$port]) {
        Write-LiveLog 'LAUNCHER LIVE' "netstat proof for port $port: $($line.Trim())" Green
      }
    }
    else {
      Write-LiveLog 'LAUNCHER LIVE' "netstat proof missing LISTENING entry for port $port." Yellow
    }
  }
  return $proof
}

function Open-BrowserUrl([string]$Url) {
  Write-StepLog 'STEP 4 — Open browser' 'START' "Opening $Url"
  Write-LiveLog 'BROWSER OPEN LIVE' "Calling Start-Process with URL: $Url" Cyan

  try {
    Start-Process $Url -ErrorAction Stop | Out-Null
    Write-LiveLog 'BROWSER OPEN LIVE' "Start-Process succeeded for URL: $Url" Green
    Write-StepLog 'STEP 4 — Open browser' 'END' 'Browser open command succeeded via Start-Process.'
    return 'Start-Process'
  }
  catch {
    $primaryMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { $_ | Out-String }
    Write-LiveLog 'BROWSER OPEN LIVE' "Start-Process failed: $primaryMessage" Yellow
    Write-LiveLog 'BROWSER OPEN LIVE' "Attempting fallback: cmd /c start $Url" Cyan

    try {
      & cmd.exe '/c' 'start' $Url
      if ($LASTEXITCODE -ne 0) {
        throw "cmd /c start exited with code $LASTEXITCODE"
      }
      Write-LiveLog 'BROWSER OPEN LIVE' "Fallback cmd /c start succeeded for URL: $Url" Green
      Write-StepLog 'STEP 4 — Open browser' 'END' 'Browser open command succeeded via cmd /c start.'
      return 'cmd /c start'
    }
    catch {
      $fallbackMessage = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { $_ | Out-String }
      Write-LiveLog 'BROWSER OPEN LIVE' "Fallback cmd /c start failed: $fallbackMessage" Red
      Write-Host "Stephanos is running. Open this URL manually: $Url" -ForegroundColor Yellow
      throw 'STEP 4 — Open browser failed: both Start-Process and cmd /c start failed.'
    }
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
  Write-LiveLog 'LAUNCHER LIVE' "PS1 path: $PSCommandPath" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Repo root: $repoRoot" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "UI root: $uiRoot" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Source: $uiSourcePath" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Built runtime: $builtRuntimePath" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Backend health URL: $serverUrl" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Dist health URL: $distHealthUrl" Cyan
  Write-LiveLog 'LAUNCHER LIVE' "Browser target URL: $appUrl" Cyan
  Write-LiveLog 'LAUNCHER LIVE' 'Default Ollama target: http://localhost:11434' Cyan
  Write-StatusFile -State 'starting' -Message 'Stephanos local launch has started.'

  Write-Step 'Verifying repository paths'
  Ensure-ExpectedPath -Path $repoRoot -Label 'Repo root'
  Ensure-ExpectedPath -Path $uiSourcePath -Label 'Stephanos UI source'
  Ensure-ExpectedPath -Path $serverRoot -Label 'Stephanos backend'

  Ensure-NpmDependencies -WorkingDirectory $repoRoot -Label 'root launcher'
  Ensure-NpmDependencies -WorkingDirectory $serverRoot -Label 'Stephanos server'
  Ensure-StephanosBuildReady
  $backendAction = Ensure-BackendRunning
  $distAction = Ensure-DistServerRunning
  $portProof = Write-PortProof
  $browserMethod = Open-BrowserUrl -Url $appUrl

  $distMetadata = Get-DistMetadata
  Write-StatusFile -State 'ready' -Message 'Stephanos running normally' -Extra @{
    backendAction = $backendAction
    uiAction = $distAction
    launcherCmdPath = 'windows/Launch-Stephanos-Local.cmd'
    launcherPs1Path = 'windows/Launch-Stephanos-Local.ps1'
    backendScript = 'stephanos-server/server.js'
    distServerScript = 'scripts/serve-stephanos-dist.mjs'
    uiBuildCommand = 'cd stephanos-ui && npm exec -- vite build'
    browserOpenMethod = $browserMethod
    listeningPorts = $portProof
    runtimeMarker = if ($distMetadata) { $distMetadata.runtimeMarker } else { $null }
    gitCommit = if ($distMetadata) { $distMetadata.gitCommit } else { $null }
    buildTimestamp = if ($distMetadata) { $distMetadata.buildTimestamp } else { $null }
  }

  Write-Host "`nStephanos Local is ready." -ForegroundColor Green
  Write-Host "Backend health URL: $serverUrl"
  Write-Host "Dist health URL: $distHealthUrl"
  Write-Host "Browser URL: $appUrl"
  Write-Host "Browser open method: $browserMethod"
  Write-Host 'Local AI Mode default: Ollama at http://localhost:11434'

  if (Test-OllamaReachable) {
    Write-Host 'Ollama status: reachable' -ForegroundColor Green
  }
  else {
    Write-Host 'Ollama not reachable. Stephanos still opened. Start Ollama at http://localhost:11434 or pick Mock Mode in Stephanos.' -ForegroundColor Yellow
  }
}
catch {
  $message = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { $_ | Out-String }
  Write-StatusFile -State 'error' -Message $message
  throw
}
