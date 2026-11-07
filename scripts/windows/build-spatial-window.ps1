[CmdletBinding()]
param([string]$OutputDirectory = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repositoryRoot '.stephanos\local-state-checkpoints\spatial-window' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Install Visual Studio Build Tools with Desktop development with C++ first.' }
$vs = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
if (-not $vs) { throw 'The Windows C++ build tools are unavailable.' }
$compilerRoot = Get-ChildItem -LiteralPath (Join-Path $vs 'VC\Tools\MSVC') -Directory | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty FullName
$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$sdkVersion = Get-ChildItem -LiteralPath (Join-Path $sdkRoot 'Include') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'cppwinrt\winrt\Windows.Graphics.Capture.h') } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $sdkVersion) { throw 'The Windows SDK with C++/WinRT is unavailable.' }
$sourcePaths = @('src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp','scripts/spatial-window-host.mjs','shared/vr/spatialDesktopSurfaceContractV1.mjs')
$sourceRecords = @($sourcePaths | ForEach-Object { [ordered]@{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $repositoryRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant()} })
$source = Join-Path $repositoryRoot $sourcePaths[0]
$binary = Join-Path $OutputDirectory 'SpatialWindow.exe'
$compiler = Join-Path $compilerRoot 'bin\Hostx64\x64\cl.exe'
$compileArgs = @('/nologo','/std:c++17','/EHsc','/W4','/O2','/DUNICODE','/D_UNICODE',"/I$compilerRoot\include")
foreach ($include in @('ucrt','shared','um','winrt','cppwinrt')) { $compileArgs += "/I$sdkRoot\Include\$sdkVersion\$include" }
$compileArgs += @($source,"/Fo$OutputDirectory\SpatialWindow.obj","/Fe$binary",'/link','/SUBSYSTEM:WINDOWS','/ENTRY:mainCRTStartup',"/LIBPATH:$compilerRoot\lib\x64","/LIBPATH:$sdkRoot\Lib\$sdkVersion\um\x64","/LIBPATH:$sdkRoot\Lib\$sdkVersion\ucrt\x64",'windowsapp.lib','d3d11.lib','dxgi.lib','dwmapi.lib','windowscodecs.lib','crypt32.lib','ole32.lib','user32.lib','runtimeobject.lib')
& $compiler @compileArgs
if ($LASTEXITCODE -ne 0) { throw "Native console build failed ($LASTEXITCODE)." }
foreach ($record in $sourceRecords) { if ((Get-FileHash -LiteralPath (Join-Path $repositoryRoot $record.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw 'Console source changed during compilation.' } }
$nativeSha = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
$material = (@($sourceRecords | ForEach-Object { $_.sha256 }) + @($nativeSha)) -join ':'
$hasher = [Security.Cryptography.SHA256]::Create()
try { $buildId = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($material)))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
$receipt = [ordered]@{schema='stephanos.spatial-window-build.v1';builtAt=(Get-Date).ToUniversalTime().ToString('o');sources=$sourceRecords;nativeSha256=$nativeSha;buildId=$buildId;compiler=$compiler;sdk=$sdkVersion}
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'build.json'),($receipt | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
[pscustomobject]@{status='built';buildId=$buildId;binary=$binary} | ConvertTo-Json -Compress
