import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectFlywheelRepairDemandV1,
  reconcileFlywheelRepairDemandAdmissionV1,
} from './flywheelRepairDemandV1.mjs';
import { createSharedWorkspaceHandoffRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW = Date.parse('2026-09-20T15:00:00.000Z');

function handoff(overrides = {}) {
  const body = {
    schemaVersion: 'stephanos.flywheel-repair-patrol-runner.v1',
    continuation: {
      kind: 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED',
      ownerResolutionRequired: false,
      nextAction: 'ROUTE_DECLARED_OWNED_GAPS_TO_EXISTING_CONSUMERS',
      repairRoutes: [{
        findingId: 'research-execution-gap',
        canonicalOwner: '#1902',
        downstreamOwner: '#1556',
      }],
    },
    constraints: {
      existingOwnerFirst: true,
      duplicateGoalForbidden: true,
      duplicateControllerForbidden: true,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      authorityWideningAllowed: false,
    },
    ...overrides.body,
  };
  return createSharedWorkspaceHandoffRecord({
    handoffId: 'flywheel-repair-owned-gap',
    participantId: 'flywheel-repair-patrol',
    fromParticipantId: 'flywheel-repair-patrol',
    toParticipantId: 'mission-orchestrator',
    timestampUtc: new Date(NOW).toISOString(),
    correlationId: 'flywheel-repair-owned-gap',
    relatedIssue: '#1903',
    proofRefs: ['proof/flywheel-repair-patrol.json'],
    summary: 'Known owned repair gap.',
    body: JSON.stringify(body),
    ...overrides.record,
  });
}

function scheduler(lifecycle = 'READY', overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-scheduler.v1',
    activeGoals: [],
    parallelCandidateDetails: lifecycle === 'READY'
      ? [{ candidateId: '#1902', issue: 1902, route: 'CHATGPT_GITHUB', resourceIds: ['repo:cheekyfellastef/stephan-os:path:shared/agents'] }]
      : [],
    portfolio: [{ issue: 1902, lifecycle, route: 'CHATGPT_GITHUB' }],
    ...overrides,
  };
}

test('known owned repair becomes actionable only when canonical scheduler already exposes the owner as READY', () => {
  const result = projectFlywheelRepairDemandV1({ handoff: handoff(), scheduler: scheduler(), nowMs: NOW });
  assert.equal(result.valid, true);
  assert.equal(result.state, 'REPAIR_DEMAND_PRESENT');
  assert.equal(result.actionableRouteCount, 1);
  assert.equal(result.unresolvedRouteCount, 0);
  assert.equal(result.routes[0].canonicalOwner, '#1902');
  assert.equal(result.routes[0].downstreamOwner, '#1556');
  assert.equal(result.routes[0].disposition, 'READY_FOR_EXISTING_ELASTIC_ADMISSION');
  assert.equal(result.authority.schedulerMutationAllowed, false);
  assert.equal(result.authority.dispatchAllowed, false);
});

test('completed owner remains visible but cannot be silently reopened by patrol demand', () => {
  const result = projectFlywheelRepairDemandV1({ handoff: handoff(), scheduler: scheduler('COMPLETE'), nowMs: NOW });
  assert.equal(result.valid, true);
  assert.equal(result.actionableRouteCount, 0);
  assert.equal(result.routes[0].disposition, 'WAITING_FOR_CANONICAL_SCHEDULER_COMPLETE');
  assert.equal(result.routes[0].schedulerMutationPerformed, false);
  assert.equal(result.routes[0].missionCreationPerformed, false);
});

test('active canonical owner is recognized without creating another mission', () => {
  const result = projectFlywheelRepairDemandV1({
    handoff: handoff(),
    scheduler: scheduler('ACTIVE', { activeGoals: ['#1902'], parallelCandidateDetails: [] }),
    nowMs: NOW,
  });
  assert.equal(result.routes[0].disposition, 'EXISTING_OWNER_ACTIVE');
  assert.equal(result.actionableRouteCount, 1);
});

test('downstream owner other than the mission scheduler cannot ride the #1556 consumer', () => {
  const record = handoff({
    body: {
      continuation: {
        kind: 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED',
        ownerResolutionRequired: false,
        nextAction: 'ROUTE_DECLARED_OWNED_GAPS_TO_EXISTING_CONSUMERS',
        repairRoutes: [{ findingId: 'method-gap', canonicalOwner: '#1607', downstreamOwner: '#1607' }],
      },
    },
  });
  const result = projectFlywheelRepairDemandV1({ handoff: record, scheduler: scheduler(), nowMs: NOW });
  assert.equal(result.routes[0].disposition, 'DOWNSTREAM_OWNER_NOT_MISSION_SCHEDULER');
  assert.equal(result.actionableRouteCount, 0);
});

test('elastic admission receipt converts READY repair demand into routed proof without adding authority', () => {
  const demand = projectFlywheelRepairDemandV1({ handoff: handoff(), scheduler: scheduler(), nowMs: NOW });
  const routed = reconcileFlywheelRepairDemandAdmissionV1(demand, {
    admittedIssueNumbers: [1902],
    activeMissions: [],
  });
  assert.equal(routed.state, 'REPAIR_DEMAND_ROUTED');
  assert.equal(routed.routedRouteCount, 1);
  assert.equal(routed.routes[0].disposition, 'ROUTED_TO_EXISTING_ELASTIC_ADMISSION');
  assert.equal(routed.authority.goalCreationAllowed, false);
  assert.equal(routed.authority.mergeAllowed, false);
});

test('malformed or stale patrol handoff cannot manufacture scheduler work', () => {
  const widened = handoff({ body: { constraints: {
    existingOwnerFirst: true,
    duplicateGoalForbidden: true,
    duplicateControllerForbidden: true,
    sourceMutationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    authorityWideningAllowed: false,
  } } });
  const invalid = projectFlywheelRepairDemandV1({ handoff: widened, scheduler: scheduler(), nowMs: NOW });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.state, 'BLOCKED');

  const stale = projectFlywheelRepairDemandV1({
    handoff: handoff({ record: { timestampUtc: new Date(NOW - (2 * 60 * 60_000)).toISOString() } }),
    scheduler: scheduler(),
    nowMs: NOW,
  });
  assert.equal(stale.valid, false);
  assert.equal(stale.state, 'BLOCKED');
});
