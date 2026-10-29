# Read-only adapter. Task configuration is never actual token proof, and this
# preflight grants no runtime/helper, custody, source, lease or restart authority.
function Resolve-SovereignCommanderOperatorContextV1 {
    param([object]$UserSid, [object]$AdministratorRole)
    if ($UserSid -isnot [string] -or $UserSid -cnotmatch '^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$' -or
        $AdministratorRole -isnot [bool]) {
        return [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN' }
    }
    if ($AdministratorRole) {
        return [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED' }
    }
    [pscustomobject]@{ normalOperatorObserved = $true; blocker = '' }
}

function Get-SovereignCommanderOperatorContextV1 {
    $identity = $null
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = New-Object Security.Principal.WindowsPrincipal($identity)
        Resolve-SovereignCommanderOperatorContextV1 -UserSid $identity.User.Value -AdministratorRole ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
    } catch {
        [pscustomobject]@{ normalOperatorObserved = $false; blocker = 'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN' }
    } finally {
        if ($null -ne $identity) { $identity.Dispose() }
    }
}
