$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Fixed observation only. No input paths, commands, process control or writes.
$connections = @(Get-NetTCPConnection -State Listen -LocalPort 4173 -ErrorAction SilentlyContinue)
$owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
$rows = @()
foreach ($owner in $owners) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([uint32]$owner)"
    if ($null -eq $process) { throw 'FRONTEND_LISTENER_OWNER_UNPROVEN' }
    $rows += [pscustomobject]@{ pid = [uint32]$owner; executablePath = [string]$process.ExecutablePath; commandLine = [string]$process.CommandLine }
}
@{ schemaVersion = 'stephanos.frontend-listener.v1'; owners = @($rows) } | ConvertTo-Json -Depth 4 -Compress
