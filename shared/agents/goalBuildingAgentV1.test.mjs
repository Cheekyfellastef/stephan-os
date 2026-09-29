import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GOAL_BUILDING_AGENT_CLASS,
  GOAL_BUILDING_AGENT_ID,
  GOAL_BUILDING_AGENT_QA_CAPABILITY,
  GOAL_BUILDING_AGENT_SCHEMA_VERSION,
  GOAL_BUILDING_BLOCKER_ROUTES,
  GOAL_BUILDING_OPERATING_STATES,
  answerGoalBuildingQuestion,
  buildGoalBuildingAgentReadiness,
  createGoalBuildingAgentCapabilityRecord,
  createGoalBuildingAgentParticipantStatusRecord,
  createGoalBuildingAgentWorkspaceRecords,
  evaluateGoalBuildingProgramme,
} from './goalBuildingAgentV1.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const HEAD = '3b4709fc203e055084c668998490d99d4384521b';
const PREDECESSOR = 'f60765af26d44f73290e148e882ec13f608a7087';
const NOW = '2026-08-25T16:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const PROOF_REFS = ['proofs/goal-building-agent-v1.json'];

function observed(minutesAgo = 1) {
  return new Date(NOW_MS - minutesAgo * 60 * 1000).toISOString();
}

function surface(id, state, options = {}) {
  return {
    id,
    state,
    observedAtUtc: options.observedAtUtc || observed(1),
    head: options.head === undefined ? HEAD : options.head,
    blocker: options.blocker || '',
  };
}

function healthySurfaces(overrides = {}) {
  const defaults = {
    sourceSync: surface('sourceSync', 'SYNC_NO_CHANGE'),
    scheduler: surface('scheduler', 'ACTIVE'),
    continuityController: surface('continuityController', 'ACTIVE'),
    missionWorker: surface('missionWorker', 'RUNNING'),
    providerRouter: surface('providerRouter', 'ROUTING', { head: '' }),
    proofRoute: surface('proofRoute', 'READY', { head: '' }),
    reviewRoute: surface('reviewRoute', 'READY', { head: '' }),
    statusFabric: surface('statusFabric', 'READY'),
  };
  return Object.values({ ...defaults, ...overrides });
}

function activeMission(overrides = {}) {
  return {
    missionId: 'mission-goal-building-v1',
    goalId: 'goal-2002',
    laneId: 'lane-1',
    ownerId: GOAL_BUILDING_AGENT_ID,
    phase: 'IMPLEMENT',
    authorityHead: HEAD,
    observedAtUtc: observed(1),
    lastProgressAtUtc: observed(2),
    nextAction: 'Run the focused implementation proof and publish its durable result.',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    expectedHead: HEAD,
    protectedMainHead: HEAD,
    installedMainHead: HEAD,
    physicalExecutionRequired: false,
    surfaces: healthySurfaces(),
    programme: {
      activeMissions: [activeMission()],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
    blockers: [],
    operatorAction: { required: false, target: '' },
    validationOptions: { nowMs: NOW_MS },
    ...overrides,
  };
}

test('participant capability is fixed to read-first programme governance with no implicit authority', () => {
  const capability = createGoalBuildingAgentCapabilityRecord({
    timestampUtc: NOW,
    proofRefs: PROOF_REFS,
  });

  assert.equal(capability.agentId, GOAL_BUILDING_AGENT_ID);
  assert.equal(capability.agentClass, GOAL_BUILDING_AGENT_CLASS);
  assert.equal(capability.participantSchemaVersion, GOAL_BUILDING_AGENT_SCHEMA_VERSION);
  assert.equal(capability.qaCapability, GOAL_BUILDING_AGENT_QA_CAPABILITY);
  assert.equal(capability.lifecycleState, 'READ_ONLY_CANDIDATE');
  assert.equal(capability.mutationAuthority, 'NONE_BY_PARTICIPATION');
  assert.equal(capability.implementationAuthority, 'GOVERNED_TASK_CONTRACT_REQUIRED');
  assert.equal(capability.trustedBuilder, false);
  assert.equal(capability.mergeAuthority, false);
  assert.equal(capability.deploymentAuthority, false);
  assert.equal(capability.arbitraryShellAllowed, false);
  assert.equal(capability.leaseSeizureAllowed, false);
  assert.equal(capability.selfPromotionAllowed, false);
});

test('participant readiness requires proof and validates through the canonical Shared Workspace record gate', () => {
  const capability = createGoalBuildingAgentCapabilityRecord({ timestampUtc: NOW, proofRefs: PROOF_REFS });
  const readiness = buildGoalBuildingAgentReadiness({
    capability,
    validationOptions: { nowMs: NOW_MS },
  });
  const validation = validateSharedWorkspaceRecord(capability, { nowMs: NOW_MS });

  assert.equal(validation.valid, true);
  assert.equal(validation.stale, false);
  assert.equal(readiness.readyForSharedWorkspaceRegistration, true);
  assert.equal(readiness.productionEligible, false);
  assert.equal(readiness.implementationEligible, false);
  assert.deepEqual(readiness.blockers, []);
});

test('fresh current-head machinery plus durable mission progress proves active autonomous building', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput());

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(certificate.isCapableOfBuilding, true);
  assert.equal(certificate.isActuallyBuilding, true);
  assert.equal(certificate.programmeMode, 'ACTIVE_PROGRESS_PROVEN');
  assert.equal(certificate.productiveMissionCount, 1);
  assert.equal(certificate.idleQualifiedCapacity, 0);
  assert.deepEqual(certificate.evidenceProblems, []);
  assert.deepEqual(certificate.blockingReasons, []);
  assert.deepEqual(certificate.degradedReasons, []);
  assert.match(certificate.summary, /actively building 1 mission/);
});

test('a running worker on a predecessor head cannot be reported as building', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    surfaces: healthySurfaces({
      missionWorker: surface('missionWorker', 'RUNNING', { head: PREDECESSOR }),
    }),
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.equal(certificate.isCapableOfBuilding, false);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.ok(certificate.blockingReasons.includes('surface-head-mismatch:missionWorker'));
});

test('process presence without recent durable mission progress is not active building', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [activeMission({ lastProgressAtUtc: observed(45) })],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.equal(certificate.stalledMissionCount, 1);
  assert.ok(certificate.blockingReasons.includes('all-active-missions-not-progressing'));
});

test('eligible work left beside idle qualified capacity degrades but does not hide useful progress', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [activeMission()],
      eligibleQueuedGoalCount: 1,
      qualifiedCapacity: 2,
      idleQualifiedCapacity: 1,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.DEGRADED);
  assert.equal(certificate.isActuallyBuilding, true);
  assert.ok(certificate.degradedReasons.includes('eligible-work-left-idle'));
});

test('an eligible queue with no active mission is a real programme blocker', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [],
      eligibleQueuedGoalCount: 2,
      qualifiedCapacity: 2,
      idleQualifiedCapacity: 2,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.ok(certificate.blockingReasons.includes('eligible-goals-without-active-mission'));
});

test('owned governed approval boundaries can remain fully operational without pretending work is progressing', () => {
  const waiting = activeMission({
    phase: 'WAITING_FOR_OPERATOR',
    nextAction: 'Request the exact protected merge authorization for PR #2002 when its immutable tuple is ready.',
  });
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [waiting],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
    blockers: [{
      blockerId: 'operator-boundary-2002',
      severity: 'P1',
      ownerId: GOAL_BUILDING_AGENT_ID,
      route: 'REQUEST_EXACT_OPERATOR_APPROVAL',
      missionId: waiting.missionId,
      goalId: waiting.goalId,
      firstObservedAtUtc: observed(3),
      nextAction: waiting.nextAction,
      independentWorkContinues: true,
    }],
    operatorAction: {
      required: true,
      target: 'Authorize only the exact reviewed source-admission tuple for PR #2002.',
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(certificate.isCapableOfBuilding, true);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.equal(certificate.waitingMissionCount, 1);
  assert.equal(certificate.operatorActionRequired, true);
  assert.match(certificate.summary, /fully accounted for/);
});

test('a waiting or blocked mission without an explicit owner and repair route fails closed', () => {
  const mission = activeMission({ phase: 'WAITING_FOR_DEPENDENCY' });
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [mission],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.ok(certificate.blockingReasons.includes(`mission-blocker-unowned:${mission.missionId}`));
});

test('ownerless critical blockers cannot be painted green', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    blockers: [{
      blockerId: 'worker-watchdog-stale',
      severity: 'P1',
      ownerId: '',
      route: 'DELEGATE_BOUNDED_REPAIR',
      missionId: 'mission-goal-building-v1',
      goalId: 'goal-2002',
      firstObservedAtUtc: observed(2),
      nextAction: 'Delegate the existing watchdog repair contract.',
      independentWorkContinues: false,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.BLOCKED);
  assert.ok(certificate.blockingReasons.includes('blocker-owner-missing:worker-watchdog-stale'));
  assert.ok(certificate.blockingReasons.includes('programme-blocker:worker-watchdog-stale'));
});

test('duplicate, unknown and future-dated evidence enters SAFE_HOLD rather than reconciliation by guesswork', () => {
  const duplicate = surface('scheduler', 'ACTIVE');
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    surfaces: [
      ...healthySurfaces(),
      duplicate,
      surface('inventedController', 'READY', { head: '' }),
    ],
    programme: {
      activeMissions: [activeMission({ observedAtUtc: new Date(NOW_MS + 2 * 60 * 1000).toISOString() })],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 0,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('duplicate-surface:scheduler'));
  assert.ok(certificate.evidenceProblems.includes('unknown-surface:inventedController'));
  assert.ok(certificate.evidenceProblems.includes('mission-observation-future:mission-goal-building-v1'));
});

test('no eligible work can be fully operational while truthfully reporting that nothing is building', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [],
      eligibleQueuedGoalCount: 0,
      qualifiedCapacity: 5,
      idleQualifiedCapacity: 5,
    },
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(certificate.isCapableOfBuilding, true);
  assert.equal(certificate.isActuallyBuilding, false);
  assert.equal(certificate.programmeMode, 'IDLE_NO_ELIGIBLE_WORK');
  assert.match(certificate.summary, /correctly idle/);
});

test('Q&A explicitly distinguishes alive machinery from durable build progress', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    surfaces: healthySurfaces({
      missionWorker: surface('missionWorker', 'RUNNING', { head: PREDECESSOR }),
    }),
  }));
  const response = answerGoalBuildingQuestion({
    question: 'Is Stephanos actually building the goals now?',
    certificate,
  });

  assert.equal(response.questionKind, 'ACTIVE_BUILD_TRUTH');
  assert.equal(response.isActuallyBuilding, false);
  assert.match(response.answer, /^No\./);
  assert.match(response.answer, /not currently proven/);
});

test('Q&A exposes blocker ownership, next action and exact operator need from the same certificate', () => {
  const blocker = {
    blockerId: 'review-return-stalled',
    severity: 'P2',
    ownerId: 'independent-review-coordinator',
    route: GOAL_BUILDING_BLOCKER_ROUTES[2],
    missionId: 'mission-goal-building-v1',
    goalId: 'goal-2002',
    firstObservedAtUtc: observed(2),
    nextAction: 'Consume the existing authenticated review artifact without redispatch.',
    independentWorkContinues: false,
  };
  const certificate = evaluateGoalBuildingProgramme(baseInput({ blockers: [blocker] }));

  const ownership = answerGoalBuildingQuestion({ question: 'Who owns the blockers and who will fix them?', certificate });
  const next = answerGoalBuildingQuestion({ question: 'What happens next?', certificate });
  const operator = answerGoalBuildingQuestion({ question: 'Do you need me?', certificate });

  assert.match(ownership.answer, /review-return-stalled -> independent-review-coordinator/);
  assert.equal(next.answer, blocker.nextAction);
  assert.equal(operator.answer, 'No operator action is currently required.');
});

test('status projection is one bounded canonical participant record with closed safety locks', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput());
  const status = createGoalBuildingAgentParticipantStatusRecord({
    timestampUtc: NOW,
    correlationId: 'goal-building-agent-v1',
    proofRefs: PROOF_REFS,
    certificate,
    validationOptions: { nowMs: NOW_MS },
  });
  const validation = validateSharedWorkspaceRecord(status, { nowMs: NOW_MS });
  const body = JSON.parse(status.body);

  assert.equal(validation.valid, true);
  assert.equal(validation.stale, false);
  assert.equal(status.participantId, GOAL_BUILDING_AGENT_ID);
  assert.equal(status.relatedIssue, '#2002');
  assert.equal(status.status, GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL);
  assert.equal(body.isActuallyBuilding, true);
  assert.equal(body.safetyLocks.mutationAuthority, false);
  assert.equal(body.safetyLocks.mergeAuthority, false);
  assert.equal(body.safetyLocks.deploymentAuthority, false);
  assert.equal(body.safetyLocks.arbitraryShellAllowed, false);
});

test('workspace bundle keeps capability, readiness, certificate and status on one identity', () => {
  const bundle = createGoalBuildingAgentWorkspaceRecords({
    ...baseInput(),
    timestampUtc: NOW,
    correlationId: 'goal-building-agent-v1',
    proofRefs: PROOF_REFS,
  });

  assert.equal(bundle.schemaVersion, GOAL_BUILDING_AGENT_SCHEMA_VERSION);
  assert.equal(bundle.capability.agentId, GOAL_BUILDING_AGENT_ID);
  assert.equal(bundle.readiness.readyForSharedWorkspaceRegistration, true);
  assert.equal(bundle.certificate.participantId, GOAL_BUILDING_AGENT_ID);
  assert.equal(bundle.status.participantId, GOAL_BUILDING_AGENT_ID);
  assert.equal(bundle.validations.capability.valid, true);
  assert.equal(bundle.validations.status.valid, true);
});

test('missing publication proof produces a blocked status and never a ready participant receipt', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput());
  const status = createGoalBuildingAgentParticipantStatusRecord({
    timestampUtc: NOW,
    proofRefs: [],
    certificate,
    validationOptions: { nowMs: NOW_MS },
  });

  assert.equal(status.status, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.match(status.summary, /proof references are missing/);
  assert.equal(JSON.parse(status.body).publicationBlocker, 'participant-proof-required');
});

test('capability shape rejects unknown fields, authority widening and future-dated self-assertion', () => {
  const capability = {
    ...createGoalBuildingAgentCapabilityRecord({ timestampUtc: NOW, proofRefs: PROOF_REFS }),
    timestampUtc: new Date(NOW_MS + 2 * 60 * 1000).toISOString(),
    inventedAuthority: true,
    leaseSeizureAllowed: true,
  };
  const readiness = buildGoalBuildingAgentReadiness({
    capability,
    validationOptions: { nowMs: NOW_MS },
  });

  assert.equal(readiness.readyForSharedWorkspaceRegistration, false);
  assert.ok(readiness.blockers.includes('capability-unknown-field:inventedAuthority'));
  assert.ok(readiness.blockers.includes('capability-future-dated'));
  assert.ok(readiness.blockers.includes('lease-seizure-widened'));
});

test('present optional physical evidence is still validated and cannot conceal a contradiction', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    surfaces: [
      ...healthySurfaces(),
      surface('recoveryMesh', 'READY', { observedAtUtc: new Date(NOW_MS + 2 * 60 * 1000).toISOString(), head: '' }),
    ],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('surface-future:recoveryMesh'));
});

test('independent-work continuation must be derivable from programme evidence rather than a blocker boolean', () => {
  const certificate = evaluateGoalBuildingProgramme(baseInput({
    programme: {
      activeMissions: [],
      eligibleQueuedGoalCount: 1,
      qualifiedCapacity: 1,
      idleQualifiedCapacity: 1,
    },
    blockers: [{
      blockerId: 'claimed-independent-progress',
      severity: 'P1',
      ownerId: GOAL_BUILDING_AGENT_ID,
      route: 'DELEGATE_BOUNDED_REPAIR',
      firstObservedAtUtc: observed(2),
      nextAction: 'Repair the scheduler admission seam.',
      independentWorkContinues: true,
    }],
  }));

  assert.equal(certificate.state, GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD);
  assert.ok(certificate.evidenceProblems.includes('independent-work-claim-unproven:claimed-independent-progress'));
});
