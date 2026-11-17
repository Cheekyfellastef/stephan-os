# Read-only fixed 18791 owner identity. Direct invocation has no parameters.
# Dot-sourcing exposes the same canonical-Node identity reader to the fixed
# Core observer; it performs no listener, process or filesystem observation.
function Initialize-StephanosCanonicalNodeIdentityV1 {
    if ('Stephanos.ReadOnlyCanonicalNodeIdentityV1' -as [type]) { return }
    Add-Type -TypeDefinition @'
namespace Stephanos {
    using System;
    using System.Runtime.InteropServices;
    using System.Text;
    public static class ReadOnlyCanonicalNodeIdentityV1 {
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
        static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint length);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool CloseHandle(IntPtr handle);
        public static string Observe(uint pid, long expectedCreatedUtcTicks) {
            if (pid == 0 || pid > Int32.MaxValue || expectedCreatedUtcTicks <= 0 || expectedCreatedUtcTicks > DateTime.UtcNow.Ticks)
                return "OWNER_PROCESS_BIRTH_UNAVAILABLE";
            // Query-limited information and a zero-time liveness wait only.
            // No debug privilege, VM read, termination, token or write access.
            IntPtr process = OpenProcess(0x101000, false, pid);
            if (process == IntPtr.Zero || process == new IntPtr(-1))
                return Marshal.GetLastWin32Error() == 5 ? "OWNER_NATIVE_ACCESS_DENIED" : "OWNER_NATIVE_OPEN_FAILED";
            try {
                uint state = WaitForSingleObject(process, 0);
                if (state == 0) return "OWNER_NATIVE_PROCESS_EXITED";
                if (state != 258) return "OWNER_NATIVE_QUERY_UNAVAILABLE";
                long created, exited, kernel, user;
                if (!GetProcessTimes(process, out created, out exited, out kernel, out user))
                    return "OWNER_NATIVE_BIRTH_UNPROVEN";
                // CIM_DATETIME carries six fractional digits (microseconds).
                // Compare that exact resolution; never allow a time window.
                if (DateTime.FromFileTimeUtc(created).Ticks / 10L != expectedCreatedUtcTicks / 10L)
                    return "OWNER_NATIVE_BIRTH_MISMATCH";
                var image = new StringBuilder(1024); uint length = 1024;
                if (!QueryFullProcessImageNameW(process, 0, image, ref length))
                    return "OWNER_NATIVE_IMAGE_UNPROVEN";
                if (!String.Equals(image.ToString(), @"C:\Program Files\nodejs\node.exe", StringComparison.OrdinalIgnoreCase))
                    return "OWNER_NATIVE_IMAGE_MISMATCH";
                state = WaitForSingleObject(process, 0);
                if (state == 0) return "OWNER_NATIVE_PROCESS_EXITED";
                return state == 258 ? "" : "OWNER_NATIVE_QUERY_UNAVAILABLE";
            } catch { return "OWNER_NATIVE_QUERY_UNAVAILABLE"; }
            finally { CloseHandle(process); }
        }
    }
}
'@ -ErrorAction Stop
}

function Get-StephanosCanonicalNodeIdentityV1 {
    param([Parameter(Mandatory = $true)][object]$ProcessRow)
    $code = 'OWNER_PROCESS_UNPROVEN'
    try {
        if ($null -eq $ProcessRow -or -not $ProcessRow.PSObject.Properties['Name'] -or
            [string]$ProcessRow.Name -ine 'node.exe' -or -not $ProcessRow.PSObject.Properties['ProcessId'] -or
            ($ProcessRow.ProcessId -isnot [int] -and $ProcessRow.ProcessId -isnot [uint32] -and $ProcessRow.ProcessId -isnot [long]) -or
            [long]$ProcessRow.ProcessId -lt 1 -or [long]$ProcessRow.ProcessId -gt [int]::MaxValue) {
            return [pscustomobject]@{ ok = $false; diagnosticCode = $code }
        }
        if (-not $ProcessRow.PSObject.Properties['CommandLine'] -or
            [string]::IsNullOrWhiteSpace([string]$ProcessRow.CommandLine)) {
            return [pscustomobject]@{ ok = $false; diagnosticCode = 'OWNER_COMMAND_LINE_UNAVAILABLE' }
        }
        if (-not $ProcessRow.PSObject.Properties['CreationDate'] -or $ProcessRow.CreationDate -isnot [datetime]) {
            return [pscustomobject]@{ ok = $false; diagnosticCode = 'OWNER_PROCESS_BIRTH_UNAVAILABLE' }
        }
        $created = $ProcessRow.CreationDate.ToUniversalTime()
        if ($created -le [datetime]::MinValue -or $created -gt [datetime]::UtcNow) {
            return [pscustomobject]@{ ok = $false; diagnosticCode = 'OWNER_PROCESS_BIRTH_UNAVAILABLE' }
        }
        Initialize-StephanosCanonicalNodeIdentityV1
        $code = [Stephanos.ReadOnlyCanonicalNodeIdentityV1]::Observe([uint32]$ProcessRow.ProcessId, [long]$created.Ticks)
        return [pscustomobject]@{ ok = ($code -ceq ''); diagnosticCode = $code }
    } catch {
        return [pscustomobject]@{ ok = $false; diagnosticCode = 'OWNER_NATIVE_QUERY_UNAVAILABLE' }
    }
}

function Get-StephanosCanonicalNodeImageHashV1 {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead('C:\Program Files\nodejs\node.exe')
        try { return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
        finally { $stream.Dispose() }
    } finally { $hasher.Dispose() }
}

function Get-SovereignMaintenanceNativeOwnerV2 {
    $ErrorActionPreference = 'Stop'
    $PSModuleAutoLoadingPreference = 'None'
    Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
    Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\CimCmdlets\CimCmdlets.psd1' -ErrorAction Stop
    try { $connections = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection -Filter 'LocalPort = 18791 AND State = 2') }
    catch { throw 'OWNER_CIM_LISTENER_QUERY_FAILED' }
    $owners = @($connections | ForEach-Object { [long]$_.OwningProcess } | Select-Object -Unique)
    if ($owners.Count -ne 1 -or $owners[0] -lt 1 -or $connections.Count -lt 1) { throw 'OWNER_LISTENER_UNPROVEN' }
    foreach ($connection in $connections) {
        if ($connection.LocalAddress -notin @('127.0.0.1','::1')) { throw 'OWNER_LISTENER_NOT_PRIVATE' }
    }
    try { $rows = @(Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [string]$owners[0])) }
    catch { throw 'OWNER_CIM_PROCESS_QUERY_FAILED' }
    if ($rows.Count -ne 1 -or $null -eq $rows[0] -or [long]$rows[0].ProcessId -ne $owners[0]) { throw 'OWNER_PROCESS_UNPROVEN' }
    $process = $rows[0]
    $node = 'C:\Program Files\nodejs\node.exe'
    $script = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os\scripts\sovereign-commander-http.mjs'
    $expected = '"' + $node + '" "' + $script + '"'
    if ([string]::IsNullOrWhiteSpace([string]$process.CommandLine)) { throw 'OWNER_COMMAND_LINE_UNAVAILABLE' }
    if (([string]$process.CommandLine).Trim() -cne $expected) { throw 'OWNER_COMMAND_LINE_MISMATCH' }
    if ($process.CreationDate -isnot [datetime] -or $process.CreationDate.ToUniversalTime() -gt [datetime]::UtcNow) { throw 'OWNER_PROCESS_BIRTH_UNAVAILABLE' }
    if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) {
        $native = Get-StephanosCanonicalNodeIdentityV1 -ProcessRow $process
        if ($native.ok -ne $true -or $native.diagnosticCode -cne '') { throw ([string]$native.diagnosticCode) }
    } elseif ($process.ExecutablePath -ine $node) { throw 'OWNER_IMAGE_MISMATCH' }
    try {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try {
            $commandHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($expected)))).Replace('-','').ToLowerInvariant()
        } finally { $hasher.Dispose() }
        $imageHash = Get-StephanosCanonicalNodeImageHashV1
        if ($imageHash -cnotmatch '^[a-f0-9]{64}$') { throw 'OWNER_IMAGE_HASH_UNPROVEN' }
    } catch { throw 'OWNER_IMAGE_HASH_UNPROVEN' }
    [pscustomobject]@{
        schemaVersion='stephanos.maintenance-owner-native-observation.v2'
        pid=[long]$process.ProcessId
        createdAtUtc=$process.CreationDate.ToUniversalTime().ToString('o')
        commandSha256=$commandHash
        imageSha256=$imageHash
        observedAtUtc=[DateTime]::UtcNow.ToString('o')
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Get-SovereignMaintenanceNativeOwnerV2 | ConvertTo-Json -Compress }
    catch {
        # Only the closed diagnostic token is carried to the JS observer.
        # It independently validates this negative envelope and retains the hold.
        $code = [string]$_.Exception.Message
        if ($code -cnotmatch '^OWNER_[A-Z_]{1,80}$') { $code = 'OWNER_OBSERVER_FAILED' }
        [pscustomobject]@{
            schemaVersion='stephanos.maintenance-owner-native-diagnostic.v1'
            ok=$false
            diagnosticCode=$code
            observationOnly=$true
        } | ConvertTo-Json -Compress
        exit 2
    }
}
