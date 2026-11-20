import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStephanosResearchMissionV1,
  planStephanosResearchRouteV1,
  resumeResearchMissionWithProviderSubstitutionV1,
} from './stephanosResearchCouncilV1.mjs';
import {
  STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
  STEPHANOS_RESEARCH_EXECUTION_STATES,
  createStephanosResearchExecutionHandoffV1,
  reconcileStephanosResearchExecutionReturnV1,
} from './stephanosResearchExecutionHandoffV1.mjs';

const primary = {
  researcherId: 'primary-source-1',
  role: 'PRIMARY_SOURCE_RESEARCHER',
  providerId: 'provider-a',
  qualified: true,
  available: true,
  providerNeutral: true,
};

const sceptic = {
  researcherId: 'sceptic-1',
  role: 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER',
  providerId: 'provider-b',
  qualified: true,
  available: true,
  providerNeutral: true,
};

function missionFor(routePlan, overrides = {}) {
  return createStephanosResearchMissionV1({
    routePlan,
    researchMissionId: 'research-execution-001',
    parentIntentId: 'intent-1902',
    knownContextRefs: ['goal:#1902', 'programme:#1597'],
    ...overrides,
  });
}

function capability({
  capabilityRef,
  schedulerRoute = 'CHATGPT_GITHUB',
  taskTypes,
  providerId = '',
  researcherId = '',
  role = '',
}) {
  return {
    capabilityRef,
    schedulerRoute,
    taskTypes,
    providerId,
    researcherId,
    role,
    qualified: true,
    available: true,
    providerNeutral: true,
  };
}

function completedReturn(mission, researchResults, overrides = {}) {
  return {
    schemaVersion: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
    state: 'COMPLETED',
    researchMissionId: mission.researchMissionId,
    missionFingerprint: mission.missionFingerprint,
    researchRoute: mission.researchRoute,
    schedulerRoute: 'CHATGPT_GITHUB',
    researchResults,
    ...overrides,
  };
}

function directHandoff(mission) {
  return createStephanosResearchExecutionHandoffV1({
    mission,
    executionCapabilities: [capability({
      capabilityRef: 'capability:web-primary-source-v1',
      schedulerRoute: 'CHATGPT_GITHUB',
      taskTypes: ['RESEARCH_DIRECT'],
    })],
  });
}

test('canonical-knowledge route requires no external execution and retains zero mutation authority', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Who owns native research?',
    canonicalKnowledge: { sufficient: true, fresh: true, conflicts: [], evidenceRefs: ['issue:#1902'] },
  });
  const mission = missionFor(plan);
  const handoff = createStephanosResearchExecutionHandoffV1({ mission, executionCapabilities: [] });
  assert.equal(handoff.valid, true);
  assert.equal(handoff.state, STEPHANOS_RESEARCH_EXECUTION_STATES.NO_EXECUTION_REQUIRED);
  assert.equal(handoff.researchMissionId, mission.researchMissionId);
  assert.equal(handoff.missionFingerprint, mission.missionFingerprint);
  assert.equal(handoff.schedulerRoute, null);
  assert.equal(handoff.authority.dispatchPerformed, false);
  assert.equal(handoff.authority.sourceMutationAllowed, false);
});

test('direct research binds one qualified existing scheduler capability without dispatching it', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'What does the current official API documentation say?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    freshnessSensitive: true,
    directResearchAvailable: true,
  });
  const mission = missionFor(plan);
  const handoff = createStephanosResearchExecutionHandoffV1({
    mission,
    executionCapabilities: [capability({
      capabilityRef: 'capability:web-primary-source-v1',
      schedulerRoute: 'CHATGPT_GITHUB',
      taskTypes: ['RESEARCH_DIRECT'],
    })],
  });
  assert.equal(handoff.state, STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER);
  assert.equal(handoff.requestedTaskType, 'RESEARCH_DIRECT');
  assert.equal(handoff.schedulerOwnerGoal, '#1556');
  assert.deepEqual(handoff.researchFoundationGoals, ['#1596', '#1597', '#1902']);
  assert.deepEqual(handoff.executionCapabilityRefs, ['capability:web-primary-source-v1']);
  assert.equal(handoff.missionIdentityMustRemainExact, true);
  assert.equal(handoff.authority.dispatchPerformed, false);
});

test('single-specialist research requires a qualified capability matching the mission researcher identity', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Map this external architecture pattern onto Stephanos.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    broad: true,
    specialists: [primary],
  });
  const mission = missionFor(plan);
  const waiting = createStephanosResearchExecutionHandoffV1({
    mission,
    executionCapabilities: [capability({
      capabilityRef: 'capability:wrong-provider',
      taskTypes: ['RESEARCH_SPECIALIST'],
      providerId: 'provider-z',
      role: 'PRIMARY_SOURCE_RESEARCHER',
    })],
  });
  assert.equal(waiting.valid, true);
  assert.equal(waiting.state, STEPHANOS_RESEARCH_EXECUTION_STATES.WAITING_FOR_QUALIFIED_ROUTE);
  assert.equal(waiting.missingResearcherId, 'primary-source-1');

  const ready = createStephanosResearchExecutionHandoffV1({
    mission,
    executionCapabilities: [capability({
      capabilityRef: 'capability:primary-specialist-v1',
      schedulerRoute: 'OPENCLAW_LOCAL',
      taskTypes: ['RESEARCH_SPECIALIST'],
      providerId: 'provider-a',
      researcherId: 'primary-source-1',
      role: 'PRIMARY_SOURCE_RESEARCHER',
    })],
  });
  assert.equal(ready.state, STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER);
  assert.equal(ready.schedulerRoute, 'OPENCLAW_LOCAL');
});

test('research council binds every selected scout through existing qualified capabilities', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Resolve conflicting provider architecture evidence.',
    canonicalKnowledge: { sufficient: false, fresh: false, conflicts: ['conflict'] },
    contested: true,
    specialists: [primary, sceptic],
  });
  const mission = missionFor(plan);
  const handoff = createStephanosResearchExecutionHandoffV1({
    mission,
    executionCapabilities: [
      capability({ capabilityRef: 'capability:primary-council-v1', taskTypes: ['RESEARCH_COUNCIL'], providerId: 'provider-a', researcherId: 'primary-source-1', role: 'PRIMARY_SOURCE_RESEARCHER' }),
      capability({ capabilityRef: 'capability:sceptic-council-v1', taskTypes: ['RESEARCH_COUNCIL'], providerId: 'provider-b', researcherId: 'sceptic-1', role: 'SCEPTICAL_COUNTEREVIDENCE_RESEARCHER' }),
    ],
  });
  assert.equal(handoff.state, STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER);
  assert.equal(handoff.requestedTaskType, 'RESEARCH_COUNCIL');
  assert.deepEqual(handoff.executionCapabilityRefs, ['capability:primary-council-v1', 'capability:sceptic-council-v1']);
});

test('provider substitution preserves mission identity across handoff', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Investigate provider-neutral research continuity.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    broad: true,
    specialists: [primary],
  });
  const mission = missionFor(plan);
  const resumed = resumeResearchMissionWithProviderSubstitutionV1({
    mission,
    unavailableProviderId: 'provider-a',
    availableProviders: [{ ...primary, researcherId: 'primary-fallback', providerId: 'provider-d' }],
  });
  assert.equal(resumed.resumed, true);
  const handoff = createStephanosResearchExecutionHandoffV1({
    mission: resumed,
    executionCapabilities: [capability({
      capabilityRef: 'capability:primary-fallback-v1',
      schedulerRoute: 'CHATGPT_GITHUB',
      taskTypes: ['RESEARCH_SPECIALIST'],
      providerId: 'provider-d',
      researcherId: 'primary-source-1',
      role: 'PRIMARY_SOURCE_RESEARCHER',
    })],
  });
  assert.equal(handoff.researchMissionId, mission.researchMissionId);
  assert.equal(handoff.state, STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER);
  assert.equal(handoff.providerSubstitutionAllowed, true);
});

test('completed execution return re-enters canonical evidence reconciliation under the same mission identity', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'What does the current official specification require?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    directResearchAvailable: true,
  });
  const mission = missionFor(plan);
  const handoff = directHandoff(mission);
  const reconciled = reconcileStephanosResearchExecutionReturnV1({
    mission,
    handoff,
    executionReturn: completedReturn(mission, [{
      researcherId: 'direct-research',
      providerId: 'provider-a',
      role: 'PRIMARY_SOURCE_RESEARCHER',
      claims: [{
        topic: 'spec-requirement',
        value: 'required-v3',
        sourceClass: 'PRIMARY_OFFICIAL',
        freshness: 'FRESH',
        evidenceRefs: ['official:spec-v3'],
      }],
    }]),
    implicationsForStephanos: 'No architecture change follows automatically.',
  });
  assert.equal(reconciled.accepted, true);
  assert.equal(reconciled.researchMissionId, mission.researchMissionId);
  assert.equal(reconciled.evidencePacket.researchMissionId, mission.researchMissionId);
  assert.equal(reconciled.evidencePacket.candidateKnowledgeUpdates[0].candidateOnly, true);
  assert.equal(reconciled.authority.knowledgeAutoPromotionAllowed, false);
});

test('execution return fails closed on mission identity drift or authority widening', () => {
  const plan = planStephanosResearchRouteV1({
    question: 'Check a current provider fact.',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    directResearchAvailable: true,
  });
  const mission = missionFor(plan);
  const results = [{
    researcherId: 'direct-research',
    providerId: 'provider-a',
    role: 'PRIMARY_SOURCE_RESEARCHER',
    claims: [{ topic: 'fact', value: 'current', sourceClass: 'PRIMARY_OFFICIAL', freshness: 'FRESH', evidenceRefs: ['official:fact'] }],
  }];
  const handoff = directHandoff(mission);
  assert.equal(reconcileStephanosResearchExecutionReturnV1({
    mission,
    handoff,
    executionReturn: completedReturn(mission, results, { researchMissionId: 'different-mission' }),
  }), null);
  assert.equal(reconcileStephanosResearchExecutionReturnV1({
    mission,
    handoff,
    executionReturn: completedReturn(mission, results, { runtimeMutated: true }),
  }), null);
  assert.equal(reconcileStephanosResearchExecutionReturnV1({
    mission,
    handoff,
    executionReturn: completedReturn(mission, results, { schedulerRoute: 'OPENCLAW_LOCAL' }),
  }), null);
});

test('operator-judgment and unsafe routes never become scheduler-ready research execution', () => {
  for (const plan of [
    planStephanosResearchRouteV1({ question: 'Choose my irreversible preference.', operatorJudgmentRequired: true, canonicalKnowledge: { sufficient: false, fresh: false } }),
    planStephanosResearchRouteV1({ question: 'Silently widen authority.', unsupportedOrUnsafe: true, canonicalKnowledge: { sufficient: false, fresh: false } }),
  ]) {
    const mission = missionFor(plan);
    const handoff = createStephanosResearchExecutionHandoffV1({
      mission,
      executionCapabilities: [capability({ capabilityRef: 'capability:unsafe', taskTypes: ['RESEARCH_DIRECT', 'RESEARCH_SPECIALIST', 'RESEARCH_COUNCIL'] })],
    });
    assert.equal(handoff.valid, false);
    assert.equal(handoff.state, STEPHANOS_RESEARCH_EXECUTION_STATES.BLOCKED_UNSAFE_OR_UNKNOWN);
    assert.equal(handoff.authority.dispatchPerformed, false);
  }
});
