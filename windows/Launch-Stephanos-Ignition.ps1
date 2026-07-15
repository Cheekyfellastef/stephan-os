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
  [switch]$RepairDryRun,
  [switch]$AllowProofBranch
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
      $legacyLauncher = Join-Path $resolved 'windows/Launch-Stephanos-Local.ps1'
      if ((Test-Path -LiteralPath (Join-Path $resolved 'package.json') -PathType Leaf) -and
          (Test-Path -LiteralPath $legacyLauncher -PathType Leaf) -and
          (Test-Path -LiteralPath (Join-Path $resolved 'stephanos-server/server.js') -PathType Leaf)) {
        return $resolved
      }
    }
    catch {}
  }

  throw 'Unable to resolve the Stephanos repository root.'
}

function ConvertTo-SingleQuotedLiteral([string]$Value) {
  return $Value.Replace("'", "''")
}

function Test-WebEndpoint([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers @{ 'Cache-Control' = 'no-cache' }
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  }
  catch {
    return $false
  }
}

function Wait-ForWebEndpoint([string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ''
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Headers @{ 'Cache-Control' = 'no-cache' }
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return }
    }
    catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for ${Url}. Last error: $lastError"
}

function Test-AiCoreWindowVisible {
  try {
    $shell = New-Object -ComObject WScript.Shell
    return [bool]$shell.AppActivate('Stephanos AI Core')
  }
  catch {
    return $false
  }
}

function Test-CommandLineMatchesAny([string]$CommandLine, [string[]]$Patterns) {
  foreach ($pattern in $Patterns) {
    if ($CommandLine -match $pattern) { return $true }
  }
  return $false
}

function Stop-RecordedAiCoreWindow {
  if (-not (Test-Path -LiteralPath $script:aiCorePidPath -PathType Leaf)) { return }
  try {
    $recordedPid = [int](Get-Content -LiteralPath $script:aiCorePidPath -Raw -Encoding UTF8).Trim()
    $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -match '^powershell$' -and $process.MainWindowTitle -eq 'Stephanos AI Core') {
      & taskkill.exe /PID $recordedPid /T /F | Out-Null
    }
  }
  catch {}
  Remove-Item -LiteralPath $script:aiCorePidPath -Force -ErrorAction SilentlyContinue
}

function Stop-AllowlistedAiCoreProcessTree {
  $connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
  if ($connections.Count -eq 0) { return }

  $allowedPatterns = @(
    'stephanos-server',
    'nodemon',
    'server\.js',
    'npm(?:\.cmd)?.*--prefix\s+stephanos-server',
    'npm(?:\.cmd)?.*stephanos-server'
  )
  $allProcesses = @(Get-CimInstance Win32_Process)

  foreach ($processId in @($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = $allProcesses | Where-Object ProcessId -eq $processId | Select-Object -First 1
    if (-not $process) { throw "Could not inspect process $processId on port 8787." }

    $commandLine = [string]$process.CommandLine
    if (-not (Test-CommandLineMatchesAny -CommandLine $commandLine -Patterns $allowedPatterns)) {
      throw "Refusing to stop an unknown process on port 8787: $commandLine"
    }

    $root = $process
    $cursor = $process
    while ($cursor.ParentProcessId) {
      $parent = $allProcesses | Where-Object ProcessId -eq $cursor.ParentProcessId | Select-Object -First 1
      if (-not $parent) { break }
      $parentCommandLine = [string]$parent.CommandLine
      if (-not (Test-CommandLineMatchesAny -CommandLine $parentCommandLine -Patterns $allowedPatterns)) { break }
      $root = $parent
      $cursor = $parent
    }

    & taskkill.exe /PID $root.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the allowlisted Stephanos AI Core process tree.' }
  }

  Start-Sleep -Seconds 2
}

function Start-VisibleAiCoreWindow {
  $escapedRepo = ConvertTo-SingleQuotedLiteral $script:repoRoot
  $windowScript = @"
`$Host.UI.RawUI.WindowTitle = 'Stephanos AI Core'
Set-Location -LiteralPath '$escapedRepo'
npm --prefix stephanos-server run dev
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($windowScript))
  $process = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $script:repoRoot -WindowStyle Normal -PassThru -ArgumentList @(
    '-NoExit',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', $encoded
  )
  [string]$process.Id | Set-Content -LiteralPath $script:aiCorePidPath -Encoding UTF8
}

function Ensure-VisibleAiCoreWindow([switch]$ForceRestart) {
  $healthReady = Test-WebEndpoint -Url $script:backendHealthUrl
  $missionRouteReady = Test-WebEndpoint -Url $script:backendMissionOperationsUrl
  $visible = Test-AiCoreWindowVisible

  if (-not $ForceRestart.IsPresent -and $healthReady -and $missionRouteReady -and $visible) {
    Write-Host '[IGNITION WRAPPER] Stephanos AI Core is already healthy and visible.'
    return
  }

  Write-Host '[IGNITION WRAPPER] Moving Stephanos AI Core into its own visible window.'
  Stop-RecordedAiCoreWindow
  if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
    Stop-AllowlistedAiCoreProcessTree
  }

  Start-VisibleAiCoreWindow
  Wait-ForWebEndpoint -Url $script:backendHealthUrl -TimeoutSeconds 120
  Wait-ForWebEndpoint -Url $script:backendMissionOperationsUrl -TimeoutSeconds 60
  $null = Test-AiCoreWindowVisible
}

function Wait-ForFullLauncherSplash([System.Diagnostics.Process]$Process, [DateTime]$StartedAtUtc, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { return $false }
    if (Test-Path -LiteralPath $script:launcherStatusPath -PathType Leaf) {
      try {
        $item = Get-Item -LiteralPath $script:launcherStatusPath -ErrorAction Stop
        if ($item.LastWriteTimeUtc -ge $StartedAtUtc.AddSeconds(-2)) {
          $status = Get-Content -LiteralPath $script:launcherStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
          if ($status.primaryUi -eq 'splash-status-browser' -or $status.phase) { return $true }
        }
      }
      catch {}
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-GitHead {
  Push-Location -LiteralPath $script:repoRoot
  try {
    $head = (& git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $head) { return ([string]$head).Trim() }
  }
  finally {
    Pop-Location
  }
  return ''
}

function Start-FullLegacyLauncher {
  $escapedLauncher = ConvertTo-SingleQuotedLiteral $script:legacyLauncherPath
  $escapedRepo = ConvertTo-SingleQuotedLiteral $script:repoRoot
  $escapedMode = ConvertTo-SingleQuotedLiteral $Mode
  $escapedBootMode = ConvertTo-SingleQuotedLiteral $BootMode
  $sharedWorkspaceArgument = ''
  if ($script:workspaceRoot) {
    $escapedWorkspace = ConvertTo-SingleQuotedLiteral $script:workspaceRoot
    $sharedWorkspaceArgument = " -SharedWorkspace '$escapedWorkspace'"
  }
  $switchArguments = ''
  if ($AutoOpen.IsPresent) { $switchArguments += ' -AutoOpen' }
  if ($ReadinessReportOnly.IsPresent) { $switchArguments += ' -ReadinessReportOnly' }
  if ($RepairMissingUi4173.IsPresent) { $switchArguments += ' -RepairMissingUi4173' }
  if ($RepairDryRun.IsPresent) { $switchArguments += ' -RepairDryRun' }

  $childScript = @"
`$ErrorActionPreference = 'Stop'
& '$escapedLauncher' -Mode '$escapedMode' -BootMode '$escapedBootMode' -RepositoryRoot '$escapedRepo'$sharedWorkspaceArgument$switchArguments
exit `$LASTEXITCODE
"@
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
  return Start-Process -FilePath 'powershell.exe' -WorkingDirectory $script:repoRoot -WindowStyle Minimized -PassThru -ArgumentList @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', $encoded
  )
}

$script:repoRoot = Resolve-StephanosRepositoryRoot -RequestedRoot $RepositoryRoot
$script:legacyLauncherPath = Join-Path $script:repoRoot 'windows/Launch-Stephanos-Local.ps1'
$script:workspaceRoot = if ($SharedWorkspace -and $SharedWorkspace.Trim()) {
  $SharedWorkspace.Trim()
}
elseif ($env:STEPHANOS_SHARED_WORKSPACE -and $env:STEPHANOS_SHARED_WORKSPACE.Trim()) {
  $env:STEPHANOS_SHARED_WORKSPACE.Trim()
}
elseif ($env:STEPHANOS_OPENCLAW_WORKSPACE -and $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()) {
  $env:STEPHANOS_OPENCLAW_WORKSPACE.Trim()
}
else {
  Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Stephanos-openclaw-workspace'
}
$script:launcherStatusPath = Join-Path $script:workspaceRoot 'launcher-status.json'
$script:aiCorePidPath = Join-Path $script:workspaceRoot 'status/stephanos-ai-core-window.pid'
$script:backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$script:backendMissionOperationsUrl = 'http://127.0.0.1:8787/api/mission-operations'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:aiCorePidPath) | Out-Null

if ($AllowProofBranch.IsPresent) {
  $env:STEPHANOS_PROOF_WORKTREE_ROOT = $script:repoRoot
}

$headBefore = Get-GitHead
$launcherStartedAtUtc = (Get-Date).ToUniversalTime()
Write-Host '[IGNITION WRAPPER] Delegating to the full existing Stephanos launcher. No legacy ignition features are bypassed.'
$launcherProcess = Start-FullLegacyLauncher

$specialMode = $ReadinessReportOnly.IsPresent -or $RepairMissingUi4173.IsPresent
if (-not $specialMode) {
  $splashObserved = Wait-ForFullLauncherSplash -Process $launcherProcess -StartedAtUtc $launcherStartedAtUtc
  if ($splashObserved) {
    Write-Host '[IGNITION WRAPPER] Full launcher splash is active.'
  }
  else {
    Write-Warning 'The full launcher splash was not observed within the bounded wait; the legacy launcher remains authoritative.'
  }
  Ensure-VisibleAiCoreWindow
}

$launcherProcess.WaitForExit()
$launcherExitCode = $launcherProcess.ExitCode

if ($launcherExitCode -eq 0 -and -not $specialMode) {
  $headAfter = Get-GitHead
  if ($headBefore -and $headAfter -and $headBefore -ne $headAfter) {
    Write-Host '[IGNITION WRAPPER] Source changed during ignition; restarting the visible AI Core from the updated source.'
    Ensure-VisibleAiCoreWindow -ForceRestart
  }
  else {
    Ensure-VisibleAiCoreWindow
  }
}

exit $launcherExitCode
