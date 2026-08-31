import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_BRIDGE_PARTICIPANT_ID,
  CHATGPT_BRIDGE_STEPHANOS_QA_OPERATION,
  CHATGPT_BRIDGE_STEPHANOS_QA_RECORD_KIND,
  CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
} from './chatGptParticipantBridgeV1.mjs';
import { buildInitialStephanosTenQuestionPacketV1 } from './stephanosInitialTenQuestionRoundV1.mjs';
import { answerStephanosWorkspaceQuestionRecord } from './stephanosSharedParticipantLiveQaV1.mjs';
import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  runChatGptSharedWorkspaceGitHubRelay,
} from '../../scripts/chatgpt-shared-workspace-github-relay.mjs';

const NOW = new Date('2026-08-21T08:45:00.000Z');

function envelope(request) {
  return `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n## Request\n\`\`\`json\n${JSON.stringify({
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    state: 'REQUEST_READY',
    request,
  })}\n\`\`\``;
}

function canonicalQuestionRecord() {
  const packet = buildInitialStephanosTenQuestionPacketV1({
    createdAtUtc: NOW.toISOString(),
    relatedPr: '#1896',
    proofRefs: ['receipts/live-round-canvas-persistence-source'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(packet.valid, true, packet.errors?.join(','));
  return packet.records[0];
}

function qaRequest(questionRecord) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: 'request-live-qa-canvas-001',
    timestampUtc: NOW.toISOString(),
    participantId: CHATGPT_BRIDGE_PARTICIPANT_ID,
    operation: CHATGPT_BRIDGE_STEPHANOS_QA_OPERATION,
    recordKind: CHATGPT_BRIDGE_STEPHANOS_QA_RECORD_KIND,
    relatedGoal: questionRecord.relatedIssue,
    relatedPr: questionRecord.relatedPr,
    correlationId: questionRecord.correlationId,
    boundedPayload: { questionRecord },
    approvalRef: '',
    expiryUtc: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    redactionPolicy: 'sanitize-secrets-and-runtime-paths',
  };
}

function fakeWorkspace() {
  const records = new Map();
  const writes = [];
  const events = [];
  const keyFor = (segments) => segments.join('/');
  return {
    records,
    writes,
    events,
    recordExistsFn: async ({ segments }) => records.has(keyFor(segments)),
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    readWorkspaceRecordFn: async ({ segments }) => {
      const key = keyFor(segments);
      return records.has(key)
        ? { ok: true, reason: 'WORKSPACE_RECORD_READ', record: records.get(key) }
        : { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async (_root, segments, record) => {
      const key = keyFor(segments);
      records.set(key, record);
      const entry = { segments, record };
      if (segments[0] === 'events') events.push(entry);
      else writes.push(entry);
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: JSON.stringify(record).length };
    },
  };
}

function groundedResponse() {
  return {
    success: true,
    type: 'live_telemetry_result',
    output_text: 'Stephanos remains mission owner and the current programme answer is evidence-bound.',
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
    debug: { request_id: 'req-relay-canvas-grounded-001' },
  };
}

function relayOptions(workspace, adapter, answerCounter, persistConversationCanvasFn) {
  return {
    now: NOW,
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter,
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    readWorkspaceRecordFn: workspace.readWorkspaceRecordFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
    answerQuestionFn: async (record, options) => {
      answerCounter.count += 1;
      return answerStephanosWorkspaceQuestionRecord(record, {
        ...options,
        queryFn: async () => groundedResponse(),
      });
    },
    persistConversationCanvasFn,
  };
}

test('relay retries private Canvas persistence from durable Q&A without repeating Stephanos cognition or exposing raw answer', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  const answerCounter = { count: 0 };
  let canvasAttempts = 0;
  let responseBody = '';

  const persistConversationCanvasFn = async ({
    questionRecord: persistedQuestion,
    answerRecord,
    workspaceRoot,
    repoRoot,
  }) => {
    canvasAttempts += 1;
    assert.equal(persistedQuestion.messageId, questionRecord.messageId);
    assert.equal(answerRecord.subjectId, questionRecord.subjectId);
    assert.equal(answerRecord.correlationId, questionRecord.correlationId);
    assert.equal(workspaceRoot, '/shared');
    assert.equal(repoRoot, '/repo');
    if (canvasAttempts === 1) {
      return {
        ok: false,
        classification: 'RELAY_CANVAS_PERSISTENCE_REJECTED',
        errors: ['simulated-transient-private-handoff-write-failure'],
        persisted: false,
        resumed: false,
      };
    }
    return {
      ok: true,
      classification: 'RELAY_CANVAS_PRIVATE_HANDOFF_PERSISTED',
      persisted: true,
      resumed: false,
      handoffId: 'conversation-canvas-handoff-001',
      publicProjection: {
        schemaVersion: 'stephanos.conversation-canvas-public-projection.v1',
        handoffId: 'conversation-canvas-handoff-001',
        bodyIncluded: false,
        rawAnswerIncluded: false,
      },
    };
  };

  const adapter = {
    readRequest: () => ({
      ok: true,
      body: envelope(request),
      authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
    }),
    writeResponse: (body) => {
      responseBody = body;
      return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };
  const options = relayOptions(workspace, adapter, answerCounter, persistConversationCanvasFn);

  const first = await runChatGptSharedWorkspaceGitHubRelay(options);
  assert.equal(first.ok, false);
  assert.equal(first.deliveryStatus, 'WORKSPACE_QA_CANVAS_PERSISTENCE_FAILED');
  assert.equal(first.canvasPersistence.ok, false);
  assert.equal(first.completionWrite.ok, false);
  assert.equal(answerCounter.count, 1);
  assert.equal(canvasAttempts, 1);
  assert.equal(workspace.events.length, 0);

  const second = await runChatGptSharedWorkspaceGitHubRelay(options);
  assert.equal(second.ok, true);
  assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(second.deliveryStatus, 'WORKSPACE_QA_PASS');
  assert.equal(second.primaryWrite.reason, 'WORKSPACE_RECORD_ALREADY_PERSISTED');
  assert.equal(second.answerWrite.reason, 'WORKSPACE_RECORD_ALREADY_PERSISTED');
  assert.equal(second.canvasPersistence.ok, true);
  assert.equal(second.canvasPersistence.persisted, true);
  assert.equal(second.canvasPersistence.handoffId, 'conversation-canvas-handoff-001');
  assert.equal(answerCounter.count, 1, 'downstream Canvas retry must not invoke Stephanos cognition twice');
  assert.equal(canvasAttempts, 2);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'inbox').length, 1);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'outbox').length, 1);
  assert.equal(workspace.events.length, 1);
  assert.match(responseBody, /"conversationCanvasHandoff"/);
  assert.match(responseBody, /"bodyIncluded": false/);
  assert.match(responseBody, /"rawAnswerIncluded": false/);
  assert.equal(responseBody.includes(groundedResponse().output_text), false);
});
