import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('./githubContinuityExternalHandoffV1.mjs', import.meta.url),
  'utf8',
);

test('external source completion cannot advance without canonical source artifact escrow', () => {
  assert.match(
    source,
    /sourceArtifactEscrow/,
    'external completion schema must carry the canonical source artifact escrow evidence',
  );
  assert.match(
    source,
    /gateSourceWorkerCompletionV1/,
    'external completion adjudication must reuse the canonical source worker completion gate',
  );
  assert.match(
    source,
    /SOURCE_ARTIFACT_ESCROW_(?:REQUIRED|IDENTITY_MISMATCH|PROVEN)/,
    'external completion must fail closed on missing or mismatched escrow rather than advance the mission',
  );
});

test('external completion escrow repair must remain on the existing continuity plane', () => {
  assert.match(source, /GITHUB_CONTINUITY_EXTERNAL_COMPLETION_SCHEMA/);
  assert.match(source, /AGENT_RESULT_RECEIVED/);
  assert.doesNotMatch(source, /mergeAuthorityAdded\s*:\s*true/);
  assert.doesNotMatch(source, /leaseSeizureAllowed\s*:\s*true/);
  assert.doesNotMatch(source, /duplicateDispatchAllowed\s*:\s*true/);
});
