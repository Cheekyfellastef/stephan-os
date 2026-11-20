import assert from 'node:assert/strict';
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

const NOW = new Date('2026-08-23T12:00:00.000Z');

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
  return packet.records[0];
}

function qaRequest(questionRecord) {
  return {
    schemaVersion: CHATGPT_PARTICIPANT_BRIDGE_SCHEMA_VERSION,
    requestId: 'request-live-qa-diagnostic-001',
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
  const keyFor = (segments) => segments.join('/');
  return {
    records,
    recordExistsFn: async ({ segments }) => records.has(keyFor(segments)),
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    readWorkspaceRecordFn: async ({ segments }) => {
      const key = keyFor(segments);
      return records.has(key)
        ? { ok: true, reason: 'WORKSPACE_RECORD_READ', record: records.get(key) }
        : { ok: false, reason: 'WORKSPACE_RECORD_NOT_FOUND', record: null };
    },
    writeAtomicJsonFn: async (_root, segments, record) => {
      records.set(keyFor(segments), record);
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

test('Q&A answer rejection preserves bounded cognition diagnostic in response and receipts', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  let responseBody = '';

  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: NOW,
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    },
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    readWorkspaceRecordFn: workspace.readWorkspaceRecordFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
    answerQuestionFn: async () => ({
      ok: false,
      classification: 'AI_RESPONSE_REJECTED_AS_NON_DATA',
      errors: [
        'ai-response.output_text-must-be-string',
        'credential=must-not-leak',
        'C:\\Users\\operator\\private.txt',
      ],
      providerRaw: { mustNotLeak: true },
      answerRecord: null,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_QA_ANSWER_REJECTED');
  assert.equal(result.qaAnswerDiagnostic.classification, 'AI_RESPONSE_REJECTED_AS_NON_DATA');
  assert.deepEqual(result.qaAnswerDiagnostic.errors, ['ai-response.output_text-must-be-string']);
  assert.match(responseBody, /"classification": "AI_RESPONSE_REJECTED_AS_NON_DATA"/);
  assert.equal(responseBody.includes('must-not-leak'), false);
  assert.equal(responseBody.includes('Users'), false);

  const receipts = [...workspace.records.entries()]
    .filter(([key]) => key.startsWith('receipts/'))
    .map(([, record]) => record);
  assert.equal(receipts.length, 2);
  assert.equal(receipts.every((receipt) => receipt.qaAnswerDiagnostic?.classification === 'AI_RESPONSE_REJECTED_AS_NON_DATA'), true);
  assert.equal(JSON.stringify(receipts).includes('providerRaw'), false);
});
