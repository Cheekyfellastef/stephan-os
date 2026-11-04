# Read-only fixed 18791 owner identity. No caller-selected PID or script.
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\CimCmdlets\CimCmdlets.psd1' -ErrorAction Stop
$connections = @(Get-CimInstance -Namespace 'root/StandardCimv2' -ClassName MSFT_NetTCPConnection -Filter 'LocalPort = 18791 AND State = 2')
$owners = @($connections | ForEach-Object { [long]$_.OwningProcess } | Select-Object -Unique)
if ($owners.Count -ne 1 -or $owners[0] -lt 1 -or $connections.Count -lt 1) { throw 'OWNER_LISTENER_UNPROVEN' }
foreach ($connection in $connections) {
    if ($connection.LocalAddress -notin @('127.0.0.1','::1')) { throw 'OWNER_LISTENER_NOT_PRIVATE' }
}
$process = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId=' + [string]$owners[0])
$node = 'C:\Program Files\nodejs\node.exe'
$script = 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os\scripts\sovereign-commander-http.mjs'
$expected = '"' + $node + '" "' + $script + '"'
if ($null -eq $process -or $process.ExecutablePath -ine $node -or
    ([string]$process.CommandLine).Trim() -cne $expected) { throw 'OWNER_PROCESS_UNPROVEN' }
$hasher = [Security.Cryptography.SHA256]::Create()
try {
    $commandHash = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($expected)))).Replace('-','').ToLowerInvariant()
    $stream = [IO.File]::OpenRead($node)
    try { $imageHash = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $stream.Dispose() }
} finally { $hasher.Dispose() }
[pscustomobject]@{
    schemaVersion='stephanos.maintenance-owner-native-observation.v2'
    pid=[long]$process.ProcessId
    createdAtUtc=$process.CreationDate.ToUniversalTime().ToString('o')
    commandSha256=$commandHash
    imageSha256=$imageHash
    observedAtUtc=[DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Compress
