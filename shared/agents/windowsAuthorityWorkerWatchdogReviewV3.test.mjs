import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3,
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3,
  analyzeWindowsAuthorityWorkerWatchdogReviewV3,
  validateWorkerWatchdogReconciliationLineageV3,
} from './windowsAuthorityWorkerWatchdogReviewV3.mjs';

const baseSha = 'b'.repeat(40);
const sourceHead = 'c'.repeat(40);
const path = 'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1';
const analysis = {
  findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }],
};
const lineageEvidence = {
  schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
  repository: 'Cheekyfellastef/stephan-os',
  sourceHead,
  sourceCommitSha: sourceHead,
  baseSha,
  liveMainBeforeSha: baseSha,
  liveMainAfterSha: baseSha,
  parents: [WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3, baseSha],
  comparison: {
    status: 'ahead',
    aheadBy: 1,
    behindBy: 0,
    baseCommitSha: baseSha,
    mergeBaseCommitSha: baseSha,
  },
};
const baseInput = {
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1732,
  branch: 'agent/watchdog-control-plane-bootstrap-recovery-v1',
  sourceHead,
  baseSha,
  analysis,
  lineageEvidence,
  sources: [],
};

test('PR #1732 V3 profile requests only the exact escalated watchdog probe', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV3(baseInput);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3);
  assert.deepEqual(result.reviewedPaths, [path]);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_SOURCE_REQUIRED');
});

test('PR #1732 V3 profile binds one-step preservation lineage to the reviewed repair anchor', () => {
  assert.equal(validateWorkerWatchdogReconciliationLineageV3(baseInput), true);
  assert.equal(validateWorkerWatchdogReconciliationLineageV3({
    ...baseInput,
    lineageEvidence: { ...lineageEvidence, parents: ['d'.repeat(40), baseSha] },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV3({
    ...baseInput,
    lineageEvidence: { ...lineageEvidence, comparison: { ...lineageEvidence.comparison, behindBy: 1 } },
  }), false);
  assert.equal(validateWorkerWatchdogReconciliationLineageV3({
    ...baseInput,
    sourceHead: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3,
    lineageEvidence: {
      ...lineageEvidence,
      sourceHead: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3,
      sourceCommitSha: WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3,
    },
  }), false);
});

test('PR #1732 V3 profile fails closed on widened escalation or identity', () => {
  const widened = analyzeWindowsAuthorityWorkerWatchdogReviewV3({
    ...baseInput,
    analysis: {
      findings: [
        ...analysis.findings,
        { severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/restart-approved-stephanos-runtime.ps1' },
      ],
    },
  });
  assert.equal(widened.eligible, true);
  assert.equal(widened.clean, false);
  assert.equal(widened.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED');

  const wrongPr = analyzeWindowsAuthorityWorkerWatchdogReviewV3({ ...baseInput, prNumber: 2045 });
  assert.equal(wrongPr.eligible, false);

  const wrongBranch = analyzeWindowsAuthorityWorkerWatchdogReviewV3({ ...baseInput, branch: 'other' });
  assert.equal(wrongBranch.eligible, false);
});

test('PR #1732 V3 profile fails closed when exact source evidence is widened', () => {
  const result = analyzeWindowsAuthorityWorkerWatchdogReviewV3({
    ...baseInput,
    sources: [{}, {}],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED');
  assert.equal(result.findings[0].code, 'windows-authority-v3-source-estate-mismatch');
});
