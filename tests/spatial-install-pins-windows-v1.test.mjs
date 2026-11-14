import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Windows staging promotion retains fresh bytes and final pins exclude replacement until disposal',
  {skip:process.platform!=='win32' && 'Requires actual Windows file sharing; not native acceptance.',timeout:30000},()=>{
  const directory=mkdtempSync(join(tmpdir(),'spatial-install-pins-'));
  const native=Buffer.from('NONEXECUTABLE spatial native fixture\n');
  const receipt=Buffer.from('{"fixture":"fresh compiler receipt"}\n');
  const fixture={native:native.toString('base64'),receipt:receipt.toString('base64'),
    buildId:sha('fresh-build-fixture'),nativeSha256:sha(native),receiptSha256:sha(receipt)};
  const code=String.raw`$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
. __UTILITY__
$script:fixtureRoot=__DIRECTORY__
$fixture=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__FIXTURE__'))|ConvertFrom-Json)
$script:nativeBytes=[Convert]::FromBase64String($fixture.native)
$script:receiptBytes=[Convert]::FromBase64String($fixture.receipt)
$script:buildId=[string]$fixture.buildId
$script:nativeSha=[string]$fixture.nativeSha256
$script:receiptSha=[string]$fixture.receiptSha256
function New-FixtureBuild {
    [pscustomobject]@{BuildId=$script:buildId;NativeSha256=$script:nativeSha;ReceiptSha256=$script:receiptSha}
}
function New-FixturePair {
    param([string]$Path)
    [void][IO.Directory]::CreateDirectory($Path)
    [IO.File]::WriteAllBytes((Join-Path $Path 'SpatialWindow.exe'),$script:nativeBytes)
    [IO.File]::WriteAllBytes((Join-Path $Path 'build.json'),$script:receiptBytes)
}
function Assert-FixtureDenied {
    param([scriptblock]$Action,[string]$Name)
    $failure=$null
    try { & $Action } catch { $failure=$_.Exception }
    if ($null -eq $failure) { throw ('PIN_OPERATION_WAS_ALLOWED:'+ $Name) }
    $base=$failure.GetBaseException()
    if ($base -isnot [IO.IOException] -and $base -isnot [UnauthorizedAccessException]) {
        throw ('PIN_UNEXPECTED_DENIAL:'+ $Name+':'+$base.GetType().FullName)
    }
}
function Assert-FixtureFileFree {
    param([string]$Path)
    $handle=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $handle.Dispose()
}
function Assert-FixturePairFree {
    param([string]$Path)
    foreach ($name in @('SpatialWindow.exe','build.json')) {
        $file=Join-Path $Path $name
        if ([IO.File]::Exists($file)) { Assert-FixtureFileFree -Path $file }
    }
    $moved=$Path+'.released'
    [IO.Directory]::Move($Path,$moved)
    [IO.Directory]::Move($moved,$Path)
}
$promotionCases=0
foreach ($mode in @('move','replace')) {
    $scenario=Join-Path $script:fixtureRoot $mode
    $staging=Join-Path $scenario 'staging'
    $parent=Join-Path $scenario 'holder'
    $destination=Join-Path $parent 'installed'
    New-FixturePair -Path $staging
    [void][IO.Directory]::CreateDirectory($destination)
    if ($mode -eq 'replace') {
        [IO.File]::WriteAllText((Join-Path $destination 'SpatialWindow.exe'),'old-native')
        [IO.File]::WriteAllText((Join-Path $destination 'build.json'),'old-receipt')
    }
    $fresh=New-FixtureBuild
    $fresh|Add-Member -NotePropertyName NativeHandle -NotePropertyValue $null
    $fresh|Add-Member -NotePropertyName ReceiptHandle -NotePropertyValue $null
    $pins=$null
    try {
        $sharing=[IO.FileShare]::Read -bor [IO.FileShare]::Delete
        $fresh.NativeHandle=[IO.File]::Open((Join-Path $staging 'SpatialWindow.exe'),[IO.FileMode]::Open,[IO.FileAccess]::Read,$sharing)
        $fresh.ReceiptHandle=[IO.File]::Open((Join-Path $staging 'build.json'),[IO.FileMode]::Open,[IO.FileAccess]::Read,$sharing)
        $fresh.NativeHandle.Position=4;$fresh.ReceiptHandle.Position=3
        if ((Get-SpatialWindowStreamSha256 -Stream $fresh.NativeHandle) -cne $script:nativeSha -or
            (Get-SpatialWindowStreamSha256 -Stream $fresh.ReceiptHandle) -cne $script:receiptSha -or
            $fresh.NativeHandle.Position -ne 0 -or $fresh.ReceiptHandle.Position -ne 0) { throw 'STAGING_STREAM_HASH_CHANGED' }
        foreach ($name in @('SpatialWindow.exe','build.json')) {
            $source=Join-Path $staging $name
            Assert-FixtureDenied -Name ($mode+' staging write '+$name) -Action {
                [IO.File]::WriteAllText($source,'unexpected-write')
            }
            $target=Join-Path $destination $name
            if ($mode -eq 'move') { [IO.File]::Move($source,$target) }
            else { [IO.File]::Replace($source,$target,(Join-Path $staging ($name+'.previous')),$true) }
        }
        # The original held streams still name the newly promoted bytes.
        if ((Get-SpatialWindowStreamSha256 -Stream $fresh.NativeHandle) -cne $script:nativeSha -or
            (Get-SpatialWindowStreamSha256 -Stream $fresh.ReceiptHandle) -cne $script:receiptSha) { throw 'PROMOTION_LOST_FRESH_IDENTITY' }
        $pins=Open-SpatialWindowPinnedInstallation -Directory $destination -FreshBuild $fresh
        if ($pins.Binary -cne (Join-Path $destination 'SpatialWindow.exe') -or $pins.BuildId -cne $script:buildId) {
            throw 'FINAL_PIN_IDENTITY_CHANGED'
        }
        # Prove final handles alone, after the staging handles are disposed.
        Close-SpatialWindowBuildHandles -Value $fresh
        Assert-SpatialWindowPinnedInstallation -Value $pins
        foreach ($name in @('SpatialWindow.exe','build.json')) {
            $target=Join-Path $destination $name
            $replacement=Join-Path $scenario ($name+'.replacement')
            [IO.File]::WriteAllText($replacement,'replacement-bytes')
            Assert-FixtureDenied -Name ($mode+' overwrite '+$name) -Action { [IO.File]::WriteAllText($target,'overwrite') }
            Assert-FixtureDenied -Name ($mode+' delete '+$name) -Action { [IO.File]::Delete($target) }
            Assert-FixtureDenied -Name ($mode+' rename '+$name) -Action { [IO.File]::Move($target,$target+'.moved') }
            Assert-FixtureDenied -Name ($mode+' replace '+$name) -Action { [IO.File]::Replace($replacement,$target,$null,$true) }
        }
        Assert-FixtureDenied -Name ($mode+' installation directory rename') -Action {
            [IO.Directory]::Move($destination,$destination+'.moved')
        }
        Assert-FixtureDenied -Name ($mode+' parent directory rename') -Action {
            [IO.Directory]::Move($parent,$parent+'.moved')
        }
        Assert-SpatialWindowPinnedInstallation -Value $pins
        Close-SpatialWindowBuildHandles -Value $pins
        Close-SpatialWindowBuildHandles -Value $pins
        if ($pins.NativeHandle.CanRead -or $pins.ReceiptHandle.CanRead) { throw 'FINAL_HANDLES_NOT_CLOSED' }
        Assert-FixturePairFree -Path $destination
        [IO.Directory]::Move($parent,$parent+'.released')
        [IO.Directory]::Move($parent+'.released',$parent)
        foreach ($name in @('SpatialWindow.exe','build.json')) {
            $target=Join-Path $destination $name
            [IO.File]::Replace((Join-Path $scenario ($name+'.replacement')),$target,$null,$true)
            [IO.File]::Delete($target)
        }
        $promotionCases++
    } finally {
        Close-SpatialWindowBuildHandles -Value $pins
        Close-SpatialWindowBuildHandles -Value $fresh
    }
}
$failureCases=0
foreach ($mode in @('native-digest','receipt-digest','build-id','missing-receipt','sidecar-file','sidecar-directory')) {
    $path=Join-Path $script:fixtureRoot $mode
    New-FixturePair -Path $path
    $fresh=New-FixtureBuild
    if ($mode -eq 'native-digest') { $fresh.NativeSha256='0'*64 }
    if ($mode -eq 'receipt-digest') { $fresh.ReceiptSha256='0'*64 }
    if ($mode -eq 'build-id') { $fresh.BuildId='invalid' }
    if ($mode -eq 'missing-receipt') { [IO.File]::Delete((Join-Path $path 'build.json')) }
    if ($mode -eq 'sidecar-file') { [IO.File]::WriteAllText((Join-Path $path 'winhttp.dll'),'untrusted-sidecar') }
    if ($mode -eq 'sidecar-directory') { [void][IO.Directory]::CreateDirectory((Join-Path $path 'sidecar')) }
    $pins=$null;$refused=$false
    try { $pins=Open-SpatialWindowPinnedInstallation -Directory $path -FreshBuild $fresh }
    catch {
        if ($_.Exception.Message -cne 'SPATIAL_PREPARE_INSTALLATION_INVALID') { throw }
        $refused=$true
    } finally { Close-SpatialWindowBuildHandles -Value $pins }
    if (-not $refused) { throw ('MISMATCHED_FRESH_IDENTITY_ACCEPTED:'+ $mode) }
    Assert-FixturePairFree -Path $path
    if ($mode -eq 'sidecar-file' -and [IO.File]::ReadAllText((Join-Path $path 'winhttp.dll')) -cne 'untrusted-sidecar') {
        throw 'UNTRUSTED_SIDECAR_WAS_CHANGED'
    }
    if ($mode -eq 'sidecar-directory' -and -not [IO.Directory]::Exists((Join-Path $path 'sidecar'))) {
        throw 'UNTRUSTED_SIDECAR_DIRECTORY_WAS_CHANGED'
    }
    foreach ($name in @('SpatialWindow.exe','build.json')) {
        $file=Join-Path $path $name
        if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
    }
    $failureCases++
}
# Exercise a post-open path rejection through the actual helper: by the third
# plain-path check both real final handles must already exclude a writer.
$path=Join-Path $script:fixtureRoot 'post-open-recheck'
New-FixturePair -Path $path
$script:originalPlainPath=(Get-Command Assert-SpatialWindowPlainPath).ScriptBlock
$script:plainPathCalls=0;$script:postOpenPinned=$false
function Assert-SpatialWindowPlainPath {
    param([Parameter(Mandatory=$true)][string]$Path)
    & $script:originalPlainPath -Path $Path
    $script:plainPathCalls++
    if ($script:plainPathCalls -ge 3) {
        Assert-FixtureDenied -Name 'post-open plain-path check retains real handle' -Action {
            $writer=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
            $writer.Dispose()
        }
        $script:postOpenPinned=$true
        throw 'SPATIAL_PREPARE_INSTALLATION_INVALID'
    }
}
$pins=$null;$refused=$false
try {
    try { $pins=Open-SpatialWindowPinnedInstallation -Directory $path -FreshBuild (New-FixtureBuild) }
    catch {
        if ($_.Exception.Message -cne 'SPATIAL_PREPARE_INSTALLATION_INVALID') { throw }
        $refused=$true
    }
} finally {
    Close-SpatialWindowBuildHandles -Value $pins
    Set-Item -Path Function:\Assert-SpatialWindowPlainPath -Value $script:originalPlainPath
}
if (-not $refused -or -not $script:postOpenPinned) { throw 'POST_OPEN_PLAIN_PATH_RECHECK_MISSING' }
Assert-FixturePairFree -Path $path
Close-SpatialWindowBuildHandles -Value $null
[pscustomobject]@{promotionCases=$promotionCases;failureCases=$failureCases;postOpenRecheck=$true;
    nativeExecuted=$false;productionInstallationChanged=$false} | ConvertTo-Json -Compress
`.replace('__UTILITY__',quote(join(root,'scripts/windows/spatial-window-install-lock.ps1')))
    .replace('__DIRECTORY__',quote(directory)).replace('__FIXTURE__',Buffer.from(JSON.stringify(fixture)).toString('base64'));
  try {
    const driver=join(directory,'fixture.ps1');writeFileSync(driver,code,{encoding:'utf8',flag:'wx'});
    const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',driver],
      {cwd:root,encoding:'utf8',windowsHide:true,timeout:25000,maxBuffer:65536});
    assert.equal(result.error,undefined,'Windows filesystem fixture must finish within its bound');
    assert.equal(result.status,0,result.stderr||result.stdout);
    assert.deepEqual(JSON.parse(result.stdout.trim()),{promotionCases:2,failureCases:6,
      postOpenRecheck:true,nativeExecuted:false,productionInstallationChanged:false});
  } finally {rmSync(directory,{recursive:true,force:true});}
});
