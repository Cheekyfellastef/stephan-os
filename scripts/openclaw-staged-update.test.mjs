import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import {
  OPENCLAW_STAGED_UPDATE_MAX_INPUT_BYTES,
  isDirectCliEntrypoint,
  runOpenClawStagedUpdateCli,
} from './openclaw-staged-update.mjs';

const SOURCE_HEAD = 'a'.repeat(40);
const MANIFEST = 'b'.repeat(64);
const PACKET_SHA = 'c'.repeat(64);

function validInput() {
  return {
    nowUtc: '2026-08-04T10:30:00.000Z',
    preflight: {
      schema: 'stephanos.openclaw-update-preflight.v1',
      status: 'APPROVAL_REQUIRED',
      blockers: [],
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: SOURCE_HEAD,
      currentOpenClaw: {
        version: '1.2.3',
        gatewayEndpoint: 'http://127.0.0.1:18789',
      },
      updatePacket: {
        packetId: 'openclaw-1.2.4',
        packetSha256: PACKET_SHA,
        targetVersion: '1.2.4',
      },
      preservationManifest: {
        manifestSha256: MANIFEST,
        entries: [{
          pathFingerprintSha256: '1'.repeat(64),
          classification: 'PRESERVE_CONFIG',
          exists: true,
          digestSha256: 'd'.repeat(64),
        }],
      },
      safety: { mutationAllowed: false, updateAttempted: false },
    },
  };
}

function sink() {
  let text = '';
  return {
    write(value) { text += String(value); },
    value() { return text; },
  };
}

test('CLI emits bounded planning truth without executing an update', async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await runOpenClawStagedUpdateCli({
    stdin: Readable.from([JSON.stringify(validInput())]),
    stdout,
    stderr,
  });
  assert.equal(code, 0);
  assert.equal(stderr.value(), '');
  const result = JSON.parse(stdout.value());
  assert.equal(result.status, 'APPROVAL_REQUIRED');
  assert.equal(result.safety.mutationAllowed, false);
  assert.equal(result.safety.battleBridgeAdapterRequired, true);
});

test('CLI returns a fail-closed code for blocked evidence', async () => {
  const stdout = sink();
  const stderr = sink();
  const code = await runOpenClawStagedUpdateCli({
    stdin: Readable.from([JSON.stringify({ nowUtc: '2026-08-04T10:30:00.000Z' })]),
    stdout,
    stderr,
  });
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout.value()).status, 'BLOCKED_WITH_RESTORE_PATH');
  assert.equal(stderr.value(), '');
});

test('CLI rejects malformed or non-object JSON', async () => {
  for (const raw of ['{', '[]', '']) {
    const stdout = sink();
    const stderr = sink();
    const code = await runOpenClawStagedUpdateCli({
      stdin: Readable.from([raw]),
      stdout,
      stderr,
    });
    assert.equal(code, 1);
    assert.equal(stdout.value(), '');
    assert.match(stderr.value(), /^OPENCLAW_STAGED_UPDATE_ERROR=/);
  }
});

test('CLI rejects input above the bounded stdin limit', async () => {
  const stdout = sink();
  const stderr = sink();
  const oversized = `{"padding":"${'x'.repeat(OPENCLAW_STAGED_UPDATE_MAX_INPUT_BYTES)}"}`;
  const code = await runOpenClawStagedUpdateCli({
    stdin: Readable.from([oversized]),
    stdout,
    stderr,
  });
  assert.equal(code, 1);
  assert.match(stderr.value(), /input exceeds/i);
});

test('direct-entrypoint detection supports POSIX and Windows path normalisation', () => {
  const posixUrl = pathToFileURL('/repo/scripts/openclaw-staged-update.mjs').href;
  assert.equal(isDirectCliEntrypoint({
    metaUrl: posixUrl,
    argv1: 'scripts/openclaw-staged-update.mjs',
    cwd: '/repo',
    platform: 'linux',
  }), true);

  const windowsUrl = pathToFileURL('/C:/repo/scripts/openclaw-staged-update.mjs').href;
  assert.equal(isDirectCliEntrypoint({
    metaUrl: windowsUrl,
    argv1: 'scripts\\openclaw-staged-update.mjs',
    cwd: 'C:\\repo',
    platform: 'win32',
  }), true);
});
