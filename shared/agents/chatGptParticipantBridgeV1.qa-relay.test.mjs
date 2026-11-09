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
  validateChatGptSharedWorkspaceResponseBody,
} from '../../scripts/chatgpt-shared-workspace-github-relay.mjs';

const NOW = new Date('2026-08-19T08:00:00.000Z');

async function strandedQa() {
  const workspace = fakeWorkspace();
  const question = canonicalQuestionRecord();
  const request = qaRequest(question);
  const counter = { count: 0 };
  let publishAllowed = false;
  let body = '';
  const adapter = {
    readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER, observationSource: 'DIRECT' }),
    writeResponse: (nextBody) => {
      body = nextBody;
      if (!publishAllowed) return { ok: false, reason: 'RESPONSE_COMMENT_WRITE_FAILED' };
      return validateChatGptSharedWorkspaceResponseBody(nextBody).valid
        ? { ok: true } : { ok: false, reason: 'unsafe-response-text' };
    },
  };
  const options = relayOptions(workspace, adapter, counter);
  const first = await runChatGptSharedWorkspaceGitHubRelay(options);
  assert.equal(first.ok, false);
  assert.equal(first.deliveryStatus, 'WORKSPACE_QA_PASS');
  publishAllowed = true;
  return { workspace, question, request, counter, adapter, options, first, body: () => body };
}

test('expired Q&A resumes only durable publication and preserves historical answer freshness', async () => {
  const fixture = await strandedQa();
  const original = new Map(fixture.workspace.records);
  const writesBefore = fixture.workspace.writes.length;
  const late = { ...fixture.options, now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000) };
  const result = await runChatGptSharedWorkspaceGitHubRelay(late);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.publicationRecovered, true);
  assert.equal(fixture.counter.count, 1);
  assert.equal(fixture.workspace.writes.length, writesBefore + 1, 'only final completion is written');
  for (const [key, record] of original) assert.deepEqual(fixture.workspace.records.get(key), record);
  const payload = JSON.parse(fixture.body().match(/```json\s*([\s\S]*?)\s*```/)[1]);
  assert.equal(payload.sanitizedAnswer.freshness, 'STALE');
  assert.equal(payload.sanitizedAnswer.answeredAtUtc, NOW.toISOString());
  assert.equal(payload.publicationRecovery.cognitionRepeated, false);
  assert.equal(payload.source.sharedWorkspaceAuthoritative, true);
  assert.equal(payload.authority.mergeAuthority, false);
  const third = await runChatGptSharedWorkspaceGitHubRelay(late);
  assert.equal(third.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
});

test('legacy expiry completion cannot hide the matching accepted durable Q&A result', async () => {
  const fixture = await strandedQa();
  const audit = fixture.workspace.records.get(`receipts/${fixture.first.receiptId}.json`);
  fixture.workspace.records.set(`receipts/${fixture.first.completionReceiptId}.json`, {
    ...audit,
    receiptId: fixture.first.completionReceiptId,
    receivedRecordId: fixture.first.receiptId,
    disposition: 'RELAY_COMPLETE:BLOCKED_EXPIRED_REQUEST:REQUEST_REJECTED',
  });
  let freshReads = 0;
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...fixture.options,
    now: new Date(NOW.getTime() + 20 * 60 * 1000),
    adapter: { ...fixture.adapter,
      readRequest: () => ({ ...fixture.adapter.readRequest(), observationSource: 'SHARED_CACHE' }),
      readRequestFresh: () => { freshReads += 1; return fixture.adapter.readRequest(); },
    },
  });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.publicationRecovered, true);
  assert.equal(freshReads, 1);
  assert.equal(fixture.counter.count, 1);
  assert.equal(fixture.workspace.records.get(`receipts/${fixture.first.completionReceiptId}.json`).disposition,
    'RELAY_COMPLETE:BRIDGE_VERIFIED_PASS:WORKSPACE_QA_PASS');
});

test('expired publication recovery rejects changed questions, mismatched answers and missing private handoffs without writes', async () => {
  for (const mutation of ['question', 'answer', 'handoff', 'future-answer']) {
    const fixture = await strandedQa();
    if (mutation === 'question') fixture.request.boundedPayload.questionRecord = { ...fixture.question, summary: 'Different question' };
    else if (mutation === 'handoff') {
      for (const key of fixture.workspace.records.keys()) if (key.startsWith('outbox/conversation-canvas-handoff-')) fixture.workspace.records.delete(key);
    } else {
      const key = [...fixture.workspace.records.keys()].find((key) => key.startsWith('outbox/qa-answer-'));
      const answer = fixture.workspace.records.get(key);
      fixture.workspace.records.set(key, { ...answer,
        ...(mutation === 'answer' ? { subjectId: 'different-question' } : { timestampUtc: new Date(NOW.getTime() + 1000).toISOString() }),
      });
    }
    const writeCount = fixture.workspace.writes.length;
    const eventCount = fixture.workspace.events.length;
    const previousBody = fixture.body();
    const result = await runChatGptSharedWorkspaceGitHubRelay({ ...fixture.options, now: new Date(NOW.getTime() + 20 * 60 * 1000) });
    assert.equal(result.ok, false, mutation);
    assert.equal(result.classification, 'CHATGPT_SHARED_WORKSPACE_QA_PUBLICATION_RECOVERY_BLOCKED', mutation);
    assert.equal(fixture.workspace.writes.length, writeCount, mutation);
    assert.equal(fixture.workspace.events.length, eventCount, mutation);
    assert.equal(fixture.body(), previousBody, mutation);
    assert.equal(fixture.counter.count, 1, mutation);
  }
});

test('expired unpublished Q&A without an accepted receipt does not gain cognition authority', async () => {
  const workspace = fakeWorkspace();
  const counter = { count: 0 };
  const request = qaRequest(canonicalQuestionRecord());
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...relayOptions(workspace, {
      readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
      writeResponse: () => ({ ok: true }),
    }, counter),
    now: new Date(NOW.getTime() + 20 * 60 * 1000),
  });
  assert.equal(result.verificationStatus, 'BLOCKED_EXPIRED_REQUEST');
  assert.equal(counter.count, 0);
  assert.equal(workspace.writes.some((entry) => ['inbox', 'outbox'].includes(entry.segments[0])), false);
});

test('accepted old Q&A does not authorize an unauthenticated expiry retry', async () => {
  const fixture = await strandedQa();
  const result = await runChatGptSharedWorkspaceGitHubRelay({
    ...fixture.options, now: new Date(NOW.getTime() + 20 * 60 * 1000),
    adapter: { ...fixture.adapter,
      readRequest: () => ({ ...fixture.adapter.readRequest(), authorLogin: 'another-user' }),
    },
  });
  assert.equal(result.verificationStatus, 'BLOCKED_AUTHENTICATION_FAILED');
  assert.equal(result.publicationRecovered, false);
  assert.equal(fixture.counter.count, 1);
});

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
  assert.match(responseBody, /"sanitizedAnswer"/);
  assert.equal(responseBody.includes(groundedResponse().output_text), true);
  assert.match(responseBody, /"rawAnswerIncluded": false/);
  assert.match(responseBody, /"authorityWidening": false/);
});

test('resumed Q&A redacts canonical secret-shaped answer text before public response publication', async () => {
  const workspace = fakeWorkspace();
  const questionRecord = canonicalQuestionRecord();
  const request = qaRequest(questionRecord);
  const answerCounter = { count: 0 };
  let responseAttempts = 0;
  let responseBody = '';
  const adapter = {
    readRequest: () => ({ ok: true, body: envelope(request), authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
    writeResponse: (body) => {
      responseAttempts += 1;
      responseBody = body;
      return responseAttempts === 1
        ? { ok: false, reason: 'RESPONSE_COMMENT_WRITE_FAILED' }
        : { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
    },
  };
  const options = {
    ...relayOptions(workspace, adapter, answerCounter),
    persistConversationCanvasFn: async () => ({
      ok: true,
      classification: 'TEST_CANVAS_PERSISTED',
      persisted: true,
      resumed: false,
      handoffId: 'test-canvas-handoff',
      publicProjection: {
        bodyIncluded: false,
        rawAnswerIncluded: false,
      },
    }),
  };

  const first = await runChatGptSharedWorkspaceGitHubRelay(options);
  assert.equal(first.ok, false);
  const answerKey = [...workspace.records.keys()].find((key) => key.startsWith('outbox/qa-answer-'));
  assert.ok(answerKey);
  const persistedAnswer = workspace.records.get(answerKey);
  const answerBody = JSON.parse(persistedAnswer.body);
  answerBody.payload.answerText = 'password=do-not-publish';
  workspace.records.set(answerKey, { ...persistedAnswer, body: JSON.stringify(answerBody) });

  const second = await runChatGptSharedWorkspaceGitHubRelay(options);
  assert.equal(second.ok, true);
  assert.equal(second.deliveryStatus, 'WORKSPACE_QA_PASS');
  assert.equal(answerCounter.count, 1, 'resumed answer must not re-query Stephanos');
  assert.equal(responseBody.includes('password=do-not-publish'), false);
  assert.equal(responseBody.includes('"answerText": "[REDACTED]"'), true);
  assert.match(responseBody, /"redacted": true/);
  assert.match(responseBody, /"rawAnswerIncluded": false/);
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
