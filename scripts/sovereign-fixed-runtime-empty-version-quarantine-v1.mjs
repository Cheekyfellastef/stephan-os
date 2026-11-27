// Prepared artifact only. It grants no elevation, runtime qualification or custody.
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment, battleBridgeGitFixedConfigArgs,
  battleBridgeCanonicalRepositoryArgs } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const EMPTY_RUNTIME_VERSION_V1 = 'd390300e737265984ec5ee2b1b471f8d833aae16';
export const INSTALLED_RUNTIME_VERSION_V1 = 'f55ecf987ab20c1554ad2115b285b5eba024bd94';
export const EMPTY_RUNTIME_QUARANTINE_ENTRY_V1 = 'scripts/windows/quarantine-sovereign-fixed-runtime-empty-version-v1.ps1';
const FACTORY = 'scripts/sovereign-fixed-runtime-empty-version-quarantine-v1.mjs';
const SOURCE = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const ROOT = 'C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1';
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const SHA40 = /^[a-f0-9]{40}$/, SHA64 = /^[a-f0-9]{64}$/, ID = /^[a-f0-9]{32}$/;
const SID = /^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const refusal = reason => { throw new Error(reason); };
const flags = Object.freeze({ installed: false, elevationPerformed: false, quarantinePerformed: false,
  custodyReleased: false, sourceLeaseReleased: false, runtimeQualificationGranted: false,
  pcRestartAllowed: false, arbitraryFilesystemAllowed: false, deleteAllowed: false });

export function buildEmptyRuntimeVersionQuarantineCandidateV1({ expectedMain, sourceTree, operatorSid,
  operationId, installed, records } = {}) {
  if (!SHA40.test(expectedMain || '') || expectedMain === EMPTY_RUNTIME_VERSION_V1
      || !SHA40.test(sourceTree || '') || !SID.test(operatorSid || '') || !ID.test(operationId || ''))
    refusal('EMPTY_VERSION_EXACT_SOURCE_REQUIRED');
  const installedKeys = ['SourceHead','SourceTree','HelperSha256','ManifestSha256','GitClosureSha256','PendingSha256'];
  if (!installed || Object.keys(installed).sort().join(',') !== [...installedKeys].sort().join(',')
      || installed.SourceHead !== INSTALLED_RUNTIME_VERSION_V1 || !SHA40.test(installed.SourceTree || '')
      || installedKeys.slice(2).some(key => !SHA64.test(installed[key] || '')))
    refusal('EMPTY_VERSION_INSTALLED_COMMITMENT_REQUIRED');
  if (!Array.isArray(records) || records.length !== 2) refusal('EMPTY_VERSION_EXACT_RECORDS_REQUIRED');
  const entries = new Map();
  for (const row of records) {
    if (!row || Object.keys(row).sort().join(',') !== 'blobSha,contentBase64,materializedSha256,path'
        || ![FACTORY, EMPTY_RUNTIME_QUARANTINE_ENTRY_V1].includes(row.path) || entries.has(row.path)
        || !SHA40.test(row.blobSha || '') || !SHA64.test(row.materializedSha256 || '')
        || typeof row.contentBase64 !== 'string' || row.contentBase64.length > 262144
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.contentBase64))
      refusal('EMPTY_VERSION_SOURCE_RECORD_INVALID');
    const bytes = Buffer.from(row.contentBase64, 'base64');
    if (!bytes.length || bytes.length > 196608 || blob(bytes) !== row.blobSha)
      refusal('EMPTY_VERSION_SOURCE_BYTES_CHANGED');
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    entries.set(row.path, { Path: row.path, GitBlobSha: row.blobSha, Sha256: hash(bytes),
      MaterializedSha256: row.materializedSha256, ContentBase64: row.contentBase64 });
  }
  const payload = Buffer.from(JSON.stringify({ SchemaVersion: 'stephanos.empty-runtime-version-input.v1',
    SourceHead: expectedMain, SourceTree: sourceTree, OperatorSid: operatorSid, OperationId: operationId,
    TargetVersion: EMPTY_RUNTIME_VERSION_V1, Installed: installed,
    Records: [...entries.values()].sort((a,b) => a.Path.localeCompare(b.Path)) }));
  const payloadSha256 = hash(payload);
  const payloadPath = 'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosEmptyRuntimeVersion-' + expectedMain + '-' + operationId + '.json';
  const entry = entries.get(EMPTY_RUNTIME_QUARANTINE_ENTRY_V1);
  // Read once, retain the stream, hash the captured bytes, and execute ONLY that
  // reviewed captured entry. No elevated mutable .ps1 or compiler/DLL loading.
  const script = `$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$handle=$null
try {
 $info=[IO.FileInfo]::new('${payloadPath}')
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'EMPTY_VERSION_INPUT_UNSAFE'}
 $handle=[IO.FileStream]::new('${payloadPath}','Open','Read','Read')
 $length=$handle.Length
 if($length -lt 2 -or $length -gt 1048576){throw 'EMPTY_VERSION_INPUT_BOUND'}
 $bytes=[byte[]]::new([int]$length);$offset=0
 while($offset -lt $bytes.Length){$count=$handle.Read($bytes,$offset,$bytes.Length-$offset);if($count -le 0){throw 'EMPTY_VERSION_INPUT_BOUND'};$offset+=$count}
 if($handle.ReadByte() -ne -1 -or $handle.Length -ne $length){throw 'EMPTY_VERSION_INPUT_BOUND'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '${payloadSha256}'){throw 'EMPTY_VERSION_INPUT_CHANGED'}
 $data=([Text.UTF8Encoding]::new($false,$true).GetString($bytes))|ConvertFrom-Json
 if($data.SchemaVersion -cne 'stephanos.empty-runtime-version-input.v1' -or $data.SourceHead -cne '${expectedMain}' -or $data.SourceTree -cne '${sourceTree}' -or $data.OperationId -cne '${operationId}'){throw 'EMPTY_VERSION_SOURCE_CHANGED'}
 $entry=@($data.Records|Where-Object{$_.Path -ceq '${EMPTY_RUNTIME_QUARANTINE_ENTRY_V1}'})
 if($entry.Count -ne 1 -or $entry[0].Sha256 -cne '${entry.Sha256}'){throw 'EMPTY_VERSION_ENTRY_UNPROVEN'}
 $entryBytes=[Convert]::FromBase64String($entry[0].ContentBase64)
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($entryBytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '${entry.Sha256}'){throw 'EMPTY_VERSION_ENTRY_CHANGED'}
 $script:EmptyRuntimeVersionPinnedBootstrapV1=$data
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($entryBytes))) -OperatorApproved -ExpectedMain '${expectedMain}'
} finally {$script:EmptyRuntimeVersionPinnedBootstrapV1=$null;if($null -ne $handle){$handle.Dispose()}}
`;
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  if (encodedCommand.length > 30000) refusal('EMPTY_VERSION_COMMAND_BOUND');
  return Object.freeze({ schemaVersion: 'stephanos.empty-runtime-version-candidate.v1', expectedMain,
    sourceTree, operationId, operatorSid, targetVersion: EMPTY_RUNTIME_VERSION_V1,
    installedSourceHead: INSTALLED_RUNTIME_VERSION_V1, payloadPath, payloadBytes: payload,
    payloadSha256, entrySha256: entry.Sha256, script, scriptSha256: hash(script), encodedCommand,
    powershellExecutable: PS, requiresUac: true, independentSourceAuthorityProven: false,
    operatorApprovalProven: false, ...flags });
}

function boundedFile(path, maximum) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > maximum)
    refusal('EMPTY_VERSION_CAPTURE_UNSAFE');
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (bytes.length !== info.size || !after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size)
    refusal('EMPTY_VERSION_CAPTURE_CHANGED');
  return bytes;
}
function git(args, input) {
  const r = spawnSync(GIT, [...battleBridgeGitFixedConfigArgs(), ...battleBridgeCanonicalRepositoryArgs(SOURCE), ...args],
    { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 262144, input,
      env: createBattleBridgeMinimalChildEnvironment(process.env,{git:true}) });
  if (r.error || r.status !== 0 || r.signal) refusal('EMPTY_VERSION_CANONICAL_GIT_UNPROVEN');
  return Buffer.from(r.stdout);
}
function captureInstalledCommitment() {
  const version=win32.join(ROOT,INSTALLED_RUNTIME_VERSION_V1);
  const pendingBytes=boundedFile(win32.join(version,'pending.json'),32768);
  const p=JSON.parse(pendingBytes);
  // The trusted installer embeds its manifest in host.exe; no manifest.json
  // exists on disk. This recovery binds the protected pending commitment and
  // actual host bytes, never loads a PE or grants native qualification.
  if(p.SchemaVersion!=='stephanos.fixed-runtime-pending.v1' || p.SourceHead!==INSTALLED_RUNTIME_VERSION_V1
      || !SHA40.test(p.SourceTree || '')
      || ['HelperSha256','ManifestSha256','GitClosureSha256'].some(k=>!SHA64.test(p[k] || ''))
      || hash(boundedFile(win32.join(version,'host.exe'),2097152))!==p.HelperSha256)
    refusal('EMPTY_VERSION_INSTALLED_COMMITMENT_REQUIRED');
  return {...Object.fromEntries(['SourceHead','SourceTree','HelperSha256','ManifestSha256','GitClosureSha256'].map(k=>[k,p[k]])),
    PendingSha256:hash(pendingBytes)};
}
function physicalTextMatchesGitBlob(captured,physical) {
  // These two exact source inputs are UTF-8 text. Do not run Git path filters
  // against mutable .gitattributes/local filter configuration during capture.
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  decoder.decode(captured);decoder.decode(physical);
  if(physical.equals(captured))return true;
  const normalized=Buffer.alloc(physical.length);let offset=0;
  for(let i=0;i<physical.length;i++){
    if(physical[i]===13 && physical[i+1]===10)continue;
    normalized[offset++]=physical[i];
  }
  return normalized.subarray(0,offset).equals(captured);
}
export function prepareEmptyRuntimeVersionQuarantineV1(expectedMain) {
  try {
    if (process.platform !== 'win32') refusal('EMPTY_VERSION_WINDOWS_REQUIRED');
    if (!SHA40.test(expectedMain || '') || expectedMain === EMPTY_RUNTIME_VERSION_V1)
      refusal('EMPTY_VERSION_EXACT_SOURCE_REQUIRED');
    if (!lstatSync(SOURCE).isDirectory() || lstatSync(SOURCE).isSymbolicLink()) refusal('EMPTY_VERSION_SOURCE_UNSAFE');
    const check = () => {
      if (git(['branch','--show-current']).toString().trim() !== 'main'
          || git(['rev-parse','HEAD']).toString().trim() !== expectedMain
          || git(['rev-parse','refs/remotes/origin/main']).toString().trim() !== expectedMain)
        refusal('EMPTY_VERSION_CURRENT_MAIN_UNPROVEN');
    };
    check();
    const sourceTree = git(['rev-parse', expectedMain + '^{tree}']).toString().trim();
    const records = [FACTORY, EMPTY_RUNTIME_QUARANTINE_ENTRY_V1].map(path => {
      const blobSha = git(['rev-parse', expectedMain + ':' + path]).toString().trim();
      const bytes = git(['cat-file','blob',blobSha]);
      const physical = boundedFile(resolve(SOURCE,path),196608);
      if (!physicalTextMatchesGitBlob(bytes,physical))
        refusal('EMPTY_VERSION_SOURCE_MATERIALIZATION_CHANGED');
      return { path, blobSha, materializedSha256: hash(physical), contentBase64: bytes.toString('base64') };
    });
    const installed=captureInstalledCommitment();
    const sid = spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-Command',
      '[Console]::Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)'],
    { shell:false, windowsHide:true, encoding:'utf8', timeout:5000, maxBuffer:1024,
      env:createBattleBridgeMinimalChildEnvironment() });
    if (sid.error || sid.status !== 0 || sid.signal) refusal('EMPTY_VERSION_OPERATOR_UNPROVEN');
    check();
    const candidate = buildEmptyRuntimeVersionQuarantineCandidateV1({ expectedMain, sourceTree,
      operatorSid:sid.stdout, operationId:randomUUID().replaceAll('-',''), installed, records });
    if (existsSync(candidate.payloadPath)) refusal('EMPTY_VERSION_PAYLOAD_COLLISION');
    writeFileSync(candidate.payloadPath,candidate.payloadBytes,{flag:'wx',mode:0o600});
    if (!boundedFile(candidate.payloadPath,1048576).equals(candidate.payloadBytes)) refusal('EMPTY_VERSION_PAYLOAD_READBACK_UNPROVEN');
    const {payloadBytes,script,...result}=candidate;
    return Object.freeze({ ...result, ok:true, state:'READY_FOR_OPERATOR_APPROVAL', sourceFileCount:2 });
  } catch(error) {
    return Object.freeze({ ok:false,state:'BLOCKED',reason:/^[A-Z0-9_]{1,96}$/.test(error?.message||'')?error.message:'EMPTY_VERSION_PREPARATION_UNPROVEN',...flags });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const result=args.length===3 && args[0]==='prepare' && args[1]==='--expected-main'
    ? prepareEmptyRuntimeVersionQuarantineV1(args[2]) : {ok:false,state:'BLOCKED',reason:'EMPTY_VERSION_ARGUMENTS_INVALID',...flags};
  process.stdout.write('SOVEREIGN_EMPTY_RUNTIME_VERSION_PREPARED_V1='+JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:2;
}
