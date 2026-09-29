import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
} from './stephanosConversationalCapabilityLadderV1.mjs';
import {
  createStephanosWorkspaceQuestionRecord,
} from './stephanosSharedWorkspaceConversationAdapterV1.mjs';
import {
  answerStephanosWorkspaceQuestionForConversationCanvasV1,
} from './stephanosSharedParticipantConversationCanvasCompositionV1.mjs';
import {
  STEPHANOS_SHARED_PARTICIPANT_RELAY_CANVAS_PERSISTENCE_SCHEMA_VERSION,
  persistStephanosConversationCanvasFromPersistedQaV1,
} from './stephanosSharedParticipantRelayCanvasPersistenceV1.mjs';

const NOW = new Date('2026-08-21T07:10:00.000Z');

function questionRecord() {
  const built = createStephanosWorkspaceQuestionRecord({
    schemaVersion: STEPHANOS_CAPABILITY_QUESTION_SCHEMA_VERSION,
    roundId: 'live-chatgpt-to-stephanos-round-001',
    questionId: 'q-provider-outage-route',
    askerParticipantId: 'chatgpt-bridge',
    targetParticipantId: 'stephanos',
    questionText: 'What happens to Stephanos if an optional provider is unavailable?',
    questionClass: 'ARCHITECTURE_AND_RELATIONSHIPS',
    intentFingerprint: 'intent-provider-outage-route-relay-persistence-001',
    noveltyRefs: [],
    contextRefs: ['goal:#1308', 'goal:#1898'],
    expectedEvidenceClass: 'ZERO_CODEX_CONTINUITY_EVIDENCE',
    createdAtUtc: NOW.toISOString(),
  }, {
    relatedIssue: '#1308',
    relatedPr: '#1896',
    proofRefs: ['proof/provider-outage-question'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(built.valid, true, built.errors?.join(','));
  return built.record;
}

function groundedResponse() {
  return {
    success: true,
    output_text: 'Stephanos keeps mission ownership and routes optional provider loss through the qualified continuity mesh.',
    data: {
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        generatedAt: NOW.toISOString(),
        projectionSource: 'live-goal-projection-service',
        sourceTruth: 'live',
        backendStatus: { status: 'live', ok: true },
        heartbeat: {
          generatedAt: NOW.toISOString(),
          backendLive: true,
          projectionSource: 'live-goal-projection-service',
        },
        missionOperationsStatus: { status: 'ready' },
        proofTruth: { github: 'adapter-provided' },
      },
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: false,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-provider-outage-relay-persistence-001' },
  };
}

async function persistedQa() {
  const record = questionRecord();
  let queryCalls = 0;
  const answered = await answerStephanosWorkspaceQuestionForConversationCanvasV1(record, {
    now: NOW,
    surface: 'ipad',
    prefersReducedMotion: true,
    expandedSections: ['evidence'],
    queryFn: async () => {
      queryCalls += 1;
      return groundedResponse();
    },
  });
  assert.equal(answered.ok, true);
  assert.equal(queryCalls, 1);
  return { record, answerRecord: answered.answerRecord, answered, queryCalls: () => queryCalls };
}

test('persisted Q&A composes and persists one private Conversation Canvas handoff without exposing its body', async () => {
  const qa = await persistedQa();
  const writes = [];
  const result = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'ipad',
    prefersReducedMotion: true,
    expandedSections: ['evidence'],
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null }),
    writeAtomicJsonFn: async (root, segments, record, options) => {
      writes.push({ root, segments, record, options });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: JSON.stringify(record).length };
    },
  });

  assert.equal(qa.queryCalls(), 1, 'persistence replay must not call Stephanos cognition again');
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, STEPHANOS_SHARED_PARTICIPANT_RELAY_CANVAS_PERSISTENCE_SCHEMA_VERSION);
  assert.equal(result.classification, 'RELAY_CANVAS_PRIVATE_HANDOFF_PERSISTED');
  assert.equal(result.persisted, true);
  assert.equal(result.resumed, false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].record.kind, 'stephanos.shared_workspace.record.handoff');
  assert.equal(writes[0].record.fromParticipantId, 'stephanos');
  assert.equal(writes[0].record.toParticipantId, 'user-interface-agent');
  assert.deepEqual(writes[0].segments, ['outbox', `${writes[0].record.handoffId}.json`]);
  assert.equal(result.privatePresentation.targetPayloadField, 'conversation_canvas_view');
  assert.equal(result.privatePresentation.surface, 'ipad');
  assert.equal(result.privatePresentation.servedPresentationClaimed, false);
  assert.equal(result.publicProjection.bodyIncluded, false);
  assert.equal(result.publicProjection.rawAnswerIncluded, false);
  assert.equal('body' in result, false);
  assert.equal('answer' in result, false);
  assert.equal('richResponse' in result, false);
  assert.equal(result.authority.publicRelayProjectionAllowed, false);
  assert.equal(result.authority.rawAnswerMayEnterPublicRelay, false);
});

test('identical durable handoff resumes idempotently and performs no second write or cognition call', async () => {
  const qa = await persistedQa();
  let durableRecord = null;
  let writes = 0;
  const first = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'ipad',
    prefersReducedMotion: true,
    expandedSections: ['evidence'],
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null }),
    writeAtomicJsonFn: async (_root, _segments, record) => {
      writes += 1;
      durableRecord = record;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });
  assert.equal(first.ok, true);
  assert.equal(writes, 1);

  const retry = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'ipad',
    prefersReducedMotion: true,
    expandedSections: ['evidence'],
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: true, reason: 'WORKSPACE_RECORD_READ', record: durableRecord }),
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(qa.queryCalls(), 1);
  assert.equal(retry.ok, true);
  assert.equal(retry.classification, 'RELAY_CANVAS_PRIVATE_HANDOFF_ALREADY_PERSISTED');
  assert.equal(retry.resumed, true);
  assert.equal(retry.handoffId, first.handoffId);
  assert.equal(writes, 1);
});

test('conflicting durable private handoff fails closed rather than overwriting presentation truth', async () => {
  const qa = await persistedQa();
  let expectedRecord = null;
  const seeded = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'desktop-browser',
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({ ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null }),
    writeAtomicJsonFn: async (_root, _segments, record) => {
      expectedRecord = record;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });
  assert.equal(seeded.ok, true);

  let writes = 0;
  const result = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'desktop-browser',
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => ({
      ok: true,
      reason: 'WORKSPACE_RECORD_READ',
      record: { ...expectedRecord, summary: 'Conflicting private presentation truth.' },
    }),
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'RELAY_CANVAS_PERSISTENCE_REJECTED');
  assert.deepEqual(result.errors, ['existing-workspace-handoff-conflict']);
  assert.equal(result.privatePresentation.workspaceRecordReady, true);
  assert.equal(result.publicProjection, null);
  assert.equal(writes, 0);
});

test('unsupported served surface is rejected before any workspace read or write', async () => {
  const qa = await persistedQa();
  let reads = 0;
  let writes = 0;
  const result = await persistStephanosConversationCanvasFromPersistedQaV1({
    questionRecord: qa.record,
    answerRecord: qa.answerRecord,
    workspaceRoot: '/outside/workspace',
    repoRoot: '/repo',
    surface: 'quest-headset',
    nowMs: NOW.getTime(),
    readWorkspaceRecordFn: async () => {
      reads += 1;
      return { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async () => {
      writes += 1;
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, 'RELAY_CANVAS_SURFACE_REJECTED');
  assert.deepEqual(result.errors, ['unsupported-surface']);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(result.privatePresentation.publicRelayProjectionAllowed, false);
});
