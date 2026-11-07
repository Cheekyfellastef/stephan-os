// Private adapter of the existing Commander/worker. No public command surface.
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, opendirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {inspectStephanosNativeCapacityGamingAdmissionV1} from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
import {createBattleBridgeMinimalChildEnvironment, resolveBattleBridgeGitExecution}
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import {createBattleBridgeGitProbeContextV1, isBattleBridgeGitProbeContextV1}
  from '../shared/agents/battleBridgeGitProbeContextV1.mjs';
import {readMaintenanceRecoverySourceV1} from './sovereign-maintenance-custody-store-v1.mjs';
import {FIXED_RUNTIME_SOURCE_PATHS_V1, fixedRuntimeGitClosureSha256V1}
  from './sovereign-fixed-runtime-installer-candidate-v1.mjs';

// One canonical route for the already compiled maintenance profile. This is
// declaration, not qualification: the actual owner must still prove its native
// identity, fresh source, resource budget, reservation and physical custody.
export const FIXED_MAINTENANCE_RUNTIME_ROUTE_V1 = Object.freeze({
  actionId: 'repair-goal-builder-flow',
  profile: 'MAINTENANCE_GOAL_BUILDER_V1',
  executionTimeoutMs: 160000,
});
export function fixedRuntimeMaintenanceActionQualifiedV1(actionId) {
  return actionId === FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId;
}

// Compiled-profile declaration only. The protected runtime may advertise this
// seam after source integration, but no caller can dispatch it until a separate
// purpose-scoped signer/enrollment commissioning step is independently proven.
export const FIXED_MAILBOX_NATIVE_EVIDENCE_RUNTIME_PROFILE_V1 = Object.freeze({
  profile: 'CANONICAL_MAILBOX_NATIVE_EVIDENCE_V1',
  signerCommissioned: false,
  dispatchAllowed: false,
  reason: 'NATIVE_ROTATION_PRODUCER_UNQUALIFIED',
});

const ROOT = 'C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1';
const SOURCE = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WORKSPACE='C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace';
const resourceAllowed=()=>{try{return inspectStephanosNativeCapacityGamingAdmissionV1({workspaceRoot:WORKSPACE,repoRoot:SOURCE}).ok===true;}catch{return false;}};
const SHA = /^[a-f0-9]{64}$/;
// Closed diagnostic vocabulary emitted by the fixed native inventory. These
// failures never qualify an installation or carry native execution provenance.
const INSPECTION_DENIAL_REASONS = new Set([
  'RUNTIME_NORMAL_OPERATOR_REQUIRED', 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',
  'RUNTIME_WINDOWS_BOOT_UNPROVEN', 'RUNTIME_MACHINE_UNPROVEN',
  'RUNTIME_SOURCE_REF_CHANGED', 'RUNTIME_SOURCE_MEMBER_CHANGED',
  'RUNTIME_SOURCE_MEMBER_UNPROVEN', 'RUNTIME_MANIFEST_CLOSURE_INCOMPLETE',
  'RUNTIME_MANIFEST_IDENTITY_UNPROVEN', 'RUNTIME_EMBEDDED_MANIFEST_UNPROVEN',
  'RUNTIME_HELPER_LOCATION_UNPROVEN', 'RUNTIME_HELPER_UNEXPECTED_CONTENT',
  'RUNTIME_PROTECTED_OWNER_UNPROVEN', 'RUNTIME_PROTECTED_WRITE_AUTHORITY_UNPROVEN',
  'RUNTIME_ANCESTOR_OWNER_UNPROVEN', 'RUNTIME_ANCESTOR_WRITE_AUTHORITY_UNPROVEN',
  'RUNTIME_FIXED_EXECUTABLE_CHANGED', 'RUNTIME_FIXED_EXECUTABLE_IDENTITY_UNPROVEN',
  'RUNTIME_JOURNAL_MAPPING_UNPROVEN', 'RUNTIME_JOURNAL_OWNER_UNPROVEN',
  'RUNTIME_JOURNAL_MUTATION_AUTHORITY_UNPROVEN', 'RUNTIME_JOURNAL_RETENTION_UNPROVEN',
  'RUNTIME_JOURNAL_ACCESS_UNPROVEN', 'RUNTIME_JOURNAL_BOOTSTRAP_UNPROVEN',
  'RUNTIME_NATIVE_ANCHOR_MISSING', 'RUNTIME_NATIVE_ANCHOR_MALFORMED',
  'RUNTIME_NATIVE_ANCHOR_SCAN_EXHAUSTED', 'RUNTIME_NATIVE_ANCHOR_AUTHENTICATION_FAILED',
  'RUNTIME_CUSTODY_RECORD_AUTHENTICATION_FAILED', 'RUNTIME_CUSTODY_RECORD_SCHEMA_UNPROVEN',
  'RUNTIME_CUSTODY_PHASE_UNPROVEN', 'RUNTIME_CUSTODY_BOOT_UNPROVEN',
  'RUNTIME_CUSTODY_TERMINAL_UNPROVEN',
  'RUNTIME_SOURCE_PROOF_BASE64', 'RUNTIME_SOURCE_PROOF_TREE_BOUND',
  'RUNTIME_SOURCE_PROOF_TREE_SHAPE', 'RUNTIME_SOURCE_PROOF_TREE_MODE',
  'RUNTIME_SOURCE_PROOF_TREE_PATH', 'RUNTIME_SOURCE_PROOF_TREE_ALIAS',
  'RUNTIME_SOURCE_PROOF_TREE_ORDER', 'RUNTIME_SOURCE_PROOF_CLOSURE',
  'RUNTIME_SOURCE_PROOF_LEGACY_MANIFEST', 'RUNTIME_SOURCE_PROOF_WIRE_BOUND',
  'RUNTIME_SOURCE_PROOF_WIRE_SHAPE', 'RUNTIME_SOURCE_PROOF_COMMIT_HASH',
  'RUNTIME_SOURCE_PROOF_COMMIT_TREE', 'RUNTIME_SOURCE_PROOF_TREE_HASH',
  'RUNTIME_SOURCE_PROOF_MEMBERSHIP', 'RUNTIME_SOURCE_PROOF_MEMBER_CHANGED',
  'RUNTIME_SOURCE_PROOF_TREE_UNUSED', 'RUNTIME_SOURCE_PROOF_PROTECTED_CLOSURE_CHANGED',
]);
const proof = new WeakMap();
const qualifications = new WeakMap();
const exclusions = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const FIXED_RUNTIME_SOURCE_PROOF_LIMITS_V1=Object.freeze({
  wireBytes:3145728,commitBytes:65536,treeBytes:2097152,treeObjects:128,treeEntries:32768,
});
const SOURCE_PROOF_PREFIX='STEPHANOS_FIXED_RUNTIME_SOURCE_V1';
const sourceDenied=code=>{throw new Error('FIXED_RUNTIME_SOURCE_PROOF_'+code);};
const gitHash=(type,bytes)=>createHash('sha1').update(type+' '+bytes.length+'\0').update(bytes).digest('hex');
function proofUtf8(bytes) {
  try {
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    if(!Buffer.from(text,'utf8').equals(bytes))sourceDenied('UTF8');
    return text;
  } catch {sourceDenied('UTF8');}
}
function proofBytes(encoded,maximum) {
  if(typeof encoded!=='string' || encoded.length>4*Math.ceil(maximum/3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))sourceDenied('BASE64');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length>maximum || bytes.toString('base64')!==encoded)sourceDenied('BASE64');
  return bytes;
}
function proofCommit(bytes,head) {
  if(bytes.length>65536 || gitHash('commit',bytes)!==head)sourceDenied('COMMIT_HASH');
  const text=proofUtf8(bytes),separator=text.indexOf('\n\n');
  if(separator<0 || !/^tree [a-f0-9]{40}\n/.test(text) ||
    text.slice(0,separator).split('\n').filter(line=>line.startsWith('tree ')).length!==1)sourceDenied('COMMIT_TREE');
  return text.slice(5,45);
}
function proofTree(bytes,budget) {
  budget.bytes+=bytes.length;
  if(budget.bytes>2097152)sourceDenied('TREE_BOUND');
  const rows=new Map(),folded=new Set();let offset=0,previous=null;
  while(offset<bytes.length) {
    if(++budget.entries>32768)sourceDenied('TREE_BOUND');
    const space=bytes.indexOf(32,offset),end=bytes.indexOf(0,space+1);
    if(space<offset+1 || end<=space+1 || end+21>bytes.length)sourceDenied('TREE_SHAPE');
    const mode=proofUtf8(bytes.subarray(offset,space)),name=proofUtf8(bytes.subarray(space+1,end));
    if(!['40000','100644','100755'].includes(mode))sourceDenied('TREE_MODE');
    if(end-space-1>255 || name==='.' || name==='..' || /[\\/:<>"|?*\u0000-\u001f\u007f]/.test(name) ||
      /[. ]$/.test(name))sourceDenied('TREE_PATH');
    if(rows.has(name) || folded.has(name.toLowerCase()))sourceDenied('TREE_ALIAS');
    const sortKey=Buffer.from(name+(mode==='40000'?'/':''),'utf8');
    if(previous && Buffer.compare(previous,sortKey)>=0)sourceDenied('TREE_ORDER');
    previous=sortKey;folded.add(name.toLowerCase());
    rows.set(name,{mode,sha:bytes.subarray(end+1,end+21).toString('hex')});offset=end+21;
  }
  return rows;
}
// A pure content-membership check cannot qualify an installation. Production
// additionally invokes the existing authenticated canonical-main observer and
// the protected native verifier; caller-supplied booleans are never authority.
export function verifyFixedRuntimeSourceProofV1(raw,paths=FIXED_RUNTIME_SOURCE_PATHS_V1) {
  if(typeof raw!=='string' || Buffer.byteLength(raw)>3145728 || /[^\x20-\x7e]/.test(raw))sourceDenied('WIRE_BOUND');
  const fields=raw.split(' ');
  if(fields.length<4 || fields.length>131 || fields[0]!==SOURCE_PROOF_PREFIX ||
    !/^[a-f0-9]{40}$/.test(fields[1]))sourceDenied('WIRE_SHAPE');
  const head=fields[1],tree=proofCommit(proofBytes(fields[2],65536),head);
  const trees=new Map(),budget={bytes:0,entries:0};let previous='';
  for(const field of fields.slice(3)) {
    const separator=field.indexOf(':');
    if(separator!==40)sourceDenied('TREE_SHAPE');
    const id=field.slice(0,40),bytes=proofBytes(field.slice(41),2097152);
    if(!/^[a-f0-9]{40}$/.test(id) || id<=previous || gitHash('tree',bytes)!==id)sourceDenied('TREE_HASH');
    previous=id;trees.set(id,proofTree(bytes,budget));
  }
  if(!Array.isArray(paths) || paths.length<1 || paths.length>266)sourceDenied('CLOSURE');
  const members=[],used=new Set(),seen=new Set();
  for(const path of paths) {
    if(typeof path!=='string' || !/^[A-Za-z0-9._/-]{1,240}$/.test(path) || path.includes('..') ||
      path.includes('//') || path.startsWith('/') || path.endsWith('/') || seen.has(path.toLowerCase()))sourceDenied('CLOSURE');
    seen.add(path.toLowerCase());
    let id=tree,leaf;const parts=path.split('/');
    for(let index=0;index<parts.length;index++) {
      const entries=trees.get(id);if(!entries)sourceDenied('MEMBERSHIP');
      used.add(id);leaf=entries.get(parts[index]);if(!leaf)sourceDenied('MEMBERSHIP');
      if(index<parts.length-1) {
        if(leaf.mode!=='40000')sourceDenied('MEMBERSHIP');
        id=leaf.sha;
      } else if(leaf.mode!=='100644')sourceDenied('MEMBER_MODE');
    }
    members.push(Object.freeze({Path:path,GitMode:'100644',GitBlobSha:leaf.sha}));
  }
  if(used.size!==trees.size)sourceDenied('TREE_UNUSED');
  return Object.freeze({head,tree,gitClosureSha256:fixedRuntimeGitClosureSha256V1(members),
    members:Object.freeze(members),sourceProofSha256:digest(raw)});
}
function captureFixedRuntimeSourceProofV1(head) {
  if(!/^[a-f0-9]{40}$/.test(head) || exactHead()!==head)sourceDenied('HEAD_CHANGED');
  const context=createBattleBridgeGitProbeContextV1(SOURCE);
  if(!isBattleBridgeGitProbeContextV1(context,SOURCE))sourceDenied('CONTEXT');
  try {
    const started=performance.now();
    const execution=resolveBattleBridgeGitExecution({platform:process.platform,environment:process.env});
    const capture=(type,id,maximum)=>{
      if(!['commit','tree'].includes(type) || !/^[a-f0-9]{40}$/.test(id))sourceDenied('OBJECT');
      context.assert();
      if(performance.now()-started>10000)sourceDenied('DEADLINE');
      const row=spawnSync(execution.executable,[...execution.fixedConfigArgs,...context.repositoryArgs(),'cat-file',type,id],
        {cwd:SOURCE,env:execution.environment,shell:false,windowsHide:true,timeout:5000,maxBuffer:maximum});
      context.assert();
      if(performance.now()-started>10000)sourceDenied('DEADLINE');
      if(row.error || row.status!==0 || row.signal || !Buffer.isBuffer(row.stdout) || row.stdout.length>maximum)
        sourceDenied('READ');
      if(gitHash(type,row.stdout)!==id)sourceDenied('OBJECT_HASH');
      return row.stdout;
    };
    const commit=capture('commit',head,65536),tree=proofCommit(commit,head);
    const trees=new Map(),budget={bytes:0,entries:0};
    const get=id=>{
      if(!trees.has(id)) {
        if(trees.size>=128)sourceDenied('TREE_BOUND');
        const bytes=capture('tree',id,2097152);
        trees.set(id,{bytes,entries:proofTree(bytes,budget)});
      }
      return trees.get(id).entries;
    };
    for(const path of FIXED_RUNTIME_SOURCE_PATHS_V1) {
      let id=tree;const parts=path.split('/');
      for(let index=0;index<parts.length;index++) {
        const leaf=get(id).get(parts[index]);if(!leaf)sourceDenied('MEMBERSHIP');
        if(index<parts.length-1) {if(leaf.mode!=='40000')sourceDenied('MEMBERSHIP');id=leaf.sha;}
        else if(leaf.mode!=='100644')sourceDenied('MEMBER_MODE');
      }
    }
    const raw=[SOURCE_PROOF_PREFIX,head,commit.toString('base64'),
      ...[...trees].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,row])=>id+':'+row.bytes.toString('base64'))].join(' ');
    const observed=verifyFixedRuntimeSourceProofV1(raw);
    if(exactHead()!==head || boundedFile(join(SOURCE,'.git','refs','remotes','origin','main'),256).toString('utf8').trim()!==head)
      sourceDenied('HEAD_CHANGED');
    context.assert();
    return Object.freeze({...observed,raw});
  } finally {context.close();}
}
const denied = (reason,binding) => {const result=Object.freeze({ok:false, reason, executionCustodyReleased:true,
  taskRootCreated:false, taskExecuted:false, dispatchAllowed:false});if(binding)exclusions.set(result,Object.freeze({...binding}));return result;};
export function consumeFixedRuntimePrelaunchExclusionV1(result,binding) {
  const stored=exclusions.get(result);exclusions.delete(result);
  return Boolean(stored && binding && ['requestId','sourceHead','custodyRecordSha256','nativeRecordId','actionId','missionId','claimSha256'].every(k=>stored[k]===binding[k]));
}
function freezeTree(value) {
  if(value && typeof value==='object' && !Object.isFrozen(value)){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}
  return value;
}
function boundedFile(path, maximum) {
  const metadata=lstatSync(path);
  if(!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink!==1 || metadata.size>maximum)
    throw new Error('FIXED_RUNTIME_FILE_UNPROVEN');
  return readFileSync(path);
}
function exactHead() {
  if(boundedFile(join(SOURCE,'.git','HEAD'),256).toString('utf8').trim()!=='ref: refs/heads/main')
    throw new Error('FIXED_RUNTIME_CANONICAL_BRANCH_REQUIRED');
  const head=boundedFile(join(SOURCE,'.git','refs','heads','main'),256).toString('utf8').trim();
  if(!/^[a-f0-9]{40}$/.test(head)) throw new Error('FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN');
  return head;
}
function protectedInstallationAt(head,executionHead=head,gitClosureSha256='') {
  if(!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(executionHead))
    throw new Error('FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN');
  const directory=join(ROOT,head), helper=join(directory,'host.exe');
  for(let path=directory;;path=dirname(path)) {
    let row;
    try { row=lstatSync(path); }
    catch(error) {
      // Only the existing observation of this exact version directory can
      // establish its absence. Other missing/changed/unreadable files remain
      // unproven; this classification grants no install or retry authority.
      if(path===directory && error?.code==='ENOENT')
        throw new Error('FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
      throw error;
    }
    if(!row.isDirectory() || row.isSymbolicLink()) throw new Error('FIXED_RUNTIME_PARENT_REDIRECTION');
    if(dirname(path)===path) break;
  }
  // Fixed paths only. Verify OS-owned write protection BEFORE executing the PE.
  // Source helper later holds the physical pins and checks complete source/boot identity.
  const script=String.raw`$ErrorActionPreference='Stop'
$paths=@('C:\','C:\Program Files','C:\Program Files\Stephanos','C:\Program Files\Stephanos\SovereignFixedRuntimeV1','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__\host.exe','C:\Program Files\Stephanos\SovereignFixedRuntimeV1\__HEAD__\pending.json')
foreach($path in $paths){
 $acl=if([IO.Directory]::Exists($path)){[IO.Directory]::GetAccessControl($path)}else{[IO.File]::GetAccessControl($path)}
 $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
 $ancestor=$path -ceq 'C:\' -or $path -ceq 'C:\Program Files'
 $allowed=@('S-1-5-18','S-1-5-32-544')
 if($ancestor){$allowed+= 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'}
 $mask=if($ancestor){0x500D0150}else{0x500D0156}
 if($owner -cnotin $allowed){throw 'FIXED_RUNTIME_OWNER_UNPROVEN'}
 foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
  if(($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0 -and $ancestor){continue}
  if($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
   (($rule.FileSystemRights -band $mask) -ne 0) -and
   $rule.IdentityReference.Value -cnotin $allowed){throw 'FIXED_RUNTIME_WRITE_AUTHORITY_UNPROVEN'}
 }
}
[Console]::Write('FIXED_RUNTIME_PROTECTED_V1')`.replaceAll('__HEAD__',head);
  const acl=spawnSync(PS,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:4096,
      env:createBattleBridgeMinimalChildEnvironment()});
  if(acl.error || acl.status!==0 || acl.stdout!=='FIXED_RUNTIME_PROTECTED_V1')
    throw new Error('FIXED_RUNTIME_PROTECTION_UNPROVEN');
  const pending=JSON.parse(boundedFile(join(directory,'pending.json'),32768));
  const helperSha256=digest(boundedFile(helper,2097152));
  if(pending.SchemaVersion!=='stephanos.fixed-runtime-pending.v1' || pending.SourceHead!==head ||
      !/^[a-f0-9]{40}$/.test(pending.SourceTree??'') ||
      pending.HelperSha256!==helperSha256 || !SHA.test(pending.ManifestSha256))
    throw new Error('FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
  if(gitClosureSha256 && (!SHA.test(pending.GitClosureSha256??'') || pending.GitClosureSha256!==gitClosureSha256))
    throw new Error('FIXED_RUNTIME_GIT_CLOSURE_CHANGED');
  return Object.freeze({head,executionHead,sourceTree:pending.SourceTree,helper,helperSha256,manifestSha256:pending.ManifestSha256,
    gitClosureSha256:pending.GitClosureSha256??''});
}
function protectedInstallation(sourceProof=null) {
  const head=exactHead();
  if(sourceProof && sourceProof.head!==head)sourceDenied('HEAD_CHANGED');
  let absent=false;
  try {lstatSync(join(ROOT,head));} catch(error) {if(error?.code==='ENOENT')absent=true;else throw error;}
  // An existing exact version, including a partial or invalid installation,
  // never triggers fallback selection or a second installation.
  if(!absent)return protectedInstallationAt(head,head,sourceProof?.gitClosureSha256??'');
  if(!sourceProof)throw new Error('FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
  let directory;
  try {directory=opendirSync(ROOT);} catch(error) {
    if(error?.code==='ENOENT')throw new Error('FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
    throw error;
  }
  const versions=[];let count=0;
  try {
    for(let entry;(entry=directory.readSync())!==null;) {
      if(++count>64)throw new Error('FIXED_RUNTIME_VERSION_DISCOVERY_BOUND');
      if(/^[a-f0-9]{40}$/.test(entry.name))versions.push(entry.name);
      else if(!/^pending-compile-[a-f0-9]{40}-[a-f0-9]{32}$/.test(entry.name))
        throw new Error('FIXED_RUNTIME_VERSION_DISCOVERY_UNPROVEN');
    }
  } finally {directory.closeSync();}
  const matches=[];
  for(const version of versions.sort()) {
    const row=JSON.parse(boundedFile(join(ROOT,version,'pending.json'),32768));
    if(row.SchemaVersion!=='stephanos.fixed-runtime-pending.v1' || row.SourceHead!==version)
      throw new Error('FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');
    // Legacy manifests lack this protected commitment and cannot adopt a new
    // head. Matching this hint only selects a candidate; native proof follows.
    if(row.GitClosureSha256!==sourceProof.gitClosureSha256)continue;
    matches.push(protectedInstallationAt(version,head,sourceProof.gitClosureSha256));
    if(matches.length>1)throw new Error('FIXED_RUNTIME_EQUIVALENT_VERSION_AMBIGUOUS');
  }
  if(matches.length!==1)throw new Error('FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
  return matches[0];
}
function singleReport(stdout,marker,maximum=262144) {
  if(Buffer.byteLength(stdout)>maximum) throw new Error('FIXED_RUNTIME_REPORT_BOUND');
  const lines=stdout.trim().split(/\r?\n/);
  if(lines.length!==1 || !lines[0].startsWith(marker)) throw new Error('FIXED_RUNTIME_REPORT_SHAPE');
  return JSON.parse(lines[0].slice(marker.length));
}
function fixedRuntimeInspectionFailureReason(observed) {
  const unknown='FIXED_RUNTIME_IDENTITY_INSPECTION_UNPROVEN';
  if(observed?.error) {
    if(observed.error.code==='ETIMEDOUT') return 'FIXED_RUNTIME_IDENTITY_INSPECTION_TIMEOUT';
    if(observed.error.code==='ENOENT') return 'FIXED_RUNTIME_INSPECTOR_NOT_FOUND';
    return unknown;
  }
  if(observed?.signal || observed?.status!==2) return unknown;
  try {
    const row=singleReport(observed.stdout,'SOVEREIGN_RUNTIME_INVENTORY_V1=',32768);
    // The native refusal wire record deliberately has no successful identity or
    // profile claims. Refuse extra fields, mixed records and contradictory flags;
    // raw stdout, stderr and OS error text never enter the public diagnostic.
    if(!row || Array.isArray(row) || Object.keys(row).sort().join(',')!==
      'MutationAttempted,Ok,Profiles,Reason,RuntimeActivationGranted,SchemaVersion' ||
      row.SchemaVersion!=='stephanos.fixed-runtime-inventory.v1' || row.Ok!==false ||
      row.RuntimeActivationGranted!==false || row.MutationAttempted!==false ||
      !Array.isArray(row.Profiles) || row.Profiles.length!==0 ||
      !INSPECTION_DENIAL_REASONS.has(row.Reason)) return unknown;
    return row.Reason;
  } catch { return unknown; }
}
export function inspectFixedRuntimeInstallationPresenceV1() {
  if(process.platform!=='win32') return Object.freeze({ok:false,reason:'FIXED_RUNTIME_WINDOWS_REQUIRED',installed:false});
  try {
    let installation;
    try {installation=protectedInstallation();} catch(error) {
      if(error?.message!=='FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING')throw error;
      if(!resourceAllowed())throw new Error('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
      const head=readMaintenanceRecoverySourceV1();
      installation=protectedInstallation(captureFixedRuntimeSourceProofV1(head));
    }
    return Object.freeze({ok:true,reason:'',installed:true,sourceHead:installation.executionHead,
      installationSourceHead:installation.head,
      helperSha256:installation.helperSha256,manifestSha256:installation.manifestSha256});
  } catch(error) {
    const reason=/^[A-Z0-9_]{1,96}$/.test(error?.message||'')?error.message:'FIXED_RUNTIME_QUALIFICATION_UNPROVEN';
    return Object.freeze({ok:false,reason,installed:false});
  }
}

export function inspectFixedRuntimeQualificationV1() {
  if(process.platform!=='win32') return denied('FIXED_RUNTIME_WINDOWS_REQUIRED');
  try {
    if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    // This is the real fixed-URL canonical source observer, not an injectable
    // success flag or caller-selected head. Merkle integrity cannot replace it.
    const authorityStarted=performance.now();
    const executionHead=readMaintenanceRecoverySourceV1();
    if(performance.now()-authorityStarted>=25000)
      return denied('FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED');
    const sourceProof=captureFixedRuntimeSourceProofV1(executionHead);
    if(performance.now()-authorityStarted>=25000)
      return denied('FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED');
    const installation=protectedInstallation(sourceProof);
    const inspectionRemaining=25000-(performance.now()-authorityStarted);
    if(inspectionRemaining<1)return denied('FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED');
    const observed=spawnSync(installation.helper,['--inspect-v1'],{shell:false,windowsHide:true,
      timeout:Math.min(15000,Math.floor(inspectionRemaining)),maxBuffer:32768,encoding:'utf8',
      input:sourceProof.raw+'\n',env:createBattleBridgeMinimalChildEnvironment()});
    if(observed.error || observed.status!==0 || observed.signal)
      return denied(fixedRuntimeInspectionFailureReason(observed));
    const row=singleReport(observed.stdout,'SOVEREIGN_RUNTIME_INVENTORY_V1=',32768);
    if(row.SchemaVersion!=='stephanos.fixed-runtime-inventory.v1' || row.Ok!==true ||
      row.SourceHead!==installation.executionHead || row.InstallationSourceHead!==installation.head ||
      row.SourceTree!==sourceProof.tree || row.InstallationSourceTree!==installation.sourceTree ||
      row.SourceProofSha256!==sourceProof.sourceProofSha256 || row.GitClosureSha256!==sourceProof.gitClosureSha256 ||
      row.HelperSha256!==installation.helperSha256 ||
      row.ManifestSha256!==installation.manifestSha256 || row.AuthenticatedCustodyIdle!==true ||
      row.RuntimeActivationGranted!==false || row.MutationAttempted!==false ||
      !Array.isArray(row.Profiles) || row.Profiles.some(p=>!['MAINTENANCE_GOAL_BUILDER_V1','SOURCE_TASK_V1',FIXED_MAILBOX_NATIVE_EVIDENCE_RUNTIME_PROFILE_V1.profile].includes(p)) ||
      !SHA.test(row.CustodyRecordSha256??'') || !Number.isSafeInteger(row.NativeRecordId) || row.NativeRecordId<1)
      return denied('FIXED_RUNTIME_AUTHENTICATED_IDLE_UNPROVEN');
    if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');
    if(performance.now()-authorityStarted>=25000 || exactHead()!==executionHead)
      return denied('FIXED_RUNTIME_CANONICAL_SOURCE_EXPIRED');
    const qualified=Object.freeze({ok:true,sourceHead:installation.executionHead,installationSourceHead:installation.head,
      profiles:Object.freeze([...row.Profiles]), observedAtUtc:new Date().toISOString(),
      bootStartedAtUtc:row.BootStartedAtUtc,custodyRecordSha256:row.CustodyRecordSha256,
      nativeRecordId:row.NativeRecordId,dispatchAllowed:true});
    qualifications.set(qualified,{installation,sourceProof,custodyRecordSha256:row.CustodyRecordSha256,
      nativeRecordId:row.NativeRecordId,expires:Math.min(performance.now()+5000,authorityStarted+30000)});
    return qualified;
  } catch(error) { return denied(/^[A-Z0-9_]{1,96}$/.test(error.message)?error.message:'FIXED_RUNTIME_QUALIFICATION_UNPROVEN'); }
}
// Pure validation cannot mint provenance. Only the actual fixed private transport
// below can put an original object into proof; JSON roundtrips/copies never inherit it.
// A single consumption authenticates both independent facts. Compatibility
// boolean consumers use this same one-use store; neither API permits replay.
export function consumeFixedRuntimeCompletionV1(result,binding) {
  const stored=proof.get(result);
  proof.delete(result);
  if(!stored || !binding || !['requestId','sourceHead','custodyRecordSha256','nativeRecordId','actionId','missionId','claimSha256']
    .every(key=>stored.binding[key]===binding[key]) || result.executionCustodyReleased!==true) return null;
  return stored.completion;
}
export function consumeFixedRuntimeTerminalProvenanceV1(result,binding) {
  return consumeFixedRuntimeCompletionV1(result,binding)!==null;
}
export function executeFixedMaintenanceRuntimeV1(qualification,binding,options) {
  return executeFixedRuntimeV1(qualification,binding,FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.profile,options);
}
export function executeFixedSourceTaskRuntimeV1(qualification,binding,options) {
  return executeFixedRuntimeV1(qualification,binding,'SOURCE_TASK_V1',options);
}
async function executeFixedRuntimeV1(qualification,inputBinding,profile,{signal,onPrepared}={}) {
  const binding=Object.freeze(Object.fromEntries(['requestId','sourceHead','custodyRecordSha256','nativeRecordId','actionId','missionId','claimSha256'].map(key=>[key,inputBinding?.[key]])));
  if(Object.values(binding).some(value=>value!==undefined && typeof value!=='string' && typeof value!=='number'))
    return denied('FIXED_RUNTIME_PRIMITIVE_BINDING_REQUIRED',binding);
  const qualified=qualifications.get(qualification);
  // One use even if admission fails. No caller-qualified boolean or fake transport.
  qualifications.delete(qualification);
  if(!qualified || performance.now()>qualified.expires) return denied('FIXED_RUNTIME_FRESH_QUALIFICATION_REQUIRED',binding);
  if(!/^[a-z0-9][a-z0-9._-]{7,79}$/.test(binding?.requestId??'') ||
    binding.sourceHead!==qualified.installation.executionHead || !SHA.test(binding.custodyRecordSha256??'') ||
    !Number.isSafeInteger(binding.nativeRecordId) || binding.nativeRecordId<1 ||
    typeof onPrepared!=='function' || signal?.aborted)
    return denied('FIXED_RUNTIME_EXACT_RESERVATION_REQUIRED',binding);
  if(!resourceAllowed())return denied('FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD',binding);
  if(!qualification.profiles.includes(profile)) return denied('FIXED_RUNTIME_PROFILE_NOT_COMPILED',binding);
  const source=profile==='SOURCE_TASK_V1';
  if(source && (!['actionId','missionId'].every(k=>/^[a-z0-9][a-z0-9._-]{0,127}$/.test(binding[k]??'')) ||
    !SHA.test(binding.claimSha256??'') || binding.custodyRecordSha256!==qualified.custodyRecordSha256 ||
    binding.nativeRecordId!==qualified.nativeRecordId)) return denied('FIXED_RUNTIME_ORIGINAL_SOURCE_CLAIM_REQUIRED',binding);
  const taskBody=source?Buffer.from(JSON.stringify({actionId:binding.actionId,missionId:binding.missionId,claimSha256:binding.claimSha256})):Buffer.alloc(0);
  const frame={SchemaVersion:'stephanos.fixed-runtime-request.v1',RequestId:binding.requestId,
    Profile:profile,RuntimeSourceHead:binding.sourceHead,InstallationSourceHead:qualified.installation.head,
    SourceProofSha256:qualified.sourceProof.sourceProofSha256,OwnerPid:process.pid,
    TaskFrameBase64:taskBody.toString('base64'),TaskBindingSha256:digest(taskBody)};
  const raw=JSON.stringify(frame), frameSha256=digest(raw);
  return new Promise(resolve=>{
    let child,buffer='',terminal=null,prepared=null,protocolFault=false,cancelRequested=false,closed=false,timeout,resourceTimer,bindingPending=Promise.resolve();
    const fail=()=>{protocolFault=true;try{child?.stdin.end('CANCEL\n');}catch{}};
    const cancel=()=>{if(cancelRequested)return;cancelRequested=true;try{child?.stdin.end('CANCEL\n');}catch{}};
    try {
      child=spawn(qualified.installation.helper,[],{shell:false,windowsHide:true,
        stdio:['pipe','pipe','pipe'],env:createBattleBridgeMinimalChildEnvironment()});
      timeout=setTimeout(()=>{cancel();try{child.kill();}catch{}},source?1815000:FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.executionTimeoutMs);
      // Task-local cancellation of the existing Job, using the SAME canonical
      // governor reader; this is not another resource controller or GPU proof.
      resourceTimer=setInterval(()=>{if(!resourceAllowed())cancel();},1000);
      resourceTimer.unref?.();
      signal?.addEventListener('abort',cancel,{once:true});
      child.stdin.on('error',()=>{cancelRequested=true;}); child.stderr.on('data',fail);
      child.on('error',fail);
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString('utf8');
        if(Buffer.byteLength(buffer)>300000){fail();return;}
        while(buffer.includes('\n')) {
          const end=buffer.indexOf('\n'),line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          try {
            if(line.startsWith('SOVEREIGN_RUNTIME_PREPARED_V1=')) {
              if(prepared || terminal) throw new Error('DUPLICATE_PREPARED');
              prepared=JSON.parse(line.slice('SOVEREIGN_RUNTIME_PREPARED_V1='.length));
              if(prepared.SchemaVersion!=='stephanos.fixed-runtime-prepared.v1' ||
                prepared.RequestId!==frame.RequestId || prepared.FrameSha256!==frameSha256 ||
                prepared.Profile!==frame.Profile || prepared.OwnerPid!==process.pid ||
                prepared.RuntimeSourceHead!==frame.RuntimeSourceHead ||
                prepared.InstallationSourceHead!==frame.InstallationSourceHead ||
                prepared.SourceProofSha256!==frame.SourceProofSha256 ||
                prepared.HelperSha256!==qualified.installation.helperSha256 ||
                prepared.ManifestSha256!==qualified.installation.manifestSha256 ||
                prepared.CustodyRecordSha256!==binding.custodyRecordSha256 ||
                prepared.NativeRecordId!==binding.nativeRecordId ||
                !Number.isSafeInteger(prepared.RootPid) || prepared.RootPid<1 ||
                !Number.isFinite(Date.parse(prepared.RootCreatedAtUtc)) ||
                !Number.isFinite(Date.parse(prepared.OwnerCreatedAtUtc))) throw new Error('PREPARED_UNBOUND');
              bindingPending=Promise.resolve().then(()=>onPrepared(Object.freeze({...prepared}))).then(accepted=>{
                if(accepted!==true || cancelRequested || closed || signal?.aborted){
                  if(!closed)cancel();else cancelRequested=true;return;
                }
                if(protocolFault)return;
                child.stdin.write(`ACK ${frameSha256} ${process.pid} ${prepared.OwnerCreatedAtUtc} ${prepared.RootPid} ${prepared.RootCreatedAtUtc}\n`);
              },()=>{if(!closed)cancel();else cancelRequested=true;});
            } else if(line.startsWith('SOVEREIGN_RUNTIME_TERMINAL_V1=')) {
              if(terminal) throw new Error('DUPLICATE_TERMINAL');
              terminal=JSON.parse(line.slice('SOVEREIGN_RUNTIME_TERMINAL_V1='.length));
            } else throw new Error('UNEXPECTED_NATIVE_OUTPUT');
          } catch {fail();}
        }
      });
      child.on('close',async code=>{
        closed=true;clearTimeout(timeout);clearInterval(resourceTimer);signal?.removeEventListener('abort',cancel);
        // The original receipt-binding write must settle before any completion.
        // A late ACK is suppressed once close/cancel is observed.
        await bindingPending;
        const stage=terminal?.TaskStage;
        const bound=!protocolFault && !buffer.trim() && prepared &&
          terminal?.SchemaVersion==='stephanos.fixed-runtime-job.v1' &&
          terminal.RequestId===frame.RequestId && terminal.FrameSha256===frameSha256 &&
          terminal.Profile===frame.Profile && terminal.OwnerPid===process.pid &&
          terminal.OwnerCreatedAtUtc===prepared.OwnerCreatedAtUtc &&
          terminal.RuntimeSourceHead===frame.RuntimeSourceHead && terminal.SourceHeadMatched===true &&
          terminal.InstallationSourceHead===frame.InstallationSourceHead && terminal.SourceProofSha256===frame.SourceProofSha256 &&
          terminal.CustodyRecordSha256===binding.custodyRecordSha256 &&
          terminal.NativeRecordId===binding.nativeRecordId &&
          (!source || (terminal.ActionId===binding.actionId && terminal.MissionId===binding.missionId && terminal.ClaimSha256===binding.claimSha256)) && stage?.RootPid===prepared.RootPid &&
          stage.RootCreatedAtUtc===prepared.RootCreatedAtUtc && stage.AssignedBeforeExecution===true &&
          stage.ZeroActiveProcessesObserved===true && stage.ActiveProcesses===0 &&
          stage.ExecutionCustodyReleased===true && terminal.ExecutionCustodyReleased===true &&
          [0,2].includes(code) && code===(terminal.OperationOk===true?0:2);
        // Zero is physical exclusion, never permission to accept a task result.
        // Only fully observed normal entry/exit can authorize finalization; all
        // interruption origins and missing evidence remain ineligible even if
        // a clean proposal was emitted before interruption.
        const normalCompletion=bound && !cancelRequested && stage.CancellationRequested===false &&
          terminal.TaskExecuted===true && terminal.TaskResumed===true && stage.ResumeConfirmed===true &&
          stage.ParentBindingAccepted===true && stage.NormalRootExit===true && stage.OutputComplete===true &&
          stage.OutputOverflow===false && typeof stage.Output==='string' && Buffer.byteLength(stage.Output)<=16384 &&
          stage.OutputSha256===digest(stage.Output);
        const operationProven=normalCompletion && terminal.OperationOk===true &&
          stage.OperationOk===true && stage.ExitCode===0 && stage.Reason==='';
        const normalFailure=normalCompletion && terminal.OperationOk===false &&
          stage.OperationOk===false && stage.ExitCode===2 && stage.Reason==='CHILD_FAILED';
        const operationDisposition=cancelRequested || stage?.CancellationRequested===true?'CANCELLED':
          operationProven?'SUCCEEDED':normalFailure?'FAILED':'UNPROVEN';
        const result=Object.freeze({ok:Boolean(operationProven),
          reason:bound?(cancelRequested?'FIXED_RUNTIME_OPERATION_CANCELLED':terminal.OperationOk===true && !operationProven?'FIXED_RUNTIME_OPERATION_EVIDENCE_UNPROVEN':terminal.Reason):'FIXED_RUNTIME_TERMINAL_CUSTODY_UNPROVEN',
          executionCustodyReleased:Boolean(bound),taskRootCreated:terminal?.TaskRootCreated===true,
          taskExecuted:Boolean(bound && terminal.TaskExecuted===true),stdout:stage?.Output??'',
          nativeReceipt:freezeTree(terminal)});
        if(bound) proof.set(result,Object.freeze({binding:Object.freeze({...binding}),
          completion:Object.freeze({executionCustodyReleased:true,operationDisposition})}));
        resolve(result);
      });
      child.stdin.write(raw+'\n'+qualified.sourceProof.raw+'\n');
    } catch {
      clearTimeout(timeout);clearInterval(resourceTimer);signal?.removeEventListener('abort',cancel);
      if(child){fail();try{child.kill();}catch{}}
      // Once the native helper launch was attempted, absence of a terminal is held.
      resolve(Object.freeze({ok:false,reason:'FIXED_RUNTIME_TRANSPORT_UNPROVEN',executionCustodyReleased:false}));
    }
  });
}
