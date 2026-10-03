import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1,
  analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1,
} from './windowsAuthorityStarfieldVrAerObserveReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const path = WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0];

function blob(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function source(content, overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blob(content),
    content,
    ...overrides,
  };
}
function input(content, overrides = {}) {
  return {
    repository,
    sourceHead,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }],
      counts: { P0: 1, P1: 0, P2: 0 },
    },
    sources: [source(content)],
    ...overrides,
  };
}

test('current Starfield VR AER Observe launcher is specialist eligible and clean', async () => {
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
  const result = analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(content));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [path]);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_SPECIALIST_CLEAN');
});

test('reviewer rejects widened process authority and dynamic execution', async () => {
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
  const widened = `${content}\nStart-Process -FilePath $env:ComSpec\nInvoke-Expression $env:PAYLOAD\n`;
  const result = analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(widened));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-aer-process-estate-widened'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-aer-dynamic-execution-forbidden'));
});

test('reviewer rejects changed reviewed binary identity', async () => {
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
  const changed = content.replace(
    'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c',
    'a0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c',
  );
  const result = analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(changed));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-aer-stabilizer-hash-changed'));
});

test('reviewer requires exact immutable source evidence', async () => {
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
  const badSource = source(content, { blobSha: 'b'.repeat(40) });
  const result = analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(content, { sources: [badSource] }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('wrong path or widened finding estate is not eligible', async () => {
  const content = await readFile(new URL('../../scripts/windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');
  assert.equal(analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(content, {
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }],
      counts: { P0: 1, P1: 0, P2: 0 },
    },
  })).eligible, false);
  assert.equal(analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input(content, {
    analysis: {
      findings: [
        { severity: 'P0', code: 'unsupported-high-risk-surface', path },
        { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' },
      ],
      counts: { P0: 2, P1: 0, P2: 0 },
    },
  })).eligible, false);
});
