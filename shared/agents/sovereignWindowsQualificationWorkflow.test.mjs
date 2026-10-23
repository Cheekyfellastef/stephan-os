import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../.github/workflows/sovereign-commander-capability-parity.yml', import.meta.url), 'utf8');
const pull = source.slice(source.indexOf('  pull_request:'), source.indexOf('  push:'));
const push = source.slice(source.indexOf('  push:'), source.indexOf('\npermissions:'));
const paths = section => [...section.matchAll(/^      - '([^']+)'/gm)].map(m => m[1]);

test('isolated changes anywhere in the qualified estate and reviewer rerun the native Windows job on PR and main', () => {
  const required = [
    'scripts/windows/run-sovereign-commander-hidden.ps1',
    'scripts/windows/status-stephanos-core-daemon.ps1',
    'scripts/windows/stephanos-core-process-observation.ps1',
    'shared/agents/windowsAuthorityStephanosCoreDaemonReviewV1.mjs',
    'shared/agents/windowsAuthorityStephanosCoreDaemonReviewV1.test.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistBoundaryV1.test.mjs',
    'shared/agents/operatorMergeApprovalBoundaryV2.mjs',
    'shared/agents/canonicalMissionWorkerEvidenceV1.mjs',
    'stephanos-server/services/githubLifeboatLane7Service.js',
    'stephanos-server/services/githubLifeboatLane7ClaimAckKeeper.js',
    'stephanos-server/services/missionOrchestratorWorkerConsumer.js',
    'stephanos-server/services/missionOrchestratorWorkerService.js',
    'scripts/battle-bridge-goal-discovery-heartbeat.mjs',
    'scripts/stephanos-core-daemon.mjs',
    'scripts/sovereign-commander-control-plane-repair.mjs',
    'scripts/sovereign-commander-control-plane-repair.test.mjs',
    'shared/agents/stephanosCoreDaemonV1.mjs',
    'shared/agents/stephanosCoreDaemonV1.test.mjs',
  ];
  assert.deepEqual(paths(pull), paths(push), 'PR and main must exercise the same qualification surface');
  for (const changedPath of required) {
    assert.ok(paths(pull).some(pattern => pattern.endsWith('*')
      ? changedPath.startsWith(pattern.slice(0, -1)) : changedPath === pattern), changedPath);
  }
  const windowsJob = source.slice(source.indexOf('  windows-core-admission:'));
  assert.match(windowsJob, /runs-on: windows-latest/);
  for (const fixture of ['stephanos-server/services/githubLifeboatLane7Service.test.js',
    'stephanos-server/services/githubLifeboatLane7ClaimAckKeeper.test.js',
    'stephanos-server/services/missionOrchestratorWorkerConsumer.test.js',
    'stephanos-server/services/missionOrchestratorWorkerService.test.js',
    'scripts/battle-bridge-goal-discovery-heartbeat.test.mjs',
    'scripts/sovereign-commander-custody-recycle.test.mjs',
    'shared/agents/stephanosCoreDaemonV1.test.mjs',
    'scripts/sovereign-commander-control-plane-repair.test.mjs',
    'shared/agents/stephanosCoreProcessObservationV1.test.mjs',
    'scripts/sovereign-goal-builder-worker-evidence.test.mjs',
    'shared/agents/windowsAuthorityStephanosCoreDaemonReviewV1.test.mjs']) {
    assert.ok(windowsJob.includes(fixture), fixture);
  }
});
