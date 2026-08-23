[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$schemaVersion = 'stephanos.battle-bridge-local-chat-recovery.v1'
$powershellExe = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
if (-not (Test-Path -LiteralPath $powershellExe -PathType Leaf)) { throw 'Canonical Windows PowerShell host is missing.' }

$lifeboatRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Stephanos\BattleBridgeRecoveryLifeboat'))
$statePath = Join-Path $lifeboatRoot 'state\active-bank.json'
$statusRoot = Join-Path $lifeboatRoot 'status'
[System.IO.Directory]::CreateDirectory($statusRoot) | Out-Null

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256([string]$Text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Write-AtomicJson([string]$Path, [object]$Value) {
    $temp = "$Path.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
    $Value | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'Installed lifeboat active-bank state is missing.' }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ([string]$state.schemaVersion -ne 'stephanos.battle-bridge-lifeboat-active-bank.v1') { throw 'Installed lifeboat active-bank schema is invalid.' }
$bankId = [string]$state.activeBank
if ($bankId -notin @('A', 'B')) { throw 'Installed lifeboat active bank is invalid.' }
if ([string]$state.selfTestVerdict -ne 'PASS') { throw 'Installed lifeboat active bank is not self-test proven.' }
if ([string]$state.manifestSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Installed lifeboat manifest identity is invalid.' }

$bankRoot = Join-Path $lifeboatRoot "banks\$bankId"
$runnerPath = Join-Path $bankRoot 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1'
$actionPath = Join-Path $bankRoot 'actions\battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1'
$claimPath = Join-Path $bankRoot 'github\invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1'
$versionPath = Join-Path $bankRoot 'version.txt'
$manifestPath = Join-Path $bankRoot 'manifest.sha256'
foreach ($required in @($runnerPath, $actionPath, $claimPath, $versionPath, $manifestPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required installed lifeboat component is missing: $required" }
}

$version = (Get-Content -LiteralPath $versionPath -Raw).Trim()
$manifest = (Get-Content -LiteralPath $manifestPath -Raw).Trim().ToLowerInvariant()
$runnerHash = Get-Sha256 $runnerPath
$actionHash = Get-Sha256 $actionPath
$claimHash = Get-Sha256 $claimPath
$observedManifest = Get-TextSha256 "runner=$runnerHash`naction=$actionHash`nclaim=$claimHash`nversion=$version`n"
if ($manifest -ne [string]$state.manifestSha256 -or $observedManifest -ne $manifest) { throw 'Installed lifeboat payload hash verification failed.' }

$confirmed = $true
if ($Action -ne 'PROBE_BATTLE_BRIDGE') {
    Add-Type -AssemblyName System.Windows.Forms
    $label = if ($Action -eq 'WAKE_CANONICAL_MAILBOX') { 'wake the canonical GitHub command mailbox' } else { 'wake the canonical Recovery Mesh' }
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "Stephanos Recovery Lifeboat requests permission to ${label}.`r`n`r`nNo arbitrary shell, Git mutation, deployment or PC restart is permitted by this action.",
        'Stephanos bounded recovery approval',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning,
        [System.Windows.Forms.MessageBoxDefaultButton]::Button2
    )
    $confirmed = $answer -eq [System.Windows.Forms.DialogResult]::Yes
}

$requestId = "local-chat-$([Guid]::NewGuid().ToString('N'))"
$startedAt = [DateTime]::UtcNow
$resultText = ''
$exitCode = 0
if ($confirmed) {
    $output = @(& $powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $actionPath -Action $Action 2>&1)
    $exitCode = $LASTEXITCODE
    $resultText = $output -join [Environment]::NewLine
} else {
    $exitCode = 2
    $resultText = '{"ok":false,"blocker":"OPERATOR_DECLINED"}'
}

$parsedResult = $null
try { $parsedResult = $resultText | ConvertFrom-Json } catch { }
$ok = $confirmed -and $exitCode -eq 0 -and $null -ne $parsedResult -and [bool]$parsedResult.ok
$receipt = [ordered]@{
    schemaVersion = $schemaVersion
    requestId = $requestId
    ingress = 'battle-bridge-local-chat-fixed-protocol'
    action = $Action
    operatorConfirmationRequired = [bool]($Action -ne 'PROBE_BATTLE_BRIDGE')
    operatorConfirmed = [bool]$confirmed
    activeBank = $bankId
    manifestSha256 = $manifest
    startedAtUtc = $startedAt.ToString('o')
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    ok = [bool]$ok
    exitCode = $exitCode
    result = $parsedResult
    arbitraryShellAllowed = $false
    callerSelectedExecutableAllowed = $false
    callerSelectedPathAllowed = $false
    callerSelectedUrlAllowed = $false
    callerSelectedTaskAllowed = $false
    gitMutationAllowed = $false
    sourceMutationAllowed = $false
    mergeAllowed = $false
    deploymentAllowed = $false
    pcRestartAllowed = $false
    finalVerdict = if ($ok) { 'LOCAL_CHAT_RECOVERY_ACTION_COMPLETE' } elseif (-not $confirmed) { 'LOCAL_CHAT_RECOVERY_OPERATOR_DECLINED' } else { 'LOCAL_CHAT_RECOVERY_ACTION_BLOCKED' }
}

$receiptPath = Join-Path $statusRoot "$requestId.json"
Write-AtomicJson -Path $receiptPath -Value $receipt
Write-AtomicJson -Path (Join-Path $statusRoot 'local-chat-recovery-last.json') -Value $receipt
$receipt | ConvertTo-Json -Depth 10
if (-not $ok) { exit 1 }
