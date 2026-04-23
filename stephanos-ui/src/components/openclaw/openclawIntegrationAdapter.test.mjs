import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoundedOpenClawIntent, buildOpenClawIntegrationSnapshot } from './openclawIntegrationAdapter.js';

test('adapter accepts bounded intents only', () => {
  const accepted = buildBoundedOpenClawIntent({ intentType: 'run-scan', payload: { scanType: 'architecture-scan' } });
  assert.equal(accepted.accepted, true);

  const rejected = buildBoundedOpenClawIntent({ intentType: 'execute-shell', payload: { cmd: 'rm -rf /' } });
  assert.equal(rejected.accepted, false);
  assert.match(rejected.rejectionReason, /bounded scan\/prompt\/status intents only/);
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
  assert.equal(snapshot.authority, 'Proposal Only');
  assert.equal(snapshot.approvalRequired, 'Yes');
  assert.equal(snapshot.warnings.length >= 3, true);
  assert.equal(snapshot.topology[1].label, 'OpenClaw Adapter');
  assert.equal(snapshot.connectedTo.codexHandoff, 'approved-only');
  assert.equal(snapshot.blockedCapabilities.length > 0, true);
});
