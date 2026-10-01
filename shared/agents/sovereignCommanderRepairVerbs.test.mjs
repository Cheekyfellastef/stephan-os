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

test('guarded remote Commander exposes semantic recovery and runtime proof verbs', () => {
  for (const remoteAction of [
    'repair-openclaw-standalone',
    'repair-openclaw-local',
    'repair-goal-builder-flow',
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

test('local Commander MCP advertises the same recovery and runtime proof verbs', async () => {
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
    'prove-vr-atlas-runtime',
  ]) {
    assert.ok(maintenance.inputSchema.properties.actionId.enum.includes(actionId), actionId);
  }
});
