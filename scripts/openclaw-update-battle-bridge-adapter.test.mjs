import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import {
  OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_INPUT_BYTES,
  isDirectCliEntrypoint,
  runOpenClawUpdateBattleBridgeAdapterCli,
} from './openclaw-update-battle-bridge-adapter.mjs';

const NOW = new Date('2026-08-04T12:00:00.000Z');

function command(overrides = {}) {
  return {
    schema: 'stephanos.openclaw-update-battle-bridge-command.v1',
    commandId: 'openclaw-update-command-1',
    action: 'APPLY_PINNED_OPENCLAW_UPDATE',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: 'a'.repeat(40),
    manifestSha256: 'b'.repeat(64),
    packetId: 'openclaw-1.2.4',
    packetSha256: 'c'.repeat(64),
    currentVersion: '1.2.3',
    targetVersion: '1.2.4',
    approvalId: 'approval-1415-a',
    stageId: 'stage-openclaw-1.2.4',
    backupSetId: 'backup-openclaw-1.2.3',
    stagedUpdateStatus: 'READY_TO_APPLY',
    hostId: 'stephanos-battle-bridge-windows',
    requestedBy: 'Cheekyfellastef',
    operatorApproval: 'operator-approved',
    canaryRequired: true,
    issuedAtUtc: '2026-08-04T11:59:00.000Z',
    expiresAtUtc: '2026-08-04T13:00:00.000Z',
    ...overrides,
  };
}

function sink() {
  let value = '';
  return {
    write(chunk) { value += String(chunk); },
    value() { return value; },
  };
}

test('CLI validates and renders only the fixed adapter plan', async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await runOpenClawUpdateBattleBridgeAdapterCli({
    stdin: Readable.from([JSON.stringify(command())]),
    stdout,
    stderr,
    now: NOW,
  });
  assert.equal(code, 0);
  assert.equal(stderr.value(), '');
  const result = JSON.parse(stdout.value());
  assert.equal(result.ok, true);
  assert.equal(result.plan[0].actionId, 'VERIFY_BATTLE_BRIDGE_SOURCE_HEAD');
  assert.equal(result.plan.at(-1).actionId, 'PUBLISH_UPDATED_AND_VERIFIED');
  assert.equal(result.safety.arbitraryShellAllowed, false);
});

test('CLI returns blocked code for unsafe generic command fields', async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await runOpenClawUpdateBattleBridgeAdapterCli({
    stdin: Readable.from([JSON.stringify(command({ command: 'npm install -g openclaw' }))]),
    stdout,
    stderr,
    now: NOW,
  });
  assert.equal(code, 2);
  const result = JSON.parse(stdout.value());
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_UPDATE_COMMAND_FIELD_NOT_ALLOWED');
  assert.equal(stderr.value(), '');
});

test('CLI rejects malformed, empty and non-object input', async () => {
  for (const raw of ['', '{', '[]']) {
    const stdout = sink();
    const stderr = sink();
    const code = await runOpenClawUpdateBattleBridgeAdapterCli({
      stdin: Readable.from([raw]),
      stdout,
      stderr,
      now: NOW,
    });
    assert.equal(code, 1);
    assert.equal(stdout.value(), '');
    assert.match(stderr.value(), /^OPENCLAW_UPDATE_BATTLE_BRIDGE_ERROR=/);
  }
});

test('CLI refuses oversized input', async () => {
  const stdout = sink();
  const stderr = sink();
  const raw = `{"padding":"${'x'.repeat(OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_INPUT_BYTES)}"}`;
  const code = await runOpenClawUpdateBattleBridgeAdapterCli({
    stdin: Readable.from([raw]),
    stdout,
    stderr,
    now: NOW,
  });
  assert.equal(code, 1);
  assert.match(stderr.value(), /input exceeds/i);
});

test('direct-entrypoint detection supports POSIX and Windows paths', () => {
  assert.equal(isDirectCliEntrypoint({
    metaUrl: pathToFileURL('/repo/scripts/openclaw-update-battle-bridge-adapter.mjs').href,
    argv1: 'scripts/openclaw-update-battle-bridge-adapter.mjs',
    cwd: '/repo',
    platform: 'linux',
  }), true);
  assert.equal(isDirectCliEntrypoint({
    metaUrl: pathToFileURL('/C:/repo/scripts/openclaw-update-battle-bridge-adapter.mjs').href,
    argv1: 'scripts\\openclaw-update-battle-bridge-adapter.mjs',
    cwd: 'C:\\repo',
    platform: 'win32',
  }), true);
});
