[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^tunnel_[0-9a-f]{32}$')]
    [string]$TunnelId,

    [Parameter(Mandatory = $true)]
    [System.Security.SecureString]$RuntimeApiKey,

    [switch]$StartNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$taskName = 'Stephanos Sovereign Commander ChatGPT Tunnel'
$profileName = 'stephanos-sovereign-commander'
$healthPort = 18792
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\..'))
$expectedRepoRoot = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'))
if (-not [string]::Equals($repoRoot, $expectedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "ChatGPT tunnel installer must run from canonical checkout: $expectedRepoRoot"
}

$tunnelRoot = Join-Path $env:USERPROFILE 'Documents\OpenAI-Secure-MCP-Tunnel'
$tunnelExe = Join-Path $tunnelRoot 'bin\tunnel-client.exe'
$configDir = Join-Path $tunnelRoot 'stephanos'
$tunnelIdPath = Join-Path $configDir 'tunnel-id.txt'
$keyPath = Join-Path $configDir 'runtime-api-key.dpapi'
$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-sovereign-commander-chatgpt-tunnel-hidden.ps1')).Path
$mcpScript = (Resolve-Path (Join-Path $repoRoot 'scripts\sovereign-commander-mcp.mjs')).Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
$icaclsExe = Join-Path $env:SystemRoot 'System32\icacls.exe'

foreach ($required in @($tunnelExe, $launcherPath, $runnerPath, $mcpScript, $nodeExe, $wscriptExe, $icaclsExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required ChatGPT tunnel dependency missing: $required" }
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $currentIdentity.Name
$currentUserSid = [string]$currentIdentity.User.Value
if (-not $currentUserSid) { throw 'CHATGPT_TUNNEL_CURRENT_USER_SID_REQUIRED' }

$shouldApply = $PSCmdlet.ShouldProcess(
    $taskName,
    'Persist guarded tunnel credentials/profile and register hidden outbound-only ChatGPT Secure MCP Tunnel watchdog'
)
if (-not $shouldApply) {
    [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-commander-chatgpt-tunnel-config.v1'
        taskName = $taskName
        tunnelId = $TunnelId
        profileName = $profileName
        tunnelClient = $tunnelExe
        mcpScript = $mcpScript
        healthUrl = "http://127.0.0.1:$healthPort/readyz"
        runtimeApiKeyStoredPlaintext = $false
        runtimeApiKeyProtection = 'Windows-DPAPI-current-user'
        inboundFirewallPortRequired = $false
        publicMcpEndpointRequired = $false
        localBackendRemainsPrivate = $true
        arbitraryShellAllowed = $false
        mergeAuthority = $false
        pcRestartAuthority = $false
        startedNow = $false
        mutationPerformed = $false
        finalVerdict = 'CHATGPT_SECURE_MCP_TUNNEL_CONFIG_SKIPPED'
    } | ConvertTo-Json -Depth 5
    return
}

New-Item -ItemType Directory -Path $configDir -Force | Out-Null
[System.IO.File]::WriteAllText($tunnelIdPath, $TunnelId, [System.Text.Encoding]::ASCII)
$protectedKey = ConvertFrom-SecureString -SecureString $RuntimeApiKey
[System.IO.File]::WriteAllText($keyPath, $protectedKey, [System.Text.Encoding]::UTF8)

$grant = "*${currentUserSid}:(F)"
foreach ($secretPath in @($keyPath, $tunnelIdPath)) {
    & $icaclsExe $secretPath '/inheritance:r' '/grant:r' $grant | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "CHATGPT_TUNNEL_CONFIG_ACL_HARDEN_FAILED:$LASTEXITCODE" }
}

$credential = New-Object System.Management.Automation.PSCredential('tunnel-client', $RuntimeApiKey)
$plainKey = $credential.GetNetworkCredential().Password
$previousKey = $env:CONTROL_PLANE_API_KEY
try {
    $env:CONTROL_PLANE_API_KEY = $plainKey
    $mcpCommand = '"' + $nodeExe + '" "' + $mcpScript + '"'
    & $tunnelExe init --sample sample_mcp_stdio_local --profile $profileName --tunnel-id $TunnelId --mcp-command $mcpCommand
    if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_PROFILE_INIT_FAILED' }
    & $tunnelExe doctor --profile $profileName --explain
    if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_DOCTOR_FAILED' }
} finally {
    if ($null -eq $previousKey) {
        Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    } else {
        $env:CONTROL_PLANE_API_KEY = $previousKey
    }
    $plainKey = $null
}

$escapedLauncherPath = $launcherPath.Replace('"', '""')
$actionArguments = "//B //NoLogo `"$escapedLauncherPath`" sovereign-chatgpt-tunnel"
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Keeps the outbound-only OpenAI Secure MCP Tunnel connected to the local Stephanos Sovereign Commander stdio MCP surface.' -Force | Out-Null
$startedNow = $false
if ($StartNow) {
    Start-ScheduledTask -TaskName $taskName
    $startedNow = $true
}

[pscustomobject]@{
    schemaVersion = 'stephanos.sovereign-commander-chatgpt-tunnel-config.v1'
    taskName = $taskName
    tunnelId = $TunnelId
    profileName = $profileName
    tunnelClient = $tunnelExe
    mcpScript = $mcpScript
    healthUrl = "http://127.0.0.1:$healthPort/readyz"
    runtimeApiKeyStoredPlaintext = $false
    runtimeApiKeyProtection = 'Windows-DPAPI-current-user'
    inboundFirewallPortRequired = $false
    publicMcpEndpointRequired = $false
    localBackendRemainsPrivate = $true
    arbitraryShellAllowed = $false
    mergeAuthority = $false
    pcRestartAuthority = $false
    startedNow = $startedNow
    mutationPerformed = $true
    finalVerdict = 'CHATGPT_SECURE_MCP_TUNNEL_CONFIGURED'
} | ConvertTo-Json -Depth 5
