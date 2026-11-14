[CmdletBinding()]
param([string]$OutputDirectory = '', [switch]$PassThru)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'spatial-window-install-lock.ps1')
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints\spatial-window' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$programFilesX86 = [Environment]::GetFolderPath('ProgramFilesX86')
if ([string]::IsNullOrWhiteSpace($programFilesX86)) { throw 'The Windows C++ build tools are unavailable.' }
$vswhere = Join-Path $programFilesX86 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++ first.' }
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $vs) { throw 'The Windows C++ build tools are unavailable.' }
$compilerRoot = Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
$sdkRoot = Join-Path $programFilesX86 'Windows Kits\10'
$sdkVersion = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cppwinrt\winrt\Windows.Graphics.Capture.h') } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $sdkVersion) { throw 'The Windows SDK with C++/WinRT is unavailable.' }
$sourcePaths = @('src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp','scripts/spatial-window-host.mjs','shared/vr/spatialDesktopSurfaceContractV1.mjs')
$sourceRecords = @($sourcePaths | ForEach-Object { [ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $repositoryRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant()} })
$source = Join-Path $repositoryRoot $sourcePaths[0]
$binary = Join-Path $OutputDirectory 'SpatialWindow.exe'
$compiler = Join-Path $compilerRoot 'bin\Hostx64\x64\cl.exe'
# C++20 selects standard coroutine headers in C++/WinRT; current MSVC rejects
# the legacy experimental headers selected by plain C++17.
$compileArgs = @('/nologo','/std:c++20','/EHsc','/W4','/O2','/DUNICODE','/D_UNICODE',"/I$compilerRoot\include")
foreach ($include in @('ucrt','shared','um','winrt','cppwinrt')) { $compileArgs += "/I$sdkRoot\Include\$sdkVersion\$include" }
# Restrict static DLL imports to System32, including before main executes.
$compileArgs += @($source,"/Fo$OutputDirectory\SpatialWindow.obj","/Fe$binary",'/link','/DEPENDENTLOADFLAG:0x800','/SUBSYSTEM:WINDOWS','/ENTRY:mainCRTStartup',"/LIBPATH:$compilerRoot\lib\x64","/LIBPATH:$sdkRoot\Lib\$sdkVersion\um\x64","/LIBPATH:$sdkRoot\Lib\$sdkVersion\ucrt\x64",'windowsapp.lib','d3d11.lib','dxgi.lib','dwmapi.lib','windowscodecs.lib','crypt32.lib','ole32.lib','user32.lib','runtimeobject.lib')
$compilerHandle = [IO.File]::Open($compiler,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try {
    $compilerOutput = @(& $compiler @compileArgs 2>&1)
    $compilerExitCode = $LASTEXITCODE
    if (-not $PassThru) { $compilerOutput | Write-Output }
    if ($compilerExitCode -ne 0) { throw "Native console build failed ($compilerExitCode)." }
} finally { $compilerHandle.Dispose() }
foreach ($record in $sourceRecords) { if ((Get-FileHash -LiteralPath (Join-Path $repositoryRoot $record.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'Console source changed during compilation.' } }
$nativeHandle = $null; $receiptHandle = $null; $handedOff = $false
try {
Assert-SpatialWindowPlainPath -Path $binary
# Staging handles deny modification while this invocation records its identity.
# The installer releases them for ReplaceFile, then pins and rehashes the final
# files against these in-memory digests before any executable use.
$stagingShare = [IO.FileShare]::Read -bor [IO.FileShare]::Delete
$nativeHandle = [IO.File]::Open($binary,[IO.FileMode]::Open,[IO.FileAccess]::Read,$stagingShare)
$nativeSha = Get-SpatialWindowStreamSha256 -Stream $nativeHandle
$material = (@($sourceRecords | ForEach-Object { $_.sha256 }) + @($nativeSha)) -join ':'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $buildId = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
$receipt = [ordered]@{schema='stephanos.spatial-window-build.v1';builtAt=(Get-Date).ToUniversalTime().ToString('o');sources=$sourceRecords;nativeSha256=$nativeSha;buildId=$buildId;compiler=$compiler;sdk=$sdkVersion}
$receiptPath = Join-Path $OutputDirectory 'build.json'
$receiptText = $receipt | ConvertTo-Json -Depth 5
$encoding = New-Object Text.UTF8Encoding($false)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $receiptSha = ([BitConverter]::ToString($hasher.ComputeHash($encoding.GetBytes($receiptText)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
[IO.File]::WriteAllText($receiptPath,$receiptText,$encoding)
$receiptHandle = [IO.File]::Open($receiptPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,$stagingShare)
if ((Get-SpatialWindowStreamSha256 -Stream $receiptHandle) -cne $receiptSha) { throw 'The fresh build receipt changed.' }
if ($PassThru) {
    $handedOff = $true
    [pscustomobject]@{BuildId=$buildId;NativeSha256=$nativeSha;ReceiptSha256=$receiptSha;NativeHandle=$nativeHandle;ReceiptHandle=$receiptHandle}
} else {
    [pscustomobject]@{status='built';buildId=$buildId;binary=$binary} | ConvertTo-Json -Compress
}
} finally {
    if (-not $handedOff) {
        if ($nativeHandle) { $nativeHandle.Dispose() }
        if ($receiptHandle) { $receiptHandle.Dispose() }
    }
}
