import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1,
  analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1,
} from './windowsAuthorityStephanosNativeCapacityPublisherReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1[0];
const FIXTURE_URL = new URL('./fixtures/stephanosNativeCapacityPublisherInstallerV1.fixture.txt', import.meta.url);
const FIXTURE = readFileSync(FIXTURE_URL, 'utf8');
const EXPECTED_BLOB = '1427a8d4bfc3690edbff5048c94ee1a04b57283c';

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function analysis(path = PATH) {
  return {
    counts: { P0: 1, P1: 0, P2: 0 },
    findings: [{
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      summary: 'Separate specialist review required.',
      path,
    }],
  };
}

function source(content = FIXTURE, overrides = {}) {
  const bytes = Buffer.byteLength(content, 'utf8');
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: SOURCE_HEAD,
    exists: true,
    size: bytes,
    blobSha: gitBlobSha(content),
    content,
    ...overrides,
  };
}

test('fixture is byte-identical to the exact #2257 installer blob reviewed by this specialist', () => {
  assert.equal(gitBlobSha(FIXTURE), EXPECTED_BLOB);
});

test('exact pinned installer is eligible and clean with zero mutation authority', () => {
  const result = analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: [source()],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_CLEAN');
});

test('any implementation-byte drift fails closed before semantic clearance', () => {
  const tampered = `${FIXTURE}\n# authority widening attempt\nStart-Process cmd.exe\n`;
  const result = analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: [source(tampered)],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0]?.code, 'windows-authority-source-evidence-invalid');
});

test('wrong source blob metadata fails closed even when content is unchanged', () => {
  const result = analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: [source(FIXTURE, { blobSha: 'b'.repeat(40) })],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0]?.code, 'windows-authority-source-evidence-invalid');
});

test('unrelated high-risk escalation cannot enter this specialist', () => {
  const result = analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis('scripts/windows/something-else.ps1'),
    sources: [source()],
  });

  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, []);
});

test('widened or duplicate source inventory fails closed', () => {
  const exact = source();
  const result = analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: [exact, { ...exact }],
  });

  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings[0]?.code, 'windows-authority-source-evidence-invalid');
});
