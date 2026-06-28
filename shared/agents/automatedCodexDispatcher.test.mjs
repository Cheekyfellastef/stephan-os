import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION,
  CODEX_DISPATCH_DECISION,
  buildAutomatedCodexDispatcherContract,
  createCodexDispatchDecision,
  createCodexDispatcherResult,
} from './automatedCodexDispatcher.mjs';

const readyItem = {
  relatedGoal: '#1293',
  summary: 'Dispatch queued Codex work deterministically.',
  allowedFiles: ['shared/agents/automatedCodexDispatcher.mjs'],
  requiredTests: ['node --test shared/agents/automatedCodexDispatcher.test.mjs'],
  requiredEvidence: ['dispatcher tests pass'],
};

test('dispatcher contract exposes decisions and guardrails', () => {
  const contract = buildAutomatedCodexDispatcherContract();
  assert.equal(contract.schemaVersion, AUTOMATED_CODEX_DISPATCHER_SCHEMA_VERSION);
  assert.equal(contract.decisions.includes('DISPATCH_READY_ITEM'), true);
  assert.equal(contract.decisions.includes('BLOCKED_BY_METER'), true);
  assert.equal(contract.guardrails.zeroCostDefault, true);
  assert.equal(contract.guardrails.dispatchWhenMeterUnavailableAllowed, false);
  assert.equal(contract.guardrails.visibleClipboardCourierRequired, false);
  assert.equal(contract.finalVerdict, 'AUTOMATED_CODEX_DISPATCHER_CONTRACT_READY');
});

test('ready valid queue item becomes dispatch claim', () => {
  const decision = createCodexDispatchDecision({
    queueItem: readyItem,
    codexMeterAvailable: true,
    decidedAtUtc: '2026-06-28T23:00:00Z',
    claimExpiresAtUtc: '2026-06-28T23:20:00Z',
  });

  assert.equal(decision.decision, CODEX_DISPATCH_DECISION.DISPATCH_READY_ITEM);
  assert.equal(decision.dispatchClaim.status, 'CLAIMED');
  assert.equal(decision.sharedWorkspaceMessage.eventKind, 'codex-dispatch-attempted');
  assert.equal(decision.finalVerdict, 'CODEX_DISPATCHER_READY_TO_DISPATCH');
});

test('meter unavailable blocks dispatch with exact unblock action', () => {
  const decision = createCodexDispatchDecision({
    queueItem: readyItem,
    codexMeterAvailable: false,
  });

  assert.equal(decision.decision, CODEX_DISPATCH_DECISION.BLOCKED_BY_METER);
  assert.equal(decision.requiresOperator, true);
  assert.equal(decision.dispatchClaim, null);
  assert.equal(decision.exactUnblockAction.includes('Codex meter is unavailable'), true);
  assert.equal(decision.finalVerdict, 'CODEX_DISPATCHER_BLOCKED');
});

test('missing queue item waits without inventing work', () => {
  const decision = createCodexDispatchDecision({ queueItems: [] });

  assert.equal(decision.decision, CODEX_DISPATCH_DECISION.WAIT_FOR_READY_ITEM);
  assert.equal(decision.queueItemId, '');
  assert.equal(decision.dispatchClaim, null);
  assert.equal(decision.finalVerdict, 'CODEX_DISPATCHER_WAITING');
});

test('operator approval can gate dispatch before handoff', () => {
  const decision = createCodexDispatchDecision({
    queueItem: readyItem,
    requireOperatorApprovalBeforeDispatch: true,
    operatorApproved: false,
  });

  assert.equal(decision.decision, CODEX_DISPATCH_DECISION.BLOCKED_BY_OPERATOR_APPROVAL);
  assert.equal(decision.requiresOperator, true);
  assert.equal(decision.exactUnblockAction.includes('Operator must approve dispatch'), true);
});

test('dispatcher result wraps queue result and verification evidence', () => {
  const decision = createCodexDispatchDecision({ queueItem: readyItem });
  const result = createCodexDispatcherResult({
    decision,
    success: true,
    evidence: ['node --test shared/agents/automatedCodexDispatcher.test.mjs PASS'],
    commandOutputHash: 'c'.repeat(64),
    proofRefs: ['proof/automated-codex-dispatcher/result.json'],
  });

  assert.equal(result.success, true);
  assert.equal(result.dispatchResult.verifierResult.status, 'PASS');
  assert.equal(result.finalVerdict, 'AUTOMATED_CODEX_DISPATCHER_RESULT_PASS');
});
