import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPHANOS_OPERATOR_KNOWLEDGE_CLASS,
  STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE,
  STEPHANOS_OPERATOR_RETENTION_INTENT,
  buildStephanosOperatorKnowledgeTwinV1,
} from './stephanosOperatorKnowledgeTwinV1.mjs';

const t0 = '2026-09-25T17:50:00.000Z';

function consent(overrides = {}) {
  return {
    visibilityAllowed: true,
    learningCandidatesAllowed: true,
    durableLearningAllowed: true,
    scope: STEPHANOS_OPERATOR_KNOWLEDGE_SCOPE.ALL_AUTHORISED_CHATS,
    ...overrides,
  };
}

function item(overrides = {}) {
  return {
    chatId: 'chat-001',
    messageId: 'msg-001',
    role: 'operator',
    sourceSurface: 'chatgpt-web',
    createdAtUtc: '2026-09-25T17:49:00.000Z',
    text: 'The fast-moving main must be handled by preservation convergence.',
    knowledgeClass: STEPHANOS_OPERATOR_KNOWLEDGE_CLASS.LESSON,
    retentionIntent: STEPHANOS_OPERATOR_RETENTION_INTENT.REMEMBER_DURABLY,
    explicitOperatorTeaching: true,
    supersedesKnowledgeId: '',
    sourceRefs: ['project://stephan-os'],
    ...overrides,
  };
}

test('all authorised chats can be visible while only explicit operator teaching becomes durable candidate', () => {
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [
      item(),
      item({
        messageId: 'msg-002',
        role: 'chatgpt',
        text: 'I can help inspect the current lane.',
        knowledgeClass: 'NONE',
        retentionIntent: 'CONTEXT_ONLY',
        explicitOperatorTeaching: false,
      }),
      item({
        messageId: 'msg-003',
        role: 'stephanos',
        sourceSurface: 'shared-workspace',
        text: 'Current project context acknowledged.',
        knowledgeClass: 'NONE',
        retentionIntent: 'CONTEXT_ONLY',
        explicitOperatorTeaching: false,
      }),
    ],
  });

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.visibilityScope, 'ALL_AUTHORISED_CHATS');
  assert.equal(result.visibleItems.length, 3);
  assert.equal(result.knowledgeCandidates.length, 1);
  assert.equal(result.durableTeachingCandidates.length, 1);
  assert.equal(result.durableTeachingCandidates[0].origin, 'OPERATOR_TEACHING');
  assert.equal(result.authority.memoryWriteAllowed, false);
});

test('broad visibility does not automatically convert ordinary operator remarks into durable truth', () => {
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [
      item({
        text: 'I might test Starfield tomorrow.',
        knowledgeClass: 'OPEN_THREAD',
        retentionIntent: 'CONTEXT_ONLY',
        explicitOperatorTeaching: false,
      }),
    ],
  });

  assert.equal(result.valid, true);
  assert.equal(result.visibleItems.length, 1);
  assert.equal(result.knowledgeCandidates.length, 0);
  assert.equal(result.durableTeachingCandidates.length, 0);
  assert.equal(result.verdict, 'READY_CONTEXT_ONLY');
});

test('durable learning requires explicit operator teaching and consent', () => {
  const noTeaching = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [item({ explicitOperatorTeaching: false })],
  });
  assert.equal(noTeaching.valid, false);
  assert.match(noTeaching.validationErrors.join('\n'), /durable-learning-requires-explicit-operator-teaching/);

  const noConsent = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent({ durableLearningAllowed: false }),
    items: [item()],
  });
  assert.equal(noConsent.valid, false);
  assert.match(noConsent.validationErrors.join('\n'), /durable-learning-consent-required/);
});

test('sensitive personal material may remain context-only but is not promoted by default', () => {
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [
      item({
        text: 'A medical diagnosis was discussed in this chat.',
        knowledgeClass: 'KNOWLEDGE',
        retentionIntent: 'LEARNING_CANDIDATE',
        explicitOperatorTeaching: true,
      }),
    ],
  });

  assert.equal(result.valid, true);
  assert.equal(result.visibleItems.length, 1);
  assert.equal(result.knowledgeCandidates.length, 0);
  assert.match(result.omissions.join('\n'), /high-sensitivity-not-promoted-by-default/);
});

test('secret-shaped text and psychological-profile content fail closed', () => {
  const secret = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [item({ text: 'api_key=super-secret-value' })],
  });
  assert.equal(secret.valid, false);
  assert.match(secret.validationErrors.join('\n'), /secret-shaped-text-blocked/);

  const profile = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [item({ text: 'Build a psychological profile of me from every chat.' })],
  });
  assert.equal(profile.valid, false);
  assert.match(profile.validationErrors.join('\n'), /psychological-profile-content-blocked/);
});

test('corrections retain historical lineage instead of overwriting the past', () => {
  const first = item({
    messageId: 'msg-old',
    text: 'Use two fixed builder lanes.',
    knowledgeClass: 'DECISION',
  });
  const firstProjection = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [first],
  });
  assert.equal(firstProjection.valid, true);
  const oldKnowledgeId = firstProjection.visibleItems[0].knowledgeId;

  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [
      first,
      item({
        messageId: 'msg-new',
        createdAtUtc: '2026-09-25T17:49:30.000Z',
        text: 'Use elastic lanes instead of a fixed two-lane ceiling.',
        knowledgeClass: 'CORRECTION',
        supersedesKnowledgeId: oldKnowledgeId,
      }),
    ],
  });

  assert.equal(result.valid, true, result.validationErrors.join(', '));
  assert.equal(result.historicalLinks.length, 1);
  assert.equal(result.historicalLinks[0].olderKnowledgeId, oldKnowledgeId);
  assert.equal(result.historicalLinks[0].relation, 'SUPERSEDED_BY');
});

test('provider/model output cannot self-certify as operator knowledge', () => {
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [
      item({
        role: 'chatgpt',
        knowledgeClass: 'KNOWLEDGE',
        retentionIntent: 'REMEMBER_DURABLY',
        explicitOperatorTeaching: true,
      }),
    ],
  });
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /explicit-teaching-must-be-operator/);
});

test('visibility requires explicit operator permission', () => {
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent({ visibilityAllowed: false }),
    items: [item({ retentionIntent: 'CONTEXT_ONLY', explicitOperatorTeaching: false })],
  });
  assert.equal(result.valid, false);
  assert.match(result.validationErrors.join('\n'), /operator-visibility-consent-required/);
});

test('accessor-bearing data fails without executing getters', () => {
  let calls = 0;
  const hostile = item();
  Object.defineProperty(hostile, 'text', {
    enumerable: true,
    get() {
      calls += 1;
      throw new Error('must not execute');
    },
  });
  const result = buildStephanosOperatorKnowledgeTwinV1({
    observedAtUtc: t0,
    operatorConsent: consent(),
    items: [hostile],
  });
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
});
