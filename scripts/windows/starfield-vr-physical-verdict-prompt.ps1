[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][string]$SessionId,
    [string]$ReportScript = '',
    [int]$TimeoutSeconds = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$verdictRoot = Join-Path $WorkspaceRoot 'vr\starfield-vr-physical-verdicts'
New-Item -ItemType Directory -Path $verdictRoot -Force | Out-Null
$currentPath = Join-Path $WorkspaceRoot 'vr\starfield-vr-physical-verdict-current.json'
$sessionPath = Join-Path $verdictRoot ($SessionId + '.json')
$canonicalReportScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'report-starfield-vr-telemetry.mjs'
$resolvedCanonicalReportScript = [IO.Path]::GetFullPath($canonicalReportScript)
if ($ReportScript) {
    try {
        $resolvedRequestedReportScript = [IO.Path]::GetFullPath($ReportScript)
    }
    catch {
        throw 'ReportScript must resolve to the canonical Starfield VR telemetry reporter.'
    }
    if (-not [string]::Equals(
        $resolvedRequestedReportScript,
        $resolvedCanonicalReportScript,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw 'ReportScript must match the canonical Starfield VR telemetry reporter.'
    }
}
$ReportScript = $resolvedCanonicalReportScript
if (-not (Test-Path -LiteralPath $ReportScript -PathType Leaf)) {
    throw 'Canonical Starfield VR telemetry reporter is missing.'
}

function Write-Verdict {
    param(
        [string]$PrimaryVerdict,
        [string]$PhysicalAcceptance
    )
    $payload = [ordered]@{
        schemaVersion = 'stephanos.starfield-vr-physical-verdict.v1'
        recordedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        sessionId = $SessionId
        primaryVerdict = $PrimaryVerdict
        physicalAcceptance = $PhysicalAcceptance
        source = 'OPERATOR_ONE_CLICK_POST_RUN'
        inferred = $false
    }
    $json = $payload | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($sessionPath, $json, (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText($currentPath, $json, (New-Object Text.UTF8Encoding($false)))

    try {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($node) { & $node.Source $ReportScript *> $null }
    } catch {}
}

$form = New-Object Windows.Forms.Form
$form.Text = 'Starfield VR playtest verdict'
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.Width = 720
$form.Height = 650
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object Windows.Forms.Label
$label.Text = 'What best describes the headset result? One click is enough.'
$label.AutoSize = $false
$label.TextAlign = 'MiddleCenter'
$label.Font = New-Object Drawing.Font('Segoe UI', 15, [Drawing.FontStyle]::Bold)
$label.SetBounds(30, 20, 640, 55)
$form.Controls.Add($label)

$choices = @(
    @{ text = 'Smooth / comfortable'; verdict = 'SMOOTH_COMFORTABLE'; acceptance = 'ACCEPTED_THIS_RUN' },
    @{ text = 'Judder / low FPS'; verdict = 'JUDDER_LOW_FPS'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Stereo breakup / alternate-eye'; verdict = 'STEREO_BREAKUP'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Stretching / geometry distortion'; verdict = 'STRETCHING_DISTORTION'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Particle / colour artefacts'; verdict = 'PARTICLE_ARTEFACTS'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Nausea / discomfort'; verdict = 'NAUSEA_DISCOMFORT'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Crash / unusable'; verdict = 'CRASH_OR_UNUSABLE'; acceptance = 'REJECTED_THIS_RUN' },
    @{ text = 'Skip verdict'; verdict = 'UNRECORDED'; acceptance = 'UNRECORDED' }
)

$y = 90
foreach ($choice in $choices) {
    $button = New-Object Windows.Forms.Button
    $button.Text = [string]$choice.text
    $button.Font = New-Object Drawing.Font('Segoe UI', 12)
    $button.SetBounds(70, $y, 560, 52)
    $verdict = [string]$choice.verdict
    $acceptance = [string]$choice.acceptance
    $button.Add_Click({
        Write-Verdict -PrimaryVerdict $verdict -PhysicalAcceptance $acceptance
        $form.Tag = 'RECORDED'
        $form.Close()
    }.GetNewClosure())
    $form.Controls.Add($button)
    $y += 62
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = [Math]::Max(10, $TimeoutSeconds) * 1000
$timer.Add_Tick({
    $timer.Stop()
    Write-Verdict -PrimaryVerdict 'UNRECORDED_TIMEOUT' -PhysicalAcceptance 'UNRECORDED'
    $form.Tag = 'TIMEOUT'
    $form.Close()
})
$timer.Start()
[void]$form.ShowDialog()
$timer.Stop()
