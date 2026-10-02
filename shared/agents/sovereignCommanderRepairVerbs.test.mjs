import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_REMOTE_ACTIONS,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';
import {
  createSovereignCommanderMcpHandler,
} from '../../scripts/sovereign-commander-mcp.mjs';

const HEAD = 'a'.repeat(40);

test('guarded remote Commander exposes semantic recovery and proof verbs', () => {
  for (const remoteAction of [
    'repair-openclaw-standalone',
    'repair-openclaw-local',
    'repair-goal-builder-flow',
    'repair-openclaw-stack',
    'prove-vr-atlas-runtime',
  ]) {
    assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(remoteAction));
    const checked = validateSovereignCommanderRemoteCommandShape({
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'repair-verbs-test',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 2519,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: HEAD,
      expiresAt: '2026-10-01T13:00:00.000Z',
      remoteAction,
    });
    assert.equal(checked.ok, true, remoteAction);
  }
});

test('local Commander MCP advertises the same recovery and proof verbs', async () => {
  const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo' });
  await handler(
    'initialize',
    { protocolVersion: '2025-11-25', clientInfo: { name: 'repair-verbs-test' } },
    { isRequest: true, isNotification: false },
  );
  await handler(
    'notifications/initialized',
    {},
    { isRequest: false, isNotification: true },
  );
  const listed = await handler('tools/list', {}, { isRequest: true, isNotification: false });
  const maintenance = listed.tools.find((tool) => tool.name === 'maintenance_action');
  assert.ok(maintenance);
  for (const actionId of [
    'repair-openclaw-standalone',
    'repair-openclaw-local',
    'repair-goal-builder-flow',
    'repair-openclaw-stack',
    'prove-vr-atlas-runtime',
  ]) {
    assert.ok(maintenance.inputSchema.properties.actionId.enum.includes(actionId), actionId);
  }
});


test('guarded remote Commander admits exact-head preservation convergence only with bounded target identity', () => {
  const checked = validateSovereignCommanderRemoteCommandShape({
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'preservation-convergence-test',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2519,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: 'b'.repeat(40),
    expiresAt: '2026-10-02T13:00:00.000Z',
    remoteAction: 'preservation-converge-pr-branch',
    targetPrNumber: 2561,
    targetBranch: 'feature/virtual-airlink-acceptance-failures',
    targetHead: 'a'.repeat(40),
  });
  assert.equal(checked.ok, true);
  assert.equal(checked.command.targetPrNumber, 2561);
  assert.equal(checked.command.targetBranch, 'feature/virtual-airlink-acceptance-failures');
  assert.equal(checked.command.targetHead, 'a'.repeat(40));

  for (const candidate of [
    { targetBranch: 'main' },
    { targetHead: 'b'.repeat(40) },
    { targetPrNumber: 0 },
  ]) {
    const blocked = validateSovereignCommanderRemoteCommandShape({
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'preservation-convergence-blocked-test',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 2519,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: 'b'.repeat(40),
      expiresAt: '2026-10-02T13:00:00.000Z',
      remoteAction: 'preservation-converge-pr-branch',
      targetPrNumber: 2561,
      targetBranch: 'feature/virtual-airlink-acceptance-failures',
      targetHead: 'a'.repeat(40),
      ...candidate,
    });
    assert.equal(blocked.ok, false);
  }
});

test('local Commander MCP exposes and forwards bounded preservation convergence identity', async () => {
  let capturedEnvelope = null;
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      capturedEnvelope = envelope;
      return { ok: true, finalVerdict: 'TEST_CAPTURED' };
    },
  });
  await handler(
    'initialize',
    { protocolVersion: '2025-11-25', clientInfo: { name: 'preservation-test' } },
    { isRequest: true, isNotification: false },
  );
  await handler(
    'notifications/initialized',
    {},
    { isRequest: false, isNotification: true },
  );
  const listed = await handler('tools/list', {}, { isRequest: true, isNotification: false });
  const maintenance = listed.tools.find((tool) => tool.name === 'maintenance_action');
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('preservation-converge-pr-branch'));

  await handler('tools/call', {
    name: 'maintenance_action',
    arguments: {
      actionId: 'preservation-converge-pr-branch',
      targetPrNumber: 2561,
      targetBranch: 'feature/virtual-airlink-acceptance-failures',
      targetHead: 'a'.repeat(40),
      expectedMain: 'b'.repeat(40),
    },
  }, { isRequest: true, isNotification: false });

  assert.equal(capturedEnvelope.payload.actionId, 'preservation-converge-pr-branch');
  assert.equal(capturedEnvelope.payload.targetPrNumber, 2561);
  assert.equal(capturedEnvelope.payload.targetBranch, 'feature/virtual-airlink-acceptance-failures');
  assert.equal(capturedEnvelope.payload.targetHead, 'a'.repeat(40));
  assert.equal(capturedEnvelope.payload.expectedMain, 'b'.repeat(40));
});
