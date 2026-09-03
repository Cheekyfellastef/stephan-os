import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4,
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4,
  analyzeWindowsAuthorityWorkerWatchdogReviewV4,
  validateWorkerWatchdogReconciliationLineageV4,
} from './windowsAuthorityWorkerWatchdogReviewV4.mjs';

const baseSha = 'b'.repeat(40);
const sourceHead = 'c'.repeat(40);
const analysis = {
  findings: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    path,
  })),
};
const lineageEvidence = {
  schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
  repository: 'Cheekyfellastef/stephan-os',
  sourceHead,
  sourceCommitSha: sourceHead,
  baseSha,
  liveMainBeforeSha: baseSha,
  liveMainAfterSha: baseSha,
  parents: [WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4, baseSha],
  comparison: {
    status: 'ahead',
    aheadBy: 9,
    behindBy: 0,
    baseCommitSha: baseSha,
    mergeBaseCommitSha: baseSha,
  },
};
const baseInput = {
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2066,
  branch: 'agent/1818-watchdog-stale-worker-reclaim-v1',
  sourceHead,
  baseSha,
  analysis,
  lineageEvidence,
  sources: [],
};

test('PR #2066 V4 profile requests exactly the repaired two-file Windows source estate', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV4(baseInput);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_SOURCE_REQUIRED');
});

test('PR #2066 V4 profile accepts only one exact preservation merge of repaired head onto live main', () => {
  assert.equal(validateWorkerWatchdogReconciliationLineageV4(baseInput), true);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    sourceHead: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4,
    lineageEvidence: {
      ...lineageEvidence,
      sourceHead: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4,
      sourceCommitSha: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4,
    },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    lineageEvidence: {
      ...lineageEvidence,
      parents: ['d'.repeat(40), baseSha],
    },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    lineageEvidence: {
      ...lineageEvidence,
      parents: [WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4, 'd'.repeat(40)],
    },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    lineageEvidence: {
      ...lineageEvidence,
      parents: [baseSha, WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4],
    },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    lineageEvidence: {
      ...lineageEvidence,
      comparison: { ...lineageEvidence.comparison, behindBy: 1 },
    },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV4({
    ...baseInput,
    lineageEvidence: {
      ...lineageEvidence,
      liveMainAfterSha: 'e'.repeat(40),
    },
  }), false);
});

test('PR #2066 V4 profile fails closed on widened escalation and wrong identity', () => {
  const widened = analyzeWindowsAuthorityWorkerWatchdogReviewV4({
    ...baseInput,
    analysis: {
      findings: [
        ...analysis.findings,
        {
          severity: 'P0',
          code: 'unsupported-high-risk-surface',
          path: 'scripts/windows/start-mission-orchestrator-worker.ps1',
        },
      ],
    },
  });
  assert.equal(widened.eligible, true);
  assert.equal(widened.clean, false);
  assert.equal(widened.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED');

  assert.equal(analyzeWindowsAuthorityWorkerWatchdogReviewV4({
    ...baseInput,
    prNumber: 1732,
  }).eligible, false);
  assert.equal(analyzeWindowsAuthorityWorkerWatchdogReviewV4({
    ...baseInput,
    branch: 'other',
  }).eligible, false);
});

test('PR #2066 V4 profile fails closed when exact source evidence is widened or reordered', () => {
  const widened = analyzeWindowsAuthorityWorkerWatchdogReviewV4({
    ...baseInput,
    sources: [{ path: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[0] }, {
      path: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[1],
    }, {}],
  });
  assert.equal(widened.clean, false);
  assert.equal(widened.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED');

  const reordered = analyzeWindowsAuthorityWorkerWatchdogReviewV4({
    ...baseInput,
    sources: [
      { path: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[1] },
      { path: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[0] },
    ],
  });
  assert.equal(reordered.clean, false);
  assert.equal(reordered.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED');
});
