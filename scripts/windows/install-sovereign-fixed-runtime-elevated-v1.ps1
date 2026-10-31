[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$ExpectedHead
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$preparer = Join-Path $repoRoot 'scripts\sovereign-fixed-runtime-install-current-v1.mjs'
$marker = 'SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_V1='
$expectedHeadLower = $ExpectedHead.ToLowerInvariant()

function Write-Result([bool]$Ok, [string]$State, [string]$Blocker, [hashtable]$Extra = @{}) {
    $row = [ordered]@{
        schemaVersion = 'stephanos.sovereign-fixed-runtime-elevated-broker.v1'
        ok = $Ok
        state = $State
        blocker = $Blocker
        expectedMain = $expectedHeadLower
        arbitraryShellAllowed = $false
        arbitraryExecutableAllowed = $false
        sourceMutationAllowed = $false
        mergeAuthority = $false
        pcRestartAuthority = $false
    }
    foreach ($key in $Extra.Keys) { $row[$key] = $Extra[$key] }
    $row | ConvertTo-Json -Depth 8 -Compress
}

function Read-AdapterResult([string]$Mode) {
    $raw = @(& $nodeExe $preparer $Mode '--expected-main' $expectedHeadLower 2>&1)
    $exitCode = $LASTEXITCODE
    $line = @($raw | ForEach-Object { [string]$_ } | Where-Object { $_.StartsWith($marker) } | Select-Object -Last 1)
    if (-not $line -or -not $line[0]) {
        throw 'FIXED_RUNTIME_INSTALL_PREPARER_RECEIPT_MISSING'
    }
    try { $value = $line[0].Substring($marker.Length) | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'FIXED_RUNTIME_INSTALL_PREPARER_RECEIPT_INVALID' }
    if ([string]$value.schemaVersion -ne 'stephanos.sovereign-fixed-runtime-install-current.v1') {
        throw 'FIXED_RUNTIME_INSTALL_PREPARER_SCHEMA_INVALID'
    }
    return [pscustomobject]@{ Value = $value; ExitCode = $exitCode }
}

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf) -or
    -not (Test-Path -LiteralPath $preparer -PathType Leaf)) {
    Write-Result $false 'BLOCKED' 'FIXED_RUNTIME_INSTALL_DEPENDENCY_MISSING'
    exit 2
}

try {
    $status = Read-AdapterResult 'status'
    if ($status.ExitCode -ne 0 -or $status.Value.ok -ne $true) {
        Write-Result $false 'BLOCKED' ([string]$status.Value.blocker)
        exit 2
    }
    if ([string]$status.Value.state -eq 'PRESENT') {
        Write-Result $true 'ALREADY_PRESENT' '' @{
            installPerformed = $false
            presenceProven = $true
            requiresLaterFullBoot = $false
        }
        exit 0
    }
    if ([string]$status.Value.state -ne 'MISSING' -or
        [string]$status.Value.reason -ne 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING') {
        Write-Result $false 'BLOCKED' 'FIXED_RUNTIME_INSTALL_STATE_UNPROVEN'
        exit 2
    }

    $prepared = Read-AdapterResult 'prepare'
    $candidate = $prepared.Value
    if ($prepared.ExitCode -ne 0 -or $candidate.ok -ne $true -or
        [string]$candidate.state -ne 'READY_FOR_OPERATOR_APPROVAL' -or
        [string]$candidate.expectedMain -ne $expectedHeadLower -or
        [string]$candidate.payloadSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$candidate.scriptSha256 -notmatch '^[a-f0-9]{64}$' -or
        [string]$candidate.encodedCommand -notmatch '^[A-Za-z0-9+/=]+$' -or
        [string]$candidate.powershellExecutable -ne 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -or
        $candidate.requiresUac -ne $true -or $candidate.arbitraryShellAllowed -ne $false -or
        $candidate.sourceMutationAllowed -ne $false -or $candidate.pcRestartAuthority -ne $false) {
        $blocker = if ($candidate.blocker) { [string]$candidate.blocker } else { 'FIXED_RUNTIME_INSTALL_CANDIDATE_UNPROVEN' }
        Write-Result $false 'BLOCKED' $blocker
        exit 2
    }

    Add-Type -AssemblyName System.Windows.Forms
    $summary = @"
Stephanos Control Tower has proved that the protected Sovereign fixed runtime is missing.

Install the exact reviewed runtime for current protected main?

Main:
$expectedHeadLower

Payload SHA-256:
$($candidate.payloadSha256)

Installer program SHA-256:
$($candidate.scriptSha256)

This action:
- installs only the fixed Sovereign runtime under C:\Program Files\Stephanos
- uses the exact current main source closure
- requires Windows UAC
- cannot run arbitrary commands or choose another path
- does NOT restart Windows
- does NOT grant merge or source-mutation authority
- requires one normal Windows Restart after installation

Continue?
"@
    $choice = [System.Windows.Forms.MessageBox]::Show(
        $summary,
        'Stephanos - install Sovereign fixed runtime',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) {
        Write-Result $false 'DECLINED' 'FIXED_RUNTIME_INSTALL_OPERATOR_DECLINED'
        exit 2
    }

    $payloadPath = [string]$candidate.payloadPath
    try {
        try {
            $process = Start-Process -FilePath ([string]$candidate.powershellExecutable) -ArgumentList @(
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-EncodedCommand',
                ([string]$candidate.encodedCommand)
            ) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        } catch {
            Write-Result $false 'BLOCKED' 'FIXED_RUNTIME_INSTALL_UAC_CANCELLED_OR_FAILED'
            exit 2
        }
        if ($process.ExitCode -ne 0) {
            Write-Result $false 'BLOCKED' 'FIXED_RUNTIME_INSTALL_ELEVATED_CHILD_FAILED' @{
                elevatedExitCode = [int]$process.ExitCode
            }
            exit 2
        }

        $after = Read-AdapterResult 'status'
        if ($after.ExitCode -ne 0 -or $after.Value.ok -ne $true -or
            [string]$after.Value.state -ne 'PRESENT' -or
            [string]$after.Value.sourceHead -ne $expectedHeadLower) {
            $blocker = if ($after.Value.reason) { [string]$after.Value.reason } else { 'FIXED_RUNTIME_INSTALL_READBACK_UNPROVEN' }
            Write-Result $false 'BLOCKED' $blocker
            exit 2
        }

        Write-Result $true 'INSTALLED_PENDING_RESTART' '' @{
            installPerformed = $true
            presenceProven = $true
            payloadSha256 = [string]$candidate.payloadSha256
            scriptSha256 = [string]$candidate.scriptSha256
            helperSha256 = [string]$after.Value.helperSha256
            manifestSha256 = [string]$after.Value.manifestSha256
            requiresLaterFullBoot = $true
            restartPerformed = $false
        }
        exit 0
    } finally {
        if ($payloadPath -and $payloadPath -like 'C:\Users\Stephan Callear\AppData\Local\Temp\StephanosFixedRuntimeInstall-*.json') {
            Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
        }
    }
} catch {
    $blocker = if ($_.Exception.Message -match '^[A-Z0-9_]{1,120}$') {
        $_.Exception.Message
    } else {
        'FIXED_RUNTIME_INSTALL_BROKER_UNPROVEN'
    }
    Write-Result $false 'BLOCKED' $blocker
    exit 2
}
