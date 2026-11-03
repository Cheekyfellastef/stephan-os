[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$healthUrl = 'http://127.0.0.1:8787/api/health'

function Stop-WithBlocker {
    param([Parameter(Mandatory = $true)][string]$Code)
    throw $Code
}

function Convert-ProcessCreationDateToUtcText {
    param([object]$CreationDate)
    if ($CreationDate -is [DateTime]) {
        return ([DateTime]$CreationDate).ToUniversalTime().ToString('o')
    }
    if ($CreationDate -is [DateTimeOffset]) {
        return ([DateTimeOffset]$CreationDate).ToUniversalTime().ToString('o')
    }
    $creationText = [string]$CreationDate
    if ([string]::IsNullOrWhiteSpace($creationText)) { Stop-WithBlocker 'LEGACY_BACKEND_CREATION_TIME_MISSING' }
    return [System.Management.ManagementDateTimeConverter]::ToDateTime($creationText).ToUniversalTime().ToString('o')
}

function Test-ExactLegacyBackendCommandLine {
    param([string]$CommandLine)
    $normalized = (([string]$CommandLine -replace '\s+', ' ').Trim())
    $expected = @(
        'node stephanos-server/server.js',
        'node.exe stephanos-server/server.js',
        "`"$canonicalNode`" stephanos-server/server.js",
        "$canonicalNode stephanos-server/server.js"
    )
    return @($expected | Where-Object {
        [string]::Equals($normalized, $_, [System.StringComparison]::OrdinalIgnoreCase)
    }).Count -eq 1
}

function Read-CanonicalLegacyListener {
    $connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    $processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -ne 1) { Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_IDENTITY_AMBIGUOUS' }
    $processId = [int]$processIds[0]
    if ($processId -le 0) { Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_PID_INVALID' }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $process) { Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_PROCESS_MISSING' }
    $executable = [System.IO.Path]::GetFullPath([string]$process.ExecutablePath)
    if (-not [string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_NOT_CANONICAL_NODE'
    }
    if (-not (Test-ExactLegacyBackendCommandLine -CommandLine ([string]$process.CommandLine))) {
        Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_COMMAND_NOT_EXACT'
    }
    return [PSCustomObject]@{
        ProcessId = $processId
        CreationTimeUtc = Convert-ProcessCreationDateToUtcText -CreationDate $process.CreationDate
        CommandLine = (([string]$process.CommandLine -replace '\s+', ' ').Trim())
    }
}

function Read-CanonicalBackendHealth {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
        if ($response.StatusCode -ne 200) { Stop-WithBlocker 'LEGACY_BACKEND_HEALTH_HTTP_NOT_OK' }
        $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
        if ([string]$payload.schemaVersion -ne 'stephanos.backend-health.v1') {
            Stop-WithBlocker 'LEGACY_BACKEND_HEALTH_SCHEMA_INVALID'
        }
        if ([string]$payload.backendIdentity.runtimeId -ne 'stephanos-battle-bridge-backend') {
            Stop-WithBlocker 'LEGACY_BACKEND_HEALTH_RUNTIME_ID_INVALID'
        }
        $sourceHead = ([string]$payload.backendIdentity.sourceHead).Trim().ToLowerInvariant()
        if ($sourceHead -notmatch '^[0-9a-f]{40}$') { Stop-WithBlocker 'LEGACY_BACKEND_HEALTH_SOURCE_HEAD_INVALID' }
        return [PSCustomObject]@{ SourceHead = $sourceHead }
    }
    catch {
        if ([string]$_.Exception.Message -like 'LEGACY_BACKEND_*') { throw }
        Stop-WithBlocker 'LEGACY_BACKEND_HEALTH_UNVERIFIABLE'
    }
}

try {
    if (-not $env:USERPROFILE) { Stop-WithBlocker 'USERPROFILE_REQUIRED' }
    foreach ($path in @($canonicalNode, $canonicalGit)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Stop-WithBlocker 'LEGACY_BACKEND_CANONICAL_EXECUTABLE_MISSING' }
    }

    $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git') -PathType Container)) {
        Stop-WithBlocker 'LEGACY_BACKEND_CANONICAL_REPOSITORY_MISSING'
    }
    $ExpectedHead = $ExpectedHead.Trim().ToLowerInvariant()
    $branch = (& $canonicalGit -C $repoRoot branch --show-current).Trim()
    $head = (& $canonicalGit -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
    $originHead = (& $canonicalGit -C $repoRoot rev-parse origin/main).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main' -or $head -ne $ExpectedHead -or $originHead -ne $ExpectedHead) {
        Stop-WithBlocker 'LEGACY_BACKEND_EXACT_MAIN_NOT_PROVEN'
    }

    $listenerBefore = Read-CanonicalLegacyListener
    $health = Read-CanonicalBackendHealth
    if ($health.SourceHead -eq $ExpectedHead) { Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_ALREADY_CURRENT' }

    & $canonicalGit -C $repoRoot cat-file -e "$($health.SourceHead)^{commit}" 2>$null
    if ($LASTEXITCODE -ne 0) { Stop-WithBlocker 'LEGACY_BACKEND_STALE_SOURCE_COMMIT_MISSING' }
    & $canonicalGit -C $repoRoot merge-base --is-ancestor $health.SourceHead $ExpectedHead 2>$null
    if ($LASTEXITCODE -ne 0) { Stop-WithBlocker 'LEGACY_BACKEND_STALE_SOURCE_NOT_ANCESTOR' }

    $listenerAfter = Read-CanonicalLegacyListener
    if ($listenerAfter.ProcessId -ne $listenerBefore.ProcessId `
        -or $listenerAfter.CreationTimeUtc -ne $listenerBefore.CreationTimeUtc `
        -or -not [string]::Equals($listenerAfter.CommandLine, $listenerBefore.CommandLine, [System.StringComparison]::Ordinal)) {
        Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_IDENTITY_CHANGED'
    }

    $headImmediatelyBeforeMutation = (& $canonicalGit -C $repoRoot rev-parse HEAD).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $headImmediatelyBeforeMutation -ne $ExpectedHead) {
        Stop-WithBlocker 'LEGACY_BACKEND_EXPECTED_HEAD_CHANGED'
    }

    Stop-Process -Id $listenerAfter.ProcessId -Force -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(30)
    do {
        if (@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if (@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue).Count -ne 0) {
        Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_DID_NOT_STOP'
    }

    [PSCustomObject]@{
        schemaVersion = 'stephanos.legacy-backend-listener-migration.v1'
        ok = $true
        finalVerdict = 'LEGACY_BACKEND_LISTENER_MIGRATED'
        expectedHead = $ExpectedHead
        replacedSourceHead = $health.SourceHead
        canonicalNodeVerified = $true
        legacyCommandVerified = $true
        healthIdentityVerified = $true
        staleSourceAncestor = $true
        stableProcessIdentity = $true
        terminatedVerifiedOwnedProcess = $true
        arbitraryPidAllowed = $false
        arbitraryExecutableAllowed = $false
        arbitraryCommandAllowed = $false
        arbitraryTaskAllowed = $false
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        pcRestartAllowed = $false
        liveOpenClawUpdatePerformed = $false
    } | ConvertTo-Json -Compress
    exit 0
}
catch {
    $message = [string]$_.Exception.Message
    if ($message -notmatch '^[A-Z0-9_]{3,160}$') { $message = 'LEGACY_BACKEND_MIGRATION_FAILED' }
    [PSCustomObject]@{
        schemaVersion = 'stephanos.legacy-backend-listener-migration.v1'
        ok = $false
        finalVerdict = 'LEGACY_BACKEND_LISTENER_MIGRATION_BLOCKED'
        blocker = $message
        expectedHead = ([string]$ExpectedHead).Trim().ToLowerInvariant()
        terminatedVerifiedOwnedProcess = $false
        arbitraryPidAllowed = $false
        arbitraryExecutableAllowed = $false
        arbitraryCommandAllowed = $false
        arbitraryTaskAllowed = $false
        arbitraryShellAllowed = $false
        sourceMutationAllowed = $false
        pcRestartAllowed = $false
        liveOpenClawUpdatePerformed = $false
    } | ConvertTo-Json -Compress
    exit 1
}
