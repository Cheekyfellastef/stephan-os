import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const PATH = 'scripts/windows/restart-approved-stephanos-runtime.ps1';

function analysis() {
  return {
    findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
  };
}

function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead: HEAD,
    sourceCommitSha: HEAD,
    baseSha: BASE,
    liveMainBeforeSha: BASE,
    liveMainAfterSha: BASE,
    parents: [BASE],
    comparison: {
      status: 'ahead',
      aheadBy: 1,
      behindBy: 0,
      baseCommitSha: BASE,
      mergeBaseCommitSha: BASE,
    },
    ...overrides,
  };
}

test('successor specialist owns only the exact #2048 authority-bearing path', () => {
  assert.deepEqual(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1, [PATH]);
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.findings[0].code, 'battle-bridge-hardlink-exact-source-proof-invalid');
});

test('successor specialist refuses a different PR, branch, finding estate, or lineage', () => {
  for (const input of [
    { prNumber: 2049 },
    { branch: 'fix/other' },
    { analysis: { findings: [] } },
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
      repository: REPOSITORY,
      prNumber: 2048,
      branch: BRANCH,
      sourceHead: HEAD,
      baseSha: BASE,
      lineageEvidence: lineage(),
      analysis: analysis(),
      sources: [],
      ...input,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.clean, false);
  }

  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage({ liveMainAfterSha: '3333333333333333333333333333333333333333' }),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'battle-bridge-hardlink-reconciliation-lineage-invalid');
});
