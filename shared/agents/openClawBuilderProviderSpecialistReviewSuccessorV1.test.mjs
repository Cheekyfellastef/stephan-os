import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const PATH = 'scripts/windows/restart-approved-stephanos-runtime.ps1';
const MULTIPLEXER_BRANCH = 'codex/1585-chatgpt-monitor-admission-bridge-v1';
const MULTIPLEXER_PATHS = [
  'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
  'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
];

function analysis() {
  return {
    findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
  };
}

function multiplexerAnalysis(overrides = {}) {
  return {
    findings: MULTIPLEXER_PATHS.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
    counts: { P0: 3, P1: 0, P2: 0 },
    ...overrides,
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

test('PR #1639 specialist is closed-world over exactly the three multiplexer Windows authority paths', () => {
  assert.deepEqual(MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1, MULTIPLEXER_PATHS);
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1639,
    branch: MULTIPLEXER_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: multiplexerAnalysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, MULTIPLEXER_PATHS);
  assert.equal(result.findings.some((item) => item.code === 'multiplexer-pr1639-source-inventory-invalid'), true);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('PR #1639 specialist rejects wrong identity, widened finding estate, stale main, and unpinned source', () => {
  const baseInput = {
    repository: REPOSITORY,
    prNumber: 1639,
    branch: MULTIPLEXER_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: multiplexerAnalysis(),
    sources: [],
  };

  for (const input of [
    { prNumber: 1640 },
    { branch: 'fix/other' },
    { analysis: multiplexerAnalysis({ findings: [...multiplexerAnalysis().findings, { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }], counts: { P0: 4, P1: 0, P2: 0 } }) },
    { analysis: multiplexerAnalysis({ counts: { P0: 3, P1: 1, P2: 0 } }) },
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({ ...baseInput, ...input });
    assert.equal(result.eligible, false);
    assert.equal(result.clean, false);
  }

  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    ...baseInput,
    lineageEvidence: lineage({ liveMainAfterSha: '3333333333333333333333333333333333333333' }),
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'multiplexer-pr1639-reconciliation-lineage-invalid');

  const forgedSources = MULTIPLEXER_PATHS.map((path) => ({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: 4,
    blobSha: '4'.repeat(40),
    content: 'safe',
  }));
  const forged = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({ ...baseInput, sources: forgedSources });
  assert.equal(forged.eligible, true);
  assert.equal(forged.clean, false);
  assert.equal(forged.findings.filter((item) => item.code === 'multiplexer-pr1639-exact-source-proof-invalid').length, 3);
});
