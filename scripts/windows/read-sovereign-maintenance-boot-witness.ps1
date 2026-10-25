$ErrorActionPreference = 'Stop'
# Fixed observation only. Do not return the machine identifier itself.
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
$machine = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid -ErrorAction Stop).MachineGuid
if ([string]::IsNullOrWhiteSpace($machine)) { throw 'MACHINE_IDENTITY_UNKNOWN' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $machineHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($machine.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
@{
    schemaVersion = 'stephanos.windows-boot-witness.v1'
    machineHash = $machineHash
    bootStartedAtUtc = $os.LastBootUpTime.ToUniversalTime().ToString('o')
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Compress
