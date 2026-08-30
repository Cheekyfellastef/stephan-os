import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1,
  analyzeWindowsAuthorityBattleBridgeTaskProofCountReviewV1,
} from './windowsAuthorityBattleBridgeTaskProofCountReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const RESCUE_PATH = WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1[0];
const TEST_PATH = WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1[1];
const OLD_GUARD = 'if (($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)';
const NEW_GUARD = 'if (@($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)';

const rescueMain = readFileSync(new URL('../../scripts/windows/repair-battle-bridge-control-plane-now.ps1', import.meta.url), 'utf8');
const regressionMain = readFileSync(new URL('../../scripts/windows/repair-battle-bridge-control-plane-now.test.mjs', import.meta.url), 'utf8');
const rescueFixed = rescueMain.replace(OLD_GUARD, NEW_GUARD);
const regressionFixed = `${regressionMain}
test('task proof counting is collection-safe under Windows PowerShell strict mode', () => {
  assert.ok(ps1.includes('if (@($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)'));
  assert.ok(!ps1.includes('if (($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)'));
});
`;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function analysis(extra = []) {
  return {
    findings: [
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: RESCUE_PATH },
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: TEST_PATH },
      ...extra,
    ],
  };
}

function review(overrides = {}) {
  return analyzeWindowsAuthorityBattleBridgeTaskProofCountReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [
      source(RESCUE_PATH, rescueFixed),
      source(TEST_PATH, regressionFixed),
    ],
    ...overrides,
  });
}

test('plans exactly the existing rescue source and regression for the two generic Windows findings', () => {
  const result = analyzeWindowsAuthorityBattleBridgeTaskProofCountReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.deepEqual(
    [...result.reviewedPaths].sort(),
    [...WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1].sort(),
  );
});

test('accepts the collection-safe strict-mode guard while retaining every existing no-faff invariant', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.findings, []);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_SPECIALIST_CLEAN');
  assert.ok(result.proofRefs.some((ref) => ref.includes('task-proof-count')));
});

test('rejects the scalar-unsafe guard and missing hostile regression', () => {
  const scalarUnsafe = review({
    sources: [
      source(RESCUE_PATH, rescueMain),
      source(TEST_PATH, regressionFixed),
    ],
  });
  assert.equal(scalarUnsafe.clean, false);
  assert.ok(scalarUnsafe.findings.some((item) => item.code === 'task-proof-count-collection-guard-missing'));

  const missingRegression = review({
    sources: [
      source(RESCUE_PATH, rescueFixed),
      source(TEST_PATH, regressionMain),
    ],
  });
  assert.equal(missingRegression.clean, false);
  assert.ok(missingRegression.findings.some((item) => item.code === 'task-proof-count-regression-name-missing'));
});

test('does not absorb a broadened high-risk estate or invalid exact-head source evidence', () => {
  const broadened = analyzeWindowsAuthorityBattleBridgeTaskProofCountReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis([
      { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' },
    ]),
    sources: [],
  });
  assert.equal(broadened.eligible, false);

  const wrongHead = review({
    sources: [
      { ...source(RESCUE_PATH, rescueFixed), ref: 'b'.repeat(40) },
      source(TEST_PATH, regressionFixed),
    ],
  });
  assert.equal(wrongHead.clean, false);
  assert.ok(wrongHead.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});
