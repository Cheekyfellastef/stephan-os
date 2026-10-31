// Pure prepared artifact for the existing manually approved installation route.
// GitHub membership, exact operator approval and elevation are independent gates.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createBattleBridgeMinimalChildEnvironment} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
const closure=JSON.parse(readFileSync(new URL('../shared/agents/sovereignFixedRuntimeSourceClosureV1.json',import.meta.url)));
export const FIXED_RUNTIME_SOURCE_PATHS_V1=Object.freeze([...closure.paths]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function buildFixedRuntimeInstallerCandidateV1({expectedMain,sourceTree,operatorSid,records}={}) {
 if(!/^[a-f0-9]{40}$/.test(expectedMain??'') || !/^[a-f0-9]{40}$/.test(sourceTree??'') ||
   !/^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/.test(operatorSid??'') ||
   closure.schemaVersion!=='stephanos.fixed-runtime-source-closure.v1' ||
   FIXED_RUNTIME_SOURCE_PATHS_V1.length>258 || !Array.isArray(records) || records.length!==FIXED_RUNTIME_SOURCE_PATHS_V1.length)
   throw new Error('FIXED_INSTALL_EXACT_SOURCE_REQUIRED');
 const seen=new Set(),captured=[];let total=0;
 for(const row of records) {
  if(!row || Object.keys(row).sort().join(',')!=='blobSha,contentBase64,path' ||
    !FIXED_RUNTIME_SOURCE_PATHS_V1.includes(row.path) || seen.has(row.path) ||
    !/^[a-f0-9]{40}$/.test(row.blobSha??'') || typeof row.contentBase64!=='string' ||
    row.contentBase64.length>2796208 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.contentBase64))
    throw new Error('FIXED_INSTALL_SOURCE_RECORD_INVALID');
  const bytes=Buffer.from(row.contentBase64,'base64');total+=bytes.length;
  if(bytes.length>2097152 || total>8388608 ||
    createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==row.blobSha)
    throw new Error('FIXED_INSTALL_SOURCE_BLOB_MISMATCH');
  new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  seen.add(row.path);captured.push({Path:row.path,Sha256:sha(bytes),ContentBase64:row.contentBase64});
 }
 captured.sort((a,b)=>a.Path.localeCompare(b.Path));
 const payload=Buffer.from(JSON.stringify({SchemaVersion:'stephanos.fixed-runtime-install-input.v1',
  SourceHead:expectedMain,SourceTree:sourceTree,OperatorSid:operatorSid,Records:captured}));
 const payloadSha256=sha(payload);
 const payloadPath='C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosFixedRuntimeInstall-'+expectedMain+'.json';
 const installer=captured.find(row=>row.Path==='scripts/windows/install-sovereign-fixed-runtime-v1.ps1');
 if(!installer)throw new Error('FIXED_INSTALL_ENTRY_SOURCE_REQUIRED');
 const script=String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$path='__PAYLOAD_PATH__'
$handle=$null
try{
 $info=[IO.FileInfo]::new($path)
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $info.Length -gt 16777216){throw 'FIXED_BOOTSTRAP_INPUT_UNSAFE'}
 $handle=[IO.FileStream]::new($path,'Open','Read','Read')
 $memory=[IO.MemoryStream]::new()
 try{$handle.CopyTo($memory);$bytes=$memory.ToArray()}finally{$memory.Dispose()}
 if($bytes.Length -gt 16777216){throw 'FIXED_BOOTSTRAP_INPUT_BOUND'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__PAYLOAD_SHA__'){throw 'FIXED_BOOTSTRAP_INPUT_CHANGED'}
 $data=([Text.UTF8Encoding]::new($false,$true).GetString($bytes))|ConvertFrom-Json
 if($data.SchemaVersion -cne 'stephanos.fixed-runtime-install-input.v1' -or $data.SourceHead -cne '__HEAD__' -or $data.SourceTree -cne '__TREE__'){
  throw 'FIXED_BOOTSTRAP_SOURCE_IDENTITY_CHANGED'
 }
 $entry=@($data.Records|Where-Object{$_.Path -ceq 'scripts/windows/install-sovereign-fixed-runtime-v1.ps1'})
 if($entry.Count -ne 1 -or $entry[0].Sha256 -cne '__ENTRY_SHA__'){throw 'FIXED_BOOTSTRAP_ENTRY_UNPROVEN'}
 $entryBytes=[Convert]::FromBase64String($entry[0].ContentBase64)
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($entryBytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__ENTRY_SHA__'){throw 'FIXED_BOOTSTRAP_ENTRY_CHANGED'}
 $script:FixedRuntimeInstallerPinnedBootstrapV1=$data
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($entryBytes))) -OperatorApproved -ExpectedMain '__HEAD__'
}finally{
 $script:FixedRuntimeInstallerPinnedBootstrapV1=$null
 if($null -ne $handle){$handle.Dispose()}
}`.replaceAll('__PAYLOAD_PATH__',payloadPath).replaceAll('__PAYLOAD_SHA__',payloadSha256)
 .replaceAll('__HEAD__',expectedMain).replaceAll('__TREE__',sourceTree).replaceAll('__ENTRY_SHA__',installer.Sha256);
 const encodedCommand=Buffer.from(script,'utf16le').toString('base64');
 if(encodedCommand.length>30000)throw new Error('FIXED_BOOTSTRAP_COMMAND_BUDGET');
 return Object.freeze({schemaVersion:'stephanos.fixed-runtime-installer-candidate.v1',
  expectedMain,sourceTree,operatorSid,payloadPath,payloadBytes:payload,payloadSha256,
  script,scriptSha256:sha(script),encodedCommand,
  powershellExecutable:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  environment:createBattleBridgeMinimalChildEnvironment(),
  independentSourceAuthorityProven:false,operatorApprovalProven:false,
  elevationPerformed:false,installed:false,custodyReleased:false});
}
