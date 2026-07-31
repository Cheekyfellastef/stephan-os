import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
} from './programmeAuthorityV1.mjs';
import {
  reconcileDurableFlywheelController,
  renderDurableFlywheelReceipt,
  runDurableFlywheelStartupCycle,
} from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-07-30T13:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const LANE_HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const LANE_ID = 'goal-1497-pr-1617';
const BRANCH = 'feat/durable-flywheel-controller-vnext';

function projection(status = 'IDLE', overrides = {}) {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status,
    finalVerdict: status === 'HOLD'
      ? 'AUTHORITATIVE_PROGRAMME_PROJECTION_HOLD'
      : 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: null,
    mutationLease: null,
    projectionReceipt: {
      schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
      receiptId: 'programme-projection-20260730130000',
      status,
      chatMemoryAuthoritative: false,
      sourceConstructionMode: 'production-contracts',
      mergeAuthority: false,
      workerAuthorityOwnedByController: false,
      schedulerAuthorityOwnedByController: false,
      boundedMutationStepsPerCycle: 1,
    },
    ...overrides,
  };
}

function activeProjection(overrides = {}) {
  return projection('ACTIVE', {
    lane: {
      valid: true,
      active: true,
      terminal: false,
      laneId: LANE_ID,
      repository: REPOSITORY,
      issueNumber: 1497,
      prNumber: 1617,
      branch: BRANCH,
      headSha: LANE_HEAD,
    },
    mutationLease: {
      leaseId: 'lease-goal-1497-pr-1617',
      ownerId: 'mission-worker',
    },
    criticalBacklog: {
      activeMission: {
        missionId: 'critical-1497-controller-test',
        revision: 4,
        currentPhase: 'CHECK_PULL_REQUEST',
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617, headSha: LANE_HEAD },
      },
    },
    ...overrides,
  });
}

function machineryFor(authoritativeProjection, overrides = {}) {
  const heartbeats = [];
  const receipts = [];
  return {
    heartbeats,
    receipts,
    machinery: {
      publishControllerHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ok: true };
      },
      loadAuthoritativeProjection: async () => authoritativeProjection,
      publishReceipt: async (receipt) => {
        receipts.push(receipt);
        return { ok: true };
      },
      ensureBacklogMission: async () => ({
        ok: true,
        createdMission: false,
        projection: {
          activeMission: {
            missionId: 'critical-1497-controller-test',
            revision: 0,
            currentPhase: 'LIVE_RUNTIME_INVESTIGATION',
            repository: REPOSITORY,
          },
        },
      }),
      finalizeTerminalLane: async () => ({ ok: true }),
      ...overrides,
    },
  };
}

test('production canonical ACTIVE projection authorizes one existing worker tick', async () => {
  const fixture = machineryFor(activeProjection());
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.action, 'ADVANCE_EXISTING_ACTIVE_LANE');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.boundedMutationSteps, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.deepEqual(
    fixture.heartbeats.map(({ cycleState }) => cycleState),
    ['STARTING', 'ACTIVE_LANE', 'ACTIVE_LANE'],
  );
  assert.equal(result.workerActionGrant.missionId, 'critical-1497-controller-test');
  assert.equal(result.workerActionGrant.actionId.includes('critical-1497-controller-test'), true);
  assert.equal(result.workerActionGrant.boundedActionCount, 1);
  assert.equal(fixture.receipts.length, 1);
  assert.equal(fixture.receipts[0].repository, REPOSITORY);
  assert.equal(fixture.receipts[0].prNumber, 1617);
  assert.equal(fixture.receipts[0].headSha, LANE_HEAD);
});

test('canonical HOLD projection preserves authority blockers and forbids work', async () => {
  const fixture = machineryFor(projection('HOLD', {
    blockers: [
      'lane:github-merge-evidence-incomplete',
      'execution:sourceHead mismatch',
      'critical-backlog-active-lane-pr-mismatch',
    ],
  }));
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.deepEqual(result.blockers, [
    'authoritative-programme-reconciliation-blocked',
    'authority:lane:github-merge-evidence-incomplete',
    'authority:execution:sourceHead mismatch',
    'authority:critical-backlog-active-lane-pr-mismatch',
  ]);
  assert.deepEqual(
    fixture.heartbeats.map(({ cycleState }) => cycleState),
    ['STARTING', 'HOLD'],
  );
});

test('non-production, memory-authoritative, malformed, and unknown projections fail closed', () => {
  const cases = [
    [
      projection('IDLE', { schemaVersion: 'legacy.parallel-authority.v1' }),
      'authoritative-programme-projection-schema-mismatch',
    ],
    [
      projection('IDLE', { sourceConstructionMode: 'deterministic-testing-seam' }),
      'authoritative-programme-projection-not-production-constructed',
    ],
    [
      projection('IDLE', { chatMemoryAuthoritative: true }),
      'chat-memory-authority-not-explicitly-disabled',
    ],
    [
      projection('UNRECOGNIZED'),
      'authoritative-programme-status-invalid',
    ],
    [
      null,
      'authoritative-programme-projection-invalid',
    ],
  ];

  for (const [candidate, expectedBlocker] of cases) {
    const result = reconcileDurableFlywheelController(candidate, {
      nowUtc: NOW,
      sourceRevision: SOURCE_REVISION,
    });
    assert.equal(result.status, 'HOLD');
    assert.equal(result.allowWorkerTick, false);
    assert.ok(result.blockers.includes(expectedBlocker));
  }
});

test('explicit observation time and exact source revision are mandatory', () => {
  const missingTime = reconcileDurableFlywheelController(
    projection('IDLE', { observedAtUtc: undefined }),
    {
    sourceRevision: SOURCE_REVISION,
    },
  );
  assert.ok(missingTime.blockers.includes('controller-observation-time-invalid'));

  const missingRevision = reconcileDurableFlywheelController(projection(), {
    nowUtc: NOW,
  });
  assert.ok(missingRevision.blockers.includes('controller-source-revision-invalid'));
  assert.equal(missingRevision.allowWorkerTick, false);
});

test('invalid startup source revision publishes a durable HOLD without touching authority services', async () => {
  let authorityCalls = 0;
  const receipts = [];
  const result = await runDurableFlywheelStartupCycle({
    publishControllerHeartbeat: async () => {
      authorityCalls += 1;
      return { ok: true };
    },
    loadAuthoritativeProjection: async () => {
      authorityCalls += 1;
      return projection();
    },
    publishReceipt: async (receipt) => {
      receipts.push(receipt);
      return { ok: true };
    },
  }, {
    nowUtc: NOW,
    sourceRevision: 'not-a-sha',
    env: {},
  });

  assert.equal(result.status, 'HOLD');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(authorityCalls, 0);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].action, 'HOLD');
});

test('IDLE waits without mutation and renders its authority posture', async () => {
  const fixture = machineryFor(projection('IDLE'));
  const result = await runDurableFlywheelStartupCycle(fixture.machinery, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });
  const rendered = renderDurableFlywheelReceipt(result);

  assert.equal(result.status, 'IDLE');
  assert.equal(result.allowWorkerTick, false);
  assert.equal(result.boundedMutationSteps, 0);
  assert.match(rendered, /Status: IDLE/);
  assert.match(rendered, /Worker-Tick-Allowed: false/);
  assert.match(rendered, /Merge-Authority: false/);
  assert.match(rendered, /Lease-Seizure-Allowed: false/);
  assert.match(rendered, /Blockers: none/);
});
