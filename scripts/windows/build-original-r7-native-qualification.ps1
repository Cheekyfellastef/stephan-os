[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$WdkRoot,
    [Parameter(Mandatory=$true)][string]$WdkPackagePath
)
$ErrorActionPreference='Stop'
$r7qRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$r7qSource=Join-Path $r7qRepo 'src/windows/Stephanos.OriginalR7NativeQualification'
$r7qCore=Join-Path $r7qRepo 'src/windows/Stephanos.OriginalR7ScopedMutationGate'
$r7qOutput=Join-Path $r7qSource 'build'
# Reuse the existing pinned-archive/all-763-input validation and core build.
# This script never installs, signs or loads an image, nor invokes the client.
& (Join-Path $PSScriptRoot 'build-original-r7-scoped-mutation-gate.ps1') -WdkRoot $WdkRoot -WdkPackagePath $WdkPackagePath
$r7qCoreReceipt=Get-Content -LiteralPath (Join-Path $r7qCore 'build/development-build.json') -Raw | ConvertFrom-Json
if (-not $r7qCoreReceipt.kernelCoreCompiled -or -not $r7qCoreReceipt.kernelImportsLinked -or $r7qCoreReceipt.wdkInputsCompared -ne 763) { throw 'R7Q_PINNED_CORE_BUILD_REQUIRED' }
$r7qVswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$r7qInstall=& $r7qVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $r7qInstall) { throw 'R7Q_MSVC_REQUIRED' }
$r7qTools=Get-ChildItem -LiteralPath (Join-Path $r7qInstall 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
if ($r7qTools.Name -cne $r7qCoreReceipt.msvcVersion) { throw 'R7Q_COMPILER_MOVED' }
$r7qBin=Join-Path $r7qTools.FullName 'bin/Hostx64/x64'
$r7qVcInclude=Join-Path $r7qTools.FullName 'include'
$r7qSdk=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$r7qSdkInclude=Join-Path $r7qSdk 'Include/10.0.26100.0'
$r7qSdkLib=Join-Path $r7qSdk 'Lib/10.0.26100.0'
$r7qKm=Join-Path ([IO.Path]::GetFullPath($WdkRoot)) 'c/Include/10.0.26100.0/km'
$r7qKernelLib=Join-Path ([IO.Path]::GetFullPath($WdkRoot)) 'c/Lib/10.0.26100.0/km/x64'
New-Item -ItemType Directory -Path $r7qOutput -Force | Out-Null
$r7qCommon=@('/nologo','/TC','/std:c17','/W4','/WX','/external:W0',"/external:I$r7qVcInclude","/external:I$r7qSdkInclude/shared","/external:I$r7qSdkInclude/ucrt")
$r7qKernel=$r7qCommon+@('/c','/kernel','/GS','/Zl','/D_AMD64_','/DAMD64','/DNTDDI_VERSION=0x0A000008','/D_WIN32_WINNT=0x0A00','/DWINVER=0x0A00',"/external:I$r7qKm","/external:I$r7qKm/crt")
& (Join-Path $r7qBin 'cl.exe') @r7qKernel "/Fo$r7qOutput/NativeQualification.obj" (Join-Path $r7qSource 'NativeQualification.c')
if ($LASTEXITCODE -ne 0) { throw 'R7Q_NATIVE_COMPILE_FAILED' }
# Use the WDK GS startup, not the permanently refusing ABI probe's entry point.
& (Join-Path $r7qBin 'link.exe') /nologo /DRIVER /SUBSYSTEM:NATIVE /MACHINE:X64 /ENTRY:GsDriverEntry /NODEFAULTLIB /INTEGRITYCHECK /NXCOMPAT /DYNAMICBASE /OPT:REF "/OUT:$r7qOutput/R7NativeQualification.sys" (Join-Path $r7qOutput 'NativeQualification.obj') (Join-Path $r7qCore 'build/ScopedMutationGate.obj') "/LIBPATH:$r7qKernelLib" fltMgr.lib ntoskrnl.lib cng.lib BufferOverflowFastFailK.lib
if ($LASTEXITCODE -ne 0) { throw 'R7Q_NATIVE_LINK_FAILED' }
& (Join-Path $r7qBin 'cl.exe') @r7qCommon /O2 /MT "/external:I$r7qSdkInclude/um" "/Fo$r7qOutput/Client.obj" "/Fe$r7qOutput/R7NativeQualificationClient.exe" (Join-Path $r7qSource 'Client.c') /link "/LIBPATH:$($r7qTools.FullName)/lib/x64" "/LIBPATH:$r7qSdkLib/ucrt/x64" "/LIBPATH:$r7qSdkLib/um/x64" fltLib.lib
if ($LASTEXITCODE -ne 0) { throw 'R7Q_CLIENT_COMPILE_FAILED' }
$r7qReceipt=[pscustomobject]@{
    schemaVersion='stephanos.r7-native-qualification-development-build.v1'
    observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    target='disposable-Windows-NTFS-test-VHD-only'
    coreBuild=$r7qCoreReceipt
    harnessCompiled=$true
    harnessImportsLinked=$true
    clientCompiled=$true
    gsStartup='GsDriverEntry'
    artifacts=@('R7NativeQualification.sys','R7NativeQualificationClient.exe' | ForEach-Object { @{name=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $r7qOutput $_) -Algorithm SHA256).Hash.ToLowerInvariant()} })
    sourceInputs=@(Get-ChildItem -LiteralPath $r7qSource -File | Sort-Object Name | ForEach-Object { @{name=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
    buildScriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    imageSigned=$false
    driverLoaded=$false
    nativeCallbacksExecuted=$false
    productionCustodyProven=$false
    originalLeaseChanged=$false
}
$r7qReceipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $r7qOutput 'development-build.json') -Encoding utf8
$r7qReceipt | ConvertTo-Json -Depth 12 -Compress
