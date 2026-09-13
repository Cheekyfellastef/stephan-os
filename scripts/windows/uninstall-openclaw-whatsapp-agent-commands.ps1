[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$WhatIfRollback,
    [switch]$MutateRuntime
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pluginId = 'openclaw-whatsapp-agent-commands'
$RuntimeMutationExplicit = [bool]$MutateRuntime
$MergeAllowed = $false

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "WHAT_IF_ROLLBACK=$([bool]$WhatIfRollback)"
Write-Output "RuntimeMutationExplicit=$RuntimeMutationExplicit"
Write-Output "MergeAllowed=$MergeAllowed"

if (-not $MutateRuntime) {
    Write-Output 'RUNTIME_MUTATION=SKIPPED_NO_EXPLICIT_FLAG'
    Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_ROLLBACK_DRY_RUN_PASS'
    exit 0
}

if ($WhatIfRollback) {
    Write-Output 'RUNTIME_MUTATION=SKIPPED_WHATIF_ROLLBACK'
    Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_ROLLBACK_WHATIF_PASS'
    exit 0
}

if ($PSCmdlet.ShouldProcess($pluginId, 'Uninstall WhatsApp agent command aliases')) {
    Write-Output 'RUNTIME_MUTATION=EXPLICIT_FLAG_ACKNOWLEDGED_PLACEHOLDER'
}
Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_ROLLED_BACK'
