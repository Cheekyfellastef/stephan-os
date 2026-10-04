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
});

test('already-ready UI is idempotent and does not restart 4173', async () => {
  let repairs = 0;
  const result = await runSovereignCommanderUi4173Repair({
    repoRoot: 'C:\\repo',
    sharedWorkspace: 'C:\\workspace',
    sourceTruthFn: () => sourceTruth(),
    evaluateSourceTruthFn: sourceVerdict,
    publisherFn: async () => ({ ok: true, status: 'READY', readiness: 'READY' }),
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
