import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResponsePlan } from './responsePlanner.js';

test('merge-decision missing PR evidence returns wait and proof required', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'merge-decision', relevantCanon: [], contextProviderIdsUsed: [] }, uiRealityStatus: { severity: 'OK' } });
  assert.equal(plan.answerShape, 'merge-decision');
  assert.equal(plan.mergeDecision, 'wait');
  assert.equal(plan.proofRequired, 'yes');
});

test('merge-decision missing checks requires proof', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'merge-decision' }, contextProviderSnapshot: { contextProviderProofState: { buildVerifyStatus: 'unknown' } }, uiRealityStatus: { severity: 'OK' }, supportSnapshotSummary: { prEvidenceInputDetected: 'yes' } });
  assert.equal(plan.proofRequired, 'yes');
  assert.equal(plan.mergeDecision, 'wait');
});

test('codex-prompt mode returns prompt sections', () => {
  const plan = buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'codex-prompt' } });
  assert.ok(plan.requiredSections.includes('forbidden-actions'));
});

test('diagnosis and architecture/direct-answer stay compact', () => {
  assert.equal(buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'diagnosis' } }).answerShape, 'diagnosis');
  assert.equal(buildResponsePlan({ chatContextPack: { recommendedResponseMode: 'architecture-guidance' } }).answerShape, 'architecture-guidance');
  assert.equal(buildResponsePlan({}).answerShape, 'direct-answer');
});
