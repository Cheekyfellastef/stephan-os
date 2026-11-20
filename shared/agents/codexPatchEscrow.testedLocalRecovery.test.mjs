import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CODEX_RECOVERY_DECISION,
  attachLocalBuildEvidence,
  createCodexWorkspaceAttempt,
  planCodexWorkspaceRecovery,
} from './codexPatchEscrow.mjs';

const BASE_SHA = 'a'.repeat(40);
const LOCAL_SHA = 'b'.repeat(40);

function expiredAttempt() {
  return createCodexWorkspaceAttempt({
    issueNumber: 1567,
    jobId: 'mission-worker-1567',
    attemptNumber: 7,
    baseSha: BASE_SHA,
    targetBranch: 'fix/1567-source-artifact-escrow-completion-gate-v1',
    createdAtUtc: '2026-09-10T20:00:00Z',
    leaseOwner: 'mission-worker-1567',
    leaseSeconds: 60,
  });
}

test('expired TESTED_LOCAL work with a valid local head is preserved instead of rebuilt', () => {
  const tested = attachLocalBuildEvidence(expiredAttempt(), {
    localHeadSha: LOCAL_SHA,
    testsPassed: true,
    updatedAtUtc: '2026-09-10T20:00:30Z',
  }).attempt;

  const plan = planCodexWorkspaceRecovery({
    attempts: [tested],
    nowUtc: '2026-09-10T21:00:00Z',
  });

  assert.notEqual(
    plan.decision,
    CODEX_RECOVERY_DECISION.START_NEW_ATTEMPT,
    'verified tested-local source must never be rebuilt solely because its lease expired before escrow publication',
  );
});

test('genuinely unbuilt expired work may still admit a new attempt under existing policy', () => {
  const plan = planCodexWorkspaceRecovery({
    attempts: [expiredAttempt()],
    nowUtc: '2026-09-10T21:00:00Z',
  });

  assert.equal(plan.decision, CODEX_RECOVERY_DECISION.START_NEW_ATTEMPT);
});
