import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_AUTHORISED_CHAT_HISTORY_INGEST_SCHEMA_VERSION,
  buildStephanosAuthorisedChatHistoryIngestV1,
} from './stephanosAuthorisedChatHistoryIngestV1.mjs';

const observedAtUtc = '2026-09-25T22:30:00.000Z';

function consent(overrides = {}) {
  return {
    visibilityAllowed: true,
    learningCandidatesAllowed: true,
    durableLearningAllowed: true,
    scope: 'ALL_AUTHORISED_CHATS',
    ...overrides,
  };
}

function historyItem(overrides = {}) {
  return {
    chatId: 'chat-001',
    messageId: 'msg-001',
    role: 'operator',
    sourceSurface: 'chatgpt-web',
    originalCreatedAtUtc: '2026-09-20T10:00:00.000Z',
    text: 'The best click is no click.',
    knowledgeClass: 'PREFERENCE',
    retentionIntent: 'REMEMBER_DURABLY',
    explicitOperatorTeaching: true,
    supersedesKnowledgeId: '',
    sourceRefs: ['chat://chat-001/message/msg-001'],
    authorised: true,
    ...overrides,
  };
}

test('explicitly authorised historical chat items become real Knowledge Twin context', () => {
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [
      historyItem(),
      historyItem({
        messageId: 'msg-002',
        role: 'chatgpt',
        originalCreatedAtUtc: '2026-09-20T10:01:00.000Z',
        text: 'I will preserve the same bounded project context.',
        knowledgeClass: 'NONE',
        retentionIntent: 'CONTEXT_ONLY',
        explicitOperatorTeaching: false,
        sourceRefs: ['chat://chat-001/message/msg-002'],
      }),
    ],
  });

  assert.equal(result.schemaVersion, STEPHANOS_AUTHORISED_CHAT_HISTORY_INGEST_SCHEMA_VERSION);
  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.classification, 'AUTHORISED_CHAT_HISTORY_CONTEXT_READY');
  assert.equal(result.importedItemCount, 2);
  assert.equal(result.knowledgeTwin.visibilityScope, 'ALL_AUTHORISED_CHATS');
  assert.equal(result.knowledgeTwin.visibleItems.length, 2);
  assert.equal(result.knowledgeTwin.durableTeachingCandidates.length, 1);
  assert.equal(result.authority.memoryWriteAllowed, false);
  assert.equal(result.authority.commandExecutionAllowed, false);
});

test('identical retries deduplicate by original chat and message identity', () => {
  const item = historyItem();
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [item, { ...item }],
  });

  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.importedItemCount, 1);
  assert.equal(result.deduplicatedItemCount, 1);
  assert.equal(result.sourceLineage.length, 1);
});

test('conflicting duplicate history fails closed', () => {
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [
      historyItem(),
      historyItem({ text: 'Conflicting bytes for the same source identity.' }),
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /duplicate-conflict/);
});

test('unauthorised or future history never enters context', () => {
  const denied = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [historyItem({ authorised: false })],
  });
  assert.equal(denied.valid, false);
  assert.match(denied.errors.join('\n'), /not-authorised/);

  const future = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [historyItem({ originalCreatedAtUtc: '2026-09-26T10:00:00.000Z' })],
  });
  assert.equal(future.valid, false);
  assert.match(future.errors.join('\n'), /timestamp-invalid/);
});

test('provider text cannot self-promote as operator teaching', () => {
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [
      historyItem({
        role: 'chatgpt',
        knowledgeClass: 'KNOWLEDGE',
        retentionIntent: 'REMEMBER_DURABLY',
        explicitOperatorTeaching: true,
      }),
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /explicit-teaching-must-be-operator/);
});

test('secret-shaped historical text inherits the Knowledge Twin fail-closed boundary', () => {
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [historyItem({ text: 'api_key=super-secret-value' })],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /secret-shaped-text-blocked/);
});


test('selected history visibility scope is enforced before Knowledge Twin construction', () => {
  const currentThread = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent({ scope: 'CURRENT_SHARED_THREAD' }),
    currentSharedThreadChatId: 'chat-001',
    historyItems: [
      historyItem(),
      historyItem({ chatId: 'chat-002', messageId: 'msg-002', sourceRefs: ['chat://chat-002/message/msg-002'] }),
    ],
  });
  assert.equal(currentThread.valid, false);
  assert.match(currentThread.errors.join('\n'), /outside-selected-visibility-scope/);

  const projectChats = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent({ scope: 'AUTHORISED_PROJECT_CHATS' }),
    authorisedProjectChatIds: ['chat-001'],
    historyItems: [
      historyItem(),
      historyItem({ chatId: 'chat-002', messageId: 'msg-002', sourceRefs: ['chat://chat-002/message/msg-002'] }),
    ],
  });
  assert.equal(projectChats.valid, false);
  assert.match(projectChats.errors.join('\n'), /outside-selected-visibility-scope/);
});

test('composite source identity is unambiguous when IDs contain colons', () => {
  const result = buildStephanosAuthorisedChatHistoryIngestV1({
    observedAtUtc,
    operatorConsent: consent(),
    historyItems: [
      historyItem({
        chatId: 'a:b',
        messageId: 'c',
        sourceRefs: ['chat://a:b/message/c'],
      }),
      historyItem({
        chatId: 'a',
        messageId: 'b:c',
        originalCreatedAtUtc: '2026-09-20T10:00:01.000Z',
        text: 'Distinct source identity.',
        sourceRefs: ['chat://a/message/b:c'],
      }),
    ],
  });

  assert.equal(result.valid, true, result.errors.join(', '));
  assert.equal(result.importedItemCount, 2);
  assert.equal(result.deduplicatedItemCount, 0);
});
