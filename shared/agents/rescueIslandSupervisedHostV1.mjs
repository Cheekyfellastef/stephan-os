// #3109: real local adapters for the explicitly cooperative supervised pilot.
// Ordinary files and repeated observations are NOT hostile-writer containment.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireSharedWorkspaceOperationLock } from './executionReceiptV1.mjs';
import { getDefaultSharedWorkspaceRoot } from './sharedWorkspaceRuntimeConfig.mjs';
import { createRescueIslandSupervisedRunnerV1 } from './rescueIslandFirstCommitV1.mjs';
import { observeRescueIslandPhysicalScopesV1 } from './rescueIslandPhysicalScopeObservationV1.mjs';
import { parallelSeedBranchNameV1 } from '../runtime/seedCanopyParallelForgeV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { resolveBattleBridgeGitExecutable, battleBridgeGitFixedConfigArgs,
  createBattleBridgeMinimalChildEnvironment, inspectBattleBridgeGitTopology,
  validateBattleBridgeLocalGitConfiguration } from './battleBridgeExecutionBoundaryV1.mjs';

const PROFILE = 'SUPERVISED_COOPERATIVE_V1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const TASK = /^[a-z0-9][a-z0-9-]{7,63}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const folded = path => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (a,b) => folded(b) === folded(a) || folded(b).startsWith(folded(a)+sep);
function held(code) { throw Object.assign(new Error(code), { code }); }
async function present(path) {
  try { return await lstat(path); } catch (e) { if(e.code==='ENOENT')return null; throw e; }
}
async function physical(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || folded(await realpath(path)) !== folded(resolve(path)))
    held('ISLAND_HOST_REDIRECTED_ESTATE');
  return info;
}
async function json(path, optional = false) {
  const info = await present(path);
  if (!info && optional) return null;
  if (!info || !(await physical(path)).isFile() || info.size < 2 || info.size > 2*1024*1024)
    held('ISLAND_HOST_RECORD_UNREADABLE');
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch { held('ISLAND_HOST_RECORD_INVALID'); }
}
async function durable(path, value) {
  const file = await open(path,'wx');
  try { await file.writeFile(JSON.stringify(value)+'\n'); await file.sync(); }
  finally { await file.close(); }
}
function git(root, args, {localClone = false} = {}) {
  const result = spawnSync(resolveBattleBridgeGitExecutable(), [
    ...battleBridgeGitFixedConfigArgs(), '--no-optional-locks',
    ...(localClone ? ['-c','protocol.file.allow=always'] : []), '-C',root,...args,
  ], {shell:false,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,
    env:createBattleBridgeMinimalChildEnvironment(process.env,{git:true})});
  if(result.error || result.status!==0)held('ISLAND_HOST_GIT_READ_OR_SETUP_FAILED');
  return result.stdout;
}
async function directoryEntries(path, optional=false) {
  if(!await present(path)) { if(optional)return []; held('ISLAND_HOST_INVENTORY_MISSING'); }
  if(!(await physical(path)).isDirectory())held('ISLAND_HOST_INVENTORY_REDIRECTED');
  const entries=await readdir(path,{withFileTypes:true});
  if(entries.length>1024 || entries.some(e=>e.isSymbolicLink()))held('ISLAND_HOST_INVENTORY_INVALID');
  return entries.sort((a,b)=>a.name.localeCompare(b.name));
}
function sourcePaths(files) {
  if(!Array.isArray(files) || !files.length || files.length>128)held('ISLAND_HOST_CANONICAL_SCOPE_UNPROVEN');
  const paths = [...new Set(files.map(path=> {
    if(typeof path!=='string')held('ISLAND_HOST_CANONICAL_SCOPE_UNPROVEN');
    // The existing mission store permits a directory suffix, not arbitrary glob expansion.
    const clean=path.endsWith('/**')?path.slice(0,-3):path;
    if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,219}$/.test(clean)
      || clean.split('/').some(p=>!p || p==='.' || p==='..' || p.toLowerCase()==='.git'))
      held('ISLAND_HOST_CANONICAL_SCOPE_UNPROVEN');
    return clean;
  }))];
  return paths;
}
function claim(taskId, ownerIssueNumber, branch, worktree, targetPaths, extra={}) {
  if(typeof taskId!=='string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(taskId)
    || !Number.isSafeInteger(ownerIssueNumber) || ownerIssueNumber<1
    || typeof branch!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/.test(branch))
    held('ISLAND_HOST_CLAIM_IDENTITY_INVALID');
  return targetPaths.map(path=>({taskId,ownerIssueNumber,worktreeBranch:branch,
    worktreeIdentity:digest(folded(resolve(worktree))),targetPaths:[path],...extra}));
}

// Read existing canonical lease + original mission scopes. Never acquire,
// renew, expire, release or rewrite the original source lease, including R7.
export async function readIslandCanonicalClaimsV1({canonicalRoot,sharedWorkspaceRoot,missionRoot}) {
  const lease=await json(join(sharedWorkspaceRoot,'status','source-mutation-lease-current.json'),true);
  const states=[];
  for(const entry of await directoryEntries(missionRoot)) {
    if(!entry.name.endsWith('.state.json'))continue;
    if(!entry.isFile())held('ISLAND_HOST_MISSION_INVENTORY_INVALID');
    const mission=await json(join(missionRoot,entry.name));
    if(mission.schemaVersion!=='stephanos.mission-orchestrator.v1')held('ISLAND_HOST_MISSION_INVENTORY_INVALID');
    if(mission.repository!==REPOSITORY && mission.repository?.fullName!==REPOSITORY)continue;
    if(mission.activeWriter && mission.activeWriter!=='none'
      && !['COMPLETE','CANCELLED'].includes(mission.currentPhase))states.push(mission);
    if(lease?.laneId===mission.missionId && !states.includes(mission))states.push(mission);
  }
  if(lease && (lease.schema!=='stephanos.source-mutation-lease.v1'
    || lease.repository!==REPOSITORY || !SHA.test(lease.headSha||'')
    || !states.some(s=>s.missionId===lease.laneId && s.git?.branch===lease.branch
      && s.git?.commitSha===lease.headSha)))
    held('ISLAND_HOST_CANONICAL_LEASE_OWNER_AMBIGUOUS');
  const claims=[];
  for(const mission of states) {
    if(folded(resolve(mission.repositoryRoot||''))!==folded(resolve(canonicalRoot))
      || !mission.git?.worktreePath)held('ISLAND_HOST_CANONICAL_REPOSITORY_AMBIGUOUS');
    const issue=Number(/^critical-([1-9][0-9]*)-/.exec(mission.missionId)?.[1]);
    const scope=sourcePaths(mission.allowedFiles);
    claims.push(...claim(mission.missionId,issue,mission.git.branch,mission.git.worktreePath,scope));
  }
  return claims;
}

export async function readIslandSeedClaimsV1(seedRoot) {
  const claims=[],records=new Map();
  for(const estate of await directoryEntries(seedRoot,true)) {
    if(!estate.isDirectory() || !/^[a-f0-9]{12}$/.test(estate.name))held('ISLAND_HOST_SEED_ESTATE_AMBIGUOUS');
    const root=join(seedRoot,estate.name);
    for(const entry of await directoryEntries(join(root,'receipts'),true)) {
      if(!entry.name.endsWith('.claim'))continue;
      if(!entry.isFile())held('ISLAND_HOST_SEED_CLAIM_INVALID');
      const saved=await json(join(root,'receipts',entry.name));
      const taskId=entry.name.slice(0,-6);
      if(!SHA.test(saved.baseSha||'') || typeof saved.seedId!=='string')held('ISLAND_HOST_SEED_CLAIM_INVALID');
      let branch;
      try{branch=parallelSeedBranchNameV1({...saved,taskId});}catch{held('ISLAND_HOST_SEED_CLAIM_INVALID');}
      records.set(estate.name+':'+taskId,saved);
      claims.push(...claim(taskId,Number(/^#([1-9][0-9]*)$/.exec(saved.ownerIssue)?.[1]),
        branch,join(root,'worktrees',taskId),sourcePaths([saved.targetPath])));
    }
    // Target reservations survive interrupted receipt publication, too.
    for(const entry of await directoryEntries(join(root,'target-claims'),true)) {
      if(!entry.isFile() || !/^[a-f0-9]{64}\.claim$/.test(entry.name))held('ISLAND_HOST_SEED_TARGET_CLAIM_INVALID');
      const saved=await json(join(root,'target-claims',entry.name));
      const path=sourcePaths([saved.targetPath])[0];
      const owner=records.get(estate.name+':'+saved.taskId);
      if(!owner || owner.targetPath!==path || owner.baseSha!==saved.baseSha
        || owner.seedId!==saved.seedId || owner.ownerIssue!==saved.ownerIssue)
        held('ISLAND_HOST_ORPHAN_SEED_TARGET_CLAIM');
    }
  }
  return claims;
}

async function preservation(root, backupRoot) {
  const status=git(root,['status','--porcelain=v1','-z','--untracked-files=all']);
  const rows=[];
  for(const entry of status.split('\0').filter(Boolean)) {
    if(entry.length<4 || /[RC]/.test(entry.slice(0,2)))held('ISLAND_HOST_PRESERVATION_SCOPE_AMBIGUOUS');
    const relative=entry.slice(3), file=resolve(root,relative);
    if(!inside(root,file))held('ISLAND_HOST_PRESERVATION_ESCAPE');
    const info=await present(file);
    if(info && (!(await physical(file)).isFile() || info.size>16*1024*1024))
      held('ISLAND_HOST_PRESERVATION_UNPROVEN');
    const bytes=info?await readFile(file):null;
    const hash=bytes?digest(bytes):null;
    rows.push({path:relative,status:entry.slice(0,2),sha256:hash});
    if(backupRoot && bytes) {
      const destination=join(backupRoot,hash);
      if(!await present(destination)) {
        const f=await open(destination,'wx');
        try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
      }
      if(!(await physical(destination)).isFile())held('ISLAND_HOST_PRESERVATION_COPY_FAILED');
      if(digest(await readFile(destination))!==hash)held('ISLAND_HOST_PRESERVATION_COPY_FAILED');
    }
  }
  const head=git(root,['rev-parse','HEAD']).trim();
  const indexBytes=await readFile(join(root,'.git','index'));
  const index=digest(indexBytes);
  if(backupRoot && !await present(join(backupRoot,index))) {
    const file=await open(join(backupRoot,index),'wx');
    try{await file.writeFile(indexBytes);await file.sync();}finally{await file.close();}
  }
  if(backupRoot && digest(await readFile(join(backupRoot,index)))!==index)
    held('ISLAND_HOST_PRESERVATION_COPY_FAILED');
  return {head,index,rows,digest:digest(JSON.stringify([head,index,rows]))};
}

function nativePrincipal(nativeHostPath) {
  if(process.platform!=='win32')held('ISLAND_HOST_WINDOWS_REQUIRED');
  const result=spawnSync(nativeHostPath,['--inspect-principal'],{shell:false,windowsHide:true,
    encoding:'utf8',timeout:10000,maxBuffer:32768,env:createBattleBridgeMinimalChildEnvironment(process.env)});
  let facts;
  try{facts=JSON.parse(result.stdout);}catch{held('ISLAND_HOST_NATIVE_TOKEN_UNAVAILABLE');}
  const p=facts.principal;
  if(result.error || result.status!==3 || facts.schemaVersion!=='stephanos.rescue-island-host-observation.v1'
    || facts.processId!==result.pid || !p || p.elevated!==false || p.threadImpersonating!==false
    || p.elevationType==='Full' || !Array.isArray(p.assignedPrivileges)
    || (p.administratorsGroupPresent && !(p.administratorsGroupAttributes & 16)))
    held('ISLAND_HOST_NON_ADMINISTRATIVE_TOKEN_REQUIRED');
  return p;
}

// Trusted operator configuration, not request assertions. These inputs only
// ADD gaming signals in the canonical detector; they cannot disable built-ins.
// Do not pass executable, credential, preload or generic environment selectors.
export function rescueIslandGovernorEnvironmentV1(source=process.env) {
  const environment={...createBattleBridgeMinimalChildEnvironment(source)};
  for(const key of ['STEPHANOS_GAME_PROCESS_NAMES','STEPHANOS_GAME_LIBRARY_ROOTS']) {
    const value=source[key];
    if(value===undefined || value==='')continue;
    if(typeof value!=='string' || value.length>4096 || /[\x00-\x1f\x7f]/.test(value))
      held('ISLAND_HOST_GOVERNOR_CONFIGURATION_INVALID');
    const entries=value.split(key.endsWith('NAMES')?/[;,]/:/;/).map(v=>v.trim()).filter(Boolean);
    if(entries.length>64 || entries.some(v=>key.endsWith('NAMES')
      ? !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/.test(v)
      : !/^[A-Za-z]:\\/.test(v) || /[<>"|?*]/.test(v) || v.split(/[\\/]/).some(p=>p==='.'||p==='..')))
      held('ISLAND_HOST_GOVERNOR_CONFIGURATION_INVALID');
    environment[key]=value;
  }
  return environment;
}

async function fixedGovernorExecutable() {
  // Both are fixed machine locations. No PATH, cwd, environment override or
  // remote request can nominate an engine. Existing PS7 avoids the observed
  // service-token Windows PowerShell cold-start delay; PS5 remains supported.
  const modern='C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const selected=await present(modern)?modern:BATTLE_BRIDGE_WINDOWS_HOST.powershell;
  if(!(await physical(selected)).isFile())held('ISLAND_HOST_GOVERNOR_EXECUTABLE_INVALID');
  return selected;
}

async function refreshGamingAdmission(canonicalRoot,sharedWorkspaceRoot,sourceHead,executable) {
  const script='scripts/windows/run-vr-resource-governor.ps1';
  if(!(await physical(join(canonicalRoot,script))).isFile())held('ISLAND_HOST_GOVERNOR_SOURCE_CHANGED');
  const expectedBlob=git(canonicalRoot,['rev-parse',sourceHead+':'+script]).trim();
  const bytes=Buffer.from(git(canonicalRoot,['show',sourceHead+':'+script]),'utf8');
  const workingBytes=await readFile(join(canonicalRoot,script));
  // Git's ordinary Windows CRLF checkout is permitted, but is never executed
  // as an unauthenticated replacement. Materialise and execute the exact Git
  // blob below. No content filters or arbitrary command string are evaluated.
  if(!workingBytes.equals(bytes) && !Buffer.from(workingBytes.toString('utf8').replace(/\r\n/g,'\n'),'utf8').equals(bytes))
    held('ISLAND_HOST_GOVERNOR_SOURCE_CHANGED');
  const inputs=join(sharedWorkspaceRoot,'proof','rescue-island-01-inputs');
  await mkdir(inputs,{recursive:true});
  if(!(await physical(inputs)).isDirectory())held('ISLAND_HOST_GOVERNOR_SOURCE_CHANGED');
  const pinnedScript=join(inputs,'governor-'+expectedBlob+'.ps1');
  if(!await present(pinnedScript)) {
    const file=await open(pinnedScript,'wx');
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  }
  if(!(await physical(pinnedScript)).isFile() || !bytes.equals(await readFile(pinnedScript)))
    held('ISLAND_HOST_GOVERNOR_SOURCE_CHANGED');
  const started=Date.now();
  const observation=spawnSync(executable,
    ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',pinnedScript,'-Action','ObserveAdmission'],
    {cwd:canonicalRoot,shell:false,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:32768,
      env:rescueIslandGovernorEnvironmentV1(process.env)});
  if(observation.error || observation.status!==0)
    throw Object.assign(new Error('ISLAND_HOST_GOVERNOR_OBSERVATION_FAILED'),{
      code:'ISLAND_HOST_GOVERNOR_OBSERVATION_FAILED',cause:{
        durationMs:Date.now()-started,exitCode:observation.status,signal:observation.signal,
        errorCode:observation.error?.code||null,stderrTail:String(observation.stderr||'').slice(-2048)}});
  let facts;
  try{facts=JSON.parse(observation.stdout);}catch{held('ISLAND_HOST_GOVERNOR_OBSERVATION_FAILED');}
  // The existing watcher remains the only state/model writer. This exact-source
  // operation freshly reads its actual signals; it never fabricates a newer
  // transition timestamp or clears another owner's prepare evidence.
  return {started,facts,path:join(sharedWorkspaceRoot,'vr','vr-resource-governor-current.json')};
}

async function currentGamingAdmission(canonicalRoot,sharedWorkspaceRoot,sourceHead,executable) {
  const refreshed=await refreshGamingAdmission(canonicalRoot,sharedWorkspaceRoot,sourceHead,executable);
  const governor=await json(refreshed.path), observed=Date.parse(refreshed.facts.observedAtUtc);
  if(governor.schemaVersion!=='stephanos.vr-resource-governor.v1' || governor.active!==false
    || governor.phase!=='NORMAL' || governor.localModelAllowed!==true
    || refreshed.facts.schemaVersion!=='stephanos.gaming-resource-admission-observation.v1'
    || refreshed.facts.readOnly!==true || refreshed.facts.signalActive!==false || refreshed.facts.preparePending!==false
    || !['AUTO','FORCE_OFF'].includes(refreshed.facts.overrideMode)
    || !Number.isFinite(observed) || observed<refreshed.started-1000 || observed>Date.now()
    || Date.now()-observed>10000)held('ISLAND_HOST_GAMING_ADMISSION_REVOKED_OR_STALE');
  return observed;
}

/** Internal bootstrap configuration, never a remote request or authority flags. */
export function createRescueIslandSupervisedHostV1(configuration={}) {
  const canonicalRoot=resolve(configuration.canonicalRoot||fileURLToPath(new URL('../..',import.meta.url)));
  const sharedWorkspaceRoot=resolve(configuration.sharedWorkspaceRoot||getDefaultSharedWorkspaceRoot());
  const estate=join(sharedWorkspaceRoot,'worktrees','rescue-island-01');
  const roots=Object.freeze({canonicalRoot,repoRoot:join(estate,'repository'),
    worktreeRoot:join(estate,'worktrees'),receiptRoot:join(estate,'receipts')});
  const missionRoot=configuration.missionRoot||join(homedir(),'Documents','OpenClaw-Standalone','mission-runner','orchestrator');
  const seedRoot=configuration.seedRoot||join(homedir(),'.stephanos','seed-parallel');
  const nativeHostPath=configuration.nativeHostPath||join(canonicalRoot,'src','windows','Stephanos.RescueIslandHost',
    'bin','Release','net8.0-windows','Stephanos.RescueIslandHost.exe');
  let active=null, savedPreservation=null;
  async function admissionInventory() {
    const claimsRoot=join(roots.receiptRoot,'claims');
    const entries=await directoryEntries(claimsRoot,true),records=new Map();
    for(const entry of entries) {
      if(!entry.isFile() || !entry.name.endsWith('.json'))held('ISLAND_HOST_ISLAND_CLAIM_AMBIGUOUS');
      if(!entry.name.endsWith('.ADMITTED.json'))continue;
      const saved=await json(join(claimsRoot,entry.name));
      if(saved.schemaVersion!=='stephanos.rescue-island-supervised-admission.v1'
        || !TASK.test(saved.taskId||'') || saved.workerId!=='rescue-island-01'
        || ![3109,3096].includes(saved.ownerIssueNumber)
        || entry.name!==saved.taskId+'.ADMITTED.json' || JSON.stringify(saved.roots)!==JSON.stringify(roots)
        || saved.assuranceProfile!==PROFILE || !Number.isSafeInteger(saved.commentId) || saved.commentId<1
        || !HASH.test(saved.canonicalPreservationDigest||'')
        || !HASH.test(saved.taskFingerprint||'') || !SHA.test(saved.baseHead||''))
        held('ISLAND_HOST_ISLAND_CLAIM_INVALID');
      const targets=sourcePaths(saved.targetPaths || [saved.targetPath]);
      if(targets.length>6 || (saved.targetPaths && saved.taskKind!=='SOURCE_PROPOSAL_V1'))
        held('ISLAND_HOST_ISLAND_CLAIM_INVALID');
      records.set(saved.taskId,saved);
    }
    for(const entry of entries) {
      if(entry.name.endsWith('.ADMITTED.json'))continue;
      const match=/^([a-z0-9][a-z0-9-]{7,63})(?:\.(SELECTED|CLAIMED|BRANCH_RESERVED|PHYSICAL_PICKUP|EDITED|TESTED|ISOLATED_COMMIT|BLOCKED))?\.json$/.exec(entry.name);
      const saved=match && records.get(match[1]);
      if(!saved)held('ISLAND_HOST_UNRECONCILED_LEGACY_CLAIM');
      const proof=await json(join(claimsRoot,entry.name));
      if(match[2]) {
        if(proof.schemaVersion!=='stephanos.rescue-island-first-commit-receipt.v1'
          || proof.stage!==match[2] || proof.taskId!==saved.taskId || proof.workerId!==saved.workerId
          || proof.sourceHead!==saved.baseHead || proof.ownerCommentId!==saved.commentId
          || proof.taskFingerprint!==saved.taskFingerprint || proof.assuranceProfile!==PROFILE
          || proof.branch!=='rescue-island/pilot-'+saved.taskId)
          held('ISLAND_HOST_STAGE_IDENTITY_CHANGED');
      } else if(proof.taskId!==saved.taskId || proof.head!==saved.baseHead
        || proof.workerId!==saved.workerId || proof.fingerprint!==saved.taskFingerprint)
        held('ISLAND_HOST_CLAIM_IDENTITY_CHANGED');
    }
    return [...records.values()];
  }
  async function retainedCompletion(saved) {
    const claimsRoot=join(roots.receiptRoot,'claims');
    if(await present(join(claimsRoot,saved.taskId+'.BLOCKED.json')))return false;
    for(const suffix of ['json','SELECTED.json','CLAIMED.json','BRANCH_RESERVED.json','PHYSICAL_PICKUP.json','EDITED.json','TESTED.json','ISOLATED_COMMIT.json'])
      if(!await present(join(claimsRoot,saved.taskId+'.'+suffix)))return false;
    const committed=await json(join(claimsRoot,saved.taskId+'.ISOLATED_COMMIT.json'),true);
    const tested=await json(join(claimsRoot,saved.taskId+'.TESTED.json'),true);
    if(!committed || !tested)return false;
    const paths=sourcePaths(saved.targetPaths || [saved.targetPath]);
    for(const receipt of [committed,tested]) if(receipt.taskId!==saved.taskId
      || receipt.workerId!==saved.workerId || receipt.sourceHead!==saved.baseHead
      || receipt.assuranceProfile!==PROFILE || receipt.branch!=='rescue-island/pilot-'+saved.taskId)return false;
    if(!SHA.test(committed.commitHead||'') || committed.exactParentHead!==saved.baseHead
      || committed.ownerCommentId!==saved.commentId || committed.taskFingerprint!==saved.taskFingerprint
      || tested.ownerCommentId!==saved.commentId || tested.taskFingerprint!==saved.taskFingerprint
      || tested.testExitCode!==0 || !HASH.test(tested.testResultHash||'')
      || tested.testOutputFile!==saved.taskId+'.'+tested.testResultHash+'.log')return false;
    if(git(roots.repoRoot,['show','-s','--format=%P',committed.commitHead]).trim()!==saved.baseHead
      || git(roots.repoRoot,['diff-tree','--no-commit-id','--name-only','-r',committed.commitHead]).trim()!==[...paths].sort().join('\n'))return false;
    for(const path of paths)if(git(roots.repoRoot,['rev-parse',committed.commitHead+':'+path]).trim()
      !==(committed.sourceBlobs?.[path] || (path===saved.targetPath?committed.sourceBlob:null)))return false;
    return digest(await readFile(join(roots.receiptRoot,'test-output',tested.testOutputFile)))===tested.testResultHash;
  }
  const host={
    async withExistingOwnerAdmission(expected,operation) {
      if(active)held('ISLAND_HOST_EXISTING_OWNER_BUSY');
      if(expected.assuranceProfile!==PROFILE || !TASK.test(expected.taskId||'')
        || !HASH.test(expected.taskFingerprint||'') || !SHA.test(expected.baseHead||''))
        held('ISLAND_HOST_OWNER_IDENTITY_INVALID');
      // Reuse Shared Workspace's identity-checked cross-process exclusion;
      // the original engine remains the sole durable task-claim mechanism.
      const lock=await acquireSharedWorkspaceOperationLock(sharedWorkspaceRoot,
        ['receipt-locks','rescue-island-01.lock'],{repoRoot:canonicalRoot,
          operationLockTimeoutMs:1,operationStaleLockMs:86400000});
      if(!lock.ok)held('ISLAND_HOST_EXISTING_OWNER_BUSY');
      active={expected,lock,admitted:false}; savedPreservation=null;
      try{return await operation();}
      finally{active=null;savedPreservation=null;await lock.release();}
    },
    async observeSupervisedAdmission(expected) {
      if(!active || !(await active.lock.verifyOwnership())
        || Object.keys(active.expected).some(key=>active.expected[key]!==expected[key]))
        held('ISLAND_HOST_OWNER_ADMISSION_CHANGED');
      nativePrincipal(nativeHostPath);
      if(!(await physical(canonicalRoot)).isDirectory() || !inspectBattleBridgeGitTopology(canonicalRoot).ok
        || git(canonicalRoot,['rev-parse','HEAD']).trim()!==expected.baseHead
        || git(canonicalRoot,['rev-parse','origin/main']).trim()!==expected.baseHead)
        held('ISLAND_HOST_CANONICAL_SOURCE_CHANGED');
      const governorExecutable=await fixedGovernorExecutable();
      if(active.governorExecutable && active.governorExecutable!==governorExecutable)
        held('ISLAND_HOST_GOVERNOR_EXECUTABLE_CHANGED');
      active.governorExecutable=governorExecutable;
      let observed=await currentGamingAdmission(canonicalRoot,sharedWorkspaceRoot,expected.baseHead,governorExecutable);
      const canonicalClaims=await readIslandCanonicalClaimsV1({canonicalRoot,sharedWorkspaceRoot,missionRoot});
      const seedClaims=await readIslandSeedClaimsV1(seedRoot);
      const targets=expected.targetPaths || [expected.targetPath];
      if(targets.length<1 || targets.length>6 || targets.some(p=>typeof p!=='string'))held('ISLAND_HOST_SOURCE_SCOPE_INVALID');
      const sourceScope=[...new Map([...targets,...canonicalClaims.flatMap(c=>c.targetPaths),
        ...seedClaims.flatMap(c=>c.targetPaths)].map(p=>[p.toLowerCase(),p])).values()];
      for(let start=0;start<sourceScope.length;start+=64) {
        const scan=await observeRescueIslandPhysicalScopesV1({repositoryRoot:canonicalRoot,paths:sourceScope.slice(start,start+64)});
        if(!scan.ok)held('ISLAND_HOST_PHYSICAL_SOURCE_SCOPE_UNPROVEN');
      }
      const conflict=path=>{
        const a=path.toLowerCase();
        return targets.some(target=>{const b=target.toLowerCase();return a===b || a.startsWith(b+'/') || b.startsWith(a+'/');});
      };
      if([...canonicalClaims,...seedClaims].some(c=>c.taskId===expected.taskId
        || (!expected.targetPaths && c.ownerIssueNumber===3109) || c.targetPaths.some(conflict)))held('ISLAND_HOST_COMPETING_SOURCE_OWNER');
      // Minimum independent estate setup happens only AFTER authenticated
      // GitHub intake (the runner invokes this first observer afterward).
      const marker=join(roots.receiptRoot,'estate.json');
      if(!await present(estate)) {
        await mkdir(estate); // Non-recursive, exclusive; partial setup is retained.
        await mkdir(roots.worktreeRoot);await mkdir(roots.receiptRoot);
        git(canonicalRoot,['clone','--no-hardlinks','--no-checkout','--template=','--',canonicalRoot,roots.repoRoot],{localClone:true});
        git(roots.repoRoot,['remote','set-url','origin','https://github.com/Cheekyfellastef/stephan-os.git']);
        git(roots.repoRoot,['checkout','--detach',expected.baseHead]);
        await durable(marker,{schemaVersion:'stephanos.rescue-island-estate.v1',ownerIssueNumber:3109,
          workerId:'rescue-island-01',roots,assuranceProfile:PROFILE});
      }
      const estateRecord=await json(marker);
      if(estateRecord.schemaVersion!=='stephanos.rescue-island-estate.v1'
        || estateRecord.ownerIssueNumber!==3109 || estateRecord.workerId!=='rescue-island-01'
        || JSON.stringify(estateRecord.roots)!==JSON.stringify(roots))held('ISLAND_HOST_ESTATE_NOT_ADMITTED');
      const identities=[];
      for(const path of [...Object.values(roots),join(canonicalRoot,'.git'),join(roots.repoRoot,'.git')]) {
        const info=await physical(path);
        if(!info.isDirectory())held('ISLAND_HOST_ESTATE_CHANGED');
        identities.push([path,info.dev,info.ino]);
      }
      const identity=JSON.stringify(identities);
      if(active.identity && active.identity!==identity)held('ISLAND_HOST_ESTATE_IDENTITY_CHANGED');
      active.identity=identity;
      if(!inspectBattleBridgeGitTopology(roots.repoRoot).ok
        || !validateBattleBridgeLocalGitConfiguration(git(roots.repoRoot,['config','--local','--null','--list'])).ok
        || git(roots.repoRoot,['status','--porcelain']).trim()
        || git(roots.repoRoot,['rev-parse','--abbrev-ref','HEAD']).trim()!=='HEAD')held('ISLAND_HOST_INDEPENDENT_REPOSITORY_CHANGED');
      const previousAdmissions=await admissionInventory();
      for(const saved of previousAdmissions) {
        // Failed, partial or unexplained state is retained, never auto-recovered.
        if(!active.admitted && (saved.taskId===expected.taskId
          || !expected.targetPaths || !await retainedCompletion(saved)))
          held('ISLAND_HOST_RETAINED_ADMISSION_REQUIRES_RECONCILIATION');
      }
      const priorHead=git(roots.repoRoot,['rev-parse','HEAD']).trim();
      const priorRemote=git(roots.repoRoot,['rev-parse','origin/main']).trim();
      if(priorHead!==expected.baseHead || priorRemote!==expected.baseHead) {
        if(active.admitted || !expected.targetPaths || priorHead!==priorRemote
          || !previousAdmissions.some(saved=>saved.baseHead===priorHead))
          held('ISLAND_HOST_INDEPENDENT_REPOSITORY_CHANGED');
        // Keep all task branches/worktrees/claims. Only the clean detached
        // repository base advances under the existing whole-operation guard.
        git(roots.repoRoot,['fetch','--no-tags','--no-write-fetch-head','--',canonicalRoot,expected.baseHead],{localClone:true});
        git(roots.repoRoot,['update-ref','refs/remotes/origin/main',expected.baseHead,priorRemote]);
        git(roots.repoRoot,['checkout','--detach',expected.baseHead]);
      }
      const claimsRoot=join(roots.receiptRoot,'claims');await mkdir(claimsRoot,{recursive:true});
      const preservationRoot=join(roots.receiptRoot,'preservation');await mkdir(preservationRoot,{recursive:true});
      for(const path of [claimsRoot,preservationRoot])
        if(!(await physical(path)).isDirectory())held('ISLAND_HOST_REDIRECTED_ESTATE');
      const current=await preservation(canonicalRoot,active.admitted?null:preservationRoot);
      if(savedPreservation && savedPreservation.digest!==current.digest)held('ISLAND_HOST_CANONICAL_PRESERVATION_CHANGED');
      if(!savedPreservation) {
        savedPreservation=current;
        await durable(join(preservationRoot,expected.taskId+'.json'),current);
      }
      const admittedPath=join(claimsRoot,expected.taskId+'.ADMITTED.json');
      if(!active.admitted) {
        // An admission receipt in the ORIGINAL claim estate, not a second
        // lease. Retain it on failure and require explicit reconciliation.
        await durable(admittedPath,{schemaVersion:'stephanos.rescue-island-supervised-admission.v1',
          ...active.expected,workerId:'rescue-island-01',ownerIssueNumber:expected.ownerIssueNumber || 3109,roots,
          canonicalPreservationDigest:current.digest});
        active.admitted=true;
      }
      const islandClaims=[];
      for(const saved of await admissionInventory()) {
        if(saved.taskId===expected.taskId && (saved.taskFingerprint!==expected.taskFingerprint
          || saved.commentId!==expected.commentId || saved.baseHead!==expected.baseHead
          || saved.targetPath!==expected.targetPath || JSON.stringify(saved.roots)!==JSON.stringify(roots)
          || saved.canonicalPreservationDigest!==current.digest
          || saved.ownerIssueNumber!==(expected.ownerIssueNumber || 3109)
          || JSON.stringify(saved.targetPaths || [saved.targetPath])!==JSON.stringify(targets)))
          held('ISLAND_HOST_ADMISSION_RECEIPT_CHANGED');
        const savedTargets=sourcePaths(saved.targetPaths || [saved.targetPath]);
        if(saved.taskId!==expected.taskId && savedTargets.some(conflict))held('ISLAND_HOST_COMPETING_SOURCE_OWNER');
        const row=claim(saved.taskId,saved.ownerIssueNumber,'rescue-island/pilot-'+saved.taskId,
          join(roots.worktreeRoot,saved.taskId),savedTargets,{workerId:'rescue-island-01'})[0];
        islandClaims.push({...row,targetPaths:savedTargets});
      }
      if(!(await active.lock.verifyOwnership()))held('ISLAND_HOST_OWNER_ADMISSION_CHANGED');
      // Cloning/preservation can take longer than one observation's budget.
      // Refresh through the SAME governor again before returning admission.
      if(Date.now()-observed>1000)
        observed=await currentGamingAdmission(canonicalRoot,sharedWorkspaceRoot,expected.baseHead,governorExecutable);
      return {schemaVersion:'stephanos.rescue-island-supervised-host-observation.v1',
        assuranceProfile:PROFILE,repository:REPOSITORY,...active.expected,workerId:'rescue-island-01',
        sourceHead:expected.baseHead,sourceBranch:'rescue-island/pilot-'+expected.taskId,
        observedAtUtc:new Date().toISOString(),nonAdministrativeProcess:true,runnerResourceMode:'CPU_ONLY',
        gamingState:'IDLE_FRESH_VERIFIED',resourceGrantExpiresAtUtc:new Date(observed+10000).toISOString(),
        resourceAdmissionSource:'EXISTING_GAMING_GOVERNOR_COOPERATIVE_ADMISSION',existingOwnerAdmissionHeld:true,
        canonicalCheckoutPreserved:true,canonicalPreservationDigest:current.digest,
        worktreeIdentity:digest(folded(join(roots.worktreeRoot,expected.taskId))),roots,
        claimInventoriesComplete:true,canonicalClaims,seedClaims,islandClaims};
    },
  };
  return Object.freeze({run:createRescueIslandSupervisedRunnerV1(host),host,roots});
}
