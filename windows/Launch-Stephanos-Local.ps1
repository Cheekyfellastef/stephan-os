[CmdletBinding()]
param(
  [switch]$AutoOpen,
  [ValidateSet('launcher-root','vite-dev')]
  [string]$Mode = 'launcher-root',
  [ValidateSet('launcher','runtime','cockpit')]
  [string]$BootMode = 'cockpit'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$launcherShellUrl = 'http://127.0.0.1:4173/'
$launcherRuntimeUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html'
$launcherRuntimeStatusUrl = 'http://127.0.0.1:4173/apps/stephanos/runtime-status.json'
$viteDevUrl = 'http://localhost:5173/'
$launcherRootCommand = 'npm run stephanos:serve'
$launcherRootReuseProbeCommand = 'node scripts/ignite-stephanos-local.mjs --probe-existing-server'

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


function Test-CommandSucceeds([string]$Command) {
  try {
    $output = & cmd /c $Command 2>&1
    if ($output) {
      $output | ForEach-Object { Write-LiveLog $_ }
    }
    return $LASTEXITCODE -eq 0
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

function Ensure-ProcessRunning(
  [string]$StepLabel,
  [string]$HealthUrl,
  [string]$WindowTitle,
  [string]$Command,
  [string]$ReuseProbeCommand = ''
) {
  Write-LiveLog "starting $StepLabel"
  if (Test-UrlReachable -Url $HealthUrl) {
    if ($ReuseProbeCommand) {
      Write-LiveLog "$StepLabel health is up; validating served build truth before reuse"
      if (Test-CommandSucceeds -Command $ReuseProbeCommand) {
        Write-LiveLog "$StepLabel already responding with current build truth; reusing existing process"
        return
      }

      Write-LiveLog "$StepLabel responded but failed truth probe; replacing stale process"
      $stopped = Stop-ProcessOnTcpPort -Port 4173
      if ($stopped.Count -gt 0) {
        Write-LiveLog "stopped stale process ids on 4173: $([string]::Join(',', $stopped))"
      }
      else {
        throw "$StepLabel truth probe failed and no process could be stopped on 4173; refusing silent reuse of an unknown/stale server"
      }
    }
    else {
      Write-LiveLog "$StepLabel already responding; reusing existing process"
      return
    }
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

function Get-CockpitSurfaces([string]$ResolvedBootMode) {
  $surfaceMap = [ordered]@{
    launcher = [ordered]@{ Label = 'launcher'; Url = $launcherShellUrl }
    runtime  = [ordered]@{ Label = 'runtime'; Url = $launcherRuntimeUrl }
  }

  switch ($ResolvedBootMode) {
    'launcher' { return @($surfaceMap.launcher) }
    'runtime' { return @($surfaceMap.runtime) }
    'cockpit' { return @($surfaceMap.launcher, $surfaceMap.runtime) }
    default {
      throw "Unsupported boot mode '$ResolvedBootMode'. Supported modes: launcher, runtime, cockpit."
    }
  }
}

function Open-CockpitSurface([string]$Url, [string]$Label) {
  Write-LiveLog "Opening ${Label}: $Url"

  $openAttempts = @(
    [ordered]@{
      Name = 'cmd-start'
      Invoke = {
        & cmd.exe /d /c start "" "$Url" | Out-Null
        return $LASTEXITCODE -eq 0
      }
    },
    [ordered]@{
      Name = 'explorer'
      Invoke = {
        Start-Process -FilePath 'explorer.exe' -ArgumentList @($Url) | Out-Null
        return $true
      }
    },
    [ordered]@{
      Name = 'start-process-url'
      Invoke = {
        Start-Process -FilePath $Url | Out-Null
        return $true
      }
    }
  )

  foreach ($attempt in $openAttempts) {
    Write-LiveLog "Opening $Label via $($attempt.Name)"
    try {
      if (& $attempt.Invoke) {
        Write-LiveLog "Opened $Label via $($attempt.Name)"
        return
      }

      Write-LiveLog "Open attempt $($attempt.Name) returned non-success for $Label"
    }
    catch {
      Write-LiveLog "Open attempt $($attempt.Name) failed for ${Label}: $($_.Exception.Message)"
    }
  }

  throw "Unable to open $Label in browser for URL $Url"
}

try {
  $resolvedBootMode = if ($Mode -eq 'vite-dev') { 'launcher' } else { $BootMode }
  $browserSurfaces = if ($Mode -eq 'vite-dev') {
    @([ordered]@{ Label = 'vite-dev'; Url = $viteDevUrl })
  }
  else {
    Get-CockpitSurfaces -ResolvedBootMode $resolvedBootMode
  }
  $browserTargets = @($browserSurfaces | ForEach-Object { $_.Url })

  $port4173Before = Get-PortListenerSnapshot -Port 4173
  $port5173Before = Get-PortListenerSnapshot -Port 5173

  Write-LiveLog "selected ignition mode: $Mode"
  Write-LiveLog "Boot mode: $resolvedBootMode"
  if ($Mode -eq 'vite-dev') {
    Write-LiveLog "vite-dev target: $viteDevUrl"
    if ($BootMode -ne 'launcher') {
      Write-LiveLog "Boot mode '$BootMode' is not used in vite-dev; using launcher surface only"
    }
  }
  else {
    Write-LiveLog "4173 launcher shell: $launcherShellUrl"
    Write-LiveLog "4173 runtime target: $launcherRuntimeUrl"
    Write-LiveLog "4173 runtime status probe: $launcherRuntimeStatusUrl"
  }

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

    Write-LiveLog "starting launcher-root UI server (command=$launcherRootCommand)"
    Ensure-ProcessRunning -StepLabel 'launcher-root ui' -HealthUrl $launcherRuntimeStatusUrl -WindowTitle 'Stephanos Launcher Root' -Command $launcherRootCommand -ReuseProbeCommand $launcherRootReuseProbeCommand
  }

  Write-LiveLog 'waiting for backend'
  Wait-ForUrl -StepLabel 'backend' -Url $backendHealthUrl

  if ($Mode -eq 'vite-dev') {
    Write-LiveLog "waiting for vite-dev runtime at $viteDevUrl"
    Wait-ForUrl -StepLabel 'vite-dev ui' -Url $viteDevUrl
  }
  else {
    Write-LiveLog "waiting for launcher-root runtime-status endpoint at $launcherRuntimeStatusUrl"
    Wait-ForUrl -StepLabel 'launcher-root runtime-status endpoint' -Url $launcherRuntimeStatusUrl

    Write-LiveLog "waiting for launcher-root shell at $launcherShellUrl"
    Wait-ForUrl -StepLabel 'launcher-root shell' -Url $launcherShellUrl

    if ($resolvedBootMode -in @('runtime', 'cockpit')) {
      Write-LiveLog "waiting for launcher-root runtime target at $launcherRuntimeUrl"
      Wait-ForUrl -StepLabel 'launcher-root runtime target' -Url $launcherRuntimeUrl
    }
  }

  $isLocalhostLaunch = ($browserTargets | Where-Object { $_ -notlike 'http://127.0.0.1:*' -and $_ -notlike 'http://localhost:*' }).Count -eq 0
  $autoOpenEnabled = if ($Mode -eq 'launcher-root') {
    $true
  }
  elseif ($isLocalhostLaunch) {
    $AutoOpen.IsPresent
  }
  else {
    $true
  }

  Write-LiveLog 'server started'
  Write-LiveLog "manual URL(s): $([string]::Join(', ', $browserTargets))"
  Write-LiveLog "browser auto-open disabled: $(-not $autoOpenEnabled)"

  Write-Host ''
  Write-Host 'Stephanos local server ready' -ForegroundColor Green
  Write-Host 'Open manually in browser:' -ForegroundColor Green
  foreach ($target in $browserTargets) {
    Write-Host $target -ForegroundColor Green
  }
  Write-Host ''

  if ($autoOpenEnabled) {
    for ($index = 0; $index -lt $browserSurfaces.Count; $index++) {
      $surface = $browserSurfaces[$index]
      Open-CockpitSurface -Url $surface.Url -Label $surface.Label

      if ($index -lt ($browserSurfaces.Count - 1)) {
        Start-Sleep -Milliseconds 450
      }
    }
  }
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
