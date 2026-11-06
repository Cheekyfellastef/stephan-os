[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$WorkspaceRoot = '',
    [string]$OpenXrSourceRoot = '',
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $WorkspaceRoot) {
    $WorkspaceRoot = Join-Path $env:USERPROFILE 'Documents\Stephanos-openclaw-workspace'
}
if (-not $OpenXrSourceRoot) {
    $OpenXrSourceRoot = Join-Path $WorkspaceRoot 'vr\source\starfield-aer-stabilizer\starfield2vr\build\build-release-msvc\_deps\openxr-src'
}

$sourceRoot = Join-Path $repoRoot 'src\vr\Stephanos.OpenXrTelemetryLayer'
$sourcePath = Join-Path $sourceRoot 'stephanos-openxr-telemetry-layer.cpp'
$testPath = Join-Path $sourceRoot 'stephanos-openxr-telemetry-layer.test.cpp'
$manifestSource = Join-Path $sourceRoot 'layer.json'
$openXrInclude = Join-Path $OpenXrSourceRoot 'include'
$openXrCommon = Join-Path $OpenXrSourceRoot 'src\common'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'

foreach ($required in @($sourcePath, $testPath, $manifestSource, $vcvars, (Join-Path $openXrInclude 'openxr\openxr.h'), (Join-Path $openXrCommon 'loader_interfaces.h'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "VR OpenXR telemetry build dependency missing: $required"
    }
}

$sourceHead = (& git -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
if ($sourceHead -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to prove repository HEAD for VR OpenXR telemetry layer.'
}
$trackedPaths = @(
    'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.cpp',
    'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.test.cpp',
    'src/vr/Stephanos.OpenXrTelemetryLayer/layer.json',
    'scripts/windows/install-vr-openxr-telemetry-layer.ps1'
)
$dirty = (& git -C $repoRoot status --porcelain --untracked-files=all -- $trackedPaths 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify telemetry layer source status.' }

if ($ValidateOnly) {
    [ordered]@{
        schemaVersion = 'stephanos.vr-openxr-telemetry-layer-install.v1'
        ok = $true
        sourceHead = $sourceHead
        sourceDirty = [bool]$dirty
        compilerAvailable = $true
        openXrHeadersAvailable = $true
        writesWorkspaceOnly = $true
        launchesGame = $false
        finalVerdict = 'VR_OPENXR_TELEMETRY_LAYER_BUILD_READY'
    } | ConvertTo-Json -Compress
    exit 0
}

$deployRoot = Join-Path $WorkspaceRoot 'vr\telemetry\openxr-layer'
$binRoot = Join-Path $deployRoot 'bin'
$layerRoot = Join-Path $deployRoot 'layer'
$buildRoot = Join-Path $deployRoot 'build'
foreach ($dir in @($deployRoot, $binRoot, $layerRoot, $buildRoot)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

$comspec = Join-Path $env:SystemRoot 'System32\cmd.exe'
$environmentLines = & $comspec /d /c ('call "' + $vcvars + '" >nul && set')
if ($LASTEXITCODE -ne 0) { throw 'MSVC environment setup failed.' }
foreach ($line in $environmentLines) {
    if ($line -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

$dllPath = Join-Path $binRoot 'stephanos-openxr-telemetry-layer.dll'
$objPath = Join-Path $buildRoot 'stephanos-openxr-telemetry-layer.obj'
$testExe = Join-Path $buildRoot 'stephanos-openxr-telemetry-layer.test.exe'
$testObj = Join-Path $buildRoot 'stephanos-openxr-telemetry-layer.test.obj'
$commonArgs = @(
    '/nologo', '/std:c++17', '/EHsc', '/O2', '/MT',
    '/I', $openXrInclude,
    '/I', $openXrCommon
)

if ($PSCmdlet.ShouldProcess($dllPath, 'Build and deploy pass-through OpenXR telemetry layer')) {
    & cl.exe @commonArgs /LD $sourcePath "/Fo$objPath" "/Fe$dllPath"
    if ($LASTEXITCODE -ne 0) { throw 'VR OpenXR telemetry DLL build failed.' }

    & cl.exe @commonArgs $testPath "/Fo$testObj" "/Fe$testExe"
    if ($LASTEXITCODE -ne 0) { throw 'VR OpenXR telemetry test build failed.' }

    $testText = & $testExe 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or -not $testText.Trim()) {
        throw "VR OpenXR telemetry native test failed: $($testText.Trim())"
    }
    try { $test = $testText.Trim() | ConvertFrom-Json } catch { throw 'VR OpenXR telemetry native test output was invalid JSON.' }
    if ($test.passed -ne $true -or $test.gameLaunched -ne $false -or $test.frameMutation -ne $false) {
        throw 'VR OpenXR telemetry native test did not prove pass-through safety.'
    }

    $manifestPath = Join-Path $layerRoot 'stephanos-openxr-telemetry-layer.json'
    Copy-Item -LiteralPath $manifestSource -Destination $manifestPath -Force

    $proof = [ordered]@{
        schemaVersion = 'stephanos.vr-openxr-telemetry-layer-install.v1'
        installedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        sourceHead = $sourceHead
        sourceDirtyAtBuild = [bool]$dirty
        layerName = 'XR_APILAYER_STEPHANOS_telemetry_v1'
        manifestPath = $manifestPath
        layerDirectory = $layerRoot
        dllPath = $dllPath
        dllSha256 = (Get-FileHash -LiteralPath $dllPath -Algorithm SHA256).Hash.ToLowerInvariant()
        sourceSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
        nativeTest = $test
        pixelContentSampling = $false
        modifiesFrameData = $false
        launchesGame = $false
        finalVerdict = 'VR_OPENXR_TELEMETRY_LAYER_INSTALLED'
    }
    $proofPath = Join-Path $deployRoot 'install-current.json'
    [IO.File]::WriteAllText(
        $proofPath,
        ($proof | ConvertTo-Json -Depth 8) + [Environment]::NewLine,
        (New-Object Text.UTF8Encoding($false))
    )
    $proof | ConvertTo-Json -Depth 8
}
