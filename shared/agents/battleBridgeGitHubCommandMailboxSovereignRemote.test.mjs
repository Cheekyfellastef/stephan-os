import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  executeBattleBridgeGitHubCommand,
  selectNextBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import { SOVEREIGN_COMMANDER_REMOTE_OPERATION } from './sovereignCommanderRemoteMailboxV1.mjs';

const now = new Date('2026-10-01T08:30:00.000Z');
const HEAD = 'e42d31670da802cc15d4c323dd8dcff10a03033f';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'sovereign-remote-1001',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2158,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-10-01T10:00:00.000Z',
    remoteAction: 'status',
    ...overrides,
  };
}

function comment(payload = command()) {
  return {
    id: 501,
    html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2158#issuecomment-501',
    created_at: now.toISOString(),
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(payload)}\n\`\`\``,
  };
}

test('Sovereign remote ingress is an allowlisted owner-approved mailbox operation', () => {
  assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(SOVEREIGN_COMMANDER_REMOTE_OPERATION), true);
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now,
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.remoteAction, 'status');

  const selected = selectNextBattleBridgeGitHubCommand([comment()], { now });
  assert.equal(selected.ok, true);
  assert.equal(selected.command.operation, SOVEREIGN_COMMANDER_REMOTE_OPERATION);
  assert.equal(selected.command.remoteAction, 'status');
});

test('mailbox dispatches Sovereign remote command only through its bounded adapter', async () => {
  const validated = validateBattleBridgeGitHubCommand(command({ remoteAction: 'battle-bridge-status' }), {
    authorLogin: 'Cheekyfellastef',
    now,
  });
  let calls = 0;
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    executeSovereignCommanderRemoteOnBattleBridgeFn: async (candidate) => {
      calls += 1;
      assert.equal(candidate.remoteAction, 'battle-bridge-status');
      return {
        ok: true,
        verdict: 'COMMAND_EXECUTION_COMPLETE',
        publicReceiptSafe: true,
        secretMaterialReturned: false,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
});

test('unsafe mobile fields terminalize before dispatch', () => {
  const unsafe = command({ path: 'C:\\Users\\Stephan Callear\\secret.txt' });
  const validated = validateBattleBridgeGitHubCommand(unsafe, {
    authorLogin: 'Cheekyfellastef',
    now,
  });
  assert.equal(validated.ok, false);
  assert.equal(validated.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');

  const selected = selectNextBattleBridgeGitHubCommand([comment(unsafe)], { now });
  assert.equal(selected.verdict, 'NO_COMMAND_READY');
  assert.equal(selected.terminalRejections.length, 1);
  assert.equal(selected.terminalRejections[0].blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED');
});
