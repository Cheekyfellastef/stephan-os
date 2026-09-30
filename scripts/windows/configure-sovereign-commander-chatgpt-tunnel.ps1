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

function Set-CurrentUserOnlyFileDacl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$UserSid
    )

    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    $acl = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) {
        [void]$acl.RemoveAccessRuleSpecific($existingRule)
    }
    $sid = New-Object System.Security.Principal.SecurityIdentifier($UserSid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $sid,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
    $file.SetAccessControl($acl)

    $verify = $file.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $rules = @($verify.Access)
    if ($rules.Count -ne 1) { throw 'CHATGPT_TUNNEL_CONFIG_ACL_NOT_EXCLUSIVE' }
    $verifiedRule = $rules[0]
    $verifiedSid = $verifiedRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($verifiedSid -ne $UserSid
        -or $verifiedRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow
        -or (($verifiedRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne [System.Security.AccessControl.FileSystemRights]::FullControl)
        -or $verifiedRule.IsInherited) {
        throw 'CHATGPT_TUNNEL_CONFIG_ACL_VERIFY_FAILED'
    }
}

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
$restartMarkerPath = Join-Path $configDir 'restart-required.marker'
$launcherPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-stephanos-scheduled-task-windowless.vbs')).Path
$runnerPath = (Resolve-Path (Join-Path $repoRoot 'scripts\windows\run-sovereign-commander-chatgpt-tunnel-hidden.ps1')).Path
$mcpScript = (Resolve-Path (Join-Path $repoRoot 'scripts\sovereign-commander-mcp.mjs')).Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'

foreach ($required in @($tunnelExe, $launcherPath, $runnerPath, $mcpScript, $nodeExe, $wscriptExe)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required ChatGPT tunnel dependency missing: $required" }
}

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUser = $currentIdentity.Name
$currentUserSid = [string]$currentIdentity.User.Value
if (-not $currentUserSid) { throw 'CHATGPT_TUNNEL_CURRENT_USER_SID_REQUIRED' }

$shouldApply = $PSCmdlet.ShouldProcess(
    $taskName,
    'Transactionally validate/persist guarded tunnel credentials/profile and activate the hidden outbound-only ChatGPT Secure MCP Tunnel watchdog'
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
        startNowRequested = [bool]$StartNow
        activationStarted = $false
        restartMarkerWritten = $false
        mutationPerformed = $false
        rollbackRequired = $false
        finalVerdict = 'CHATGPT_SECURE_MCP_TUNNEL_CONFIG_SKIPPED'
    } | ConvertTo-Json -Depth 5
    return
}

New-Item -ItemType Directory -Path $configDir -Force | Out-Null

$previousTunnelIdExists = Test-Path -LiteralPath $tunnelIdPath -PathType Leaf
$previousKeyExists = Test-Path -LiteralPath $keyPath -PathType Leaf
$previousTunnelId = if ($previousTunnelIdExists) { [System.IO.File]::ReadAllText($tunnelIdPath, [System.Text.Encoding]::ASCII).Trim() } else { '' }
$previousProtectedKey = if ($previousKeyExists) { [System.IO.File]::ReadAllText($keyPath, [System.Text.Encoding]::UTF8) } else { '' }

$protectedKey = ConvertFrom-SecureString -SecureString $RuntimeApiKey
$credential = New-Object System.Management.Automation.PSCredential('tunnel-client', $RuntimeApiKey)
$plainKey = $credential.GetNetworkCredential().Password
$previousEnvKey = $env:CONTROL_PLANE_API_KEY
$mcpCommand = '"' + $nodeExe + '" "' + $mcpScript + '"'
$configurationCommitted = $false
$rollbackSucceeded = $false

try {
    [System.IO.File]::WriteAllText($tunnelIdPath, $TunnelId, [System.Text.Encoding]::ASCII)
    [System.IO.File]::WriteAllText($keyPath, $protectedKey, [System.Text.Encoding]::UTF8)
    Set-CurrentUserOnlyFileDacl -Path $tunnelIdPath -UserSid $currentUserSid
    Set-CurrentUserOnlyFileDacl -Path $keyPath -UserSid $currentUserSid

    $env:CONTROL_PLANE_API_KEY = $plainKey
    & $tunnelExe init --sample sample_mcp_stdio_local --profile $profileName --tunnel-id $TunnelId --mcp-command $mcpCommand
    if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_PROFILE_INIT_FAILED' }
    & $tunnelExe doctor --profile $profileName --explain
    if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_DOCTOR_FAILED' }

    $escapedLauncherPath = $launcherPath.Replace('"', '""')
    $actionArguments = "//B //NoLogo `"$escapedLauncherPath`" sovereign-chatgpt-tunnel"
    $action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $actionArguments
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $intervalTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logonTrigger, $intervalTrigger) -Principal $principal -Settings $settings -Description 'Keeps the outbound-only OpenAI Secure MCP Tunnel connected to the local Stephanos Sovereign Commander stdio MCP surface.' -Force | Out-Null

    $marker = [pscustomobject]@{
        schemaVersion = 'stephanos.sovereign-commander-chatgpt-tunnel-restart.v1'
        tunnelId = $TunnelId
        requestedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($restartMarkerPath, $marker, [System.Text.Encoding]::UTF8)
    Set-CurrentUserOnlyFileDacl -Path $restartMarkerPath -UserSid $currentUserSid
    $configurationCommitted = $true
} catch {
    $applyError = $_

    try {
        if ($previousTunnelIdExists) {
            [System.IO.File]::WriteAllText($tunnelIdPath, $previousTunnelId, [System.Text.Encoding]::ASCII)
            Set-CurrentUserOnlyFileDacl -Path $tunnelIdPath -UserSid $currentUserSid
        } else {
            Remove-Item -LiteralPath $tunnelIdPath -Force -ErrorAction SilentlyContinue
        }
        if ($previousKeyExists) {
            [System.IO.File]::WriteAllText($keyPath, $previousProtectedKey, [System.Text.Encoding]::UTF8)
            Set-CurrentUserOnlyFileDacl -Path $keyPath -UserSid $currentUserSid
        } else {
            Remove-Item -LiteralPath $keyPath -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $restartMarkerPath -Force -ErrorAction SilentlyContinue

        if ($previousTunnelIdExists -and $previousKeyExists -and $previousTunnelId -match '^tunnel_[0-9a-f]{32}$') {
            $oldSecureKey = ConvertTo-SecureString $previousProtectedKey
            $oldCredential = New-Object System.Management.Automation.PSCredential('tunnel-client', $oldSecureKey)
            $oldPlainKey = $oldCredential.GetNetworkCredential().Password
            try {
                $env:CONTROL_PLANE_API_KEY = $oldPlainKey
                & $tunnelExe init --sample sample_mcp_stdio_local --profile $profileName --tunnel-id $previousTunnelId --mcp-command $mcpCommand | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_ROLLBACK_INIT_FAILED' }
                & $tunnelExe doctor --profile $profileName --explain | Out-Null
                if ($LASTEXITCODE -ne 0) { throw 'OPENAI_TUNNEL_CLIENT_ROLLBACK_DOCTOR_FAILED' }
            } finally {
                $oldPlainKey = $null
            }
        }
        $rollbackSucceeded = $true
    } catch {
        throw "CHATGPT_TUNNEL_CONFIG_APPLY_FAILED_AND_ROLLBACK_FAILED: $($applyError.Exception.Message); rollback: $($_.Exception.Message)"
    }

    throw "CHATGPT_TUNNEL_CONFIG_APPLY_FAILED_ROLLED_BACK: $($applyError.Exception.Message)"
} finally {
    if ($null -eq $previousEnvKey) {
        Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    } else {
        $env:CONTROL_PLANE_API_KEY = $previousEnvKey
    }
    $plainKey = $null
}

if (-not $configurationCommitted) { throw 'CHATGPT_TUNNEL_CONFIG_NOT_COMMITTED' }

# Configuration changes must activate immediately; the runner sees the restart marker
# and recycles only the managed tunnel process before launching the new generation.
Start-ScheduledTask -TaskName $taskName
$activationStarted = $true

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
    startNowRequested = [bool]$StartNow
    activationStarted = $activationStarted
    restartMarkerWritten = $true
    mutationPerformed = $true
    rollbackRequired = $false
    rollbackSucceeded = $rollbackSucceeded
    finalVerdict = 'CHATGPT_SECURE_MCP_TUNNEL_CONFIGURED'
} | ConvertTo-Json -Depth 5
