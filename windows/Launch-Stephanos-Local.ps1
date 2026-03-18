[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendHealthUrl = 'http://127.0.0.1:8787/api/health'
$uiUrl = 'http://localhost:5173/'

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

function Ensure-NpmDependencies([string]$RelativePath) {
  $targetPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { $repoRoot } else { Join-Path $repoRoot $RelativePath }
  $packageJsonPath = Join-Path $targetPath 'package.json'
  $nodeModulesPath = Join-Path $targetPath 'node_modules'

  if (-not (Test-Path $packageJsonPath)) {
    return
  }

  if (Test-Path $nodeModulesPath) {
    return
  }

  $displayPath = if ([string]::IsNullOrWhiteSpace($RelativePath)) { '.' } else { $RelativePath }
  Write-LiveLog "Installing dependencies in $displayPath"
  Push-Location $repoRoot
  try {
    if ([string]::IsNullOrWhiteSpace($RelativePath)) {
      & npm install
    }
    else {
      & npm --prefix $RelativePath install
    }

    if ($LASTEXITCODE -ne 0) {
      throw "npm install failed in $displayPath"
    }
  }
  finally {
    Pop-Location
  }
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

function Wait-ForUrl([string]$StepLabel, [string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    }
    catch {
      Start-Sleep -Seconds 1
      continue
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for $StepLabel at $Url"
}

try {
  Ensure-NpmDependencies ''
  Ensure-NpmDependencies 'stephanos-ui'
  Ensure-NpmDependencies 'stephanos-server'

  Write-LiveLog 'Starting backend'
  Start-DevWindow -Title 'Stephanos Backend' -Command 'npm --prefix stephanos-server run dev'

  Write-LiveLog 'Starting UI'
  Start-DevWindow -Title 'Stephanos UI' -Command 'npm --prefix stephanos-ui run dev'

  Write-LiveLog 'Waiting for backend'
  Wait-ForUrl -StepLabel 'backend' -Url $backendHealthUrl

  Write-LiveLog 'Waiting for UI'
  Wait-ForUrl -StepLabel 'UI' -Url $uiUrl

  Write-LiveLog 'Opening browser at http://localhost:5173/'
  Start-Process $uiUrl | Out-Null
}
catch {
  $failedStep = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'unknown step' }
  Fail-Step -Step $failedStep -ErrorRecord $_
}
