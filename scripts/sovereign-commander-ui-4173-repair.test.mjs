import test from 'node:test';
import assert from 'node:assert/strict';

import { runSovereignCommanderUi4173Repair } from './sovereign-commander-ui-4173-repair.mjs';

const HEAD = 'a'.repeat(40);

function sourceTruth() {
  return {
    ok: true,
    branch: 'main',
    upstreamBranch: 'origin/main',
    head: HEAD,
    originHead: HEAD,
    publicationState: 'healthy-synced',
    headPublished: true,
    blockedForRemoteTruth: false,
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
  };
}

function sourceVerdict(value) {
  return { ok: true, sourceTruth: value };
}

test('cold-boot UI repair refreshes workspace, binds exact head, repairs 4173, then republishes READY', async () => {
  const publishes = [];
  const repairs = [];
  let proofReads = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    platform: 'win32',
    environment: { USERPROFILE: 'C:\\Users\\Operator' },
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async (options) => {
      publishes.push(options);
      return publishes.length === 1
        ? { ok: true, status: 'DEGRADED', readiness: 'PARTIAL_UI_MISSING' }
        : { ok: true, status: 'READY', readiness: 'READY' };
    },
    servedRuntimeProofFn: async () => ({ ready: ++proofReads === 2 }),
    repairFn: async (options) => {
      repairs.push(options);
      options.stdout.write(JSON.stringify({ ready: true, action: 'start-ui-4173-ready' }));
      return 0;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.expectedHead, HEAD);
  assert.equal(result.alreadyReady, false);
  assert.equal(publishes.length, 2);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].dryRun, false);
  assert.equal(repairs[0].expectedHead, HEAD);
  assert.equal(repairs[0].sharedWorkspace.endsWith('workspace'), true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_GREEN');
  assert.equal(proofReads, 2);
  assert.equal(result.servedHeadAfter.ready, true);
});

test('already-ready UI is idempotent and does not restart 4173', async () => {
  let repairs = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY', readiness: 'READY' }),
    servedRuntimeProofFn: async () => ({ ready: true }),
    repairFn: async () => { repairs += 1; return 0; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, true);
  assert.equal(repairs, 0);
});

test('real source blocker fails closed before publisher or UI mutation', async () => {
  let publishes = 0;
  let repairs = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => ({ workingTreeDirty: true }),
    evaluateSourceTruthFn: () => ({
      ok: false,
      blocker: { id: 'dirty-source-truth', code: 'CANONICAL_CHECKOUT_DIRTY' },
    }),
    publisherFn: async () => { publishes += 1; return { ok: true }; },
    repairFn: async () => { repairs += 1; return 0; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(publishes, 0);
  assert.equal(repairs, 0);
});


test('publisher READY with stale served Flywheel dist triggers existing guarded UI repair', async () => {
  let repairs = 0;
  let proofReads = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY' }),
    servedRuntimeProofFn: async ({ expectedHead }) => {
      assert.equal(expectedHead, HEAD);
      return { ready: ++proofReads === 2, gitCommit: proofReads === 1 ? 'old-ui-head' : HEAD };
    },
    repairFn: async (options) => {
      repairs += 1;
      assert.equal(options.expectedHead, HEAD);
      options.stdout.write(JSON.stringify({ ready: true, action: 'restart-stale-ui-4173-ready' }));
      return 0;
    },
  });
  assert.equal(repairs, 1);
  assert.equal(proofReads, 2);
  assert.equal(result.alreadyReady, false);
  assert.equal(result.servedHeadBefore.ready, false);
  assert.equal(result.servedHeadAfter.ready, true);
  assert.equal(result.ok, true);
});

test('UI repair never returns GREEN when a stale served head survives the repair', async () => {
  let repairs = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY' }),
    servedRuntimeProofFn: async () => ({ ready: false, gitCommit: 'stale' }),
    repairFn: async (options) => {
      repairs += 1;
      options.stdout.write(JSON.stringify({ ready: true, action: 'restart-stale-ui-4173-ready' }));
      return 0;
    },
  });
  assert.equal(repairs, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STEPHANOS_UI_4173_SERVED_HEAD_UNPROVEN');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_BLOCKED');
});

test('served UI probe exceptions cannot silently mark the publisher READY', async () => {
  let repairs = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY' }),
    servedRuntimeProofFn: async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); },
    repairFn: async (options) => {
      repairs += 1;
      options.stdout.write(JSON.stringify({ ready: false, action: 'blocked' }));
      return 2;
    },
  });
  assert.equal(repairs, 1);
  assert.equal(result.ok, false);
  assert.equal(result.servedHeadBefore.blocker, 'ECONNREFUSED');
  assert.equal(result.servedHeadAfter.ready, false);
});


test('concurrent exact-head recovery is idempotent when existing repair returns only already-ready', async () => {
  let proofReads = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY' }),
    servedRuntimeProofFn: async () => ({ ready: ++proofReads === 2 }),
    repairFn: async (options) => {
      options.stdout.write(JSON.stringify({
        ready: false,
        action: 'blocked',
        blockers: [{ id: 'stephanos-ui-already-ready' }],
      }));
      return 2;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, true);
  assert.equal(result.raceConverged, true);
  assert.equal(result.servedHeadAfter.ready, true);
});

test('concurrent convergence cannot excuse a second safety blocker', async () => {
  let proofReads = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY' }),
    servedRuntimeProofFn: async () => ({ ready: ++proofReads === 2 }),
    repairFn: async (options) => {
      options.stdout.write(JSON.stringify({
        ready: false,
        action: 'blocked',
        blockers: [
          { id: 'stephanos-ui-already-ready' },
          { id: 'shared-workspace-not-fresh' },
        ],
      }));
      return 2;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.raceConverged, false);
  assert.equal(result.blocker, 'stephanos-ui-already-ready');
});
