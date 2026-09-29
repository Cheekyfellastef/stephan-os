import test from 'node:test';
import assert from 'node:assert/strict';

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
