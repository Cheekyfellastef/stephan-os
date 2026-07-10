[CmdletBinding()]
param(
  [switch]$AutoOpen,
  [ValidateSet('launcher-root','vite-dev')]
  [string]$Mode = 'launcher-root',
  [ValidateSet('launcher','runtime','cockpit')]
  [string]$BootMode = 'cockpit',
  [string]$RepositoryRoot = '',
  [string]$SharedWorkspace = '',
  [switch]$ReadinessReportOnly,
  [switch]$RepairMissingUi4173,
  [switch]$RepairDryRun
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
$backendMissionOperationsUrl = 'http://127.0.0.1:8787/api/mission-operations'
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

if ($ReadinessReportOnly.IsPresent) {
  Push-Location -LiteralPath $repoRoot
  try {
    if ($SharedWorkspace -and $SharedWorkspace.Trim()) {
      & node scripts/launcher-readiness-live-facts.mjs --report --json --shared-workspace $SharedWorkspace
    }
    else {
      & node scripts/launcher-readiness-live-facts.mjs --report --json
    }
    exit $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}


if ($RepairMissingUi4173.IsPresent) {
  Push-Location -LiteralPath $repoRoot
  try {
    $repairArgs = @('scripts/battle-bridge-ui-4173-repair.mjs', '--json')
    if ($SharedWorkspace -and $SharedWorkspace.Trim()) { $repairArgs += @('--shared-workspace', $SharedWorkspace) }
    if ($RepairDryRun.IsPresent) { $repairArgs += '--dry-run' } else { $repairArgs += '--start' }
    & node @repairArgs
    exit $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}

$ignitionStageModel = @(
  [ordered]@{ id = 'source-update'; label = 'Source update'; detail = 'Detect whether local main is behind origin/main; show pull progress/result and before/after commit.'; proofKind = 'pull' },
  [ordered]@{ id = 'build'; label = 'Build'; detail = 'Run canonical build and surface running/passed/failed plus runtime marker and git commit.'; proofKind = 'build' },
  [ordered]@{ id = 'verify'; label = 'Verify'; detail = 'Run canonical verify and surface running/passed/failed without treating it as served-browser proof.'; proofKind = 'verify' },
  [ordered]@{ id = 'restart'; label = 'Restart 4173'; detail = 'Show restart requested, server stopped, server started, and health probe result.'; proofKind = 'restart' },
  [ordered]@{ id = 'served-proof'; label = 'Served runtime proof'; detail = 'Require served runtime marker match and JavaScript module MIME proof before Enter Stephanos.'; proofKind = 'serve-proof' }
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
  $stageIds = @($ignitionStageModel | ForEach-Object { $_.id })
  $currentIndex = $stageIds.IndexOf($CurrentStageId)
  $ready = $CurrentStageId -eq 'ready'

  return @($ignitionStageModel | ForEach-Object {
    $stageIndex = $stageIds.IndexOf($_.id)
    $state = if ($ready) {
      'complete'
    }
    elseif ($_.id -eq $CurrentStageId) {
      'active'
    }
    elseif ($currentIndex -ge 0 -and $stageIndex -lt $currentIndex) {
      'complete'
    }
    else {
      'pending'
    }

    [ordered]@{
      id = $_.id
      label = $_.label
      detail = $_.detail
      state = $state
    }
  })
}

function Get-LatestOpenClawStartupStatus {
  $logRoot = Join-Path $ignitionProofRoot 'logs'
  if (-not (Test-Path -LiteralPath $logRoot)) { return $null }
  $logFiles = @(Get-ChildItem -LiteralPath $logRoot -File -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 8)
  foreach ($logFile in $logFiles) {
    try {
      $lines = @(Get-Content -LiteralPath $logFile.FullName -Encoding UTF8 -ErrorAction Stop)
      for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        $line = [string]$lines[$index]
        $packetMatch = [regex]::Match($line, '^\[IGNITION\]\s+openclaw-autostart-status=(\{.*\})\s*$')
        if ($packetMatch.Success) {
          try {
            $packet = $packetMatch.Groups[1].Value | ConvertFrom-Json
            return [ordered]@{
              state = if ($packet.state) { [string]$packet.state } else { 'reported' }
              detail = if ($packet.selectedReadinessEndpoint) { "endpoint $($packet.selectedReadinessEndpoint)" } elseif ($packet.reason) { [string]$packet.reason } else { 'OpenClaw autostart status packet observed.' }
              packet = $packet
              sourceLog = $logFile.FullName
            }
          }
          catch {}
        }
      }
    }
    catch {}
  }
  return $null
}

function Write-IgnitionStatus([string]$Phase, [string]$Message, [hashtable]$Extra = @{}) {
  Initialize-IgnitionProofWorkspace
  $currentStage = if ($Extra.ContainsKey('currentStage')) { $Extra.currentStage } else { $Phase }
  $latestOpenClawStartup = Get-LatestOpenClawStartupStatus
  $payload = [ordered]@{
    phase = $Phase
    message = $Message
    trafficLight = if ($Phase -eq 'ready') { 'green' } elseif ($Phase -eq 'blocked') { 'red' } elseif ($Phase -match 'pending|starting|splash') { 'blue' } else { 'amber' }
    progressPercentage = if ($currentStage -eq 'ready') { 100 } elseif ($currentStage -eq 'served-proof') { 85 } elseif ($currentStage -eq 'restart') { 70 } elseif ($currentStage -eq 'verify') { 55 } elseif ($currentStage -eq 'build') { 35 } elseif ($currentStage -eq 'source-update') { 15 } else { 5 }
    currentAction = $Message
    lastCompletedAction = if ($Extra.ContainsKey('lastCompletedAction')) { $Extra.lastCompletedAction } else { '' }
    proofSummary = if ($Extra.ContainsKey('proofSummary')) { $Extra.proofSummary } else { [ordered]@{ build = 'pending'; verify = 'pending'; pull = 'pending'; restart = 'pending'; servedRuntime = 'pending'; moduleMime = 'pending' } }
    enterStephanosEnabled = $Phase -eq 'ready'
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
    openClawStartupState = if ($latestOpenClawStartup) { $latestOpenClawStartup.state } else { 'pending' }
    openClawStartupDetail = if ($latestOpenClawStartup) { $latestOpenClawStartup.detail } else { 'Awaiting OpenClaw runtime detection/autostart proof.' }
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
  # Promoted Battle Bridge ignition supervisor surface: this existing splash is now the top-level readiness/status UI.
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
  $openClawStartupState = if ($Status.openClawStartupState) { [System.Net.WebUtility]::HtmlEncode($Status.openClawStartupState) } else { 'pending / not reported yet' }
  $openClawStartupDetail = if ($Status.openClawStartupDetail) { [System.Net.WebUtility]::HtmlEncode($Status.openClawStartupDetail) } else { 'Ignition will reuse a verified OpenClaw runtime or start approved local runtime surfaces only.' }
  $trafficLight = if ($Status.trafficLight) { [System.Net.WebUtility]::HtmlEncode($Status.trafficLight) } else { 'blue' }
  $progress = if ($Status.progressPercentage -ne $null) { [int]$Status.progressPercentage } else { 5 }
  $enterLabel = if ($Status.enterStephanosEnabled) { 'Enter Stephanos' } else { 'Enter Stephanos locked until served proof passes' }
  $proofCards = @('pull','build','verify','restart','servedRuntime','moduleMime') | ForEach-Object { "<div class='proof-card'><strong>$($_)</strong><br><span>$(if ($Status.proofSummary -and $Status.proofSummary.$_) { [System.Net.WebUtility]::HtmlEncode([string]$Status.proofSummary.$_) } else { 'pending' })</span></div>" }
  $proofCardsHtml = $proofCards -join "`n"
  $json = [System.Net.WebUtility]::HtmlEncode(($Status | ConvertTo-Json -Depth 10))
  $html = @"
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Stephanos Ignition Status</title>
<style>body{margin:0;background:#07111f;color:#e7f2ff;font-family:Segoe UI,Arial,sans-serif}main{max-width:1080px;margin:4vh auto;padding:32px;border:1px solid #1e4f7a;border-radius:18px;background:#0b1728}h1{margin-top:0}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#0e7a4f;color:#d8fff0;font-weight:700}.lights{display:flex;gap:8px;margin:14px 0}.light{width:18px;height:18px;border-radius:50%;background:#26384f;border:1px solid #5f7896}.light-green.active{background:#26d07c}.light-amber.active{background:#f5b942}.light-red.active{background:#ff5c5c}.light-blue.active{background:#4eb3ff}.progress{height:12px;background:#13243a;border-radius:999px;overflow:hidden}.bar{height:100%;background:linear-gradient(90deg,#4eb3ff,#26d07c)}.proof-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.proof-card{border:1px solid #254766;border-radius:12px;padding:10px;background:#0f2036}.muted{color:#a7bdd4}code,pre{background:#111f33;padding:2px 6px;border-radius:6px}.stage-grid{display:grid;gap:10px;margin:22px 0}.stage{padding:12px 14px;border:1px solid #254766;border-radius:12px;background:#0f2036}.stage strong{display:block;color:#f5fbff}.stage em{color:#9ed8ff}.stage-complete{border-color:#247a55}.stage-active{border-color:#4eb3ff;box-shadow:0 0 0 1px #4eb3ff}.blocker{border:1px solid #7a3b1e;background:#2b160f;color:#ffd9c8;padding:12px;border-radius:12px}.proof{display:grid;gap:6px}.raw{white-space:pre-wrap;max-height:280px;overflow:auto}</style>
<main>
  <span class="pill">$phase</span><div class="lights" aria-label="Traffic-light status"><span class="light light-green $(if ($trafficLight -eq 'green') { 'active' })"></span><span class="light light-amber $(if ($trafficLight -eq 'amber') { 'active' })"></span><span class="light light-red $(if ($trafficLight -eq 'red') { 'active' })"></span><span class="light light-blue $(if ($trafficLight -eq 'blue') { 'active' })"></span></div><div class="progress" aria-label="Ignition progress"><div class="bar" style="width:$progress%"></div></div>
  <h1>Stephanos is starting</h1>
  <p>$message</p>
  <p class="muted">Professional ignition is browser-first: detailed status, exact blockers, safe generated/runtime cleanup policy, and proof artifacts are visible before Stephanos opens.</p>
  <section aria-label="Detailed ignition stages" class="stage-grid">$stageHtml</section><section aria-label="Build verify pull restart serve proof cards" class="proof-cards">$proofCardsHtml</section><section aria-label="Enter Stephanos state" class="blocker"><strong>$enterLabel</strong></section>
  <section aria-label="OpenClaw startup status" class="blocker"><strong>OpenClaw startup:</strong> $openClawStartupState<br><strong>Detail:</strong> $openClawStartupDetail</section>
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
  Write-IgnitionStatus -Phase 'splash-shown' -Message 'Stephanos ignition splash/status screen is the primary UI.' -Extra @{ currentStage = 'source-update' }
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
  $logRoot = Join-Path $ignitionProofRoot 'logs'
  if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { return $null }

  $logFiles = @(Get-ChildItem -LiteralPath $logRoot -File -Filter '*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 8)

  foreach ($logFile in $logFiles) {
    try {
      $lines = @(Get-Content -LiteralPath $logFile.FullName -Encoding UTF8 -ErrorAction Stop)

      for ($index = $lines.Count - 1; $index -ge 0; $index--) {
        $line = [string]$lines[$index]

        $packetMatch = [regex]::Match($line, '^\[IGNITION\]\s+(source-update-status|repair-packet|source-merge-repair-packet|openclaw-autostart-status|openclaw-recovery-packet|recovery-packet)=(\{.*\})\s*$')
        if ($packetMatch.Success) {
          try {
            $packetType = $packetMatch.Groups[1].Value
            $packet = $packetMatch.Groups[2].Value | ConvertFrom-Json
            $status = if ($packet.ignitionStatus) { [string]$packet.ignitionStatus } else { '' }

            if ($status -eq 'BLOCKED') {
              $reason = if ($packet.reason) { [string]$packet.reason } else { $packetType }
              $nextAction = if ($packet.nextSafeAction) { [string]$packet.nextSafeAction } else { 'Review the child ignition repair packet and resolve the blocker before retrying.' }

              return [ordered]@{
                message = "blocked for safety: ${reason}. $nextAction"
                reason = $reason
                nextOperatorAction = $nextAction
                packetType = $packetType
                sourceLog = $logFile.FullName
                rawLine = $line
              }
            }
          }
          catch {}
        }

        foreach ($pattern in @(
          'blocked for safety: [^\r\n]*',
          'Current branch has no upstream tracking branch[^\r\n]*',
          'missing-upstream[^\r\n]*'
        )) {
          $textMatch = [regex]::Match($line, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
          if ($textMatch.Success) {
            return [ordered]@{
              message = $textMatch.Value.Trim()
              reason = 'child-ignition-blocker'
              nextOperatorAction = 'Review the child ignition blocker and resolve it before retrying.'
              packetType = 'child-log-text'
              sourceLog = $logFile.FullName
              rawLine = $line
            }
          }
        }
      }
    }
    catch {}
  }

  return $null
}
function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord) {
  $childBlocker = Get-LauncherChildBlocker
  $surfacedBlocker = if ($childBlocker -and $childBlocker.message) { [string]$childBlocker.message } else { $Step }
  $nextOperatorAction = if ($childBlocker -and $childBlocker.nextOperatorAction) { [string]$childBlocker.nextOperatorAction } else { 'Review the exact blocker in this launcher window and the bounded ignition logs, then resolve it before retrying.' }
  Write-IgnitionStatus -Phase 'blocked' -Message $surfacedBlocker -Extra @{ currentStage = 'blocked'; nextOperatorAction = $nextOperatorAction; blocker = $surfacedBlocker; parentFailure = $Step; childIgnitionBlocker = $childBlocker }
  Write-IgnitionSupportSnapshot -Verdict 'blocked' -Extra @{ blocker = $surfacedBlocker; nextOperatorAction = $nextOperatorAction; parentFailure = $Step; childIgnitionBlocker = $childBlocker }
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

function Test-BackendFreshness {
  $healthPass = Test-UrlReachable -Url $backendHealthUrl
  $missionPass = Test-UrlReachable -Url $backendMissionOperationsUrl
  $verdict = if ($healthPass -and $missionPass) { 'BACKEND_CURRENT' } elseif ($healthPass -and -not $missionPass) { 'BACKEND_STALE_ROUTE_MISSING' } else { 'BACKEND_STALE_RESTART_REQUIRED' }
  return [ordered]@{
    healthPass = $healthPass
    missionOperationsPass = $missionPass
    finalVerdict = $verdict
    backendCurrent = ($verdict -eq 'BACKEND_CURRENT')
    exactOperatorAction = if ($verdict -eq 'BACKEND_CURRENT') { '' } else { 'Stop only the allowlisted Stephanos backend process, then start it with: npm --prefix stephanos-server run dev' }
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

function Wait-ForUrl([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds = 120, [switch]$ObserveChildIgnitionBlocker) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-UrlReachable -Url $Url) {
      return
    }

    if ($ObserveChildIgnitionBlocker.IsPresent) {
      $childBlocker = Get-LauncherChildBlocker
      if ($childBlocker -and $childBlocker.message) {
        throw ([string]$childBlocker.message)
      }
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
    if ($StepLabel -eq 'backend') {
      $backendFreshness = Test-BackendFreshness
      if (-not $backendFreshness.backendCurrent) {
        Write-LiveLog "$StepLabel health is up but route freshness failed: $($backendFreshness.finalVerdict)"
        $stopped = Stop-AllowlistedStephanosBackendOnPort -Port 8787
        if ($stopped.Count -gt 0) {
          Write-LiveLog "stopped stale allowlisted Stephanos backend process ids on 8787: $([string]::Join(',', $stopped))"
        }
        else {
          throw "$($backendFreshness.finalVerdict): $($backendFreshness.exactOperatorAction)"
        }
      }
      else {
        Write-LiveLog "$StepLabel already responding with current route freshness; reusing existing process"
        return
      }
    }
    elseif ($ReuseProbeCommand) {
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

function Stop-AllowlistedStephanosBackendOnPort([int]$Port) {
  $connections = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) { return @() }
  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  $stopped = @()
  foreach ($processId in $processIds) {
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
      $commandLine = if ($process.CommandLine) { [string]$process.CommandLine } else { '' }
      if ($commandLine -match 'npm(\.cmd)?(\s|.*)--prefix\s+stephanos-server\s+run\s+dev' -or $commandLine -match 'stephanos-server.*run\s+dev') {
        Stop-Process -Id $processId -Force -ErrorAction Stop
        $stopped += $processId
      }
      else {
        Write-LiveLog "refusing to stop non-allowlisted process on backend port $Port (pid=$processId)"
      }
    }
    catch {
      Write-LiveLog "failed to verify/stop backend process on port $Port (pid=$processId): $($_.Exception.Message)"
    }
  }
  return $stopped
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
    openClawStartupState = if ($latestOpenClawStartup) { $latestOpenClawStartup.state } else { 'pending' }
    openClawStartupDetail = if ($latestOpenClawStartup) { $latestOpenClawStartup.detail } else { 'Awaiting OpenClaw runtime detection/autostart proof.' }
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
  Wait-ForUrl -StepLabel 'backend health' -Url $backendHealthUrl
  Wait-ForUrl -StepLabel 'backend mission operations freshness route' -Url $backendMissionOperationsUrl

  if ($Mode -eq 'vite-dev') {
    Write-LiveLog "waiting for vite-dev runtime at $viteDevUrl"
    Wait-ForUrl -StepLabel 'vite-dev ui' -Url $viteDevUrl
  }
  else {
    Write-LiveLog "waiting for launcher-root runtime-status endpoint at $launcherRuntimeStatusUrl"
    Wait-ForUrl -StepLabel 'launcher-root runtime-status endpoint' -Url $launcherRuntimeStatusUrl -ObserveChildIgnitionBlocker

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
  Write-IgnitionStatus -Phase 'ready' -Message 'Stephanos local server ready.' -Extra @{ currentStage = 'ready'; browserTargets = $browserTargets; visiblePowerShellWallRequired = $false; supportSnapshotPath = $ignitionSupportSnapshotPath; transcriptPath = $ignitionTranscriptPath }

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
