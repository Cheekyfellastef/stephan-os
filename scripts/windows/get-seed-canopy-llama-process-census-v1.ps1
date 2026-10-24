# Candidate read-only Windows process census for seed #3096.
# Not installed or commissioned. Never terminates a process, starts a model,
# signs custody evidence, validates Windows Job membership, or proves GPU eviction.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$RouterPid
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Format-Utc {
    param([datetime]$Value)
    return $Value.ToUniversalTime().ToString(
        'yyyy-MM-ddTHH:mm:ss.fffZ', [Globalization.CultureInfo]::InvariantCulture)
}

$enumerationStarted = Format-Utc -Value ([datetime]::UtcNow)
$complete = $true
$records = @()
$routerHash = $null
try {
    # This is a process-wide read-only enumeration, not a targeted kill query.
    $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    if ($all.Count -gt 8192) { throw 'Census exceeds safe bound' }
    foreach ($process in $all) {
        if ($null -eq $process.CreationDate) {
            $complete = $false
            continue
        }
        $records += [pscustomobject]@{
            pid = [int]$process.ProcessId
            parentPid = [int]$process.ParentProcessId
            startedAtUtc = Format-Utc -Value ([datetime]$process.CreationDate)
        }
        if ([int]$process.ProcessId -eq $RouterPid) {
            if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) {
                $complete = $false
            } else {
                try {
                    $routerHash = ([string](Get-FileHash -LiteralPath $process.ExecutablePath -Algorithm SHA256 -ErrorAction Stop).Hash).ToLowerInvariant()
                } catch { $complete = $false }
            }
        }
    }
} catch {
    # On failed enumeration no partial list is authoritative.
    $complete = $false
    $records = @()
    $routerHash = $null
}
$enumerationFinished = Format-Utc -Value ([datetime]::UtcNow)
$result = [ordered]@{
    schemaVersion = 'stephanos.llama-windows-census.v1'
    observedAtUtc = $enumerationFinished
    enumerationStartedAtUtc = $enumerationStarted
    enumerationFinishedAtUtc = $enumerationFinished
    enumerationComplete = [bool]$complete
    processes = @($records)
    routerExecutableSha256 = $routerHash
    # No positive custody or no-residency claim is possible from this script.
    windowsJobVerified = $false
    gpuResidencyMeasured = $false
    independentSignerVerified = $false
    physicalCustodyQualified = $false
}
$result | ConvertTo-Json -Depth 5 -Compress
