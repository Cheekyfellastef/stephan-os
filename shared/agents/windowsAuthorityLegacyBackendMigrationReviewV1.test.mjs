import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1,
  analyzeWindowsAuthorityLegacyBackendMigrationReviewV1,
} from './windowsAuthorityLegacyBackendMigrationReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1[0];
const SOURCE = readFileSync(new URL('../../scripts/windows/migrate-legacy-stephanos-backend-listener-v1.ps1', import.meta.url), 'utf8');

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function sourceRecord(content = SOURCE) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function review(content = SOURCE, overrides = {}) {
  return analyzeWindowsAuthorityLegacyBackendMigrationReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
    },
    sources: [sourceRecord(content)],
    ...overrides,
  });
}

test('accepts only the fixed exact-owned legacy backend migration contract', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.match(result.proofRefs[0], /windows-authority-legacy-backend-migration/);
});

test('rejects widened process termination or removal of stable identity gates', () => {
  const arbitraryPid = SOURCE.replace(
    'Stop-Process -Id $listenerAfter.ProcessId -Force -ErrorAction Stop',
    'Stop-Process -Id 1234 -Force -ErrorAction Stop',
  );
  assert.ok(review(arbitraryPid).findings.some((item) => item.code === 'legacy-backend-verified-stop-not-exact'));

  const noStablePid = SOURCE.replace(
    '$listenerAfter.ProcessId -ne $listenerBefore.ProcessId',
    '$false',
  );
  assert.ok(review(noStablePid).findings.some((item) => item.code === 'legacy-backend-stable-pid-gate-missing'));

  const noAncestor = SOURCE.replace(
    'merge-base --is-ancestor $health.SourceHead $ExpectedHead',
    'rev-parse $ExpectedHead',
  );
  assert.ok(review(noAncestor).findings.some((item) => item.code === 'legacy-backend-ancestry-gate-missing'));
});

test('rejects dynamic execution, task mutation and additional process termination', () => {
  for (const [suffix, code] of [
    ['\nStart-Process calc.exe\n', 'legacy-backend-dynamic-execution-forbidden'],
    ["\nStart-ScheduledTask -TaskName 'Anything'\n", 'legacy-backend-task-mutation-forbidden'],
    ['\nStop-Process -Id 7 -Force\n', 'legacy-backend-stop-process-count-invalid'],
  ]) {
    assert.ok(review(`${SOURCE}${suffix}`).findings.some((item) => item.code === code), code);
  }
});

test('fails closed on widened source evidence or a different high-risk path', () => {
  const widened = review(SOURCE, { sources: [sourceRecord(), { ...sourceRecord(), path: 'scripts/windows/other.ps1' }] });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));

  const wrongPath = analyzeWindowsAuthorityLegacyBackendMigrationReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] },
    sources: [sourceRecord()],
  });
  assert.equal(wrongPath.eligible, false);
});
