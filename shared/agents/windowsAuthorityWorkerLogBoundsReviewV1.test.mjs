import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1,
  analyzeWindowsAuthorityWorkerLogBoundsReviewV1,
} from './windowsAuthorityWorkerLogBoundsReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 2029;
const BRANCH = 'codex/mission-worker-log-bounds-current-main-v1';
const SOURCE_PARENT = '21f7c9475faa24ea5f1b666d5f17bbf73fb063f4';
const SOURCE_HEAD = 'fa060c23329c3a589b30f1eb8e2d58e7ebf0af6a';
const BASE_SHA = '7d39556dc877fb1d8eb1ef289a82ceb8c26b779b';
const PATH = WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1[0];
const CLEAN = gunzipSync(Buffer.from(
  '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',
  'base64',
)).toString('utf8');

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function lineage(overrides = {}) {
  return {
    baseSha: BASE_SHA,
    comparison: {
      aheadBy: 6,
      baseCommitSha: BASE_SHA,
      behindBy: 0,
      mergeBaseCommitSha: BASE_SHA,
      status: 'ahead',
    },
    liveMainAfterSha: BASE_SHA,
    liveMainBeforeSha: BASE_SHA,
    parents: [SOURCE_PARENT, BASE_SHA],
    repository: REPOSITORY,
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    sourceCommitSha: SOURCE_HEAD,
    sourceHead: SOURCE_HEAD,
    ...overrides,
  };
}

function sourceRecord(content = CLEAN, overrides = {}) {
  return {
    blobSha: blobSha(content),
    content,
    exists: true,
    path: PATH,
    ref: SOURCE_HEAD,
    repository: REPOSITORY,
    schemaVersion: 'stephanos.windows-authority-source.v1',
    size: Buffer.byteLength(content, 'utf8'),
    ...overrides,
  };
}

function escalationFinding(path = PATH) {
  return {
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    summary: 'Qualified Windows authority specialist review is required.',
    path,
  };
}

function reviewInput(overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    branch: BRANCH,
    sourceHead: SOURCE_HEAD,
    baseSha: BASE_SHA,
    lineageEvidence: lineage(),
    analysis: {
      findings: [escalationFinding()],
    },
    sources: [sourceRecord()],
    ...overrides,
  };
}

function review(overrides = {}) {
  return analyzeWindowsAuthorityWorkerLogBoundsReviewV1(reviewInput(overrides));
}

test('owns only the exact PR 2029 launcher delta and accepts its reviewed immutable blob', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1, [PATH]);
  assert.equal(Buffer.byteLength(CLEAN, 'utf8'), 10873);
  assert.equal(blobSha(CLEAN), '5b3375d3cfffa186a1d375e5f5cdbf5513054cab');
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.match(result.proofRefs[0], /windows-authority-worker-log-bounds/);
});

test('wrong PR, branch, repository, escalation path, or multiple findings are not eligible', () => {
  assert.equal(review({ prNumber: 2030 }).eligible, false);
  assert.equal(review({ branch: 'codex/other' }).eligible, false);
  assert.equal(review({ repository: 'other/repo' }).eligible, false);
  assert.equal(review({ analysis: { findings: [escalationFinding('scripts/windows/other.ps1')] } }).eligible, false);
  assert.equal(review({ analysis: { findings: [
    escalationFinding(),
    escalationFinding('scripts/windows/other.ps1'),
  ] } }).eligible, false);
});

test('lineage must be the exact history-preserving current-main merge descendant', () => {
  assert.equal(review({ lineageEvidence: lineage({ parents: ['a'.repeat(40), BASE_SHA] }) }).eligible, false);
  assert.equal(review({ lineageEvidence: lineage({ parents: [SOURCE_PARENT, 'b'.repeat(40)] }) }).eligible, false);
  assert.equal(review({ lineageEvidence: lineage({ liveMainAfterSha: 'c'.repeat(40) }) }).eligible, false);
  assert.equal(review({ lineageEvidence: lineage({ comparison: { ...lineage().comparison, behindBy: 1 } }) }).eligible, false);
});

test('source evidence is exact, plain-data, single-file, blob-bound, and head-bound', () => {
  for (const sources of [
    [],
    [sourceRecord(), sourceRecord()],
    [sourceRecord(CLEAN.replace('$maximumLogBytes = 64MB', '$maximumLogBytes = 1TB'))],
    [sourceRecord(CLEAN, { ref: 'a'.repeat(40) })],
    [sourceRecord(CLEAN, { path: 'scripts/windows/other.ps1' })],
    [sourceRecord(CLEAN, { blobSha: 'b'.repeat(40) })],
  ]) {
    const result = review({ sources });
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'windows-authority-worker-log-source-evidence-invalid'));
  }

  const accessor = sourceRecord();
  Object.defineProperty(accessor, 'content', { enumerable: true, get() { throw new Error('must not run'); } });
  const accessorResult = review({ sources: [accessor] });
  assert.equal(accessorResult.clean, false);
  assert.ok(accessorResult.findings.some((item) => item.code === 'windows-authority-worker-log-source-evidence-invalid'));
});

test('accessor-shaped top-level, analysis, finding, lineage, and source containers fail closed', () => {
  const topLevel = reviewInput();
  Object.defineProperty(topLevel, 'sourceHead', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(analyzeWindowsAuthorityWorkerLogBoundsReviewV1(topLevel).eligible, false);

  const analysisInput = reviewInput();
  Object.defineProperty(analysisInput.analysis, 'findings', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(analyzeWindowsAuthorityWorkerLogBoundsReviewV1(analysisInput).eligible, false);

  const findingInput = reviewInput();
  Object.defineProperty(findingInput.analysis.findings[0], 'path', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(analyzeWindowsAuthorityWorkerLogBoundsReviewV1(findingInput).eligible, false);

  const lineageInput = reviewInput();
  Object.defineProperty(lineageInput.lineageEvidence, 'parents', { enumerable: true, get() { throw new Error('must not run'); } });
  assert.equal(analyzeWindowsAuthorityWorkerLogBoundsReviewV1(lineageInput).eligible, false);

  const sourcesInput = reviewInput();
  Object.defineProperty(sourcesInput.sources, '0', { enumerable: true, get() { throw new Error('must not run'); } });
  const sourcesResult = analyzeWindowsAuthorityWorkerLogBoundsReviewV1(sourcesInput);
  assert.equal(sourcesResult.eligible, true);
  assert.equal(sourcesResult.clean, false);
  assert.ok(sourcesResult.findings.some((item) => item.code === 'windows-authority-worker-log-source-evidence-invalid'));
});

test('specialist source keeps the bounded log and closed-authority invariants explicit', async () => {
  const source = await readFile(new URL('./windowsAuthorityWorkerLogBoundsReviewV1.mjs', import.meta.url), 'utf8');
  for (const expected of [
    'worker-log-current-bound-missing',
    'worker-log-archive-bound-missing',
    'worker-log-path-containment-missing',
    'worker-log-reparse-guards-incomplete',
    'worker-log-atomic-replace-missing',
    'worker-log-append-not-double-bounded',
    'worker-log-dynamic-execution-forbidden',
    'worker-log-host-mutation-forbidden',
    'worker-log-network-authority-forbidden',
  ]) assert.match(source, new RegExp(expected));
});

test('canonical Windows specialist routes exact PR 2029 evidence through the narrower successor first', () => {
  const input = {
    repository: REPOSITORY,
    prNumber: PR_NUMBER,
    branch: BRANCH,
    sourceHead: SOURCE_HEAD,
    baseSha: BASE_SHA,
    lineageEvidence: lineage(),
    analysis: {
      findings: [escalationFinding()],
    },
    sources: [sourceRecord()],
  };
  const result = analyzeWindowsAuthoritySpecialistReview(input);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_SPECIALIST_CLEAN');
});
