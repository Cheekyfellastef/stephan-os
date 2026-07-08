import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptainsBridgeExactHeadApproval, projectCaptainsBridgeMergePipeline } from './captainsBridgeMergePipeline.mjs';
const head = 'abcdef1234567890';

test('G14 holds without approval after proof passed', () => {
  const p = projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' } });
  assert.equal(p.phase, 'EXACT_HEAD_APPROVAL');
  assert.match(p.exactNextAction, /APPROVE_PR_1440_HEAD_abcdef/);
});

test('G14 rejects stale exact-head approval', () => {
  const p = projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' }, approval: createCaptainsBridgeExactHeadApproval({ prNumber: 1440, headSha: '1111111' }) });
  assert.equal(p.phase, 'EXACT_HEAD_APPROVAL');
  assert.deepEqual(p.missingEvidence, ['FRESH_EXACT_HEAD_APPROVAL']);
});

test('G14 advances passed proof through merge and post-merge sync', () => {
  const approval = createCaptainsBridgeExactHeadApproval({ prNumber: 1440, headSha: head });
  assert.equal(projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' }, approval }).phase, 'MERGE_RECEIPT');
  assert.equal(projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' }, approval, mergeReceipt: { merged: true } }).phase, 'MAIN_SYNC');
  assert.equal(projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' }, approval, mergeReceipt: { merged: true }, mainSync: { synced: true } }).phase, 'IGNITION_PROOF');
  assert.equal(projectCaptainsBridgeMergePipeline({ pr: { number: 1440, headSha: head }, proof: { status: 'passed' }, approval, mergeReceipt: { merged: true }, mainSync: { synced: true }, ignitionProof: { status: 'passed' } }).phase, 'COMPLETE');
});
