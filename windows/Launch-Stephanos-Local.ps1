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
$ignitionSplashPath = Join-Path $ignitionProofRoot 'ignition-status.html'
$launcherRunId = ([guid]::NewGuid()).ToString('n')
$launcherRunStartedAt = (Get-Date).ToUniversalTime()
$launcherRunLogRoot = Join-Path (Join-Path $ignitionProofRoot 'logs') $launcherRunId

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
  New-Item -ItemType Directory -Force -Path $launcherRunLogRoot | Out-Null
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
    logRoot = $launcherRunLogRoot
    launcherRunId = $launcherRunId
    launcherRunStartedAt = $launcherRunStartedAt.ToString('o')
    nextOperatorAction = if ($Extra.ContainsKey('nextOperatorAction')) { $Extra.nextOperatorAction } else { 'Watch the Stephanos ignition splash/status screen.' }
    currentStage = $currentStage
    ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId $currentStage
    destinations = [ordered]@{ statusPath = $ignitionStatusPath; splashPath = $ignitionSplashPath; logRoot = $launcherRunLogRoot }
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ignitionStatusPath -Encoding UTF8
}

function New-IgnitionSplashScreen {
  Initialize-IgnitionProofWorkspace
  $statusPathHtml = [System.Net.WebUtility]::HtmlEncode($ignitionStatusPath)
  $logRootHtml = [System.Net.WebUtility]::HtmlEncode($launcherRunLogRoot)
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


function Get-LauncherChildBlocker {
  Initialize-IgnitionProofWorkspace
  $logRoot = $launcherRunLogRoot
  $childStatusCandidates = @(
    (Join-Path $ignitionProofRoot 'launcher-status.json'),
    (Join-Path $ignitionProofRoot 'support-snapshot.json')
  )

  foreach ($candidate in $childStatusCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    try {
      $candidateItem = Get-Item -LiteralPath $candidate -ErrorAction Stop
      $status = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8 | ConvertFrom-Json
      $statusRunId = if ($status.PSObject.Properties.Name -contains 'launcherRunId') { [string]$status.launcherRunId } else { '' }
      $statusLogRoot = if ($status.PSObject.Properties.Name -contains 'logRoot') { [string]$status.logRoot } else { '' }
      if ($statusRunId -and $statusRunId -ne $launcherRunId) { continue }
      if ($statusLogRoot -and $statusLogRoot -ne $launcherRunLogRoot) { continue }
      if ((-not $statusRunId) -and (-not $statusLogRoot) -and $candidateItem.LastWriteTimeUtc -lt $launcherRunStartedAt) { continue }
      foreach ($propertyName in @('blocker', 'blockers', 'failureReason', 'reason', 'nextSafeAction', 'operatorAction')) {
        if ($status.PSObject.Properties.Name -contains $propertyName -and $status.$propertyName) {
          $value = $status.$propertyName
          if ($value -is [array]) { $value = [string]::Join('; ', @($value | ForEach-Object { [string]$_ })) }
          $text = ([string]$value).Trim()
          if ($text) { return $text }
        }
      }
      if ($status.supportSnapshot -and $status.supportSnapshot.blocker) {
        return ([string]$status.supportSnapshot.blocker).Trim()
      }
    }
    catch {}
  }

  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { return '' }
  $logFiles = @(Get-ChildItem -LiteralPath $logRoot -File -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 8)
  foreach ($logFile in $logFiles) {
    try {
      $content = Get-Content -LiteralPath $logFile.FullName -Raw -Encoding UTF8
      foreach ($pattern in @(
        'blocked for safety: current branch has no upstream tracking branch[^\r\n]*',
        'Current branch has no upstream tracking branch[^\r\n]*',
        'reason:\s*missing-upstream[^\r\n]*',
        'missing-upstream[^\r\n]*'
      )) {
        $match = [regex]::Match($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) { return $match.Value.Trim() }
      }
    }
    catch {}
  }

  return ''
}

function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord) {
  $childBlocker = Get-LauncherChildBlocker
  $surfacedBlocker = if ($childBlocker) { $childBlocker } else { $Step }
  Write-IgnitionStatus -Phase 'blocked' -Message $surfacedBlocker -Extra @{ currentStage = 'blocked'; nextOperatorAction = 'Review the exact child blocker in launcher-status.json/support-snapshot and the bounded ignition logs, then resolve it before retrying.'; blocker = $surfacedBlocker; supportSnapshot = [ordered]@{ blocker = $surfacedBlocker; childBlocker = $childBlocker; parentFailure = $Step } }
  Write-Host "[LAUNCHER LIVE] Failed step: $surfacedBlocker" -ForegroundColor Red
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
  $stdoutLog = Join-Path $launcherRunLogRoot ("{0}.stdout.log" -f $safeLogName)
  $stderrLog = Join-Path $launcherRunLogRoot ("{0}.stderr.log" -f $safeLogName)
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
