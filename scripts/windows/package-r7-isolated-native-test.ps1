# Package only fixed unsigned native build outputs. Never signs or executes them.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:RUNNER_OS -cne 'Windows' -or $env:R7_LAB_SOURCE_HEAD -cnotmatch '^[a-f0-9]{40}$') {throw 'R7_EXACT_HOSTED_BUILD_REQUIRED'}
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$head=(& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -cne $env:R7_LAB_SOURCE_HEAD) {throw 'R7_PACKAGE_SOURCE_HEAD_MISMATCH'}
$tree=(& git -C $repo rev-parse 'HEAD^{tree}').Trim()
if ($LASTEXITCODE -ne 0 -or $tree -cnotmatch '^[a-f0-9]{40}$') {throw 'R7_PACKAGE_SOURCE_TREE_UNPROVEN'}
$build=Join-Path $repo 'src/windows/Stephanos.OriginalR7NativeQualification/build'
$proof=Get-Content -LiteralPath (Join-Path $build 'development-build.json') -Raw | ConvertFrom-Json
if ($proof.schemaVersion -cne 'stephanos.r7-native-qualification-development-build.v1' -or $proof.harnessCompiled -ne $true -or $proof.harnessImportsLinked -ne $true -or $proof.clientCompiled -ne $true -or $proof.imageSigned -ne $false -or $proof.driverLoaded -ne $false -or $proof.nativeCallbacksExecuted -ne $false -or $proof.productionCustodyProven -ne $false -or $proof.originalLeaseChanged -ne $false) {throw 'R7_PACKAGE_DEVELOPMENT_PROOF_REQUIRED'}
$files=@('R7NativeQualification.sys','R7NativeQualificationClient.exe')
$components=@()
foreach($name in $files) {
    $path=Join-Path $build $name
    $info=Get-Item -LiteralPath $path
    $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $record=@($proof.artifacts | Where-Object {$_.name -ceq $name})
    if ($info.Length -lt 1 -or $info.Length -gt 1MB -or $info.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or $record.Count -ne 1 -or $record[0].sha256 -cne $hash) {throw 'R7_PACKAGE_BUILD_ARTIFACT_CHANGED'}
    $components+=@{name=$name;bytes=$info.Length;sha256=$hash}
}
if ((Get-AuthenticodeSignature -LiteralPath (Join-Path $build $files[0])).Status -ne 'NotSigned') {throw 'R7_PACKAGE_UNSIGNED_DRIVER_REQUIRED'}
$manifest=[ordered]@{schemaVersion='stephanos.r7-native-test-package.v1';sourceHead=$head;sourceTree=$tree;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;components=$components;productionAuthority=$false;nativeCallbacksExecuted=$false;driverLoaded=$false;leaseChanged=$false}
$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 8))
$zipPath=Join-Path $env:RUNNER_TEMP 'r7-native-test-package.zip'
$output=[IO.File]::Open($zipPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$zip=[IO.Compression.ZipArchive]::new($output,[IO.Compression.ZipArchiveMode]::Create,$true)
try {
    foreach($name in $files) {
        $entry=$zip.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal)
        $writer=$entry.Open();$reader=[IO.File]::OpenRead((Join-Path $build $name))
        try {$reader.CopyTo($writer)} finally {$writer.Dispose();$reader.Dispose()}
    }
    $entry=$zip.CreateEntry('manifest.json');$writer=$entry.Open()
    try {$writer.Write($bytes,0,$bytes.Length)} finally {$writer.Dispose()}
    $bytes=[Text.UTF8Encoding]::new($false).GetBytes('Unsigned test minifilter and fixed no-argument client. Disposable isolated guest only. No Battle Bridge installation, production custody or lease-release authority.')
    $entry=$zip.CreateEntry('README.txt');$writer=$entry.Open()
    try {$writer.Write($bytes,0,$bytes.Length)} finally {$writer.Dispose()}
} finally {$zip.Dispose();$output.Dispose()}
$pins=[ordered]@{schemaVersion='stephanos.r7-native-test-package-pins.v1';sourceHead=$head;sourceTree=$tree;runId=$env:GITHUB_RUN_ID;runAttempt=$env:GITHUB_RUN_ATTEMPT;archiveBytes=(Get-Item -LiteralPath $zipPath).Length;archiveSha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant();components=$components;driverLoaded=$false;nativeCallbacksExecuted=$false;productionAuthority=$false;leaseChanged=$false}
$pins | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $env:RUNNER_TEMP 'r7-native-test-package-pins.json') -Encoding utf8
$pins | ConvertTo-Json -Depth 8 -Compress
