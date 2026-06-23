[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$normalIgniteCommand = 'npm run stephanos:ignite'
$approvedIgniteCommand = 'npm run stephanos:ignite -- --approve-local-merge'
$transcriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("stephanos-ignite-{0}.log" -f ([guid]::NewGuid().ToString('N')))

function Write-IgniteApprovalLog([string]$Message) {
  Write-Host "[IGNITION APPROVAL] $Message"
}

function ConvertFrom-RepairPacketLine([string[]]$Lines) {
  $packetLine = @($Lines | Where-Object { $_ -match '^\[IGNITION\] (recovery-packet|repair-packet)=' } | Select-Object -Last 1)
  if (-not $packetLine -or -not $packetLine[0]) {
    return $null
  }

  $json = $packetLine[0] -replace '^\[IGNITION\] (recovery-packet|repair-packet)=', ''
  try {
    return $json | ConvertFrom-Json
  }
  catch {
    Write-IgniteApprovalLog "failed to parse ignition repair packet: $($_.Exception.Message)"
    return $null
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

function Format-ApprovalPacketText($Packet, [bool]$ApprovalAvailable) {
  $localCount = Get-ArrayCount $Packet.localOnlyCommits
  $remoteCount = Get-ArrayCount $Packet.remoteOnlyCommits
  $distOnlyText = if ($Packet.localOnlyDistOnly -eq $true) { 'YES — local-only paths are apps/stephanos/dist/** only' } else { 'NO — local-only paths are not generated-dist-only' }
  $status = if ($ApprovalAvailable) { 'APPROVAL AVAILABLE: generated-dist-only local recovery packet passed launcher safety precheck.' } else { 'BLOCKED: generated-dist-only approval is not available for this repair packet.' }

  return @"
Stephanos desktop Ignite detected a source divergence.

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

function Show-IgniteRecoveryPopup($Packet) {
  $approvalAvailable = Test-GeneratedDistRecoveryAvailable $Packet
  $message = Format-ApprovalPacketText -Packet $Packet -ApprovalAvailable $approvalAvailable

  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $form = New-Object System.Windows.Forms.Form
    $form.Text = if ($approvalAvailable) { 'Stephanos Ignite generated-dist recovery approval' } else { 'Stephanos Ignite recovery blocked' }
    $form.Size = New-Object System.Drawing.Size(760, 560)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Multiline = $true
    $textBox.ReadOnly = $true
    $textBox.ScrollBars = 'Vertical'
    $textBox.WordWrap = $false
    $textBox.Font = New-Object System.Drawing.Font('Consolas', 10)
    $textBox.Text = $message
    $textBox.SetBounds(12, 12, 720, 440)
    $form.Controls.Add($textBox)

    if ($approvalAvailable) {
      $approveButton = New-Object System.Windows.Forms.Button
      $approveButton.Text = 'Approve local recovery'
      $approveButton.SetBounds(392, 468, 160, 32)
      $approveButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
      $form.AcceptButton = $approveButton
      $form.Controls.Add($approveButton)
    }

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = 'Cancel / stop'
    $cancelButton.SetBounds(568, 468, 120, 32)
    $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.CancelButton = $cancelButton
    $form.Controls.Add($cancelButton)

    $result = $form.ShowDialog()
    return $approvalAvailable -and $result -eq [System.Windows.Forms.DialogResult]::OK
  }
  catch {
    Write-IgniteApprovalLog "popup unavailable: $($_.Exception.Message)"
    Write-Host $message
    Write-Host ''
    Write-Host "Popup failed. To approve generated-dist-only recovery manually, run: $approvedIgniteCommand" -ForegroundColor Yellow
    return $false
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
if ($null -eq $packet -or $packet.reason -ne 'ff-only-divergence') {
  Write-IgniteApprovalLog "ignition failed without generated-dist divergence approval packet; no desktop recovery approval shown."
  Write-IgniteApprovalLog "manual safe command remains: $approvedIgniteCommand"
  exit $normalExitCode
}

$approved = Show-IgniteRecoveryPopup -Packet $packet
if (-not $approved) {
  Write-IgniteApprovalLog 'operator cancelled or approval unavailable; recovery command was not run.'
  Write-Host 'Repair packet remains above for review. Press Enter to keep this window open and stop.'
  Read-Host | Out-Null
  exit $normalExitCode
}

Write-IgniteApprovalLog "operator approved generated-dist recovery; running: $approvedIgniteCommand"
& cmd.exe /d /c $approvedIgniteCommand
exit $LASTEXITCODE
