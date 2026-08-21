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

const NOW = new Date('2026-08-19T08:00:00.000Z');

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
    proofRefs: ['receipts/live-round-source'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(packet.valid, true, packet.errors?.join(','));
  assert.equal(packet.records.length, 10);
  return packet.records[0];
}

function qaRequest(questionRecord, overrides = {}) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: 'request-live-qa-001',
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
    ...overrides,
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
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

function groundedResponse() {
  return {
    success: true,
    type: 'live_telemetry_result',
    output_text: 'The current product programme answer is evidence-bound through the existing Stephanos cognition route.',
    data: {
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        generatedAt: NOW.toISOString(),
        sourceTruth: 'CURRENT',
        proofTruth: { github: 'CURRENT', local: 'UNKNOWN', browser: 'UNKNOWN' },
      },
      execution_metadata: {
        freshness_integrity_preserved: true,
        retrieval_used: false,
        grounding_active_for_request: false,
      },
    },
    memory_hits: [],
    debug: { request_id: 'req-relay-grounded-001' },
  };
}

function relayOptions(workspace, adapter, answerCounter) {
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
  };
}

test('canonical Q&A delivery persists question then correlated answer before terminal relay receipts', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  const answerCounter = { count: 0 };
  let responseBody = '';

  const result = await runChatGptSharedWorkspaceGitHubRelay(relayOptions(workspace, {
    readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
    writeResponse: (body) => {
      responseBody = body;
      return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  }, answerCounter));

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(result.verificationStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_PASS');
  assert.equal(result.primaryWrite.ok, true);
  assert.equal(result.answerWrite.ok, true);
  assert.equal(answerCounter.count, 1);
  assert.equal(workspace.writes[0].segments[0], 'inbox');
  assert.match(workspace.writes[0].segments[1], /^qa-question-/);
  assert.equal(workspace.writes[0].record.messageId, questionRecord.messageId);
  assert.equal(workspace.writes[1].segments[0], 'outbox');
  assert.match(workspace.writes[1].segments[1], /^qa-answer-/);
  assert.equal(workspace.writes[1].record.participantId, 'stephanos');
  assert.equal(workspace.writes[1].record.recipientParticipantId, CHATGPT_BRIDGE_PARTICIPANT_ID);
  assert.equal(workspace.writes[1].record.correlationId, questionRecord.correlationId);
  assert.equal(workspace.writes[1].record.subjectId, questionRecord.subjectId);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.events[0].record.eventKind, 'response');
  assert.match(responseBody, /"correlatedAnswerRecord"/);
  assert.match(responseBody, /"recordSubtype": "conversation-answer"/);
  assert.equal(responseBody.includes(groundedResponse().output_text), false);
});

test('request and conversation lineage mismatch terminalizes safely before question persistence or Stephanos cognition', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord, { correlationId: 'different-round' });
  const answerCounter = { count: 0 };

  const result = await runChatGptSharedWorkspaceGitHubRelay(relayOptions(workspace, {
    readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
    writeResponse: () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }),
  }, answerCounter));

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.verificationStatus, 'BRIDGE_VERIFIED_PASS');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_LINEAGE_REJECTED');
  assert.equal(answerCounter.count, 0);
  assert.equal(workspace.writes.some((entry) => entry.segments[0] === 'inbox'), false);
  assert.equal(workspace.writes.some((entry) => entry.segments[0] === 'outbox'), false);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.events[0].record.eventKind, 'warning');
  assert.equal(result.completionWrite.ok, true);
});

test('response publication retry reuses persisted question and answer without invoking Stephanos cognition twice', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  const answerCounter = { count: 0 };
  let responseAttempts = 0;
  const adapter = {
    readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
    writeResponse: () => {
      responseAttempts += 1;
      return responseAttempts === 1
        ? { ok: false, reason: 'RESPONSE_COMMENT_WRITE_FAILED' }
        : { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };
  const options = relayOptions(workspace, adapter, answerCounter);

  const first = await runChatGptSharedWorkspaceGitHubRelay(options);
  const second = await runChatGptSharedWorkspaceGitHubRelay(options);

  assert.equal(first.ok, false);
  assert.equal(first.deliveryStatus, 'WORKSPACE_QA_PASS');
  assert.equal(first.completionWrite.ok, false);
  assert.equal(second.ok, true);
  assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_COMPLETED');
  assert.equal(second.primaryWrite.reason, 'WORKSPACE_RECORD_ALREADY_PERSISTED');
  assert.equal(second.answerWrite.reason, 'WORKSPACE_RECORD_ALREADY_PERSISTED');
  assert.equal(answerCounter.count, 1);
  assert.equal(responseAttempts, 2);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'inbox').length, 1);
  const outboxWrites = workspace.writes.filter((entry) => entry.segments[0] === 'outbox');
  assert.equal(outboxWrites.filter((entry) => entry.record?.recordSubtype === 'conversation-answer').length, 1);
  assert.equal(outboxWrites.filter((entry) => entry.record?.kind === 'stephanos.shared_workspace.record.handoff').length, 1);
  assert.equal(workspace.events.length, 1);
});

test('unsafe or invalid Stephanos answer terminalizes as a bounded rejection and never writes an outbox answer', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  let answerCalls = 0;

  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...relayOptions(workspace, {
      readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }),
    }, { count: 0 }),
    answerQuestionFn: async () => {
      answerCalls += 1;
      return { ok: false, classification: 'AI_RESPONSE_UNSAFE_FOR_SHARED_WORKSPACE', answerRecord: null };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_ANSWER_REJECTED');
  assert.equal(answerCalls, 1);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'inbox').length, 1);
  assert.equal(workspace.writes.filter((entry) => entry.segments[0] === 'outbox').length, 0);
  assert.equal(result.completionWrite.ok, true);
});
