import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA } from './programmeAuthorityV1.mjs';
import { runDurableFlywheelStartupCycle } from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-09-22T17:20:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const LANE_ID = 'ignition-pr-2012-repair';
const BRANCH = 'codex/ignition-browser-window-idempotence';
const LEASE_ID = 'lease-ignition-pr-2012-codex-app';
const OWNER_ID = 'codex-app-root';

function terminalLane(overrides = {}) {
  return {
    valid: true,
    active: false,
    terminal: true,
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 2012,
    prNumber: 2012,
    branch: BRANCH,
    headSha: HEAD,
    mergeEvidence: {
      affirmativelyMerged: true,
      merged: true,
      prState: 'CLOSED',
      prNumber: 2012,
      headSha: HEAD,
      mergeCommitSha: 'c'.repeat(40),
      mergedAt: '2026-08-26T13:48:04.000Z',
    },
    ...overrides,
  };
}

function heartbeatProjection(input = {}) {
  const successful = Boolean(input.lastSuccessfulReconciliationUtc && input.lastPublishedReceiptId);
  return {
    valid: true,
    fresh: true,
    cycleState: input.cycleState,
    activeLaneId: input.activeLaneId || null,
    boundedMutationSteps: input.boundedMutationSteps === 1 ? 1 : 0,
    reconciliationSucceeded: successful,
    lastSuccessfulReconciliationUtc: successful ? input.lastSuccessfulReconciliationUtc : null,
    lastPublishedReceiptId: successful ? input.lastPublishedReceiptId : '',
  };
}

function projectionForHeartbeat(input, overrides = {}) {
  const heartbeat = heartbeatProjection(input);
  const terminalAuthorityProven = heartbeat.cycleState === 'FINALIZING'
    && heartbeat.activeLaneId === LANE_ID
    && heartbeat.reconciliationSucceeded
    && heartbeat.boundedMutationSteps === 1;
  const terminalTransitionStarted = heartbeat.cycleState === 'FINALIZING'
    && heartbeat.activeLaneId === LANE_ID;
  const blockers = [
    ...(!terminalTransitionStarted ? [
      'controller-heartbeat-cycle-state-does-not-authorize-terminal-reconciliation',
      'controller-heartbeat-terminal-lane-mismatch',
    ] : []),
    ...(!terminalAuthorityProven ? ['controller-heartbeat-terminal-lane-authority-unproven'] : []),
    'worker-heartbeat-stale',
  ];
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status: 'HOLD',
    finalVerdict: 'AUTHORITATIVE_PROGRAMME_PROJECTION_HOLD',
    observedAtUtc: NOW,
    blockers,
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: terminalLane(),
    mutationLease: {
      leaseId: LEASE_ID,
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 2012,
      prNumber: 2012,
      branch: BRANCH,
      headSha: HEAD,
      ownerId: OWNER_ID,
    },
    controllerHeartbeat: heartbeat,
    scheduler: {},
    criticalBacklog: {},
    projectionReceipt: {
      receiptId: 'programme-projection-terminal-cleanup',
    },
    ...overrides,
  };
}

function terminalCleanupFixture({ laneOverrides = {} } = {}) {
  const heartbeats = [];
  const receipts = [];
  const finalizations = [];
  let latestHeartbeat = null;
  return {
    heartbeats,
    receipts,
    finalizations,
    machinery: {
      publishControllerHeartbeat: async (input) => {
        latestHeartbeat = input;
        heartbeats.push(input);
        return { ok: true };
      },
      loadAuthoritativeProjection: async () => projectionForHeartbeat(latestHeartbeat, {
        lane: terminalLane(laneOverrides),
      }),
      publishReceipt: async (receipt) => {
        receipts.push(receipt);
        return { ok: true };
      },
      finalizeTerminalLane: async (identity) => {
        finalizations.push(identity);
        return { ok: true, finalized: true, reason: 'TERMINAL_LANE_FINALIZED' };
      },
      ensureBacklogMission: async () => {
        throw new Error('terminal cleanup must not create a mission');
      },
      loadCapacityRoutingInput: async () => {
        throw new Error('terminal cleanup must not route source capacity');
      },
    },
  };
}

test('exact merged terminal lease finalizes despite unrelated programme HOLD after FINALIZING authority is proven', async () => {
  const fixture = terminalCleanupFixture();
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'TERMINAL_RECONCILIATION_REQUIRED');
  assert.equal(result.action, 'FINALIZE_EXACT_TERMINAL_LANE');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(result.boundedMutationSteps, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(fixture.finalizations.length, 1);
  assert.deepEqual(fixture.finalizations[0], {
    leaseId: LEASE_ID,
    laneId: LANE_ID,
    repository: REPOSITORY,
    issueNumber: 2012,
    prNumber: 2012,
    branch: BRANCH,
    headSha: HEAD,
    ownerId: OWNER_ID,
    nowUtc: NOW,
  });
  assert.deepEqual(
    fixture.heartbeats.map(({ cycleState }) => cycleState),
    ['STARTING', 'FINALIZING', 'FINALIZING', 'IDLE'],
  );
  assert.equal(result.actionResult?.finalized, true);
  assert.equal(result.authoritativeProjection.blockers.includes('worker-heartbeat-stale'), true);
});

test('invalid or non-affirmative terminal identity never gains cleanup authority', async () => {
  const fixture = terminalCleanupFixture({
    laneOverrides: {
      valid: false,
      mergeEvidence: {
        affirmativelyMerged: false,
        merged: false,
        prState: 'CLOSED',
      },
    },
  });
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(fixture.finalizations.length, 0);
  assert.equal(fixture.heartbeats.some(({ boundedMutationSteps }) => boundedMutationSteps === 1), false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
});
