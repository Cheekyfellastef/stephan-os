import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1,
  analyzeWindowsAuthorityVrResourceGovernorReviewV1,
} from './windowsAuthorityVrResourceGovernorReviewV1.mjs';

const PATH = WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1[0];
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const governor = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function input(content = governor, overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 2662,
    branch: 'fix/vr-zero-ollama-residency-v1',
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
      counts: { P0: 1, P1: 0, P2: 0 },
      verdict: 'findings',
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: REPOSITORY,
      path: PATH,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    }],
    ...overrides,
  };
}

test('current VR resource governor is eligible under the bounded authority specialist', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('specialist rejects widened arbitrary process authority', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor + "\nStart-Process -FilePath 'cmd.exe'\n"),
  );
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-process-mutation-widened'));
});

test('specialist rejects a widened Ollama command estate', () => {
  const widened = governor.replace(
    '& $OllamaExecutable stop $Model *> $null',
    '& $OllamaExecutable run $Model *> $null',
  );
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(widened));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-model-stop-command-not-fixed'));
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-ollama-command-estate-widened'));
});

test('specialist ignores unrelated high-risk surfaces', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, {
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }],
      counts: { P0: 1, P1: 0, P2: 0 },
      verdict: 'findings',
    },
  }));
  assert.equal(result.eligible, false);
});
