import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOpenClawAgentCommandInventory } from './openClawAgentCommandAudit.mjs';

function baseInventory(overrides = {}) {
  return {
    gateway: { exitCode: 0 },
    agents: [
      { id: 'standalone' },
      { id: 'stephanos-scout-coder' },
    ],
    matches: [
      { path: 'plugins/router/index.js', excerpt: "api.registerCommand({ name: 'standalone'" },
      { path: 'plugins/router/index.js', excerpt: "api.registerCommand({ name: 'scout-coder'" },
    ],
    ...overrides,
  };
}

test('accepts grounded plugin commands with unique target agents', () => {
  const result = assessOpenClawAgentCommandInventory(baseInventory());
  assert.equal(result.allCommandsGrounded, true);
  assert.equal(result.finalVerdict, 'OPENCLAW_AGENT_COMMAND_AUDIT_READY_FOR_UPGRADE_DECISION');
  assert.deepEqual(result.commands.map((entry) => entry.registrationKind), ['plugin-command', 'plugin-command']);
});

test('blocks when Gateway status is unavailable', () => {
  const result = assessOpenClawAgentCommandInventory(baseInventory({ gateway: { exitCode: 1 } }));
  assert.equal(result.allCommandsGrounded, false);
  assert.ok(result.commands.every((entry) => entry.blockingReasons.includes('gateway-status-unproven')));
});

test('blocks missing and ambiguous target agents', () => {
  const result = assessOpenClawAgentCommandInventory(baseInventory({
    agents: [{ id: 'standalone' }, { id: 'standalone-copy' }],
  }));
  assert.ok(result.commands[0].blockingReasons.includes('target-agent-ambiguous'));
  assert.ok(result.commands[1].blockingReasons.includes('target-agent-not-found'));
});

test('blocks commands with mutation authority pending review', () => {
  const result = assessOpenClawAgentCommandInventory(baseInventory({
    matches: [
      { path: 'plugins/router/index.js', excerpt: "api.registerCommand({ name: 'standalone', tools: ['shell']" },
      { path: 'plugins/router/index.js', excerpt: "api.registerCommand({ name: 'scout-coder'" },
    ],
  }));
  assert.ok(result.commands[0].blockingReasons.includes('mutation-authority-requires-review'));
  assert.deepEqual(result.commands[0].mutationTerms, ['shell']);
});

test('does not invent command provenance', () => {
  const result = assessOpenClawAgentCommandInventory(baseInventory({ matches: [] }));
  assert.ok(result.commands.every((entry) => entry.registrationKind === 'not-found'));
  assert.ok(result.commands.every((entry) => entry.blockingReasons.includes('command-registration-not-found')));
});
