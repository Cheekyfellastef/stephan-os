import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
  CODEX_QUEUE_STATUS,
  buildCodexDispatchQueueContract,
  createCodexDispatchClaim,
  createCodexDispatchResult,
  createCodexQueueItem,
  validateCodexQueueItem,
} from './codexDispatchQueue.mjs';

test('contract exposes statuses and zero-cost guardrails', () => {
  const contract = buildCodexDispatchQueueContract();
  assert.equal(contract.schemaVersion, CODEX_DISPATCH_QUEUE_SCHEMA_VERSION);
  assert.equal(contract.statuses.includes('READY'), true);
  assert.equal(contract.statuses.includes('BLOCKED_BY_METER'), true);
  assert.equal(contract.guardrails.zeroCostDefault, true);
  assert.equal(contract.guardrails.cloudMeterAutoSpendAllowed, false);
  assert.equal(contract.guardrails.mergeWithoutOperatorApprovalAllowed, false);
  assert.equal(contract.finalVerdict, 'CODEX_DISPATCH_QUEUE_CONTRACT_READY');
});

test('ready queue item preserves bounded source scope and shared workspace message', () => {
  const item = createCodexQueueItem({
    relatedGoal: '#1292',
    summary: 'Build deterministic Codex dispatch queue.',
    allowedFiles: ['shared/agents/codexDispatchQueue.mjs', 'shared/agents/codexDispatchQueue.test.mjs'],
    requiredTests: ['node --test shared/agents/codexDispatchQueue.test.mjs'],
    requiredEvidence: ['focused queue contract tests pass'],
    createdAtUtc: '2026-06-28T22:00:00Z',
  });

  assert.equal(item.status, CODEX_QUEUE_STATUS.READY);
  assert.deepEqual(item.allowedFiles, ['shared/agents/codexDispatchQueue.mjs', 'shared/agents/codexDispatchQueue.test.mjs']);
  assert.equal(item.sharedWorkspaceMessage.eventKind, 'codex-job-ready');
  assert.equal(validateCodexQueueItem(item).finalVerdict, 'CODEX_QUEUE_ITEM_PASS');
});

test('unsafe paths and unsafe test commands are rejected or removed', () => {
  const item = createCodexQueueItem({
    relatedGoal: '#1292',
    summary: 'Unsafe queue item should be bounded.',
    allowedFiles: ['shared/agents/codexDispatchQueue.mjs', '../secret.txt', 'apps/stephanos/dist/index.html', 'C:/Users/Stephan/.env'],
    requiredTests: ['node --test shared/agents/codexDispatchQueue.test.mjs', 'curl token'],
  });

  assert.deepEqual(item.allowedFiles, ['shared/agents/codexDispatchQueue.mjs']);
  assert.deepEqual(item.requiredTests, ['node --test shared/agents/codexDispatchQueue.test.mjs']);
  assert.equal(validateCodexQueueItem(item).valid, true);
});

test('validator blocks unsanitized queue payloads', () => {
  const result = validateCodexQueueItem({
    schemaVersion: CODEX_DISPATCH_QUEUE_SCHEMA_VERSION,
    kind: 'stephanos.codex_dispatch.queue_item',
    queueItemId: 'bad-item',
    status: 'READY',
    summary: 'Bad item',
    allowedFiles: ['../outside.json'],
    requiredTests: ['bash steal-secret'],
    sharedWorkspaceMessage: {},
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('unsafe-allowed-file'), true);
  assert.equal(result.errors.includes('unsafe-required-test'), true);
  assert.equal(result.errors.includes('invalid-shared-workspace-message'), true);
});

test('claim wraps a valid queue item and marks it claimed', () => {
  const item = createCodexQueueItem({
    relatedGoal: '#1292',
    summary: 'Claimable queue item.',
    allowedFiles: ['shared/agents/codexDispatchQueue.mjs'],
  });
  const claim = createCodexDispatchClaim(item, {
    claimedBy: 'codex',
    claimedAtUtc: '2026-06-28T22:05:00Z',
    claimExpiresAtUtc: '2026-06-28T22:20:00Z',
  });

  assert.equal(claim.status, CODEX_QUEUE_STATUS.CLAIMED);
  assert.equal(claim.queueItem.claimedBy, 'codex');
  assert.equal(claim.finalVerdict, 'CODEX_DISPATCH_CLAIM_PASS');
});

test('dispatch result produces verification result and keeps merge approval guardrail', () => {
  const item = createCodexQueueItem({
    relatedGoal: '#1292',
    summary: 'Result queue item.',
    allowedFiles: ['shared/agents/codexDispatchQueue.mjs'],
  });
  const result = createCodexDispatchResult(item, {
    success: true,
    evidence: ['node --test shared/agents/codexDispatchQueue.test.mjs PASS'],
    commandOutputHash: 'b'.repeat(64),
    proofRefs: ['proof/codex-dispatch/result.json'],
  });

  assert.equal(result.status, CODEX_QUEUE_STATUS.COMPLETE);
  assert.equal(result.queueItem.requiresOperatorApprovalBeforeMerge, true);
  assert.equal(result.verifierResult.status, 'PASS');
  assert.equal(result.finalVerdict, 'CODEX_DISPATCH_RESULT_PASS');
});
