[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$WdkRoot,
    [Parameter(Mandatory=$true)][string]$WdkPackagePath
)
$ErrorActionPreference='Stop'
$r7RepoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$r7Source=Join-Path $r7RepoRoot 'src/windows/Stephanos.OriginalR7ScopedMutationGate'
$r7Output=Join-Path $r7Source 'build'
$r7Kit=[IO.Path]::GetFullPath($WdkRoot)
$r7Km=Join-Path $r7Kit 'c/Include/10.0.26100.0/km'
$r7KernelLib=Join-Path $r7Kit 'c/Lib/10.0.26100.0/km/x64'
# Bind every extracted kernel input to the exact Microsoft NuGet archive.
# Do not run installers, package build tasks or archive executables.
$r7Package=[IO.Path]::GetFullPath($WdkPackagePath)
$r7ExpectedDigest='jhddaBnhMDqt3GVr32RVTtaR0KHmZDjY0JCTMn10OQpk4+AShXCK9QA09vBazp8ni1Mju84qM5SGXfIfnyOJ+g=='
$r7PackageStream=[IO.File]::OpenRead($r7Package)
$r7Hasher=[Security.Cryptography.SHA512]::Create()
try { $r7Digest=[Convert]::ToBase64String($r7Hasher.ComputeHash($r7PackageStream)) }
finally { $r7PackageStream.Dispose(); $r7Hasher.Dispose() }
if ($r7Digest -cne $r7ExpectedDigest) { throw 'R7_WDK_ARCHIVE_DIGEST_MISMATCH' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$r7Archive=[IO.Compression.ZipFile]::OpenRead($r7Package)
$r7Compared=0
try {
    foreach ($r7Entry in $r7Archive.Entries) {
        if ($r7Entry.FullName.EndsWith('/')) { continue }
        if (-not ($r7Entry.FullName.StartsWith('c/Include/10.0.26100.0/km/',[StringComparison]::Ordinal) -or $r7Entry.FullName.StartsWith('c/Lib/10.0.26100.0/km/x64/',[StringComparison]::Ordinal))) { continue }
        $r7Extracted=[IO.Path]::GetFullPath((Join-Path $r7Kit $r7Entry.FullName))
        if (-not $r7Extracted.StartsWith($r7Kit.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'R7_WDK_INPUT_OUTSIDE_KIT' }
        $r7ZipInput=$r7Entry.Open()
        $r7DiskInput=[IO.File]::OpenRead($r7Extracted)
        $r7InputHasher=[Security.Cryptography.SHA256]::Create()
        try {
            $r7ZipDigest=[Convert]::ToBase64String($r7InputHasher.ComputeHash($r7ZipInput))
            $r7DiskDigest=[Convert]::ToBase64String($r7InputHasher.ComputeHash($r7DiskInput))
            if ($r7ZipDigest -cne $r7DiskDigest) { throw 'R7_WDK_EXTRACTED_INPUT_MISMATCH' }
        } finally { $r7ZipInput.Dispose(); $r7DiskInput.Dispose(); $r7InputHasher.Dispose() }
        $r7Compared++
    }
} finally { $r7Archive.Dispose() }
if ($r7Compared -ne 763) { throw 'R7_WDK_INPUT_COUNT_MISMATCH' }
$r7Vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$r7Installation=(& $r7Vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if ($LASTEXITCODE -ne 0 -or -not $r7Installation) { throw 'MSVC_BUILD_TOOLS_REQUIRED' }
$r7Tools=Get-ChildItem -LiteralPath (Join-Path $r7Installation 'VC/Tools/MSVC') -Directory | Sort-Object Name -Descending | Select-Object -First 1
$r7Compiler=Join-Path $r7Tools.FullName 'bin/Hostx64/x64/cl.exe'
$r7Linker=Join-Path $r7Tools.FullName 'bin/Hostx64/x64/link.exe'
$r7Librarian=Join-Path $r7Tools.FullName 'bin/Hostx64/x64/lib.exe'
$r7VcInclude=Join-Path $r7Tools.FullName 'include'
$r7VcLib=Join-Path $r7Tools.FullName 'lib/x64'
$r7Sdk=Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10'
$r7SdkInclude=Join-Path $r7Sdk 'Include/10.0.26100.0'
$r7SdkLib=Join-Path $r7Sdk 'Lib/10.0.26100.0'
foreach ($r7Required in @($r7Compiler,$r7Linker,$r7Librarian,(Join-Path $r7Km 'fltKernel.h'),(Join-Path $r7KernelLib 'fltMgr.lib'))) {
    if (-not (Test-Path -LiteralPath $r7Required -PathType Leaf)) { throw 'PINNED_NATIVE_BUILD_INPUT_MISSING' }
}
New-Item -ItemType Directory -Path $r7Output -Force | Out-Null
$r7Common=@('/nologo','/TC','/std:c17','/W4','/WX','/external:W0',"/external:I$r7VcInclude", "/external:I$r7SdkInclude/shared", "/external:I$r7SdkInclude/ucrt")
$r7Kernel=$r7Common+@('/c','/kernel','/GS','/Zl','/D_AMD64_','/DAMD64','/DNTDDI_VERSION=0x0A000008','/D_WIN32_WINNT=0x0A00','/DWINVER=0x0A00',"/external:I$r7Km", "/external:I$r7Km/crt")
& $r7Compiler @r7Kernel "/Fo$r7Output/ScopedMutationGate.obj" (Join-Path $r7Source 'ScopedMutationGate.c')
if ($LASTEXITCODE -ne 0) { throw 'R7_KERNEL_GATE_COMPILE_FAILED' }
& $r7Librarian /nologo "/OUT:$r7Output/ScopedMutationGate.lib" (Join-Path $r7Output 'ScopedMutationGate.obj')
if ($LASTEXITCODE -ne 0) { throw 'R7_KERNEL_GATE_LIBRARY_FAILED' }
& $r7Compiler @r7Kernel "/Fo$r7Output/KernelLinkProbe.obj" (Join-Path $r7Source 'KernelLinkProbe.c')
if ($LASTEXITCODE -ne 0) { throw 'R7_LINK_PROBE_COMPILE_FAILED' }
& $r7Linker /nologo /DRIVER /SUBSYSTEM:NATIVE /MACHINE:X64 /ENTRY:DriverEntry /NODEFAULTLIB /OPT:NOREF /INTEGRITYCHECK "/OUT:$r7Output/KernelLinkProbe.sys" (Join-Path $r7Output 'KernelLinkProbe.obj') (Join-Path $r7Output 'ScopedMutationGate.obj') "/LIBPATH:$r7KernelLib" fltMgr.lib ntoskrnl.lib cng.lib BufferOverflowFastFailK.lib
if ($LASTEXITCODE -ne 0) { throw 'R7_KERNEL_ABI_LINK_FAILED' }
& $r7Compiler @r7Common /O2 /MT "/Fo$r7Output/PolicyTests.obj" "/Fe$r7Output/PolicyTests.exe" (Join-Path $r7Source 'PolicyTests.c') /link "/LIBPATH:$r7VcLib" "/LIBPATH:$r7SdkLib/ucrt/x64" "/LIBPATH:$r7SdkLib/um/x64"
if ($LASTEXITCODE -ne 0) { throw 'R7_POLICY_TEST_COMPILE_FAILED' }
$r7PolicyResult=& (Join-Path $r7Output 'PolicyTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'R7_POLICY_TEST_FAILED' }
if ($r7PolicyResult -notmatch '^R7_GATE_POLICY_CHECKS_PASSED=([0-9]+)$') { throw 'R7_POLICY_RESULT_MISSING' }
$r7Checks=[long]$Matches[1]
Write-Output $r7PolicyResult
$r7Receipt=[pscustomobject]@{
    schemaVersion='stephanos.r7-scoped-mutation-gate-development-build.v1'
    observedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    target='Windows10-2004-or-later-x64'
    kernelCoreCompiled=$true
    kernelImportsLinked=$true
    policyPropertiesPassed=$true
    policyPropertyChecks=$r7Checks
    wdkPackageVersion='10.0.26100.6584'
    wdkPackageSha512Base64=$r7Digest
    wdkInputsCompared=$r7Compared
    sdkVersion='10.0.26100.0'
    msvcVersion=$r7Tools.Name
    sourceInputs=@(Get-ChildItem -LiteralPath $r7Source -File | Sort-Object Name | ForEach-Object { @{ name=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
    buildScriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
    artifacts=@('ScopedMutationGate.lib','KernelLinkProbe.sys','PolicyTests.exe' | ForEach-Object { @{ name=$_; sha256=(Get-FileHash -LiteralPath (Join-Path $r7Output $_) -Algorithm SHA256).Hash.ToLowerInvariant() } })
    nativeCallbacksExecuted=$false
    abiProbeRefusesDriverStartup=$true
    driverLoaded=$false
    productionCustodyProven=$false
    sourceEstateCompletenessProven=$false
    originalLeaseChanged=$false
}
$r7Receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $r7Output 'development-build.json') -Encoding utf8
$r7Receipt | ConvertTo-Json -Depth 8 -Compress
