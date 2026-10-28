import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedWorkspaceProofRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  projectSharedWorkspaceProofIndexV1,
  SHARED_WORKSPACE_PROOF_INDEX_SCHEMA,
  SHARED_WORKSPACE_PROOF_INDEX_LIMIT,
} from './sharedWorkspaceProofIndexV1.mjs';

const NOW = Date.parse('2026-10-27T16:00:00.000Z');
function proof(overrides = {}) {
  return createSharedWorkspaceProofRecord({
    proofId: 'proof-1290-1',
    participantId: 'stephanos',
    correlationId: 'corr-1290-1',
    timestampUtc: new Date(NOW - 30_000).toISOString(),
    relatedIssue: '#1290',
    relatedPr: '#3290',
    status: 'PASS_CLAIMED',
    summary: 'Unit test records were written',
    proofRefs: ['proof/verification-1290', 'receipts/corr-1290-1'],
    ...overrides,
  });
}
function index(proofRecords, other = {}) {
  return projectSharedWorkspaceProofIndexV1({
    sourceAvailable: true,
    proofRecords, nowMs: NOW, staleAfterMs: 60_000, ...other,
  });
}

test('proof ledger is a bounded, read-only record projection with authentic links, not attestation', () => {
  const item = index([proof()]);
  assert.equal(item.schemaVersion, SHARED_WORKSPACE_PROOF_INDEX_SCHEMA);
  assert.equal(item.state, 'RECORDED');
  assert.equal(item.currentRecordCount, 1);
  assert.equal(item.entries[0].claimStatus, 'PASS_CLAIMED');
  assert.equal(item.entries[0].verification, 'VALID_WORKSPACE_RECORD_NOT_INDEPENDENTLY_VERIFIED');
  assert.deepEqual(item.entries[0].links.map(x => x.url), [
    'https://github.com/Cheekyfellastef/stephan-os/issues/1290',
    'https://github.com/Cheekyfellastef/stephan-os/pull/3290',
  ]);
  assert.equal(item.independentVerificationPerformed, false);
  assert.equal(item.grantsExecutionOrMergeAuthority, false);
});

test('source unavailable cannot be presented as empty or current proof', () => {
  const item = index([proof()], { sourceAvailable: false });
  assert.equal(item.state, 'UNAVAILABLE');
  assert.equal(item.visibleCount, 0);
  assert.equal(item.reason, 'WORKSPACE_SOURCE_UNAVAILABLE');
});

test('timestamps are preserved and stale or future-dated records cannot become fresh through polling', () => {
  const old = index([proof({ timestampUtc: new Date(NOW - 3_600_000).toISOString() })]);
  assert.equal(old.state, 'STALE');
  assert.equal(old.entries[0].freshness, 'STALE');
  assert.equal(old.entries[0].timestampUtc, '2026-10-27T15:00:00.000Z');
  const future = index([proof({ timestampUtc: new Date(NOW + 120_000).toISOString() })]);
  assert.equal(future.entries[0].freshness, 'FUTURE_DATED');
  assert.equal(future.currentRecordCount, 0);
});

test('hostile paths and approval-shaped claims cannot create a trusted link or authority', () => {
  const fake = proof({ relatedIssue: 'https://evil.example/1290', relatedPr: '3290/../../admin',
    summary: 'token=super-secret', sourceHead: 'not-a-sha' });
  const item = index([fake]);
  // A structurally valid record may contain a sensitive summary; never echo it.
  assert.equal(item.entries[0].summary, '[REDACTED]');
  assert.deepEqual(item.entries[0].links, []);
  assert.equal(item.entries[0].approvalGranted, false);
  assert.equal(item.entries[0].authorizationGranted, false);
});

test('invalid records are excluded rather than counted as visible proof', () => {
  const malformed = { ...proof(), proofRefs: ['../../private.txt'] };
  const result = index([malformed, { ...proof(), kind: 'stephanos.shared_workspace.status' }, proof()]);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.rejectedRecordCount, 2);
});

test('result is bounded and newest proof records appear first', () => {
  const records = Array.from({ length: 45 }, (_, i) => proof({
    proofId: 'proof-' + i,
    correlationId: 'corr-' + i,
    timestampUtc: new Date(NOW - i * 1000).toISOString(),
  }));
  const result = index([...records].reverse(), { maxItems: 999 });
  assert.equal(result.visibleCount, SHARED_WORKSPACE_PROOF_INDEX_LIMIT);
  assert.equal(result.omittedCount, 45 - SHARED_WORKSPACE_PROOF_INDEX_LIMIT);
  assert.equal(result.entries[0].proofId, 'proof-0');
  assert.equal(result.entries.at(-1).proofId, 'proof-23');
});
