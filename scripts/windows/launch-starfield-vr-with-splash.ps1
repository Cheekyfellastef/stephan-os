[CmdletBinding()]
param(
    [string]$ProfilePath = '',
    [string]$MutarProfilePath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcherScript = Join-Path $repositoryRoot 'scripts\windows\launch-starfield-vr.ps1'
$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
if (-not $ProfilePath) {
    $ProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile.json'
}
if (-not $MutarProfilePath) {
    $MutarProfilePath = Join-Path $workspaceRoot 'vr\starfield-vr-launch-profile-mutar-openxr.json'
}
$providerPreferencePath = Join-Path $workspaceRoot 'vr\starfield-vr-provider-preference.json'
$providerCachePath = Join-Path $workspaceRoot 'vr\starfield-vr-provider-cache.json'
$simulationStatePath = Join-Path $workspaceRoot 'vr\starfield-vr-sim-air-link.json'
$vrModeStatePath = Join-Path $workspaceRoot 'vr\vr-mode-state-current.json'
$aerObserveScript = Join-Path $repositoryRoot 'scripts\windows\run-starfield-aer-stabilizer-observe.ps1'
$simulationEnabled = $false
if (Test-Path -LiteralPath $simulationStatePath -PathType Leaf) {
    try {
        $simulationState = Get-Content -LiteralPath $simulationStatePath -Raw | ConvertFrom-Json
        $simulationEnabled = $simulationState.schemaVersion -eq 'stephanos.starfield-vr-sim-air-link.v1' -and $simulationState.enabled -eq $true -and $simulationState.purpose -eq 'readiness-only'
    } catch { $simulationEnabled = $false }
}
$providerSlotScript = Join-Path $repositoryRoot 'scripts\starfield-vr-provider-slot.mjs'
$nodeExecutable = 'C:\Program Files\nodejs\node.exe'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

foreach ($required in @($launcherScript, $providerSlotScript, $aerObserveScript, $nodeExecutable, $powershellExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required Starfield VR splash component is missing: $required"
    }
}
if ($launcherScript.Contains('"') -or $ProfilePath.Contains('"') -or $MutarProfilePath.Contains('"')) {
    throw 'Launcher and profile paths must not contain quote characters.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Start-StarfieldVrLauncherProcess {
    param(
        [Parameter(Mandatory)][string]$SelectedProfilePath,
        [switch]$ReadinessOnly
    )

    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $launcherScript),
        '-ProfilePath', ('"{0}"' -f $SelectedProfilePath)
    )
    if ($ReadinessOnly) { $arguments += '-ReadinessOnly' }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershellExecutable
    $startInfo.Arguments = ($arguments -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    return $process
}

function Start-AerObserveProcess {
    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $aerObserveScript)
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $powershellExecutable
    $startInfo.Arguments = ($arguments -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    return $process
}

function Test-AerObserveReady {
    try {
        $json = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $aerObserveScript -ValidateOnly 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or -not $json.Trim()) { return $false }
        $payload = $json.Trim() | ConvertFrom-Json
        return [bool]$payload.ready -and [string]$payload.mode -eq 'OBSERVE' -and [bool]$payload.rollbackArmed
    }
    catch {
        return $false
    }
}

function Complete-StarfieldVrLauncherProcess {
    param([Parameter(Mandatory)]$Process)

    if (-not $Process.HasExited) { return $null }
    $stdout = $Process.StandardOutput.ReadToEnd()
    $stderr = $Process.StandardError.ReadToEnd()
    $exitCode = $Process.ExitCode
    $Process.Dispose()

    return [pscustomobject]@{
        ExitCode = $exitCode
        Stdout = [string]$stdout
        Stderr = [string]$stderr
    }
}

function Start-ProviderSlotProcess {
    param([Parameter(Mandatory)][string]$Provider)

    if (Get-Process -Name 'Starfield' -ErrorAction SilentlyContinue) {
        throw 'provider-slot-switch-blocked-starfield-running'
    }

    $arguments = @(
        ('"{0}"' -f $providerSlotScript),
        '--manifest', ('"{0}"' -f $providerCachePath),
        '--provider', $Provider,
        '--apply'
    )
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodeExecutable
    $startInfo.Arguments = ($arguments -join ' ')
    $startInfo.WorkingDirectory = $repositoryRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    return $process
}

function ConvertFrom-LastJsonObject {
    param([string]$Text)

    $candidate = [string]$Text
    if (-not $candidate.Trim()) { return $null }
    $match = [regex]::Match($candidate, '(?s)\{.*\}\s*$')
    if (-not $match.Success) { return $null }
    try { return ($match.Value | ConvertFrom-Json) } catch { return $null }
}

function Get-SafeBlockerText {
    param($Result)

    $items = @()
    if ($Result -and $Result.decision -and $Result.decision.blockers) {
        foreach ($blocker in @($Result.decision.blockers)) {
            $text = [string]$blocker
            if ($text -and $text.Length -le 160 -and $text -match '^[A-Za-z0-9._:-]+$') {
                $items += $text
            }
        }
    }
    if ($items.Count -eq 0) { $items = @('verified-vr-route-not-ready') }
    return $items
}

function Test-ProviderProfileConfigured {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Provider
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $profile = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        return [string]$profile.schemaVersion -eq 'stephanos.starfield-vr-launch-profile.v1' -and
            [string]$profile.status -eq 'ready' -and
            [string]$profile.selectedProvider -eq $Provider
    }
    catch {
        return $false
    }
}

function Test-MutarPackageStaged {
    if (-not (Test-Path -LiteralPath $providerCachePath -PathType Leaf)) { return $false }
    try {
        $cache = Get-Content -LiteralPath $providerCachePath -Raw | ConvertFrom-Json
        $provider = $cache.providers.'mutar-openxr'
        if (-not $provider -or [string]$provider.status -notin @('experimental-source', 'verified-source')) { return $false }
        foreach ($file in @($provider.files)) {
            if (-not (Test-Path -LiteralPath ([string]$file.path) -PathType Leaf)) { return $false }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Write-ProviderPreference {
    param([Parameter(Mandatory)][string]$Provider)
    try {
        $parent = Split-Path -Parent $providerPreferencePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $payload = [ordered]@{
            schemaVersion = 'stephanos.starfield-vr-provider-preference.v1'
            selectedProvider = $Provider
            writtenAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText(
            $providerPreferencePath,
            $payload,
            (New-Object System.Text.UTF8Encoding($false))
        )
        return $true
    }
    catch {
        return $false
    }
}

function Set-SimulatedAirLinkState {
    param([Parameter(Mandatory)][bool]$Enabled)
    try {
        $parent = Split-Path -Parent $simulationStatePath
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $payload = [ordered]@{
            schemaVersion = 'stephanos.starfield-vr-sim-air-link.v1'
            enabled = $Enabled
            purpose = 'readiness-only'
            updatedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Depth 4
        [System.IO.File]::WriteAllText(
            $simulationStatePath,
            $payload + [Environment]::NewLine,
            (New-Object System.Text.UTF8Encoding($false))
        )
        $script:simulationEnabled = $Enabled
        return $true
    }
    catch {
        return $false
    }
}

function Update-SimulationToggleUi {
    if (-not $simulationPanel -or -not $simulationLight -or -not $simulationLabel) { return }
    $simulationLight.BackColor = if ($script:simulationEnabled) {
        [System.Drawing.Color]::FromArgb(64, 210, 142)
    } else {
        [System.Drawing.Color]::FromArgb(70, 78, 88)
    }
    $simulationLabel.Text = if ($script:simulationEnabled) {
        'SIM AIR LINK: ON · TURN OFF (TEST)'
    } else {
        'SIM AIR LINK: OFF · TURN ON (TEST)'
    }
}

function Disable-SimulatedAirLinkForRealLaunch {
    if (-not $script:simulationEnabled) { return $true }
    if (-not (Set-SimulatedAirLinkState -Enabled $false)) { return $false }
    Update-SimulationToggleUi
    return $true
}

$fontFamily = 'Segoe UI'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Starfield VR'
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size(1040, 700)
$form.BackColor = [System.Drawing.Color]::FromArgb(2, 6, 12)
$form.AllowTransparency = $false
$form.KeyPreview = $true
$form.ShowInTaskbar = $true
$form.Opacity = 1.0

$stars = New-Object System.Collections.Generic.List[object]
$random = New-Object System.Random(1591)
for ($i = 0; $i -lt 95; $i++) {
    $stars.Add([pscustomobject]@{
        X = $random.Next(18, 902)
        Y = $random.Next(16, 410)
        Size = $random.Next(1, 4)
        Alpha = $random.Next(75, 220)
    })
}

$form.Add_Paint({
    param($sender, $eventArgs)
    $graphics = $eventArgs.Graphics
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle(0, 0, $form.ClientSize.Width, $form.ClientSize.Height)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(2, 6, 12),
        [System.Drawing.Color]::FromArgb(5, 12, 20),
        18.0
    )
    $graphics.FillRectangle($gradient, $rect)
    $gradient.Dispose()

    foreach ($star in $stars) {
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([Math]::Min(28, $star.Alpha), 205, 229, 255))
        $graphics.FillEllipse($brush, $star.X, $star.Y, $star.Size, $star.Size)
        $brush.Dispose()
    }

    $arcPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(30, 93, 203, 255), 1.3)
    $graphics.DrawArc($arcPen, 590, 58, 270, 270, 205, 190)
    $graphics.DrawArc($arcPen, 627, 91, 205, 205, 28, 184)
    $arcPen.Dispose()

    $horizonPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(56, 91, 222, 255), 1.0)
    $graphics.DrawLine($horizonPen, 64, 402, 856, 402)
    $horizonPen.Dispose()
})

$eyebrow = New-Object System.Windows.Forms.Label
$eyebrow.AutoSize = $true
$eyebrow.Location = New-Object System.Drawing.Point(68, 58)
$eyebrow.ForeColor = [System.Drawing.Color]::FromArgb(146, 201, 230)
$eyebrow.Font = New-Object System.Drawing.Font($fontFamily, 10, [System.Drawing.FontStyle]::Bold)
$eyebrow.Text = 'STEPHANOS / QUEST 3 / META AIR LINK'
$form.Controls.Add($eyebrow)

$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(62, 90)
$title.ForeColor = [System.Drawing.Color]::FromArgb(245, 249, 255)
$title.Font = New-Object System.Drawing.Font($fontFamily, 34, [System.Drawing.FontStyle]::Bold)
$title.Size = New-Object System.Drawing.Size(520, 54)
$title.BackColor = [System.Drawing.Color]::Transparent
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$title.Text = 'STARFIELD VR'
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.AutoSize = $false
$subtitle.Location = New-Object System.Drawing.Point(68, 154)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(154, 174, 197)
$subtitle.Size = New-Object System.Drawing.Size(520, 24)
$subtitle.BackColor = [System.Drawing.Color]::Transparent
$subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$subtitle.Font = New-Object System.Drawing.Font($fontFamily, 10.5)
$subtitle.Text = 'CHOOSE YOUR VERIFIED VR ROUTE'
$form.Controls.Add($subtitle)

$dragState = [pscustomobject]@{
    Active = $false
    Offset = New-Object System.Drawing.Point(0, 0)
}
$beginDrag = {
    param($sender, $eventArgs)
    if ($eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $screenPoint = $sender.PointToScreen($eventArgs.Location)
    $dragState.Active = $true
    $dragState.Offset = New-Object System.Drawing.Point(
        ($screenPoint.X - $form.Left),
        ($screenPoint.Y - $form.Top)
    )
}
$moveDrag = {
    param($sender, $eventArgs)
    if (-not $dragState.Active -or $eventArgs.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
    $cursor = [System.Windows.Forms.Control]::MousePosition
    $form.Location = New-Object System.Drawing.Point(
        ($cursor.X - $dragState.Offset.X),
        ($cursor.Y - $dragState.Offset.Y)
    )
}
$endDrag = {
    $dragState.Active = $false
}
foreach ($dragSurface in @($form, $eyebrow, $title, $subtitle)) {
    $dragSurface.Add_MouseDown($beginDrag)
    $dragSurface.Add_MouseMove($moveDrag)
    $dragSurface.Add_MouseUp($endDrag)
}

$vorpxProfileConfigured = Test-ProviderProfileConfigured -Path $ProfilePath -Provider 'vorpx'
$mutarProfileConfigured = Test-ProviderProfileConfigured -Path $MutarProfilePath -Provider 'mutar-openxr'
$mutarPackageStaged = Test-MutarPackageStaged
$aerObserveReady = Test-AerObserveReady

function New-ProviderCard {
    param(
        [Parameter(Mandatory)][int]$X,
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][string]$ActionText,
        [Parameter(Mandatory)][System.Drawing.Color]$BorderColor,
        [Parameter(Mandatory)][System.Drawing.Color]$CardColor,
        [Parameter(Mandatory)][System.Drawing.Color]$StatusColor,
        [Parameter(Mandatory)][bool]$Enabled
    )

    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($X, 198)
    $panel.Size = New-Object System.Drawing.Size(280, 138)
    $panel.BackColor = $CardColor
    $panel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $form.Controls.Add($panel)

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.AutoSize = $false
    $titleLabel.Location = New-Object System.Drawing.Point(16, 14)
    $titleLabel.Size = New-Object System.Drawing.Size(248, 26)
    $titleLabel.Font = New-Object System.Drawing.Font($fontFamily, 12, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(238, 246, 255)
    $titleLabel.Text = $Title
    $panel.Controls.Add($titleLabel)

    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.AutoSize = $false
    $statusLabel.Location = New-Object System.Drawing.Point(16, 52)
    $statusLabel.Size = New-Object System.Drawing.Size(248, 18)
    $statusLabel.Font = New-Object System.Drawing.Font($fontFamily, 8.5, [System.Drawing.FontStyle]::Bold)
    $statusLabel.ForeColor = $StatusColor
    $statusLabel.Text = $Status
    $statusLabel.AutoEllipsis = $true
    $panel.Controls.Add($statusLabel)

    $button = New-Object System.Windows.Forms.Button
    $button.Location = New-Object System.Drawing.Point(16, 94)
    $button.Size = New-Object System.Drawing.Size(248, 30)
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 1
    $button.FlatAppearance.BorderColor = $BorderColor
    $button.BackColor = [System.Drawing.Color]::FromArgb(19, 31, 46)
    $button.ForeColor = if ($Enabled) {
        [System.Drawing.Color]::FromArgb(233, 244, 255)
    } else {
        [System.Drawing.Color]::FromArgb(185, 195, 208)
    }
    $button.Font = New-Object System.Drawing.Font($fontFamily, 9, [System.Drawing.FontStyle]::Bold)
    $button.Text = $ActionText
    $button.Enabled = $Enabled
    $panel.Controls.Add($button)

    return [pscustomobject]@{
        Panel = $panel
        Title = $titleLabel
        Status = $statusLabel
        Button = $button
    }
}

$vorpxStatus = if ($vorpxProfileConfigured) { 'PLAYTESTED BASELINE' } else { 'PROFILE NOT CONFIGURED' }
$vorpxArgs = @{
    X = 68
    Title = 'VorpX Baseline'
    Status = $vorpxStatus
    ActionText = 'Launch VorpX'
    BorderColor = [System.Drawing.Color]::FromArgb(82, 178, 222)
    CardColor = [System.Drawing.Color]::FromArgb(8, 30, 46)
    StatusColor = [System.Drawing.Color]::FromArgb(134, 214, 247)
    Enabled = $vorpxProfileConfigured
}
$vorpxCard = New-ProviderCard @vorpxArgs
$vorpxButton = $vorpxCard.Button

if ($mutarProfileConfigured) {
    $mutarStatus = 'EXPERIMENTAL'
    $mutarAction = 'Launch Mutar / OpenXR'
    $mutarEnabled = $true
}
elseif ($mutarPackageStaged) {
    $mutarStatus = 'STAGED / NOT CONFIGURED'
    $mutarAction = 'Needs profile'
    $mutarEnabled = $false
}
else {
    $mutarStatus = 'PACKAGE NOT STAGED'
    $mutarAction = 'Needs profile'
    $mutarEnabled = $false
}
$mutarArgs = @{
    X = 380
    Title = 'Mutar / OpenXR'
    Status = $mutarStatus
    ActionText = $mutarAction
    BorderColor = [System.Drawing.Color]::FromArgb(120, 142, 230)
    CardColor = [System.Drawing.Color]::FromArgb(16, 23, 52)
    StatusColor = [System.Drawing.Color]::FromArgb(171, 184, 255)
    Enabled = $mutarEnabled
}
$mutarCard = New-ProviderCard @mutarArgs
$mutarButton = $mutarCard.Button

$aerObserveCheckbox = New-Object System.Windows.Forms.CheckBox
$aerObserveCheckbox.Location = New-Object System.Drawing.Point(16, 72)
$aerObserveCheckbox.Size = New-Object System.Drawing.Size(248, 18)
$aerObserveCheckbox.BackColor = [System.Drawing.Color]::Transparent
$aerObserveCheckbox.ForeColor = if ($aerObserveReady) {
    [System.Drawing.Color]::FromArgb(141, 235, 194)
} else {
    [System.Drawing.Color]::FromArgb(137, 145, 158)
}
$aerObserveCheckbox.Font = New-Object System.Drawing.Font($fontFamily, 8, [System.Drawing.FontStyle]::Bold)
$aerObserveCheckbox.Text = 'AER OBSERVE / AUTO RECORD'
$aerObserveCheckbox.Checked = $aerObserveReady
$aerObserveCheckbox.Enabled = $aerObserveReady
$mutarCard.Panel.Controls.Add($aerObserveCheckbox)
if ($aerObserveReady) {
    $mutarButton.Text = 'Launch AER Observe'
}

$hybridArgs = @{
    X = 692
    Title = 'Hybrid / Stephanos VR'
    Status = 'LOCKED'
    ActionText = 'Locked'
    BorderColor = [System.Drawing.Color]::FromArgb(80, 92, 108)
    CardColor = [System.Drawing.Color]::FromArgb(18, 22, 28)
    StatusColor = [System.Drawing.Color]::FromArgb(132, 143, 156)
    Enabled = $false
}
$hybridCard = New-ProviderCard @hybridArgs
$hybridButton = $hybridCard.Button

$modeLegendPanel = New-Object System.Windows.Forms.Panel
$modeLegendPanel.Location = New-Object System.Drawing.Point(68, 344)
$modeLegendPanel.Size = New-Object System.Drawing.Size(592, 22)
$modeLegendPanel.BackColor = [System.Drawing.Color]::FromArgb(8, 22, 34)
$form.Controls.Add($modeLegendPanel)

function Get-AerTrafficColor {
    param([ValidateSet('green','yellow','grey')][string]$State)
    switch ($State) {
        'green' { return [System.Drawing.Color]::FromArgb(64, 210, 142) }
        'yellow' { return [System.Drawing.Color]::FromArgb(224, 171, 78) }
        default { return [System.Drawing.Color]::FromArgb(70, 78, 88) }
    }
}

$modeTraffic = [ordered]@{
    baseline = 'green'
    observe = if ($aerObserveReady) { 'green' } else { 'yellow' }
    protect = 'grey'
    adaptive = 'grey'
}
if (Test-Path -LiteralPath $vrModeStatePath -PathType Leaf) {
    try {
        $modeState = Get-Content -LiteralPath $vrModeStatePath -Raw | ConvertFrom-Json
        if ([string]$modeState.schemaVersion -eq 'stephanos.vr-mode-state.v1' -and $modeState.modeTraffic) {
            foreach ($name in @('baseline','observe','protect','adaptive')) {
                $candidate = [string]$modeState.modeTraffic.$name
                if ($candidate -in @('green','yellow','grey')) { $modeTraffic[$name] = $candidate }
            }
        }
    }
    catch {}
}

function New-AerModeCell {
    param([int]$X,[string]$Name,[string]$State)

    $cell = New-Object System.Windows.Forms.Panel
    $cell.Location = New-Object System.Drawing.Point($X, 0)
    $cell.Size = New-Object System.Drawing.Size(148, 22)
    $cell.BackColor = [System.Drawing.Color]::Transparent
    $modeLegendPanel.Controls.Add($cell)

    $light = New-Object System.Windows.Forms.Label
    $light.Location = New-Object System.Drawing.Point(8, 5)
    $light.Size = New-Object System.Drawing.Size(12, 12)
    $light.BackColor = Get-AerTrafficColor -State $State
    $cell.Controls.Add($light)

    $label = New-Object System.Windows.Forms.Label
    $label.Location = New-Object System.Drawing.Point(27, 2)
    $label.Size = New-Object System.Drawing.Size(116, 18)
    $label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
    $label.Font = New-Object System.Drawing.Font($fontFamily, 7.8, [System.Drawing.FontStyle]::Bold)
    $label.Text = $Name
    $cell.Controls.Add($label)

    return [pscustomobject]@{ Panel=$cell; Light=$light; Label=$label }
}

$baselineModeCell = New-AerModeCell -X 0 -Name 'BASELINE' -State $modeTraffic.baseline
$observeModeCell = New-AerModeCell -X 148 -Name 'OBSERVE' -State $modeTraffic.observe
$protectModeCell = New-AerModeCell -X 296 -Name 'PROTECT' -State $modeTraffic.protect
$adaptiveModeCell = New-AerModeCell -X 444 -Name 'ADAPTIVE' -State $modeTraffic.adaptive

if ($aerObserveCheckbox.Checked) {
    $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
}
else {
    $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
}

$aerObserveCheckbox.Add_CheckedChanged({
    $mutarButton.Text = if ($aerObserveCheckbox.Checked) { 'Launch AER Observe' } else { 'Launch Mutar / OpenXR' }
    $observeModeCell.Label.ForeColor = if ($aerObserveCheckbox.Checked) {
        [System.Drawing.Color]::FromArgb(235, 250, 255)
    } else {
        [System.Drawing.Color]::FromArgb(174, 198, 220)
    }
    $baselineModeCell.Label.ForeColor = if ($aerObserveCheckbox.Checked) {
        [System.Drawing.Color]::FromArgb(174, 198, 220)
    } else {
        [System.Drawing.Color]::FromArgb(235, 250, 255)
    }
})

$simulationPanel = New-Object System.Windows.Forms.Panel
$simulationPanel.Location = New-Object System.Drawing.Point(692, 344)
$simulationPanel.Size = New-Object System.Drawing.Size(280, 22)
$simulationPanel.BackColor = [System.Drawing.Color]::FromArgb(18, 22, 28)
$simulationPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$simulationPanel.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($simulationPanel)

$simulationLight = New-Object System.Windows.Forms.Label
$simulationLight.Location = New-Object System.Drawing.Point(8, 5)
$simulationLight.Size = New-Object System.Drawing.Size(12, 12)
$simulationLight.BackColor = if ($simulationEnabled) { [System.Drawing.Color]::FromArgb(64, 210, 142) } else { [System.Drawing.Color]::FromArgb(70, 78, 88) }
$simulationLight.Cursor = [System.Windows.Forms.Cursors]::Hand
$simulationPanel.Controls.Add($simulationLight)

$simulationLabel = New-Object System.Windows.Forms.Label
$simulationLabel.Location = New-Object System.Drawing.Point(28, 2)
$simulationLabel.Size = New-Object System.Drawing.Size(244, 18)
$simulationLabel.ForeColor = [System.Drawing.Color]::FromArgb(170, 182, 196)
$simulationLabel.Font = New-Object System.Drawing.Font($fontFamily, 8, [System.Drawing.FontStyle]::Bold)
$simulationLabel.Cursor = [System.Windows.Forms.Cursors]::Hand
$simulationLabel.Text = if ($simulationEnabled) { 'SIM AIR LINK: ON · TURN OFF (TEST)' } else { 'SIM AIR LINK: OFF · TURN ON (TEST)' }
$simulationPanel.Controls.Add($simulationLabel)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(68, 370)
$statusPanel.Size = New-Object System.Drawing.Size(904, 116)
$statusPanel.BackColor = [System.Drawing.Color]::FromArgb(6, 14, 24)
$form.Controls.Add($statusPanel)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.AutoSize = $false
$statusLabel.Location = New-Object System.Drawing.Point(24, 18)
$statusLabel.Size = New-Object System.Drawing.Size(836, 30)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
$statusLabel.Font = New-Object System.Drawing.Font($fontFamily, 15, [System.Drawing.FontStyle]::Bold)
$statusLabel.Text = 'Choose a VR provider'
$statusPanel.Controls.Add($statusLabel)

$statusHint = New-Object System.Windows.Forms.Label
$statusHint.AutoSize = $false
$statusHint.Location = New-Object System.Drawing.Point(25, 52)
$statusHint.Size = New-Object System.Drawing.Size(836, 24)
$statusHint.ForeColor = [System.Drawing.Color]::FromArgb(151, 177, 201)
$statusHint.Font = New-Object System.Drawing.Font($fontFamily, 10)
$statusHint.Text = 'Cards show configured state only. Canonical readiness runs after you select a provider.'
$statusPanel.Controls.Add($statusHint)

$progressTrack = New-Object System.Windows.Forms.Panel
$progressTrack.Location = New-Object System.Drawing.Point(26, 90)
$progressTrack.Size = New-Object System.Drawing.Size(850, 4)
$progressTrack.BackColor = [System.Drawing.Color]::FromArgb(48, 73, 94)
$statusPanel.Controls.Add($progressTrack)

$progressFill = New-Object System.Windows.Forms.Panel
$progressFill.Location = New-Object System.Drawing.Point(0, 0)
$progressFill.Size = New-Object System.Drawing.Size(62, 4)
$progressFill.BackColor = [System.Drawing.Color]::FromArgb(106, 216, 255)
$progressTrack.Controls.Add($progressFill)

$detailsBox = New-Object System.Windows.Forms.TextBox
$detailsBox.Location = New-Object System.Drawing.Point(68, 508)
$detailsBox.Size = New-Object System.Drawing.Size(904, 90)
$detailsBox.Multiline = $true
$detailsBox.ReadOnly = $true
$detailsBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
$detailsBox.BackColor = [System.Drawing.Color]::FromArgb(8, 17, 29)
$detailsBox.ForeColor = [System.Drawing.Color]::FromArgb(172, 196, 218)
$detailsBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$detailsBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$detailsBox.Visible = $false
$detailsBox.Text = 'Choose a provider. No game will launch until you make a selection and the canonical readiness gate passes.'
$form.Controls.Add($detailsBox)

$detailsButton = New-Object System.Windows.Forms.Button
$detailsButton.Location = New-Object System.Drawing.Point(68, 642)
$detailsButton.Size = New-Object System.Drawing.Size(112, 34)
$detailsButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$detailsButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(68, 108, 138)
$detailsButton.BackColor = [System.Drawing.Color]::FromArgb(13, 28, 44)
$detailsButton.ForeColor = [System.Drawing.Color]::FromArgb(198, 218, 236)
$detailsButton.Text = 'Show details'
$detailsButton.Enabled = $true
$form.Controls.Add($detailsButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Location = New-Object System.Drawing.Point(860, 642)
$closeButton.Size = New-Object System.Drawing.Size(112, 34)
$closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeButton.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 111, 142)
$closeButton.BackColor = [System.Drawing.Color]::FromArgb(15, 31, 47)
$closeButton.ForeColor = [System.Drawing.Color]::FromArgb(223, 235, 246)
$closeButton.Text = 'Cancel'
$form.Controls.Add($closeButton)

$closeButton.Add_Click({ $form.Close() })
$form.Add_KeyDown({
    param($sender, $eventArgs)
    if ($eventArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
})
$detailsButton.Add_Click({
    $detailsBox.Visible = -not $detailsBox.Visible
    $detailsButton.Text = if ($detailsBox.Visible) { 'Hide details' } else { 'Show details' }
})

$checkStages = @(
    'Checking selected provider',
    'Checking Quest 3 route',
    'Checking Meta Air Link',
    'Checking OpenXR runtime',
    'Checking verified VR provider'
)
$stageIndex = 0
$checkTimer = New-Object System.Windows.Forms.Timer
$checkTimer.Interval = 720
$checkTimer.Add_Tick({
    if ($form.IsDisposed) { return }
    $stageIndex = [Math]::Min($stageIndex + 1, $checkStages.Count - 1)
    $statusLabel.Text = $checkStages[$stageIndex]
    $width = [Math]::Min(850, 82 + ($stageIndex * 170))
    $progressFill.Width = $width
})

$processState = [pscustomobject]@{
    Slot = $null
    Readiness = $null
    Launch = $null
    Provider = ''
    ProfilePath = ''
    Mode = 'BASELINE'
}

$toggleSimulationState = {
    if ($processState.Slot -or $processState.Readiness -or $processState.Launch) {
        $statusLabel.Text = 'Virtual Air Link test is busy'
        $statusHint.Text = 'Wait for the current provider check or launch to finish before changing test state.'
        return
    }

    $nextEnabled = -not $script:simulationEnabled
    if (-not (Set-SimulatedAirLinkState -Enabled $nextEnabled)) {
        $statusLabel.Text = 'Virtual Air Link test could not be changed'
        $statusHint.Text = 'The bounded readiness-only state file could not be updated.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        return
    }

    Update-SimulationToggleUi
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
    $statusLabel.Text = if ($script:simulationEnabled) { 'Virtual Air Link test enabled' } else { 'Virtual Air Link test disabled' }
    $statusHint.Text = if ($script:simulationEnabled) {
        'Readiness simulation only. Choosing a real Starfield VR route will turn this off automatically.'
    } else {
        'Real Meta Air Link is required for a Starfield VR launch.'
    }
}
$simulationPanel.Add_Click($toggleSimulationState)
$simulationLight.Add_Click($toggleSimulationState)
$simulationLabel.Add_Click($toggleSimulationState)
$slotPollTimer = New-Object System.Windows.Forms.Timer
$slotPollTimer.Interval = 120
$slotPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Slot) { return }
    if (-not $processState.Slot.HasExited) { return }

    $slotPollTimer.Stop()
    $invocation = Complete-StarfieldVrLauncherProcess -Process $processState.Slot
    $processState.Slot = $null
    $slotResult = ConvertFrom-LastJsonObject -Text $invocation.Stdout
    if ($invocation.ExitCode -ne 0 -or -not $slotResult -or [string]$slotResult.verdict -ne 'STARFIELD_VR_PROVIDER_SLOT_READY') {
        $reason = if ($invocation.Stderr.Trim()) { $invocation.Stderr.Trim() } elseif ($invocation.Stdout.Trim()) { $invocation.Stdout.Trim() } else { 'provider-slot-apply-failed' }
        $statusLabel.Text = 'Provider switch stopped safely'
        $statusHint.Text = 'The verified provider slot could not be prepared. Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = $reason
        $detailsBox.Visible = $true
        $detailsButton.Text = 'Hide details'
        $closeButton.Text = 'Close'
        $vorpxButton.Enabled = $vorpxProfileConfigured
        $mutarButton.Enabled = $mutarProfileConfigured
        return
    }

    $preferenceSaved = Write-ProviderPreference -Provider $processState.Provider
    $statusLabel.Text = 'Checking ' + $processState.Provider
    $statusHint.Text = 'The provider slot is verified. The canonical readiness gate must pass before Starfield can start.'
    $detailsBox.Text = 'Selected provider: ' + $processState.Provider +
        [Environment]::NewLine + 'Provider slot: ' + [string]$slotResult.verdict +
        [Environment]::NewLine + 'Receipt: ' + [string]$slotResult.receiptPath +
        [Environment]::NewLine + 'Readiness check is running.'
    if (-not $preferenceSaved) {
        $detailsBox.Text += [Environment]::NewLine + 'Warning: provider preference could not be saved; launch is continuing.'
    }
    $progressFill.Width = 82

    if ($processState.Mode -eq 'AER_OBSERVE') {
        $statusLabel.Text = 'Launching AER Observe'
        $statusHint.Text = 'Recording starts automatically once the OpenXR VR runtime is active.'
        $detailsBox.Text += [Environment]::NewLine + 'AER stabilizer: OBSERVE / AUTO RECORD' +
            [Environment]::NewLine + 'Rollback: armed before experimental DLL swap.'
        $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
        $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
        try {
            $processState.Launch = Start-AerObserveProcess
            $launchPollTimer.Start()
        }
        catch {
            $statusLabel.Text = 'AER Observe launch stopped safely'
            $statusHint.Text = 'The guarded observe launcher could not be started. Starfield was not started.'
            $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
            $detailsBox.Text = $_.Exception.Message
            $detailsBox.Visible = $true
            $detailsButton.Text = 'Hide details'
            $closeButton.Text = 'Close'
            $vorpxButton.Enabled = $vorpxProfileConfigured
            $mutarButton.Enabled = $mutarProfileConfigured
            $aerObserveCheckbox.Enabled = $aerObserveReady
        }
        return
    }

    Start-ReadinessCheck
})
$readinessPollTimer = New-Object System.Windows.Forms.Timer
$readinessPollTimer.Interval = 120
$readinessPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Readiness) { return }
    if (-not $processState.Readiness.HasExited) { return }

    $readinessPollTimer.Stop()
    $checkTimer.Stop()
    $invocation = Complete-StarfieldVrLauncherProcess -Process $processState.Readiness
    $processState.Readiness = $null
    $readiness = ConvertFrom-LastJsonObject -Text $invocation.Stdout

    if ($invocation.ExitCode -ne 0 -or -not $readiness -or [string]$readiness.verdict -ne 'STARFIELD_VR_LAUNCH_READY') {
        $blockers = Get-SafeBlockerText -Result $readiness
        $statusLabel.Text = 'Starfield VR is not ready yet'
        $statusHint.Text = 'The verified route failed closed. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = (($blockers | ForEach-Object { "• $_" }) -join [Environment]::NewLine)
        $detailsButton.Enabled = $true
        $closeButton.Text = 'Close'
        $vorpxButton.Enabled = $vorpxProfileConfigured
        $mutarButton.Enabled = $mutarProfileConfigured
        return
    }

    $statusLabel.Text = 'Ready to launch'
    $statusHint.Text = 'Quest 3, OpenXR and the verified VR provider passed the launch gate.'
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(174, 255, 221)
    $progressFill.BackColor = [System.Drawing.Color]::FromArgb(113, 236, 193)
    $progressFill.Width = 850
    $closeButton.Enabled = $false
    $launchDelayTimer.Start()
})

$processState.Launch = $null
$launchPollTimer = New-Object System.Windows.Forms.Timer
$launchPollTimer.Interval = 120
$launchPollTimer.Add_Tick({
    if ($form.IsDisposed -or -not $processState.Launch) { return }
    if (-not $processState.Launch.HasExited) { return }

    $launchPollTimer.Stop()
    $launchResult = Complete-StarfieldVrLauncherProcess -Process $processState.Launch
    $processState.Launch = $null
    if ($launchResult.ExitCode -eq 0) {
        if ($processState.Mode -eq 'AER_OBSERVE') {
            $statusLabel.Text = 'AER Observe launched'
            $statusHint.Text = 'Play normally. AER recording begins automatically once the OpenXR VR runtime is active.'
            $observeModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(235, 250, 255)
            $baselineModeCell.Label.ForeColor = [System.Drawing.Color]::FromArgb(174, 198, 220)
        }
        else {
            $statusLabel.Text = 'Starfield VR launched'
            $statusHint.Text = 'The verified launcher accepted the route and started the game.'
        }
        $finishTimer.Start()
    }
    else {
        $statusLabel.Text = if ($processState.Mode -eq 'AER_OBSERVE') { 'AER Observe stopped safely' } else { 'Launch stopped safely' }
        $statusHint.Text = 'Conditions changed before launch. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        if ($processState.Mode -eq 'AER_OBSERVE') {
            $reason = if ($launchResult.Stderr.Trim()) { $launchResult.Stderr.Trim() } elseif ($launchResult.Stdout.Trim()) { $launchResult.Stdout.Trim() } else { 'aer-observe-launch-failed' }
            $detailsBox.Text = $reason
        }
        else {
            $launchPayload = ConvertFrom-LastJsonObject -Text $launchResult.Stdout
            $blockers = Get-SafeBlockerText -Result $launchPayload
            $detailsBox.Text = (($blockers | ForEach-Object { "• $_" }) -join [Environment]::NewLine)
        }
        $detailsButton.Enabled = $true
        $closeButton.Enabled = $true
        $closeButton.Text = 'Close'
        $aerObserveCheckbox.Enabled = $aerObserveReady
    }
})

$launchDelayTimer = New-Object System.Windows.Forms.Timer
$launchDelayTimer.Interval = 650
$launchDelayTimer.Add_Tick({
    $launchDelayTimer.Stop()
    if ($form.IsDisposed) { return }
    $statusLabel.Text = 'Launching Starfield VR'
    $statusHint.Text = 'Handing off to the existing verified launcher. No flat-game fallback is permitted.'
    try {
        $processState.Launch = Start-StarfieldVrLauncherProcess -SelectedProfilePath $processState.ProfilePath
        $launchPollTimer.Start()
    }
    catch {
        $statusLabel.Text = 'Launch stopped safely'
        $statusHint.Text = 'The launcher could not be started. Flat Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $detailsBox.Text = 'launch-process-start-failed' + [Environment]::NewLine + $_.Exception.Message
        $detailsButton.Enabled = $true
        $closeButton.Enabled = $true
        $closeButton.Text = 'Close'
    }
})

$finishTimer = New-Object System.Windows.Forms.Timer
$finishTimer.Interval = 850
$finishTimer.Add_Tick({
    $finishTimer.Stop()
    if (-not $form.IsDisposed) { $form.Close() }
})

function Start-ReadinessCheck {
    if ($form.IsDisposed -or -not $processState.ProfilePath) { return }
    $checkTimer.Start()
    try {
        $processState.Readiness = Start-StarfieldVrLauncherProcess -SelectedProfilePath $processState.ProfilePath -ReadinessOnly
        $readinessPollTimer.Start()
    }
    catch {
        $checkTimer.Stop()
        $statusLabel.Text = 'Starfield VR readiness could not be verified'
        $statusHint.Text = 'Nothing was launched. The readiness launcher could not be started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = 'readiness-process-start-failed' + [Environment]::NewLine + $_.Exception.Message
        $detailsButton.Enabled = $true
        $closeButton.Text = 'Close'
        $vorpxButton.Enabled = $vorpxProfileConfigured
        $mutarButton.Enabled = $mutarProfileConfigured
    }
}

function Start-ProviderRoute {
    param(
        [Parameter(Mandatory)][string]$Provider,
        [Parameter(Mandatory)][string]$SelectedProfilePath,
        [ValidateSet('BASELINE','AER_OBSERVE')][string]$Mode = 'BASELINE'
    )

    if ($processState.Slot -or $processState.Readiness -or $processState.Launch) { return }
    if (-not (Disable-SimulatedAirLinkForRealLaunch)) {
        $statusLabel.Text = 'Starfield VR launch stopped safely'
        $statusHint.Text = 'The readiness-only Virtual Air Link state could not be cleared. Nothing was launched.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        return
    }
    $processState.Provider = $Provider
    $processState.ProfilePath = $SelectedProfilePath
    $processState.Mode = $Mode
    $vorpxButton.Enabled = $false
    $mutarButton.Enabled = $false
    $aerObserveCheckbox.Enabled = $false
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(234, 244, 255)
    $statusLabel.Text = 'Preparing ' + $Provider
    $statusHint.Text = 'Switching the bounded Starfield provider slot before readiness is evaluated.'
    $detailsBox.Text = 'Selected provider: ' + $Provider + [Environment]::NewLine + 'Applying verified provider slot.'

    try {
        $processState.Slot = Start-ProviderSlotProcess -Provider $Provider
        $slotPollTimer.Start()
    }
    catch {
        $processState.Slot = $null
        $statusLabel.Text = 'Provider switch stopped safely'
        $statusHint.Text = 'The verified provider slot could not be prepared. Starfield was not started.'
        $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 197, 153)
        $progressFill.BackColor = [System.Drawing.Color]::FromArgb(255, 172, 103)
        $progressFill.Width = 850
        $detailsBox.Text = $_.Exception.Message
        $detailsBox.Visible = $true
        $detailsButton.Text = 'Hide details'
        $closeButton.Text = 'Close'
        $vorpxButton.Enabled = $vorpxProfileConfigured
        $mutarButton.Enabled = $mutarProfileConfigured
    }
}

$vorpxButton.Add_Click({
    Start-ProviderRoute -Provider 'vorpx' -SelectedProfilePath $ProfilePath
})
$mutarButton.Add_Click({
    if ($mutarProfileConfigured) {
        $selectedMode = if ($aerObserveCheckbox.Checked -and $aerObserveReady) { 'AER_OBSERVE' } else { 'BASELINE' }
        Start-ProviderRoute -Provider 'mutar-openxr' -SelectedProfilePath $MutarProfilePath -Mode $selectedMode
        return
    }
    $statusLabel.Text = 'Mutar / OpenXR is not ready yet'
    $statusHint.Text = 'The verified package is staged, but its launch profile and provider slot are not configured.'
    $detailsBox.Text = 'Mutar / OpenXR remains fail-closed until the provider profile and exact live injection slot are verified.'
    $detailsBox.Visible = $true
    $detailsButton.Text = 'Hide details'
})

$hybridButton.Add_Click({
    $statusLabel.Text = 'Hybrid / Stephanos VR is locked'
    $statusHint.Text = 'The composite route stays locked until we build a deliberate provider rather than stacking injectors.'
    $detailsBox.Text = 'VorpX and Mutar both want the same Starfield injection slot. Hybrid will only unlock after a purpose-built composite route exists.'
    $detailsBox.Visible = $true
    $detailsButton.Text = 'Hide details'
})

$form.Add_Shown({
    $statusLabel.Text = 'Choose a VR provider'
    $statusHint.Text = 'Nothing launches until you choose a route.'
})

try {
    [void]$form.ShowDialog()
}
finally {
    $checkTimer.Stop()
    $slotPollTimer.Stop()
    $readinessPollTimer.Stop()
    $launchDelayTimer.Stop()
    $launchPollTimer.Stop()
    $finishTimer.Stop()
    $form.Dispose()
}
