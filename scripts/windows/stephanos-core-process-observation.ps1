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
    $diagnosticCode = if ($ObservationSucceeded) { '' } else { 'CORE_PROCESS_QUERY_FAILED' }
    $pattern = [regex]::Escape($CoreScript.Replace('/', '\'))
    foreach ($row in @($ProcessRows)) {
        if ($null -eq $row -or -not $row.PSObject.Properties['Name'] -or
            [string]::IsNullOrWhiteSpace([string]$row.Name)) {
            $complete = $false
            if (-not $diagnosticCode) { $diagnosticCode = 'CORE_PROCESS_ROW_UNPROVEN' }
            continue
        }
        if ([string]$row.Name -ine 'node.exe') { continue }
        $command = if ($row.PSObject.Properties['CommandLine']) { [string]$row.CommandLine } else { '' }
        if ([string]::IsNullOrWhiteSpace($command)) {
            $uninspectable++
            $complete = $false
            if (-not $diagnosticCode) { $diagnosticCode = 'CORE_PROCESS_COMMAND_LINE_UNAVAILABLE' }
            continue
        }
        if ($command.Replace('/', '\') -match $pattern) {
            $executable = if ($row.PSObject.Properties['ExecutablePath']) { [string]$row.ExecutablePath } else { '' }
            if (-not [string]::Equals($executable.Replace('/', '\'), $canonicalNode, [StringComparison]::OrdinalIgnoreCase)) {
                $uninspectable++
                $complete = $false
                if (-not $diagnosticCode) {
                    $diagnosticCode = if ([string]::IsNullOrWhiteSpace($executable)) { 'CORE_PROCESS_IMAGE_UNAVAILABLE' } else { 'CORE_PROCESS_IMAGE_MISMATCH' }
                }
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
        diagnosticCode = $diagnosticCode
        nativeImageFallbackCount = 0
    }
}

function Get-StephanosCoreProcessObservation {
    param([Parameter(Mandatory = $true)][string]$CoreScript)
    try {
        $rows = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        $resolved = 0
        $attempted = 0
        $nativeFailure = ''
        $nativeReaderLoaded = $false
        $pattern = [regex]::Escape($CoreScript.Replace('/', '\'))
        $expectedCoreCommand = '"C:\Program Files\nodejs\node.exe" "' + $CoreScript.Replace('/', '\') + '"'
        $observedRows = @(foreach ($row in $rows) {
            # A native image observation fills only the missing image of an
            # already visible Core command, bound to its original CIM birth.
            # Opaque commands and noncanonical reported images stay unknown.
            if ($null -ne $row -and $row.PSObject.Properties['Name'] -and [string]$row.Name -ieq 'node.exe' -and
                $row.PSObject.Properties['CommandLine'] -and -not [string]::IsNullOrWhiteSpace([string]$row.CommandLine) -and
                ([string]$row.CommandLine).Replace('/', '\') -match $pattern -and
                (-not $row.PSObject.Properties['ExecutablePath'] -or [string]::IsNullOrWhiteSpace([string]$row.ExecutablePath))) {
                # Native fallback accepts only the fixed launcher's full
                # command, never a script suffix, eval text or extra argument.
                if (-not [string]::Equals(([string]$row.CommandLine).Trim().Replace('/', '\'), $expectedCoreCommand, [StringComparison]::OrdinalIgnoreCase)) {
                    if (-not $nativeFailure) { $nativeFailure = 'CORE_PROCESS_COMMAND_LINE_MISMATCH' }
                    $row
                    continue
                }
                if ($attempted -lt 64) {
                    $attempted++
                    if (-not $nativeReaderLoaded) {
                        # This fallback is a normal-token observation only. An
                        # elevated caller must never load checkout helper bytes.
                        $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
                        if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
                            $nativeFailure = 'CORE_PROCESS_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN'
                            $row
                            continue
                        }
                        # Never execute a mutable filesystem path by dot-sourcing.
                        # Bind the exact canonical UTF-8 source bytes, then execute
                        # only that verified in-memory ScriptBlock.
                        $ownerNativePath = Join-Path $PSScriptRoot 'read-sovereign-maintenance-owner-v2.ps1'
                        $ownerNativeBytes = [IO.File]::ReadAllBytes($ownerNativePath)
                        if ($ownerNativeBytes.Length -lt 1 -or $ownerNativeBytes.Length -gt 16384) {
                            throw 'CORE_PROCESS_NATIVE_HELPER_BYTES_UNPROVEN'
                        }
                        $utf8 = [Text.UTF8Encoding]::new($false, $true)
                        $canonicalSource = $utf8.GetString($ownerNativeBytes).Replace(([string][char]13 + [string][char]10), [string][char]10)
                        if ($canonicalSource.Contains([char]13)) { throw 'CORE_PROCESS_NATIVE_HELPER_BYTES_UNPROVEN' }
                        $canonicalBytes = [Text.Encoding]::UTF8.GetBytes($canonicalSource)
                        $digest = [Security.Cryptography.SHA256]::Create()
                        try {
                            $sourceDigest = ([BitConverter]::ToString($digest.ComputeHash($canonicalBytes))).Replace('-', '').ToLowerInvariant()
                        } finally { $digest.Dispose() }
                        if ($sourceDigest -cne 'd3c82d73d6d1354864e006179a4e3840294fc738b84c731305d3154a027bf956') {
                            throw 'CORE_PROCESS_NATIVE_HELPER_SOURCE_UNPROVEN'
                        }
                        . ([ScriptBlock]::Create($canonicalSource))
                        $nativeReaderLoaded = $true
                    }
                    $native = Get-StephanosCanonicalNodeIdentityV1 -ProcessRow $row
                    if ($native.ok -eq $true -and $native.diagnosticCode -ceq '') {
                        $resolved++
                        [pscustomobject]@{ Name = [string]$row.Name; ProcessId = $row.ProcessId;
                            CommandLine = [string]$row.CommandLine; CreationDate = $row.CreationDate;
                            ExecutablePath = 'C:\Program Files\nodejs\node.exe' }
                        continue
                    }
                    if (-not $nativeFailure) {
                        $nativeFailure = switch -Exact ([string]$native.diagnosticCode) {
                            'OWNER_PROCESS_BIRTH_UNAVAILABLE' { 'CORE_PROCESS_BIRTH_UNAVAILABLE' }
                            'OWNER_PROCESS_UNPROVEN' { 'CORE_PROCESS_IDENTITY_UNPROVEN' }
                            default { ([string]$native.diagnosticCode).Replace('OWNER_', 'CORE_PROCESS_') }
                        }
                    }
                } elseif (-not $nativeFailure) { $nativeFailure = 'CORE_PROCESS_NATIVE_OBSERVATION_BOUND_EXCEEDED' }
            }
            $row
        })
        $observation = ConvertTo-StephanosCoreProcessObservation -ProcessRows $observedRows -ObservationSucceeded $true -CoreScript $CoreScript
        $observation.nativeImageFallbackCount = [int]$resolved
        if ($observation.diagnosticCode -ceq 'CORE_PROCESS_IMAGE_UNAVAILABLE' -and $nativeFailure) {
            $observation.diagnosticCode = $nativeFailure
        }
        $observation
    } catch {
        ConvertTo-StephanosCoreProcessObservation -ObservationSucceeded $false -CoreScript $CoreScript
    }
}
