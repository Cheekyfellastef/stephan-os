import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1,
  analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1,
} from './windowsAuthoritySovereignFixedRuntimeReviewV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = '2f56252825d5bbc9aa0a684808fd141eff74c84c';
const BRANCH = 'fix/2961-fixed-runtime-closure-relay-proof-20261031';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

async function sourceRecords() {
  return Promise.all(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.map(async path => {
    const content = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
    return {
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: gitBlobSha(content),
      content,
    };
  }));
}

function input(sources, overrides = {}) {
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
    sources,
    ...overrides,
  };
}

test('exact #3362 fixed-runtime Windows pair is specialist eligible and clean', async () => {
  const sources = await sourceRecords();
  for (const source of sources) {
    assert.equal(source.blobSha, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[source.path]);
  }
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input(sources));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_CLEAN');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('wrong PR branch base or escalation estate cannot enter the specialist', async () => {
  const sources = await sourceRecords();
  for (const overrides of [
    { prNumber: 3363 },
    { branch: 'other' },
    { baseSha: 'b'.repeat(40) },
    { analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface',
      path: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1[0] }], counts: { P0: 1, P1: 0, P2: 0 } } },
  ]) {
    assert.equal(analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input(sources, overrides)).eligible, false);
  }
});

test('changed protected Windows bytes remain blocking even when the caller reports a matching blob field', async () => {
  const sources = await sourceRecords();
  const changed = { ...sources[0], content: sources[0].content + '\n# widened\n' };
  changed.size = Buffer.byteLength(changed.content, 'utf8');
  changed.blobSha = gitBlobSha(changed.content);
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input([changed, sources[1]]));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(item => item.code === 'fixed-runtime-specialist-exact-source-not-pinned'));
});

test('source estate widening or duplicate evidence cannot be reviewed favorably', async () => {
  const sources = await sourceRecords();
  const extra = { ...sources[0], path: 'scripts/windows/unrelated.ps1' };
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input([...sources, extra]));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(item => item.code === 'fixed-runtime-specialist-source-estate-widened'));
});

test('reviewed source contracts retain 258-member and later-boot gates', async () => {
  const sources = await sourceRecords();
  const installer = sources.find(row => row.path.endsWith('.ps1')).content;
  const identity = sources.find(row => row.path.endsWith('.cs')).content;
  assert.match(installer, /Records\.Count -gt 258/);
  assert.match(installer, /FIXED_INSTALL_ADMINISTRATOR_REQUIRED/);
  assert.match(installer, /FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED/);
  assert.match(installer, /PENDING only: true later full boot/);
  assert.match(identity, /manifest\.Files\.Length>258/);
  assert.match(identity, /compiled<installed && installed<boot && boot<now/);
  assert.match(identity, /RUNTIME_PENDING_LATER_BOOT_UNPROVEN/);
  assert.match(identity, /RUNTIME_SOURCE_REF_CHANGED/);
});
