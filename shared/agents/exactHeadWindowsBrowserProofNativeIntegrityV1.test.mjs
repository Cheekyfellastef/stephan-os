import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./exactHeadWindowsBrowserProofDispatch.mjs', import.meta.url), 'utf8');
const mailboxSource = readFileSync(new URL('../../scripts/battle-bridge-github-command-mailbox.mjs', import.meta.url), 'utf8');

test('native exact-head browser proof remains bound to canonical bundle fingerprints', () => {
  const nativeStart = source.indexOf('export function runNativeExactHeadWindowsBrowserProof');
  const nativeEnd = source.indexOf('\nexport ', nativeStart + 1);
  assert.ok(nativeStart >= 0, 'native proof runner must exist');
  const nativeSource = source.slice(nativeStart, nativeEnd > nativeStart ? nativeEnd : source.length);

  assert.match(nativeSource, /--expected-source-fingerprint/);
  assert.match(nativeSource, /--expected-dist-fingerprint/);
  assert.match(nativeSource, /--expected-dist-manifest/);
});

test('completed native proof is retained by the canonical bounded receipt projection', () => {
  assert.match(source, /proofCompleted/);
  assert.match(source, /executionProvider/);
  assert.match(source, /nativeProof/);

  const projectionStart = mailboxSource.indexOf('createSanitizedMailboxReceiptProjection');
  assert.ok(projectionStart >= 0, 'canonical mailbox receipt projection must exist');
  const projectionSource = mailboxSource.slice(projectionStart, projectionStart + 16000);
  assert.match(projectionSource, /proofCompleted|proofReference|nativeProof/);
  assert.match(projectionSource, /executionProvider/);
});
