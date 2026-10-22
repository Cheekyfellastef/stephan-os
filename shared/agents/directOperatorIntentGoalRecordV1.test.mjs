import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedWorkspaceGoalRecord, validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import { buildDirectOperatorIntentStandingAuthorityV1 } from './directOperatorIntentStandingAuthorityV1.mjs';

test('a canonical goal record can carry direct-request provenance without granting authority by itself', () => {
  const directOperatorIntentAuthority = buildDirectOperatorIntentStandingAuthorityV1({
    requestId: 'request-2002',
    goalId: 'goal-2002',
    originSurface: 'stephanos-chat',
    intent: 'Complete the bounded requested outcome through proof and the normal protected completion path.',
  });
  const record = createSharedWorkspaceGoalRecord({
    goalId: 'goal-2002',
    participantId: 'stephanos',
    timestampUtc: '2026-09-28T13:55:00.000Z',
    title: 'Completion-first goal',
    status: 'READY',
    directOperatorIntentAuthority,
  });
  assert.deepEqual(record.directOperatorIntentAuthority, directOperatorIntentAuthority);
  assert.notEqual(record.directOperatorIntentAuthority, directOperatorIntentAuthority);
  const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse('2026-09-28T14:00:00.000Z') });
  assert.equal(validation.valid, true, validation.errors.join(', '));
});

test('ordinary goals remain unchanged when no direct-request provenance exists', () => {
  const record = createSharedWorkspaceGoalRecord({
    goalId: 'goal-2003',
    timestampUtc: '2026-09-28T13:55:00.000Z',
    title: 'Autonomous improvement proposal',
  });
  assert.equal(Object.hasOwn(record, 'directOperatorIntentAuthority'), false);
});
