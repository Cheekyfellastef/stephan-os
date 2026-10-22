import assert from 'node:assert/strict';
import test from 'node:test';

import { runMissionWorkerDiagnosticLink } from './mission-worker-diagnostic-link.mjs';

const HEAD = 'a'.repeat(40);
const PATHS = Object.freeze({
  repoRoot: 'C:\\canonical\\stephan-os',
  workspaceRoot: 'C:\\canonical\\workspace',
  probeScriptPath: 'C:\\canonical\\stephan-os\\scripts\\windows\\probe-mission-orchestrator-worker-watchdog.ps1',
});

function exactIdentity() {
  return Object.freeze({
    ok: true,
    sourceHead: HEAD,
    remoteMainHead: HEAD,
    branch: 'main',
    expectedHeadMatch: true,
    sourceTrackedClean: true,
    headMatchesRemoteMain: true,
  });
}

function dependenciesForStartFailure(error) {
  return {
    readSourceIdentity: async () => exactIdentity(),
    resolvePaths: () => PATHS,
    validatePaths: () => ({ ok: true }),
    createProbeAdapter: () => ({
      run(mode) {
        if (mode === 'StartApprovedWorkerTask') {
          return { ok: false, restartBlocker: '', error };
        }
        throw new Error(`Unexpected probe mode: ${mode}`);
      },
    }),
    now: () => new Date('2026-09-07T17:40:00.000Z'),
  };
}

test('diagnostic promotes one allowlisted approved-task pre-start blocker from bounded child telemetry', async () => {
  const result = await runMissionWorkerDiagnosticLink(
    { expectedHead: HEAD },
    dependenciesForStartFailure('{"blocker":"APPROVED_TASK_ARGUMENTS_MISMATCH","finalVerdict":"APPROVED_RUNTIME_RESTART_BLOCKED"}'),
  );

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'APPROVED_TASK_ARGUMENTS_MISMATCH');
  assert.equal(result.typedRestartBlocker, 'APPROVED_TASK_ARGUMENTS_MISMATCH');
  assert.equal(result.downstreamSectionReached, 'APPROVED_WORKER_START');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
});

test('diagnostic refuses arbitrary or ambiguous child error promotion', async () => {
  for (const error of [
    'TOTALLY_UNBOUNDED_FAILURE',
    'APPROVED_TASK_MISSING APPROVED_TASK_ARGUMENTS_MISMATCH',
  ]) {
    const result = await runMissionWorkerDiagnosticLink(
      { expectedHead: HEAD },
      dependenciesForStartFailure(error),
    );

    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MISSION_WORKER_DIAGNOSTIC_LINK_START_FAILED');
    assert.equal(result.typedRestartBlocker, '');
  }
});
