Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'starfield-vr-performance-mode.ps1') -Raw
$start = $source.IndexOf('    $visualTelemetry = $null')
$end = $source.IndexOf('    if (-not (Test-Path -LiteralPath $audioEndpointScript', $start)
$block = [scriptblock]::Create($source.Substring($start, $end - $start))
$WorkspaceRoot = 'unused'; $LaunchSessionId = 'test'; $ProviderSensors = @('required'); $ProviderTelemetryPath = ''
$routeIdentity = @{provider='mutar-openxr'; sourceHead=''}
foreach ($state in @('absent','stale')) {
    Remove-Variable LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
    if ($state -eq 'stale') { $global:LASTEXITCODE = 42 }
    $vrTelemetrySessionScript = { '{"ok":true,"capabilities":{"modifiesFrameData":false}}' }
    . $block
    if ($null -eq $visualTelemetry -or $visualTelemetryError) { throw "Valid helper failed: $state" }
}
foreach ($mode in @('throw','empty','malformed','unsafe','notok')) {
    $vrTelemetrySessionScript = {
        switch ($mode) {
            'throw' { throw 'helper failed' }
            'empty' { return }
            'malformed' { 'invalid json' }
            'unsafe' { '{"ok":true,"capabilities":{"modifiesFrameData":true}}' }
            'notok' { '{"ok":false,"capabilities":{"modifiesFrameData":false}}' }
        }
    }
    $rejected = $false
    try { . $block } catch { $rejected = $_.Exception.Message -like 'Required provider diagnostic telemetry could not be armed:*' }
    if (-not $rejected) { throw "Required telemetry did not fail closed: $mode" }
}
'PASS: absent/stale native exit code and five required-telemetry failure cases'

