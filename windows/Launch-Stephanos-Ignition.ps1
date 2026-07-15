[CmdletBinding()]
param(
  [string]$RepositoryRoot = '',
  [string]$SharedWorkspace = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-StephanosRepositoryRoot([string]$RequestedRoot) {
  $candidates = @()
  if ($RequestedRoot -and $RequestedRoot.Trim()) { $candidates += $RequestedRoot.Trim() }
  if ($env:STEPHANOS_PROOF_WORKTREE_ROOT -and $env:STEPHANOS_PROOF_WORKTREE_ROOT.Trim()) { $candidates += $env:STEPHANOS_PROOF_WORKTREE_ROOT.Trim() }
  if ($PWD -and $PWD.Path) { $candidates += $PWD.Path }
  $candidates += (Split-Path -Parent $PSScriptRoot)

  foreach ($candidate in $candidates) {
    try {
      $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).ProviderPath
      if ((Test-Path -LiteralPath (Join-Path $resolved 'package.json') -PathType Leaf) -and
          (Test-Path -LiteralPath (Join-Path $resolved 'scripts/ignite-stephanos-local.mjs') -PathType Leaf) -and
          (Test-Path -LiteralPath (Join-Path $resolved 'stephanos-server/server.js') -PathType Leaf)) {
        return $resolved
      }
    }
    catch {}
  }

  throw 'Unable to resolve the Stephanos repository root.'
}

function Test-CommandLineMatchesAny([string]$CommandLine, [string[]]$Patterns) {
  foreach ($pattern in $Patterns) {
    if ($CommandLine -match $pattern) { return $true }
  }
  return $false
}

function Stop-AllowlistedPortProcessTree([int]$Port, [string[]]$AllowedPatterns) {
  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) { return @() }

  $allProcesses = @(Get-CimInstance Win32_Process)
  $stopped = @()

  foreach ($processId in @($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = $allProcesses | Where-Object ProcessId -eq $processId | Select-Object -First 1
    if (-not $process) { throw "Could not inspect process $processId on port ${Port}." }

    $commandLine = [string]$process.CommandLine
    if (-not (Test-CommandLineMatchesAny -CommandLine $commandLine -Patterns $AllowedPatterns)) {
      throw "Refusing to stop an unknown process on port ${Port}: $commandLine"
    }

    $root = $process
    $cursor = $process
    while ($cursor.ParentProcessId) {
      $parent = $allProcesses | Where-Object ProcessId -eq $cursor.ParentProcessId | Select-Object -First 1
      if (-not $parent) { break }
      $parentCommandLine = [string]$parent.CommandLine
      if (-not (Test-CommandLineMatchesAny -CommandLine $parentCommandLine -Patterns $AllowedPatterns)) { break }
      $root = $parent
      $cursor = $parent
    }

    & taskkill.exe /PID $root.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to stop the allowlisted Stephanos process tree on port ${Port}." }
    $stopped += [int]$root.ProcessId
  }

  if ($stopped.Count -gt 0) { Start-Sleep -Seconds 2 }
  return $stopped
}

function Start-StephanosPowerShellWindow([string]$Title, [string]$Command, [ValidateSet('Normal','Minimized')] [string]$WindowStyle = 'Normal') {
  $escapedRepo = $script:repoRoot.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $scriptText = @"
`$Host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location -LiteralPath '$escapedRepo'
$Command
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptText))
  return Start-Process -FilePath 'powershell.exe' -WorkingDirectory $script:repoRoot -WindowStyle $WindowStyle -PassThru -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', $encoded
  )
}

function Wait-ForJsonEndpoint([string]$Url, [int]$TimeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ''
  while ((Get-Date) -lt $deadline) {
    try {
      return Invoke-RestMethod -Uri $Url -TimeoutSec 3 -Headers @{ 'Cache-Control' = 'no-cache' }
    }
    catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 1
    }
  }
  throw "Timed out waiting for ${Url}. Last error: $lastError"
}

function Wait-ForWebEndpoint([string]$Url, [int]$TimeoutSeconds = 180) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ''
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers @{ 'Cache-Control' = 'no-cache' }
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return $response }
    }
    catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 1
    }
  }
  throw "Timed out waiting for ${Url}. Last error: $lastError"
}

function Get-OptionalPropertyString([object]$Object, [string]$PropertyName, [string]$Fallback = '') {
  if ($null -eq $Object) { return $Fallback }
  $property = $Object.PSObject.Properties[$PropertyName]
  if ($null -eq $property -or $null -eq $property.Value) { return $Fallback }
  $value = [string]$property.Value
  if (-not $value.Trim()) { return $Fallback }
  return $value
}

function Write-IgnitionStatus([string]$Stage, [string]$Message, [string]$TrafficLight = 'blue', [string]$Blocker = '') {
  $stageOrder = @('workspace','source-build','ui-runtime','ai-core','openclaw','served-proof','open-stephanos','ready')
  $stageLabels = [ordered]@{
    workspace = 'Checking workspace'
    'source-build' = 'Updating and building Stephanos'
    'ui-runtime' = 'Starting Stephanos runtime'
    'ai-core' = 'Starting AI Core window'
    openclaw = 'Checking OpenClaw gateway'
    'served-proof' = 'Proving exact served build'
    'open-stephanos' = 'Opening Stephanos'
    ready = 'Ready'
  }
  $currentIndex = [Array]::IndexOf($stageOrder, $Stage)
  $stageHtml = foreach ($id in $stageOrder) {
    $state = if ($Stage -eq 'ready') { 'complete' } elseif ($id -eq $Stage) { 'active' } elseif ([Array]::IndexOf($stageOrder, $id) -lt $currentIndex) { 'complete' } else { 'pending' }
    $safeLabel = [System.Net.WebUtility]::HtmlEncode([string]$stageLabels[$id])
    "<div class='stage $state'><strong>$safeLabel</strong><span>$state</span></div>"
  }
  $safeMessage = [System.Net.WebUtility]::HtmlEncode($Message)
  $safeBlocker = [System.Net.WebUtility]::HtmlEncode($Blocker)
  $safeRepo = [System.Net.WebUtility]::HtmlEncode($script:repoRoot)
  $progress = if ($Stage -eq 'ready') { 100 } elseif ($currentIndex -ge 0) { [Math]::Min(95, [int](($currentIndex + 1) * 12.5)) } else { 5 }
  $blockerHtml = if ($Blocker) { "<section class='blocker'><strong>Blocked:</strong> $safeBlocker</section>" } else { '' }

  $html = @"
<!doctype html>
<meta charset='utf-8'>
<meta http-equiv='refresh' content='2'>
<title>Stephanos Ignition</title>
<style>
body{margin:0;background:#07111f;color:#e7f2ff;font-family:Segoe UI,Arial,sans-serif}main{max-width:900px;margin:5vh auto;padding:32px;border:1px solid #1e4f7a;border-radius:18px;background:#0b1728;box-shadow:0 20px 60px rgba(0,0,0,.35)}h1{margin:0 0 8px}.muted{color:#9eb7cf}.lights{display:flex;gap:8px;margin:18px 0}.light{width:18px;height:18px;border-radius:50%;background:#26384f;border:1px solid #5f7896}.green .light-green,.amber .light-amber,.red .light-red,.blue .light-blue{background:currentColor;box-shadow:0 0 18px currentColor}.green{color:#26d07c}.amber{color:#f5b942}.red{color:#ff5c5c}.blue{color:#4eb3ff}.progress{height:12px;background:#13243a;border-radius:999px;overflow:hidden}.bar{height:100%;background:linear-gradient(90deg,#4eb3ff,#26d07c)}.stages{display:grid;gap:10px;margin:24px 0}.stage{display:flex;justify-content:space-between;padding:12px 14px;border:1px solid #254766;border-radius:12px;background:#0f2036}.stage.complete{border-color:#247a55}.stage.active{border-color:#4eb3ff;box-shadow:0 0 0 1px #4eb3ff}.stage.pending{opacity:.65}.blocker{padding:14px;border:1px solid #8b3d35;border-radius:12px;background:#301714;color:#ffd7d1}code{background:#111f33;padding:3px 6px;border-radius:6px}
</style>
<main>
  <h1>Stephanos Ignition</h1>
  <p class='muted'>One click starts the splash, updates the runtime, opens the visible AI Core console, and then opens Stephanos.</p>
  <div class='lights $TrafficLight'><span class='light light-green'></span><span class='light light-amber'></span><span class='light light-red'></span><span class='light light-blue'></span></div>
  <div class='progress'><div class='bar' style='width:$progress%'></div></div>
  <h2>$safeMessage</h2>
  <section class='stages'>$($stageHtml -join "`n")</section>
  $blockerHtml
  <p class='muted'>Repository: <code>$safeRepo</code></p>
</main>
"@
  $html | Set-Content -LiteralPath $script:splashPath -Encoding UTF8

  $status = [ordered]@{
    schema = 'stephanos.windows-ignition.v1'
    stage = $Stage
    message = $Message
    trafficLight = $TrafficLight
    blocker = $Blocker
    repositoryRoot = $script:repoRoot
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $script:statusPath -Encoding UTF8
}

$script:repoRoot = Resolve-StephanosRepositoryRoot -RequestedRoot $RepositoryRoot
$script:workspaceRoot = if ($SharedWorkspace -and $SharedWorkspace.Trim()) {
  $SharedWorkspace.Trim()
}
elseif ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) {
  $env:STEPHANOS_SHARED_WORKSPACE.Trim()
}
else {
  Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace'
}
$script:ignitionRoot = Join-Path $script:workspaceRoot 'ignition'
$script:splashPath = Join-Path $script:ignitionRoot 'stephanos-ignition.html'
$script:statusPath = Join-Path $script:ignitionRoot 'stephanos-ignition-status.json'
New-Item -ItemType Directory -Force -Path $script:ignitionRoot | Out-Null

$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$backendMissionOperationsUrl = 'http://127.0.0.1:8787/api/mission-operations'
$openClawHealthUrl = 'http://127.0.0.1:18789/health'
$uiHealthUrl = 'http://127.0.0.1:4173/__stephanos/health'
$stephanosUrl = 'http://127.0.0.1:4173/'
$runtimeUrl = 'http://127.0.0.1:4173/apps/stephanos/dist/'

try {
  Write-IgnitionStatus -Stage 'workspace' -Message 'Opening ignition splash and checking the Battle Bridge.'
  Start-Process -FilePath $script:splashPath | Out-Null

  Set-Location -LiteralPath $script:repoRoot
  $branch = (& git branch --show-current).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'Unable to read the current Git branch.' }
  if ($branch -ne 'main') { throw "Ignition requires the main branch. Current branch: $branch" }

  Write-IgnitionStatus -Stage 'source-build' -Message 'Updating main, building the current Stephanos UI, and verifying generated assets.'
  Stop-AllowlistedPortProcessTree -Port 4173 -AllowedPatterns @('serve-stephanos-dist\.mjs','ignite-stephanos-local\.mjs','stephanos:ignite:launcher-root','stephanos:serve') | Out-Null
  Start-StephanosPowerShellWindow -Title 'Stephanos Runtime' -Command 'npm run stephanos:ignite:launcher-root' -WindowStyle Minimized | Out-Null

  Write-IgnitionStatus -Stage 'ui-runtime' -Message 'Waiting for the rebuilt Stephanos runtime on port 4173.'
  $uiHealth = Wait-ForJsonEndpoint -Url $uiHealthUrl -TimeoutSeconds 300
  $null = Wait-ForWebEndpoint -Url $runtimeUrl -TimeoutSeconds 60

  Write-IgnitionStatus -Stage 'ai-core' -Message 'Starting Stephanos AI Core from the updated source in its own visible window.'
  Stop-AllowlistedPortProcessTree -Port 8787 -AllowedPatterns @('stephanos-server','nodemon','server\.js','npm(?:\.cmd)?.*--prefix\s+stephanos-server') | Out-Null
  Start-StephanosPowerShellWindow -Title 'Stephanos AI Core' -Command 'npm --prefix stephanos-server run dev' -WindowStyle Normal | Out-Null
  $backendHealth = Wait-ForJsonEndpoint -Url $backendHealthUrl -TimeoutSeconds 120
  $null = Wait-ForWebEndpoint -Url $backendMissionOperationsUrl -TimeoutSeconds 60

  try {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.AppActivate('Stephanos AI Core')
  }
  catch {}

  Write-IgnitionStatus -Stage 'openclaw' -Message 'Checking the real OpenClaw gateway on port 18789.'
  $openClawHealth = Wait-ForJsonEndpoint -Url $openClawHealthUrl -TimeoutSeconds 90
  $openClawOk = $openClawHealth.PSObject.Properties['ok']
  $openClawStatus = Get-OptionalPropertyString -Object $openClawHealth -PropertyName 'status' -Fallback 'responding'
  $openClawReady = ($null -ne $openClawOk -and $openClawOk.Value -eq $true) -or ($openClawStatus -match '^(ok|live|ready|healthy)$')
  if (-not $openClawReady) { throw 'OpenClaw gateway responded but did not report a healthy/live state.' }

  Write-IgnitionStatus -Stage 'served-proof' -Message 'Proving the served runtime matches the current main commit.'
  $head = (& git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $head) { throw 'Unable to resolve the current Git commit.' }
  $servedCommit = Get-OptionalPropertyString -Object $uiHealth -PropertyName 'gitCommit' -Fallback 'missing'
  if ($servedCommit -ne $head) {
    throw "Served runtime commit $servedCommit does not match current source HEAD ${head}."
  }

  Write-IgnitionStatus -Stage 'open-stephanos' -Message 'Opening Stephanos after AI Core, OpenClaw, and exact-head proof passed.' -TrafficLight 'amber'
  Start-Process -FilePath $stephanosUrl | Out-Null

  $supportSnapshot = [ordered]@{
    schema = 'stephanos.windows-ignition-proof.v1'
    verdict = 'ready'
    sourceHead = $head
    servedCommit = $servedCommit
    runtimeMarker = Get-OptionalPropertyString -Object $uiHealth -PropertyName 'runtimeMarker' -Fallback 'unknown'
    buildTimestamp = Get-OptionalPropertyString -Object $uiHealth -PropertyName 'buildTimestamp' -Fallback 'unknown'
    backend8787 = @{ ready = $true; status = Get-OptionalPropertyString -Object $backendHealth -PropertyName 'status' -Fallback 'responding' }
    openClaw18789 = @{ ready = $true; status = $openClawStatus }
    ui4173 = @{ ready = $true; exactHead = $true; url = $stephanosUrl }
    writtenAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $supportSnapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $script:ignitionRoot 'stephanos-ignition-proof.json') -Encoding UTF8

  Write-IgnitionStatus -Stage 'ready' -Message 'Stephanos is ready. The AI Core console and Stephanos are both open.' -TrafficLight 'green'
  Write-Host '[IGNITION] STEPHANOS_READY' -ForegroundColor Green
  Write-Host "[IGNITION] sourceHead=$head servedCommit=$servedCommit"
  exit 0
}
catch {
  $message = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'Unknown ignition failure.' }
  Write-IgnitionStatus -Stage 'workspace' -Message 'Stephanos ignition stopped safely.' -TrafficLight 'red' -Blocker $message
  Write-Error $message
  exit 1
}
