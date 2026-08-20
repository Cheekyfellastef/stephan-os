[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$schema = 'stephanos.openclaw-gateway-18789-process-proof.v1'

try {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 18789 -ErrorAction Stop | Where-Object {
        $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::')
    })
    $ownerPids = @($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
    if ($ownerPids.Count -ne 1) { throw 'OPENCLAW_18789_LISTENER_OWNER_NOT_UNIQUE' }

    $listener = $listeners | Where-Object { [int]$_.OwningProcess -eq $ownerPids[0] } | Select-Object -First 1
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($ownerPids[0])" -ErrorAction Stop
    $processName = ([string]$process.Name).ToLowerInvariant()
    $executablePath = [string]$process.ExecutablePath
    $commandLine = [string]$process.CommandLine
    $canonicalNode = 'C:\Program Files\nodejs\node.exe'
    $executableCanonical = $processName -eq 'node.exe' `
        -and [System.StringComparer]::OrdinalIgnoreCase.Equals($executablePath, $canonicalNode)
    if ([string]::IsNullOrWhiteSpace([string]$env:APPDATA) -or -not [System.IO.Path]::IsPathFullyQualified([string]$env:APPDATA)) {
        throw 'OPENCLAW_18789_CANONICAL_APPDATA_UNAVAILABLE'
    }
    $canonicalOpenClawRoot = Join-Path ([System.IO.Path]::GetFullPath([string]$env:APPDATA)) 'npm\node_modules\openclaw'
    $canonicalEntrypoints = @(
        (Join-Path $canonicalOpenClawRoot 'dist\index.js'),
        (Join-Path $canonicalOpenClawRoot 'openclaw.mjs')
    )
    $entrypointCanonical = $false
    foreach ($entrypoint in $canonicalEntrypoints) {
        $escapedEntrypoint = [regex]::Escape($entrypoint)
        $entrypointPattern = '(?i)(?:^|[\s"])' + $escapedEntrypoint + '(?=["\s]|$)'
        if ($commandLine -match $entrypointPattern) {
            $entrypointCanonical = $true
            break
        }
    }
    $gatewayCommandCanonical = $commandLine -match '(?i)(?:^|\s)gateway\s+run(?:\s|$)' `
        -or ($commandLine -match '(?i)(?:^|\s)gateway(?:\s|$)' -and $commandLine -match '(?i)(?:^|\s)--port(?:=|\s+)18789(?:\s|$)')
    $commandLineCanonical = $executableCanonical -and $entrypointCanonical -and $gatewayCommandCanonical

    $ancestorPids = @()
    $parentPid = [int]$process.ParentProcessId
    $cursor = $parentPid
    for ($depth = 0; $depth -lt 8 -and $cursor -gt 0; $depth += 1) {
        $ancestorPids += $cursor
        $ancestor = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor" -ErrorAction SilentlyContinue
        if (-not $ancestor) { break }
        $next = [int]$ancestor.ParentProcessId
        if ($next -le 0 -or $next -eq $cursor) { break }
        $cursor = $next
    }
    $lineageCanonical = $parentPid -gt 0 -and $ancestorPids.Count -gt 0
    $ok = $commandLineCanonical -and $lineageCanonical
    [pscustomobject]@{
        schemaVersion = $schema
        ok = [bool]$ok
        pid = [int]$process.ProcessId
        parentPid = $parentPid
        processName = $processName
        executablePath = $executablePath
        executableCanonical = [bool]$executableCanonical
        entrypointCanonical = [bool]$entrypointCanonical
        gatewayCommandCanonical = [bool]$gatewayCommandCanonical
        commandLineCanonical = [bool]$commandLineCanonical
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
