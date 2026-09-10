import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
  FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
  FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
} from './forgeShadowBattleBridgeAdapterV1.mjs';

const NOW = new Date('2026-08-06T22:30:00.000Z');
const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
    requestId: 'forge-shadow-m2-20260806-001',
    operation: FORGE_SHADOW_BATTLE_BRIDGE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    forgejoVersion: FORGE_SHADOW_BATTLE_BRIDGE_VERSION,
    forgejoImageDigest: DIGEST,
    runtimeBoundary: FORGE_SHADOW_BATTLE_BRIDGE_BOUNDARY,
    m2Only: true,
    expiresAt: '2026-08-07T00:30:00.000Z',
    ...overrides,
  };
}

function nonForgeCommand(overrides = {}) {
  const {
    forgejoVersion: _forgejoVersion,
    forgejoImageDigest: _forgejoImageDigest,
    runtimeBoundary: _runtimeBoundary,
    m2Only: _m2Only,
    ...base
  } = command({ operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS' });
  return { ...base, ...overrides };
}

test('Forge M2 is one named canonical mailbox operation', () => {
  assert.ok(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.includes(FORGE_SHADOW_BATTLE_BRIDGE_OPERATION));
  assert.equal(BATTLE_BRIDGE_GITHUB_COMMAND_OPERATIONS.filter((value) => value === FORGE_SHADOW_BATTLE_BRIDGE_OPERATION).length, 1);
});

test('mailbox validates and normalizes only the fixed Forge M2 fields', () => {
  const result = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_ACCEPTED');
  assert.equal(result.command.operation, FORGE_SHADOW_BATTLE_BRIDGE_OPERATION);
  assert.equal(result.command.expectedHead, HEAD);
  assert.equal(result.command.forgejoVersion, '15.0.6');
  assert.equal(result.command.forgejoImageDigest, DIGEST);
  assert.equal(result.command.runtimeBoundary, 'podman-wsl-rootless');
  assert.equal(result.command.m2Only, true);
  assert.equal(result.command.command, undefined);
  assert.equal(result.command.executable, undefined);
  assert.equal(result.command.path, undefined);
});

test('Forge-specific fields are forbidden on every non-Forge mailbox command', () => {
  for (const [field, value] of [
    ['forgejoVersion', '15.0.6'],
    ['forgejoImageDigest', DIGEST],
    ['runtimeBoundary', 'podman-wsl-rootless'],
    ['m2Only', true],
  ]) {
    const result = validateBattleBridgeGitHubCommand(nonForgeCommand({ [field]: value }), {
      authorLogin: 'Cheekyfellastef',
      now: NOW,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'FORGE_SHADOW_FIELD_NOT_ALLOWED');
    assert.equal(result.field, field);
  }
});

test('wrong Forge identity is rejected by the shared mailbox before execution', () => {
  for (const candidate of [
    command({ forgejoVersion: '15.0.5' }),
    command({ forgejoImageDigest: 'forgejo:latest' }),
    command({ runtimeBoundary: 'rootful' }),
    command({ m2Only: false }),
    command({ expectedHead: '' }),
    command({ command: 'powershell' }),
    command({ token: 'secret' }),
  ]) {
    const result = validateBattleBridgeGitHubCommand(candidate, {
      authorLogin: 'Cheekyfellastef',
      now: NOW,
    });
    assert.equal(result.ok, false);
  }
});

test('shared executor dispatches Forge M2 only through its named handler', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  const calls = [];
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    executeForgeShadowM2: async (input) => {
      calls.push(input);
      return {
        ok: true,
        finalVerdict: 'FORGE_SHADOW_M2_READY',
        sourceHead: input.expectedHead,
        forgejoImageDigest: input.forgejoImageDigest,
        readyForM3: true,
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, FORGE_SHADOW_BATTLE_BRIDGE_OPERATION);
  assert.equal(calls[0].forgejoImageDigest, DIGEST);
});

test('blocked Forge execution remains blocked through the shared executor', async () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  const result = await executeBattleBridgeGitHubCommand(validated.command, {
    executeForgeShadowM2: async () => ({ ok: false, blocker: 'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_BLOCKED');
  assert.equal(result.result.blocker, 'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED');
});

test('Forge mailbox receipt records immutable identity but no credential surface', () => {
  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
  });
  const receipt = buildBattleBridgeGitHubCommandReceipt({
    command: validated.command,
    state: 'DONE',
    acceptedAt: '2026-08-06T22:31:00.000Z',
    heartbeatAt: '2026-08-06T22:32:00.000Z',
    completedAt: '2026-08-06T22:33:00.000Z',
    result: {
      ok: true,
      finalVerdict: 'FORGE_SHADOW_M2_READY',
      sourceHead: HEAD,
      forgejoImageDigest: DIGEST,
      githubCredentialUsed: false,
      readyForM3: true,
    },
    proofRefs: ['proofs/forge-shadow-parity.json'],
  });
  assert.equal(receipt.operation, FORGE_SHADOW_BATTLE_BRIDGE_OPERATION);
  assert.equal(receipt.expectedHead, HEAD);
  assert.equal(receipt.forgejoVersion, '15.0.6');
  assert.equal(receipt.forgejoImageDigest, DIGEST);
  assert.equal(receipt.runtimeBoundary, 'podman-wsl-rootless');
  assert.equal(receipt.m2Only, true);
  assert.equal(receipt.credentialsMayBeReadOrExported, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
  assert.doesNotMatch(JSON.stringify(receipt), /password|privatekey|cookie|session/i);
});
