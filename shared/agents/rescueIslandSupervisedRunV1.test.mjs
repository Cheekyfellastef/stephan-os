// Disposable POSIX integration tests. Git, worktrees, file edits, Node tests and
// commits are real; GitHub and installed-host admission are explicit doubles.
// No result here is Battle Bridge pickup, independent review or commissioning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { lstatSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = dirname(fileURLToPath(import.meta.url));
const REPO = 'Cheekyfellastef/stephan-os';
const ISSUE_TITLE = 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)';
const hash = value => createHash('sha256').update(value).digest('hex');
const fields = ['schemaVersion','repository','issueNumber','issueTitle','taskId',
  'workerId','baseHead','targetPath','content','testPath','approvalSource','expiresAtUtc'];
const taskHash = task => hash(JSON.stringify(fields.map(k => task[k])));
const GIT = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
const NULL_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';
const fixtureEnv = home => ({ PATH: process.env.PATH, HOME: home, USERPROFILE: home,
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_PATH });
function git(cwd, args) {
  const r = spawnSync(GIT, ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000,
    env: fixtureEnv(cwd) });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
async function fixture(t, overrides = {}, options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rescue-supervised-fixture-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const roots = { canonicalRoot: join(root, 'canonical-preserved'), repoRoot: join(root, 'island-repository'),
    worktreeRoot: join(root, 'island-worktrees'), receiptRoot: join(root, 'island-receipts') };
  await mkdir(roots.canonicalRoot); await writeFile(join(roots.canonicalRoot, 'dirty.txt'), 'PRESERVE THESE BYTES\n');
  await mkdir(join(roots.repoRoot, 'shared/agents'), { recursive: true });
  await mkdir(join(roots.repoRoot, 'docs/architecture'), { recursive: true });
  await writeFile(join(roots.repoRoot, 'shared/agents/rescueIslandPreflightV1.mjs'), 'export const fixtureOnly = true;\n');
  await writeFile(join(roots.repoRoot, 'shared/agents/rescueIslandPreflightV1.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict';\n" +
    "import { fixtureOnly } from './rescueIslandPreflightV1.mjs';\n" +
    "test('disposable fixture test really executes', () => assert.equal(fixtureOnly, " + (options.badTest ? "false" : "true") + "));\n");
  if(options.sourceTask) {
    await writeFile(join(roots.repoRoot,'shared/agents/rescueIslandSecondLaneV1.mjs'),
      (options.sourcePatch?'// '+('large reviewed baseline '.repeat(600))+'\n':'')+'export const lane = 1;\n');
    for(const file of ['rescueIslandSourceTaskV1.test.mjs','rescueIslandSupervisedRunV1.test.mjs'])
      await writeFile(join(roots.repoRoot,'shared/agents',file),"import test from 'node:test'; test('source fixture baseline only',()=>{});\n");
  }
  git(roots.repoRoot, ['init', '-b', 'main']); git(roots.repoRoot, ['add', '.']);
  git(roots.repoRoot, ['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture baseline']);
  const baseHead = git(roots.repoRoot, ['rev-parse', 'HEAD']);
  git(roots.repoRoot, ['update-ref','refs/remotes/origin/main',baseHead]);
  const task = { schemaVersion: 'stephanos.rescue-island-pilot-task.v1', repository: REPO,
    issueNumber: 3109, issueTitle: ISSUE_TITLE, taskId: 'pilot-fixture-3109', workerId: 'rescue-island-01',
    baseHead, targetPath: 'docs/architecture/rescue-island-pilot-pilot-fixture-3109.md',
    content: '# Rescue Island pilot\nDisposable regression. This is not a production build.\n',
    testPath: 'shared/agents/rescueIslandPreflightV1.test.mjs', approvalSource: 'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
    expiresAtUtc: new Date(Date.now()+5*60_000).toISOString(), ...overrides };
  if(options.sourceTask) {
    task.schemaVersion='stephanos.rescue-island-source-task.v1';
    task.targetPath='shared/agents/rescueIslandSecondLaneV1.mjs';
    task.content=JSON.stringify({scopeId:'ISLAND_BUILDERS_V1',changes:[
      {path:task.targetPath,beforeBlob:git(roots.repoRoot,['rev-parse','HEAD:'+task.targetPath]),content:'export const lane = 2;\n'},
      {path:'shared/agents/rescueIslandSecondLaneV1.test.mjs',beforeBlob:null,
        content:"import test from 'node:test'; import assert from 'node:assert/strict'; import {lane} from './rescueIslandSecondLaneV1.mjs'; test('actual changed source exports lane two',()=>assert.equal(lane,2));\n"},
    ]});
  }
  if(options.sourcePatch){
    const manifest=JSON.parse(task.content);
    const baseline=await readFile(join(roots.repoRoot,task.targetPath),'utf8');
    manifest.changes[0]={path:task.targetPath,beforeBlob:manifest.changes[0].beforeBlob,
      afterSha256:hash(baseline.replace('export const lane = 1;','export const lane = 2;')),
      edits:[{before:'export const lane = 1;',after:'export const lane = 2;'}]};
    task.content=JSON.stringify(manifest);
  }
  const commentId = 123456789;
  const iso = new Date().toISOString();
  const issue = { number: 3109, title: ISSUE_TITLE, state: 'open', url: 'https://api.github.com/repos/'+REPO+'/issues/3109' };
  const comment = { id: commentId, url: 'https://api.github.com/repos/'+REPO+'/issues/comments/'+commentId,
    issue_url: issue.url, user: { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
    author_association: 'OWNER', created_at: iso, updated_at: iso,
    body: '/rescue-island-01 '+(options.sourceTask?'supervised-source-cooperative':'supervised-cooperative')+' '+baseHead+' '+task.taskId+' '+hash(task.content) };
  const inventory = { reads: 0, stages: [], gateCalls: 0, brokerMode: 'UPSTREAM_REFRESH', brokerAge: 0 };
  const broker = { readBrokeredGithubJson: spec => {
    inventory.reads++;
    (inventory.endpoints ||= []).push(spec.endpoint);
    const payload = spec.endpoint.endsWith('/git/ref/heads/main')
      ? { ref: 'refs/heads/main', object: { sha: baseHead } }
      : spec.endpoint.includes('/issues/comments/') ? comment : issue;
    return { ok: true, source: inventory.brokerMode, ageMs: inventory.brokerAge, payload };
  }};
  // Copy the candidate modules byte-for-byte. Only imported external/host
  // adapters are replaced with explicit disposable fixtures.
  const harness = join(root, 'source-harness'); await mkdir(harness);
  for (const name of ['rescueIslandFirstCommitV1.mjs', 'rescueIslandAuthenticatedGithubReadV1.mjs',
      'rescueIslandPilotOwnerIntakeV1.mjs', 'rescueIslandSourceTaskV1.mjs', 'rescueIslandNativeTestProvisionV1.mjs', 'battleBridgeWindowsHosts.mjs']) {
    const bytes = await readFile(join(sourceRoot, name));
    await writeFile(join(harness, name), bytes);
    assert.deepEqual(await readFile(join(harness, name)), bytes);
  }
  const key = Symbol.for('stephanos.rescue.supervised.test.brokers');
  globalThis[key] ||= new Map(); globalThis[key].set(root, broker.readBrokeredGithubJson);
  t.after(() => { globalThis[key].delete(root); });
  await writeFile(join(harness,'githubObservationBrokerV1.mjs'),
    'export const readBrokeredGithubJson = globalThis[Symbol.for("stephanos.rescue.supervised.test.brokers")].get(' + JSON.stringify(root) + ');\n');
  await writeFile(join(harness,'rescueIslandPreflightV1.mjs'),
    'export function inspectRescueIslandCandidateV1(){return {preflight:"STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED",blockers:[]}}\n');
  await writeFile(join(harness,'battleBridgeExecutionBoundaryV1.mjs'), [
    'import {lstatSync,existsSync} from "node:fs"; import {join} from "node:path";',
    'export const resolveBattleBridgeGitExecutable=()=>'+JSON.stringify(GIT)+';',
    'export const createBattleBridgeMinimalChildEnvironment=()=>(' + JSON.stringify(fixtureEnv(roots.repoRoot)) + ');',
    'export const battleBridgeGitFixedConfigArgs=()=>'+JSON.stringify(['-c','core.autocrlf=false','-c','core.hooksPath='+NULL_PATH])+';',
    'export const validateBattleBridgeLocalGitConfiguration=()=>({ok:true});',
    'export const inspectBattleBridgeGitTopology=root=>({ok:lstatSync(join(root,".git")).isDirectory()&&!existsSync(join(root,".git/objects/info/alternates"))});',
  ].join('\n'));
  const module = {namespace:await import(pathToFileURL(join(harness,'rescueIslandFirstCommitV1.mjs')).href)};
  const candidatePath = join(roots.worktreeRoot, task.taskId);
  const worktreeIdentity = hash(process.platform === 'win32' ? candidatePath.toLowerCase() : candidatePath);
  const own = { taskId: task.taskId, ownerIssueNumber: 3109, workerId: task.workerId,
    worktreeBranch: 'rescue-island/pilot-'+task.taskId, worktreeIdentity,
    targetPaths:options.sourceTask?JSON.parse(task.content).changes.map(w=>w.path):[task.targetPath] };
  let lock = false;
  const host = {
    async withExistingOwnerAdmission(_expected, operation) {
      inventory.gateCalls++; if(lock) throw Error('FIXTURE_EXISTING_ADMISSION_BUSY');
      lock=true; try { return await operation(); } finally { lock=false; }
    },
    async observeSupervisedAdmission(expected) {
      inventory.stages.push(expected.stage);
      return { schemaVersion:'stephanos.rescue-island-supervised-host-observation.v1',
        assuranceProfile:'SUPERVISED_COOPERATIVE_V1', repository:REPO, taskId:task.taskId,
        workerId:task.workerId, taskFingerprint:taskHash(task), commentId, sourceHead:baseHead,
        targetPath:task.targetPath, sourceBranch:own.worktreeBranch, observedAtUtc:new Date().toISOString(),
        nonAdministrativeProcess:true, runnerResourceMode:'CPU_ONLY', gamingState:'IDLE_FRESH_VERIFIED',
        resourceGrantExpiresAtUtc:new Date(Date.now()+60_000).toISOString(), existingOwnerAdmissionHeld:true,
        canonicalCheckoutPreserved:true, canonicalPreservationDigest:hash('PRESERVE THESE BYTES\n'),
        worktreeIdentity, roots, claimInventoriesComplete:true, canonicalClaims:[], seedClaims:[], islandClaims:[own] };
    },
  };
  const run = module.namespace.createRescueIslandSupervisedRunnerV1(host);
  return { root, roots, baseHead, task, commentId, comment, issue, inventory, host, run, module,
    request: { task, commentId }, own, harness };
}
async function stageFiles(f) {
  try { return await readdir(join(f.roots.receiptRoot,'claims')); } catch { return []; }
}
function mutateObservation(f, transform) {
  const original=f.host.observeSupervisedAdmission;
  f.host.observeSupervisedAdmission=async expected => transform(await original(expected),expected);
  f.run=f.module.namespace.createRescueIslandSupervisedRunnerV1(f.host);
}

test('Island02 production reader uses its fixed parent endpoint and grants no host authority',async t=>{
  const f=await fixture(t,{workerId:'rescue-island-02',issueNumber:3103,
    issueTitle:'Rescue Island: two independent proof-gated builders outside Goal Conveyor'});
  Object.assign(f.issue,{number:3103,title:f.task.issueTitle,url:'https://api.github.com/repos/'+REPO+'/issues/3103'});
  f.comment.issue_url=f.issue.url;
  f.comment.body='/rescue-island-02 supervised-cooperative '+f.baseHead+' '+f.task.taskId+' '+hash(f.task.content);
  const {readRescueIslandSupervisedPilotGithubFactsV1:read02}=await import(pathToFileURL(join(f.harness,'rescueIslandAuthenticatedGithubReadV1.mjs')));
  const result=await read02(f.request);
  assert.equal(result.verdict,'GITHUB_FACTS_STRUCTURALLY_VERIFIED');assert.equal(result.workerId,'rescue-island-02');assert.equal(result.ownerIssueNumber,3103);
  assert.deepEqual(f.inventory.endpoints,['git/ref/heads/main','issues/3103','issues/comments/'+f.commentId,'git/ref/heads/main'].map(p=>'repos/'+REPO+'/'+p));
  for(const key of ['approvalAuthenticated','physicalPickupAllowed','sourceMutationAllowed','liveRunnerRegistered'])assert.equal(result[key],false);
  f.task.workerId='rescue-island-03';const before=f.inventory.reads;
  assert.equal((await read02(f.request)).verdict,'HELD');assert.equal(f.inventory.reads,before);
});

test('strict public executor retains its unconditional hold before any Git/filesystem write',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.module.namespace.constructIsolatedRescueIslandPilotV1({
    task:f.task,nowUtc:new Date().toISOString(),observed:{},approvalAuthenticated:true,ownershipAuthenticated:true,
    repoRoot:f.roots.repoRoot,worktreeRoot:f.roots.worktreeRoot,receiptRoot:f.roots.receiptRoot,
    supervised:true,skipCustody:true,
  }),/RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED/);
  assert.equal(existsSync(f.roots.worktreeRoot),false);assert.equal(f.inventory.reads,0);
});
test('supervised path performs real isolated edit, Node test and exact-parent Git commit',async t=>{
  const f=await fixture(t);const result=await f.run(f.request);
  t.diagnostic('TEST_FIXTURE_EXECUTION_ONLY '+JSON.stringify({commitHead:result.head,parent:result.parent,changedPath:result.changedPath,liveBattleBridge:false}));
  assert.equal(result.ok,true);assert.equal(result.parent,f.baseHead);assert.match(result.head,/^[a-f0-9]{40}$/);
  assert.notEqual(result.head,f.baseHead);assert.equal(result.published,false);assert.equal(result.merged,false);
  assert.equal(result.assuranceProfile,'SUPERVISED_COOPERATIVE_V1');assert.equal(result.hostileWriterContainmentProven,false);
  assert.equal(result.independentlyCommissionedWorker,false);
  const cwd=join(f.roots.worktreeRoot,f.task.taskId);
  assert.equal(git(cwd,['show','HEAD:'+f.task.targetPath]),f.task.content.trim());
  assert.equal(git(cwd,['diff-tree','--no-commit-id','--name-only','-r','HEAD']),f.task.targetPath);
  assert.equal(git(f.roots.repoRoot,['rev-parse','HEAD']),f.baseHead);
  assert.equal(await readFile(join(f.roots.canonicalRoot,'dirty.txt'),'utf8'),'PRESERVE THESE BYTES\n');
  assert.equal(f.inventory.reads,4);
  assert.deepEqual(f.inventory.stages,['BEFORE_PREPARATION','BEFORE_CLAIM','BEFORE_WORKTREE','BEFORE_EDIT','BEFORE_TEST','BEFORE_COMMIT']);
  assert.deepEqual(result.receipts.map(r=>r.stage),['SELECTED','CLAIMED','BRANCH_RESERVED','PHYSICAL_PICKUP','EDITED','TESTED','ISOLATED_COMMIT']);
  assert.ok(result.receipts.every(r=>r.assuranceProfile==='SUPERVISED_COOPERATIVE_V1'&&r.hostileWriterContainmentProven===false));
});
test('same task cannot replay after its actual commit',async t=>{
  const f=await fixture(t);await f.run(f.request);await assert.rejects(f.run(f.request),/RESCUE_ISLAND_DUPLICATE_CLAIM/);
});
test('same in-flight admitted task cannot acquire a competing run',async t=>{
  const f=await fixture(t);const first=f.run(f.request);await assert.rejects(f.run(f.request),/FIXTURE_EXISTING_ADMISSION_BUSY/);await first;
});
for(const [label,change] of [
  ['ordinary pilot approval is not supervised consent',f=>{f.comment.body=f.comment.body.replace('supervised-cooperative','pilot');}],
  ['wrong owner',f=>{f.comment.user.id=7;}],
  ['edited approval',f=>{f.comment.updated_at='2026-01-01T00:00:00Z';}],
  ['wrong source',f=>{f.comment.body=f.comment.body.replace(f.baseHead,'f'.repeat(40));}],
  ['wrong approved bytes',f=>{f.comment.body=f.comment.body.replace(hash(f.task.content),'0'.repeat(64));}],
  ['cached GitHub result',f=>{f.inventory.brokerMode='CACHE';f.inventory.brokerAge=1;}],
])test(label,async t=>{
  const f=await fixture(t);change(f);await assert.rejects(f.run(f.request),/OWNER_APPROVAL_UNPROVEN/);
  assert.equal(existsSync(f.roots.worktreeRoot),false);
});
for(const [label,change] of [
  ['unknown privilege',v=>{v.nonAdministrativeProcess=false;}],
  ['gaming active',v=>{v.gamingState='ACTIVE';}],
  ['GPU runner',v=>{v.runnerResourceMode='GPU';}],
  ['expired resource grant',v=>{v.resourceGrantExpiresAtUtc='2000-01-01T00:00:00Z';}],
  ['missing owner lock',v=>{v.existingOwnerAdmissionHeld=false;}],
  ['failed preservation',v=>{v.canonicalCheckoutPreserved=false;}],
  ['stale observation',v=>{v.observedAtUtc='2000-01-01T00:00:00Z';}],
  ['different task digest',v=>{v.taskFingerprint='f'.repeat(64);}],
  ['missing canonical claims',v=>{v.canonicalClaims=null;}],
  ['incomplete inventory',v=>{v.claimInventoriesComplete=false;}],
  ['no existing Island owner',v=>{v.islandClaims=[];}],
  ['conflicting canonical issue owner',v=>{v.canonicalClaims=[{...v.islandClaims[0]}];}],
  ['canonical metadata overlap',v=>{v.roots={...v.roots,repoRoot:v.roots.canonicalRoot};}],
])test(label,async t=>{
  const f=await fixture(t);mutateObservation(f,v=>{change(v);return v;});
  await assert.rejects(f.run(f.request),/RESCUE_ISLAND_SUPERVISED_/);
  assert.equal(existsSync(f.roots.worktreeRoot),false);
});
for(const stage of ['BEFORE_CLAIM','BEFORE_WORKTREE','BEFORE_EDIT','BEFORE_TEST','BEFORE_COMMIT'])
 test('revocation at '+stage+' stops further execution',async t=>{
  const f=await fixture(t);mutateObservation(f,(v,e)=>{if(e.stage===stage)v.gamingState='ACTIVE';return v;});
  await assert.rejects(f.run(f.request),/HOST_OBSERVATION_HELD/);
  assert.ok(!(await stageFiles(f)).some(v=>v.includes('.ISOLATED_COMMIT.')));
  if(['BEFORE_CLAIM','BEFORE_WORKTREE','BEFORE_EDIT','BEFORE_TEST'].includes(stage))
    assert.ok(!(await stageFiles(f)).some(v=>v.includes('.TESTED.')));
 });
test('missing real host adapters cannot enable this mode',async t=>{
  const f=await fixture(t);assert.throws(()=>f.module.namespace.createRescueIslandSupervisedRunnerV1({}),/HOST_NOT_CONNECTED/);
});
test('host claiming success without execution cannot supply a build result',async t=>{
  const f=await fixture(t);f.host.withExistingOwnerAdmission=async()=>({ok:true});
  const run=f.module.namespace.createRescueIslandSupervisedRunnerV1(f.host);
  await assert.rejects(run(f.request),/EXECUTION_RESULT_UNPROVEN/);
});
test('caller approval and runner overrides are rejected as request fields',async t=>{
  const f=await fixture(t);await assert.rejects(f.run({...f.request,approvalAuthenticated:true}),/REQUEST_INVALID/);
  await assert.rejects(f.run({...f.request,runTest:()=>({status:0})}),/REQUEST_INVALID/);
});
test('expired task is held before owner lookup or filesystem access',async t=>{
  const f=await fixture(t,{expiresAtUtc:'2000-01-01T00:00:00Z'});
  await assert.rejects(f.run(f.request),/EXTERNAL_TASK_INVALID/);assert.equal(f.inventory.reads,0);
});
test('accessor task does not execute its getter',async t=>{
  const f=await fixture(t);let called=false;
  Object.defineProperty(f.task,'content',{get(){called=true;throw Error('unsafe');},enumerable:true});
  await assert.rejects(f.run(f.request),/TASK_NOT_PLAIN/);assert.equal(called,false);
});
test('existing task branch is not adopted or overwritten',async t=>{
  const f=await fixture(t);git(f.roots.repoRoot,['branch','rescue-island/pilot-'+f.task.taskId]);
  await assert.rejects(f.run(f.request),/BRANCH_OWNERSHIP_UNPROVEN/);
  assert.equal(git(f.roots.repoRoot,['rev-parse','rescue-island/pilot-'+f.task.taskId]),f.baseHead);
});
test('unrelated tracked changes before test are refused',async t=>{
  const f=await fixture(t);mutateObservation(f,async(v,e)=>{
    if(e.stage==='BEFORE_EDIT')await writeFile(join(f.roots.worktreeRoot,f.task.taskId,'shared/agents/rescueIslandPreflightV1.mjs'),'throw Error("changed");\n');
    return v;
  });
  await assert.rejects(f.run(f.request),/TEST_TREE_UNTRUSTED/);
  assert.ok(!(await stageFiles(f)).some(v=>v.includes('.TESTED.')));
});
test('changed test during the awaited observer is refused before Node executes',async t=>{
  const f=await fixture(t);mutateObservation(f,async(v,e)=>{
    if(e.stage==='BEFORE_TEST')await writeFile(join(f.roots.worktreeRoot,f.task.taskId,f.task.testPath),'throw Error("changed");\n');
    return v;
  });
  await assert.rejects(f.run(f.request),/TEST_TREE_UNTRUSTED/);
  assert.ok(!(await stageFiles(f)).some(v=>v.includes('.TESTED.')));
});
test('failed real Node test cannot be committed',async t=>{
  const f=await fixture(t,{}, {badTest:true});
  await assert.rejects(f.run(f.request),/FOCUSED_TEST_FAILED/);
  assert.ok(!(await stageFiles(f)).some(v=>v.includes('.ISOLATED_COMMIT.')));
});
test('post-test out-of-scope mutation is rejected before a commit',async t=>{
  const f=await fixture(t);mutateObservation(f,async(v,e)=>{
    if(e.stage==='BEFORE_COMMIT')await writeFile(join(f.roots.worktreeRoot,f.task.taskId,'unexpected.txt'),'preserve for investigation');
    return v;
  });
  await assert.rejects(f.run(f.request),/PRECOMMIT_SCOPE_CHANGED/);
  assert.equal(git(join(f.roots.worktreeRoot,f.task.taskId),['rev-parse','HEAD']),f.baseHead);
});
test('ordinary owner intake stays strict and cannot accept the supervised command',async t=>{
  const f=await fixture(t);
  const intake=await import(pathToFileURL(join(f.harness,'rescueIslandPilotOwnerIntakeV1.mjs')).href);
  const facts={issue:f.issue,comment:f.comment,commentId:f.commentId,mainHead:f.baseHead,
    nowUtc:new Date().toISOString(),task:f.task};
  assert.equal(intake.inspectRescueIslandPilotOwnerIntakeV1(facts).disposition,'HELD');
  assert.equal(intake.inspectRescueIslandSupervisedOwnerIntakeV1(facts).disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  f.comment.body=f.comment.body.replace('supervised-cooperative','pilot');
  assert.equal(intake.inspectRescueIslandPilotOwnerIntakeV1(facts).disposition,'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.equal(intake.inspectRescueIslandSupervisedOwnerIntakeV1(facts).disposition,'HELD');
});


test('supervised source performs a real existing-file edit, added test, Node run and exact-parent multi-file commit',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  const result=await f.run(f.request);assert.equal(result.ok,true);
  const paths=JSON.parse(f.task.content).changes.map(w=>w.path);
  assert.deepEqual(result.changedPaths,paths);
  assert.equal(result.parent,f.baseHead);assert.equal(result.taskKind,'SOURCE_PROPOSAL_V1');
  const wt=join(f.roots.worktreeRoot,f.task.taskId);
  assert.equal(git(wt,['show','HEAD:'+f.task.targetPath]),'export const lane = 2;');
  assert.deepEqual(git(wt,['diff-tree','--no-commit-id','--name-only','-r','HEAD']).split('\n'),paths);
  assert.equal(git(wt,['status','--porcelain']),'');
  const tested=result.receipts.find(r=>r.stage==='TESTED');
  assert.ok(tested.testPaths.includes('shared/agents/rescueIslandSecondLaneV1.test.mjs'));
  const output=await readFile(join(f.roots.receiptRoot,'test-output',tested.testOutputFile),'utf8');
  assert.match(output,/actual changed source exports lane two/);assert.match(output,/fail 0/);
  assert.equal(hash(output),tested.testResultHash);
  assert.equal(result.approvedContentSha256,hash(f.task.content));
  await assert.rejects(f.run(f.request)); // retained task claim, never a blind refill.
  t.diagnostic('SOURCE_TASK_FIXTURE_COMMIT='+result.head+';LIVE_PROGRAMME_BUILD=false');
});

test('documentation consent cannot authorise source execution',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  f.comment.body=f.comment.body.replace('supervised-source-cooperative','supervised-cooperative');
  await assert.rejects(f.run(f.request),/OWNER_APPROVAL_UNPROVEN/);
  assert.equal(existsSync(f.roots.worktreeRoot),false);
});

test('source proposal rejects a wrong exact before-blob without editing its repository',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  const manifest=JSON.parse(f.task.content);manifest.changes[0].beforeBlob='0'.repeat(40);
  f.task.content=JSON.stringify(manifest);
  f.comment.body='/rescue-island-01 supervised-source-cooperative '+f.baseHead+' '+f.task.taskId+' '+hash(f.task.content);
  await assert.rejects(f.run(f.request),/SOURCE_BEFORE_BLOB_CHANGED/);
  assert.equal(git(f.roots.repoRoot,['show','HEAD:'+f.task.targetPath]),'export const lane = 1;');
  assert.equal(existsSync(f.roots.worktreeRoot),false);
});

test('unregistered source paths stop before any GitHub read or physical mutation',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  const manifest=JSON.parse(f.task.content);manifest.changes[0].path='shared/agents/durableFlywheelControllerVNext.mjs';
  f.task.content=JSON.stringify(manifest);f.task.targetPath=manifest.changes[0].path;
  await assert.rejects(f.run(f.request),/EXTERNAL_TASK_INVALID/);
  assert.equal(f.inventory.reads,0);assert.equal(existsSync(f.roots.worktreeRoot),false);
});

test('failed candidate source tests retain branch, worktree, log and BLOCKED without a commit',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  const manifest=JSON.parse(f.task.content);manifest.changes[1].content=manifest.changes[1].content.replace('assert.equal(lane,2)','assert.equal(lane,3)');
  f.task.content=JSON.stringify(manifest);
  f.comment.body='/rescue-island-01 supervised-source-cooperative '+f.baseHead+' '+f.task.taskId+' '+hash(f.task.content);
  await assert.rejects(f.run(f.request),/FOCUSED_TEST_FAILED/);
  const names=await stageFiles(f);assert.ok(names.some(n=>n.endsWith('.BLOCKED.json')));
  assert.ok(!names.some(n=>n.endsWith('.TESTED.json')||n.endsWith('.ISOLATED_COMMIT.json')));
  const wt=join(f.roots.worktreeRoot,f.task.taskId);assert.equal(git(wt,['rev-parse','HEAD']),f.baseHead);
  assert.ok((await readdir(join(f.roots.receiptRoot,'test-output'))).length);
});

test('source mutation outside the approved plan after testing is held and retained',async t=>{
  const f=await fixture(t,{}, {sourceTask:true});
  mutateObservation(f,async(observation,expected)=>{
    if(expected.stage==='BEFORE_COMMIT')
      await writeFile(join(f.roots.worktreeRoot,f.task.taskId,'unexplained.txt'),'must remain retained\n');
    return observation;
  });
  await assert.rejects(f.run(f.request),/PRECOMMIT_SCOPE_CHANGED/);
  assert.ok((await stageFiles(f)).some(n=>n.endsWith('.BLOCKED.json')));
  assert.equal(await readFile(join(f.roots.worktreeRoot,f.task.taskId,'unexplained.txt'),'utf8'),'must remain retained\n');
});


test('bounded exact patch updates a larger source module, preserving full bytes and trailing newline',async t=>{
  const f=await fixture(t,{}, {sourceTask:true,sourcePatch:true});
  assert.ok(Buffer.byteLength(f.task.content)<8192);
  const expected=JSON.parse(f.task.content).changes[0].afterSha256;
  const result=await f.run(f.request);
  const bytes=await readFile(join(f.roots.worktreeRoot,f.task.taskId,f.task.targetPath));
  assert.ok(bytes.length>8192);assert.equal(hash(bytes),expected);
  assert.equal(bytes.at(-1),10);assert.equal(result.parent,f.baseHead);
  assert.equal(result.taskOwnerIssueNumber,3109);assert.equal(result.executionOwnerIssueNumber,3109);
});
test('patch fragments must match once and produce the exact approved full-content hash',async t=>{
  for(const bad of ['fragment','digest']){
    const f=await fixture(t,{}, {sourceTask:true,sourcePatch:true});
    const manifest=JSON.parse(f.task.content);
    if(bad==='fragment')manifest.changes[0].edits[0].before='absent unique source';
    else manifest.changes[0].afterSha256='0'.repeat(64);
    f.task.content=JSON.stringify(manifest);
    f.comment.body='/rescue-island-01 supervised-source-cooperative '+f.baseHead+' '+f.task.taskId+' '+hash(f.task.content);
    await assert.rejects(f.run(f.request),bad==='fragment'?/PATCH_NOT_UNIQUE/:/PATCH_CONTENT_MISMATCH/);
    assert.equal(existsSync(f.roots.worktreeRoot),false);
  }
});

for (const kind of ['module', 'test'])
test('approved source '+kind+' drift during BEFORE_TEST stops before Node executes altered bytes', async t => {
  const f = await fixture(t, {}, {sourceTask:true,sourcePatch:kind==='module'});
  const manifest = JSON.parse(f.task.content);
  const relative = manifest.changes[kind==='module'?0:1].path;
  const wt = join(f.roots.worktreeRoot, f.task.taskId);
  const sentinel = join(wt, 'unapproved-executed.txt');
  mutateObservation(f, async (observation, expected) => {
    if (expected.stage === 'BEFORE_TEST') {
      const file = join(wt, relative);
      await writeFile(file, "import {writeFileSync} from 'node:fs'; writeFileSync(new URL('../../unapproved-executed.txt', import.meta.url), 'UNAPPROVED EXECUTION');\n" + await readFile(file, 'utf8'));
    }
    return observation;
  });
  await assert.rejects(f.run(f.request), /RESCUE_ISLAND_PRETEST_APPROVED_CONTENT_CHANGED/);
  assert.equal(existsSync(sentinel), false, 'altered source must never execute');
  assert.equal(git(wt, ['rev-parse', 'HEAD']), f.baseHead);
  const stages = await stageFiles(f);
  assert.ok(stages.some(name => name.endsWith('.BLOCKED.json')));
  assert.ok(stages.some(name => name.endsWith('.EDITED.json')));
  assert.ok(!stages.some(name => /\.(TESTED|ISOLATED_COMMIT)\.json$/.test(name)));
  assert.ok((await readFile(join(wt, relative), 'utf8')).includes('UNAPPROVED EXECUTION'), 'retain changed evidence');
});
