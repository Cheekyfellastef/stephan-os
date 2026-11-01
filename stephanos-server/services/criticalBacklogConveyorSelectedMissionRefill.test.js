import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchElasticGoalBuilds } from './criticalBacklogConveyorServiceCore.js';

const now = new Date('2026-09-12T17:30:00.000Z');
const paths = Object.freeze({
  repoRoot: '/repo',
  workspaceRoot: '/workspace',
  orchestratorRoot: '/orchestrator',
  snapshotRoot: '/snapshots',
});

function elasticImplementationMission(issueNumber) {
  return {
    missionId: `critical-${issueNumber}-elastic-goal`,
    title: `Elastic goal ${issueNumber}`,
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: `Advance durable goal #${issueNumber} through one bounded implementation lane.`,
    intendedOutcome: `Durable goal #${issueNumber} reaches its next governed source checkpoint.`,
    allowedFiles: [`shared/agents/elastic-goal-${issueNumber}.mjs`],
    requiredTests: [`node --test shared/agents/elastic-goal-${issueNumber}.test.mjs`],
    requiredEvidence: ['focused elastic-goal proof'],
    revision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    git: {
      branch: `openclaw/elastic-goal-${issueNumber}`,
      worktreePath: `/bounded/critical-${issueNumber}-elastic-goal`,
    },
  };
}

function capacityFor(mission) {
  return [{
    route: 'FOUNDRY_FORGE',
    adapter: 'foundry-forge',
    workerId: `forge-worker-${mission.missionId}`,
    receiptId: `capacity-${mission.missionId}`,
    proofRefs: [`proof-${mission.missionId}`],
  }];
}

test('scheduler-selected runnable mission consumes real provider capacity instead of a phantom reserved slot', async () => {
  const selected = elasticImplementationMission(2002);
  const other = elasticImplementationMission(2003);
  const capacityLookups = [];
  const publications = [];

  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1,
    selectedMission: selected,
    activeMissions: [],
    runnableMissions: [other, selected],
  }, {
    now,
    paths,
    sourceRevision: 'a'.repeat(40),
    resolveCapacityCandidates: (mission) => {
      capacityLookups.push(mission.missionId);
      return capacityFor(mission);
    },
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant);
      return { published: true, actionGrantAccepted: true, reason: 'published' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.availableSlots, 1);
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].missionId, selected.missionId);
  assert.equal(result.dispatched[0].adapter, 'foundry-forge');
  assert.deepEqual(capacityLookups, [selected.missionId]);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].missionId, selected.missionId);
  assert.equal(publications[0].workerId, `forge-worker-${selected.missionId}`);
  assert.equal(publications[0].mergeAuthority, false);
  assert.equal(publications[0].leaseSeizureAllowed, false);
  assert.deepEqual(result.held, []);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('already-running selected mission is never offered to a second provider writer', async () => {
  const selected = elasticImplementationMission(2004);
  let capacityLookups = 0;
  let publications = 0;

  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1,
    selectedMission: selected,
    activeMissions: [{
      ...selected,
      dispatch: {
        status: 'running',
        adapter: 'foundry-forge',
        workerId: 'existing-worker',
        capacityReceiptId: 'existing-capacity',
      },
    }],
    runnableMissions: [selected],
  }, {
    now,
    paths,
    sourceRevision: 'b'.repeat(40),
    resolveCapacityCandidates: () => {
      capacityLookups += 1;
      return capacityFor(selected);
    },
    publishWorkerAction: async () => {
      publications += 1;
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_NOT_REQUIRED');
  assert.equal(result.availableSlots, 0);
  assert.equal(result.dispatchCount, 0);
  assert.deepEqual(result.dispatched, []);
  assert.deepEqual(result.held, []);
  assert.equal(capacityLookups, 0);
  assert.equal(publications, 0);
  assert.equal(result.resourceDisjointOneWriterProven, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('grant validation mismatch fields survive the original handoff without leaking private paths or blocking disjoint work', async () => {
  const blockedMission = elasticImplementationMission(2005);
  const otherMission = elasticImplementationMission(2006);
  const publications = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 2,
    selectedMission: blockedMission,
    activeMissions: [],
    runnableMissions: [blockedMission, otherMission],
  }, {
    now,
    paths,
    sourceRevision: 'c'.repeat(40),
    resolveCapacityCandidates: capacityFor,
    publishWorkerAction: async ({ actionGrant }) => {
      publications.push(actionGrant.missionId);
      if (actionGrant.missionId === blockedMission.missionId) {
        return {
          published: false, actionGrantAccepted: false, reason: 'action-grant-mismatch',
          blockers: ['action-grant-pr-mismatch', 'action-grant-head-mismatch',
            'C:\\private\\secret', 'action-grant-pr-mismatch', 'unknown-secret'],
        };
      }
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.dispatched[0].missionId, otherMission.missionId);
  assert.deepEqual(publications, [blockedMission.missionId, otherMission.missionId]);
  assert.equal(result.held.length, 1);
  assert.equal(result.held[0].missionId, blockedMission.missionId);
  assert.equal(result.held[0].reason, 'EXTERNAL_DISPATCH_BLOCKED:action-grant-mismatch');
  assert.deepEqual(result.held[0].grantMismatchFields,
    ['action-grant-head-mismatch', 'action-grant-pr-mismatch']);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|C:\\\\/i);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('untrusted publication failures do not manufacture canonical mismatch fields', async () => {
  const mission = elasticImplementationMission(2007);
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1, selectedMission: mission, activeMissions: [], runnableMissions: [mission],
  }, {
    now, paths, sourceRevision: 'd'.repeat(40), resolveCapacityCandidates: capacityFor,
    publishWorkerAction: async () => ({
      published: false, actionGrantAccepted: false, reason: 'capacity-wait',
      blockers: ['action-grant-head-mismatch', 'C:\\private\\secret'],
    }),
  });
  assert.equal(result.dispatchCount, 0);
  assert.equal(result.held[0].reason, 'EXTERNAL_DISPATCH_BLOCKED:capacity-wait');
  assert.equal(Object.hasOwn(result.held[0], 'grantMismatchFields'), false);
});


test('unknown publisher outcome keeps its source scope and slot reserved while disjoint work continues', async () => {
  const uncertain = elasticImplementationMission(2101);
  const overlap = elasticImplementationMission(2102);
  overlap.allowedFiles = [...uncertain.allowedFiles];
  const disjoint = elasticImplementationMission(2103);
  const calls = [];
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 3, selectedMission: uncertain, activeMissions: [],
    runnableMissions: [uncertain, overlap, disjoint],
  }, {
    now, paths, sourceRevision: 'e'.repeat(40),
    resolveCapacityCandidates: capacityFor,
    publishWorkerAction: async ({ actionGrant }) => {
      calls.push(actionGrant.missionId);
      if (actionGrant.missionId === uncertain.missionId) {
        throw new Error('C:\\private\\PRIVATE_TOKEN_MUST_NOT_LEAK');
      }
      return { published: true, actionGrantAccepted: true };
    },
  });

  assert.deepEqual(calls, [uncertain.missionId, uncertain.missionId, disjoint.missionId]);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_LIVE');
  assert.equal(result.dispatchCount, 1);
  assert.equal(result.indeterminatePublicationCount, 1);
  assert.equal(result.responsibilityRetainedUntilPickup, true);
  assert.equal(result.pickupPendingCount, 1, 'only acknowledged dispatch is pickup-pending');
  assert.equal(result.handoffPublicationIsTerminal, false);
  assert.equal(result.dispatched[0].missionId, disjoint.missionId);
  assert.equal(result.held.length, 2);
  assert.equal(result.held[0].missionId, uncertain.missionId);
  assert.equal(result.held[0].reason,
    'EXTERNAL_DISPATCH_INDETERMINATE:publication-exception-reconciliation-exception');
  assert.equal(result.held[1].missionId, overlap.missionId);
  assert.equal(result.held[1].reason, 'RESOURCE_SCOPE_CONFLICT');
  assert.equal(result.resourceDisjointOneWriterProven, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN_MUST_NOT_LEAK|private/i);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('unknown publisher consumes the final slot instead of spawning an unrelated replacement', async () => {
  const uncertain = elasticImplementationMission(2104);
  const other = elasticImplementationMission(2105);
  let attempts = 0;
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1, selectedMission: uncertain, activeMissions: [],
    runnableMissions: [uncertain, other],
  }, {
    now, paths, sourceRevision: 'f'.repeat(40),
    resolveCapacityCandidates: capacityFor,
    publishWorkerAction: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('PRIVATE_TOKEN_MUST_NOT_LEAK');
      return { published: false, actionGrantAccepted: false,
        reason: 'PRIVATE_TOKEN_MUST_NOT_LEAK' };
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.classification, 'ELASTIC_EXTERNAL_BUILD_DISPATCH_HELD');
  assert.equal(result.dispatchCount, 0);
  assert.equal(result.indeterminatePublicationCount, 1);
  assert.equal(result.responsibilityRetainedUntilPickup, true);
  assert.equal(result.pickupPendingCount, 0, 'unknown publication must not be portrayed as a confirmed pending dispatch');
  assert.equal(result.handoffPublicationIsTerminal, false);
  assert.equal(result.held.length, 1);
  assert.equal(result.held[0].missionId, uncertain.missionId);
  assert.equal(result.held[0].reason,
    'EXTERNAL_DISPATCH_INDETERMINATE:publication-exception-reconciliation-publication-refused');
  assert.equal(result.resourceDisjointOneWriterProven, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN_MUST_NOT_LEAK/);
});

test('untrusted refusal reason cannot leak a provider error or masquerade as a grant validation result', async () => {
  const mission = elasticImplementationMission(2106);
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1, selectedMission: mission, activeMissions: [], runnableMissions: [mission],
  }, {
    now, paths, sourceRevision: 'a'.repeat(40),
    resolveCapacityCandidates: capacityFor,
    publishWorkerAction: async () => ({ published: false, actionGrantAccepted: false,
      reason: 'C:\\private\\PRIVATE_TOKEN_MUST_NOT_LEAK',
      blockers: ['action-grant-head-mismatch'] }),
  });

  assert.equal(result.dispatchCount, 0);
  assert.equal(result.indeterminatePublicationCount, 0);
  assert.equal(result.responsibilityRetainedUntilPickup, false);
  assert.equal(result.held[0].reason, 'EXTERNAL_DISPATCH_BLOCKED:publication-refused');
  assert.equal(Object.hasOwn(result.held[0], 'grantMismatchFields'), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN_MUST_NOT_LEAK|private/i);
});
