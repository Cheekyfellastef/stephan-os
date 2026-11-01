// Real Windows token observer, operation locks, claim readers, preservation,
// independent clone, Node tests and Git commit. GitHub and the platform signal
// collector in the canonical governor script are explicit fixture doubles.
import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,stat,rm,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRescueIslandSupervisedHostV1,readIslandCanonicalClaimsV1,readIslandSeedClaimsV1,
  rescueIslandGovernorEnvironmentV1} from './rescueIslandSupervisedHostV1.mjs';
import {resolveBattleBridgeGitExecutable,battleBridgeGitFixedConfigArgs,
  createBattleBridgeMinimalChildEnvironment} from './battleBridgeExecutionBoundaryV1.mjs';

const sourceSmoke=process.env.STEPHANOS_ISLAND_SOURCE_HOST_SMOKE;
if(sourceSmoke!==undefined && sourceSmoke!=='1')throw Error('SOURCE_SMOKE_FLAG_INVALID');
const smokeNames=new Set(['real adapters hold one owner through actual clone, preservation, Node tests and exact-parent commit',
  'real cross-process primitive excludes a second host, retaining exact task admission',
  'fresh read-only governor admission preserves idle transition bytes and timestamp']);
let smokeRegistered=0;
const test=(name,fn)=>{if(sourceSmoke==='1' && !smokeNames.has(name))return;
  if(sourceSmoke==='1')smokeRegistered++;return nodeTest(name,fn);};
const source=dirname(fileURLToPath(import.meta.url));
const repo=join(source,'../..');
const nativeHostPath=join(repo,'src/windows/Stephanos.RescueIslandHost/bin/Release/net8.0-windows/Stephanos.RescueIslandHost.exe');
const hash=x=>createHash('sha256').update(x).digest('hex');
const fields=['schemaVersion','repository','issueNumber','issueTitle','taskId','workerId','baseHead',
  'targetPath','content','testPath','approvalSource','expiresAtUtc'];
function git(cwd,args) {
  const r=spawnSync(resolveBattleBridgeGitExecutable(),[...battleBridgeGitFixedConfigArgs(),'-C',cwd,...args],
    {encoding:'utf8',shell:false,windowsHide:true,timeout:30000,
      env:createBattleBridgeMinimalChildEnvironment(process.env,{git:true})});
  assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
async function save(path,value){await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value));}
async function fixture(t,{realFlatSignal=false,sourceTask=false,sourceBaseline=false,sourcePatch=false,sourceNative=false,worker02=false}={}) {
  if(worker02){const first=await fixture(t);await first.run(first.request);return secondLaneFixture(first);}
  assert.equal(process.platform,'win32','This suite requires the real native Windows token observer.');
  await stat(nativeHostPath); // No skip or fabricated principal if the host was not built.
  const root=await realpath(await mkdtemp(join(tmpdir(),'island-real-adapters-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const canonicalRoot=join(root,'canonical'),sharedWorkspaceRoot=join(root,'shared');
  const missionRoot=join(root,'missions'),seedRoot=join(root,'seed');
  await mkdir(join(canonicalRoot,'shared/agents'),{recursive:true});
  await mkdir(join(sharedWorkspaceRoot,'worktrees'),{recursive:true});await mkdir(missionRoot);
  for(const name of ['rescueIslandPreflightV1.mjs','rescueIslandPreflightV1.test.mjs'])
    await writeFile(join(canonicalRoot,'shared/agents',name),await readFile(join(source,name)));
  await mkdir(join(canonicalRoot,'scripts/windows'),{recursive:true});
  const governorFile=join(sharedWorkspaceRoot,'vr/vr-resource-governor-current.json').replaceAll("'","''");
  const canonical=await readFile(join(repo,'scripts/windows/run-vr-resource-governor.ps1'),'utf8');
  const actionStart=canonical.indexOf("if ($Action -eq 'ObserveAdmission') {"),
    actionEnd=canonical.indexOf("if ($Action -eq 'SetAuto') {",actionStart);
  assert.ok(actionStart>0&&actionEnd>actionStart);
  const admissionAction=canonical.slice(actionStart,actionEnd);
  let detector='';
  if(realFlatSignal) {
    const start=canonical.indexOf('function Get-FlatGameSignal {'),end=canonical.indexOf('function Get-GamingSignal {',start);
    assert.ok(start>0&&end>start);
    // Real canonical signal-resolution code, isolated from reconciliation and
    // all live platform/model operations. Only the process inventory is doubled.
    detector=canonical.slice(start,end)+
      "\nfunction Get-Process { [pscustomobject]@{ProcessName='IslandCustomGame';Path='Q:\\Custom Library\\title\\game.exe';MainWindowHandle=1;Id=123} }\n"+
      "function Get-ParentProcessInfo { param([int]$ProcessId) [pscustomobject]@{processId=0;processName='';executablePath=''} }\n"+
      "function Test-WindowsGamePresenceActive { $false }\n";
  }
  await writeFile(join(canonicalRoot,'scripts/windows/run-vr-resource-governor.ps1'),
    "param([ValidateSet('ObserveAdmission')][string]$Action)\n$ErrorActionPreference='Stop'\n"+
    detector+
    "$path='"+governorFile+"'\n$state=[IO.File]::ReadAllText($path)|ConvertFrom-Json\n"+
    "$preparePath='"+join(sharedWorkspaceRoot,'vr/gaming-resource-prepare.json').replaceAll("'","''")+"'\n"+
    "function Read-OverrideMode { 'AUTO' }\n"+
    (realFlatSignal?"function Get-GamingSignal { Get-FlatGameSignal }\n":
      "function Get-GamingSignal { [pscustomobject]@{active=[bool]$state.active} }\n")+
    admissionAction);
  if(sourceTask || sourceBaseline || sourceNative) {
    for(const name of ['rescueIslandSourceTaskV1.mjs','rescueIslandSourceTaskV1.test.mjs',
      'rescueIslandSupervisedRunV1.test.mjs','rescueIslandFirstCommitV1.mjs',
      'rescueIslandAuthenticatedGithubReadV1.mjs','rescueIslandPilotOwnerIntakeV1.mjs',
      'battleBridgeWindowsHosts.mjs','rescueIslandNativeTestProvisionV1.mjs'])
      await writeFile(join(canonicalRoot,'shared/agents',name),await readFile(join(source,name)));
  }
  if(sourceNative){
    await writeFile(join(canonicalRoot,'.gitignore'),'src/windows/**/bin/\n');
    await writeFile(join(canonicalRoot,'shared/agents/rescueIslandSupervisedHostV1.mjs'),'export const fixtureHostVersion = 1;\n');
  }
  if(sourcePatch) await writeFile(join(canonicalRoot,'shared/agents/rescueIslandSecondLaneV1.mjs'),
    '// '+('actual large Windows baseline '.repeat(500))+'\nexport const lane = 1;\n');
  // Git is launched with guarded core.autocrlf=true on the real Windows test
  // runner. Track only the isolated JavaScript source/test dependencies as
  // byte-preserved blobs, so their raw worktree bytes match the committed
  // source identity checked by the production recovery guard. Never relax it.
  const bytePreservedFixturePaths=[
    'rescueIslandPreflightV1.mjs','rescueIslandPreflightV1.test.mjs',
    'rescueIslandSourceTaskV1.mjs','rescueIslandSourceTaskV1.test.mjs',
    'rescueIslandSupervisedRunV1.test.mjs','rescueIslandFirstCommitV1.mjs',
    'rescueIslandAuthenticatedGithubReadV1.mjs','rescueIslandPilotOwnerIntakeV1.mjs',
    'battleBridgeWindowsHosts.mjs','rescueIslandNativeTestProvisionV1.mjs',
    'rescueIslandSupervisedHostV1.mjs','rescueIslandSupervisedHostV1.windows.mjs',
    'rescueIslandSecondLaneV1.mjs',
  ];
  await writeFile(join(canonicalRoot,'.gitattributes'),
    bytePreservedFixturePaths.map(name=>'shared/agents/'+name+' -text').join('\n')+'\n');
  git(canonicalRoot,['init','-b','main']);git(canonicalRoot,['add','.']);
  git(canonicalRoot,['-c','user.name=Adapter Fixture','-c','user.email=fixture@example.invalid','commit','-m','Adapter fixture baseline']);
  git(canonicalRoot,['remote','add','origin','https://github.com/Cheekyfellastef/stephan-os.git']);
  const baseHead=git(canonicalRoot,['rev-parse','HEAD']);
  git(canonicalRoot,['update-ref','refs/remotes/origin/main',baseHead]);
  await writeFile(join(canonicalRoot,'preserve-dirty.txt'),'Original operator bytes\n');
  const task={schemaVersion:'stephanos.rescue-island-pilot-task.v1',repository:'Cheekyfellastef/stephan-os',
    issueNumber:3109,issueTitle:'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
    taskId:'real-adapter-3109',workerId:'rescue-island-01',baseHead,
    targetPath:'docs/architecture/rescue-island-pilot-real-adapter-3109.md',
    content:'# Rescue Island pilot\nTest-only validation of the real production adapters.\n',
    testPath:'shared/agents/rescueIslandPreflightV1.test.mjs',approvalSource:'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
    expiresAtUtc:new Date(Date.now()+300000).toISOString()};
  if(sourceTask) Object.assign(task,sourceTaskFields(task));
  if(sourceNative) Object.assign(task,sourceNativeFields(task,canonicalRoot));
  if(sourcePatch){
    const manifest=JSON.parse(task.content),before=await readFile(join(canonicalRoot,task.targetPath),'utf8');
    manifest.changes[0]={path:task.targetPath,beforeBlob:git(canonicalRoot,['rev-parse','HEAD:'+task.targetPath]),
      afterSha256:hash(before.replace('export const lane = 1;','export const lane = 2;')),
      edits:[{before:'export const lane = 1;',after:'export const lane = 2;'}]};
    task.content=JSON.stringify(manifest);
  }
  const expected={commentId:6380000001,taskId:task.taskId,taskFingerprint:hash(JSON.stringify(fields.map(k=>task[k]))),
    baseHead,targetPath:task.targetPath,assuranceProfile:'SUPERVISED_COOPERATIVE_V1',workerId:task.workerId,ownerIssueNumber:task.issueNumber,
    ...(sourceTask || sourceNative?{targetPaths:JSON.parse(task.content).changes.map(w=>w.path),ownerIssueNumber:task.issueNumber,taskKind:'SOURCE_PROPOSAL_V1',needsNativeObserver:sourceNative}:{})};
  const config={canonicalRoot,sharedWorkspaceRoot,missionRoot,seedRoot,nativeHostPath,...(worker02?{workerId:'rescue-island-02'}:{})};
  const host=createRescueIslandSupervisedHostV1(config);
  const governor={schemaVersion:'stephanos.vr-resource-governor.v1',active:false,phase:'NORMAL',
    localModelAllowed:true,updatedAtUtc:new Date().toISOString()};
  await save(join(sharedWorkspaceRoot,'vr/vr-resource-governor-current.json'),governor);
  // Copy the runner byte-for-byte with REAL boundary/preflight modules. Only
  // its four fixed GitHub reads have a deterministic test transport.
  const harness=join(root,'harness');await mkdir(harness);
  for(const name of ['rescueIslandFirstCommitV1.mjs','rescueIslandAuthenticatedGithubReadV1.mjs',
    'rescueIslandPilotOwnerIntakeV1.mjs', 'rescueIslandSourceTaskV1.mjs', 'rescueIslandNativeTestProvisionV1.mjs','rescueIslandPreflightV1.mjs',
    'battleBridgeExecutionBoundaryV1.mjs','battleBridgeWindowsHosts.mjs'])
    await writeFile(join(harness,name),await readFile(join(source,name)));
  const now=new Date().toISOString(),issueUrl='https://api.github.com/repos/'+task.repository+'/issues/'+task.issueNumber;
  const facts={issue:{number:task.issueNumber,title:task.issueTitle,state:'open',url:issueUrl},
    main:{ref:'refs/heads/main',object:{sha:baseHead}},comment:{id:expected.commentId,
      url:'https://api.github.com/repos/'+task.repository+'/issues/comments/'+expected.commentId,issue_url:issueUrl,
      user:{login:'Cheekyfellastef',type:'User',id:267490109},author_association:'OWNER',
      created_at:now,updated_at:now,body:'/'+task.workerId+' '+(sourceTask || sourceNative?'supervised-source-cooperative':'supervised-cooperative')+' '+baseHead+' '+task.taskId+' '+hash(task.content)}};
  const factsFile=join(root,'github-facts.json');await save(factsFile,facts);
  await writeFile(join(harness,'githubObservationBrokerV1.mjs'),
    'import {readFileSync,writeFileSync} from "node:fs"; export function readBrokeredGithubJson(s){const facts=JSON.parse(readFileSync('+JSON.stringify(factsFile)+',"utf8"));writeFileSync('+JSON.stringify(join(root,'broker-call.json'))+',JSON.stringify(s));return {ok:true,source:"UPSTREAM_REFRESH",ageMs:0,payload:s.endpoint.includes("comments")?facts.comment:s.endpoint.includes("git/ref")?facts.main:facts.issue};}\n');
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(harness,'rescueIslandFirstCommitV1.mjs')));
  return {root,task,expected,config,host,governor,factsFile,
    run:createRescueIslandSupervisedRunnerV1(host.host),request:{commentId:expected.commentId,task}};
}


async function secondLaneFixture(first){
  const task={...first.task,workerId:'rescue-island-02',issueNumber:3103,
    issueTitle:'Rescue Island: two independent proof-gated builders outside Goal Conveyor',
    taskId:'real-adapter-3103-02',targetPath:'docs/architecture/rescue-island-pilot-real-adapter-3103-02.md',
    expiresAtUtc:new Date(Date.now()+300000).toISOString()};
  const expected={...first.expected,commentId:first.expected.commentId+1,taskId:task.taskId,
    workerId:task.workerId,ownerIssueNumber:task.issueNumber,targetPath:task.targetPath,
    taskFingerprint:hash(JSON.stringify(fields.map(k=>task[k])))};
  const facts=JSON.parse(await readFile(first.factsFile,'utf8')),now=new Date().toISOString();
  facts.issue={...facts.issue,number:3103,title:task.issueTitle,url:facts.issue.url.replace('/3109','/3103')};
  facts.comment={...facts.comment,id:expected.commentId,url:'https://api.github.com/repos/'+task.repository+'/issues/comments/'+expected.commentId,
    issue_url:facts.issue.url,created_at:now,updated_at:now,
    body:'/rescue-island-02 supervised-cooperative '+task.baseHead+' '+task.taskId+' '+hash(task.content)};
  await save(first.factsFile,facts);
  const config={...first.config,workerId:'rescue-island-02'},host=createRescueIslandSupervisedHostV1(config);
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(first.root,'harness/rescueIslandFirstCommitV1.mjs')));
  return {...first,task,expected,config,host,firstLane:first,request:{commentId:expected.commentId,task},run:createRescueIslandSupervisedRunnerV1(host.host)};
}

test('real adapters hold one owner through actual clone, preservation, Node tests and exact-parent commit',async t=>{
  const f=await fixture(t),result=await f.run(f.request);
  assert.equal(result.ok,true);assert.equal(result.parent,f.task.baseHead);
  assert.equal(result.assuranceProfile,'SUPERVISED_COOPERATIVE_V1');
  assert.equal(result.hostileWriterContainmentProven,false);
  assert.equal(await readFile(join(f.config.canonicalRoot,'preserve-dirty.txt'),'utf8'),'Original operator bytes\n');
  assert.equal(git(f.config.canonicalRoot,['rev-parse','HEAD']),f.task.baseHead);
  const worktree=join(f.host.roots.worktreeRoot,f.task.taskId);
  assert.equal(git(worktree,['show','HEAD:'+f.task.targetPath]),f.task.content.trim());
  assert.equal(git(worktree,['rev-parse','HEAD^']),f.task.baseHead);
  assert.equal(git(worktree,['diff-tree','--no-commit-id','--name-only','-r','HEAD']),f.task.targetPath);
  assert.equal(git(worktree,['status','--porcelain']),'');
  const preserved=JSON.parse(await readFile(join(f.host.roots.receiptRoot,'preservation',f.task.taskId+'.json')));
  const row=preserved.rows.find(r=>r.path==='preserve-dirty.txt');
  assert.equal(await readFile(join(f.host.roots.receiptRoot,'preservation',row.sha256),'utf8'),'Original operator bytes\n');
  assert.ok(result.receipts.some(r=>r.stage==='TESTED'&&/^[a-f0-9]{64}$/.test(r.testResultHash)));
  const tested=result.receipts.find(r=>r.stage==='TESTED');
  const testOutput=await readFile(join(f.host.roots.receiptRoot,'test-output',tested.testOutputFile));
  assert.equal(hash(testOutput),tested.testResultHash);assert.equal(tested.testExitCode,0);
  await assert.rejects(f.run(f.request)); // Preserved prior admission/claim, never automatic retry.
  t.diagnostic('REAL_ADAPTER_TEST_ONLY_COMMIT='+result.head+';LIVE_PROGRAMME_BUILD=false');
});
test('real cross-process primitive excludes a second host, retaining exact task admission',async t=>{
  const f=await fixture(t),other=createRescueIslandSupervisedHostV1(f.config);
  await f.host.host.withExistingOwnerAdmission(f.expected,async()=>{
    await assert.rejects(other.host.withExistingOwnerAdmission(f.expected,async()=>assert.fail('competing owner ran')),/BUSY/);
    const wrong={...f.expected,taskFingerprint:'0'.repeat(64),stage:'BEFORE_PREPARATION'};
    await assert.rejects(f.host.host.observeSupervisedAdmission(wrong),/OWNER_ADMISSION_CHANGED/);
  });
});
test('fixed native ingress reaches real runner validation without accepting authority or paths',async t=>{
  await stat(nativeHostPath);
  const result=spawnSync(nativeHostPath,['--supervised-once'],{input:JSON.stringify({commentId:1234,task:{}}),
    encoding:'utf8',shell:false,windowsHide:true,timeout:15000,
    env:{...process.env,NODE_OPTIONS:'--require C:\\untrusted-fixture-preload.cjs',
      STEPHANOS_GH_COMMAND:'C:\\untrusted-fixture-gh.exe',GH_HOST:'untrusted.invalid',PATH:'UNTRUSTED_FIXTURE_OVERRIDE'}});
  assert.equal(result.status,3,result.stderr);
  const facts=JSON.parse(result.stdout);
  assert.equal(facts.blocker,'RESCUE_ISLAND_SUPERVISED_TASK_NOT_PLAIN');
  assert.equal(facts.assuranceProfile,'SUPERVISED_COOPERATIVE_V1');
});
test('GitHub approval reader ignores inherited executable, host and credential selectors',async t=>{
  const f=await fixture(t);
  const keys=['STEPHANOS_GH_COMMAND','GH_HOST','GH_TOKEN','NODE_OPTIONS','PATH'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];});
  for(const key of keys)process.env[key]='UNTRUSTED_FIXTURE_OVERRIDE';
  await f.run(f.request);
  const observed=JSON.parse(await readFile(join(f.root,'broker-call.json'),'utf8'));
  assert.equal(observed.ghCommand,'C:\\Program Files\\GitHub CLI\\gh.exe');
  for(const key of keys.filter(k=>k!=='PATH'))assert.equal(observed.childEnv[key],undefined);
  assert.notEqual(observed.childEnv.PATH,'UNTRUSTED_FIXTURE_OVERRIDE');
});
test('fresh read-only governor admission preserves idle transition bytes and timestamp',async t=>{
  const f=await fixture(t);
  await save(join(f.config.sharedWorkspaceRoot,'vr/vr-resource-governor-current.json'),{
    ...f.governor,updatedAtUtc:'2000-01-01T00:00:00Z'});
  const file=join(f.config.sharedWorkspaceRoot,'vr/vr-resource-governor-current.json'),before=await readFile(file);
  const result=await f.run(f.request);assert.equal(result.ok,true);
  assert.deepEqual(await readFile(file),before);
});

test('read-only canonical admission retains pending or expired prepare evidence',async t=>{
  const f=await fixture(t),file=join(f.config.sharedWorkspaceRoot,'vr/gaming-resource-prepare.json');
  const retained='{"active":true,"expiresAtUtc":"2000-01-01T00:00:00Z"}';
  await writeFile(file,retained);
  await assert.rejects(f.run(f.request),/GAMING_ADMISSION_REVOKED_OR_STALE/);
  assert.equal(await readFile(file,'utf8'),retained);
});

test('canonical custom game-name and library detection revoke real adapter admission',async t=>{
  const names='STEPHANOS_GAME_PROCESS_NAMES',roots='STEPHANOS_GAME_LIBRARY_ROOTS';
  const oldNames=process.env[names],oldRoots=process.env[roots];
  t.after(()=>{for(const [key,value] of [[names,oldNames],[roots,oldRoots]])
    if(value===undefined)delete process.env[key];else process.env[key]=value;});
  for(const [key,value] of [[names,'IslandCustomGame'],[roots,'Q:\\Custom Library']]) {
    delete process.env[names];delete process.env[roots];process.env[key]=value;
    const f=await fixture(t,{realFlatSignal:true});
    await assert.rejects(f.run(f.request),/GAMING_ADMISSION_REVOKED_OR_STALE/);
    assert.equal(git(f.config.canonicalRoot,['rev-parse','HEAD']),f.task.baseHead);
    assert.equal(await readFile(join(f.config.canonicalRoot,'preserve-dirty.txt'),'utf8'),'Original operator bytes\n');
  }
});

test('governor detector settings are bounded data and do not restore executable selectors',()=>{
  const env=rescueIslandGovernorEnvironmentV1({...process.env,STEPHANOS_GAME_PROCESS_NAMES:'Custom Game;Title_2',
    STEPHANOS_GAME_LIBRARY_ROOTS:'Q:\\Custom Library',STEPHANOS_GH_COMMAND:'untrusted.exe',NODE_OPTIONS:'--require untrusted'});
  assert.equal(env.STEPHANOS_GAME_PROCESS_NAMES,'Custom Game;Title_2');
  assert.equal(env.STEPHANOS_GAME_LIBRARY_ROOTS,'Q:\\Custom Library');
  assert.equal(env.STEPHANOS_GH_COMMAND,undefined);assert.equal(env.NODE_OPTIONS,undefined);
  for(const [key,value] of [['STEPHANOS_GAME_PROCESS_NAMES','*'],['STEPHANOS_GAME_LIBRARY_ROOTS','relative\\path'],
    ['STEPHANOS_GAME_LIBRARY_ROOTS','Q:\\safe\\..\\escape'],['STEPHANOS_GAME_PROCESS_NAMES','bad\nname']])
    assert.throws(()=>rescueIslandGovernorEnvironmentV1({[key]:value}),/GOVERNOR_CONFIGURATION_INVALID/);
});
test('changed governor source is rejected before that script executes',async t=>{
  const f=await fixture(t),path=join(f.config.canonicalRoot,'scripts/windows/run-vr-resource-governor.ps1');
  await writeFile(path,'throw "UNTRUSTED GOVERNOR"\n');
  await assert.rejects(f.run(f.request),/GOVERNOR_SOURCE_CHANGED/);
});
test('Windows CRLF checkout executes only the preserved exact governor Git blob',async t=>{
  const f=await fixture(t),script=join(f.config.canonicalRoot,'scripts/windows/run-vr-resource-governor.ps1');
  const approved=await readFile(script,'utf8');
  // The fixture incorporates a real checked-out PowerShell action which may
  // already contain CRLF on the Windows runner. Canonicalise to LF first so
  // this test exercises *ordinary* CRLF, never accidental CR-CR-LF bytes.
  const withWindowsNewlines=approved.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n');
  // Independently read the exact committed Git blob as raw bytes. Comparing
  // against the earlier mixed-EOL worktree would mistake valid normalization
  // for a source-integrity failure after the correct fixed source executes.
  const approvedBlob=git(f.config.canonicalRoot,['rev-parse',f.task.baseHead+':scripts/windows/run-vr-resource-governor.ps1']);
  const committed=spawnSync(resolveBattleBridgeGitExecutable(),
    [...battleBridgeGitFixedConfigArgs(),'-C',f.config.canonicalRoot,'cat-file','blob',approvedBlob],
    {encoding:null,shell:false,windowsHide:true,timeout:30000,
      env:createBattleBridgeMinimalChildEnvironment(process.env,{git:true})});
  assert.equal(committed.status,0,String(committed.stderr||''));
  assert.ok(Buffer.isBuffer(committed.stdout));
  assert.doesNotMatch(withWindowsNewlines,/\r\r\n/);
  await writeFile(script,withWindowsNewlines);
  assert.notDeepEqual(await readFile(script),committed.stdout,
    'test must exercise ordinary CRLF worktree bytes distinct from the Git blob');
  await f.host.host.withExistingOwnerAdmission(f.expected,async()=>{
    await f.host.host.observeSupervisedAdmission({...f.expected,stage:'BEFORE_PREPARATION'});
  });
  const inputs=join(f.config.sharedWorkspaceRoot,'proof/rescue-island-01-inputs');
  const files=await readdir(inputs);assert.equal(files.length,1);
  assert.deepEqual(await readFile(join(inputs,files[0])),committed.stdout,
    'only the exact independently read HEAD blob may be materialized for execution');
});
test('replacing a physical estate root between observations is held',async t=>{
  const f=await fixture(t);
  await f.host.host.withExistingOwnerAdmission(f.expected,async()=>{
    await f.host.host.observeSupervisedAdmission({...f.expected,stage:'BEFORE_PREPARATION'});
    await rename(f.host.roots.worktreeRoot,f.host.roots.worktreeRoot+'.preserved');
    await mkdir(f.host.roots.worktreeRoot);
    await assert.rejects(f.host.host.observeSupervisedAdmission({...f.expected,stage:'BEFORE_CLAIM'}),/ESTATE_IDENTITY_CHANGED/);
  });
});
test('actual canonical lease uses original mission allowedFiles and remains byte-identical',async t=>{
  const f=await fixture(t);
  const lease={schema:'stephanos.source-mutation-lease.v1',repository:f.task.repository,laneId:'critical-2962-elastic-goal',
    headSha:'a'.repeat(40),branch:'openclaw/elastic-goal-2962'};
  const path=join(f.config.sharedWorkspaceRoot,'status/source-mutation-lease-current.json');await save(path,lease);
  await save(join(f.config.missionRoot,lease.laneId+'.state.json'),{schemaVersion:'stephanos.mission-orchestrator.v1',repository:f.task.repository,missionId:lease.laneId,
    repositoryRoot:f.config.canonicalRoot,currentPhase:'REPAIR_REQUIRED',activeWriter:'foundry-forge',
    allowedFiles:['scripts/publisher.mjs','scripts/publisher.mjs/**'],
    git:{branch:lease.branch,commitSha:lease.headSha,worktreePath:join(f.root,'original-r7-worktree')}});
  const before=await readFile(path);
  const claims=await readIslandCanonicalClaimsV1(f.config);
  assert.equal(claims.length,1);assert.deepEqual(claims[0].targetPaths,['scripts/publisher.mjs']);
  await f.run(f.request);assert.deepEqual(await readFile(path),before);
});
test('unknown canonical lease owner and malformed scope fail closed',async t=>{
  const f=await fixture(t);
  await save(join(f.config.sharedWorkspaceRoot,'status/source-mutation-lease-current.json'),
    {schema:'stephanos.source-mutation-lease.v1',repository:f.task.repository,laneId:'unobserved',headSha:'a'.repeat(40),branch:'original'});
  await assert.rejects(f.run(f.request),/CANONICAL_LEASE_OWNER_AMBIGUOUS/);
  assert.deepEqual(await readdir(join(f.config.sharedWorkspaceRoot,'worktrees')),[]);
});
test('existing non-elastic canonical mission ownership is retained from its exact issue identity',async t=>{
  const f=await fixture(t);
  await save(join(f.config.missionRoot,'critical-1291-worker-watchdog-repair.state.json'),{
    schemaVersion:'stephanos.mission-orchestrator.v1',repository:f.task.repository,
    missionId:'critical-1291-worker-watchdog-repair',repositoryRoot:f.config.canonicalRoot,
    currentPhase:'AGENT_IMPLEMENTATION',activeWriter:'Codex',allowedFiles:['scripts/watchdog.mjs'],
    git:{branch:'openclaw/critical-1291-worker-watchdog-repair',worktreePath:join(f.root,'old-canonical-worktree')}});
  const claims=await readIslandCanonicalClaimsV1(f.config);
  assert.equal(claims[0].ownerIssueNumber,1291);assert.deepEqual(claims[0].targetPaths,['scripts/watchdog.mjs']);
});
test('actual Seed task and orphan target claims are inventoried without clearing either',async t=>{
  const f=await fixture(t),root=join(f.config.seedRoot,'a'.repeat(12));
  const saved={seedId:'seed-one',ownerIssue:'#1234',baseSha:f.task.baseHead,targetPath:f.task.targetPath};
  await save(join(root,'receipts/seed-task.claim'),saved);
  const claims=await readIslandSeedClaimsV1(f.config.seedRoot);assert.equal(claims.length,1);
  assert.equal(claims[0].worktreeBranch,'seed-parallel/seed-one/seed-task');
  await assert.rejects(f.run(f.request),/COMPETING_SOURCE_OWNER/);
  await save(join(root,'target-claims',hash('other')+'.claim'),{taskId:'orphan-task',targetPath:'docs/other.md'});
  await assert.rejects(readIslandSeedClaimsV1(f.config.seedRoot),/ORPHAN_SEED_TARGET_CLAIM/);
});
for(const stage of ['BEFORE_CLAIM','BEFORE_TEST','BEFORE_COMMIT'])test('real governor revocation at '+stage+' prevents a commit',async t=>{
  const f=await fixture(t),original=f.host.host.observeSupervisedAdmission;
  f.host.host.observeSupervisedAdmission=async e=>{
    if(e.stage===stage)await save(join(f.config.sharedWorkspaceRoot,'vr/vr-resource-governor-current.json'),{...f.governor,active:true});
    return original(e);
  };
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')));
  await assert.rejects(createRescueIslandSupervisedRunnerV1(f.host.host)(f.request),/GAMING_ADMISSION_REVOKED_OR_STALE/);
  if(stage!=='BEFORE_CLAIM') {
    const stages=await readdir(join(f.host.roots.receiptRoot,'claims'));
    assert.ok(stages.includes(f.task.taskId+'.BLOCKED.json'));assert.ok(!stages.includes(f.task.taskId+'.ISOLATED_COMMIT.json'));
  }
});
test('real preservation detects changed bytes between observations and keeps the original copy',async t=>{
  const f=await fixture(t);
  await f.host.host.withExistingOwnerAdmission(f.expected,async()=>{
    await f.host.host.observeSupervisedAdmission({...f.expected,stage:'BEFORE_PREPARATION'});
    await writeFile(join(f.config.canonicalRoot,'preserve-dirty.txt'),'Unexplained replacement\n');
    await assert.rejects(f.host.host.observeSupervisedAdmission({...f.expected,stage:'BEFORE_CLAIM'}),/PRESERVATION_CHANGED/);
    assert.equal(await readFile(join(f.host.roots.receiptRoot,'preservation',hash('Original operator bytes\n')),'utf8'),'Original operator bytes\n');
  });
});
test('interrupted terminal receipt publication retains commit, admission and failed-run evidence',async t=>{
  const f=await fixture(t),original=f.host.host.observeSupervisedAdmission;
  f.host.host.observeSupervisedAdmission=async e=>{
    const value=await original(e);
    if(e.stage==='BEFORE_COMMIT')await writeFile(join(f.host.roots.receiptRoot,'claims',f.task.taskId+'.ISOLATED_COMMIT.json'),'interrupted incumbent');
    return value;
  };
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')));
  await assert.rejects(createRescueIslandSupervisedRunnerV1(f.host.host)(f.request),/EEXIST/);
  const worktree=join(f.host.roots.worktreeRoot,f.task.taskId);
  assert.notEqual(git(worktree,['rev-parse','HEAD']),f.task.baseHead);
  assert.equal(await readFile(join(f.host.roots.receiptRoot,'claims',f.task.taskId+'.ISOLATED_COMMIT.json'),'utf8'),'interrupted incumbent');
  const entries=await readdir(join(f.host.roots.receiptRoot,'claims'));
  assert.ok(entries.includes(f.task.taskId+'.BLOCKED.json'));assert.ok(entries.includes(f.task.taskId+'.json'));
  await assert.rejects(f.run(f.request));
});


function sourceTaskFields(task){
  return {schemaVersion:'stephanos.rescue-island-source-task.v1',
    targetPath:'shared/agents/rescueIslandSecondLaneV1.mjs',
    content:JSON.stringify({scopeId:'ISLAND_BUILDERS_V1',changes:[
      {path:'shared/agents/rescueIslandSecondLaneV1.mjs',beforeBlob:null,content:'export const lane = 2;\n'},
      {path:'shared/agents/rescueIslandSecondLaneV1.test.mjs',beforeBlob:null,
        content:"import test from 'node:test'; import assert from 'node:assert/strict'; import {lane} from './rescueIslandSecondLaneV1.mjs'; test('real adapter candidate code',()=>assert.equal(lane,2));\n"},
    ]})};
}
async function sourceFollowup(f,taskId='source-followup-3109'){
  const task={...f.task,...sourceTaskFields(f.task),taskId,
    expiresAtUtc:new Date(Date.now()+600000).toISOString()};
  const id=f.expected.commentId+1,now=new Date().toISOString();
  const facts=JSON.parse(await readFile(f.factsFile));
  facts.comment={...facts.comment,id,url:'https://api.github.com/repos/'+task.repository+'/issues/comments/'+id,
    created_at:now,updated_at:now,body:'/rescue-island-01 supervised-source-cooperative '+task.baseHead+' '+task.taskId+' '+hash(task.content)};
  facts.main.object.sha=task.baseHead;
  await save(f.factsFile,facts);
  return {commentId:id,task};
}

test('real Windows source path writes two approved files, runs actual candidate tests and commits exact scope',async t=>{
  const f=await fixture(t,{sourceTask:true,sourcePatch:true}),result=await f.run(f.request);
  assert.equal(result.ok,true);assert.equal(result.taskKind,'SOURCE_PROPOSAL_V1');
  assert.equal(result.parent,f.task.baseHead);assert.equal(result.changedPaths.length,2);
  const actual=await readFile(join(f.host.roots.worktreeRoot,f.task.taskId,f.task.targetPath));
  assert.ok(actual.length>8192);assert.equal(hash(actual),JSON.parse(f.task.content).changes[0].afterSha256);
  const wt=join(f.host.roots.worktreeRoot,f.task.taskId);
  assert.equal(git(wt,['status','--porcelain']),'');
  const tested=result.receipts.find(r=>r.stage==='TESTED');
  const output=await readFile(join(f.host.roots.receiptRoot,'test-output',tested.testOutputFile),'utf8');
  assert.match(output,/real adapter candidate code/);assert.equal(hash(output),tested.testResultHash);
  assert.equal(await readFile(join(f.config.canonicalRoot,'preserve-dirty.txt'),'utf8'),'Original operator bytes\n');
  t.diagnostic('REAL_WINDOWS_SOURCE_FIXTURE_COMMIT='+result.head+';LIVE_PROGRAMME_BUILD=false');
});

test('real host admits a new disjoint source task only after reading actual retained commit and passing-test proof',async t=>{
  const f=await fixture(t,{sourceBaseline:true}),first=await f.run(f.request);
  const next=await sourceFollowup(f);
  const result=await f.run(next);assert.equal(result.ok,true);
  assert.notEqual(result.head,first.head);assert.equal(result.parent,f.task.baseHead);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
  assert.ok((await readdir(join(f.host.roots.receiptRoot,'claims'))).includes(f.task.taskId+'.ISOLATED_COMMIT.json'));
  await assert.rejects(f.run(next),/RECONCILIATION/);
});

test('a changed retained commit receipt blocks the next real source admission and preserves the original worktree',async t=>{
  const f=await fixture(t,{sourceBaseline:true}),first=await f.run(f.request);
  const path=join(f.host.roots.receiptRoot,'claims',f.task.taskId+'.ISOLATED_COMMIT.json');
  const receipt=JSON.parse(await readFile(path));receipt.exactParentHead='0'.repeat(40);await save(path,receipt);
  const next=await sourceFollowup(f);
  await assert.rejects(f.run(next),/RECONCILIATION/);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
  await assert.rejects(readFile(join(f.host.roots.receiptRoot,'claims',next.task.taskId+'.ADMITTED.json')),/ENOENT/);
});


test('unexplained retained raw-claim mutation blocks the next task before any new admission',async t=>{
  const f=await fixture(t,{sourceBaseline:true}),first=await f.run(f.request);
  const path=join(f.host.roots.receiptRoot,'claims',f.task.taskId+'.json');
  const claim=JSON.parse(await readFile(path));claim.fingerprint='0'.repeat(64);await save(path,claim);
  const next=await sourceFollowup(f);
  await assert.rejects(f.run(next),/CLAIM_IDENTITY_CHANGED/);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
  await assert.rejects(readFile(join(f.host.roots.receiptRoot,'claims',next.task.taskId+'.ADMITTED.json')),/ENOENT/);
});


test('a clean but unexplained independent-repository commit is retained instead of overwritten by source-base advance',async t=>{
  const f=await fixture(t,{sourceBaseline:true}),first=await f.run(f.request),root=f.host.roots.repoRoot;
  await writeFile(join(root,'unexplained-source.txt'),'retain this independent source\n');
  git(root,['add','--','unexplained-source.txt']);
  git(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Unexplained independent fixture work']);
  const unexplained=git(root,['rev-parse','HEAD']),next=await sourceFollowup(f);
  await assert.rejects(f.run(next),/INDEPENDENT_REPOSITORY_CHANGED/);
  assert.equal(git(root,['rev-parse','HEAD']),unexplained);
  assert.equal(await readFile(join(root,'unexplained-source.txt'),'utf8'),'retain this independent source\n');
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
});

test('existing owner guard advances only the known clean detached base while preserving completed task history',async t=>{
  const f=await fixture(t,{sourceBaseline:true}),first=await f.run(f.request);
  const oldBase=f.task.baseHead,root=f.config.canonicalRoot;
  await writeFile(join(root,'legitimate-main.txt'),'disjoint fixture main movement\n');
  git(root,['add','--','legitimate-main.txt']);
  git(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Disjoint fixture main movement']);
  const newBase=git(root,['rev-parse','HEAD']);git(root,['update-ref','refs/remotes/origin/main',newBase,oldBase]);
  const task={...f.task,...sourceTaskFields(f.task),taskId:'source-known-base-advance',baseHead:newBase,
    expiresAtUtc:new Date(Date.now()+600000).toISOString()};
  const expected={commentId:f.expected.commentId+1,taskId:task.taskId,
    taskFingerprint:hash(JSON.stringify(fields.map(k=>task[k]))),baseHead:newBase,
    targetPath:task.targetPath,targetPaths:JSON.parse(task.content).changes.map(w=>w.path),
    ownerIssueNumber:3109,taskKind:'SOURCE_PROPOSAL_V1',assuranceProfile:'SUPERVISED_COOPERATIVE_V1'};
  await f.host.host.withExistingOwnerAdmission(expected,async()=>{
    const observation=await f.host.host.observeSupervisedAdmission({...expected,stage:'BEFORE_PREPARATION'});
    assert.equal(observation.sourceHead,newBase);
  });
  assert.equal(git(f.host.roots.repoRoot,['rev-parse','HEAD']),newBase);
  assert.equal(git(f.host.roots.repoRoot,['rev-parse','origin/main']),newBase);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
  assert.equal(await readFile(join(root,'preserve-dirty.txt'),'utf8'),'Original operator bytes\n');
  t.diagnostic('ADAPTER_BASE_ADVANCE_TEST_ONLY=true;LIVE_PROGRAMME_BUILD=false');
});


function sourceNativeFields(task,canonicalRoot){
  const code='shared/agents/rescueIslandSupervisedHostV1.mjs';
  const suite='shared/agents/rescueIslandSupervisedHostV1.windows.mjs';
  const nativeTest=[
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import {spawnSync} from 'node:child_process';",
    "import {readFileSync} from 'node:fs';",
    "import {fixtureHostVersion} from './rescueIslandSupervisedHostV1.mjs';",
    "import {fileURLToPath} from 'node:url';",
    "test('candidate host source uses a provisioned real native observer',()=>{",
    " assert.equal(fixtureHostVersion,2); assert.equal(process.env.STEPHANOS_ISLAND_SOURCE_HOST_SMOKE,'1');",
    " const path=fileURLToPath(new URL('../../src/windows/Stephanos.RescueIslandHost/bin/Release/net8.0-windows/Stephanos.RescueIslandHost.exe',import.meta.url));",
    " assert.ok(readFileSync(path).length>100);",
    " const r=spawnSync(path,['--inspect-principal'],{encoding:'utf8',shell:false,windowsHide:true,timeout:10000});",
    " assert.equal(r.status,3,r.stderr);const facts=JSON.parse(r.stdout);",
    " assert.equal(facts.processId,r.pid);assert.equal(facts.principal.elevated,false);assert.equal(facts.principal.threadImpersonating,false);",
    "});",
  ].join('\n')+'\n';
  return {schemaVersion:'stephanos.rescue-island-source-task.v1',targetPath:code,
    content:JSON.stringify({scopeId:'ISLAND_BUILDERS_V1',changes:[
      {path:code,beforeBlob:git(canonicalRoot,['rev-parse','HEAD:'+code]),content:'export const fixtureHostVersion = 2;\n'},
      {path:suite,beforeBlob:null,content:nativeTest},
    ]})};
}
test('source host plan provisions the observed real native binary before its fixed Windows smoke test',async t=>{
  const f=await fixture(t,{sourceNative:true}),result=await f.run(f.request);
  const tested=result.receipts.find(r=>r.stage==='TESTED');
  assert.equal(tested.testProfile,'NODE_AND_OBSERVED_NATIVE_HOST_SMOKE_V1');
  assert.equal(tested.nativeTestProvision.fullWindowsQualification,false);
  assert.equal(tested.nativeTestProvision.operatingSystemChanged,false);
  const log=await readFile(join(f.host.roots.receiptRoot,'test-output',tested.testOutputFile),'utf8');
  assert.match(log,/candidate host source uses a provisioned real native observer/);
  assert.equal(hash(log),tested.testResultHash);assert.equal(result.changedPaths.length,2);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['status','--porcelain']),'');
  t.diagnostic('NATIVE_PROVISION_SOURCE_FIXTURE='+result.head+';LIVE_PROGRAMME_BUILD=false;FULL_WINDOWS_QUALIFICATION=false');
});
if(sourceSmoke==='1'){
  nodeTest('source host smoke registers every required real adapter check',()=>assert.equal(smokeRegistered,smokeNames.size));
  console.log('SOURCE_HOST_SMOKE_ONLY=true;FULL_WINDOWS_QUALIFICATION=false');
}

// Disposable qualification of actual adapters, never a live second-lane claim.
test('worker02 real adapters build in their own estate with exact parent and retained proof',async t=>{
  const f=await fixture(t,{worker02:true}),result=await f.run(f.request);
  assert.equal(result.workerId,'rescue-island-02');assert.equal(result.parent,f.task.baseHead);
  assert.ok(f.host.roots.repoRoot.includes('rescue-island-02'));
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['show','HEAD:'+f.task.targetPath]),f.task.content.trim());
  assert.notEqual(f.host.roots.repoRoot,f.firstLane.host.roots.repoRoot);
  assert.equal(git(f.firstLane.host.roots.repoRoot,['status','--porcelain']),'');
  assert.equal(await readFile(join(f.config.canonicalRoot,'preserve-dirty.txt'),'utf8'),'Original operator bytes\n');
  assert.ok(result.receipts.some(r=>r.stage==='TESTED'&&r.testExitCode===0));
  const retained=await f.host.host.withExistingOwnerAdmission(f.expected,
    ()=>f.host.host.observeRetainedSupervisedCompletion(f.expected,hash(f.task.content)));
  assert.equal(retained.commitHead,result.head);assert.equal(retained.sourceHead,f.task.baseHead);
  assert.equal(retained.contentSha256,hash(f.task.content));
  assert.deepEqual(retained.stages,['SELECTED','CLAIMED','BRANCH_RESERVED','PHYSICAL_PICKUP',
    'EDITED','TESTED','ISOLATED_COMMIT']);
  const marker=join(f.root,'retained-filter-executed.txt');
  git(f.host.roots.repoRoot,['config','filter.retained-proof.clean',
    'cmd.exe /d /c echo unsafe>'+marker]);
  await mkdir(join(f.host.roots.repoRoot,'.git/info'),{recursive:true});
  await writeFile(join(f.host.roots.repoRoot,'.git/info/attributes'),'* filter=retained-proof\n');
  const target=join(f.host.roots.worktreeRoot,f.task.taskId,f.task.targetPath);
  await writeFile(target,await readFile(target));
  await assert.rejects(f.host.host.withExistingOwnerAdmission(f.expected,
    ()=>f.host.host.observeRetainedSupervisedCompletion(f.expected,hash(f.task.content))),
  error=>error?.code==='ISLAND_HOST_RETAINED_REPOSITORY_CONFIGURATION_CHANGED');
  await assert.rejects(stat(marker),error=>error?.code==='ENOENT');
});
test('the original operation lock excludes simultaneous cooperative lanes',async t=>{
  const f=await fixture(t,{worker02:true}),other=createRescueIslandSupervisedHostV1({...f.config,workerId:'rescue-island-01'});
  await other.host.withExistingOwnerAdmission({...f.expected,workerId:'rescue-island-01',ownerIssueNumber:3109},async()=>{
    await assert.rejects(f.run(f.request),/BUSY/);
  });
  await assert.rejects(stat(join(f.host.roots.receiptRoot,'claims')),/ENOENT/);
});
test('unknown peer estate and cross-worker host selection hold before creating worker02 estate',async t=>{
  const f=await fixture(t,{worker02:true});
  const wrong=createRescueIslandSupervisedHostV1({...f.config,workerId:'rescue-island-01'});
  await assert.rejects(wrong.host.withExistingOwnerAdmission(f.expected,()=>assert.fail('wrong worker ran')),/OWNER_IDENTITY_INVALID/);
  await save(join(f.firstLane.host.roots.receiptRoot,'estate.json'),{unknown:'retained fixture mutation'});
  await assert.rejects(f.run(f.request),/PEER_ESTATE_NOT_ADMITTED/);
  await assert.rejects(stat(f.host.roots.repoRoot),/ENOENT/);
});

test('actual retained Island01 claims block worker02 without rewriting the first lane proof',async t=>{
  const f=await fixture(t),first=await f.run(f.request);
  const claimPath=join(f.host.roots.receiptRoot,'claims',f.task.taskId+'.ISOLATED_COMMIT.json');
  const before=await readFile(claimPath),task={...f.task,workerId:'rescue-island-02',issueNumber:3103,
    issueTitle:'Rescue Island: two independent proof-gated builders outside Goal Conveyor'};
  const facts=JSON.parse(await readFile(f.factsFile,'utf8'));
  facts.issue={...facts.issue,number:3103,title:task.issueTitle,url:facts.issue.url.replace('/3109','/3103')};
  facts.comment={...facts.comment,issue_url:facts.issue.url,body:facts.comment.body.replace('/rescue-island-01','/rescue-island-02')};
  await save(f.factsFile,facts);
  const second=createRescueIslandSupervisedHostV1({...f.config,workerId:'rescue-island-02'});
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')));
  await assert.rejects(createRescueIslandSupervisedRunnerV1(second.host)({commentId:f.expected.commentId,task}),/COMPETING_SOURCE_OWNER/);
  assert.deepEqual(await readFile(claimPath),before);assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),first.head);
  await assert.rejects(stat(second.roots.repoRoot),/ENOENT/);
});
test('worker02 gaming revocation retains admission and actual edit without a commit',async t=>{
  const f=await fixture(t,{worker02:true}),observe=f.host.host.observeSupervisedAdmission;
  f.host.host.observeSupervisedAdmission=async expected=>{
    if(expected.stage==='BEFORE_TEST')await save(join(f.config.sharedWorkspaceRoot,'vr/vr-resource-governor-current.json'),{...f.governor,active:true});
    return observe(expected);
  };
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')));
  await assert.rejects(createRescueIslandSupervisedRunnerV1(f.host.host)(f.request),/GAMING_ADMISSION_REVOKED_OR_STALE/);
  const entries=await readdir(join(f.host.roots.receiptRoot,'claims'));
  assert.ok(entries.includes(f.task.taskId+'.ADMITTED.json'));assert.ok(entries.includes(f.task.taskId+'.EDITED.json'));
  assert.ok(!entries.includes(f.task.taskId+'.ISOLATED_COMMIT.json'));
});

test('worker02 requires actual first-lane commit and passing-test artifacts before estate setup',async t=>{
  const first=await fixture(t),second=await secondLaneFixture(first);
  await assert.rejects(second.run(second.request),/FIRST_WORKER_MATERIAL_PROOF_REQUIRED/);
  await assert.rejects(stat(second.host.roots.repoRoot),/ENOENT/);
});

test('peer physical estate replacement between observations holds worker02 and retains the original directory',async t=>{
  const f=await fixture(t,{worker02:true}),observe=f.host.host.observeSupervisedAdmission;
  const path=f.firstLane.host.roots.worktreeRoot,moved=path+'.preserved';
  assert.ok((await realpath(path)).toLowerCase().startsWith((await realpath(f.root)).toLowerCase()+'\\'));
  assert.ok(moved.toLowerCase().startsWith(f.root.toLowerCase()+'\\'));
  f.host.host.observeSupervisedAdmission=async expected=>{
    if(expected.stage==='BEFORE_TEST'){await rename(path,moved);await mkdir(path);}
    return observe(expected);
  };
  const {createRescueIslandSupervisedRunnerV1}=await import(pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')));
  await assert.rejects(createRescueIslandSupervisedRunnerV1(f.host.host)(f.request),/PEER_ESTATE_IDENTITY_CHANGED/);
  assert.ok((await stat(moved)).isDirectory());
  const claims=await readdir(join(f.host.roots.receiptRoot,'claims'));
  assert.ok(!claims.includes(f.task.taskId+'.ISOLATED_COMMIT.json'));
});

test('default narrow host dispatch executes worker02 through the real adapters and rejects extra request authority',async t=>{
  const f=await fixture(t,{worker02:true});
  // Exact host body; only imports are rebound to absolute dependencies so the
  // existing explicit GitHub test transport can feed the real guarded runner.
  const sourceUrl=new URL('./rescueIslandSupervisedHostV1.mjs',import.meta.url);
  const moduleText=(await readFile(sourceUrl,'utf8')).replace(/from (['"])(\.[^'"]+)\1/g,(_all,_quote,spec)=>{
    const url=spec==='./rescueIslandFirstCommitV1.mjs'
      ?pathToFileURL(join(f.root,'harness/rescueIslandFirstCommitV1.mjs')).href:new URL(spec,sourceUrl).href;
    return 'from '+JSON.stringify(url);
  });
  const module=await import('data:text/javascript;base64,'+Buffer.from(moduleText).toString('base64'));
  const {workerId,...configuration}=f.config;
  const host=module.createRescueIslandSupervisedHostV1(configuration);
  await assert.rejects(host.run({...f.request,repoRoot:f.root}),/SUPERVISED_REQUEST_INVALID/);
  const result=await host.run(f.request);
  assert.equal(result.workerId,'rescue-island-02');assert.equal(result.parent,f.task.baseHead);
  assert.equal(git(join(f.host.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),result.head);
  for(const receipt of result.receipts){
    assert.equal(receipt.executionOwnerIssueNumber,3103);
    assert.equal(receipt.taskOwnerIssueNumber,3103);
    assert.equal(receipt.resourceScheduling,'CPU_ONLY_SERIAL_EXISTING_OWNER_LOCK');
    assert.equal(receipt.hostileWriterContainmentProven,false);
  }
});

for(const mutation of ['worktree','test-log','unchanged'])test('Island01 revalidates completed Island02 peer '+mutation+' before source admission',async t=>{
  const second=await fixture(t,{worker02:true}),result=await second.run(second.request),first=second.firstLane;
  const tested=result.receipts.find(r=>r.stage==='TESTED'),logPath=join(second.host.roots.receiptRoot,'test-output',tested.testOutputFile);
  const peerFile=join(second.host.roots.worktreeRoot,second.task.taskId,second.task.targetPath);
  if(mutation==='worktree')await writeFile(peerFile,'unexplained peer source mutation');
  if(mutation==='test-log')await writeFile(logPath,'unexplained peer test evidence mutation');
  const task={...first.task,...sourceTaskFields(first.task),taskId:'source-peer-'+mutation+'-01',expiresAtUtc:new Date(Date.now()+300000).toISOString()};
  const expected={...first.expected,commentId:first.expected.commentId+2,taskId:task.taskId,
    taskFingerprint:hash(JSON.stringify(fields.map(k=>task[k]))),targetPath:task.targetPath,
    targetPaths:JSON.parse(task.content).changes.map(c=>c.path),taskKind:'SOURCE_PROPOSAL_V1',needsNativeObserver:false};
  await first.host.host.withExistingOwnerAdmission(expected,async()=>{
    const observe=()=>first.host.host.observeSupervisedAdmission({...expected,stage:'BEFORE_PREPARATION'});
    if(mutation==='unchanged')assert.equal((await observe()).workerId,'rescue-island-01');
    else await assert.rejects(observe(),/RETAINED_WORKTREE_CHANGED|PEER_RETAINED_PROOF_UNPROVEN/);
  });
  if(mutation!=='unchanged')await assert.rejects(stat(join(first.host.roots.receiptRoot,'claims',task.taskId+'.ADMITTED.json')),/ENOENT/);
  if(mutation==='worktree')assert.equal(await readFile(peerFile,'utf8'),'unexplained peer source mutation');
  if(mutation==='test-log')assert.equal(await readFile(logPath,'utf8'),'unexplained peer test evidence mutation');
});
