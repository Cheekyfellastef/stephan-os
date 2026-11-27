import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPatchCourierDiffCommand,
  buildPatchCourierPacket,
  parsePatchCourierPacket,
} from './patchCourierPacket.mjs';

test('buildPatchCourierPacket wraps a diff in the Patch Courier #1290 base64 envelope', () => {
  const diff = 'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs\n+export const ok = true;\n';
  const packet = buildPatchCourierPacket({ diff });

  assert.equal(packet.version, 'v1');
  assert.equal(packet.issue, '1290');
  assert.equal(packet.beginMarker, 'BEGIN_DIFF_1290_PATCH_COURIER_BASE64');
  assert.equal(packet.endMarker, 'END_DIFF_1290_PATCH_COURIER_BASE64');
  assert.equal(packet.empty, false);
  assert.match(packet.payloadBase64, /^[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(packet.packetText.split('\n'), [packet.beginMarker, packet.payloadBase64, packet.endMarker]);
});

test('parsePatchCourierPacket decodes the base64 payload without changing diff bytes', () => {
  const diff = 'diff --git a/a b/a\nindex 0000000..1111111 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n';
  const packet = buildPatchCourierPacket({ diff });
  const parsed = parsePatchCourierPacket(packet.packetText);

  assert.equal(parsed.version, 'v1');
  assert.equal(parsed.beginMarker, packet.beginMarker);
  assert.equal(parsed.endMarker, packet.endMarker);
  assert.equal(parsed.payloadBase64, packet.payloadBase64);
  assert.equal(parsed.diff, diff);
  assert.equal(parsed.empty, false);
});

test('parsePatchCourierPacket rejects malformed envelopes and non-base64 payloads', () => {
  assert.throws(
    () => parsePatchCourierPacket('BEGIN_DIFF_1290_PATCH_COURIER_BASE64\nnot base64!\nEND_DIFF_1290_PATCH_COURIER_BASE64'),
    /base64/,
  );
  assert.throws(
    () => parsePatchCourierPacket('BEGIN_DIFF_1290_PATCH_COURIER_BASE64\nabc'),
    /exactly/,
  );
});

test('buildPatchCourierDiffCommand renders the requested binary diff export command', () => {
  assert.equal(
    buildPatchCourierDiffCommand([
      'shared/agents/patchCourierPacket.mjs',
      'shared/agents/patchCourierPacket.test.mjs',
    ]),
    'git diff --binary -- shared/agents/patchCourierPacket.mjs shared/agents/patchCourierPacket.test.mjs | base64 -w 0',
  );
});

test('parsePatchCourierPacket rejects truncated, overpadded and noncanonical base64', () => {
  for (const payload of ['A', 'AA', 'AAA', 'Zg', 'Zg=', 'Zg===', 'AA=A', '====', 'AB==', 'AAB=', '_w==', '-w==', 'Z g==', 'Zg==junk']) {
    const envelope = `BEGIN_DIFF_1290_PATCH_COURIER_BASE64\n${payload}\nEND_DIFF_1290_PATCH_COURIER_BASE64`;
    assert.throws(() => parsePatchCourierPacket(envelope), /canonical base64/, payload);
  }
});

test('parsePatchCourierPacket preserves canonical padded, unpadded and empty payloads', () => {
  for (const diff of ['', 'f', 'fo', 'foo', 'four', 'diff --git a/雪.txt b/雪.txt\n+🚀\n']) {
    const packet = buildPatchCourierPacket({ diff });
    const parsed = parsePatchCourierPacket(packet.packetText);
    assert.equal(parsed.diff, diff);
    assert.equal(parsed.empty, diff.length === 0);
    assert.equal(parsed.payloadBase64, packet.payloadBase64);
  }
});

test('buildPatchCourierDiffCommand keeps POSIX path arguments literal', { skip: process.platform === 'win32' }, () => {
  const paths = [
    'a b.txt',
    "quote'file.txt",
    ' leading and trailing ',
    '$(printf substituted)',
    '`printf substituted`',
    'semi;printf injected',
    'pipe|printf injected',
    'amp&printf injected',
    'redirection>sentinel',
    'back\\slash.txt',
    'line\nbreak.txt',
    '*.txt',
    '雪.txt',
  ];
  const command = buildPatchCourierDiffCommand(paths);
  const cwd = mkdtempSync(join(tmpdir(), 'patch-courier-argv-'));
  try {
    // Stub both commands: exercise POSIX parsing without reading a repository,
    // exporting a diff or running any real git command.
    const script = String.raw`git() { printf '%s\0' "$@"; }
base64() { cat; }
` + command;
    const result = spawnSync('sh', ['-c', script], { cwd, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stdout.split('\0').slice(0, -1), ['diff', '--binary', '--', ...paths]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('buildPatchCourierDiffCommand rejects NUL and preserves the no-path export', () => {
  assert.throws(() => buildPatchCourierDiffCommand(['safe.txt\0;printf injected']), /NUL/);
  assert.equal(buildPatchCourierDiffCommand([]), 'git diff --binary | base64 -w 0');
});
