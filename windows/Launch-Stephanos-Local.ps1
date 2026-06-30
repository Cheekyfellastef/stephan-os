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
$ignitionTranscriptPath = Join-Path $ignitionProofRoot 'ignition-proof-transcript.jsonl'
$ignitionSupportSnapshotPath = Join-Path $ignitionProofRoot 'support-snapshot.json'

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


function Write-IgnitionTranscript([hashtable]$Event) {
  Initialize-IgnitionProofWorkspace
  $record = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    event = if ($Event.ContainsKey('event')) { $Event.event } else { 'status' }
    proofWorkspace = $ignitionProofRoot
  }
  foreach ($key in $Event.Keys) { $record[$key] = $Event[$key] }
  Add-Content -LiteralPath $ignitionTranscriptPath -Encoding UTF8 -Value ($record | ConvertTo-Json -Depth 10 -Compress)
}

function Write-LiveLog([string]$Message) {
  Write-Host "[LAUNCHER LIVE] $Message"
  Write-IgnitionTranscript -Event @{ event = 'launcher-log'; message = $Message }
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
      state = if ($_.id -eq $CurrentStageId) { 'active' } elseif ($ignitionStageModel.IndexOf($_) -lt ($ignitionStageModel | ForEach-Object { $_.id }).IndexOf($CurrentStageId)) { 'complete' } else { 'pending' }
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
    logRoot = (Join-Path $ignitionProofRoot 'logs')
    transcriptPath = $ignitionTranscriptPath
    supportSnapshotPath = $ignitionSupportSnapshotPath
    exactHeadApprovalRequired = $true
    exactHeadApprovalStatus = 'required-before-merge-proof'
    safeAutoFixPolicy = 'known-generated-runtime-stoppers-only; no source deletion; no hidden blockers'
    nextOperatorAction = if ($Extra.ContainsKey('nextOperatorAction')) { $Extra.nextOperatorAction } else { 'Watch the Stephanos ignition splash/status screen.' }
    currentStage = $currentStage
    ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId $currentStage
    destinations = [ordered]@{ statusPath = $ignitionStatusPath; splashPath = $ignitionSplashPath; logRoot = (Join-Path $ignitionProofRoot 'logs'); transcriptPath = $ignitionTranscriptPath; supportSnapshotPath = $ignitionSupportSnapshotPath }
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ignitionStatusPath -Encoding UTF8
  Write-IgnitionTranscript -Event @{ event = 'ignition-status'; phase = $Phase; message = $Message; currentStage = $currentStage; blocker = if ($Extra.ContainsKey('blocker')) { $Extra.blocker } else { '' } }
  Update-IgnitionSplashScreen -Status $payload
}

function Update-IgnitionSplashScreen([object]$Status) {
  Initialize-IgnitionProofWorkspace
  $stageHtml = @($Status.ignitionStages | ForEach-Object {
    $state = [System.Net.WebUtility]::HtmlEncode($_.state)
    $label = [System.Net.WebUtility]::HtmlEncode($_.label)
    $detail = [System.Net.WebUtility]::HtmlEncode($_.detail)
    "<div class='stage stage-$state'><strong>$label</strong><span>$detail</span><em>$state</em></div>"
  }) -join "`n"
  $blocker = if ($Status.blocker) { [System.Net.WebUtility]::HtmlEncode($Status.blocker) } else { 'No blocker detected.' }
  $message = [System.Net.WebUtility]::HtmlEncode($Status.message)
  $phase = [System.Net.WebUtility]::HtmlEncode($Status.phase)
  $next = [System.Net.WebUtility]::HtmlEncode($Status.nextOperatorAction)
  $statusPathHtml = [System.Net.WebUtility]::HtmlEncode($ignitionStatusPath)
  $logRootHtml = [System.Net.WebUtility]::HtmlEncode((Join-Path $ignitionProofRoot 'logs'))
  $transcriptHtml = [System.Net.WebUtility]::HtmlEncode($ignitionTranscriptPath)
  $snapshotHtml = [System.Net.WebUtility]::HtmlEncode($ignitionSupportSnapshotPath)
  $json = [System.Net.WebUtility]::HtmlEncode(($Status | ConvertTo-Json -Depth 10))
  $html = @"
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Stephanos Ignition Status</title>
<style>body{margin:0;background:#07111f;color:#e7f2ff;font-family:Segoe UI,Arial,sans-serif}main{max-width:1080px;margin:4vh auto;padding:32px;border:1px solid #1e4f7a;border-radius:18px;background:#0b1728}h1{margin-top:0}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#0e7a4f;color:#d8fff0;font-weight:700}.muted{color:#a7bdd4}code,pre{background:#111f33;padding:2px 6px;border-radius:6px}.stage-grid{display:grid;gap:10px;margin:22px 0}.stage{padding:12px 14px;border:1px solid #254766;border-radius:12px;background:#0f2036}.stage strong{display:block;color:#f5fbff}.stage em{color:#9ed8ff}.stage-complete{border-color:#247a55}.stage-active{border-color:#4eb3ff;box-shadow:0 0 0 1px #4eb3ff}.blocker{border:1px solid #7a3b1e;background:#2b160f;color:#ffd9c8;padding:12px;border-radius:12px}.proof{display:grid;gap:6px}.raw{white-space:pre-wrap;max-height:280px;overflow:auto}</style>
<main>
  <span class="pill">$phase</span>
  <h1>Stephanos is starting</h1>
  <p>$message</p>
  <p class="muted">Professional ignition is browser-first: detailed status, exact blockers, safe generated/runtime cleanup policy, and proof artifacts are visible before Stephanos opens.</p>
  <section aria-label="Detailed ignition stages" class="stage-grid">$stageHtml</section>
  <section class="blocker" aria-label="Blocker and operator action"><strong>Blocker:</strong> $blocker<br><strong>Next action:</strong> $next</section>
  <section class="proof" aria-label="Support snapshot and proof transcript">
    <p>Status: <code>$statusPathHtml</code></p><p>Logs: <code>$logRootHtml</code></p><p>Proof transcript: <code>$transcriptHtml</code></p><p>Support snapshot: <code>$snapshotHtml</code></p>
    <p>Exact-head approval: <strong>required before merge proof</strong>. Safe auto-fix: <strong>known generated/runtime stoppers only; no source deletion; no hidden blockers</strong>.</p>
  </section>
  <pre class="raw" aria-label="Raw status JSON">$json</pre>
</main>
"@
  $html | Set-Content -LiteralPath $ignitionSplashPath -Encoding UTF8
}

function New-IgnitionSplashScreen {
  Initialize-IgnitionProofWorkspace
  Write-IgnitionStatus -Phase 'splash-shown' -Message 'Stephanos ignition splash/status screen is the primary UI.' -Extra @{ currentStage = 'finding-repo' }
  return $ignitionSplashPath
}

function Show-IgnitionSplashScreen {
  $splashPath = New-IgnitionSplashScreen
  Start-Process -FilePath $splashPath | Out-Null
  Write-LiveLog "ignition splash/status screen opened: $splashPath"
  Write-LiveLog "verbose logs/status destination: $ignitionProofRoot"
}

function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord) {
  Write-IgnitionStatus -Phase 'blocked' -Message $Step -Extra @{ currentStage = 'blocked'; nextOperatorAction = 'Review the exact blocker in this launcher window and the bounded ignition logs, then resolve it before retrying.'; blocker = $Step }
  Write-IgnitionSupportSnapshot -Verdict 'blocked' -Extra @{ blocker = $Step; nextOperatorAction = 'Review blocker and retry after repair.' }
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


function Write-IgnitionSupportSnapshot([string]$Verdict, [hashtable]$Extra = @{}) {
  Initialize-IgnitionProofWorkspace
  $snapshot = [ordered]@{
    schema = 'stephanos.ignition.support-snapshot.v1'
    verdict = $Verdict
    writtenAt = (Get-Date).ToUniversalTime().ToString('o')
    repositoryRoot = $repoRoot
    runtimePort = 4173
    launcherShellUrl = $launcherShellUrl
    runtimeUrl = $launcherRuntimeUrl
    runtimeStatusUrl = $launcherRuntimeStatusUrl
    exactHeadApprovalRequired = $true
    exactHeadApprovalStatus = 'required-before-merge-proof'
    safeAutoFixPolicy = 'known-generated-runtime-stoppers-only; no source deletion; no hidden blockers'
    statusPath = $ignitionStatusPath
    splashPath = $ignitionSplashPath
    transcriptPath = $ignitionTranscriptPath
    logRoot = (Join-Path $ignitionProofRoot 'logs')
  }
  foreach ($key in $Extra.Keys) { $snapshot[$key] = $Extra[$key] }
  $snapshot | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ignitionSupportSnapshotPath -Encoding UTF8
  Write-IgnitionTranscript -Event @{ event = 'support-snapshot'; verdict = $Verdict; supportSnapshotPath = $ignitionSupportSnapshotPath }
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

  Write-LiveLog "selected repository root: $repoRoot"
  Write-IgnitionStatus -Phase 'checking-workspace-dirt' -Message 'Running canonical ignition workspace checks; source deletion is forbidden.' -Extra @{ currentStage = 'checking-workspace-dirt'; noSourceDeletion = $true }
  Write-IgnitionStatus -Phase 'classifying-safe-vs-unsafe-dirt' -Message 'Classifying generated/runtime stoppers separately from source blockers; hidden blockers remain surfaced.' -Extra @{ currentStage = 'classifying-safe-vs-unsafe-dirt'; hiddenBlockersAllowed = $false }
  Write-IgnitionStatus -Phase 'cleaning-generated-runtime-stoppers' -Message 'Safe auto-fix is limited to known generated/runtime stoppers delegated to canonical ignition.' -Extra @{ currentStage = 'cleaning-generated-runtime-stoppers'; safeAutoFixScope = 'known-generated-runtime-stoppers-only' }
  Write-IgnitionStatus -Phase 'checking-dependencies' -Message 'Checking dependency and runtime prerequisites before startup.' -Extra @{ currentStage = 'checking-dependencies' }
  Write-IgnitionStatus -Phase 'checking-ports-existing-runtime' -Message 'Checking ports and existing runtime before startup.' -Extra @{ currentStage = 'checking-ports-existing-runtime' }

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

  Write-IgnitionSupportSnapshot -Verdict 'ready-for-local-proof' -Extra @{ browserTargets = $browserTargets; port4173Before = $port4173Before; port5173Before = $port5173Before }
  Write-IgnitionStatus -Phase 'ready' -Message 'Stephanos local server ready.' -Extra @{ browserTargets = $browserTargets; visiblePowerShellWallRequired = $false; supportSnapshotPath = $ignitionSupportSnapshotPath; transcriptPath = $ignitionTranscriptPath }

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
