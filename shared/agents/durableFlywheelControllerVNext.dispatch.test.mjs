import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA } from './programmeAuthorityV1.mjs';
import { runDurableFlywheelStartupCycle } from './durableFlywheelControllerVNext.mjs';

const NOW = '2026-09-01T15:30:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'feat/durable-flywheel-controller-vnext';

function activeProjection() {
  return {
    schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
    status: 'ACTIVE',
    finalVerdict: 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    observedAtUtc: NOW,
    blockers: [],
    chatMemoryAuthoritative: false,
    sourceConstructionMode: 'production-contracts',
    lane: {
      valid: true,
      active: true,
      terminal: false,
      laneId: 'critical-1497-controller-test',
      repository: REPOSITORY,
      issueNumber: 1497,
      prNumber: 1617,
      branch: BRANCH,
      headSha: HEAD,
    },
    mutationLease: {
      leaseId: 'lease-critical-1497-controller-test',
      ownerId: 'mission-worker',
    },
    criticalBacklog: {
      activeMission: {
        missionId: 'critical-1497-controller-test',
        revision: 4,
        currentPhase: 'CHECK_PULL_REQUEST',
        repository: REPOSITORY,
        git: { branch: BRANCH },
        pullRequest: { number: 1617, headSha: HEAD },
      },
    },
    projectionReceipt: {
      schemaVersion: AUTHORITATIVE_PROGRAMME_PROJECTION_SCHEMA,
      receiptId: 'programme-projection-dispatch-test',
      status: 'ACTIVE',
      chatMemoryAuthoritative: false,
      sourceConstructionMode: 'production-contracts',
      mergeAuthority: false,
      workerAuthorityOwnedByController: false,
      schedulerAuthorityOwnedByController: false,
      boundedMutationStepsPerCycle: 1,
    },
  };
}

function machinery(projection) {
  const dispatches = [];
  return {
    dispatches,
    value: {
      publishControllerHeartbeat: async () => ({ ok: true }),
      loadAuthoritativeProjection: async () => projection,
      publishReceipt: async () => ({ ok: true }),
      finalizeTerminalLane: async () => ({ ok: true }),
      ensureBacklogMission: async () => ({ ok: false, classification: 'not-used' }),
      loadCapacityRoutingInput: async () => null,
      publishWorkerAction: async (options) => {
        dispatches.push(options.actionGrant);
        return {
          published: true,
          actionGrantAccepted: true,
          reason: '',
          action: { actionId: options.actionGrant.actionId },
        };
      },
    },
  };
}

test('ACTIVE controller publishes the exact worker action instead of only reporting a worker tick grant', async () => {
  const fixture = machinery(activeProjection());
  const result = await runDurableFlywheelStartupCycle(fixture.value, {
    nowUtc: NOW,
    sourceRevision: SOURCE_REVISION,
    env: {},
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.action, 'ADVANCE_EXISTING_ACTIVE_LANE');
  assert.equal(result.allowWorkerTick, true);
  assert.equal(result.workerActionDispatchPublished, true);
  assert.equal(result.workerActionGrant.boundedActionCount, 1);
  assert.equal(fixture.dispatches.length, 1);
  assert.equal(fixture.dispatches[0].missionId, 'critical-1497-controller-test');
  assert.equal(fixture.dispatches[0].sourceRevision, SOURCE_REVISION);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
});
