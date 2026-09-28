[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SessionPath,
    [Parameter(Mandatory)][int]$GameProcessId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Write-JsonNoBom([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
}

$session = Get-Content -LiteralPath $SessionPath -Raw | ConvertFrom-Json
$enteredUtc = [DateTime]::Parse([string]$session.enteredAtUtc).ToUniversalTime()
$currentPid = $GameProcessId
$deadline = $null
$seen = New-Object 'System.Collections.Generic.List[int]'
$seen.Add($currentPid)

try {
    while ($true) {
        $p = Get-Process -Id $currentPid -ErrorAction SilentlyContinue
        if ($p) {
            $deadline = $null
            Start-Sleep -Seconds 1
            continue
        }

        $candidate = Get-CimInstance Win32_Process -Filter "Name='Starfield.exe'" -ErrorAction SilentlyContinue |
            Where-Object {
                $_.CreationDate -and
                ([DateTime]$_.CreationDate).ToUniversalTime() -ge $enteredUtc.AddSeconds(-5) -and
                -not $seen.Contains([int]$_.ProcessId)
            } |
            Sort-Object CreationDate -Descending |
            Select-Object -First 1

        if ($candidate) {
            $currentPid = [int]$candidate.ProcessId
            $seen.Add($currentPid)
            $deadline = $null
            continue
        }

        if (-not $deadline) { $deadline = (Get-Date).AddSeconds(30) }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Seconds 1
    }
}
finally {
    $archiveLog = [string]$session.archiveLogPath
    if (Test-Path -LiteralPath ([string]$session.liveLogPath) -PathType Leaf) {
        Copy-Item -LiteralPath ([string]$session.liveLogPath) -Destination $archiveLog -Force
    }

    if (-not (Test-Path -LiteralPath ([string]$session.baselineBackupPath) -PathType Leaf)) {
        throw 'AER rollback guardian cannot find the validated baseline backup.'
    }
    if ((Get-Sha256 ([string]$session.baselineBackupPath)) -ne ([string]$session.expectedBaselineHash).ToLowerInvariant()) {
        throw 'AER rollback guardian baseline backup hash mismatch.'
    }

    Copy-Item -LiteralPath ([string]$session.baselineBackupPath) -Destination ([string]$session.liveDllPath) -Force
    $restoredHash = Get-Sha256 ([string]$session.liveDllPath)
    $rollbackGreen = $restoredHash -eq ([string]$session.expectedBaselineHash).ToLowerInvariant()

    Remove-Item -LiteralPath ([string]$session.protectFlagPath) -Force -ErrorAction SilentlyContinue

    $sequenceFaultCount = 0
    $aerActiveSeen = $false
    if (Test-Path -LiteralPath $archiveLog -PathType Leaf) {
        $aerLines = @(Get-Content -LiteralPath $archiveLog -ErrorAction SilentlyContinue)
        $sequenceFaultCount = @($aerLines | Where-Object { $_ -like 'SEQUENCE_FAULT,*' }).Count
        $aerActiveSeen = @($aerLines | Where-Object { $_ -like 'ACTIVE,*' }).Count -gt 0
    }
    $protectReady = $rollbackGreen -and $aerActiveSeen -and $sequenceFaultCount -ge 3

    $state = [ordered]@{
        schemaVersion = 'stephanos.vr-mode-state.v1'
        game = 'Starfield'
        route = 'MutaR / OpenXR'
        aer = 'Async OFF / DLSS AER ON'
        stabilizerMode = 'OBSERVE'
        build = 'EXPERIMENTAL'
        rollback = if ($rollbackGreen) { 'RESTORED' } else { 'FAILED' }
        trafficLight = if ($rollbackGreen) { 'green' } else { 'red' }
        modeTraffic = [ordered]@{
            baseline = 'green'
            observe = 'green'
            protect = if ($protectReady) { 'yellow' } else { 'grey' }
            adaptive = 'grey'
        }
        evidence = [ordered]@{
            aerActiveSeen = $aerActiveSeen
            sequenceFaultCount = $sequenceFaultCount
            protectReady = $protectReady
            protectThreshold = 3
        }
        status = 'SESSION_COMPLETE'
        updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        sessionPath = $SessionPath
        aerLogPath = if (Test-Path -LiteralPath $archiveLog) { $archiveLog } else { '' }
        observedGameProcessIds = @($seen)
        restoredHash = $restoredHash
    }
    Write-JsonNoBom ([string]$session.modeStatePath) $state
}
