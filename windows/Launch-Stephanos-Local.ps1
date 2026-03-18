[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$uiSourcePath = Join-Path $repoRoot 'stephanos-ui\src'
$builtRuntimePath = Join-Path $repoRoot 'apps\stephanos\dist'
$serverUrl = 'http://127.0.0.1:8787/api/health'
$appUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/'
$launcherWindowTitle = 'Stephanos Local Launcher'

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
    $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSeconds
    return $true
  }
  catch {
    return $false
  }
}

function Wait-ForHttpReady([string]$Url, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpReady -Url $Url -TimeoutSeconds 2) {
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Open-BrowserUrl([string]$Url) {
  Write-Host "Opening browser at: $Url" -ForegroundColor Cyan
  try {
    Start-Process -FilePath $Url -ErrorAction Stop | Out-Null
    return $true
  }
  catch {
    $reason = $_.Exception.Message
    Write-Warning "Browser launch failed: $reason"
    Write-Host "Stephanos is running. Open this URL manually: $Url" -ForegroundColor Yellow
    return $false
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

if (-not (Test-CommandAvailable git)) {
  throw 'Git is required but was not found in PATH.'
}

if (-not (Test-CommandAvailable npm)) {
  throw 'Node.js/npm is required but was not found in PATH.'
}

Write-Step "Using the real live Stephanos paths"
Write-Host "Source: $uiSourcePath"
Write-Host "Built runtime: $builtRuntimePath"
Write-Host "Default Ollama target: http://localhost:11434"

Push-Location $repoRoot
try {
  $gitStatus = git status --porcelain
  if ([string]::IsNullOrWhiteSpace(($gitStatus | Out-String))) {
    Write-Step 'Safely updating the current Git branch with fast-forward only'
    git fetch --all --prune
    git pull --ff-only
  }
  else {
    Write-Warning 'Skipping git pull because the repo has local changes. This protects your work from being overwritten.'
  }
}
finally {
  Pop-Location
}

Ensure-NpmDependencies -WorkingDirectory $repoRoot -Label 'root launcher'
Ensure-NpmDependencies -WorkingDirectory (Join-Path $repoRoot 'stephanos-server') -Label 'Stephanos server'
Ensure-NpmDependencies -WorkingDirectory (Join-Path $repoRoot 'stephanos-ui') -Label 'Stephanos UI'

Write-Step 'Rebuilding the real Stephanos runtime from stephanos-ui/src into apps/stephanos/dist'
Push-Location $repoRoot
try {
  npm run stephanos:build
  npm run stephanos:verify
}
finally {
  Pop-Location
}

if (-not (Test-HttpReady -Url $serverUrl)) {
  Write-Step 'Starting the local Stephanos API server'
  Start-WindowedProcess -Title 'Stephanos Local API' -WorkingDirectory (Join-Path $repoRoot 'stephanos-server') -Command 'npm run start'
}
else {
  Write-Host 'Stephanos API server is already running.' -ForegroundColor DarkGray
}

if (-not (Test-HttpReady -Url $appUrl)) {
  Write-Step 'Starting the local Stephanos runtime server'
  Start-WindowedProcess -Title 'Stephanos Local Runtime' -WorkingDirectory $repoRoot -Command 'node scripts/serve-stephanos-dist.mjs'
}
else {
  Write-Host 'Stephanos runtime server is already running.' -ForegroundColor DarkGray
}

Write-Step 'Waiting for Stephanos Local to become ready'
if (-not (Wait-ForHttpReady -Url $serverUrl -TimeoutSeconds 60)) {
  Write-Warning 'The backend did not answer within 60 seconds. The browser will still open so you can inspect the app.'
}

if (-not (Wait-ForHttpReady -Url $appUrl -TimeoutSeconds 60)) {
  throw 'The built Stephanos runtime did not become reachable within 60 seconds.'
}

Write-Step 'Opening Stephanos Local in your default browser'
$browserOpened = Open-BrowserUrl -Url $appUrl

Write-Host "`nStephanos Local is ready." -ForegroundColor Green
if ($browserOpened) {
  Write-Host "Browser URL: $appUrl"
}
else {
  Write-Host "Browser auto-open: failed"
  Write-Host "Manual URL: $appUrl"
}
Write-Host "Backend health URL: $serverUrl"
Write-Host "Local AI Mode default: Ollama at http://localhost:11434"
Write-Host "If Ollama is offline, use the in-app Mock Mode button for a friendly local fallback."
