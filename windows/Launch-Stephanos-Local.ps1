[CmdletBinding()]
param(
  [switch]$AutoOpen,
  [ValidateSet('launcher-root','vite-dev')]
  [string]$Mode = 'launcher-root'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$launcherRootUrl = 'http://127.0.0.1:4173/'
$viteDevUrl = 'http://localhost:5173/'
$uiUrl = if ($Mode -eq 'vite-dev') { $viteDevUrl } else { $launcherRootUrl }

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

function Ensure-ProcessRunning([string]$StepLabel, [string]$HealthUrl, [string]$WindowTitle, [string]$Command) {
  Write-LiveLog "starting $StepLabel"
  if (Test-UrlReachable -Url $HealthUrl) {
    Write-LiveLog "$StepLabel already responding; reusing existing process"
    return
  }

  Start-DevWindow -Title $WindowTitle -Command $Command
  Write-LiveLog "$StepLabel process started (command=$Command)"
}

function Stop-ProcessOnTcpPort([int]$Port) {
  $connections = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  }

  if (-not $connections) {
    return @()
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  $killedProcessIds = @()
  foreach ($processId in $processIds) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      $killedProcessIds += $processId
    }
    catch {
      Write-LiveLog "failed to stop process on port $Port (pid=$processId): $($_.Exception.Message)"
    }
  }

  return $killedProcessIds
}

function Get-PortListenerSnapshot([int]$Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return @{ Running = $false; ProcessIds = @(); ProcessNames = @() }
  }

  $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  $processNames = @()
  foreach ($processId in $processIds) {
    try {
      $processNames += (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    }
    catch {
      $processNames += "pid-$processId"
    }
  }

  return @{ Running = $true; ProcessIds = $processIds; ProcessNames = @($processNames | Select-Object -Unique) }
}

function Open-LocalStephanosBrowser([string]$Url) {
  Start-Process -FilePath $Url | Out-Null
}

try {
  $port4173Before = Get-PortListenerSnapshot -Port 4173
  $port5173Before = Get-PortListenerSnapshot -Port 5173

  Write-LiveLog "selected ignition mode: $Mode"
  Write-LiveLog "final browser target: $uiUrl"
  Write-LiveLog "4173 currently running: $($port4173Before.Running) (pids=$([string]::Join(',', $port4173Before.ProcessIds)); names=$([string]::Join(',', $port4173Before.ProcessNames)))"
  Write-LiveLog "5173 currently running: $($port5173Before.Running) (pids=$([string]::Join(',', $port5173Before.ProcessIds)); names=$([string]::Join(',', $port5173Before.ProcessNames)))"

  Ensure-ProcessRunning -StepLabel 'backend' -HealthUrl $backendHealthUrl -WindowTitle 'Stephanos Backend' -Command 'npm --prefix stephanos-server run dev'

  if ($Mode -eq 'vite-dev') {
    Write-LiveLog 'starting vite-dev UI server'
    Ensure-ProcessRunning -StepLabel 'vite-dev ui' -HealthUrl $viteDevUrl -WindowTitle 'Stephanos Vite Dev' -Command 'npm --prefix stephanos-ui run dev'
  }
  else {
    Write-LiveLog 'launcher-root selected; ensuring port 5173 is not used by vite-dev'
    $stopped = Stop-ProcessOnTcpPort -Port 5173
    if ($stopped.Count -gt 0) {
      Write-LiveLog "stopped 5173 listener process ids: $([string]::Join(',', $stopped))"
    }
    else {
      Write-LiveLog 'no 5173 listener to stop'
    }
  }

  Write-LiveLog 'waiting for backend'
  Wait-ForUrl -StepLabel 'backend' -Url $backendHealthUrl

  if ($Mode -eq 'vite-dev') {
    Write-LiveLog "waiting for vite-dev runtime at $uiUrl"
    Wait-ForUrl -StepLabel 'vite-dev ui' -Url $uiUrl
  }
  else {
    Write-LiveLog "waiting for launcher-root runtime at $uiUrl"
    Wait-ForUrl -StepLabel 'launcher-root ui' -Url $uiUrl
  }

  $isLocalhostLaunch = $uiUrl -like 'http://127.0.0.1:*' -or $uiUrl -like 'http://localhost:*'
  $autoOpenEnabled = if ($isLocalhostLaunch) { $AutoOpen.IsPresent } else { $true }

  Write-LiveLog 'server started'
  Write-LiveLog "manual URL: $uiUrl"
  Write-LiveLog "browser auto-open disabled: $(-not $autoOpenEnabled)"

  Write-Host ''
  Write-Host 'Stephanos local server ready' -ForegroundColor Green
  Write-Host 'Open manually in browser:' -ForegroundColor Green
  Write-Host $uiUrl -ForegroundColor Green
  Write-Host ''

  if ($autoOpenEnabled) {
    Open-LocalStephanosBrowser -Url $uiUrl
  }
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
