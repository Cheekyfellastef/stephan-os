[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$WorkspaceRoot,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,160}$')][string]$LaunchSessionId,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,120}$')][string]$GameId,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,120}$')][string]$TargetProcessName,
    [int]$InitialProcessId = 0,
    [int]$PollMilliseconds = 100,
    [int]$NoGameGraceSeconds = 35
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class StephanosVrMarkerNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_GAMEPAD {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct XINPUT_STATE {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }

    [DllImport("xinput1_4.dll", EntryPoint="XInputGetState")]
    public static extern uint XInputGetState(uint dwUserIndex, out XINPUT_STATE pState);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);
}
'@

$sessionRoot = Join-Path $WorkspaceRoot ('vr\telemetry\sessions\' + $LaunchSessionId)
New-Item -ItemType Directory -Force -Path $sessionRoot | Out-Null
$markerPath = Join-Path $sessionRoot 'operator-markers.jsonl'
$utf8 = New-Object Text.UTF8Encoding($false)
$markerComboMask = 0x0020 -bor 0x0040 -bor 0x0080 # BACK/VIEW + L3 + R3
$comboWasDown = $false
$f12WasDown = $false
$gameSeen = $false
$missingSince = $null

function Write-Marker {
    param([string]$Source)
    $payload = [ordered]@{
        schemaVersion = 'stephanos.vr-visual-fault-marker.v1'
        event = 'operator_visual_fault_marker'
        recordedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        launchSessionId = $LaunchSessionId
        gameId = $GameId
        source = $Source
        meaning = 'operator-observed-visual-anomaly'
    } | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($markerPath, $payload + [Environment]::NewLine, $utf8)
}

while ($true) {
    $running = @()
    if ($InitialProcessId -gt 0) {
        $initial = Get-Process -Id $InitialProcessId -ErrorAction SilentlyContinue
        if ($initial) { $running += $initial }
    }
    $running += @(Get-Process -Name $TargetProcessName -ErrorAction SilentlyContinue)

    if ($running.Count -gt 0) {
        $gameSeen = $true
        $missingSince = $null
    }
    elseif ($gameSeen) {
        if (-not $missingSince) { $missingSince = Get-Date }
        if (((Get-Date) - $missingSince).TotalSeconds -ge [Math]::Max(5, $NoGameGraceSeconds)) { break }
    }

    $comboDown = $false
    for ($userIndex = 0; $userIndex -lt 4; $userIndex += 1) {
        $state = New-Object StephanosVrMarkerNative+XINPUT_STATE
        try {
            $result = [StephanosVrMarkerNative]::XInputGetState([uint32]$userIndex, [ref]$state)
            if ($result -eq 0 -and (($state.Gamepad.wButtons -band $markerComboMask) -eq $markerComboMask)) {
                $comboDown = $true
                break
            }
        } catch {}
    }
    if ($comboDown -and -not $comboWasDown) { Write-Marker -Source 'XINPUT_VIEW_L3_R3' }
    $comboWasDown = $comboDown

    $f12Down = (([StephanosVrMarkerNative]::GetAsyncKeyState(0x7B) -band 0x8000) -ne 0)
    if ($f12Down -and -not $f12WasDown) { Write-Marker -Source 'KEYBOARD_F12' }
    $f12WasDown = $f12Down

    Start-Sleep -Milliseconds ([Math]::Max(50, $PollMilliseconds))
}
