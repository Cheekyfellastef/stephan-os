import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawGuardrailSnapshot, isOpenClawActionBlocked } from './openclawGuardrails.js';

test('OpenClaw guardrails enforce shadow-mode direct execution blocks', () => {
  const snapshot = buildOpenClawGuardrailSnapshot();
  assert.equal(snapshot.mode, 'shadow');
  assert.equal(snapshot.zeroCostPosture, 'active');
  assert.equal(snapshot.paidPathsAllowed, false);
  assert.equal(snapshot.directExecutionAllowed, false);
  assert.equal(snapshot.blockedActionCount > 5, true);
});

test('catastrophic actions are structurally blocked', () => {
  assert.equal(isOpenClawActionBlocked('delete-github-repository'), true);
  assert.equal(isOpenClawActionBlocked('force-push-history-rewrite'), true);
  assert.equal(isOpenClawActionBlocked('automatic-git-hard-reset-or-prune'), true);
  assert.equal(isOpenClawActionBlocked('harmless-read-only-summary'), false);
});
