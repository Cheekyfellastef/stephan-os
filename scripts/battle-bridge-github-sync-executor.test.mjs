import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND,
  createFixedGitAdapter,
  FIXED_SYNC_GIT_COMMANDS,
  SYNC_LOCK_STALE_AFTER_MS,
  runBattleBridgeGitHubSync as runSyncWithRealRotationAdmission,
  runBoundedSyncHousekeeper,
  validateCanonicalSyncPaths,
} from './battle-bridge-github-sync-executor.mjs';
import { SYNC_CLASSIFICATIONS } from './battle-bridge-github-sync-policy.mjs';
import { readPendingPostSyncRefresh } from './battle-bridge-github-sync-and-refresh.mjs';
import { runBattleBridgePostSyncRefresh } from './battle-bridge-post-sync-refresh.mjs';
const runBattleBridgeGitHubSync = options => runSyncWithRealRotationAdmission({
  rotationPreflightFn: () => ({ok:true,required:false}), ...options,
});

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

test('fixed sync adapter pins the reviewed SHA and rejects arbitrary targets or target injection into reads',()=>{
  const calls=[];const git=createFixedGitAdapter({spawnSyncFn:(exe,args,options)=>{calls.push({exe,args,options});return {status:0,stdout:'',stderr:''};}});
  git.run(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id,'fixed-root',{expectedHead:B});
  assert.deepEqual(calls[0].args,['merge','--ff-only',B]);assert.equal(calls[0].options.shell,false);
  for(const expectedHead of ['origin/main','main','; unsafe',B+'x']) assert.throws(()=>git.run(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id,'fixed-root',{expectedHead}),/EXACT_TARGET/);
  assert.throws(()=>git.run(FIXED_SYNC_GIT_COMMANDS.localHead.id,'fixed-root',{expectedHead:B}),/EXACT_TARGET/);
});

test('unattended epoch adoption uses the same outer mailbox guard and rechecks its frozen proof before pinned merge',async t=>{
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const git=fakeGit({remote:B}),events=[];
  const raw=git.run.bind(git);git.run=(id,cwd,options)=>{if(id===FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id)events.push({kind:'merge',options});return raw(id,cwd,options)};
  const result=await runBattleBridgeGitHubSync({paths:f.paths,expectedPaths:f.expectedPaths,git,
    rotationPreflightFn: input=>{events.push({kind:'preflight',input});return {ok:true,required:true,sourceHead:B}},
    rotationGuardFn:(run)=>{events.push({kind:'lock'});const result=run({token:'fixed-test-token'});events.push({kind:'unlock'});return result;}});
  assert.equal(result.sourceUpdated,true);assert.deepEqual(events.map(e=>e.kind),['preflight','lock','preflight','merge','unlock']);
  assert.equal(events[2].input.guardToken,'fixed-test-token');assert.equal(events[3].options.expectedHead,B);
});

test('unattended sync fails before fast-forward on missing freeze, pending drain, lost locked admission or changed source',async t=>{
  for(const blocker of ['MAILBOX_ROTATION_SYNC_TRANSITION_REQUIRED','MAILBOX_ROTATION_SYNC_PREDECESSOR_PENDING','MAILBOX_ROTATION_SYNC_ACTIONS_PENDING']) {
    const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const git=fakeGit({remote:B});
    const result=await runBattleBridgeGitHubSync({paths:f.paths,expectedPaths:f.expectedPaths,git,rotationPreflightFn:()=>({ok:false,blocker})});
    assert.equal(result.ok,false);assert.match(result.error,new RegExp(blocker));assert.equal(git.calls.includes(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id),false);
  }
  const f=await fixture();t.after(()=>rm(f.root,{recursive:true,force:true}));const git=fakeGit({remote:B});let probes=0;
  const result=await runBattleBridgeGitHubSync({paths:f.paths,expectedPaths:f.expectedPaths,git,
    rotationPreflightFn:()=>++probes===1?{ok:true,required:true,sourceHead:B}:{ok:false,blocker:'MAILBOX_ROTATION_SYNC_PREDECESSOR_PENDING'},rotationGuardFn:fn=>fn({token:'fixed-test-token'})});
  assert.equal(result.ok,false);assert.equal(git.calls.includes(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id),false);
  const changed=await fixture();t.after(()=>rm(changed.root,{recursive:true,force:true}));const moved=fakeGit({remote:B}),original=moved.run.bind(moved);let remoteReads=0;
  moved.run=(id,...rest)=>{const result=original(id,...rest);return id===FIXED_SYNC_GIT_COMMANDS.remoteHead.id&&++remoteReads>1?{...result,stdout:'c'.repeat(40)}:result;};
  const held=await runBattleBridgeGitHubSync({paths:changed.paths,expectedPaths:changed.expectedPaths,git:moved});
  assert.equal(held.ok,false);assert.match(held.error,/SOURCE_CHANGED_BEFORE_FAST_FORWARD/);assert.equal(moved.calls.includes(FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id),false);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bb-sync-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
  const home = path.join(root, 'home');
  const repoRoot = path.join(home, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.join(home, 'Documents', 'Stephanos-openclaw-workspace');
  await mkdir(repoRoot, { recursive: true });
  return { root, home, repoRoot, workspaceRoot, paths: { repoRoot, workspaceRoot }, expectedPaths: { repoRoot, workspaceRoot } };
}

function fakeGit({
  branch = 'main',
  origin = 'https://github.com/Cheekyfellastef/stephan-os.git',
  status = '',
  statusAfterHousekeep = status,
  localBefore = A,
  remote = A,
  mergeBase = A,
  fetchOk = true,
  mergeOk = true,
} = {}) {
  const calls = [];
  let statusReads = 0;
  let mergeApplied = false;
  const outputs = {
    [FIXED_SYNC_GIT_COMMANDS.currentBranch.id]: () => ({ ok: true, stdout: `${branch}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.originUrl.id]: () => ({ ok: true, stdout: `${origin}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.statusPorcelain.id]: () => ({ ok: true, stdout: statusReads++ === 0 ? status : statusAfterHousekeep }),
    [FIXED_SYNC_GIT_COMMANDS.localHead.id]: () => ({ ok: true, stdout: `${mergeApplied ? remote : localBefore}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.fetchOriginMain.id]: () => ({ ok: fetchOk, stdout: '', stderr: fetchOk ? '' : 'fetch failed' }),
    [FIXED_SYNC_GIT_COMMANDS.remoteHead.id]: () => ({ ok: true, stdout: `${remote}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeBase.id]: () => ({ ok: true, stdout: `${mergeBase}\n` }),
    [FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id]: () => {
      if (mergeOk) mergeApplied = true;
      return { ok: mergeOk, stdout: '', stderr: mergeOk ? '' : 'ff failed' };
    },
  };
  return {
    calls,
    isAncestor(before, after) { return { ok: true, ancestor: before <= after }; },
    run(id) {
      calls.push(id);
      const result = outputs[id]?.();
      if (!result) throw new Error(`unexpected command ${id}`);
      return { status: result.ok ? 0 : 1, mutation: id === FIXED_SYNC_GIT_COMMANDS.mergeFfOnlyOriginMain.id, commandId: id, performsShellExecution: false, error: '', ...result };
    },
  };
}

function housekeeperObservation({ state = 'READY', sourceDirtCount = 0, hardBlockCount = 0 } = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-sync-housekeeper-observation.v1',
    attempted: true,
    state,
    reason: state === 'READY' ? 'HOUSEKEEPER_ALLOWLISTS_CONVERGED' : 'HOUSEKEEPER_PRESERVED_BLOCKING_DIRT',
    exitCode: state === 'READY' ? 0 : 1,
    readyToEnterCommandDeck: state === 'READY',
    sourceDirtCount,
    hardBlockCount,
    dependencyWarningCount: 0,
    autoCleanedCount: 0,
    runtimeCleanedCount: 0,
    openClawWorkspaceMovedCount: 0,
    sourceOwnedMutationAllowed: false,
    rawPathValuesPublished: false,
    arbitraryShellAllowed: false,
    commandIdentity: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND.id,
  });
}

async function readStatus(workspaceRoot) {
  return JSON.parse(await readFile(path.join(workspaceRoot, 'status', 'battle-bridge-github-sync-current.json'), 'utf8'));
}

test('actual sync writer preserves legacy relay debt through source advance failure and generic completion until relay proof', async t => {
  const fx = await fixture(); t.after(() => rm(fx.root, { recursive: true, force: true }));
  const C = 'c'.repeat(40), targetId = 'sovereign-commander';
  const refreshPath = path.join(fx.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json');
  await mkdir(path.dirname(refreshPath), { recursive: true });
  const legacy = { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
    statusId: 'post-sync-runtime-refresh-current', beforeHead: A, afterHead: B, phase: 'complete',
    classification: 'REFRESH_COMPLETE', finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS', exactHeadProofOk: true,
    blocker: '', targetIds: [targetId], resultTargets: [{ targetId, ok: true, exactHeadProofOk: true, sourceHead: B, blocker: '' }],
    changedPathCount: 1, noRuntimePathCount: 0, unknownPathCount: 0, unsafePathCount: 0,
    openClawPathCount: 0, pluginHostActivationRequired: false };
  await writeFile(refreshPath, JSON.stringify(legacy));
  await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths,
    git: fakeGit({ localBefore: B, remote: B, mergeBase: B }) });
  let debt = (await readStatus(fx.workspaceRoot)).pendingRefresh;
  assert.equal(debt.sovereignRelayRefreshRequired, true);
  assert.deepEqual(debt.spans, [{ beforeHead: A, afterHead: B }]);
  const advance = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths,
    git: fakeGit({ localBefore: B, remote: C, mergeBase: B }) });
  assert.equal(advance.sourceUpdated, true);
  debt = (await readStatus(fx.workspaceRoot)).pendingRefresh;
  assert.equal(debt.sovereignRelayRefreshRequired, true);
  assert.deepEqual(debt.spans, [{ beforeHead: A, afterHead: C }]);
  await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths,
    git: fakeGit({ localBefore: C, remote: C, mergeBase: C, fetchOk: false }) });
  assert.deepEqual((await readStatus(fx.workspaceRoot)).pendingRefresh, debt);
  const generic = { ...legacy, afterHead: C, sovereignRelayRefreshRequired: false,
    resultTargets: [{ targetId, ok: true, exactHeadProofOk: true, sourceHead: C, blocker: '' }] };
  await writeFile(refreshPath, JSON.stringify(generic));
  await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths,
    git: fakeGit({ localBefore: C, remote: C, mergeBase: C }) });
  assert.deepEqual((await readStatus(fx.workspaceRoot)).pendingRefresh, debt);
  const proof = { schemaVersion: 'stephanos.post-sync-sovereign-relay-proof.v1', watchdogSucceeded: true,
    healthy: true, sourceHead: C, sourceHeadMatchesLive: true, processCount: 1, heartbeatAgeSeconds: 2, blocker: '' };
  await writeFile(refreshPath, JSON.stringify({ ...generic, sovereignRelayRefreshRequired: true,
    resultTargets: [{ ...generic.resultTargets[0], sovereignRelayProof: proof }] }));
  await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths,
    git: fakeGit({ localBefore: C, remote: C, mergeBase: C }) });
  assert.equal((await readStatus(fx.workspaceRoot)).pendingRefresh, null);
});

test('real sync writer retains admitted debt through no-change and failures before any refresh plan', async t => {
  const fx = await fixture(); t.after(() => rm(fx.root, { recursive: true, force: true }));
  const initial = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths, git: fakeGit({ remote: B }) });
  assert.equal(initial.sourceUpdated, true);
  const before = (await readStatus(fx.workspaceRoot)).pendingRefresh;
  assert.deepEqual(before.spans, [{ beforeHead: A, afterHead: B }]);
  const lockPath = path.join(fx.workspaceRoot, 'locks', 'post-sync-runtime-refresh.lock');
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, acquiredAtUtc: new Date().toISOString() }));
  const held = await runBattleBridgePostSyncRefresh({ beforeHead: A, afterHead: B, paths: fx.paths, expectedPaths: fx.paths,
    adapter: { inspectHeads() { throw new Error('must not inspect while original refresh owner holds lock'); } } });
  assert.equal(held.blocker, 'POST_SYNC_REFRESH_ALREADY_RUNNING');
  for (const mode of ['no-change', 'fetch-failure', 'exception']) {
    const git = fakeGit({ localBefore: B, remote: B, mergeBase: B, fetchOk: mode !== 'fetch-failure' });
    if (mode === 'exception') {
      const run = git.run.bind(git);
      git.run = id => { if (id === FIXED_SYNC_GIT_COMMANDS.fetchOriginMain.id) throw new Error('fixture transport exception'); return run(id); };
    }
    await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths, git });
    assert.deepEqual((await readStatus(fx.workspaceRoot)).pendingRefresh, before, mode);
    assert.deepEqual((await readPendingPostSyncRefresh(fx.paths)).spans, before.spans, mode);
  }
  await assert.rejects(readFile(path.join(fx.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json')), { code: 'ENOENT' });
});

test('sync lock loser leaves durable current status byte-for-byte unchanged', async t => {
  const fx = await fixture(); t.after(() => rm(fx.root, { recursive: true, force: true }));
  await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths, git: fakeGit({ remote: B }) });
  const statusPath = path.join(fx.workspaceRoot, 'status', 'battle-bridge-github-sync-current.json');
  const before = await readFile(statusPath);
  await writeFile(path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock'), JSON.stringify({ pid: process.pid, acquiredAtUtc: new Date().toISOString() }));
  const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths, git: fakeGit({ localBefore: B, remote: B, mergeBase: B }), processIsAliveFn: () => true });
  assert.equal(result.ok, false);
  assert.equal(result.publication, null);
  assert.deepEqual(await readFile(statusPath), before);
});

test('sync preserves malformed debt as a typed hold while allowing protected source-forward', async t => {
  const fx = await fixture(); t.after(() => rm(fx.root, { recursive: true, force: true }));
  await mkdir(path.join(fx.workspaceRoot, 'status'), { recursive: true });
  await writeFile(path.join(fx.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), '{broken');
  const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.paths, git: fakeGit({ remote: B }) });
  assert.equal(result.sourceUpdated, true);
  assert.equal((await readStatus(fx.workspaceRoot)).pendingRefresh.state, 'HELD');
  assert.equal((await readPendingPostSyncRefresh(fx.paths)).ok, false);
});

test('fixed ancestry uses bounded read-only argv and distinguishes unrelated history from probe errors', () => {
  const calls = [];
  let status = 1, error;
  const adapter = createFixedGitAdapter({ spawnSyncFn: (command, args, options) => { calls.push({ command, args, options }); return { status, error, stdout: '', stderr: '' }; } });
  assert.deepEqual(adapter.isAncestor(A, B, '/fixture'), { ok: true, ancestor: false });
  status = 2;
  assert.equal(adapter.isAncestor(A, B, '/fixture').ok, false);
  status = 0; error = { code: 'ETIMEDOUT' };
  assert.equal(adapter.isAncestor(A, B, '/fixture').ok, false);
  for (const value of [[A], A.toUpperCase(), ` ${A}`, 'main']) assert.equal(adapter.isAncestor(value, B, '/fixture').ok, false);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ['merge-base', '--is-ancestor', A, B]);
  assert.equal(calls[0].options.shell, false);
  assert.ok(calls[0].options.timeout > 0 && calls[0].options.timeout <= 1000);
  assert.equal(calls[0].options.maxBuffer, 64 * 1024);
});

test('canonical path validator rejects arbitrary repository and overlapping workspace', () => {
  const expectedPaths = { repoRoot: '/home/u/Documents/GitHub/stephan-os', workspaceRoot: '/home/u/Documents/Stephanos-openclaw-workspace' };
  assert.equal(validateCanonicalSyncPaths({ repoRoot: '/tmp/other', workspaceRoot: expectedPaths.workspaceRoot, expectedPaths }).ok, false);
  assert.equal(validateCanonicalSyncPaths({ repoRoot: expectedPaths.repoRoot, workspaceRoot: '/home/u/Documents/GitHub/stephan-os/runtime', expectedPaths: { repoRoot: expectedPaths.repoRoot, workspaceRoot: '/home/u/Documents/GitHub/stephan-os/runtime' } }).ok, false);
});

test('no-change run fetches safely and publishes auditable external receipt', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit();
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:00:00Z') });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.ok(git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(status.kind, 'stephanos.shared_workspace.status');
    assert.equal(status.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.equal(status.authority.liveOpenClawUpdateAllowed, false);
    assert.equal(status.authority.delegatedHousekeeperAllowlistedCleanupAllowed, true);
    assert.equal(status.authority.delegatedHousekeeperExactHeadBound, true);
    assert.equal(status.proofRefs.length, 1);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('runtime-only dist dirt is counted without publishing forbidden generated paths', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: ' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/generated.js\n' });
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:00:30Z') });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.deepEqual(result.evaluation.dirt.runtimeOnly, [
      'apps/stephanos/dist/index.html',
      'apps/stephanos/dist/assets/generated.js',
    ]);
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.dirtClassification.runtimeOnlyCount, 2);
    assert.equal(status.dirtClassification.blocksSync, false);
    assert.equal(status.dirtClassification.pathValuesPublished, false);
    assert.doesNotMatch(JSON.stringify(status), /apps\/stephanos\/dist/);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('clean fast-forward applies only ff-only source update then stops for refresh proof', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ remote: B, mergeBase: A });
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git, now: new Date('2026-07-14T20:01:00Z') });
    assert.equal(result.sourceUpdated, true);
    assert.equal(result.runtimeRefreshPerformed, false);
    assert.equal(result.liveOpenClawUpdatePerformed, false);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_POST_SYNC_REFRESH_REQUIRED);
    assert.equal(result.facts.localHeadAfter, B);
    assert.deepEqual(git.calls.filter((id) => id === 'git-merge-ff-only-origin-main'), ['git-merge-ff-only-origin-main']);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('dirty untracked source invokes the existing Housekeeper once at the exact local head, rechecks, and remains blocked when source dirt survives', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: '?? scripts/local-work.mjs\n' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: ({ expectedHead }) => {
        housekeeperCalls += 1;
        assert.equal(expectedHead, A);
        return housekeeperObservation({ state: 'BLOCKED', sourceDirtCount: 1 });
      },
    });
    assert.equal(housekeeperCalls, 1);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
    assert.equal(result.housekeeperObservation.state, 'BLOCKED');
    assert.equal(result.housekeeperObservation.rawPathValuesPublished, false);
    assert.ok(!git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.housekeeperObservation.state, 'BLOCKED');
    assert.equal(status.housekeeperObservation.sourceDirtCount, 1);
    assert.equal(status.housekeeperObservation.rawPathValuesPublished, false);
    assert.equal('ignitionHardBlockPaths' in status.housekeeperObservation, false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('Housekeeper-cleared untracked dirt is re-proved before fetch and can return to ordinary no-change sync', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: '?? AGENTS.md\n', statusAfterHousekeep: '' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: ({ expectedHead }) => {
        housekeeperCalls += 1;
        assert.equal(expectedHead, A);
        return housekeeperObservation({ state: 'READY' });
      },
    });
    assert.equal(housekeeperCalls, 1);
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
    assert.ok(git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
    const status = await readStatus(fx.workspaceRoot);
    assert.equal(status.housekeeperObservation.state, 'READY');
    assert.equal(status.housekeeperObservation.rawPathValuesPublished, false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('tracked source dirt skips Housekeeper execution, blocks before fetch, and preserves all local work', async () => {
  const fx = await fixture();
  try {
    const git = fakeGit({ status: ' M scripts/local-work.mjs\n' });
    let housekeeperCalls = 0;
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git,
      housekeeperFn: () => {
        housekeeperCalls += 1;
        return housekeeperObservation();
      },
    });
    assert.equal(housekeeperCalls, 0);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE);
    assert.equal(result.housekeeperObservation.state, 'SKIPPED_FAIL_CLOSED');
    assert.equal(result.housekeeperObservation.reason, 'HOUSEKEEPER_TRACKED_SOURCE_DIRT_PRESENT');
    assert.ok(!git.calls.includes('git-fetch-origin-main'));
    assert.ok(!git.calls.includes('git-merge-ff-only-origin-main'));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('bounded Housekeeper subprocess uses the exact-head runner, minimal Git environment, and publishes counts rather than paths', () => {
  const calls = [];
  const observation = runBoundedSyncHousekeeper({
    repoRoot: '/canonical/repo',
    expectedHead: A,
    platform: 'linux',
    environment: { PATH: '/attacker', NODE_OPTIONS: '--require=/attacker/inject.cjs', HOME: '/home/test' },
    spawnSyncFn: (command, argv, options) => {
      calls.push({ command, argv, options });
      return {
        status: 1,
        stdout: `[HOUSEKEEP] status=${JSON.stringify({
          ignitionReadyToEnterCommandDeck: false,
          ignitionSourceDirtCount: 2,
          ignitionHardBlockCount: 1,
          ignitionDependencyWarningCount: 3,
          ignitionAutoCleaned: 4,
          ignitionRuntimeCleaned: 5,
          ignitionOpenClawWorkspaceMoved: 0,
          ignitionHardBlockPaths: ['secret-shaped-path'],
        })}\n`,
        stderr: 'local detail that must not be published',
      };
    },
  });
  assert.equal(BATTLE_BRIDGE_SYNC_HOUSEKEEPER_COMMAND.exactHeadBound, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].argv, [path.resolve('/canonical/repo/scripts/battle-bridge-sync-housekeeper-runner.mjs')]);
  assert.equal(calls[0].options.cwd, '/canonical/repo');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.PATH, '/usr/bin:/bin');
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(calls[0].options.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(calls[0].options.env.STEPHANOS_EXPECTED_HEAD, A);
  assert.equal(observation.state, 'BLOCKED');
  assert.equal(observation.sourceDirtCount, 2);
  assert.equal(observation.hardBlockCount, 1);
  assert.equal(observation.autoCleanedCount, 4);
  assert.equal(observation.runtimeCleanedCount, 5);
  assert.equal(observation.rawPathValuesPublished, false);
  assert.equal('ignitionHardBlockPaths' in observation, false);
  assert.equal(JSON.stringify(observation).includes('secret-shaped-path'), false);
  assert.equal(JSON.stringify(observation).includes('local detail'), false);
});

test('bounded Housekeeper refuses to spawn without a concrete exact local head', () => {
  let spawnCalls = 0;
  const observation = runBoundedSyncHousekeeper({
    repoRoot: '/canonical/repo',
    expectedHead: 'not-a-sha',
    platform: 'linux',
    spawnSyncFn: () => {
      spawnCalls += 1;
      throw new Error('must not spawn');
    },
  });
  assert.equal(spawnCalls, 0);
  assert.equal(observation.attempted, false);
  assert.equal(observation.state, 'UNPROVEN');
  assert.equal(observation.reason, 'HOUSEKEEPER_EXPECTED_HEAD_INVALID');
});

test('wrong remote and non-main branch block before fetch', async () => {
  for (const options of [{ origin: 'https://evil.example/Cheekyfellastef/stephan-os.git' }, { branch: 'feature' }]) {
    const fx = await fixture();
    try {
      const git = fakeGit(options);
      const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git });
      assert.ok([SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH, SYNC_CLASSIFICATIONS.BLOCKED_NON_MAIN_BRANCH].includes(result.evaluation.classification));
      assert.ok(!git.calls.includes('git-fetch-origin-main'));
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('fetch, divergence and ff-only failures fail closed', async () => {
  const cases = [
    [{ fetchOk: false }, SYNC_CLASSIFICATIONS.BLOCKED_FETCH_FAILED],
    [{ remote: B, mergeBase: 'c'.repeat(40) }, SYNC_CLASSIFICATIONS.BLOCKED_DIVERGED_HISTORY],
    [{ remote: B, mergeBase: A, mergeOk: false }, SYNC_CLASSIFICATIONS.BLOCKED_FAST_FORWARD_FAILED],
  ];
  for (const [options, expected] of cases) {
    const fx = await fixture();
    try {
      const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git: fakeGit(options) });
      assert.equal(result.evaluation.classification, expected);
    } finally { await rm(fx.root, { recursive: true, force: true }); }
  }
});

test('stale dead-process lock is recovered once and does not permanently stall the watcher', async () => {
  const fx = await fixture();
  try {
    const now = new Date('2026-07-14T20:30:00Z');
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 123, acquiredAtUtc: new Date(now.getTime() - SYNC_LOCK_STALE_AFTER_MS - 1).toISOString() })}\n`);
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git: fakeGit(),
      now,
      processIsAliveFn: () => false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('malformed stale lock is recovered from bounded file age', async () => {
  const fx = await fixture();
  try {
    const now = new Date('2026-07-14T20:30:00Z');
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, '');
    const old = new Date(now.getTime() - SYNC_LOCK_STALE_AFTER_MS - 1);
    await utimes(lockPath, old, old);
    const result = await runBattleBridgeGitHubSync({
      paths: fx.paths,
      expectedPaths: fx.expectedPaths,
      git: fakeGit(),
      now,
      processIsAliveFn: () => false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('single-instance lock fails closed and remains auditable', async () => {
  const fx = await fixture();
  try {
    const lockPath = path.join(fx.workspaceRoot, 'locks', 'battle-bridge-github-sync.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: 123, acquiredAtUtc: new Date().toISOString() })}\n`);
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git: fakeGit(), processIsAliveFn: () => true });
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED);
    assert.equal(result.lock.reason, 'SYNC_ALREADY_RUNNING');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('missing canonical repository fails before any Git command', async () => {
  const fx = await fixture();
  try {
    await rm(fx.repoRoot, { recursive: true, force: true });
    const git = fakeGit();
    const result = await runBattleBridgeGitHubSync({ paths: fx.paths, expectedPaths: fx.expectedPaths, git });
    assert.equal(result.evaluation.classification, SYNC_CLASSIFICATIONS.BLOCKED_INSTALL_OR_PERMISSION_REQUIRED);
    assert.deepEqual(git.calls, []);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
