Set-StrictMode -Version Latest

function Convert-ToCodexUsageSafeText {
    param([object]$Value, [int]$Limit = 220)

    $text = [string]$Value
    $text = ($text -replace '[\r\n\t]+', ' ' -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Limit) { return $text.Substring(0, $Limit) }
    return $text
}

function New-CodexUsageEvidenceResult {
    param(
        [bool]$Valid,
        [string]$Blocker,
        [string]$SurfaceKind = '',
        [string]$MeterSummary = '',
        [array]$ExpiryTexts = @(),
        [array]$ResetButtons = @(),
        [array]$ProofRefs = @()
    )

    return [pscustomobject]@{
        valid = $Valid
        blocker = Convert-ToCodexUsageSafeText $Blocker 120
        surfaceKind = Convert-ToCodexUsageSafeText $SurfaceKind 80
        meterSummary = Convert-ToCodexUsageSafeText $MeterSummary 300
        expiryTexts = @($ExpiryTexts | ForEach-Object { Convert-ToCodexUsageSafeText $_ 220 } | Select-Object -Unique -First 12)
        resetButtons = @($ResetButtons | ForEach-Object { Convert-ToCodexUsageSafeText $_ 120 } | Select-Object -Unique -First 12)
        proofRefs = @($ProofRefs | ForEach-Object { Convert-ToCodexUsageSafeText $_ 120 } | Select-Object -Unique -First 12)
    }
}

function Select-CodexUniqueProcessCandidates {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [array]$Candidates
    )

    $groups = @{}
    foreach ($candidate in @($Candidates)) {
        if ($null -eq $candidate) { continue }
        try {
            $processId = [int]$candidate.ProcessId
            $processName = Convert-ToCodexUsageSafeText $candidate.ProcessName 80
            $windowName = Convert-ToCodexUsageSafeText $candidate.Name 160
        } catch {
            continue
        }
        if ($processId -le 0 -or $processName -notin @('ChatGPT', 'Codex', 'msedge')) { continue }
        $key = [string]$processId
        if (-not $groups.ContainsKey($key)) { $groups[$key] = @() }
        $groups[$key] += [pscustomobject]@{
            Candidate = $candidate
            ProcessName = $processName
            WindowName = $windowName
        }
    }

    $selected = @()
    foreach ($key in @($groups.Keys | Sort-Object { [int]$_ })) {
        $group = @($groups[$key])
        $processNames = @($group | Select-Object -ExpandProperty ProcessName -Unique)
        if ($processNames.Count -ne 1) { continue }
        $ordered = @($group | Sort-Object WindowName)
        if ($ordered.Count -gt 0) { $selected += $ordered[0].Candidate }
    }
    return @($selected)
}

function Resolve-CodexUsageSurfaceEvidence {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [array]$Snapshot,
        [Parameter(Mandatory = $true)]
        [ValidateSet('ChatGPT', 'Codex', 'msedge')]
        [string]$ProcessName
    )

    $items = @()
    $ordinal = 0
    foreach ($source in @($Snapshot)) {
        if ($null -eq $source) { continue }
        try {
            $name = Convert-ToCodexUsageSafeText $source.Name 220
            $type = Convert-ToCodexUsageSafeText $source.Type 100
            $automationId = if ($null -ne $source.PSObject.Properties['AutomationId']) { Convert-ToCodexUsageSafeText $source.AutomationId 160 } else { '' }
            $value = if ($null -ne $source.PSObject.Properties['Value']) { Convert-ToCodexUsageSafeText $source.Value 500 } else { '' }
            $enabled = if ($null -ne $source.PSObject.Properties['Enabled']) { [bool]$source.Enabled } else { $true }
            $offscreen = if ($null -ne $source.PSObject.Properties['Offscreen']) { [bool]$source.Offscreen } else { $false }
        } catch {
            continue
        }
        if (-not $name) { continue }
        $items += [pscustomobject]@{
            Name = $name
            Type = $type
            AutomationId = $automationId
            Value = $value
            Enabled = $enabled
            Offscreen = $offscreen
            Ordinal = $ordinal
        }
        $ordinal += 1
    }

    $visible = @($items | Where-Object { $_.Enabled -and -not $_.Offscreen })
    $datePattern = '(?i)\b20\d{2}\b|\bjan(?:uary)?\b|\bfeb(?:ruary)?\b|\bmar(?:ch)?\b|\bapr(?:il)?\b|\bmay\b|\bjun(?:e)?\b|\bjul(?:y)?\b|\baug(?:ust)?\b|\bsep(?:tember)?\b|\boct(?:ober)?\b|\bnov(?:ember)?\b|\bdec(?:ember)?\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b'
    $expiry = @($visible | Where-Object {
        $_.Name -match '(?i)\b(?:expires?|resets?)\b' -and $_.Name -match $datePattern
    } | Select-Object -ExpandProperty Name -Unique)
    $resetActions = @($visible | Where-Object {
        $_.Type -match 'ControlType\.(Button|MenuItem|Hyperlink|ListItem)' -and
        $_.Name -match '(?i)^\s*(?:use|redeem|apply)\s+(?:banked\s+)?reset\s*$' -and
        $_.Name -notmatch '(?i)billing|purchase|buy credits|add credits|auto.?top.?up'
    } | Select-Object -ExpandProperty Name -Unique)

    if ($ProcessName -eq 'msedge') {
        $addressEvidence = @($visible | Where-Object {
            (
                $_.Name -match '(?i)^\s*Address and search bar\s*$' -or
                $_.AutomationId -match '(?i)^(?:addressEditBox|omnibox)$'
            ) -and
            $_.Value -match '(?i)^https://chatgpt\.com/codex/cloud/settings/analytics/?(?:#usage)?$'
        })
        if ($addressEvidence.Count -ne 1) {
            return New-CodexUsageEvidenceResult $false 'EDGE_CODEX_ANALYTICS_ORIGIN_NOT_UNIQUE'
        }

        $headings = @($visible | Where-Object { $_.Name -match '(?i)^\s*Codex(?: and Work)? Analytics\s*$' })
        if ($headings.Count -ne 1) {
            return New-CodexUsageEvidenceResult $false 'EDGE_CODEX_ANALYTICS_HEADING_NOT_UNIQUE'
        }

        $weeklyLabels = @($visible | Where-Object { $_.Name -match '(?i)^\s*Weekly usage limit\s*$' })
        if ($weeklyLabels.Count -ne 1) {
            return New-CodexUsageEvidenceResult $false 'EDGE_WEEKLY_USAGE_LABEL_NOT_UNIQUE'
        }

        $weeklyOrdinal = [int]$weeklyLabels[0].Ordinal
        $nearWeekly = @($visible | Where-Object { [Math]::Abs([int]$_.Ordinal - $weeklyOrdinal) -le 10 })
        $percentageCandidates = @()
        foreach ($item in $nearWeekly) {
            if ($item.Name -match '(?i)^\s*(\d{1,3})\s*%\s*remaining\s*$') {
                $percentageCandidates += [pscustomobject]@{ Value = [int]$Matches[1]; Ordinal = [int]$item.Ordinal }
                continue
            }
            if ($item.Name -match '^\s*(\d{1,3})\s*%\s*$') {
                $percentageValue = [int]$Matches[1]
                $remainingNeighbor = @($nearWeekly | Where-Object {
                    $_.Name -match '(?i)^\s*remaining\s*$' -and
                    [Math]::Abs([int]$_.Ordinal - [int]$item.Ordinal) -le 3
                })
                if ($remainingNeighbor.Count -eq 1) {
                    $percentageCandidates += [pscustomobject]@{ Value = $percentageValue; Ordinal = [int]$item.Ordinal }
                }
            }
        }
        if ($percentageCandidates.Count -ne 1 -or $percentageCandidates[0].Value -lt 0 -or $percentageCandidates[0].Value -gt 100) {
            return New-CodexUsageEvidenceResult $false 'EDGE_WEEKLY_REMAINING_PERCENTAGE_NOT_UNIQUE'
        }
        if ($expiry.Count -eq 0) {
            return New-CodexUsageEvidenceResult $false 'EDGE_USAGE_RESET_TIME_NOT_FOUND'
        }
        if ($resetActions.Count -eq 0) {
            return New-CodexUsageEvidenceResult $false 'EDGE_BANKED_RESET_ACTION_NOT_FOUND'
        }

        return New-CodexUsageEvidenceResult `
            $true `
            '' `
            'authenticated-edge-codex-analytics' `
            ("Codex weekly usage limit {0}% remaining" -f $percentageCandidates[0].Value) `
            $expiry `
            $resetActions `
            @('authenticated-edge-codex-analytics', 'edge-chatgpt-analytics-origin-bound', 'weekly-remaining-meter-structurally-bound', 'banked-reset-status-read-only')
    }

    $meterTexts = @($visible | Where-Object {
        $_.Name -match '\b\d{1,3}\s*%' -and
        $_.Name -match '(?i)usage|remaining|meter|limit|codex|weekly|five.?day|5.?day'
    } | Select-Object -ExpandProperty Name -Unique)
    $preferredMeters = @($meterTexts | Where-Object { $_ -match '(?i)weekly|five.?day|5.?day' })
    $selectedMeter = if ($preferredMeters.Count -eq 1) { $preferredMeters[0] } elseif ($meterTexts.Count -eq 1) { $meterTexts[0] } else { '' }
    if (-not $selectedMeter) {
        return New-CodexUsageEvidenceResult $false 'DESKTOP_USAGE_METER_NOT_UNIQUE'
    }
    if ($expiry.Count -eq 0) {
        return New-CodexUsageEvidenceResult $false 'DESKTOP_USAGE_RESET_TIME_NOT_FOUND'
    }
    if ($resetActions.Count -eq 0) {
        return New-CodexUsageEvidenceResult $false 'DESKTOP_BANKED_RESET_ACTION_NOT_FOUND'
    }

    return New-CodexUsageEvidenceResult `
        $true `
        '' `
        'authenticated-desktop-codex-usage' `
        $selectedMeter `
        $expiry `
        $resetActions `
        @('authenticated-desktop-codex-usage', 'desktop-meter-structurally-bound')
}

Export-ModuleMember -Function Resolve-CodexUsageSurfaceEvidence, Select-CodexUniqueProcessCandidates
