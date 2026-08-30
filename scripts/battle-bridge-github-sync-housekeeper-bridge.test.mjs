import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseHousekeeperStatus,
  projectSyncHousekeeperEvidence,
  runBattleBridgeSyncHousekeeperBridge,
} from './battle-bridge-github-sync-housekeeper-bridge.mjs';

const HEAD = 'a'.repeat(40);
const PATHS = Object.freeze({
  repoRoot: '/canonical/stephan-os',
  workspaceRoot: '/canonical/workspace',
  syncStatusPath: '/canonical/workspace/status/battle-bridge-github-sync-current.json',
});

function dirtySync(overrides = {}) {
  return Object.freeze({
    ok: false,
    blocker: 'BLOCKED_DIRTY_SOURCE',
    syncClassification: 'BLOCKED_DIRTY_SOURCE',
    sourceHead: HEAD,
    finalVerdict: 'SYNC_AND_REFRESH_BLOCKED',
    ...overrides,
  });
}

test('parses the last structured Housekeeper status without accepting arbitrary output', () => {
  const parsed = parseHousekeeperStatus([
    'noise',
    '[HOUSEKEEP] status={"ignitionStatus":"BLOCKED","ignitionSourceDirtCount":6,"ignitionHardBlockCount":0,"ignitionReadyToEnterCommandDeck":false}',
  ].join('\n'));
  assert.equal(parsed.ignitionSourceDirtCount, 6);
  assert.equal(parseHousekeeperStatus('not-json'), null);
});

test('projects source dirt as BLOCKED with read-only scheduled authority', () => {
  const proof = projectSyncHousekeeperEvidence({
    rawStatus: {
      ignitionStatus: 'BLOCKED',
      ignitionSourceDirtCount: 6,
      ignitionHardBlockCount: 0,
      ignitionAutoCleaned: 0,
      ignitionRuntimeCleaned: 0,
      ignitionOpenClawWorkspaceMoved: 0,
      ignitionReadyToEnterCommandDeck: false,
    },
    sourceHead: HEAD,
    observedAtUtc: '2026-08-30T07:00:00.000Z',
    execution: { status: 0 },
  });
  assert.equal(proof.state, 'BLOCKED');
  assert.equal(proof.sourceDirtCount, 6);
  assert.equal(proof.unknownDirtCount, 0);
  assert.equal(proof.classificationOnly, true);
  assert.equal(proof.sourceMutationAllowed, false);
  assert.equal(proof.destructiveCleanupAllowed, false);
  assert.deepEqual(proof.errorCodes, ['HOUSEKEEPER_SOURCE_DIRT_PRESENT']);
});

test('fails closed when Housekeeper output or exact source head is unproven', () => {
  const missingStatus = projectSyncHousekeeperEvidence({ rawStatus: null, sourceHead: HEAD });
  assert.equal(missingStatus.state, 'UNPROVEN');
  assert.equal(missingStatus.errorCount, 1);
  const missingHead = projectSyncHousekeeperEvidence({ rawStatus: { ignitionStatus: 'READY' }, sourceHead: 'short' });
  assert.equal(missingHead.state, 'UNPROVEN');
  assert.equal(missingHead.blocker, 'HOUSEKEEPER_SOURCE_HEAD_UNPROVEN');
});

test('non-dirty sync never invokes Housekeeper or persistence', async () => {
  let housekeeperCalls = 0;
  let persistenceCalls = 0;
  const result = await runBattleBridgeSyncHousekeeperBridge({
    paths: PATHS,
    expectedPaths: PATHS,
    syncRunner: async () => ({ ok: true, sourceHead: HEAD, syncClassification: 'SYNC_NO_CHANGE', finalVerdict: 'SYNC_AND_REFRESH_PASS' }),
    housekeeperAdapter: { run() { housekeeperCalls += 1; return {}; } },
    persistHousekeeper: async () => { persistenceCalls += 1; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.housekeeperAttempted, false);
  assert.equal(housekeeperCalls, 0);
  assert.equal(persistenceCalls, 0);
});

test('dirty sync invokes exactly one Housekeeper classification and persists exact-head evidence', async () => {
  let housekeeperCalls = 0;
  const persisted = [];
  const result = await runBattleBridgeSyncHousekeeperBridge({
    paths: PATHS,
    expectedPaths: PATHS,
    syncRunner: async () => dirtySync(),
    housekeeperAdapter: {
      run() {
        housekeeperCalls += 1;
        return {
          execution: { ok: true, status: 0 },
          rawStatus: {
            ignitionStatus: 'BLOCKED',
            ignitionSourceDirtCount: 6,
            ignitionHardBlockCount: 0,
            ignitionAutoCleaned: 0,
            ignitionRuntimeCleaned: 0,
            ignitionOpenClawWorkspaceMoved: 0,
            ignitionReadyToEnterCommandDeck: false,
          },
        };
      },
    },
    persistHousekeeper: async ({ housekeeper }) => {
      persisted.push(housekeeper);
      return { ok: true, path: PATHS.syncStatusPath };
    },
    now: () => new Date('2026-08-30T07:00:00.000Z'),
  });
  assert.equal(housekeeperCalls, 1);
  assert.equal(persisted.length, 1);
  assert.equal(result.housekeeperAttempted, true);
  assert.equal(result.housekeeper.state, 'BLOCKED');
  assert.equal(result.housekeeper.head, HEAD);
  assert.equal(result.housekeeper.sourceDirtCount, 6);
  assert.equal(result.ok, false);
});

test('Housekeeper evidence persistence failure remains a hard sync blocker', async () => {
  const result = await runBattleBridgeSyncHousekeeperBridge({
    paths: PATHS,
    expectedPaths: PATHS,
    syncRunner: async () => dirtySync(),
    housekeeperAdapter: {
      run() {
        return {
          execution: { ok: true, status: 0 },
          rawStatus: {
            ignitionStatus: 'READY',
            ignitionSourceDirtCount: 0,
            ignitionHardBlockCount: 0,
            ignitionAutoCleaned: 0,
            ignitionRuntimeCleaned: 0,
            ignitionOpenClawWorkspaceMoved: 0,
            ignitionReadyToEnterCommandDeck: true,
          },
        };
      },
    },
    persistHousekeeper: async () => ({ ok: false, blocker: 'WRITE_FAILED' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WRITE_FAILED');
  assert.equal(result.finalVerdict, 'SYNC_HOUSEKEEPER_BRIDGE_BLOCKED');
});
