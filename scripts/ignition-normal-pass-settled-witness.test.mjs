import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBattleBridgePostSyncRefresh } from './battle-bridge-post-sync-refresh.mjs';
import { runBattleBridgeSyncAndRefresh } from './battle-bridge-github-sync-and-refresh.mjs';
import { adjudicateThreeAppDesktopIgnitionPreflightV1 } from './battle-bridge-ignition-sync-preflight.mjs';
import { projectIgnitionSettledRefreshEvidenceV1 } from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const ancestor = (before, after) => ({ ok: true, ancestor: before <= after });
const syncModule = new URL('./battle-bridge-github-sync-executor.mjs', import.meta.url).href;
// The real synchronous child boundary and source writer publish under the
// disposable workspace. All fixed Git observations are intercepted here.
const child = `
const {runBattleBridgeGitHubSync,FIXED_SYNC_GIT_COMMANDS:ids}=await import(${JSON.stringify(syncModule)});
const paths=JSON.parse(process.argv[1]);
const head=${JSON.stringify(B)};
const values={ [ids.currentBranch.id]:'main',[ids.originUrl.id]:'https://github.com/Cheekyfellastef/stephan-os.git',
 [ids.statusPorcelain.id]:'',[ids.localHead.id]:head,[ids.remoteHead.id]:head,[ids.mergeBase.id]:head,[ids.fetchOriginMain.id]:'' };
const result=await runBattleBridgeGitHubSync({paths,expectedPaths:paths,
 rotationPreflightFn:()=>({ok:true,required:false}),
 git:{isAncestor:(before,after)=>({ok:true,ancestor:before<=after}),run(id){
  if(!Object.hasOwn(values,id))throw Error('unexpected or mutating Git operation');
  return {ok:true,stdout:values[id],stderr:''};}}});
process.stdout.write(JSON.stringify(result));
`;

async function fixture(t, { completion = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'ignition-settled-normal-'));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { repoRoot: path.join(root, 'repo'), workspaceRoot: path.join(root, 'workspace') };
  await mkdir(paths.repoRoot);
  if (completion) {
    const pass = () => ({ ok: true, exactHeadProofOk: true, sourceHead: B });
    const report = await runBattleBridgePostSyncRefresh({ paths, expectedPaths: paths, beforeHead: A, afterHead: B,
      adapter: { isAncestor: ancestor, inspectHeads: pass,
        changedPaths: () => ({ ok: true, paths: ['docs/settled-normal-source-fixture.md'] }),
        reconcileControlPlane: pass } });
    assert.equal(report.ok, true, report.blocker);
  }
  let syncs = 0, observations = 0;
  const invoke = ({ losePublication = false, moveAfterRead = false } = {}) => runBattleBridgeSyncAndRefresh({
    paths, expectedPaths: paths, platform: 'win32',
    capacityObservationHeartbeat: async () => ({ ok: true, capacityObservationOnly: true }),
    goalDiscoveryHeartbeat: async () => ({ ok: true }), controlPlaneReconciler: () => ({ ok: true }),
    adapter: { isAncestor: ancestor,
      runSync() {
        syncs++;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', child, JSON.stringify(paths)],
          { encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000 });
        assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
        const parsed = JSON.parse(result.stdout);
        assert.equal(parsed.ok, true, parsed.evaluation?.classification);
        if (losePublication) delete parsed.receipt;
        return { ok: true, result: parsed };
      },
      runRefresh() { assert.fail('already-paid NoChange must not rerun refresh'); },
      runMailboxPulse: () => ({ ok: true }),
      observeCurrentHead() {
        observations++;
        return { ok: true, head: moveAfterRead && observations > 1 ? C : B };
      },
    },
  });
  return { invoke, counts: () => ({ syncs, observations }) };
}

test('normal already-paid NoChange carries the existing actual canonical settlement witness', async t => {
  const f = await fixture(t);
  const result = await f.invoke();
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.finalVerdict, 'SYNC_AND_REFRESH_PASS');
  assert.equal(result.blocker, '');
  assert.equal(result.refreshes.length, 0);
  assert.ok(projectIgnitionSettledRefreshEvidenceV1(result.settledRefreshEvidence, B));
  assert.equal(result.settledRefreshEvidence.syncStatusRecord.pendingRefresh, null);
  assert.equal(result.settledRefreshEvidence.refreshCompletionRecord.finalVerdict, 'POST_SYNC_RUNTIME_REFRESH_PASS');
  const startup = adjudicateThreeAppDesktopIgnitionPreflightV1(result);
  assert.equal(startup.ok, true, startup.blocker);
  assert.equal(startup.startupAdmission.sourceHead, B);
  assert.equal(startup.startupAdmission.globalRefreshState, 'COMPLETE');
  const missingBlocker = { ...result };
  delete missingBlocker.blocker;
  assert.equal(adjudicateThreeAppDesktopIgnitionPreflightV1(missingBlocker).ok, false,
    'missing producer authority data cannot be inferred from the settlement witness');
  assert.deepEqual(f.counts(), { syncs: 1, observations: 2 });
});

test('normal NoChange without a canonical completion does not invent a settlement witness', async t => {
  const f = await fixture(t, { completion: false });
  const result = await f.invoke();
  assert.equal(result.ok, true, 'legacy source-result semantics remain unchanged');
  assert.equal(result.refreshes.length, 0);
  assert.equal(result.settledRefreshEvidence, null);
  assert.equal(projectIgnitionSettledRefreshEvidenceV1(result.settledRefreshEvidence, B), null);
  assert.equal(adjudicateThreeAppDesktopIgnitionPreflightV1(result).ok, false);
});

test('missing producer publication cannot borrow a valid on-disk completion', async t => {
  const f = await fixture(t);
  const result = await f.invoke({ losePublication: true });
  assert.equal(result.ok, true);
  assert.equal(result.settledRefreshEvidence, null);
  assert.equal(f.counts().observations, 0);
  assert.equal(adjudicateThreeAppDesktopIgnitionPreflightV1(result).ok, false);
});

test('source movement during the existing witness read keeps normal settlement unproven', async t => {
  const f = await fixture(t);
  const result = await f.invoke({ moveAfterRead: true });
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, B);
  assert.equal(result.settledRefreshEvidence, null);
  assert.equal(f.counts().observations, 2);
  assert.equal(adjudicateThreeAppDesktopIgnitionPreflightV1(result).ok, false);
});
