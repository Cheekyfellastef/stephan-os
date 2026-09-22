import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStephanosResearchMissionV1,
  planStephanosResearchRouteV1,
} from './stephanosResearchCouncilV1.mjs';
import { STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION } from './stephanosResearchExecutionHandoffV1.mjs';
import { consumeStephanosResearchExecutionV1 } from './stephanosResearchSchedulerConsumerV1.mjs';

function directMission() {
  const routePlan = planStephanosResearchRouteV1({
    question: 'What does the current official provider documentation say?',
    canonicalKnowledge: { sufficient: false, fresh: false },
    narrow: true,
    freshnessSensitive: true,
    directResearchAvailable: true,
  });
  return createStephanosResearchMissionV1({
    routePlan,
    researchMissionId: 'research-scheduler-consumer-001',
    parentIntentId: 'intent-1902',
    knownContextRefs: ['goal:#1902'],
  });
}

function capability() {
  return {
    capabilityRef: 'capability:web-primary-source-v1',
    schedulerRoute: 'CHATGPT_GITHUB',
    taskTypes: ['RESEARCH_DIRECT'],
    qualified: true,
    available: true,
    providerNeutral: true,
  };
}

test('qualified research handoff reaches the existing #1556 route without gaining mutation authority', () => {
  const mission = directMission();
  const result = consumeStephanosResearchExecutionV1({
    mission,
    executionCapabilities: [capability()],
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'READY_FOR_EXISTING_SCHEDULER');
  assert.equal(result.schedulerProjection.schedulerOwnerGoal, '#1556');
  assert.equal(result.schedulerProjection.researchOwnerGoal, '#1902');
  assert.equal(result.schedulerProjection.researchMissionId, mission.researchMissionId);
  assert.equal(result.schedulerProjection.missionFingerprint, mission.missionFingerprint);
  assert.equal(result.schedulerProjection.requestedTaskType, 'RESEARCH_DIRECT');
  assert.equal(result.schedulerProjection.schedulerRoute, 'CHATGPT_GITHUB');
  assert.equal(result.schedulerProjection.toParticipantId, 'chatgpt');
  assert.equal(result.schedulerProjection.readyForExistingScheduler, true);
  assert.equal(result.authority.dispatchPerformed, false);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
  assert.equal(result.authority.runtimeMutationAllowed, false);
});

test('missing qualified route remains a visible scheduler hold rather than inventing capacity', () => {
  const mission = directMission();
  const result = consumeStephanosResearchExecutionV1({ mission, executionCapabilities: [] });
  assert.equal(result.valid, true);
  assert.equal(result.state, 'WAITING_FOR_QUALIFIED_ROUTE');
  assert.equal(result.schedulerProjection.waitingForQualifiedRoute, true);
  assert.equal(result.schedulerProjection.readyForExistingScheduler, false);
  assert.equal(result.authority.schedulerAuthorityAdded, false);
  assert.equal(result.authority.dispatchPerformed, false);
});

test('completed research return is accepted only under the exact mission identity and stays candidate-only', () => {
  const mission = directMission();
  const result = consumeStephanosResearchExecutionV1({
    mission,
    executionCapabilities: [capability()],
    executionReturn: {
      schemaVersion: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
      state: 'COMPLETED',
      researchMissionId: mission.researchMissionId,
      missionFingerprint: mission.missionFingerprint,
      researchRoute: mission.researchRoute,
      schedulerRoute: 'CHATGPT_GITHUB',
      researchResults: [{
        researcherId: 'direct-research',
        providerId: 'provider-a',
        role: 'PRIMARY_SOURCE_RESEARCHER',
        claims: [{
          topic: 'provider-fact',
          value: 'current-official-value',
          sourceClass: 'PRIMARY_OFFICIAL',
          freshness: 'FRESH',
          evidenceRefs: ['official:provider-doc'],
        }],
      }],
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'RETURN_RECONCILED');
  assert.equal(result.reconciliation.accepted, true);
  assert.equal(result.reconciliation.researchMissionId, mission.researchMissionId);
  assert.equal(result.reconciliation.evidencePacket.candidateKnowledgeUpdates[0].candidateOnly, true);
  assert.equal(result.authority.knowledgeAutoPromotionAllowed, false);
});

test('authority-widening research return fails closed', () => {
  const mission = directMission();
  const result = consumeStephanosResearchExecutionV1({
    mission,
    executionCapabilities: [capability()],
    executionReturn: {
      schemaVersion: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
      state: 'COMPLETED',
      researchMissionId: mission.researchMissionId,
      missionFingerprint: mission.missionFingerprint,
      researchRoute: mission.researchRoute,
      schedulerRoute: 'CHATGPT_GITHUB',
      runtimeMutated: true,
      researchResults: [{
        claims: [{ topic: 'fact', value: 'x', sourceClass: 'PRIMARY_OFFICIAL', freshness: 'FRESH', evidenceRefs: ['official:x'] }],
      }],
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.reason, 'research-execution-return-reconciliation-failed');
  assert.equal(result.authority.runtimeMutationAllowed, false);
});
