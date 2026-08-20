[CmdletBinding()]
param(
    [ValidateRange(0, 2147483647)]
    [int]$ExpectedStarterPid = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
$schema = 'stephanos.openclaw-gateway-18789-process-proof.v1'

function ConvertFrom-WindowsCommandLine {
    param([string]$CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return @() }
    if (-not ('StephanosOpenClawGatewayCommandLineNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class StephanosOpenClawGatewayCommandLineNative {
    [DllImport("shell32.dll", SetLastError = true)]
    public static extern IntPtr CommandLineToArgvW(
        [MarshalAs(UnmanagedType.LPWStr)] string commandLine,
        out int argumentCount);

    [DllImport("kernel32.dll")]
    public static extern IntPtr LocalFree(IntPtr memory);
}
'@
    }

    $argumentCount = 0
    $argvPointer = [StephanosOpenClawGatewayCommandLineNative]::CommandLineToArgvW(
        $CommandLine,
        [ref]$argumentCount
    )
    if ($argvPointer -eq [IntPtr]::Zero -or $argumentCount -le 0) { return @() }

    try {
        $arguments = New-Object string[] $argumentCount
        for ($index = 0; $index -lt $argumentCount; $index += 1) {
            $itemPointer = [Runtime.InteropServices.Marshal]::ReadIntPtr(
                $argvPointer,
                $index * [IntPtr]::Size
            )
            $arguments[$index] = [Runtime.InteropServices.Marshal]::PtrToStringUni($itemPointer)
        }
        return $arguments
    } finally {
        [void][StephanosOpenClawGatewayCommandLineNative]::LocalFree($argvPointer)
    }
}

function Get-ProcessOwnerSid {
    param([object]$Process)

    if (-not $Process) { return '' }
    $owner = Invoke-CimMethod -InputObject $Process -MethodName GetOwnerSid -ErrorAction Stop
    if ([int]$owner.ReturnValue -ne 0) { return '' }
    return [string]$owner.Sid
}

function Test-CanonicalPathToken {
    param(
        [string]$Observed,
        [string]$Expected
    )

    try {
        return [System.StringComparer]::OrdinalIgnoreCase.Equals(
            [System.IO.Path]::GetFullPath($Observed),
            [System.IO.Path]::GetFullPath($Expected)
        )
    } catch {
        return $false
    }
}

function Test-FullyQualifiedWindowsPath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) { return $false }
    try {
        $root = [System.IO.Path]::GetPathRoot($PathValue)
        if ([string]::IsNullOrWhiteSpace($root)) { return $false }
        if ($root -match '^[A-Za-z]:\\$') { return $true }
        if ($root.StartsWith('\\')) {
            return @($root -split '\\' | Where-Object { $_ }).Count -ge 2
        }
        return $false
    } catch {
        return $false
    }
}

try {
    # The HTTP proof is fetched from 127.0.0.1. Proving a different loopback
    # family or wildcard listener would not bind the responder to this PID.
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 18789 -ErrorAction Stop | Where-Object {
        $_.LocalAddress -eq '127.0.0.1'
    })
    $ownerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    if ($ownerPids.Count -ne 1) { throw 'OPENCLAW_18789_LISTENER_OWNER_NOT_UNIQUE' }

    $listener = $listeners | Where-Object { [int]$_.OwningProcess -eq $ownerPids[0] } | Select-Object -First 1
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($ownerPids[0])" -ErrorAction Stop
    $processName = ([string]$process.Name).ToLowerInvariant()
    $executablePath = [string]$process.ExecutablePath
    $commandLine = [string]$process.CommandLine
    $commandTokens = @(ConvertFrom-WindowsCommandLine -CommandLine $commandLine)
    $canonicalNode = 'C:\Program Files\nodejs\node.exe'
    $executableCanonical = $processName -eq 'node.exe' `
        -and [System.StringComparer]::OrdinalIgnoreCase.Equals($executablePath, $canonicalNode)
    if (-not (Test-FullyQualifiedWindowsPath -PathValue ([string]$env:APPDATA))) {
        throw 'OPENCLAW_18789_CANONICAL_APPDATA_UNAVAILABLE'
    }
    $canonicalOpenClawRoot = Join-Path ([System.IO.Path]::GetFullPath([string]$env:APPDATA)) 'npm\node_modules\openclaw'
    $canonicalEntrypoints = @(
        (Join-Path $canonicalOpenClawRoot 'dist\index.js'),
        (Join-Path $canonicalOpenClawRoot 'openclaw.mjs')
    )
    $executableTokenCanonical = $commandTokens.Count -ge 1 `
        -and (Test-CanonicalPathToken -Observed ([string]$commandTokens[0]) -Expected $canonicalNode)
    $entrypointToken = if ($commandTokens.Count -ge 2) { [string]$commandTokens[1] } else { '' }
    $entrypointCanonical = $commandTokens.Count -ge 4 -and @($canonicalEntrypoints | Where-Object {
        Test-CanonicalPathToken -Observed $entrypointToken -Expected $_
    }).Count -eq 1
    $gatewayRunCommandCanonical = $commandTokens.Count -eq 4 `
        -and [string]::Equals([string]$commandTokens[2], 'gateway', [System.StringComparison]::Ordinal) `
        -and [string]::Equals([string]$commandTokens[3], 'run', [System.StringComparison]::Ordinal)
    $gatewayPortCommandCanonical = $commandTokens.Count -eq 5 `
        -and [string]::Equals([string]$commandTokens[2], 'gateway', [System.StringComparison]::Ordinal) `
        -and [string]::Equals([string]$commandTokens[3], '--port', [System.StringComparison]::Ordinal) `
        -and [string]::Equals([string]$commandTokens[4], '18789', [System.StringComparison]::Ordinal)
    $gatewayCommandCanonical = $gatewayRunCommandCanonical -or $gatewayPortCommandCanonical
    $commandLineCanonical = $executableCanonical `
        -and $executableTokenCanonical `
        -and $entrypointCanonical `
        -and $gatewayCommandCanonical

    $currentOwnerSid = [string][System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $processOwnerSid = Get-ProcessOwnerSid -Process $process
    $ownerSidMatches = $currentOwnerSid -match '^S-1-(?:[0-9]+-)+[0-9]+$' `
        -and [string]::Equals($processOwnerSid, $currentOwnerSid, [System.StringComparison]::OrdinalIgnoreCase)

    $ancestorPids = @()
    $supportedStarterPids = @()
    $supportedStarterExecutablePath = ''
    $supportedStarterGatewayPath = ''
    $supportedStarterCommandShape = ''
    $parentPid = [int]$process.ParentProcessId
    $cursor = $parentPid
    if (-not (Test-FullyQualifiedWindowsPath -PathValue ([string]$env:USERPROFILE))) {
        throw 'OPENCLAW_18789_CANONICAL_USERPROFILE_UNAVAILABLE'
    }
    $canonicalCmd = 'C:\Windows\System32\cmd.exe'
    $canonicalGatewayStarter = Join-Path ([System.IO.Path]::GetFullPath([string]$env:USERPROFILE)) '.openclaw\gateway.cmd'
    for ($depth = 0; $depth -lt 8 -and $cursor -gt 0; $depth += 1) {
        $ancestorPids += $cursor
        $ancestor = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction SilentlyContinue
        if (-not $ancestor) { break }
        $ancestorOwnerSid = try { Get-ProcessOwnerSid -Process $ancestor } catch { '' }
        $ancestorExecutablePath = [string]$ancestor.ExecutablePath
        $ancestorTokens = @(ConvertFrom-WindowsCommandLine -CommandLine ([string]$ancestor.CommandLine))
        $starterCmdCShape = $ancestorTokens.Count -eq 3 `
            -and (Test-CanonicalPathToken -Observed ([string]$ancestorTokens[0]) -Expected $canonicalCmd) `
            -and [string]::Equals([string]$ancestorTokens[1], '/c', [System.StringComparison]::OrdinalIgnoreCase) `
            -and (Test-CanonicalPathToken -Observed ([string]$ancestorTokens[2]) -Expected $canonicalGatewayStarter)
        $starterCmdDscShape = $ancestorTokens.Count -eq 5 `
            -and (Test-CanonicalPathToken -Observed ([string]$ancestorTokens[0]) -Expected $canonicalCmd) `
            -and [string]::Equals([string]$ancestorTokens[1], '/d', [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]::Equals([string]$ancestorTokens[2], '/s', [System.StringComparison]::OrdinalIgnoreCase) `
            -and [string]::Equals([string]$ancestorTokens[3], '/c', [System.StringComparison]::OrdinalIgnoreCase) `
            -and (Test-CanonicalPathToken -Observed ([string]$ancestorTokens[4]) -Expected $canonicalGatewayStarter)
        $starterCommandCanonical = (Test-CanonicalPathToken -Observed $ancestorExecutablePath -Expected $canonicalCmd) `
            -and ($starterCmdCShape -or $starterCmdDscShape)
        if ($starterCommandCanonical -and [string]::Equals($ancestorOwnerSid, $currentOwnerSid, [System.StringComparison]::OrdinalIgnoreCase)) {
            $supportedStarterPids += [int]$ancestor.ProcessId
            if (-not $supportedStarterExecutablePath) { $supportedStarterExecutablePath = $ancestorExecutablePath }
            if (-not $supportedStarterGatewayPath) { $supportedStarterGatewayPath = if ($starterCmdCShape) { [string]$ancestorTokens[2] } else { [string]$ancestorTokens[4] } }
            if (-not $supportedStarterCommandShape) { $supportedStarterCommandShape = if ($starterCmdCShape) { 'cmd-c' } else { 'cmd-d-s-c' } }
        }
        $next = [int]$ancestor.ParentProcessId
        if ($next -le 0 -or $next -eq $cursor) { break }
        $cursor = $next
    }
    $expectedStarterLineage = $ExpectedStarterPid -gt 0 `
        -and ([int]$process.ProcessId -eq $ExpectedStarterPid `
            -or @($ancestorPids | Where-Object { $_ -eq $ExpectedStarterPid }).Count -eq 1)
    $canonicalGatewayStarterLineage = $supportedStarterPids.Count -gt 0
    $starterPidBound = $expectedStarterLineage -or $canonicalGatewayStarterLineage
    $supportedStarterLineage = $parentPid -gt 0 -and ($expectedStarterLineage -or $canonicalGatewayStarterLineage)
    $starterLineageKind = if ($expectedStarterLineage) { 'expected-starter-pid' } elseif ($canonicalGatewayStarterLineage) { 'canonical-gateway-cmd' } else { '' }
    $starterCommandCanonical = $expectedStarterLineage -or $canonicalGatewayStarterLineage
    $lineageCanonical = $supportedStarterLineage -and $starterPidBound -and $starterCommandCanonical
    $ok = $commandLineCanonical -and $ownerSidMatches -and $lineageCanonical
    [pscustomobject]@{
        schemaVersion = $schema
        ok = [bool]$ok
        pid = [int]$process.ProcessId
        parentPid = $parentPid
        processName = $processName
        executablePath = $executablePath
        executableCanonical = [bool]$executableCanonical
        executableTokenCanonical = [bool]$executableTokenCanonical
        executableToken = if ($commandTokens.Count -ge 1) { [string]$commandTokens[0] } else { '' }
        entrypointCanonical = [bool]$entrypointCanonical
        entrypointToken = $entrypointToken
        gatewayCommandCanonical = [bool]$gatewayCommandCanonical
        gatewayToken = if ($commandTokens.Count -ge 3) { [string]$commandTokens[2] } else { '' }
        gatewayActionToken = if ($commandTokens.Count -ge 4) { [string]$commandTokens[3] } else { '' }
        gatewayPortToken = if ($commandTokens.Count -ge 5) { [string]$commandTokens[4] } else { '' }
        commandTokenCount = $commandTokens.Count
        commandLineCanonical = [bool]$commandLineCanonical
        currentOwnerSid = $currentOwnerSid
        processOwnerSid = $processOwnerSid
        ownerSidMatches = [bool]$ownerSidMatches
        expectedStarterPid = $ExpectedStarterPid
        starterPidBound = [bool]$starterPidBound
        supportedStarterLineage = [bool]$supportedStarterLineage
        starterLineageKind = $starterLineageKind
        starterCommandCanonical = [bool]$starterCommandCanonical
        supportedStarterPid = if ($expectedStarterLineage) { $ExpectedStarterPid } elseif ($supportedStarterPids.Count -gt 0) { [int]$supportedStarterPids[0] } else { 0 }
        supportedStarterExecutablePath = if ($expectedStarterLineage -and [int]$process.ProcessId -eq $ExpectedStarterPid) { $executablePath } else { $supportedStarterExecutablePath }
        supportedStarterGatewayPath = $supportedStarterGatewayPath
        supportedStarterCommandShape = if ($expectedStarterLineage) { 'expected-starter-pid' } else { $supportedStarterCommandShape }
        lineageCanonical = [bool]$lineageCanonical
        ancestorPids = @($ancestorPids)
        listenerCount = $ownerPids.Count
        localAddress = [string]$listener.LocalAddress
    } | ConvertTo-Json -Compress -Depth 4
    if (-not $ok) { exit 2 }
} catch {
    [pscustomobject]@{
        schemaVersion = $schema
        ok = $false
        blocker = if ($_.Exception.Message) { [string]$_.Exception.Message } else { 'OPENCLAW_18789_PROCESS_PROOF_FAILED' }
    } | ConvertTo-Json -Compress
    exit 2
}
