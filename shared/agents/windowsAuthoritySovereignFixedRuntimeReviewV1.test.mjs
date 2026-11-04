import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1,
  analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1,
} from './windowsAuthoritySovereignFixedRuntimeReviewV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = '2f56252825d5bbc9aa0a684808fd141eff74c84c';
const BRANCH = 'fix/2961-fixed-runtime-closure-relay-proof-20261031';

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 3362,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    analysis: {
      findings: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.map(path => ({
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path,
      })),
      counts: { P0: 2, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      sourceCommitSha: HEAD,
      baseSha: BASE,
      liveMainBeforeSha: BASE,
      liveMainAfterSha: BASE,
      parents: [BASE],
      comparison: {
        status: 'ahead',
        aheadBy: 14,
        behindBy: 0,
        baseCommitSha: BASE,
        mergeBaseCommitSha: BASE,
      },
    },
    sources: [],
    ...overrides,
  };
}

test('exact #3362 two-P0 escalation is eligible but cannot self-certify without exact source evidence', () => {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
  assert.equal(result.findings.filter(item => item.code === 'fixed-runtime-specialist-exact-source-not-pinned').length, 2);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('wrong PR branch base or escalation estate cannot enter the specialist', () => {
  for (const overrides of [
    { prNumber: 3363 },
    { branch: 'other' },
    { baseSha: 'b'.repeat(40) },
    { analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface',
      path: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1[0] }], counts: { P0: 1, P1: 0, P2: 0 } } },
  ]) {
    assert.equal(analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input(overrides)).eligible, false);
  }
});

test('source estate widening cannot be reviewed favorably', () => {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input({
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path: 'scripts/windows/unrelated.ps1',
      ref: HEAD,
      exists: true,
      size: 1,
      blobSha: 'b'.repeat(40),
      content: 'x',
    }],
  }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(item => item.code === 'fixed-runtime-specialist-source-estate-widened'));
});

test('review profile pins only the two future #3362 Windows blobs and exact safety literals', async () => {
  assert.deepEqual(Object.keys(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1).sort(),
    [...WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1].sort());
  assert.equal(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[
    'scripts/windows/install-sovereign-fixed-runtime-v1.ps1'
  ], '8883b76eb04a4857e5627391d612dd09a02a8a97');
  assert.equal(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[
    'scripts/windows/SovereignFixedRuntimeIdentityV1.cs'
  ], '6c5f32afbba17c21d72aff7f983622862409c73b');

  const source = await readFile(new URL('./windowsAuthoritySovereignFixedRuntimeReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /Records\.Count -lt 40 -or \$bootstrap\.Records\.Count -gt 258/);
  assert.match(source, /manifest\.Files==null \|\| manifest\.Files\.Length<40 \|\| manifest\.Files\.Length>258/);
  assert.match(source, /compiled<installed && installed<boot && boot<now/);
  assert.match(source, /FIXED_INSTALL_ADMINISTRATOR_REQUIRED/);
  assert.match(source, /FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED/);
  assert.match(source, /RUNTIME_PENDING_LATER_BOOT_UNPROVEN/);
  assert.match(source, /RUNTIME_SOURCE_REF_CHANGED/);
  assert.match(source, /sourceMutationAllowed: false/);
  assert.match(source, /mergeAuthority: false/);
  assert.match(source, /runtimeMutationAllowed: false/);
});
