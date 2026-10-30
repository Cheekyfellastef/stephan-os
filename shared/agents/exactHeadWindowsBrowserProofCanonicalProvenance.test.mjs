import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dispatchSourceUrl = new URL('./exactHeadWindowsBrowserProofDispatch.mjs', import.meta.url);

test('native browser proof fails closed unless fingerprints come from a clean approved checkout', async () => {
  const source = await readFile(dispatchSourceUrl, 'utf8');
  const nativeStart = source.indexOf('export function runNativeExactHeadWindowsBrowserProof');
  assert.notEqual(nativeStart, -1, 'native exact-head proof entrypoint must exist');

  const fingerprintStart = source.indexOf('const expectedSourceFingerprint', nativeStart);
  assert.notEqual(fingerprintStart, -1, 'native proof must compute canonical fingerprints');

  const preFingerprintBoundary = source.slice(nativeStart, fingerprintStart);
  assert.match(
    preFingerprintBoundary,
    /status[\s\S]{0,160}(?:--porcelain|--short)|diff[\s\S]{0,160}--quiet/,
    'native proof must prove the checkout is clean before deriving source/dist fingerprints',
  );
  assert.match(
    preFingerprintBoundary,
    /expectedHead/,
    'clean-check provenance must remain bound to the approved exact head',
  );
});
