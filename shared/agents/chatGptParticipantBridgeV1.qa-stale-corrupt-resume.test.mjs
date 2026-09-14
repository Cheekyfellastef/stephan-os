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
import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  runChatGptSharedWorkspaceGitHubRelay,
} from '../../scripts/chatgpt-shared-workspace-github-relay.mjs';

const NOW = new Date('2026-09-13T07:30:00.000Z');
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

function staleCorruptEquivalent(record) {
  const body = JSON.parse(record.body);
  body.payload.createdAtUtc = OLD.toISOString();
  return {
    ...record,
    timestampUtc: OLD.toISOString(),
    proofRefs: [],
    body: JSON.stringify(body),
  };
}

function questionKey(record) {
  const hash = createHash('sha256').update(record.messageId).digest('hex').slice(0, 24);
  return `inbox/qa-question-${hash}.json`;
}

function requestFor(questionRecord) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: 'request-corrupt-stale-q1-regression',
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

test('stale semantic-equivalent question with invalid proofRefs remains fail-closed conflict', async () => {
  const question = freshQuestion();
  const corrupt = staleCorruptEquivalent(question);
  const records = new Map([[questionKey(question), corrupt]]);
  const writes = [];
  let cognitionCalls = 0;
  const keyFor = (segments) => segments.join('/');

  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: NOW,
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({ ok: true, body: envelope(requestFor(question)), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: () => ({ ok: true, reason: 'RESPONSE_COMMENT_UPDATED' }),
    },
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
    persistConversationCanvasFn: async () => ({ ok: true, classification: 'CANVAS_TEST_PASS', persisted: false, resumed: false }),
    answerQuestionFn: async () => {
      cognitionCalls += 1;
      return { ok: false, classification: 'SHOULD_NOT_BE_CALLED', answerRecord: null };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_REJECTED_SAFELY');
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_EXISTING_QUESTION_CONFLICT');
  assert.equal(cognitionCalls, 0);
  assert.deepEqual(records.get(questionKey(question)), corrupt);
  assert.equal(writes.some((entry) => entry.segments[0] === 'outbox'), false);
});
