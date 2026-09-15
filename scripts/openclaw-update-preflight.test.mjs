import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'openclaw-update-preflight.mjs');
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);

function input() {
  return {
    observedAtUtc: '2026-08-03T17:55:00Z',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: '1'.repeat(40),
    openClaw: {
      version: '2026.6.1',
      executablePath: 'C:\\OpenClaw\\openclaw.cmd',
      executableSha256: HEX_A,
      packagePath: 'C:\\OpenClaw\\node_modules\\openclaw',
      packageSha256: HEX_B,
      installPath: 'C:\\OpenClaw\\node_modules\\openclaw',
      gatewayEndpoint: 'http://127.0.0.1:18789',
      startupSource: 'shared:openclaw-control-panel-start-gateway',
      startupCommand: 'openclaw gateway start --json',
    },
    updatePacket: {
      packetId: 'openclaw-2026.8.0',
      sourceId: 'official-openclaw-npm-package',
      targetVersion: '2026.8.0',
      packetSha256: HEX_C,
    },
    inventory: [
      { path: 'plugins/openclaw/command.mjs', digestSha256: HEX_A },
      { path: '.openclaw/openclaw.json', digestSha256: HEX_B },
    ],
  };
}

test('CLI reads one bounded JSON observation from stdin and writes no mutation claim', () => {
  const result = spawnSync(process.execPath, [CLI], {
    input: JSON.stringify(input()),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'APPROVAL_REQUIRED');
  assert.equal(output.safety.mutationAllowed, false);
  assert.equal(output.safety.updateAttempted, false);
  assert.equal(result.stderr, '');
});

test('CLI exits 2 for a blocked preflight while still returning the rollback packet', () => {
  const blocked = input();
  blocked.inventory.push({ path: 'unknown/addon.bin', digestSha256: HEX_C });
  const result = spawnSync(process.execPath, [CLI], {
    input: JSON.stringify(blocked),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'BLOCKED_WITH_RESTORE_PATH');
  assert.equal(output.rollbackPlan.length, 6);
});

test('CLI rejects malformed JSON without emitting a packet', () => {
  const result = spawnSync(process.execPath, [CLI], {
    input: '{not-json',
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^OPENCLAW_UPDATE_PREFLIGHT_ERROR=/);
});

test('CLI entrypoint detection handles Windows paths without depending on file URL spelling', async () => {
  const { isDirectCliEntrypoint } = await import('./openclaw-update-preflight.mjs');
  assert.equal(isDirectCliEntrypoint({
    metaUrl: 'file:///C:/Users/Stephan/Documents/GitHub/stephan-os/scripts/openclaw-update-preflight.mjs',
    argv1: 'scripts\\openclaw-update-preflight.mjs',
    cwd: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
  }), true);
  assert.equal(isDirectCliEntrypoint({
    metaUrl: 'file:///C:/Users/Stephan/Documents/GitHub/stephan-os/scripts/openclaw-update-preflight.mjs',
    argv1: 'scripts\\different.mjs',
    cwd: 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os',
    platform: 'win32',
  }), false);
});
