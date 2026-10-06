import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoundedOpenClawIntent, buildOpenClawIntegrationSnapshot } from './openclawIntegrationAdapter.js';

test('adapter accepts bounded intents only', () => {
  const accepted = buildBoundedOpenClawIntent({ intentType: 'run-scan', payload: { scanType: 'architecture-scan' } });
  assert.equal(accepted.accepted, true);
  const buildGoal = buildBoundedOpenClawIntent({ intentType: 'submit-build-goal', payload: { intent: 'Fix the bounded issue.' } });
  assert.equal(buildGoal.accepted, true);

  const rejected = buildBoundedOpenClawIntent({ intentType: 'execute-shell', payload: { cmd: 'rm -rf /' } });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.rejectionReason, /bounded scan\/prompt\/build-goal\/status intents only/);
});

test('integration snapshot surfaces warnings for unsafe trust posture', () => {
  const snapshot = buildOpenClawIntegrationSnapshot({
    runtimeStatusModel: {
      runtimeContext: {
        openClawSandboxActive: false,
        openClawNativePluginsAllowed: true,
        openClawRepoScope: '/workspace',
      },
    },
    repoPath: '/workspace/stephan-os',
  });

  assert.equal(snapshot.agentName, 'OpenClaw');
  assert.equal(snapshot.authority, 'Canonical Build Goal Intake');
  assert.equal(snapshot.approvalRequired, 'Only at existing guarded approval gates');
  assert.equal(snapshot.warnings.length >= 3, true);
  assert.equal(snapshot.topology[1].label, 'OpenClaw Adapter');
  assert.equal(snapshot.connectedTo.goalConveyor, 'connected');
  assert.equal(snapshot.governedBuildIntakeEnabled, true);
  assert.equal(snapshot.directMutationEnforced, true);
  assert.equal(snapshot.blockedCapabilities.length > 0, true);
});
