import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  answerStephanosWorkspaceQuestionRecord,
} from './stephanosSharedParticipantLiveQaV1.mjs';

const NOW = new Date('2026-08-20T00:00:00.000Z');

function systemsQuestionRecord() {
  const question = {
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'live-chatgpt-to-stephanos-round-001',
    questionId: 'q-systems-current-programme-truth',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What is the current Stephanos programme state and which durable proof supports it?',
    questionClass: 'CURRENT_PROGRAMME_TRUTH',
    intentFingerprint: 'intent-systems-current-programme-truth-001',
    noveltyRefs: [],
    contextRefs: ['goal:#1776', 'goal:#1308', 'goal:#1898'],
    expectedEvidenceClass: 'CURRENT_PROGRAMME_STATE',
    createdAtUtc: NOW.toISOString(),
  };
  const built = createStephanosWorkspaceQuestionRecord(question, {
    relatedIssue: '#1308',
    proofRefs: ['proof/systems-question-message'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(built.valid, true, built.errors?.join(','));
  return built.record;
}

function providerGroundingOnlyResponse() {
  return {
    success: true,
    output_text: 'The provider reports a grounded answer, but no current Stephanos durable system projection was attached.',
    data: {
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: true,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-provider-grounding-only' },
  };
}

function canonicalLiveGoalProjection(overrides = {}) {
  const generatedAt = overrides.generatedAt || NOW.toISOString();
  const sourceTruth = overrides.sourceTruth || 'live';
  return {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt,
    projectionSource: overrides.projectionSource || 'live-goal-projection-service',
    sourceTruth,
    backendStatus: overrides.backendStatus || { status: 'live', ok: true, healthRoute: '/api/health' },
    heartbeat: overrides.heartbeat || {
      generatedAt,
      backendLive: true,
      projectionSource: 'live-goal-projection-service',
    },
    missionOperationsStatus: overrides.missionOperationsStatus || {
      status: 'ready',
      source: 'mission-operations-service',
      route: '/api/mission-operations',
    },
    proofTruth: {
      github: 'adapter-provided',
      local: 'unknown',
      browser: 'unknown',
    },
  };
}

function durableSystemTruthResponse(projection = canonicalLiveGoalProjection()) {
  return {
    success: true,
    output_text: 'Current programme truth is backed by the live goal projection attached to this answer.',
    data: {
      liveGoalProjection: projection,
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: true,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-live-durable-system-truth' },
  };
}

test('systems-expert question declares live durable truth requirement to the existing Stephanos query seam', async () => {
  let observedContext = null;
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async (request) => {
      observedContext = request.context;
      return providerGroundingOnlyResponse();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(observedContext.durableSystemTruthRequired, true);
  assert.equal(observedContext.durableSystemTruthRequirement, 'LIVE_DURABLE_SYSTEM_TRUTH');
});

test('generic provider grounding cannot paint a systems-expert answer as grounded or fresh without live durable system truth', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async () => providerGroundingOnlyResponse(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_PARTIAL_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.answer.epistemicState, 'INFERRED_FROM_EVIDENCE');
  assert.equal(result.answer.freshness, 'UNKNOWN');
  assert.equal(result.answer.sourcesConsulted.includes('provider-grounding'), true);
  assert.equal(result.answer.sourcesConsulted.includes('live-goal-projection'), false);
});

test('canonical live goal projection can satisfy the systems-expert durable-truth gate without widening authority', async () => {
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async () => durableSystemTruthResponse(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_GROUNDED_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.equal(result.answer.epistemicState, 'OBSERVED_FROM_RUNTIME_OR_PROOF');
  assert.equal(result.answer.freshness, 'FRESH');
  assert.equal(result.answer.sourcesConsulted.includes('live-goal-projection'), true);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.commandExecutionAllowed, false);
  assert.equal(result.approvalAllowed, false);
  assert.equal(result.mergeAllowed, false);
  assert.equal(result.deploymentAllowed, false);
  assert.equal(result.providerSelectionAuthorityAdded, false);
});

test('stale canonical projection remains visible evidence but cannot satisfy or freshen systems truth', async () => {
  const staleGeneratedAt = new Date(NOW.getTime() - (10 * 60 * 1000)).toISOString();
  const projection = canonicalLiveGoalProjection({
    generatedAt: staleGeneratedAt,
    heartbeat: {
      generatedAt: staleGeneratedAt,
      backendLive: true,
      projectionSource: 'live-goal-projection-service',
    },
  });
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async () => durableSystemTruthResponse(projection),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_PARTIAL_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.answer.epistemicState, 'INFERRED_FROM_EVIDENCE');
  assert.equal(result.answer.freshness, 'STALE');
  assert.equal(result.answer.sourcesConsulted.includes('live-goal-projection'), true);
});

test('mixed projection remains visible evidence but cannot satisfy or freshen systems truth', async () => {
  const projection = canonicalLiveGoalProjection({ sourceTruth: 'mixed' });
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async () => durableSystemTruthResponse(projection),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_PARTIAL_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.answer.epistemicState, 'INFERRED_FROM_EVIDENCE');
  assert.equal(result.answer.freshness, 'UNKNOWN');
  assert.equal(result.answer.sourcesConsulted.includes('live-goal-projection'), true);
});

test('static-fallback projection remains visible evidence but cannot satisfy or freshen systems truth', async () => {
  const projection = canonicalLiveGoalProjection({ sourceTruth: 'static-fallback' });
  const result = await answerStephanosWorkspaceQuestionRecord(systemsQuestionRecord(), {
    now: NOW,
    queryFn: async () => durableSystemTruthResponse(projection),
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'STEPHANOS_PARTIAL_ANSWER_READY');
  assert.equal(result.answer.answerVerdict, 'ANSWERED_PARTIAL');
  assert.equal(result.answer.epistemicState, 'INFERRED_FROM_EVIDENCE');
  assert.equal(result.answer.freshness, 'UNKNOWN');
  assert.equal(result.answer.sourcesConsulted.includes('live-goal-projection'), true);
});
