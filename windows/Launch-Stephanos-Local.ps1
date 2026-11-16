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
$openClawControlUrl = 'http://127.0.0.1:18789/'
$viteDevUrl = 'http://localhost:5173/'
$launcherRootCommand = 'powershell.exe -ExecutionPolicy Bypass -File .\windows\Invoke-Stephanos-Ignite-With-Approval.ps1 -RepositoryRoot .'
$launcherRootCanonicalCommand = 'npm run stephanos:ignite'
$visiblePowerShellRequired = $false
$canonicalSharedWorkspaceRoot = if ($SharedWorkspace -and $SharedWorkspace.Trim()) { $SharedWorkspace.Trim() } elseif ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) { $env:STEPHANOS_SHARED_WORKSPACE.Trim() } elseif ($env:STEPHANOS_OPENCLAW_WORKSPACE -and $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()) { $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim() } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace' }
$battleBridgeSupervisorCurrentPath = Join-Path $canonicalSharedWorkspaceRoot 'status/battle-bridge-ignition-supervisor-current.json'
$script:ignitionRunStartedAtUtc = (Get-Date).ToUniversalTime()
$script:ignitionHelperProcess = $null
$script:supervisorRecordFreshnessSkewSeconds = 2
$ignitionProofRoot = $canonicalSharedWorkspaceRoot
$ignitionStatusPath = Join-Path $ignitionProofRoot 'launcher-status.json'
$ignitionSplashPath = Join-Path $ignitionProofRoot 'ignition-status.html'
$ignitionTranscriptPath = Join-Path $ignitionProofRoot 'ignition-proof-transcript.jsonl'
$ignitionSupportSnapshotPath = Join-Path $ignitionProofRoot 'support-snapshot.json'
$ignitionBrowserSurfaceRoot = Join-Path $ignitionProofRoot 'browser-surfaces'
$ignitionBrowserSurfaceReceiptPath = Join-Path $ignitionProofRoot 'status/ignition-browser-surfaces-current.json'
$script:browserSurfaceReceipts = @()
$script:ignitionAdmittedSourceHead = ''

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
    if ($RepairDryRun.IsPresent) {
      $repairArgs += '--dry-run'
    }
    else {
      $sourceTruthJson = (& node scripts/battle-bridge-ignition-supervisor.mjs --source-truth-json | Out-String).Trim()
      if ($LASTEXITCODE -ne 0 -or -not $sourceTruthJson) { throw 'Canonical Battle Bridge source truth could not be proven for UI repair.' }
      $sourceTruth = $sourceTruthJson | ConvertFrom-Json
      if ($sourceTruth.ok -ne $true -or [string]$sourceTruth.head -notmatch '^[0-9a-f]{40}$') { throw 'Canonical Battle Bridge source head is invalid for UI repair.' }
      $repairArgs += @('--start', '--expected-head', [string]$sourceTruth.head)
    }
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
  Add-IgnitionUtf8NoBomLine -Path $ignitionTranscriptPath -Value ($record | ConvertTo-Json -Depth 10 -Compress)
}

function Write-LiveLog([string]$Message) {
  Write-Host "[LAUNCHER LIVE] $Message"
  Write-IgnitionTranscript -Event @{ event = 'launcher-log'; message = $Message }
}

function Initialize-IgnitionProofWorkspace {
  New-Item -ItemType Directory -Force -Path $ignitionProofRoot | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ignitionProofRoot 'logs') | Out-Null
}

function Write-IgnitionUtf8NoBomText([string]$Path, [string]$Value) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Add-IgnitionUtf8NoBomLine([string]$Path, [string]$Value) {
  $parent = Split-Path -Parent $Path
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::AppendAllText($Path, "$Value$([Environment]::NewLine)", $encoding)
}

function Write-IgnitionJson([string]$Path, [object]$Value, [int]$Depth = 10) {
  Write-IgnitionUtf8NoBomText -Path $Path -Value ($Value | ConvertTo-Json -Depth $Depth)
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


function Get-BattleBridgeSupervisorCurrentRecord {
  $supervisorCurrentPath = $battleBridgeSupervisorCurrentPath
  if (-not (Test-Path -LiteralPath $supervisorCurrentPath -PathType Leaf)) { return $null }
  try {
    $statusFile = Get-Item -LiteralPath $supervisorCurrentPath -ErrorAction Stop
    $freshnessBoundaryUtc = $script:ignitionRunStartedAtUtc.AddSeconds(-1 * $script:supervisorRecordFreshnessSkewSeconds)
    if ($statusFile.LastWriteTimeUtc -lt $freshnessBoundaryUtc) { return $null }

    $record = Get-Content -LiteralPath $supervisorCurrentPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $generatedAtUtc = [DateTimeOffset]::MinValue
    if (-not $record.generatedAt -or -not [DateTimeOffset]::TryParse([string]$record.generatedAt, [ref]$generatedAtUtc)) { return $null }
    if ($generatedAtUtc.UtcDateTime -lt $freshnessBoundaryUtc) { return $null }
    return $record
  }
  catch {
    return $null
  }
}

function Convert-SupervisorRecordToIgnitionStatus([object]$SupervisorRecord, [string]$FallbackPhase, [string]$FallbackMessage) {
  if (-not $SupervisorRecord) { return $null }
  $phase = if ($SupervisorRecord.currentPhase) { [string]$SupervisorRecord.currentPhase } else { $FallbackPhase }
  $message = if ($SupervisorRecord.blockerId) { "Battle Bridge ignition blocked: $($SupervisorRecord.blockerId)" } elseif ($SupervisorRecord.trafficLight -eq 'green') { 'Battle Bridge ignition supervisor reports READY.' } else { $FallbackMessage }
  $stage = if ($SupervisorRecord.trafficLight -eq 'green') { 'ready' } elseif ($SupervisorRecord.blockerId) { 'blocked' } else { $phase }
  return [ordered]@{
    phase = if ($SupervisorRecord.blockerId) { 'blocked' } elseif ($SupervisorRecord.trafficLight -eq 'green') { 'ready' } else { $phase }
    message = $message
    trafficLight = if ($SupervisorRecord.trafficLight) { [string]$SupervisorRecord.trafficLight } else { 'blue' }
    progressPercentage = if ($SupervisorRecord.trafficLight -eq 'green') { 100 } elseif ($SupervisorRecord.blockerId) { 100 } else { 65 }
    currentAction = $message
    lastCompletedAction = ''
    proofSummary = [ordered]@{ build = 'supervisor-truth'; verify = 'supervisor-truth'; pull = 'supervisor-truth'; restart = 'supervisor-truth'; servedRuntime = if ($SupervisorRecord.services.stephanosUi4173.servedRuntimeProof.ready) { 'exact-head-ready' } else { 'pending-or-blocked' }; moduleMime = 'supervisor-truth' }
    enterStephanosEnabled = $SupervisorRecord.trafficLight -eq 'green'
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    visiblePowerShellRequired = $visiblePowerShellRequired
    primaryUi = 'splash-status-browser'
    splashPath = $ignitionSplashPath
    statusPath = $ignitionStatusPath
    logRoot = (Join-Path $ignitionProofRoot 'logs')
    transcriptPath = $ignitionTranscriptPath
    supportSnapshotPath = $ignitionSupportSnapshotPath
    browserSurfaceReceiptPath = $ignitionBrowserSurfaceReceiptPath
    browserSurfaceReceipts = @($script:browserSurfaceReceipts)
    exactHeadApprovalRequired = $true
    exactHeadApprovalStatus = 'required-before-merge-proof'
    safeAutoFixPolicy = 'known-generated-runtime-stoppers-only; no source deletion; no hidden blockers'
    openClawStartupState = if ($SupervisorRecord.services.openClaw18789.ready) { 'ready' } else { 'degraded' }
    openClawStartupDetail = if ($SupervisorRecord.services.openClaw18789.ready) { 'OpenClaw is connected.' } else { 'OpenClaw is optional for Stephanos ignition and may recover/rejoin after startup.' }
    nextOperatorAction = if ($SupervisorRecord.nextOperatorAction) { [string]$SupervisorRecord.nextOperatorAction } else { 'Watch the Battle Bridge ignition supervisor surface.' }
    currentStage = $stage
    ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId $stage
    blocker = if ($SupervisorRecord.blockerId) { [string]$SupervisorRecord.blockerId } else { '' }
    battleBridgeSupervisorCurrentPath = $battleBridgeSupervisorCurrentPath
    battleBridgeSupervisor = $SupervisorRecord
    destinations = [ordered]@{ statusPath = $ignitionStatusPath; splashPath = $ignitionSplashPath; logRoot = (Join-Path $ignitionProofRoot 'logs'); transcriptPath = $ignitionTranscriptPath; supportSnapshotPath = $ignitionSupportSnapshotPath }
  }
}

function Test-IgnitionBrowserReceiptSet([object[]]$Surfaces, [object[]]$Receipts, [datetime]$RunStartedAtUtc, [object]$CurrentObservation) {
  $selected = @($Surfaces)
  $records = @($Receipts | Where-Object { $_.id -ne 'splash' })
  if ($selected.Count -eq 0 -or $records.Count -ne $selected.Count -or @($selected.Id | Select-Object -Unique).Count -ne $selected.Count) { return $false }
  $current = @($CurrentObservation.surfaces)
  $captureStarted = [DateTimeOffset]::MinValue
  $captureCompleted = [DateTimeOffset]::MinValue
  if (-not $CurrentObservation -or $CurrentObservation.schemaVersion -cne 'stephanos.ignition-browser-final-observation.v1' -or $current.Count -ne $selected.Count -or
      -not [DateTimeOffset]::TryParse([string]$CurrentObservation.startedAtUtc, [ref]$captureStarted) -or
      -not [DateTimeOffset]::TryParse([string]$CurrentObservation.completedAtUtc, [ref]$captureCompleted) -or
      $captureStarted.UtcDateTime -lt $RunStartedAtUtc -or $captureCompleted -lt $captureStarted -or $captureCompleted.UtcDateTime -gt [datetime]::UtcNow -or
      ($captureCompleted - $captureStarted).TotalMilliseconds -gt 15000 -or
      ($CurrentObservation.elapsedMilliseconds -isnot [long] -and $CurrentObservation.elapsedMilliseconds -isnot [int]) -or
      $CurrentObservation.elapsedMilliseconds -lt 0 -or $CurrentObservation.elapsedMilliseconds -gt 15000 -or
      [string]::IsNullOrWhiteSpace([string]$CurrentObservation.edgeExecutable)) { return $false }
  foreach ($surface in $selected) {
    $matching = @($records | Where-Object { $_.id -ceq $surface.Id })
    if ($matching.Count -ne 1) { return $false }
    $record = $matching[0]
    $verified = [DateTimeOffset]::MinValue
    $birth = [DateTimeOffset]::MinValue
    try {
      if ($record.url -cne $surface.Url -or $record.expectedTitle -cne $surface.ExpectedTitle -or $record.profilePath -cne $surface.ProfilePath -or [int]$record.pid -le 0 -or [int64]$record.windowHandle -le 0) { return $false }
      if (-not [DateTimeOffset]::TryParse([string]$record.verifiedAt, [ref]$verified) -or -not [DateTimeOffset]::TryParse([string]$record.processStartTimeUtc, [ref]$birth) -or $verified.UtcDateTime -lt $RunStartedAtUtc -or $verified.UtcDateTime -gt [datetime]::UtcNow -or $birth -gt $verified) { return $false }
      $titleMatches = [string]$record.windowTitle -ceq [string]$surface.ExpectedTitle -or ($surface.UseBrowserWindow -and [string]$record.windowTitle -match ('^' + [regex]::Escape($surface.ExpectedTitle) + ' - (?:[^\r\n]+ - )?Microsoft\p{Cf}* Edge$'))
      if (-not $titleMatches) { return $false }
      $observed = @($current | Where-Object { $_.id -ceq $surface.Id })
      if ($observed.Count -ne 1) { return $false }
      $live = $observed[0]
      $observedAt = [DateTimeOffset]::MinValue
      $currentBirth = [DateTimeOffset]::MinValue
      if ($live.url -cne $surface.Url -or $live.profilePath -cne $surface.ProfilePath -or $live.expectedTitle -cne $surface.ExpectedTitle -or
          -not [string]::Equals([string]$live.executablePath, [string]$CurrentObservation.edgeExecutable, [StringComparison]::OrdinalIgnoreCase) -or
          [int]$live.pid -ne [int]$record.pid -or [int]$live.ownerProcessId -ne [int]$record.pid -or
          [int64]$live.windowHandle -ne [int64]$record.windowHandle -or $live.windowTitle -cne $record.windowTitle -or
          -not [DateTimeOffset]::TryParse([string]$live.processStartTimeUtc, [ref]$currentBirth) -or $currentBirth -ne $birth -or
          -not [DateTimeOffset]::TryParse([string]$live.observedAtUtc, [ref]$observedAt) -or $observedAt -lt $captureStarted -or $observedAt -gt $captureCompleted) { return $false }
    } catch { return $false }
  }
  return $true
}

function Resolve-IgnitionStatusProjection([string]$LaunchMode, [string]$Phase, [string]$Message, [hashtable]$Extra, [object]$SupervisorRecord, [string]$ExpectedHead, [object]$LatestOpenClawStartup, [object[]]$RequestedBrowserSurfaces, [object[]]$BrowserReceipts, [bool]$AutoOpenEnabled, [datetime]$RunStartedAtUtc, [object]$CurrentBrowserObservation) {
  $supervisorStatus = if ($LaunchMode -eq 'launcher-root') { Convert-SupervisorRecordToIgnitionStatus -SupervisorRecord $SupervisorRecord -FallbackPhase $Phase -FallbackMessage $Message } else { $null }
  $details = @{}
  foreach ($key in $Extra.Keys) { $details[$key] = $Extra[$key] }
  # Services and requested browser completion jointly determine desktop readiness.
  if ($Phase -notin @('blocked','restart-required','fixed-runtime-installation') -and $supervisorStatus -and $supervisorStatus.phase -eq 'blocked') {
    $Phase = 'blocked'
    $Message = $supervisorStatus.message
    $details.currentStage = 'blocked'
    $details.blocker = $supervisorStatus.blocker
    $details.nextOperatorAction = $supervisorStatus.nextOperatorAction
  }
  elseif ($LaunchMode -eq 'launcher-root' -and $Phase -eq 'ready' -and -not (Test-BattleBridgeSupervisorFinalContract -SupervisorRecord $SupervisorRecord -ExpectedHead $ExpectedHead)) {
    $Phase = 'blocked'
    $Message = 'Desktop Ignition requires current exact-head service proof after opening its browser surfaces.'
    $details.currentStage = 'blocked'
    $details.blocker = 'desktop-ignition-service-proof-unproven'
    $details.nextOperatorAction = 'Restore the canonical current-head supervisor service proof, then retry Ignition.'
  }
  elseif ($LaunchMode -eq 'launcher-root' -and $Phase -eq 'ready' -and (-not $AutoOpenEnabled -or -not (Test-IgnitionBrowserReceiptSet -Surfaces $RequestedBrowserSurfaces -Receipts $BrowserReceipts -RunStartedAtUtc $RunStartedAtUtc -CurrentObservation $CurrentBrowserObservation))) {
    $Phase = 'blocked'
    $Message = 'Desktop Ignition has not verified every requested browser window.'
    $details.currentStage = 'blocked'
    $details.blocker = 'desktop-ignition-browser-proof-unproven'
    $details.nextOperatorAction = 'Keep the requested browser surfaces available and retry Ignition to obtain their verified window receipts.'
  }
  $Extra = $details
  $currentStage = if ($Extra.ContainsKey('currentStage')) { $Extra.currentStage } else { $Phase }
  if ($Phase -eq 'blocked' -or ($Phase -ne 'ready' -and $currentStage -eq 'ready')) { $currentStage = $Phase }
  $payload = [ordered]@{
    phase = $Phase
    message = $Message
    trafficLight = if ($Phase -eq 'ready') { 'green' } elseif ($Phase -eq 'blocked') { 'red' } elseif ($Phase -match 'pending|starting|splash') { 'blue' } else { 'amber' }
    progressPercentage = if ($currentStage -eq 'ready') { 100 } elseif ($currentStage -eq 'served-proof') { 85 } elseif ($currentStage -eq 'restart') { 70 } elseif ($currentStage -eq 'verify') { 55 } elseif ($currentStage -eq 'build') { 35 } elseif ($currentStage -eq 'source-update') { 15 } else { 5 }
    currentAction = $Message
    lastCompletedAction = if ($Extra.ContainsKey('lastCompletedAction')) { $Extra.lastCompletedAction } else { '' }
    proofSummary = if ($supervisorStatus) { $supervisorStatus.proofSummary } else { [ordered]@{ build = 'pending'; verify = 'pending'; pull = 'pending'; restart = 'pending'; servedRuntime = 'pending'; moduleMime = 'pending' } }
    enterStephanosEnabled = $Phase -eq 'ready'
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    visiblePowerShellRequired = $visiblePowerShellRequired
    primaryUi = 'splash-status-browser'
    splashPath = $ignitionSplashPath
    statusPath = $ignitionStatusPath
    logRoot = (Join-Path $ignitionProofRoot 'logs')
    transcriptPath = $ignitionTranscriptPath
    supportSnapshotPath = $ignitionSupportSnapshotPath
    browserSurfaceReceiptPath = $ignitionBrowserSurfaceReceiptPath
    browserSurfaceReceipts = @($BrowserReceipts)
    currentBrowserObservation = $CurrentBrowserObservation
    browserTargets = @($RequestedBrowserSurfaces | ForEach-Object { $_.Url })
    browserAutoOpenEnabled = $AutoOpenEnabled
    browserProofScope = if ($LaunchMode -eq 'launcher-root' -and $Phase -eq 'ready') { 'verified-selected-windows' } elseif ($LaunchMode -eq 'launcher-root') { 'selected-windows-unproven' } elseif ($AutoOpenEnabled) { 'vite-browser-request-unverified' } else { 'vite-manual-open' }
    exactHeadApprovalRequired = $true
    exactHeadApprovalStatus = 'required-before-merge-proof'
    safeAutoFixPolicy = 'known-generated-runtime-stoppers-only; no source deletion; no hidden blockers'
    openClawStartupState = if ($supervisorStatus) { $supervisorStatus.openClawStartupState } elseif ($LatestOpenClawStartup) { $LatestOpenClawStartup.state } else { 'pending' }
    openClawStartupDetail = if ($supervisorStatus) { $supervisorStatus.openClawStartupDetail } elseif ($LatestOpenClawStartup) { $LatestOpenClawStartup.detail } else { 'Awaiting OpenClaw runtime detection/autostart proof.' }
    nextOperatorAction = if ($Extra.ContainsKey('nextOperatorAction')) { $Extra.nextOperatorAction } else { 'Watch the Stephanos ignition splash/status screen.' }
    currentStage = $currentStage
    ignitionStages = Get-IgnitionStageSnapshot -CurrentStageId $currentStage
    blocker = if ($Extra.ContainsKey('blocker')) { $Extra.blocker } else { '' }
    battleBridgeSupervisorCurrentPath = $battleBridgeSupervisorCurrentPath
    battleBridgeSupervisor = if ($supervisorStatus) { $supervisorStatus.battleBridgeSupervisor } else { $null }
    destinations = [ordered]@{ statusPath = $ignitionStatusPath; splashPath = $ignitionSplashPath; logRoot = (Join-Path $ignitionProofRoot 'logs'); transcriptPath = $ignitionTranscriptPath; supportSnapshotPath = $ignitionSupportSnapshotPath }
  }
  foreach ($key in $Extra.Keys) {
    if ($key -notin @('phase','message','trafficLight','progressPercentage','enterStephanosEnabled','currentStage','blocker','nextOperatorAction','proofSummary','battleBridgeSupervisor','battleBridgeSupervisorCurrentPath','browserTargets','browserSurfaceReceipts','browserAutoOpenEnabled','browserProofScope','currentBrowserObservation')) { $payload[$key] = $Extra[$key] }
  }
  return $payload
}

function Get-IgnitionStatusProjection([string]$Phase, [string]$Message, [hashtable]$Extra = @{}) {
  $capture = $null
  $captureClock = $null
  $currentObservation = $null
  try {
    $finalDesktop = $Mode -eq 'launcher-root' -and $Phase -eq 'ready'
    if ($finalDesktop) { $captureClock = New-IgnitionBrowserObservationClock; $captureStartedAt = [datetime]::UtcNow }
    $supervisorRecord = if ($Mode -eq 'launcher-root') { Get-BattleBridgeSupervisorCurrentRecord } else { $null }
    $expectedHead = if ($finalDesktop) { Get-RepositoryHeadForSupervisorProof } else { '' }
    $latestOpenClawStartup = Get-LatestOpenClawStartupStatus
    if ($Mode -eq 'launcher-root' -and $Phase -eq 'ready') {
      $beforeSupervisorRecord = $supervisorRecord
      $capture = Get-IgnitionBrowserObservationSet -Surfaces @($browserSurfaces) -ObservationClock $captureClock -StartedAtUtc $captureStartedAt
      # A file reread preserves the original supervisor proof identity; it is not a new health probe.
      $afterHead = Get-RepositoryHeadForSupervisorProof
      $supervisorRecord = Get-BattleBridgeSupervisorCurrentRecord
      $admittedHead = $script:ignitionAdmittedSourceHead
      if ($expectedHead -cne $afterHead -or $expectedHead -cne $admittedHead -or
          -not (Test-BattleBridgeSupervisorFinalContract -SupervisorRecord $beforeSupervisorRecord -ExpectedHead $admittedHead)) { $expectedHead = '' }
      $currentObservation = $capture.observation
      $currentObservation.admittedSourceHead = $admittedHead
      $currentObservation.supervisorGeneratedAtBefore = [string]$beforeSupervisorRecord.generatedAt
      $currentObservation.supervisorGeneratedAtAfter = [string]$supervisorRecord.generatedAt
      foreach ($capability in $capture.capabilities) {
        if ($capability.HasExited) { $currentObservation.surfaces = @(); break }
      }
      $currentObservation.completedAtUtc = [datetime]::UtcNow.ToString('o')
      $currentObservation.elapsedMilliseconds = $captureClock.ElapsedMilliseconds
      if ($currentObservation.elapsedMilliseconds -gt 15000) { $currentObservation.surfaces = @() }
    }
    return Resolve-IgnitionStatusProjection -LaunchMode $Mode -Phase $Phase -Message $Message -Extra $Extra -SupervisorRecord $supervisorRecord -ExpectedHead $expectedHead -LatestOpenClawStartup $latestOpenClawStartup -RequestedBrowserSurfaces @($browserSurfaces) -BrowserReceipts @($script:browserSurfaceReceipts) -AutoOpenEnabled ([bool]$autoOpenEnabled) -RunStartedAtUtc $script:ignitionRunStartedAtUtc -CurrentBrowserObservation $currentObservation
  }
  finally {
    if ($capture) { foreach ($capability in $capture.capabilities) { $capability.Dispose() } }
    if ($captureClock) { $captureClock.Stop() }
  }
}

function Publish-IgnitionStatusProjection([System.Collections.IDictionary]$Outcome) {
  Initialize-IgnitionProofWorkspace
  Write-IgnitionJson -Path $ignitionStatusPath -Value $Outcome -Depth 12
  Write-IgnitionTranscript -Event @{ event = 'ignition-status'; phase = $Outcome.phase; message = $Outcome.message; currentStage = $Outcome.currentStage; blocker = $Outcome.blocker }
  Update-IgnitionSplashScreen -Status $Outcome
}

function Write-IgnitionStatus([string]$Phase, [string]$Message, [hashtable]$Extra = @{}) {
  Publish-IgnitionStatusProjection -Outcome (Get-IgnitionStatusProjection -Phase $Phase -Message $Message -Extra $Extra)
}

function Publish-IgnitionTerminalOutcome([System.Collections.IDictionary]$Outcome) {
  Publish-IgnitionStatusProjection -Outcome $Outcome
  $verdict = if ($Outcome.phase -eq 'ready') { 'ready-for-local-proof' } else { 'blocked' }
  Write-IgnitionSupportSnapshot -Verdict $verdict -Outcome $Outcome
}

function Complete-IgnitionLaunch([hashtable]$Extra = @{}) {
  $outcome = Get-IgnitionStatusProjection -Phase 'ready' -Message 'Stephanos local server ready.' -Extra $Extra
  if ($outcome.phase -ne 'ready') { Fail-Step -Step $outcome.message -Outcome $outcome; return }
  Publish-IgnitionTerminalOutcome -Outcome $outcome
  Write-Host 'Stephanos local server ready' -ForegroundColor Green
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
  <section aria-label="OpenClaw startup status" class="blocker"><strong>OpenClaw startup (optional):</strong> $openClawStartupState<br><strong>Detail:</strong> $openClawStartupDetail</section>
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

function Resolve-StephanosEdgeExecutable {
  $candidates = @()
  foreach ($programRoot in @(${env:ProgramFiles(x86)}, $env:ProgramFiles, $env:LOCALAPPDATA)) {
    if ($programRoot) {
      $candidates += (Join-Path $programRoot 'Microsoft\Edge\Application\msedge.exe')
    }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }
  return $null
}

function Get-StephanosBrowserSurfaceDefinition([string]$Id, [string]$Label, [string]$Url, [string]$ExpectedTitle) {
  if ($Id -notin @('splash','launcher','runtime','openclaw')) { throw "Unsupported browser surface id '$Id'." }
  # These local application pages render in normal Edge windows even when app mode stalls at the address.
  $useBrowserWindow = $Id -ne 'splash'
  $profileName = if ($useBrowserWindow) { "$Id-browser" } else { $Id }
  $profilePath = Join-Path $ignitionBrowserSurfaceRoot $profileName
  return [ordered]@{
    Id = $Id
    Label = $Label
    Url = $Url
    ExpectedTitle = $ExpectedTitle
    UseBrowserWindow = $useBrowserWindow
    ProfilePath = [System.IO.Path]::GetFullPath($profilePath)
    MutexName = "Local\Stephanos-Ignition-Browser-Surface-$Id"
  }
}

function Initialize-StephanosWindowProbe {
  if ('StephanosIgnitionWindowProbe' -as [type]) { return }

  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class StephanosIgnitionWindowProbe
{
    public sealed class WindowRecord
    {
        public long Handle { get; set; }
        public string Title { get; set; }
        public int ProcessId { get; set; }
    }

    private delegate bool EnumWindowsCallback(IntPtr windowHandle, IntPtr state);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr windowHandle, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr windowHandle, StringBuilder title, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr windowHandle);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CommandLineToArgvW(string commandLine, out int argumentCount);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string[] GetCommandLineArguments(string commandLine)
    {
        if (String.IsNullOrEmpty(commandLine) || commandLine.Length > 32768) return new string[0];
        int count;
        IntPtr arguments = CommandLineToArgvW(commandLine, out count);
        if (arguments == IntPtr.Zero) return new string[0];
        try
        {
            if (count < 1 || count > 256) return new string[0];
            var result = new string[count];
            for (int index = 0; index < count; index++) result[index] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(arguments, index * IntPtr.Size));
            return result;
        }
        finally { LocalFree(arguments); }
    }

    public static WindowRecord[] GetVisibleTopLevelWindows(int expectedProcessId)
    {
        var windows = new List<WindowRecord>();
        EnumWindows(delegate(IntPtr windowHandle, IntPtr state)
        {
            uint processId;
            GetWindowThreadProcessId(windowHandle, out processId);
            if (processId != (uint)expectedProcessId || !IsWindowVisible(windowHandle)) return true;

            var titleLength = GetWindowTextLength(windowHandle);
            if (titleLength <= 0) return true;
            var title = new StringBuilder(titleLength + 1);
            GetWindowText(windowHandle, title, title.Capacity);
            uint finalProcessId;
            if (GetWindowThreadProcessId(windowHandle, out finalProcessId) == 0 || finalProcessId != (uint)expectedProcessId || !IsWindowVisible(windowHandle)) return true;
            windows.Add(new WindowRecord { Handle = windowHandle.ToInt64(), Title = title.ToString(), ProcessId = (int)finalProcessId });
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
}

function Get-VerifiedEdgeAppSurface([System.Collections.IDictionary]$Surface, [string]$EdgeExecutable, [object]$RetainedProcess = $null, [switch]$RetainProcess, [object]$ObservationClock = $null) {
  $remainingMs = if ($ObservationClock) { 15000 - [long]$ObservationClock.ElapsedMilliseconds } else { 2000 }
  if ($remainingMs -lt 1000) { return $null }
  $querySeconds = [int][Math]::Min(2, [Math]::Floor($remainingMs / 1000))
  try { $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -OperationTimeoutSec $querySeconds -ErrorAction Stop) }
  catch { return $null }

  Initialize-StephanosWindowProbe
  foreach ($candidate in $processes) {
    if ($ObservationClock -and $ObservationClock.ElapsedMilliseconds -gt 15000) { return $null }
    if ($RetainedProcess -and [int]$candidate.ProcessId -ne [int]$RetainedProcess.Id) { continue }
    # Cheap discovery filters limit unrelated Edge work; only the later fresh retained-process row is authority.
    $discoveryCommand = [string]$candidate.CommandLine
    if ($discoveryCommand.IndexOf('--type=', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $discoveryCommand.IndexOf([string]$Surface.ProfilePath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $discoveryCommand.IndexOf([string]$Surface.Url, [StringComparison]::Ordinal) -lt 0) { continue }
    $process = $null
    $transferred = $false
    try {
      $process = if ($RetainedProcess) { $RetainedProcess } else { Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction Stop }
      $retainedHandle = $process.Handle
      if ($retainedHandle -eq [IntPtr]::Zero -or $process.HasExited) { continue }
      $path = [System.IO.Path]::GetFullPath([string]$process.Path)
      if (-not [string]::Equals($path, $EdgeExecutable, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
      # Discovery rows are never identity proof. Read command/birth only after retaining this process.
      $remainingMs = if ($ObservationClock) { 15000 - [long]$ObservationClock.ElapsedMilliseconds } else { 2000 }
      if ($remainingMs -lt 1000) { return $null }
      $querySeconds = [int][Math]::Min(2, [Math]::Floor($remainingMs / 1000))
      $fresh = @(Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$process.Id)" -OperationTimeoutSec $querySeconds -ErrorAction Stop)
      if ($ObservationClock -and $ObservationClock.ElapsedMilliseconds -gt 15000) { return $null }
      if ($fresh.Count -ne 1 -or $process.HasExited) { continue }
      $fresh = $fresh[0]
      $commandLine = [string]$fresh.CommandLine
      if ([int]$fresh.ProcessId -ne [int]$process.Id -or $fresh.Name -ine 'msedge.exe' -or [int]$fresh.ParentProcessId -eq 0 -or
          $fresh.CreationDate -isnot [datetime]) { continue }
      $arguments = @([StephanosIgnitionWindowProbe]::GetCommandLineArguments($commandLine))
      $profiles = @($arguments | Where-Object { $_.StartsWith('--user-data-dir=', [StringComparison]::OrdinalIgnoreCase) })
      $apps = @($arguments | Where-Object { $_.StartsWith('--app=', [StringComparison]::OrdinalIgnoreCase) })
      $windowIndex = [Array]::IndexOf($arguments, '--new-window')
      if (@($arguments | Where-Object { $_.StartsWith('--type=', [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0 -or
          $profiles.Count -ne 1 -or -not [string]::Equals($profiles[0], "--user-data-dir=$($Surface.ProfilePath)", [StringComparison]::OrdinalIgnoreCase)) { continue }
      if ($Surface.UseBrowserWindow) {
        if ($apps.Count -ne 0 -or @($arguments | Where-Object { $_ -ceq '--new-window' }).Count -ne 1 -or
            $windowIndex -lt 0 -or $windowIndex + 1 -ge $arguments.Count -or $arguments[$windowIndex + 1] -cne $Surface.Url) { continue }
      } elseif ($windowIndex -ge 0 -or $apps.Count -ne 1 -or $apps[0] -cne "--app=$($Surface.Url)") { continue }
      $birth = $process.StartTime.ToUniversalTime()
      $cimBirth = $fresh.CreationDate.ToUniversalTime()
      # CIM has microseconds, Process FILETIME has 100ns ticks. Exact integer normalization only.
      if (($birth.Ticks - ($birth.Ticks % 10)) -ne ($cimBirth.Ticks - ($cimBirth.Ticks % 10))) { continue }
      if ($ObservationClock -and $ObservationClock.ElapsedMilliseconds -gt 15000) { return $null }
      $surfaceWindow = @([StephanosIgnitionWindowProbe]::GetVisibleTopLevelWindows([int]$process.Id)) | Where-Object {
        [int]$_.ProcessId -eq [int]$process.Id -and [int64]$_.Handle -ne 0 -and (
          [string]::Equals([string]$_.Title, [string]$Surface.ExpectedTitle, [System.StringComparison]::Ordinal) -or
          ($Surface.UseBrowserWindow -and [string]$_.Title -match ('^' + [regex]::Escape($Surface.ExpectedTitle) + ' - (?:[^\r\n]+ - )?Microsoft\p{Cf}* Edge$'))
        )
      } | Select-Object -First 1
      if ($ObservationClock -and $ObservationClock.ElapsedMilliseconds -gt 15000) { return $null }
      if ($surfaceWindow -and -not $process.HasExited) {
        $proof = [ordered]@{
          pid = [int]$process.Id
          processStartTimeUtc = $birth.ToString('o')
          windowHandle = [int64]$surfaceWindow.Handle
          windowTitle = [string]$surfaceWindow.Title
          ownerProcessId = [int]$surfaceWindow.ProcessId
          executablePath = $path
          profilePath = $Surface.ProfilePath
          url = $Surface.Url
        }
        if ($RetainProcess) { $proof.processCapability = $process; $transferred = $true }
        return $proof
      }
    }
    catch {}
    finally { if ($process -and -not $RetainedProcess -and -not $transferred) { $process.Dispose() } }
  }
  return $null
}

function New-IgnitionBrowserObservationClock() {
  return [Diagnostics.Stopwatch]::StartNew()
}

function Get-IgnitionBrowserObservationSet([object[]]$Surfaces, [object]$ObservationClock = $null, [datetime]$StartedAtUtc = [datetime]::MinValue) {
  $clock = if ($ObservationClock) { $ObservationClock } else { New-IgnitionBrowserObservationClock }
  $capabilities = [Collections.Generic.List[object]]::new()
  $started = if ($StartedAtUtc -eq [datetime]::MinValue) { [datetime]::UtcNow } else { $StartedAtUtc }
  $observation = [ordered]@{ schemaVersion = 'stephanos.ignition-browser-final-observation.v1'; startedAtUtc = $started.ToString('o'); completedAtUtc = ''; elapsedMilliseconds = 0; edgeExecutable = ''; surfaces = @() }
  try {
    $edge = Resolve-StephanosEdgeExecutable
    $observation.edgeExecutable = $edge
    $selected = @($Surfaces)
    if ($edge -and $selected.Count -gt 0) {
      $complete = $true
      foreach ($surface in $selected) {
        if ($clock.ElapsedMilliseconds -gt 15000) { $complete = $false; break }
        $proof = Get-VerifiedEdgeAppSurface -Surface $surface -EdgeExecutable $edge -RetainProcess -ObservationClock $clock
        if (-not $proof) { $complete = $false; break }
        # Own a returned capability before any later validation can fail.
        $capabilities.Add($proof.processCapability)
      }
      if ($complete) {
        $records = @()
        for ($index = 0; $index -lt $selected.Count; $index++) {
          if ($clock.ElapsedMilliseconds -gt 15000) { $complete = $false; break }
          $surface = $selected[$index]
          $proof = Get-VerifiedEdgeAppSurface -Surface $surface -EdgeExecutable $edge -RetainedProcess $capabilities[$index] -ObservationClock $clock
          if (-not $proof -or $clock.ElapsedMilliseconds -gt 15000) { $complete = $false; break }
          $records += [ordered]@{ id = $surface.Id; expectedTitle = $surface.ExpectedTitle; url = $proof.url; profilePath = $proof.profilePath; executablePath = $proof.executablePath; pid = $proof.pid; processStartTimeUtc = $proof.processStartTimeUtc; windowHandle = $proof.windowHandle; windowTitle = $proof.windowTitle; ownerProcessId = $proof.ownerProcessId; observedAtUtc = [datetime]::UtcNow.ToString('o') }
        }
        if ($complete) { $observation.surfaces = $records }
      }
    }
    return [ordered]@{ observation = $observation; capabilities = $capabilities; clock = $clock }
  }
  catch { foreach ($capability in $capabilities) { if ($capability) { $capability.Dispose() } }; if (-not $ObservationClock) { $clock.Stop() }; throw }
}

function Write-StephanosBrowserSurfaceReceipt([System.Collections.IDictionary]$Surface, [System.Collections.IDictionary]$WindowProof, [string]$Action) {
  Initialize-IgnitionProofWorkspace
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ignitionBrowserSurfaceReceiptPath) | Out-Null
  $record = [ordered]@{
    id = $Surface.Id
    label = $Surface.Label
    url = $Surface.Url
    expectedTitle = $Surface.ExpectedTitle
    profilePath = $Surface.ProfilePath
    action = $Action
    pid = $WindowProof.pid
    processStartTimeUtc = $WindowProof.processStartTimeUtc
    windowHandle = $WindowProof.windowHandle
    windowTitle = $WindowProof.windowTitle
    verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $script:browserSurfaceReceipts = @($script:browserSurfaceReceipts | Where-Object { $_.id -ne $Surface.Id }) + @($record)
  $supervisor = Get-BattleBridgeSupervisorCurrentRecord
  $sourceHead = if ($supervisor -and [string]$supervisor.sourceTruthVerdict.expectedHead -match '^[0-9a-f]{40}$') { [string]$supervisor.sourceTruthVerdict.expectedHead } else { '' }
  $browserSurfaceProjection = [ordered]@{
    schemaVersion = 'stephanos.ignition-browser-surface-receipt.v1'
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    sourceHead = $sourceHead
    edgeAppIsolation = 'fixed-per-surface-profile'
    arbitraryBrowserExecutableAllowed = $false
    surfaces = @($script:browserSurfaceReceipts)
  }
  Write-IgnitionJson -Path $ignitionBrowserSurfaceReceiptPath -Value $browserSurfaceProjection -Depth 8
  return $record
}

function Ensure-StephanosBrowserSurface([System.Collections.IDictionary]$Surface) {
  $edgeExecutable = Resolve-StephanosEdgeExecutable
  if (-not $edgeExecutable) { return $null }

  $mutex = New-Object System.Threading.Mutex($false, $Surface.MutexName)
  $mutexAcquired = $false
  try {
    try {
      $mutexAcquired = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
    }
    catch [System.Threading.AbandonedMutexException] {
      $mutexAcquired = $true
    }
    if (-not $mutexAcquired) { throw "Timed out waiting for the fixed $($Surface.Id) browser-surface lease." }

    $existing = Get-VerifiedEdgeAppSurface -Surface $Surface -EdgeExecutable $edgeExecutable
    if ($existing) {
      Write-LiveLog "Reused verified $($Surface.Label) Edge app window (pid=$($existing.pid); handle=$($existing.windowHandle))."
      return Write-StephanosBrowserSurfaceReceipt -Surface $Surface -WindowProof $existing -Action 'reused-existing-window'
    }

    New-Item -ItemType Directory -Force -Path $Surface.ProfilePath | Out-Null
    $profileArgument = "--user-data-dir=`"$($Surface.ProfilePath)`""
    $windowArguments = if ($Surface.UseBrowserWindow) { @('--new-window', $Surface.Url) } else { @("--app=$($Surface.Url)") }
    Start-Process -FilePath $edgeExecutable -ArgumentList ($windowArguments + @($profileArgument, '--no-first-run')) | Out-Null

    $deadline = (Get-Date).AddSeconds(20)
    do {
      Start-Sleep -Milliseconds 250
      $opened = Get-VerifiedEdgeAppSurface -Surface $Surface -EdgeExecutable $edgeExecutable
      if ($opened) {
        Write-LiveLog "Opened verified $($Surface.Label) Edge app window (pid=$($opened.pid); handle=$($opened.windowHandle))."
        return Write-StephanosBrowserSurfaceReceipt -Surface $Surface -WindowProof $opened -Action 'opened-new-window'
      }
    } while ((Get-Date) -lt $deadline)

    throw "The fixed $($Surface.Label) Edge app window did not publish stable process and window proof."
  }
  finally {
    if ($mutexAcquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
  }
}

function Show-IgnitionSplashScreen {
  $splashPath = New-IgnitionSplashScreen
  $splashUrl = ([System.Uri]$splashPath).AbsoluteUri
  $surface = Get-StephanosBrowserSurfaceDefinition -Id 'splash' -Label 'ignition splash' -Url $splashUrl -ExpectedTitle 'Stephanos Ignition Status'
  $proof = $null
  try { $proof = Ensure-StephanosBrowserSurface -Surface $surface }
  catch { Write-LiveLog "Ignition splash window proof unavailable: $($_.Exception.Message)" }
  if (-not $proof) {
    try {
      Start-Process -FilePath $splashPath | Out-Null
      Write-LiveLog "Requested the ignition splash through the default browser: $splashPath"
    }
    catch { Write-LiveLog "Unable to open the ignition splash. Status is available at $splashPath" }
  }
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
function Fail-Step([string]$Step, [System.Management.Automation.ErrorRecord]$ErrorRecord, [System.Collections.IDictionary]$Outcome = $null) {
  $childBlocker = Get-LauncherChildBlocker
  if (-not $Outcome) {
    $Outcome = Get-IgnitionStatusProjection -Phase 'blocked' -Message $Step -Extra @{ currentStage = 'blocked'; nextOperatorAction = 'Review the current failure and bounded ignition logs before retrying.'; blocker = $Step; parentFailure = $Step; childIgnitionBlocker = $childBlocker }
  }
  Publish-IgnitionTerminalOutcome -Outcome $Outcome
  $surfacedBlocker = $Outcome.blocker
  Write-Host "[LAUNCHER LIVE] Failed step: $surfacedBlocker" -ForegroundColor Red
  if ($null -ne $ErrorRecord) {
    Write-Host ($ErrorRecord | Out-String).Trim() -ForegroundColor Red
  }
  Write-Host ''
  Read-Host 'Launcher failed. Press Enter to keep this window open and review the error'
  exit 1
}

function Start-DevWindow([string]$Title, [string]$Command, [switch]$ReturnProcess) {
  Initialize-IgnitionProofWorkspace
  $escapedRepoRoot = $repoRoot.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $escapedCommand = $Command.Replace("'", "''")
  $safeLogName = ($Title -replace '[^A-Za-z0-9._-]', '-')
  $stdoutLog = Join-Path $ignitionProofRoot ("logs/{0}.stdout.log" -f $safeLogName)
  $stderrLog = Join-Path $ignitionProofRoot ("logs/{0}.stderr.log" -f $safeLogName)
  $psCommand = "`$Host.UI.RawUI.WindowTitle = '$escapedTitle'; Set-Location '$escapedRepoRoot'; & $escapedCommand"
  Write-IgnitionStatus -Phase 'starting-process' -Message "Starting $Title in minimized/background PowerShell with bounded log capture." -Extra @{ processTitle = $Title; stdoutLog = $stdoutLog; stderrLog = $stderrLog }
  $process = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $repoRoot -WindowStyle Minimized -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $psCommand
  ) -PassThru
  if ($ReturnProcess.IsPresent) { return $process }
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


function Get-RepositoryHeadForSupervisorProof {
  try {
    Push-Location -LiteralPath $repoRoot
    try {
      $head = (& git rev-parse HEAD 2>$null)
      if ($LASTEXITCODE -eq 0 -and $head) { return ([string]$head).Trim() }
    }
    finally {
      Pop-Location
    }
  }
  catch {}
  return ''
}

function Test-BattleBridgeSupervisorFinalContract([object]$SupervisorRecord, [string]$ExpectedHead) {
  if (-not $SupervisorRecord) { return $false }
  $servedRuntimeProof = $SupervisorRecord.services.stephanosUi4173.servedRuntimeProof
  return (
    $ExpectedHead -match '^[0-9a-f]{40}$' -and
    $SupervisorRecord.currentPhase -eq 'ready' -and
    $SupervisorRecord.trafficLight -eq 'green' -and
    $SupervisorRecord.sourceTruthVerdict.state -eq 'ready' -and
    [string]$SupervisorRecord.sourceTruthVerdict.expectedHead -eq [string]$ExpectedHead -and
    $SupervisorRecord.services.backend8787.ready -eq $true -and
    $SupervisorRecord.services.stephanosUi4173.ready -eq $true -and
    $servedRuntimeProof.ready -eq $true -and
    [string]$servedRuntimeProof.currentHead -eq [string]$ExpectedHead
  )
}

function Wait-ForBattleBridgeSupervisorReady([int]$TimeoutSeconds = 300) {
  $expectedHead = Get-RepositoryHeadForSupervisorProof
  if (-not $expectedHead) { throw 'Unable to resolve git HEAD for Battle Bridge served runtime exact-head proof.' }
  Write-LiveLog "waiting for Battle Bridge supervisor current record at $battleBridgeSupervisorCurrentPath (expectedHead=$expectedHead)"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $record = Get-BattleBridgeSupervisorCurrentRecord
    if ($record) {
      Write-IgnitionStatus -Phase 'battle-bridge-supervisor' -Message 'Waiting for Battle Bridge ignition supervisor final contract.' -Extra @{ currentStage = 'served-proof'; battleBridgeSupervisorCurrentPath = $battleBridgeSupervisorCurrentPath }
      if (Test-BattleBridgeSupervisorFinalContract -SupervisorRecord $record -ExpectedHead $expectedHead) {
        Write-LiveLog 'Battle Bridge supervisor final contract is green and exact-head.'
        return $record
      }
      if ($record.blockerId) {
        if ($record.blockerId -eq 'served-runtime-stale') {
          Write-LiveLog 'Battle Bridge supervisor detected stale served runtime; guarded UI repair/retry remains delegated to npm run stephanos:ignite.'
        }
        throw "Battle Bridge ignition supervisor blocked: $($record.blockerId). $($record.nextOperatorAction)"
      }
    }
    $helperExitCode = $null
    if ($script:ignitionHelperProcess -and $script:ignitionHelperProcess.HasExited) {
      try {
        # Windows PowerShell can report HasExited before Start-Process -PassThru has
        # populated ExitCode for a redirected background child. Reap/refresh first;
        # an unproven/null code is not a failure verdict.
        $script:ignitionHelperProcess.WaitForExit()
        $script:ignitionHelperProcess.Refresh()
        $helperExitCode = $script:ignitionHelperProcess.ExitCode
      }
      catch {
        $helperExitCode = $null
      }
    }
    if ($null -ne $helperExitCode -and [int]$helperExitCode -ne 0) {
      $childBlocker = Get-LauncherChildBlocker
      $detail = if ($childBlocker -and $childBlocker.message) { [string]$childBlocker.message } else { "Ignition helper exited with code $([int]$helperExitCode)." }
      throw "Battle Bridge ignition helper failed before a green supervisor contract: $detail"
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for Battle Bridge supervisor final contract at $battleBridgeSupervisorCurrentPath"
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
    launcher = Get-StephanosBrowserSurfaceDefinition -Id 'launcher' -Label 'launcher' -Url $launcherShellUrl -ExpectedTitle 'Stephanos OS'
    runtime  = Get-StephanosBrowserSurfaceDefinition -Id 'runtime' -Label 'runtime' -Url $launcherRuntimeUrl -ExpectedTitle 'Stephanos AI Core'
    openclaw = Get-StephanosBrowserSurfaceDefinition -Id 'openclaw' -Label 'OpenClaw' -Url $openClawControlUrl -ExpectedTitle 'OpenClaw Control'
  }

  switch ($ResolvedBootMode) {
    'launcher' { return @($surfaceMap.launcher) }
    'runtime' { return @($surfaceMap.runtime) }
    'cockpit' { return @($surfaceMap.launcher, $surfaceMap.runtime, $surfaceMap.openclaw) }
    default {
      throw "Unsupported boot mode '$ResolvedBootMode'. Supported modes: launcher, runtime, cockpit."
    }
  }
}

function Open-CockpitSurface([string]$Url, [string]$Label, [string]$Id, [string]$ExpectedTitle) {
  Write-LiveLog "Opening ${Label}: $Url"

  if ($Id -in @('launcher','runtime','openclaw')) {
    $surface = Get-StephanosBrowserSurfaceDefinition -Id $Id -Label $Label -Url $Url -ExpectedTitle $ExpectedTitle
    $proof = Ensure-StephanosBrowserSurface -Surface $surface
    if ($proof) { return }
  }

  Write-LiveLog "Edge app-window reuse unavailable for ${Label}; falling back to the registered default browser."

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


function Write-IgnitionSupportSnapshot([string]$Verdict, [hashtable]$Extra = @{}, [System.Collections.IDictionary]$Outcome = $null) {
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
  foreach ($key in $Extra.Keys) {
    if ($key -notin @('schema','verdict','writtenAt','repositoryRoot','runtimePort','phase','blocker','ignitionOutcome','exactHeadApprovalRequired','exactHeadApprovalStatus','safeAutoFixPolicy','browserTargets','browserSurfaceReceipts','browserAutoOpenEnabled','browserProofScope','battleBridgeSupervisor','sourceHead','proofSummary','currentBrowserObservation')) { $snapshot[$key] = $Extra[$key] }
  }
  if ($Outcome) {
    $snapshot.verdict = if ($Outcome.phase -eq 'ready') { 'ready-for-local-proof' } else { 'blocked' }
    $snapshot.phase = $Outcome.phase
    $snapshot.blocker = $Outcome.blocker
    $snapshot.ignitionOutcome = $Outcome
    $snapshot.browserTargets = $Outcome.browserTargets
    $snapshot.browserSurfaceReceipts = $Outcome.browserSurfaceReceipts
    $snapshot.browserAutoOpenEnabled = $Outcome.browserAutoOpenEnabled
    $snapshot.browserProofScope = $Outcome.browserProofScope
    $snapshot.currentBrowserObservation = $Outcome.currentBrowserObservation
    $snapshot.openClawStartupState = $Outcome.openClawStartupState
    $snapshot.openClawStartupDetail = $Outcome.openClawStartupDetail
  }
  Write-IgnitionJson -Path $ignitionSupportSnapshotPath -Value $snapshot -Depth 10
  Write-IgnitionTranscript -Event @{ event = 'support-snapshot'; verdict = $snapshot.verdict; phase = $snapshot.phase; blocker = $snapshot.blocker; supportSnapshotPath = $ignitionSupportSnapshotPath }
}

function Invoke-SovereignCommanderRetainedCustodyPreparation {
  if ($Mode -ne 'launcher-root') { return $false }
  $nodeExecutable = 'C:\Program Files\nodejs\node.exe'
  $recoveryScript = Join-Path $repoRoot 'scripts/sovereign-maintenance-custody-recovery.mjs'
  $sourceTruthScript = Join-Path $repoRoot 'scripts/battle-bridge-ignition-supervisor.mjs'
  $requiredPathsPresent = (Test-Path -LiteralPath $nodeExecutable -PathType Leaf) -and (Test-Path -LiteralPath $recoveryScript -PathType Leaf) -and (Test-Path -LiteralPath $sourceTruthScript -PathType Leaf)
  if (-not $requiredPathsPresent) { return $false }

  $inspectText = (& $nodeExecutable $recoveryScript 'inspect-retained-migration' 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $inspectText) { return $false }
  try { $inspection = $inspectText | ConvertFrom-Json } catch { return $false }
  $inspectionInvalid = ($inspection.ok -ne $true) -or (([string]$inspection.projectionDigest) -notmatch '^[a-f0-9]{64}$') -or [string]::IsNullOrWhiteSpace([string]$inspection.projectionReservationId) -or (([string]$inspection.heldOwner.digest) -notmatch '^[a-f0-9]{64}$') -or ($inspection.heldOwner.observation.timeoutCustodyHeld -ne $true) -or ($inspection.heldOwner.observation.running -ne $false) -or ($inspection.heldOwner.observation.maintenanceInFlight -ne $false) -or ($inspection.heldOwner.observation.scheduled -ne $false)
  if ($inspectionInvalid) { return $false }

  $sourceText = (& $nodeExecutable $sourceTruthScript '--source-truth-json' 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceText) { return $false }
  try { $sourceTruth = $sourceText | ConvertFrom-Json } catch { return $false }
  $expectedMain = [string]$sourceTruth.head
  if ($sourceTruth.ok -ne $true -or $expectedMain -notmatch '^[a-f0-9]{40}$') { return $false }

  Add-Type -AssemblyName System.Windows.Forms
  $summary = @"
Sovereign Commander is safely holding an old maintenance custody fence.

Stephanos can prepare that exact held custody for recovery on the next full Windows boot.

Reservation:
$($inspection.projectionReservationId)

Current source:
$expectedMain

This action:
- uses the authenticated held-owner observation and exact signed custody digest
- DOES NOT release custody now
- DOES NOT restart Windows
- DOES NOT run arbitrary commands
- requires a normal full Windows Restart afterwards

Prepare Sovereign Commander custody for the next boot?
"@
  $choice = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    'Stephanos - Sovereign Commander custody recovery',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2
  )
  if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) {
    Write-LiveLog 'Sovereign Commander retained-custody preparation was offered and declined; no custody mutation performed.'
    return $false
  }

  $prepareArgs = @(
    'prepare-retained-migration'
    '--expected-cycle'
    [string]$inspection.projectionReservationId
    '--expected-digest'
    [string]$inspection.projectionDigest
    '--expected-main'
    $expectedMain
    '--expected-owner-digest'
    [string]$inspection.heldOwner.digest
    '--operator-approved'
  )
  $prepareText = (& $nodeExecutable $recoveryScript @prepareArgs 2>$null | Out-String).Trim()
  if (-not $prepareText) { throw 'Sovereign Commander retained-custody preparation returned no proof.' }
  try { $prepared = $prepareText | ConvertFrom-Json } catch { throw 'Sovereign Commander retained-custody preparation proof was invalid.' }
  $preparationInvalid = ($LASTEXITCODE -ne 0) -or ($prepared.ok -ne $true) -or ($prepared.prepared -ne $true) -or ($prepared.requiresLaterFullBoot -ne $true) -or ($prepared.custodyReleased -ne $false) -or ($prepared.pcRestartAllowed -ne $false)
  if ($preparationInvalid) {
    $blocker = if ($prepared.blocker) { [string]$prepared.blocker } else { 'MAINTENANCE_RETAINED_MIGRATION_PREPARATION_UNPROVEN' }
    throw "Sovereign Commander retained-custody preparation blocked: $blocker"
  }

  $message = 'Sovereign Commander custody is prepared for successor-boot recovery. Restart Windows normally, then press Ignition after sign-in.'
  Write-LiveLog $message
  Write-IgnitionStatus -Phase 'restart-required' -Message $message -Extra @{
    currentStage = 'restart'
    blocker = ''
    nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
    sovereignCommanderCustodyPrepared = $true
    custodyReleased = $false
    pcRestartAllowedByPreparation = $false
    expectedMain = $expectedMain
    reservationId = [string]$inspection.projectionReservationId
  }
  Write-IgnitionSupportSnapshot -Verdict 'restart-required' -Extra @{
    nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
    sovereignCommanderCustodyPrepared = $true
    custodyReleased = $false
    pcRestartAllowedByPreparation = $false
    expectedMain = $expectedMain
  }
  [System.Windows.Forms.MessageBox]::Show(
    "Preparation is complete.\r\n\r\nUse the normal Windows Restart command now.\r\nAfter sign-in, press Ignition.\r\n\r\nStephanos has NOT restarted the PC automatically.",
    'Stephanos - Restart required',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
  return $true
}

function Invoke-SovereignFixedRuntimeCommissioning {
  if ($Mode -ne 'launcher-root') { return $false }

  $nodeExecutable = 'C:\Program Files\nodejs\node.exe'
  $adapterScript = Join-Path $repoRoot 'scripts\sovereign-fixed-runtime-install-current-v1.mjs'
  $sourceTruthScript = Join-Path $repoRoot 'scripts\battle-bridge-ignition-supervisor.mjs'
  $powerShellExecutable = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $marker = 'SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_V1='

  foreach ($required in @($nodeExecutable, $adapterScript, $sourceTruthScript, $powerShellExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { return $false }
  }

  $sourceText = (& $nodeExecutable $sourceTruthScript '--source-truth-json' 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $sourceText) { return $false }
  try { $sourceTruth = $sourceText | ConvertFrom-Json -ErrorAction Stop } catch { return $false }
  $expectedMain = [string]$sourceTruth.head
  if ($sourceTruth.ok -ne $true -or $expectedMain -notmatch '^[a-f0-9]{40}$') { return $false }

  function Read-FixedRuntimeAdapter([string]$ModeName) {
    $raw = @(& $nodeExecutable $adapterScript $ModeName '--expected-main' $expectedMain 2>&1)
    $exitCode = $LASTEXITCODE
    $line = @($raw | ForEach-Object { [string]$_ } | Where-Object { $_.StartsWith($marker) } | Select-Object -Last 1)
    if (-not $line -or -not $line[0]) { return $null }
    try {
      $value = $line[0].Substring($marker.Length) | ConvertFrom-Json -ErrorAction Stop
      return [pscustomobject]@{ ExitCode = $exitCode; Value = $value }
    } catch { return $null }
  }

  $qualification = Read-FixedRuntimeAdapter 'qualification'
  if ($null -ne $qualification -and $qualification.ExitCode -eq 0 -and $qualification.Value.ok -eq $true) {
    if ([string]$qualification.Value.state -eq 'QUALIFIED') { return $false }
    if ([string]$qualification.Value.state -eq 'RESTART_REQUIRED') {
      $message = 'Sovereign fixed runtime is installed and requires a later full Windows boot before Commander can use it.'
      Write-LiveLog $message
      Write-IgnitionStatus -Phase 'restart-required' -Message $message -Extra @{
        currentStage = 'restart'
        blocker = ''
        nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
        sovereignFixedRuntimeInstalled = $true
        runtimeQualificationProven = $false
        expectedMain = $expectedMain
      }
      Write-IgnitionSupportSnapshot -Verdict 'restart-required' -Extra @{
        nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
        sovereignFixedRuntimeInstalled = $true
        runtimeQualificationProven = $false
        expectedMain = $expectedMain
      }
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.MessageBox]::Show(
        "The Sovereign fixed runtime is installed but is not allowed to run until a later full Windows boot.\r\n\r\nUse the normal Windows Restart command now.\r\nAfter sign-in, press Ignition.",
        'Stephanos - Restart required',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
      ) | Out-Null
      return $true
    }
  }

  $status = Read-FixedRuntimeAdapter 'status'
  if ($null -eq $status -or $status.ExitCode -ne 0 -or $status.Value.ok -ne $true) { return $false }
  if ([string]$status.Value.state -eq 'PRESENT') { return $false }
  if ([string]$status.Value.state -ne 'MISSING' -or
      [string]$status.Value.reason -ne 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING') { return $false }

  Write-LiveLog 'Control Tower repair requires the protected Sovereign fixed runtime; preparing the exact current-main installer candidate.'
  Write-IgnitionStatus -Phase 'fixed-runtime-installation' -Message 'Preparing exact current-main Sovereign fixed runtime installation approval.' -Extra @{
    currentStage = 'fixed-runtime-installation'
    blocker = 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING'
    nextOperatorAction = 'Review the fixed runtime package, approve it, then accept the Windows UAC prompt.'
    expectedMain = $expectedMain
  }

  $prepared = Read-FixedRuntimeAdapter 'prepare'
  if ($null -eq $prepared -or $prepared.ExitCode -ne 0 -or $prepared.Value.ok -ne $true) {
    $prepareBlocker = if ($null -ne $prepared -and $prepared.Value.blocker) { [string]$prepared.Value.blocker } else { 'FIXED_RUNTIME_INSTALL_PREPARATION_UNPROVEN' }
    Write-LiveLog "Sovereign fixed runtime preparation blocked: $prepareBlocker"
    Write-IgnitionStatus -Phase 'blocked' -Message "Sovereign fixed runtime preparation blocked: $prepareBlocker" -Extra @{
      currentStage = 'blocked'
      blocker = $prepareBlocker
      expectedMain = $expectedMain
    }
    return $true
  }

  $candidate = $prepared.Value
  $expectedPayloadPath = Join-Path $env:LOCALAPPDATA "Temp\StephanosFixedRuntimeInstall-$expectedMain.json"
  $candidateInvalid = ([string]$candidate.state -ne 'READY_FOR_OPERATOR_APPROVAL') -or
      ([string]$candidate.expectedMain -cne $expectedMain) -or
      ([string]$candidate.payloadPath -cne $expectedPayloadPath) -or
      (([string]$candidate.payloadSha256) -notmatch '^[a-f0-9]{64}$') -or
      (([string]$candidate.scriptSha256) -notmatch '^[a-f0-9]{64}$') -or
      (([string]$candidate.encodedCommand) -notmatch '^[A-Za-z0-9+/=]+$') -or
      ([string]$candidate.powershellExecutable -cne $powerShellExecutable) -or
      ($candidate.requiresUac -ne $true) -or
      ($candidate.arbitraryShellAllowed -ne $false) -or
      ($candidate.sourceMutationAllowed -ne $false) -or
      ($candidate.mergeAuthority -ne $false) -or
      ($candidate.pcRestartAuthority -ne $false)
  if ($candidateInvalid) {
    Write-LiveLog 'Sovereign fixed runtime installer candidate failed the closed launcher contract.'
    Write-IgnitionStatus -Phase 'blocked' -Message 'Sovereign fixed runtime installer candidate was not exact.' -Extra @{
      currentStage = 'blocked'
      blocker = 'FIXED_RUNTIME_INSTALL_CANDIDATE_UNPROVEN'
      expectedMain = $expectedMain
    }
    return $true
  }

  Add-Type -AssemblyName System.Windows.Forms
  $summary = @"
Stephanos Control Tower has proved that the protected Sovereign fixed runtime is missing.

Install the exact reviewed runtime for current protected main?

Main:
$expectedMain

Payload SHA-256:
$($candidate.payloadSha256)

Installer program SHA-256:
$($candidate.scriptSha256)

This action:
- installs only the fixed Sovereign runtime under C:\Program Files\Stephanos
- uses the exact current main source closure
- requires Windows UAC
- cannot run arbitrary commands or choose another path
- does NOT restart Windows
- does NOT grant merge or source-mutation authority
- requires one normal Windows Restart after installation

Continue?
"@
  $choice = [System.Windows.Forms.MessageBox]::Show(
    $summary,
    'Stephanos - install Sovereign fixed runtime',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning,
    [System.Windows.Forms.MessageBoxDefaultButton]::Button2
  )
  if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) {
    Write-LiveLog 'Sovereign fixed runtime installation was offered and declined; no elevated installer was started.'
    Write-IgnitionStatus -Phase 'blocked' -Message 'Sovereign fixed runtime installation was declined.' -Extra @{
      currentStage = 'blocked'
      blocker = 'FIXED_RUNTIME_INSTALL_OPERATOR_DECLINED'
      expectedMain = $expectedMain
    }
    if (Test-Path -LiteralPath $expectedPayloadPath -PathType Leaf) {
      Remove-Item -LiteralPath $expectedPayloadPath -Force -ErrorAction SilentlyContinue
    }
    return $true
  }

  try {
    try {
      $elevated = Start-Process -FilePath $powerShellExecutable -ArgumentList @(
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        ([string]$candidate.encodedCommand)
      ) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    } catch {
      Write-LiveLog 'Sovereign fixed runtime UAC elevation was cancelled or failed.'
      Write-IgnitionStatus -Phase 'blocked' -Message 'Sovereign fixed runtime UAC elevation was cancelled or failed.' -Extra @{
        currentStage = 'blocked'
        blocker = 'FIXED_RUNTIME_INSTALL_UAC_CANCELLED_OR_FAILED'
        expectedMain = $expectedMain
      }
      return $true
    }

    if ($elevated.ExitCode -ne 0) {
      Write-LiveLog "Sovereign fixed runtime elevated installer returned exit code $($elevated.ExitCode)."
      Write-IgnitionStatus -Phase 'blocked' -Message 'Sovereign fixed runtime elevated installer failed.' -Extra @{
        currentStage = 'blocked'
        blocker = 'FIXED_RUNTIME_INSTALL_ELEVATED_CHILD_FAILED'
        elevatedExitCode = [int]$elevated.ExitCode
        expectedMain = $expectedMain
      }
      return $true
    }

    $after = Read-FixedRuntimeAdapter 'status'
    $installed = $null -ne $after -and $after.ExitCode -eq 0 -and $after.Value.ok -eq $true -and
      [string]$after.Value.state -eq 'PRESENT' -and [string]$after.Value.sourceHead -ceq $expectedMain
    if (-not $installed) {
      $readbackBlocker = if ($null -ne $after -and $after.Value.reason) { [string]$after.Value.reason } else { 'FIXED_RUNTIME_INSTALL_READBACK_UNPROVEN' }
      Write-LiveLog "Sovereign fixed runtime installation readback blocked: $readbackBlocker"
      Write-IgnitionStatus -Phase 'blocked' -Message "Sovereign fixed runtime installation readback blocked: $readbackBlocker" -Extra @{
        currentStage = 'blocked'
        blocker = $readbackBlocker
        expectedMain = $expectedMain
      }
      return $true
    }

    $message = 'Sovereign fixed runtime installation is complete and protected. A later full Windows boot is required before runtime qualification.'
    Write-LiveLog $message
    Write-IgnitionStatus -Phase 'restart-required' -Message $message -Extra @{
      currentStage = 'restart'
      blocker = ''
      nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
      sovereignFixedRuntimeInstalled = $true
      runtimeQualificationProven = $false
      expectedMain = $expectedMain
      installPayloadSha256 = [string]$candidate.payloadSha256
      installScriptSha256 = [string]$candidate.scriptSha256
      installedHelperSha256 = [string]$after.Value.helperSha256
      installedManifestSha256 = [string]$after.Value.manifestSha256
    }
    Write-IgnitionSupportSnapshot -Verdict 'restart-required' -Extra @{
      nextOperatorAction = 'Use the normal Windows Restart command. After sign-in, press Ignition.'
      sovereignFixedRuntimeInstalled = $true
      runtimeQualificationProven = $false
      expectedMain = $expectedMain
    }
    [System.Windows.Forms.MessageBox]::Show(
      "The protected Sovereign fixed runtime was installed successfully.\r\n\r\nUse the normal Windows Restart command now.\r\nAfter sign-in, press Ignition.\r\n\r\nStephanos has NOT restarted the PC automatically.",
      'Stephanos - Fixed runtime installed',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    return $true
  } finally {
    if (Test-Path -LiteralPath $expectedPayloadPath -PathType Leaf) {
      Remove-Item -LiteralPath $expectedPayloadPath -Force -ErrorAction SilentlyContinue
    }
  }
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

  if (Invoke-SovereignCommanderRetainedCustodyPreparation) {
    exit 0
  }

  if (Invoke-SovereignFixedRuntimeCommissioning) {
    Write-LiveLog 'Protected Sovereign fixed runtime remains separately held. Continuing ordinary Stephanos startup in degraded mode.'
  }

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

  if ($Mode -eq 'vite-dev') {
    Ensure-ProcessRunning -StepLabel 'backend' -HealthUrl $backendHealthUrl -WindowTitle 'Stephanos Backend' -Command 'npm --prefix stephanos-server run dev'
    Write-LiveLog 'starting vite-dev UI server'
    Ensure-ProcessRunning -StepLabel 'vite-dev ui' -HealthUrl $viteDevUrl -WindowTitle 'Stephanos Vite Dev' -Command 'npm --prefix stephanos-ui run dev'

    Write-LiveLog 'waiting for backend'
    Wait-ForUrl -StepLabel 'backend health' -Url $backendHealthUrl
    Wait-ForUrl -StepLabel 'backend mission operations freshness route' -Url $backendMissionOperationsUrl
    Write-LiveLog "waiting for vite-dev runtime at $viteDevUrl"
    Wait-ForUrl -StepLabel 'vite-dev ui' -Url $viteDevUrl
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

    Write-LiveLog "starting Battle Bridge supervisor through launcher-root approval helper (command=$launcherRootCommand)"
    $script:ignitionHelperProcess = Start-DevWindow -Title 'Stephanos Battle Bridge Ignition Supervisor' -Command $launcherRootCommand -ReturnProcess
    $battleBridgeSupervisor = Wait-ForBattleBridgeSupervisorReady
    $script:ignitionAdmittedSourceHead = [string]$battleBridgeSupervisor.sourceTruthVerdict.expectedHead

    Write-LiveLog "waiting for launcher-root shell at $launcherShellUrl after readiness proof"
    Wait-ForUrl -StepLabel 'launcher-root shell' -Url $launcherShellUrl

    if ($resolvedBootMode -in @('runtime', 'cockpit')) {
      Write-LiveLog "waiting for launcher-root runtime target at $launcherRuntimeUrl after readiness proof"
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

  Write-LiveLog 'server started'
  Write-LiveLog "manual URL(s): $([string]::Join(', ', $browserTargets))"
  Write-LiveLog "browser auto-open disabled: $(-not $autoOpenEnabled)"

  Write-Host ''
  Write-Host 'Open manually in browser:' -ForegroundColor Green
  foreach ($target in $browserTargets) {
    Write-Host $target -ForegroundColor Green
  }
  Write-Host ''

  if ($autoOpenEnabled) {
    $surfaceFailures = @()
    for ($index = 0; $index -lt $browserSurfaces.Count; $index++) {
      $surface = $browserSurfaces[$index]
      try {
        if ($surface.Id -eq 'openclaw') {
          Wait-ForUrl -StepLabel 'OpenClaw Control' -Url $surface.Url -TimeoutSeconds 60
        }
        Open-CockpitSurface -Url $surface.Url -Label $surface.Label -Id $surface.Id -ExpectedTitle $surface.ExpectedTitle
      }
      catch {
        $surfaceFailures += "$($surface.Label): $($_.Exception.Message)"
      }

      if ($index -lt ($browserSurfaces.Count - 1)) {
        Start-Sleep -Milliseconds 450
      }
    }
    if ($surfaceFailures.Count -gt 0) { throw ($surfaceFailures -join ' | ') }
  }
  Complete-IgnitionLaunch -Extra @{ currentStage = 'ready'; visiblePowerShellWallRequired = $false; supportSnapshotPath = $ignitionSupportSnapshotPath; transcriptPath = $ignitionTranscriptPath; port4173Before = $port4173Before; port5173Before = $port5173Before }
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
