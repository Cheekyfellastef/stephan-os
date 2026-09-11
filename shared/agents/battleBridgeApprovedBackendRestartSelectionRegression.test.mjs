import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  executeBattleBridgeGitHubCommand,
  selectBattleBridgeGitHubCommandBatch,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
  validateApprovedBackendRestartCommandShape,
} from './battleBridgeApprovedBackendRestartMailboxV1.mjs';

const NOW = new Date('2026-09-11T20:12:00.000Z');
const HEAD = '6c1f4de16a2c9252bd719403f1ae8fbae6a8470c';

function restartCommand() {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'backend-restart-selection-regression-0001',
    operation: BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-11T21:12:00.000Z',
  };
}

function restartComment() {
  return {
    id: 2174001,
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}#issuecomment-2174001`,
    created_at: NOW.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(restartCommand())}\n\`\`\``,
  };
}

test('selected approved backend restart remains specialist-valid and executable', async () => {
  const batch = selectBattleBridgeGitHubCommandBatch([restartComment()], { now: NOW });
  assert.equal(batch.ok, true);
  assert.equal(batch.verdict, 'COMMAND_BATCH_READY');
  assert.equal(batch.commands.length, 1);

  const selected = batch.commands[0].command;
  assert.deepEqual(Object.keys(selected).sort(), [
    'branch',
    'expectedHead',
    'expiresAt',
    'issueNumber',
    'operation',
    'operatorApproval',
    'repository',
    'requestId',
    'schemaVersion',
  ].sort());
  assert.deepEqual(validateApprovedBackendRestartCommandShape(selected), {
    ok: true,
    verdict: 'APPROVED_BACKEND_RESTART_COMMAND_SHAPE_VALID',
    expectedHead: HEAD,
  });

  let calls = 0;
  const execution = await executeBattleBridgeGitHubCommand(selected, {
    restartApprovedBackend: async (command) => {
      calls += 1;
      assert.equal(command.operation, BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_OPERATION);
      assert.equal(command.expectedHead, HEAD);
      return { ok: true, finalVerdict: 'BATTLE_BRIDGE_APPROVED_BACKEND_RESTART_PASS' };
    },
  });
  assert.equal(execution.ok, true);
  assert.equal(execution.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(calls, 1);
});
