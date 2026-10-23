# Shared read-only Core inventory. Hidden command lines are not proof of an
# absent worker. No process start, termination, lock or lease mutation here.
function ConvertTo-StephanosCoreProcessObservation {
    param(
        [object[]]$ProcessRows = @(),
        [bool]$ObservationSucceeded = $false,
        [Parameter(Mandatory = $true)][string]$CoreScript
    )
    $canonicalNode = 'C:\Program Files\nodejs\node.exe'
    $coreMatches = @()
    $uninspectable = 0
    $complete = $ObservationSucceeded
    $pattern = [regex]::Escape($CoreScript.Replace('/', '\'))
    foreach ($row in @($ProcessRows)) {
        if ($null -eq $row -or -not $row.PSObject.Properties['Name'] -or
            [string]::IsNullOrWhiteSpace([string]$row.Name)) {
            $complete = $false
            continue
        }
        if ([string]$row.Name -ine 'node.exe') { continue }
        $command = if ($row.PSObject.Properties['CommandLine']) { [string]$row.CommandLine } else { '' }
        if ([string]::IsNullOrWhiteSpace($command)) {
            $uninspectable++
            $complete = $false
            continue
        }
        if ($command.Replace('/', '\') -match $pattern) {
            $executable = if ($row.PSObject.Properties['ExecutablePath']) { [string]$row.ExecutablePath } else { '' }
            if (-not [string]::Equals($executable.Replace('/', '\'), $canonicalNode, [StringComparison]::OrdinalIgnoreCase)) {
                $uninspectable++
                $complete = $false
                continue
            }
            $coreMatches += $row
        }
    }
    [pscustomobject]@{
        processes = @($coreMatches)
        complete = [bool]$complete
        processCount = if ($complete) { [int]$coreMatches.Count } else { $null }
        observedMatchingProcessCount = [int]$coreMatches.Count
        uninspectableNodeCount = [int]$uninspectable
        blocker = if ($complete) { '' } else { 'CORE_PROCESS_INVENTORY_UNPROVEN' }
    }
}

function Get-StephanosCoreProcessObservation {
    param([Parameter(Mandatory = $true)][string]$CoreScript)
    try {
        $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        ConvertTo-StephanosCoreProcessObservation -ProcessRows $rows -ObservationSucceeded $true -CoreScript $CoreScript
    } catch {
        ConvertTo-StephanosCoreProcessObservation -ObservationSucceeded $false -CoreScript $CoreScript
    }
}
