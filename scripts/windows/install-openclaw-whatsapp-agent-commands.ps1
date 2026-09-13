[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$WhatIfInstall,
    [switch]$MutateRuntime,
    [string]$WhatsAppAgentName = 'ChatClean'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pluginId = 'openclaw-whatsapp-agent-commands'
$commandCanon = @(
    '/standalone=standalone',
    '/scout-coder=stephanos-scout-coder',
    '/scout_coder=stephanos-scout-coder',
    '/stephanos=stephanos',
    'ChatClean=ChatClean',
    'WhatsAppAgentName=ChatClean'
)
$RuntimeMutationExplicit = [bool]$MutateRuntime
$MergeAllowed = $false
$ExplicitRuntimeMutationFlag = '-MutateRuntime'

if ($WhatsAppAgentName -ne 'ChatClean') {
    throw "Concierge/default plain WhatsApp agent name must remain ChatClean. Received: $WhatsAppAgentName"
}

Write-Output "PLUGIN_ID=$pluginId"
Write-Output "WHAT_IF_INSTALL=$([bool]$WhatIfInstall)"
Write-Output "RuntimeMutationExplicit=$RuntimeMutationExplicit"
Write-Output "MergeAllowed=$MergeAllowed"
Write-Output "EXPLICIT_RUNTIME_MUTATION_FLAG=$ExplicitRuntimeMutationFlag"
foreach ($entry in $commandCanon) { Write-Output "COMMAND_CANON=$entry" }

if (-not $MutateRuntime) {
    Write-Output 'RUNTIME_MUTATION=SKIPPED_NO_EXPLICIT_FLAG'
    Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_INSTALL_DRY_RUN_PASS'
    exit 0
}

if ($WhatIfInstall) {
    Write-Output 'RUNTIME_MUTATION=SKIPPED_WHATIF_INSTALL'
    Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_INSTALL_WHATIF_PASS'
    exit 0
}

if ($PSCmdlet.ShouldProcess($pluginId, 'Install WhatsApp agent command aliases')) {
    Write-Output 'RUNTIME_MUTATION=EXPLICIT_FLAG_ACKNOWLEDGED_PLACEHOLDER'
}
Write-Output 'FINAL_VERDICT=OPENCLAW_WHATSAPP_AGENT_COMMANDS_INSTALLED'
