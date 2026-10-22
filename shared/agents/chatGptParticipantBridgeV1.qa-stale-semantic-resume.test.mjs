import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const NOW = new Date('2026-09-13T05:00:00.000Z');
const OLD = new Date(NOW.getTime() - (2 * 60 * 60 * 1000));

function envelope(request) {
  return `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n## Request\n\`\`\`json\n${JSON.stringify({ schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION, state: 'REQUEST_READY', request })}\n\`\`\``;
}

function freshQuestion() {
  const packet = buildInitialStephanosTenQuestionPacketV1({
    createdAtUtc: NOW.toISOString(),
    relatedPr: '#1896',
    proofRefs: ['receipts/q1-fresh-source'],
    workspaceValidationOptions: { nowMs: NOW.getTime() },
  });
  assert.equal(packet.valid, true, packet.errors?.join(','));
  return packet.records[0];
}

function staleEquivalent(record) {
  const body = JSON.parse(record.body);
  body.payload.createdAtUtc = OLD.toISOString();
  return {
    ...record,
    timestampUtc: OLD.toISOString(),
    proofRefs: ['receipts/q1-old-source'],
    body: JSON.stringify(body),
  };
}

function keyForQuestion(record) {
  const digest = createHash('sha256').update(record.messageId).digest('hex').slice(0, 24);
  return `inbox/qa-question-${digest}.json`;
}

function keyForAnswer(record) {
  const digest = createHash('sha256').update(record.messageId).digest('hex').slice(0, 24);
  return `outbox/qa-answer-${digest}.json`;
}

function qaRequest(questionRecord) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: 'request-stale-q1-resume-test',
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

function workspaceWith(recordsInput = []) {
  const records = new Map(recordsInput);
  const writes = [];
  const keyFor = (segments) => segments.join('/');
  return {
    records,
    writes,
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    recordExistsFn: async ({ segments }) => records.has(keyFor(segments)),
    readWorkspaceRecordFn: async ({ segments }) => {
      const key = keyFor(segments);
      return records.has(key)
        ? { ok: true, reason: 'WORKSPACE_RECORD_READ', record: records.get(key) }
        : { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async (_root, segments, record) => {
      records.set(keyFor(segments), record);
      writes.push({ segments, record });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

function groundedResponse() {
  return {
    success: true,
    type: 'live_telemetry_result',
    output_text: 'Current product programme truth is grounded through the canonical Stephanos cognition route.',
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
    debug: { request_id: 'req-stale-resume-test' },
  };
}

function options(workspace, questionRecord, counter) {
  return {
    now: NOW,
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({ ok: true, body: envelope(qaRequest(questionRecord)), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }),
    },
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    readWorkspaceRecordFn: workspace.readWorkspaceRecordFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
    persistConversationCanvasFn: async () => ({ ok: true, classification: 'CANVAS_TEST_PASS', persisted: true, resumed: false }),
    answerQuestionFn: async (record, answerOptions) => {
      counter.count += 1;
      return answerStephanosWorkspaceQuestionRecord(record, {
        ...answerOptions,
        queryFn: async () => groundedResponse(),
      });
    },
  };
}

test('fresh canonical Q1 semantically resumes a stale issuance without rewriting durable question history', async () => {
  const question = freshQuestion();
  const oldQuestion = staleEquivalent(question);
  const workspace = workspaceWith([[keyForQuestion(question), oldQuestion]]);
  const counter = { count: 0 };

  const result = await runChatGptSharedWorkspaceGitHubRelay(options(workspace, question, counter));

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_PASS');
  assert.equal(result.primaryWrite.reason, 'WORKSPACE_QA_STALE_QUESTION_SEMANTIC_RESUME');
  assert.equal(counter.count, 1);
  assert.deepEqual(workspace.records.get(keyForQuestion(question)), oldQuestion);
  assert.equal(workspace.writes.some((entry) => entry.segments[0] === 'inbox'), false);
  assert.equal(workspace.writes.some((entry) => entry.segments[0] === 'outbox' && entry.record?.recordSubtype === 'conversation-answer'), true);
});

test('stale deterministic slot with changed question semantics remains fail-closed conflict', async () => {
  const question = freshQuestion();
  const oldQuestion = staleEquivalent(question);
  const body = JSON.parse(oldQuestion.body);
  body.payload.questionText = `${body.payload.questionText} altered`;
  const conflicting = { ...oldQuestion, body: JSON.stringify(body) };
  const workspace = workspaceWith([[keyForQuestion(question), conflicting]]);
  const counter = { count: 0 };

  const result = await runChatGptSharedWorkspaceGitHubRelay(options(workspace, question, counter));

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_EXISTING_QUESTION_CONFLICT');
  assert.equal(counter.count, 0);
  assert.deepEqual(workspace.records.get(keyForQuestion(question)), conflicting);
});

test('semantic resume never overwrites or bypasses an existing correlated-answer slot', async () => {
  const question = freshQuestion();
  const oldQuestion = staleEquivalent(question);
  const existingAnswer = { schemaVersion: 'invalid-existing-answer-must-be-preserved' };
  const workspace = workspaceWith([
    [keyForQuestion(question), oldQuestion],
    [keyForAnswer(question), existingAnswer],
  ]);
  const counter = { count: 0 };

  const result = await runChatGptSharedWorkspaceGitHubRelay(options(workspace, question, counter));

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.primaryWrite.reason, 'WORKSPACE_QA_STALE_QUESTION_SEMANTIC_RESUME');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_EXISTING_ANSWER_REJECTED');
  assert.equal(counter.count, 0);
  assert.deepEqual(workspace.records.get(keyForAnswer(question)), existingAnswer);
});
