import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_RESILIENCE_STATUS,
  buildOpenClawResilienceContract,
  createOpenClawFallbackRequest,
  createOpenClawFallbackResult,
  validateOpenClawFallbackRequest,
} from './openClawResilience.mjs';

test('contract exposes fallback kinds and read-only guardrails', () => {
  const contract = buildOpenClawResilienceContract();

  assert.equal(contract.fallbackKinds.includes('SCOUT'), true);
  assert.equal(contract.fallbackKinds.includes('PATCH_PREP'), true);
  assert.equal(contract.guardrails.readonlyDefault, true);
  assert.equal(contract.guardrails.sourceMutationAllowed, false);
  assert.equal(contract.guardrails.githubMutationAllowed, false);
  assert.equal(contract.guardrails.inventedProofAllowed, false);
  assert.equal(contract.finalVerdict, 'OPENCLAW_RESILIENCE_CONTRACT_READY');
});

test('scout request preserves bounded read paths and shared workspace message', () => {
  const request = createOpenClawFallbackRequest({
    fallbackKind: 'SCOUT',
    relatedGoal: '#1284',
    summary: 'Scout worker recovery state.',
    allowedReadPaths: ['scripts/mission-orchestrator-worker.mjs', '../outside.txt', 'node_modules/cache.json'],
    requiredEvidence: ['worker health observation'],
  });

  assert.deepEqual(request.allowedReadPaths, ['scripts/mission-orchestrator-worker.mjs']);
  assert.equal(request.sourceMutationAllowed, false);
  assert.equal(request.sharedWorkspaceMessage.eventKind, 'request');
  assert.equal(validateOpenClawFallbackRequest(request).valid, true);
});

test('patch prep is operator gated and can suggest safe patch paths', () => {
  const request = createOpenClawFallbackRequest({
    fallbackKind: 'PATCH_PREP',
    suggestedPatchPaths: ['shared/agents/openClawResilience.mjs', 'apps/stephanos/dist/index.html'],
  });

  assert.equal(request.requiresOperator, true);
  assert.deepEqual(request.suggestedPatchPaths, ['shared/agents/openClawResilience.mjs']);
  assert.equal(validateOpenClawFallbackRequest(request).finalVerdict, 'OPENCLAW_FALLBACK_REQUEST_PASS');
});

test('validator blocks unsanitized mutation and unsafe paths', () => {
  const result = validateOpenClawFallbackRequest({
    schemaVersion: 'openclaw-resilience.v1',
    kind: 'stephanos.openclaw_resilience.fallback_request',
    requestId: 'bad-request',
    fallbackKind: 'SCOUT',
    status: 'READY',
    allowedReadPaths: ['../outside.txt'],
    sourceMutationAllowed: true,
    githubMutationAllowed: true,
    sharedWorkspaceMessage: {},
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('source-mutation-not-allowed'), true);
  assert.equal(result.errors.includes('github-mutation-not-allowed'), true);
  assert.equal(result.errors.includes('unsafe-read-path'), true);
});

test('blocked request requires exact unblock action', () => {
  const request = createOpenClawFallbackRequest({
    status: 'BLOCKED_WITH_EXACT_UNBLOCK_ACTION',
    exactUnblockAction: 'Repair OpenClaw scout config and rerun proof.',
  });

  assert.equal(request.status, OPENCLAW_RESILIENCE_STATUS.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(request.exactUnblockAction, 'Repair OpenClaw scout config and rerun proof.');
  assert.equal(validateOpenClawFallbackRequest(request).valid, true);
});

test('fallback result wraps verification evidence', () => {
  const request = createOpenClawFallbackRequest({
    fallbackKind: 'PROOF',
    allowedReadPaths: ['proof/worker/recovery.json'],
  });
  const result = createOpenClawFallbackResult(request, {
    success: true,
    evidence: ['worker recovery proof observed'],
    commandOutputHash: 'd'.repeat(64),
    proofRefs: ['proof/openclaw-resilience/result.json'],
  });

  assert.equal(result.status, OPENCLAW_RESILIENCE_STATUS.DONE);
  assert.equal(result.verifierResult.status, 'PASS');
  assert.equal(result.finalVerdict, 'OPENCLAW_RESILIENCE_RESULT_PASS');
});
