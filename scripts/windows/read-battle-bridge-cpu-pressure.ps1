[CmdletBinding()]
param()

# Fixed, read-only diagnostic. No caller-selected command, PID, path or task.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$processNames = @('powershell','pwsh','node','MsMpEng','ollama','llama-server','msedge','brave','chrome','firefox','ChatGPT','msedgewebview2')
# Fixed vendor/product process names only. Never inspect browser URLs, tab
# titles, session contents, cookies, extensions or command-line switches.
$browserNames = @('msedge','brave','chrome','firefox','ChatGPT','msedgewebview2')
$scriptNames = @(
    'run-vr-resource-governor.ps1',
    'run-battle-bridge-recovery-lifeboat-active-v1.ps1',
    'run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
    'battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
    'Launch-Stephanos-Local.ps1',
    'Invoke-Stephanos-Ignite-With-Approval.ps1',
    'start-mission-orchestrator-worker.ps1',
    'stephanos-core-daemon.mjs',
    'mission-orchestrator-worker-supervised.mjs',
    'sovereign-commander-mcp.mjs',
    'serve-stephanos-dist.mjs',
    'battle-bridge-sovereign-relay-daemon.mjs'
)
$start = [Diagnostics.Stopwatch]::StartNew()
$before = @{}
foreach ($p in @(Get-Process -Name $processNames -ErrorAction SilentlyContinue)) {
    try {
        $before[[int]$p.Id] = @{
            Cpu = [double]$p.CPU
            StartedTicks = $p.StartTime.Ticks
        }
    } catch {}
}
Start-Sleep -Seconds 5
$after = @(Get-Process -Name $processNames -ErrorAction SilentlyContinue)
$start.Stop()
$sampleSeconds = [math]::Max(0.001, $start.Elapsed.TotalSeconds)
$byPid = @{}
$metadataAvailable = $true
try {
    $metadata = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe' OR Name='node.exe' OR Name='MsMpEng.exe' OR Name='ollama.exe' OR Name='llama-server.exe'" -ErrorAction Stop)
    foreach ($item in $metadata) { $byPid[[int]$item.ProcessId] = $item }
} catch { $metadataAvailable = $false }
$rows = @(
    foreach ($p in $after) {
        $processId = [int]$p.Id
        $old = $before[$processId]
        $cpu = $null
        $started = ''
        $matched = $false
        try {
            $startTime = $p.StartTime
            $started = $startTime.ToUniversalTime().ToString('o')
            if ($old -and $old.StartedTicks -eq $startTime.Ticks) {
                $cpu = [math]::Round([math]::Max(0, ([double]$p.CPU - $old.Cpu) * 100 / $sampleSeconds / [Environment]::ProcessorCount), 2)
                $matched = $true
            }
        } catch {}
        $meta = $byPid[$processId]
        # CIM metadata is advisory only after proving its creation time matches
        # this exact sampled process. Never attribute a reused PID to old work.
        if ($meta) {
            try {
                $sampleStartUtc = $p.StartTime.ToUniversalTime()
                $metadataStartUtc = $meta.CreationDate.ToUniversalTime()
                # WMI may round sub-millisecond Windows FILETIME precision.
                # A different process (including same-second PID reuse) fails.
                if ([math]::Abs(($sampleStartUtc - $metadataStartUtc).TotalMilliseconds) -gt 2) { $meta = $null }
            } catch { $meta = $null }
        }
        $parentId = if ($meta) { [int]$meta.ParentProcessId } else { 0 }
        $script = ''
        if ($meta) {
            foreach ($hit in [regex]::Matches([string]$meta.CommandLine, '(?i)[a-z0-9_.-]+\.(?:ps1|mjs|js)')) {
                $candidate = [string]$hit.Value
                if ($scriptNames -contains $candidate) { $script = $candidate; break }
            }
        }
        [pscustomobject]@{
            pid = $processId
            processName = [string]$p.ProcessName
            parentPid = $parentId
            startedAtUtc = $started
            cpuPercent = $cpu
            sampleMatched = $matched
            script = $script
        }
    }
)
$systemCpuPct = $null
$systemCpuMeasured = $false
try {
    $cpuPackages = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
    if ($cpuPackages.Count -gt 0 -and @($cpuPackages | Where-Object { $null -eq $_.LoadPercentage }).Count -eq 0) {
        $total = [double](($cpuPackages | Measure-Object -Property LoadPercentage -Average).Average)
        if (-not [double]::IsNaN($total) -and -not [double]::IsInfinity($total) -and $total -ge 0 -and $total -le 100) {
            $systemCpuPct = [math]::Round($total, 2)
            $systemCpuMeasured = $true
        }
    }
} catch {
    # Never convert missing OS counters into a misleading 0% CPU claim.
    $systemCpuPct = $null
    $systemCpuMeasured = $false
}
# Aggregate the full process family before trimming the top-N PID display.
# This includes idle browser subprocesses without copying tab titles or URLs.
$browserApps = @(
    foreach ($browser in $browserNames) {
        $members = @($rows | Where-Object { $_.processName -ieq $browser })
        $measured = @($members | Where-Object { $_.sampleMatched -eq $true -and $null -ne $_.cpuPercent })
        $groupCpu = $null
        if ($members.Count -eq 0) { $groupCpu = 0.0 }
        elseif ($measured.Count -eq $members.Count) {
            $groupCpu = [math]::Round([double](($measured | Measure-Object -Property cpuPercent -Sum).Sum), 2)
        }
        $memoryBytes = [double]0
        $memoryMeasuredCount = 0
        foreach ($p in $after) {
            if ($p.ProcessName -ine $browser) { continue }
            try {
                $memoryBytes += [double]$p.WorkingSet64
                $memoryMeasuredCount++
            } catch {}
        }
        [pscustomobject]@{
            app = $browser
            processCount = $members.Count
            cpuSampledCount = $measured.Count
            cpuPercent = $groupCpu
            workingSetMiB = if ($memoryMeasuredCount -eq $members.Count) { [math]::Round($memoryBytes / 1MB, 1) } else { $null }
        }
    }
)
$selected = @($rows | Sort-Object @{Expression={if ($null -eq $_.cpuPercent) {-1} else {$_.cpuPercent}};Descending=$true} | Select-Object -First 20)
[pscustomobject]@{
    schemaVersion = 'stephanos.battle-bridge-cpu-pressure.v1'
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    sampleSeconds = [math]::Round($sampleSeconds, 2)
    processorCount = [Environment]::ProcessorCount
    metadataAvailable = $metadataAvailable
    systemCpuMeasured = $systemCpuMeasured
    systemCpuPct = $systemCpuPct
    browserApps = $browserApps
    browserTabsInspected = $false
    browserProfilesInspected = $false
    rows = $selected
    readOnly = $true
    sourceMutationAllowed = $false
    processTerminationAllowed = $false
    arbitraryShellAllowed = $false
    arbitraryProcessInspectionAllowed = $false
    rawCommandLinesReturned = $false
    rawPathsReturned = $false
    secretMaterialIncluded = $false
    unknownMeansGreen = $false
    finalVerdict = 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED'
} | ConvertTo-Json -Depth 5 -Compress
