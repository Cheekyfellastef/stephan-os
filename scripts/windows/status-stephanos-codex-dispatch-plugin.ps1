[CmdletBinding()]
param(
    [string]$RepositoryRoot = "",
    [string]$SharedWorkspace = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepositoryRoot) {
    $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}
else {
    $RepositoryRoot = (Resolve-Path $RepositoryRoot).Path
}
if (-not $SharedWorkspace) {
    $SharedWorkspace = Join-Path $env:USERPROFILE "Documents\Stephanos-openclaw-workspace"
}

$installRoot = Join-Path $env:USERPROFILE ".codex\plugins\stephanos-codex-dispatch"
$manifestPath = Join-Path $installRoot ".codex-plugin\plugin.json"
$mcpConfigPath = Join-Path $installRoot ".mcp.json"
$mcpServerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-mcp.mjs"
$workerPath = Join-Path $RepositoryRoot "scripts\stephanos-codex-dispatch-worker.mjs"
$proofPath = Join-Path $SharedWorkspace "codex-dispatch\install-proof.json"
$attachmentProofPath = Join-Path $SharedWorkspace "codex-dispatch\surface-attachment-latest.json"

$codex = Get-Command codex -ErrorAction SilentlyContinue
$mcpRegistered = $false
$mcpList = @()
if ($codex) {
    try {
        $mcpList = @(& codex mcp list 2>&1)
        $mcpRegistered = (($mcpList -join "`n") -match "stephanos-codex-dispatch")
    }
    catch {}
}

$sourceHead = ''
$fixedGitPath = 'C:\Program Files\Git\cmd\git.exe'
$git = ''
if (Test-Path -LiteralPath $fixedGitPath -PathType Leaf) {
    $git = $fixedGitPath
}
else {
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCommand) { $git = $gitCommand.Source }
}
if ($git) {
    try {
        $sourceHead = (& $git -C $RepositoryRoot rev-parse HEAD 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($LASTEXITCODE -ne 0 -or $sourceHead -notmatch '^[0-9a-f]{40}$') { $sourceHead = '' }
    }
    catch { $sourceHead = '' }
}

$serverSourceSha256 = ''
try { $serverSourceSha256 = (Get-FileHash -LiteralPath $mcpServerPath -Algorithm SHA256).Hash.ToLowerInvariant() }
catch { $serverSourceSha256 = '' }

$attachmentProof = $null
$attachmentProofValid = $false
$attachmentProofFresh = $false
$attachmentBlocker = 'CHATGPT_PLUGIN_TOOL_PROOF_MISSING'
if (Test-Path -LiteralPath $attachmentProofPath -PathType Leaf) {
    try {
        $attachmentProof = Get-Content -LiteralPath $attachmentProofPath -Raw | ConvertFrom-Json
        $observedAt = [DateTimeOffset]::Parse([string]$attachmentProof.observedAt)
        $age = [DateTimeOffset]::UtcNow - $observedAt.ToUniversalTime()
        $attachmentProofFresh = ($age.TotalSeconds -ge -60 -and $age.TotalMinutes -le 10)
        $requiredTools = @('dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result')
        $listedTools = @($attachmentProof.toolsListed | ForEach-Object { [string]$_ })
        $toolsPresent = ($requiredTools | Where-Object { $listedTools -notcontains $_ }).Count -eq 0
        $attachmentProofValid = (
            [string]$attachmentProof.schemaVersion -eq 'stephanos.codex-dispatch-surface-attachment.v1' -and
            $attachmentProof.attached -eq $true -and
            [string]$attachmentProof.platform -eq 'win32' -and
            $attachmentProof.can_local_windows_proof -eq $true -and
            -not [string]::IsNullOrWhiteSpace([string]$attachmentProof.surfaceReceipt) -and
            [System.IO.Path]::GetFullPath([string]$attachmentProof.repositoryRoot) -eq $RepositoryRoot -and
            [string]$attachmentProof.sourceHead -eq $sourceHead -and
            [string]$attachmentProof.serverSourceSha256 -eq $serverSourceSha256 -and
            $attachmentProof.requiredDispatchToolsPresent -eq $true -and
            $toolsPresent -and
            $attachmentProofFresh
        )
        if (-not $attachmentProofFresh) { $attachmentBlocker = 'CHATGPT_PLUGIN_TOOL_PROOF_STALE' }
        elseif (-not $attachmentProofValid) { $attachmentBlocker = 'CHATGPT_PLUGIN_TOOL_PROOF_INVALID' }
        else { $attachmentBlocker = '' }
    }
    catch { $attachmentBlocker = 'CHATGPT_PLUGIN_TOOL_PROOF_INVALID' }
}

$status = [ordered]@{
    schemaVersion = "stephanos.codex-dispatch-install-status.v1"
    checkedAt = (Get-Date).ToUniversalTime().ToString("o")
    repositoryRoot = $RepositoryRoot
    pluginInstallRoot = $installRoot
    pluginManifestPresent = Test-Path -LiteralPath $manifestPath
    mcpConfigPresent = Test-Path -LiteralPath $mcpConfigPath
    mcpServerPresent = Test-Path -LiteralPath $mcpServerPath
    workerPresent = Test-Path -LiteralPath $workerPath
    installProofPresent = Test-Path -LiteralPath $proofPath
    nodePresent = [bool](Get-Command node -ErrorAction SilentlyContinue)
    codexPresent = [bool]$codex
    codexMcpRegistered = $mcpRegistered
    sourceHead = $sourceHead
    serverSourceSha256 = $serverSourceSha256
    attachmentProofPath = $attachmentProofPath
    attachmentProofPresent = [bool](Test-Path -LiteralPath $attachmentProofPath -PathType Leaf)
    attachmentProofFresh = $attachmentProofFresh
    attachmentProofValid = $attachmentProofValid
    attachmentBlocker = $attachmentBlocker
    executionSurfaceHandshake = [ordered]@{
        surfaceId = if ($attachmentProofValid) { [string]$attachmentProof.surfaceId } else { 'stephanos-codex-dispatch-local-mcp' }
        surfaceReceipt = if ($attachmentProofValid) { [string]$attachmentProof.surfaceReceipt } else { '' }
        attached = $attachmentProofValid
        platform = 'windows'
        can_local_windows_proof = $attachmentProofValid
        heartbeatFresh = $attachmentProofFresh -and $attachmentProofValid
        observedAt = if ($attachmentProofValid) { [string]$attachmentProof.observedAt } else { '' }
        sourceHead = if ($attachmentProofValid) { [string]$attachmentProof.sourceHead } else { '' }
        serverSourceSha256 = if ($attachmentProofValid) { [string]$attachmentProof.serverSourceSha256 } else { '' }
    }
    chatgptPluginToolProof = if ($attachmentProofValid) { 'verified-exact-head-tools-list' } else { 'requires-new-compatible-chat-tools-list' }
    localBridgeReady = (
        (Test-Path -LiteralPath $manifestPath) -and
        (Test-Path -LiteralPath $mcpConfigPath) -and
        (Test-Path -LiteralPath $mcpServerPath) -and
        (Test-Path -LiteralPath $workerPath) -and
        [bool]$codex -and
        $mcpRegistered
    )
    readyForCodexCliDispatch = $false
    readyForRemoteChatDispatch = $false
    finalVerdict = ""
}
$status.readyForCodexCliDispatch = $status.localBridgeReady
$status.readyForRemoteChatDispatch = $status.localBridgeReady -and $attachmentProofValid
$status.finalVerdict = if ($status.readyForRemoteChatDispatch) {
    "STEPHANOS_CODEX_DISPATCH_BRIDGE_ATTACHED_READY"
}
elseif ($status.localBridgeReady) {
    "BLOCKED_CHATGPT_PLUGIN_ATTACHMENT_UNPROVEN"
}
elseif (-not $status.codexPresent) {
    "BLOCKED_CODEX_COMMAND_MISSING"
}
elseif (-not $status.codexMcpRegistered) {
    "BLOCKED_CODEX_MCP_NOT_REGISTERED"
}
else {
    "BLOCKED_PLUGIN_FILES_INCOMPLETE"
}

$status | ConvertTo-Json -Depth 8
if (-not $status.readyForRemoteChatDispatch) { exit 1 }
