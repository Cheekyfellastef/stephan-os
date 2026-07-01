[CmdletBinding()]
param(
  [switch]$AutoOpen,
  [ValidateSet('launcher-root','vite-dev')]
  [string]$Mode = 'launcher-root',
  [ValidateSet('launcher','runtime','cockpit')]
  [string]$BootMode = 'cockpit',
  [string]$RepositoryRoot = ''
)

$ErrorActionPreference = 'Stop'

function Resolve-LauncherRepositoryRoot([string]$RequestedRoot) {
  $candidates = @()
  if ($RequestedRoot -and $RequestedRoot.Trim()) { $candidates += $RequestedRoot.Trim() }
  if ($env:STEPHANOS_PROOF_WORKTREE_ROOT -and $env:STEPHANOS_PROOF_WORKTREE_ROOT.Trim()) { $candidates += $env:STEPHANOS_PROOF_WORKTREE_ROOT.Trim() }
  if ($PWD -and $PWD.Path) { $candidates += $PWD.Path }
  $candidates += (Split-Path -Parent $PSScriptRoot)

  foreach ($candidate in $candidates) {
    try {
      $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).ProviderPath
      $packageJson = Join-Path $resolved 'package.json'
      $igniteScript = Join-Path $resolved 'scripts/ignite-stephanos-local.mjs'
      $approvalHelper = Join-Path $resolved 'windows/Invoke-Stephanos-Ignite-With-Approval.ps1'
      if ((Test-Path -LiteralPath $packageJson -PathType Leaf) -and (Test-Path -LiteralPath $igniteScript -PathType Leaf) -and (Test-Path -LiteralPath $approvalHelper -PathType Leaf)) {
        return $resolved
      }
    }
    catch {}
  }

  throw 'Unable to resolve a Stephanos repository root for launcher/proof startup. Set -RepositoryRoot or STEPHANOS_PROOF_WORKTREE_ROOT to the PR worktree being proven.'
}

$repoRoot = Resolve-LauncherRepositoryRoot -RequestedRoot $RepositoryRoot
$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$launcherShellUrl = 'http://127.0.0.1:4173/'
$launcherRuntimeUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html'
$launcherRuntimeStatusUrl = 'http://127.0.0.1:4173/apps/stephanos/runtime-status.json'
$viteDevUrl = 'http://localhost:5173/'
$launcherRootCommand = 'powershell.exe -ExecutionPolicy Bypass -File .\windows\Invoke-Stephanos-Ignite-With-Approval.ps1 -RepositoryRoot .'
$launcherRootCanonicalCommand = 'npm run stephanos:ignite'
$launcherRootReuseProbeCommand = 'node scripts/ignite-stephanos-local.mjs --probe-existing-server'
$visiblePowerShellRequired = $false
$ignitionProofRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'stephanos-ignition-proof'
$ignitionStatusPath = Join-Path $ignitionProofRoot 'launcher-status.json'
$supportSnapshotPath = Join-Path $ignitionProofRoot 'support-snapshot.json'
$ignitionSplashPath = Join-Path $ignitionProofRoot 'ignition-status.html'

$ignitionStageModel = @(
  [ordered]@{ id = 'finding-repo'; label = 'Finding repo'; detail = 'Resolve the exact Stephanos PR worktree before any process startup.' },
  [ordered]@{ id = 'checking-workspace-dirt'; label = 'Checking workspace dirt'; detail = 'Inspect local workspace state through the canonical ignition flow.' },
  [ordered]@{ id = 'classifying-safe-vs-unsafe-dirt'; label = 'Classifying safe vs unsafe dirt'; detail = 'Keep generated/runtime cleanup separate from source divergence.' },
  [ordered]@{ id = 'cleaning-generated-runtime-stoppers'; label = 'Cleaning generated/runtime stoppers'; detail = 'Only approved generated/runtime stoppers may be cleaned; source files are not reset.' },
  [ordered]@{ id = 'checking-dependencies'; label = 'Checking dependencies'; detail = 'Verify dependency/runtime prerequisites before readiness claims.' },
  [ordered]@{ id = 'checking-ports-existing-runtime'; label = 'Checking ports and existing runtime'; detail = 'Probe current listeners and reuse only truth-verified runtime processes.' },
  [ordered]@{ id = 'starting-local-services'; label = 'Starting local services'; detail = 'Start backend and launcher-root services in minimized/background PowerShell with bounded logs.' },
  [ordered]@{ id = 'opening-command-deck'; label = 'Opening Command Deck'; detail = 'Open browser Command Deck/runtime surfaces after health and runtime-status proof.' }
)


function Write-LiveLog([string]$Message) {
  Write-Host "[LAUNCHER LIVE] $Message"
}

function Initialize-IgnitionProofWorkspace {
  New-Item -ItemType Directory -Force -Path $ignitionProofRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ignitionProofRoot 'logs') | Out-Null
}

function Get-IgnitionStageSnapshot([string]$CurrentStageId) {
  return @($ignitionStageModel | ForEach-Object {
    [ordered]@{
      id = $_.id
      label = $_.label
      detail = $_.detail
      state = if ($_.id -eq $CurrentStageId) { 'active' } else { 'pending' }
    }
  })
}

function Write-IgnitionStatus([string]$Phase, [string]$Message, [hashtable]$Extra = @{}) {
  Initialize-IgnitionProofWorkspace
  $currentStage = if ($Extra.ContainsKey('currentStage')) { $Extra.currentStage } else { $Phase }
  $payload = [ordered]@{
    phase = $Phase
    message = $Message
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    visiblePowerShellRequired = $visiblePowerShellRequired
    primaryUi = 'splash-status-browser'
    splashPath = $ignitionSplashPath
    statusPath = $ignitionStatusPath
    supportSnapshotPath = $supportSnapshotPath
    logRoot = (Join-Path $ignitionProofRoot 'logs')
    nextOperatorAction = if ($Extra.ContainsKey('nextOperatorAction')) { $Extra.nextOperatorAction } else { 'Watch the Stephanos ignition splash/status screen.' }
    currentStage = $currentStage
    ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId $currentStage
    destinations = [ordered]@{ statusPath = $ignitionStatusPath; supportSnapshotPath = $supportSnapshotPath; splashPath = $ignitionSplashPath; logRoot = (Join-Path $ignitionProofRoot 'logs') }
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ignitionStatusPath -Encoding UTF8
  $supportSnapshot = [ordered]@{
    generatedAt = $payload.updatedAt
    source = 'windows-launcher-ignition-status'
    launcherStatusPath = $ignitionStatusPath
    supportSnapshotPath = $supportSnapshotPath
    phase = $payload.phase
    message = $payload.message
    blocker = if ($payload.Contains('blocker')) { $payload.blocker } else { $null }
    blockerDetails = if ($payload.Contains('blockerDetails')) { $payload.blockerDetails } else { $null }
    parentTimeout = if ($payload.Contains('parentTimeout')) { $payload.parentTimeout } else { $null }
    childIgnitionBlocker = if ($payload.Contains('childIgnitionBlocker')) { $payload.childIgnitionBlocker } else { $null }
    destinations = $payload.destinations
  }
  $supportSnapshot | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $supportSnapshotPath -Encoding UTF8
}

function New-IgnitionSplashScreen {
  Initialize-IgnitionProofWorkspace
  $statusPathHtml = [System.Net.WebUtility]::HtmlEncode($ignitionStatusPath)
  $logRootHtml = [System.Net.WebUtility]::HtmlEncode((Join-Path $ignitionProofRoot 'logs'))
  $html = @"
<!doctype html>
<meta charset="utf-8">
<title>Stephanos Ignition Status</title>
<style>body{margin:0;background:#07111f;color:#e7f2ff;font-family:Segoe UI,Arial,sans-serif}main{max-width:960px;margin:6vh auto;padding:32px;border:1px solid #1e4f7a;border-radius:18px;background:#0b1728}h1{margin-top:0}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#0e7a4f;color:#d8fff0;font-weight:700}.muted{color:#a7bdd4}code{background:#111f33;padding:2px 6px;border-radius:6px}.stage-grid{display:grid;gap:10px;margin:22px 0}.stage{padding:12px 14px;border:1px solid #254766;border-radius:12px;background:#0f2036}.stage strong{display:block;color:#f5fbff}.blocker{border-color:#7a3b1e;background:#2b160f;color:#ffd9c8}</style>
<main>
  <span class="pill">IGNITION ACTIVE</span>
  <h1>Stephanos is starting</h1>
  <p>The ignition button selected the splash/status screen as the operator-facing UI.</p>
  <p class="muted">Verbose PowerShell output is bounded to logs, not shown as the primary interface.</p>
  <section aria-label="Detailed ignition stages" class="stage-grid">
    <div class="stage"><strong>Finding repo</strong><span>Resolve the exact Stephanos PR worktree.</span></div>
    <div class="stage"><strong>Checking workspace dirt</strong><span>Inspect local workspace state through canonical ignition.</span></div>
    <div class="stage"><strong>Classifying safe vs unsafe dirt</strong><span>Separate generated/runtime cleanup from source divergence.</span></div>
    <div class="stage"><strong>Cleaning generated/runtime stoppers</strong><span>Clean only approved generated/runtime paths; never reset source.</span></div>
    <div class="stage"><strong>Checking dependencies</strong><span>Verify prerequisites before claiming readiness.</span></div>
    <div class="stage"><strong>Checking ports and existing runtime</strong><span>Reuse only truth-verified runtime processes.</span></div>
    <div class="stage"><strong>Starting local services</strong><span>Start minimized/background PowerShell processes with bounded logs.</span></div>
    <div class="stage"><strong>Opening Command Deck</strong><span>Open browser surfaces after health proof.</span></div>
  </section>
  <section class="blocker" aria-label="Blocker and operator action">If blocked, status records the exact blocker plus the next operator action.</section>
  <p>Status: <code>$statusPathHtml</code></p>
  <p>Logs: <code>$logRootHtml</code></p>
</main>
"@
  $html | Set-Content -LiteralPath $ignitionSplashPath -Encoding UTF8
  Write-IgnitionStatus -Phase 'splash-shown' -Message 'Stephanos ignition splash/status screen is the primary UI.' -Extra @{ currentStage = 'finding-repo' }
  return $ignitionSplashPath
}

function Show-IgnitionSplashScreen {
  $splashPath = New-IgnitionSplashScreen
  Start-Process -FilePath $splashPath | Out-Null
  Write-LiveLog "ignition splash/status screen opened: $splashPath"
  Write-LiveLog "verbose logs/status destination: $ignitionProofRoot"
}


function Get-BoundedLogTail([string]$Path, [int]$TailLines = 80) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  try { return @(Get-Content -LiteralPath $Path -Tail $TailLines -ErrorAction Stop) }
  catch { return @("<failed to read bounded log tail: $($_.Exception.Message)>") }
}

function ConvertFrom-IgnitionMarkerJson([string]$Line, [string]$Marker) {
  $pattern = '^\[IGNITION\] ' + [regex]::Escape($Marker) + '=(.+)$'
  if ($Line -notmatch $pattern) { return $null }
  try { return ($Matches[1] | ConvertFrom-Json -ErrorAction Stop) }
  catch { return $null }
}

function Get-ChildIgnitionBlockerFromLogs {
  $logRoot = Join-Path $ignitionProofRoot 'logs'
  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { return $null }
  $logs = @(Get-ChildItem -LiteralPath $logRoot -Filter '*.log' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending)
  foreach ($log in $logs) {
    $lines = Get-BoundedLogTail -Path $log.FullName
    foreach ($line in @($lines | Select-Object -Last 80)) {
      $sourceUpdateStatus = ConvertFrom-IgnitionMarkerJson -Line $line -Marker 'source-update-status'
      if ($sourceUpdateStatus -and ($line -match 'missing-upstream')) {
        return [ordered]@{
          blocker = 'missing-upstream'
          marker = 'source-update-status'
          message = 'Child ignition reported missing-upstream in source-update-status before launcher runtime-status became reachable.'
          logPath = $log.FullName
          logStream = if ($log.Name -like '*.stderr.log') { 'stderr' } else { 'stdout' }
          sourceUpdateStatus = $sourceUpdateStatus
        }
      }

      $repairPacket = ConvertFrom-IgnitionMarkerJson -Line $line -Marker 'repair-packet'
      if ($repairPacket) {
        $repairText = ($repairPacket | ConvertTo-Json -Depth 10 -Compress)
        $blocker = if ($repairText -match 'missing-upstream') { 'missing-upstream' } else { 'repair-packet' }
        return [ordered]@{
          blocker = $blocker
          marker = 'repair-packet'
          message = "Child ignition reported $blocker in repair-packet before launcher runtime-status became reachable."
          logPath = $log.FullName
          logStream = if ($log.Name -like '*.stderr.log') { 'stderr' } else { 'stdout' }
          repairPacket = $repairPacket
        }
      }
    }
  }
  return $null
}

function Resolve-LauncherTimeoutBlocker([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds) {
  $parentTimeout = [ordered]@{
    stepLabel = $StepLabel
    url = $Url
    timeoutSeconds = $TimeoutSeconds
    diagnostic = "Timed out waiting for $StepLabel at $Url"
  }
  $childBlocker = Get-ChildIgnitionBlockerFromLogs
  if ($childBlocker) {
    return [ordered]@{
      message = $childBlocker.message
      blocker = $childBlocker.blocker
      blockerDetails = $childBlocker
      childIgnitionBlocker = $childBlocker
      parentTimeout = $parentTimeout
    }
  }
  return [ordered]@{
    message = $parentTimeout.diagnostic
    blocker = $parentTimeout.diagnostic
    parentTimeout = $parentTimeout
  }
}

function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord, [hashtable]$FailureDetails = @{}) {
  $failureExtra = @{ currentStage = 'blocked'; nextOperatorAction = 'Review the exact blocker in this launcher window and the bounded ignition logs, then resolve it before retrying.'; blocker = $Step }
  foreach ($key in $FailureDetails.Keys) { $failureExtra[$key] = $FailureDetails[$key] }
  Write-IgnitionStatus -Phase 'blocked' -Message $Step -Extra $failureExtra
  Write-Host "[LAUNCHER LIVE] Failed step: $Step" -ForegroundColor Red
  if ($null -ne $ErrorRecord) {
    Write-Host ($ErrorRecord | Out-String).Trim() -ForegroundColor Red
  }
  Write-Host ''
  Read-Host 'Launcher failed. Press Enter to keep this window open and review the error'
  exit 1
}

function Start-DevWindow([string]$Title, [string]$Command) {
  Initialize-IgnitionProofWorkspace
  $escapedRepoRoot = $repoRoot.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $safeLogName = ($Title -replace '[^A-Za-z0-9._-]', '-')
  $stdoutLog = Join-Path $ignitionProofRoot ("logs/{0}.stdout.log" -f $safeLogName)
  $stderrLog = Join-Path $ignitionProofRoot ("logs/{0}.stderr.log" -f $safeLogName)
  $psCommand = "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'; Set-Location '$escapedRepoRoot'; & $escapedCommand"
  Write-IgnitionStatus -Phase 'starting-process' -Message "Starting $Title in minimized/background PowerShell with bounded log capture." -Extra @{ processTitle = $Title; stdoutLog = $stdoutLog; stderrLog = $stderrLog }
  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoRoot -WindowStyle Minimized -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -ArgumentList @(
    '-NoProfile',
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

function Wait-ForUrl([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds = 120, [switch]$SurfaceChildIgnitionBlockers) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-UrlReachable -Url $Url) {
      return
    }
    Start-Sleep -Seconds 1
  }

  if ($SurfaceChildIgnitionBlockers.IsPresent) {
    $timeoutBlocker = Resolve-LauncherTimeoutBlocker -StepLabel $StepLabel -Url $Url -TimeoutSeconds $TimeoutSeconds
    Write-IgnitionStatus -Phase 'blocked' -Message $timeoutBlocker.message -Extra @{ currentStage = 'blocked'; nextOperatorAction = 'Review the surfaced child ignition blocker and bounded stdout/stderr logs, then resolve it before retrying.'; blocker = $timeoutBlocker.blocker; blockerDetails = $timeoutBlocker.blockerDetails; childIgnitionBlocker = $timeoutBlocker.childIgnitionBlocker; parentTimeout = $timeoutBlocker.parentTimeout }
    throw $timeoutBlocker.message
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

  Show-IgnitionSplashScreen

  Write-IgnitionStatus -Phase 'checking-ports-existing-runtime' -Message 'Checking ports and existing runtime before startup.' -Extra @{ currentStage = 'checking-ports-existing-runtime' }

  $port4173Before = Get-PortListenerSnapshot -Port 4173
  $port5173Before = Get-PortListenerSnapshot -Port 5173

  Write-LiveLog "selected repository root: $repoRoot"
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

  Write-IgnitionStatus -Phase 'starting-local-services' -Message 'Starting local services with minimized/background PowerShell log capture.' -Extra @{ currentStage = 'starting-local-services' }

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
    Wait-ForUrl -StepLabel 'launcher-root runtime-status endpoint' -Url $launcherRuntimeStatusUrl -SurfaceChildIgnitionBlockers

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

  Write-IgnitionStatus -Phase 'opening-command-deck' -Message 'Opening Command Deck browser surfaces after readiness proof.' -Extra @{ currentStage = 'opening-command-deck'; browserTargets = $browserTargets; visiblePowerShellWallRequired = $false }

  Write-IgnitionStatus -Phase 'ready' -Message 'Stephanos local server ready.' -Extra @{ browserTargets = $browserTargets; visiblePowerShellWallRequired = $false }

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
