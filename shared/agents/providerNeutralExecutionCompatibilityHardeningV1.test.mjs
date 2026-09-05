import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_NEUTRAL_HARD_DENIALS_V1,
  createProviderNeutralResultEnvelope,
  createProviderNeutralTaskEnvelope,
  validateProviderNeutralResultEnvelope,
  validateProviderNeutralTaskEnvelope,
} from './providerNeutralExecutionCompatibilityV1.mjs';

const BASE = '4cf0cc1bf6bc73d72637c80120583fc3b8512eea';
const HEAD = 'ae2058307eeaa0c7b146f386ba004a97b74b05b5';

function taskWithCommands(commands) {
  return createProviderNeutralTaskEnvelope({
    missionId: 'mission-1947-command-hardening',
    goalId: 'goal-1947',
    taskId: 'task-command-hardening',
    taskClass: 'deterministic-test',
    correlationId: 'corr-command-hardening',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'agent/provider-neutral-execution-compatibility-v1',
    exactBase: BASE,
    exactHeadIfReadOnly: HEAD,
    allowedPaths: ['shared/agents/providerNeutralExecutionCompatibilityV1.mjs'],
    allowedOperations: ['read', 'test'],
    allowedCommandsOrTestIds: commands,
    forbiddenOperations: [...PROVIDER_NEUTRAL_HARD_DENIALS_V1],
    timeoutAndRetryBudget: { timeoutMs: 120_000, maxAttempts: 1 },
    resourceLeaseIds: ['lease-provider-neutral-command-hardening'],
    requiredTests: commands,
    requiredArtifacts: ['proofs/provider-neutral-command-hardening.json'],
    requiredEvidence: ['proof/provider-neutral-command-hardening.json'],
    completionContract: 'PROVIDER_NEUTRAL_COMMAND_HARDENING_PASS',
    operatorApprovalState: {
      requiresOperatorApprovalBeforeDispatch: false,
      dispatchApprovalPresent: false,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
      mergeApprovalPresent: false,
    },
    portableCheckpointRef: 'receipts/provider-neutral-command-hardening.json',
    createdAtUtc: '2026-08-23T21:00:00Z',
    expiresAtUtc: '2026-08-23T22:00:00Z',
    sourceAdapter: 'github-first',
  });
}

test('legacy command compatibility admits only the closed-world safe command grammar', () => {
  for (const command of [
    'node --test shared/agents/providerNeutralExecutionCompatibilityV1.test.mjs',
    'node --check shared/agents/providerNeutralExecutionCompatibilityV1.mjs',
    'git diff --check',
    'npm test',
  ]) {
    const validation = validateProviderNeutralTaskEnvelope(taskWithCommands([command]));
    assert.equal(validation.valid, true, `${command}: ${JSON.stringify(validation.errors)}`);
  }
});

test('shell control, substitution, redirection, newlines and escaped variants fail closed', () => {
  const hostile = [
    'node --test safe.mjs && powershell -File arbitrary.ps1',
    'node --test safe.mjs || sh arbitrary.sh',
    'npm test; curl example.invalid',
    'git diff --check | sh',
    'node --test `whoami`',
    'node --test $(whoami)',
    'node --test safe.mjs > out.txt',
    'node --test safe.mjs < in.txt',
    'node --test safe.mjs\r\nnpm test',
    'node --test safe.mjs \\&& powershell -File arbitrary.ps1',
  ];
  for (const command of hostile) {
    const validation = validateProviderNeutralTaskEnvelope(taskWithCommands([command]));
    assert.equal(validation.valid, false, `unexpectedly admitted ${JSON.stringify(command)}`);
    assert.equal(
      validation.errors.includes('allowed-command-or-test-id-invalid') || validation.errors.includes('required-tests-invalid'),
      true,
      `${command}: ${JSON.stringify(validation.errors)}`,
    );
  }
});

test('task and result envelopes reject extra top-level authority hitchhikers', () => {
  const task = taskWithCommands(['git diff --check']);
  assert.equal(validateProviderNeutralTaskEnvelope(task).valid, true);

  const widenedTask = Object.freeze({ ...task, mergeAllowed: true });
  const taskValidation = validateProviderNeutralTaskEnvelope(widenedTask);
  assert.equal(taskValidation.valid, false);
  assert.equal(taskValidation.errors.includes('task-envelope-fields-invalid'), true);

  const result = createProviderNeutralResultEnvelope({
    provider: 'github-first',
    providerInstance: 'github-first-worker-v1',
    providerVersion: 'v1',
    taskClass: task.taskClass,
    missionId: task.missionId,
    goalId: task.goalId,
    taskId: task.taskId,
    correlationId: task.correlationId,
    exactInputIdentity: HEAD,
    exactOutputIdentity: HEAD,
    authorityUsed: ['read', 'test'],
    commandsOrTestIdsExecuted: ['git diff --check'],
    changedPaths: [],
    artifacts: ['proofs/provider-neutral-command-hardening.json'],
    proofRefs: ['proof/provider-neutral-command-hardening.json'],
    portableCheckpointRef: task.portableCheckpointRef,
    startedAtUtc: '2026-08-23T21:01:00Z',
    completedAtUtc: '2026-08-23T21:02:00Z',
    verdict: 'complete',
    blockers: [],
    retryState: 'none',
    leaseDisposition: 'released',
  });
  assert.equal(validateProviderNeutralResultEnvelope(result, task).valid, true);

  const widenedResult = Object.freeze({ ...result, arbitraryCommandAllowed: true });
  const resultValidation = validateProviderNeutralResultEnvelope(widenedResult, task);
  assert.equal(resultValidation.valid, false);
  assert.equal(resultValidation.errors.includes('result-envelope-fields-invalid'), true);
});
