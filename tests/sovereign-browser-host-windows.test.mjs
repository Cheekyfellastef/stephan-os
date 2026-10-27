import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNativeBrowserObservation } from '../scripts/sovereign-commander-browser-observe.mjs';

const exe = process.env.STEPHANOS_BROWSER_WITNESS_HOST_EXE;
const schema='stephanos.browser-native-message.v1';
async function exchange(messages) {
  const child=spawn(exe,[],{stdio:['pipe','pipe','pipe']});
  let data=Buffer.alloc(0), errors='';
  child.stdout.on('data',chunk=>{data=Buffer.concat([data,chunk]);});
  child.stderr.on('data',chunk=>{errors+=chunk.toString();});
  for(const message of messages) {
    const bytes=Buffer.from(JSON.stringify(message),'utf8');
    const prefix=Buffer.alloc(4);prefix.writeUInt32LE(bytes.length,0);
    child.stdin.write(Buffer.concat([prefix,bytes]));
  }
  child.stdin.end();
  const exit=await new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  });
  assert.equal(exit,0,errors.slice(0,500));
  const replies=[];let off=0;
  while(off+4<=data.length) {
    const len=data.readUInt32LE(off);off+=4;
    assert.ok(len>0 && len<1000000);
    assert.ok(off+len<=data.length);
    replies.push(JSON.parse(data.subarray(off,off+len).toString('utf8'))); off+=len;
  }
  assert.equal(off,data.length);
  return replies;
}
test('Windows native host binary framed config and receipt', { skip:!exe }, async()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
  const rejectedJpeg=Buffer.from([0xff,0xd8,0x01,0x02,0xff,0xd9]);
  const metrics={readyState:'complete',imageCount:3,brokenImages:1,unloadedImages:0,linkCount:5,emptyLinks:0,genericSpotifyLinks:1,buttonCount:1,disabledButtonCount:0,headingCount:1};
  const requests=[
    {schemaVersion:schema,action:'config'},
    {schemaVersion:schema,action:'record',mode:'capture',snapshots:[{origin:'https://unauthorised.example',active:true,metrics,screenshot:'data:image/jpeg;base64,'+jpeg.toString('base64')}]},
    {schemaVersion:schema,action:'record',mode:'capture',snapshots:[
      {origin:'http://localhost:4173',active:true,metrics,screenshot:'data:image/jpeg;base64,'+rejectedJpeg.toString('base64')},
      {origin:'https://unauthorised.example',active:false,metrics,screenshot:''},
    ]},
    {schemaVersion:schema,action:'record',mode:'capture',snapshots:[{origin:'http://localhost:4173',active:true,metrics,screenshot:'data:image/jpeg;base64,'+jpeg.toString('base64')}]}
  ];
  const replies=await exchange(requests);
  assert.equal(replies.length,4);
  assert.equal(replies[0].ok,true);
  assert.deepEqual(replies[0].allowedOrigins,['http://localhost:4173']);
  assert.equal(replies[1].ok,false);
  assert.equal(replies[1].blocker,'NATIVE_ORIGIN_NOT_ALLOWED');
  assert.equal(replies[2].ok,false);
  assert.equal(replies[2].blocker,'NATIVE_ORIGIN_NOT_ALLOWED');
  assert.equal(replies[3].ok,true);
  const receiptRoot=join(dirname(exe),'receipts');
  const found=await readdir(receiptRoot);
  assert.equal(found.filter(f=>f.endsWith('.jpg')).length,1);
  const receipt=JSON.parse(await readFile(join(receiptRoot,found.find(f=>f.endsWith('.json'))),'utf8'));
  assert.equal(receipt.observations[0].metrics.brokenImages,1);
  assert.equal(receipt.observations[0].metrics.genericSpotifyLinks,1);
  assert.equal(receipt.observedTabCount,1);
  const truth=await readNativeBrowserObservation({nativeReceiptRoot:receiptRoot});
  assert.equal(truth.ok,true);
  assert.equal(truth.finalVerdict,'BROWSER_OBSERVATION_CAPTURED');
  assert.equal(truth.functionalAcceptanceVerified,false);
});

test('Windows installer preserves other browsers authorization and origin configuration', {skip:process.platform!=='win32'}, async(t)=>{
  const repo=await mkdtemp(join(tmpdir(),'stephanos-browser-installer-'));
  try {
    const scripts=join(repo,'scripts','windows');
    await mkdir(scripts,{recursive:true});
    const installer=join(scripts,'install-sovereign-browser-witness.ps1');
    await copyFile(new URL('../scripts/windows/install-sovereign-browser-witness.ps1',import.meta.url),installer);
    const source=join(scripts,'SovereignBrowserWitnessHost.cs');
    await copyFile(new URL('../scripts/windows/SovereignBrowserWitnessHost.cs',import.meta.url),source);
    const harness=join(repo,'installer-harness.ps1');
    // Run the real Windows PowerShell 5.1 installer and compiler in a temporary
    // repository. Intercept only registry writes; no real browser is registered.
    await writeFile(harness,String.raw`
param([string]$Installer,[string]$Browser,[string]$ExtensionId,[string]$Origin,[string]$RegistryLog,[switch]$FailRegistryWrite)
$ErrorActionPreference='Stop'
$script:RegistryFailureInjected=$false
function New-Item {
  [CmdletBinding()]param([string]$Path,[string]$ItemType,[switch]$Force)
  if($Path.StartsWith('HKCU:\')) {
    Add-Content -LiteralPath ($RegistryLog + '.calls') -Value 'New-Item'
    return
  }
  Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function Test-Path {
  [CmdletBinding()]param([string]$Path,[string]$LiteralPath)
  $candidate=if($PSBoundParameters.ContainsKey('LiteralPath')) {$LiteralPath} else {$Path}
  if($candidate.StartsWith('HKCU:\')) {
    return (Microsoft.PowerShell.Management\Test-Path -LiteralPath $RegistryLog) -and
      ((Get-Content -LiteralPath $RegistryLog -Raw | ConvertFrom-Json).path -ceq $candidate)
  }
  Microsoft.PowerShell.Management\Test-Path @PSBoundParameters
}
function Get-Item {
  [CmdletBinding()]param([string]$LiteralPath)
  if($LiteralPath.StartsWith('HKCU:\')) {
    $record=Get-Content -LiteralPath $RegistryLog -Raw | ConvertFrom-Json
    if($record.path -cne $LiteralPath) { throw 'TEST_UNEXPECTED_REGISTRY_READ' }
    $key=[pscustomobject]@{DefaultValue=$record.value}
    $key | Add-Member -MemberType ScriptMethod -Name GetValue -Value {param($Name,$Default,$Options) $this.DefaultValue}
    $key | Add-Member -MemberType ScriptMethod -Name GetValueKind -Value {param($Name) [Microsoft.Win32.RegistryValueKind]::String}
    $key | Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
    return $key
  }
  Microsoft.PowerShell.Management\Get-Item @PSBoundParameters
}
function Set-Item {
  [CmdletBinding()]param([string]$Path,[object]$Value)
  if(-not $Path.StartsWith('HKCU:\')) { throw 'TEST_UNEXPECTED_REGISTRY_WRITE' }
  Add-Content -LiteralPath ($RegistryLog + '.calls') -Value 'Set-Item'
  [ordered]@{path=$Path;value=$Value} | ConvertTo-Json | Set-Content -LiteralPath $RegistryLog -Encoding UTF8
  if($FailRegistryWrite -and -not $script:RegistryFailureInjected) {
    $script:RegistryFailureInjected=$true
    throw 'TEST_REGISTRY_WRITE_FAILED'
  }
}
function Remove-Item {
  [CmdletBinding()]param([string]$Path,[string]$LiteralPath,[switch]$Recurse,[switch]$Force)
  $candidate=if($PSBoundParameters.ContainsKey('LiteralPath')) {$LiteralPath} else {$Path}
  if($candidate.StartsWith('HKCU:\')) {
    Add-Content -LiteralPath ($RegistryLog + '.calls') -Value 'Remove-Item'
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $RegistryLog -Force
    return
  }
  Microsoft.PowerShell.Management\Remove-Item @PSBoundParameters
}
& $Installer -Browser $Browser -ExtensionId $ExtensionId -AllowedOrigins @($Origin) -Confirm:$false
`);
    const json=async(file)=>JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));
    const invoke=(browser,extension,origin,registryLog,{failRegistryWrite=false}={})=>
      spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',harness,
        '-Installer',installer,'-Browser',browser,'-ExtensionId',extension,'-Origin',origin,'-RegistryLog',registryLog,
        ...(failRegistryWrite?['-FailRegistryWrite']:[])],
      {encoding:'utf8',timeout:60_000,windowsHide:true});
    const install=(...args)=>{
      const run=invoke(...args);
      assert.equal(run.status,0,run.error?.message||run.stderr||run.stdout);
      return JSON.parse(run.stdout.trim());
    };
    const hostRoot=join(repo,'.stephanos','local-state-checkpoints','sovereign-browser-native-host');
    await mkdir(hostRoot,{recursive:true});
    const legacy=join(hostRoot,'com.stephanos.sovereign_browser_witness.json');
    await writeFile(legacy,'legacy registration remains intact');
    const edgeLog=join(repo,'edge-registry.json');
    const edge=install('Edge','a'.repeat(32),'http://localhost:4173',edgeLog);
    const edgeManifest=await json(edge.manifestPath);
    const edgeConfig=join(dirname(edge.manifestPath),'allowed-origins.json');
    const edgeCalls=edgeLog+'.calls';
    const edgeFiles=[edge.manifestPath,edgeManifest.path,edgeConfig,edgeLog,legacy,edgeCalls];
    const before=await Promise.all(edgeFiles.map(file=>readFile(file)));
    const chromeLog=join(repo,'chrome-registry.json');
    const chrome=install('Chrome','b'.repeat(32),'https://workspace.example',chromeLog);
    const chromeManifest=await json(chrome.manifestPath);
    assert.notEqual(dirname(edge.manifestPath),dirname(chrome.manifestPath));
    assert.notEqual(edgeManifest.path,chromeManifest.path);
    for(let i=0;i<edgeFiles.length;i++) assert.deepEqual(await readFile(edgeFiles[i]),before[i],edgeFiles[i]);
    assert.deepEqual(edgeManifest.allowed_origins,[`chrome-extension://${'a'.repeat(32)}/`]);
    assert.deepEqual(chromeManifest.allowed_origins,[`chrome-extension://${'b'.repeat(32)}/`]);
    assert.deepEqual((await json(edgeConfig)).allowedOrigins,['http://localhost:4173']);
    assert.deepEqual((await json(join(dirname(chrome.manifestPath),'allowed-origins.json'))).allowedOrigins,['https://workspace.example']);
    assert.deepEqual(await json(edgeLog),{path:'HKCU:\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.stephanos.sovereign_browser_witness',value:edge.manifestPath});
    assert.deepEqual(await json(chromeLog),{path:'HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.stephanos.sovereign_browser_witness',value:chrome.manifestPath});
    await t.test('same-browser compiler failure preserves every installed byte and makes no registry write',async()=>{
      const goodSource=await readFile(source);
      try {
        await writeFile(source,'public class { deliberately invalid CSharp source }');
        const failed=invoke('Edge','c'.repeat(32),'https://replacement.example',edgeLog);
        assert.notEqual(failed.status,0);
        assert.match(failed.stderr,/Add-Type|CS\d{4}/);
        for(let i=0;i<edgeFiles.length;i++) assert.deepEqual(await readFile(edgeFiles[i]),before[i],edgeFiles[i]);
        assert.equal((await readdir(hostRoot)).filter(name=>name.startsWith('.staging-')).length,0);
      } finally {await writeFile(source,goodSource);}
    });
    await t.test('late registration failure restores the prior executable, config, manifest and registration',async()=>{
      const failed=invoke('Edge','c'.repeat(32),'https://replacement.example',edgeLog,{failRegistryWrite:true});
      assert.notEqual(failed.status,0);
      assert.match(failed.stderr,/TEST_REGISTRY_WRITE_FAILED/);
      for(let i=0;i<edgeFiles.length-1;i++) assert.deepEqual(await readFile(edgeFiles[i]),before[i],edgeFiles[i]);
      const writes=(await readFile(edgeCalls,'utf8')).trim().split(/\r?\n/);
      assert.deepEqual(writes,['New-Item','Set-Item','Set-Item','Set-Item']);
      assert.equal((await readdir(hostRoot)).filter(name=>name.startsWith('.staging-')).length,0);
    });
  } finally {await rm(repo,{recursive:true,force:true});}
});
