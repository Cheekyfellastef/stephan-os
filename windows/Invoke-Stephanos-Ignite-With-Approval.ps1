[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$normalIgniteCommand = 'npm run stephanos:ignite'
$approvedIgniteCommand = 'npm run stephanos:ignite -- --approve-local-merge'
$approvedOpenClawRestartCommand = 'npm run stephanos:ignite -- --approve-openclaw-service-restart'
$sourceMergeCheckCommand = 'git merge --no-commit --no-ff origin/main'
$transcriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("stephanos-ignite-{0}.log" -f ([guid]::NewGuid().ToString('N')))

function Write-IgniteApprovalLog([string]$Message) {
  Write-Host "[IGNITION APPROVAL] $Message"
}

function ConvertFrom-RepairPacketLine([string[]]$Lines) {
  $packetLine = @($Lines | Where-Object { $_ -match '^\[IGNITION\] (recovery-packet|repair-packet|openclaw-recovery-packet)=' } | Select-Object -Last 1)
  if (-not $packetLine -or -not $packetLine[0]) {
    return $null
  }

  $json = $packetLine[0] -replace '^\[IGNITION\] (recovery-packet|repair-packet|openclaw-recovery-packet)=', ''
  try {
    return $json | ConvertFrom-Json
  }
  catch {
    Write-IgniteApprovalLog "failed to parse ignition repair packet: $($_.Exception.Message)"
    return $null
  }
}

function Test-OpenClawRestartAvailable($Packet) {
  if ($null -eq $Packet) { return $false }
  return $Packet.packetType -eq 'openclaw-startup-connect-recovery-v1' `
    -and $Packet.connectionVerdict -eq 'running-not-connected' `
    -and $Packet.endpointIdentityVerified -eq $true `
    -and $Packet.portOwnerVerified -eq $true `
    -and $Packet.desktopApproval.buttonLabel -eq 'Restart OpenClaw service'
}

function Show-OpenClawRestartPopup($Packet) {
  $approvalAvailable = Test-OpenClawRestartAvailable $Packet
  $message = @"
Stephanos desktop Ignite detected OpenClaw startup connect failure.

OpenClaw appears to have started on power-up, but failed readiness/connection health.

Connection verdict: $($Packet.connectionVerdict)
Process/service state: $($Packet.detectedProcessState) / $($Packet.detectedServiceState)
Endpoint status: $($Packet.localEndpointStatus)
Endpoint identity verified: $($Packet.endpointIdentityVerified)
Port owner verified: $($Packet.portOwnerVerified)

Approved safe case:
- Restart OpenClaw service

Safety locks remain closed:
- no OpenClaw mutation
- no OpenClaw task execution
- no auto-push
- no Codex auto-dispatch
- no merge-ready flip
- no paid APIs
- no persistent memory writes

Recovery packet:
$($Packet | ConvertTo-Json -Depth 8)
"@
  if (-not $approvalAvailable) {
    Write-Host $message
    Write-IgniteApprovalLog 'OpenClaw service restart approval unavailable because identity/owner/verdict is not the known safe case.'
    return 'cancel'
  }
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Stephanos Ignite OpenClaw service restart approval'
    $form.Size = New-Object System.Drawing.Size(780, 560)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true
    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Multiline = $true
    $textBox.ReadOnly = $true
    $textBox.ScrollBars = 'Vertical'
    $textBox.WordWrap = $false
    $textBox.Font = New-Object System.Drawing.Font('Consolas', 10)
    $textBox.Text = $message
    $textBox.SetBounds(12, 12, 740, 420)
    $form.Controls.Add($textBox)
    $restartButton = New-Object System.Windows.Forms.Button
    $restartButton.Text = 'Restart OpenClaw service'
    $restartButton.SetBounds(392, 452, 190, 32)
    $restartButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $form.AcceptButton = $restartButton
    $form.Controls.Add($restartButton)
    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = 'Cancel / stop'
    $cancelButton.SetBounds(666, 452, 90, 32)
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancelButton
    $form.Controls.Add($cancelButton)
    $result = $form.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return 'openclaw-service-restart' }
    return 'cancel'
  }
  catch {
    Write-IgniteApprovalLog "popup unavailable: $($_.Exception.Message)"
    Write-Host $message
    Write-Host "Popup failed. To approve only the known local OpenClaw service restart manually, run: $approvedOpenClawRestartCommand" -ForegroundColor Yellow
    return 'cancel'
  }
}

function Get-ArrayCount($Value) {
  if ($null -eq $Value) { return 0 }
  return @($Value).Count
}

function Test-GeneratedDistRecoveryAvailable($Packet) {
  if ($null -eq $Packet) { return $false }
  return $Packet.reason -eq 'ff-only-divergence' `
    -and $Packet.localOnlyDistOnly -eq $true `
    -and (Get-ArrayCount $Packet.localOnlyCommits) -gt 0 `
    -and (Get-ArrayCount $Packet.remoteOnlyCommits) -gt 0 `
    -and $Packet.nextSafeAction -match '--approve-local-merge'
}

function New-SourceMergeRepairPacket($Packet, [string]$Phase, [string[]]$ConflictedPaths = @(), [string]$Note = '') {
  return [pscustomobject]@{
    type = 'source-merge-repair-packet'
    phase = $Phase
    note = $Note
    currentCommit = $Packet.currentCommit
    originMainCommit = $Packet.originMainCommit
    localOnlyDistOnly = $Packet.localOnlyDistOnly
    localOnlyCommits = $Packet.localOnlyCommits
    remoteOnlyCommits = $Packet.remoteOnlyCommits
    localOnlyPaths = $Packet.localOnlyPaths
    conflictedPaths = $ConflictedPaths
    requiredManualBoundary = 'Review source divergence and resolve/approve source merge separately; generated-dist recovery remains unavailable.'
    forbiddenAutomation = @('no generated-dist recovery approval', 'no auto-commit before Complete source merge approval', 'no auto-resolve conflicts', 'no auto-push', 'no OpenClaw unlock', 'no Codex auto-dispatch', 'no merge-ready flip')
  }
}

function Format-SourceDivergenceDetails($Packet) {
  $repairPacket = New-SourceMergeRepairPacket -Packet $Packet -Phase 'source-divergence-detected' -Note 'Local-only paths include source or non-generated-dist files.'
  return @"
Stephanos desktop Ignite detected source divergence.

Generated-dist local recovery is BLOCKED because localOnlyDistOnly=false.
This popup will not offer Approve local recovery for source divergence.

Source-divergence assistance available:
- View source divergence details
- Copy source merge repair packet
- Start approved source merge check (trial merge only after this explicit click)

Source merge safeguards:
- trial check command: $sourceMergeCheckCommand
- conflicts are inspected immediately
- conflicts abort the trial merge and emit a repair packet
- no source merge is committed before a second explicit Complete source merge approval
- no source conflicts are auto-resolved
- no auto-push
- no OpenClaw unlock
- no Codex auto-dispatch
- no merge-ready flip

Repair packet:
$($repairPacket | ConvertTo-Json -Depth 8)
"@
}

function Format-ApprovalPacketText($Packet, [bool]$ApprovalAvailable) {
  if (-not $ApprovalAvailable -and $Packet.localOnlyDistOnly -ne $true) {
    return Format-SourceDivergenceDetails -Packet $Packet
  }

  $localCount = Get-ArrayCount $Packet.localOnlyCommits
  $remoteCount = Get-ArrayCount $Packet.remoteOnlyCommits
  $distOnlyText = if ($Packet.localOnlyDistOnly -eq $true) { 'YES — local-only paths are apps/stephanos/dist/** only' } else { 'NO — local-only paths are not generated-dist-only' }
  $status = if ($ApprovalAvailable) { 'APPROVAL AVAILABLE: generated-dist-only local recovery packet passed launcher safety precheck.' } else { 'BLOCKED: generated-dist-only approval is not available for this repair packet.' }

  return @"
Stephanos desktop Ignite detected a generated-dist divergence.

$status

Current local commit: $($Packet.currentCommit)
Origin/main commit: $($Packet.originMainCommit)
Local-only commit count: $localCount
Remote-only commit count: $remoteCount
Generated-dist-only local changes: $distOnlyText

Exact approved action:
merge origin/main, rebuild dist, verify, commit generated dist, restart 4173 server

Safety locks remain closed:
- no auto-push
- no Codex auto-dispatch
- no OpenClaw unlock
- no merge-ready flip

Repair packet:
$($Packet | ConvertTo-Json -Depth 8)
"@
}

function Copy-TextToClipboard([string]$Text) {
  [System.Windows.Forms.Clipboard]::SetText($Text)
}

function Show-SourceMergeCompletionApproval($Packet) {
  $message = @"
Approved source merge check found no conflicts.

Second approval required: Complete source merge will create the pending merge commit locally.

It will not push, unlock OpenClaw, dispatch Codex, or mark merge readiness.
"@
  $result = [System.Windows.Forms.MessageBox]::Show($message, 'Complete source merge approval', 'OKCancel', 'Warning')
  return $result -eq [System.Windows.Forms.DialogResult]::OK
}

function Invoke-ApprovedSourceMergeCheck($Packet) {
  Write-IgniteApprovalLog "operator approved source merge check; running trial merge: $sourceMergeCheckCommand"
  & git merge --no-commit --no-ff origin/main
  $mergeExitCode = $LASTEXITCODE
  $conflictedPaths = @(& git diff --name-only --diff-filter=U)

  if ($mergeExitCode -ne 0 -or (Get-ArrayCount $conflictedPaths) -gt 0) {
    $repairPacket = New-SourceMergeRepairPacket -Packet $Packet -Phase 'source-merge-conflicts' -ConflictedPaths $conflictedPaths -Note 'Trial source merge found conflicts and was aborted without auto-resolution.'
    Write-IgniteApprovalLog 'source merge check found conflicts; aborting trial merge.'
    & git merge --abort 2>$null
    Write-Host "[IGNITION] source-merge-repair-packet=$($repairPacket | ConvertTo-Json -Depth 8 -Compress)"
    [System.Windows.Forms.MessageBox]::Show(($repairPacket | ConvertTo-Json -Depth 8), 'Source merge conflicts - repair packet', 'OK', 'Error') | Out-Null
    return 1
  }

  Write-IgniteApprovalLog 'source merge check found no conflicts; requesting second approval before commit.'
  if (-not (Show-SourceMergeCompletionApproval -Packet $Packet)) {
    Write-IgniteApprovalLog 'operator declined Complete source merge; aborting uncommitted trial merge.'
    & git merge --abort 2>$null
    return 1
  }

  Write-IgniteApprovalLog 'operator approved Complete source merge; committing local merge without push or unlock side effects.'
  & git commit -m 'Merge origin/main after approved source merge check'
  return $LASTEXITCODE
}

function Show-IgniteRecoveryPopup($Packet) {
  $approvalAvailable = Test-GeneratedDistRecoveryAvailable $Packet
  $sourceDivergence = -not $approvalAvailable -and $Packet.localOnlyDistOnly -ne $true
  $message = Format-ApprovalPacketText -Packet $Packet -ApprovalAvailable $approvalAvailable
  $sourceRepairPacketText = if ($sourceDivergence) { (New-SourceMergeRepairPacket -Packet $Packet -Phase 'source-divergence-detected' -Note 'Copy packet requested by operator.' | ConvertTo-Json -Depth 8) } else { $message }

  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $form = New-Object System.Windows.Forms.Form
    $form.Text = if ($approvalAvailable) { 'Stephanos Ignite generated-dist recovery approval' } elseif ($sourceDivergence) { 'Stephanos Ignite source divergence assistance' } else { 'Stephanos Ignite recovery blocked' }
    $form.Size = New-Object System.Drawing.Size(780, 600)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Multiline = $true
    $textBox.ReadOnly = $true
    $textBox.ScrollBars = 'Vertical'
    $textBox.WordWrap = $false
    $textBox.Font = New-Object System.Drawing.Font('Consolas', 10)
    $textBox.Text = $message
    $textBox.SetBounds(12, 12, 740, 460)
    $form.Controls.Add($textBox)

    if ($approvalAvailable) {
      $approveButton = New-Object System.Windows.Forms.Button
      $approveButton.Text = 'Approve local recovery'
      $approveButton.SetBounds(392, 492, 160, 32)
      $approveButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $form.AcceptButton = $approveButton
      $form.Controls.Add($approveButton)
    }
    elseif ($sourceDivergence) {
      $detailsButton = New-Object System.Windows.Forms.Button
      $detailsButton.Text = 'View source divergence details'
      $detailsButton.SetBounds(12, 492, 190, 32)
      $detailsButton.Add_Click({ [System.Windows.Forms.MessageBox]::Show($message, 'Source divergence details', 'OK', 'Information') | Out-Null })
      $form.Controls.Add($detailsButton)

      $copyButton = New-Object System.Windows.Forms.Button
      $copyButton.Text = 'Copy source merge repair packet'
      $copyButton.SetBounds(214, 492, 210, 32)
      $copyButton.Add_Click({ Copy-TextToClipboard -Text $sourceRepairPacketText; $copyButton.Text = 'Copied repair packet' })
      $form.Controls.Add($copyButton)

      $checkButton = New-Object System.Windows.Forms.Button
      $checkButton.Text = 'Start approved source merge check'
      $checkButton.SetBounds(436, 492, 220, 32)
      $checkButton.DialogResult = [System.Windows.Forms.DialogResult]::Yes
      $form.Controls.Add($checkButton)
    }

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = 'Cancel / stop'
    $cancelButton.SetBounds(666, 492, 90, 32)
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancelButton
    $form.Controls.Add($cancelButton)

    $result = $form.ShowDialog()
    if ($approvalAvailable -and $result -eq [System.Windows.Forms.DialogResult]::OK) { return 'generated-dist-recovery' }
    if ($sourceDivergence -and $result -eq [System.Windows.Forms.DialogResult]::Yes) { return 'source-merge-check' }
    return 'cancel'
  }
  catch {
    Write-IgniteApprovalLog "popup unavailable: $($_.Exception.Message)"
    Write-Host $message
    Write-Host ''
    if ($approvalAvailable) {
      Write-Host "Popup failed. To approve generated-dist-only recovery manually, run: $approvedIgniteCommand" -ForegroundColor Yellow
    }
    elseif ($sourceDivergence) {
      Write-Host "Popup failed. Source divergence repair packet emitted; do not run generated-dist recovery for source divergence." -ForegroundColor Yellow
      $compactSourceRepairPacketText = $sourceRepairPacketText -replace '`r?`n', ''
      Write-Host "[IGNITION] source-merge-repair-packet=$compactSourceRepairPacketText"
    }
    return 'cancel'
  }
}

Set-Location $repoRoot
Write-IgniteApprovalLog "running safe default ignition: $normalIgniteCommand"
& cmd.exe /d /c "$normalIgniteCommand 2>&1" | Tee-Object -FilePath $transcriptPath
$normalExitCode = $LASTEXITCODE
if ($normalExitCode -eq 0) {
  exit 0
}

$lines = Get-Content -Path $transcriptPath -ErrorAction SilentlyContinue
$packet = ConvertFrom-RepairPacketLine -Lines $lines
if ($null -ne $packet -and $packet.packetType -eq 'openclaw-startup-connect-recovery-v1') {
  $approvalAction = Show-OpenClawRestartPopup -Packet $packet
  if ($approvalAction -eq 'openclaw-service-restart') {
    Write-IgniteApprovalLog "operator approved OpenClaw service restart; running: $approvedOpenClawRestartCommand"
    & cmd.exe /d /c $approvedOpenClawRestartCommand
    exit $LASTEXITCODE
  }
  Write-IgniteApprovalLog 'operator cancelled or approval unavailable; no OpenClaw service restart was run.'
  exit $normalExitCode
}
if ($null -eq $packet -or $packet.reason -ne 'ff-only-divergence') {
  Write-IgniteApprovalLog "ignition failed without generated-dist divergence approval packet; no desktop recovery approval shown."
  Write-IgniteApprovalLog "manual safe command remains: $approvedIgniteCommand"
  exit $normalExitCode
}

$approvalAction = Show-IgniteRecoveryPopup -Packet $packet
if ($approvalAction -eq 'source-merge-check') {
  exit (Invoke-ApprovedSourceMergeCheck -Packet $packet)
}
if ($approvalAction -ne 'generated-dist-recovery') {
  Write-IgniteApprovalLog 'operator cancelled or approval unavailable; no generated-dist recovery or source merge completion was run.'
  Write-Host 'Repair packet remains above for review. Press Enter to keep this window open and stop.'
  Read-Host | Out-Null
  exit $normalExitCode
}

Write-IgniteApprovalLog "operator approved generated-dist recovery; running: $approvedIgniteCommand"
& cmd.exe /d /c $approvedIgniteCommand
exit $LASTEXITCODE
