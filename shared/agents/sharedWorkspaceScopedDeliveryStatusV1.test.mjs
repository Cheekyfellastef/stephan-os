import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildScopedDeliveryStatusProjection,
  loadScopedDeliveryStatusEvidence,
  validateDeliveryStatusSubject,
} from './sharedWorkspaceScopedDeliveryStatusV1.mjs';

const SUBJECT = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1668,
  mergeCommit: 'b83f7df46d9d52233f0b4f5dc2e034f50c0bae93',
  deploymentRequestId: 'req-1507-deploy-1668-20260806T1459Z',
  featureId: 'music-tile-auto-url-artwork',
});
const NOW = Date.parse('2026-08-06T16:00:00.000Z');

function record(overrides = {}) {
  return {
    schemaVersion: 'stephanos.runtime-proof.v1',
    recordId: 'record-' + Math.random().toString(16).slice(2),
    timestampUtc: '2026-08-06T15:50:00.000Z',
    repository: SUBJECT.repository,
    relatedPr: '#1668',
    mergeCommit: SUBJECT.mergeCommit,
    correlationId: SUBJECT.deploymentRequestId,
    featureId: SUBJECT.featureId,
    proofRefs: ['proof/music-tile-live.json'],
    ...overrides,
  };
}

function projection(records, options = {}) {
  return buildScopedDeliveryStatusProjection({
    subject: SUBJECT,
    records,
    timestampUtc: '2026-08-06T16:00:00.000Z',
    nowMs: NOW,
    ...options,
  });
}

test('subject identity is fixed, exact and rejects extra authority fields', () => {
  assert.equal(validateDeliveryStatusSubject(SUBJECT).ok, true);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, repository: 'other/repo' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, mergeCommit: 'short' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, command: 'dir' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentRequestId: 'bad request id' }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, deploymentRequestId: undefined }).ok, false);
  assert.equal(validateDeliveryStatusSubject({ ...SUBJECT, featureId: undefined }).ok, false);
});

test('unrelated newest global status cannot answer the scoped Music Tile question', () => {
  const result = projection([
    record({ relatedPr: '#1638', correlationId: 'programme-controller', status: 'STARTING', summary: 'Programme controller is STARTING.' }),
  ]);
  assert.equal(result.overallStatus, 'NO_MATCHING_RUNTIME_EVIDENCE');
  assert.equal(result.matchedRecordCount, 0);
  assert.equal(result.live, false);
});

test('scoped evidence requires exact repository, PR, merge, deployment and feature identity', () => {
  const mismatches = [
    record({ repository: 'Other/example' }),
    record({ relatedPr: '#1667' }),
    record({ mergeCommit: '1111111111111111111111111111111111111111' }),
    record({ correlationId: 'req-1507-other-deployment' }),
    record({ featureId: 'another-feature' }),
  ];

  for (const evidence of mismatches) {
    const result = projection([evidence]);
    assert.equal(result.overallStatus, 'NO_MATCHING_RUNTIME_EVIDENCE');
    assert.equal(result.matchedRecordCount, 0);
    assert.equal(result.live, false);
  }
});

test('records cannot splice matching identity dimensions across separate evidence', () => {
  const result = projection([
    record({ repository: 'Other/example', status: 'PASS', updatedMusicTileServed: true }),
    record({ relatedPr: '#1667', status: 'PASS', playbackContinuedAfterRating: true }),
    record({ featureId: 'another-feature', status: 'PASS', autoUrlAndArtworkRuntimeProof: true }),
    record({ correlationId: 'req-1507-other-deployment', finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD', servedBrowserHead: SUBJECT.mergeCommit }),
  ]);
  assert.equal(result.matchedRecordCount, 0);
  assert.equal(result.overallStatus, 'NO_MATCHING_RUNTIME_EVIDENCE');
  assert.equal(result.live, false);
});

test('delivery stages advance only from exact subject evidence', () => {
  const accepted = record({ state: 'ACCEPTED', requestId: SUBJECT.deploymentRequestId });
  assert.equal(projection([accepted]).overallStatus, 'MERGED_NOT_SYNCED');

  const synced = record({ classification: 'SYNC_FAST_FORWARD_APPLIED', localHeadAfter: SUBJECT.mergeCommit });
  assert.equal(projection([accepted, synced]).overallStatus, 'ON_BATTLE_BRIDGE_DISK');

  const built = record({ status: 'BUILD_PASS', builtDistHead: SUBJECT.mergeCommit });
  assert.equal(projection([accepted, synced, built]).overallStatus, 'BUILT_NOT_SERVED');

  const served = record({ finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD', servedBrowserHead: SUBJECT.mergeCommit });
  assert.equal(projection([accepted, synced, built, served]).overallStatus, 'SERVED_NOT_FEATURE_PROVEN');
});

test('LIVE requires served exact head plus every Music Tile experience proof', () => {
  const result = projection([
    record({ state: 'ACCEPTED', requestId: SUBJECT.deploymentRequestId }),
    record({ classification: 'SYNC_FAST_FORWARD_APPLIED', localHeadAfter: SUBJECT.mergeCommit }),
    record({ status: 'BUILD_PASS', builtDistHead: SUBJECT.mergeCommit }),
    record({ finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD', servedBrowserHead: SUBJECT.mergeCommit }),
    record({ status: 'PASS', updatedMusicTileServed: true }),
    record({ status: 'PASS', playbackContinuedAfterRating: true }),
    record({ status: 'PASS', autoUrlAndArtworkRuntimeProof: true }),
  ]);
  assert.equal(result.overallStatus, 'LIVE');
  assert.equal(result.live, true);
  assert.equal(result.stages.featureProof.updatedMusicTileServed, true);
  assert.equal(result.stages.featureProof.playbackContinuedAfterRating, true);
  assert.equal(result.stages.featureProof.autoUrlAndArtworkRuntimeProof, true);
});

test('wrong served head, stale proof and current blockers fail closed', () => {
  const wrongHead = projection([
    record({ finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD', servedBrowserHead: '1111111111111111111111111111111111111111' }),
    record({ status: 'PASS', updatedMusicTileServed: true, playbackContinuedAfterRating: true, autoUrlAndArtworkRuntimeProof: true }),
  ]);
  assert.equal(wrongHead.live, false);
  assert.equal(wrongHead.overallStatus, 'MERGED_NOT_SYNCED');

  const stale = projection([
    record({
      timestampUtc: '2026-08-06T12:00:00.000Z',
      finalVerdict: 'SOURCE_AND_RUNTIME_EXACT_HEAD',
      servedBrowserHead: SUBJECT.mergeCommit,
      updatedMusicTileServed: true,
      playbackContinuedAfterRating: true,
      autoUrlAndArtworkRuntimeProof: true,
    }),
  ]);
  assert.equal(stale.overallStatus, 'STALE_OR_REGRESSED');
  assert.equal(stale.live, false);

  const blocked = projection([
    record({ status: 'BLOCKED', summary: 'Dirty source prevented safe fast-forward.' }),
  ]);
  assert.equal(blocked.overallStatus, 'BLOCKED');
  assert.match(blocked.blocker, /Dirty source/);
});

test('bounded loader reads allowlisted evidence directories and ignores malformed files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scoped-delivery-status-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  try {
    await mkdir(repoRoot, { recursive: true });
    await mkdir(join(workspaceRoot, 'receipts'), { recursive: true });
    await writeFile(join(workspaceRoot, 'receipts', 'good.json'), JSON.stringify(record({ state: 'ACCEPTED' })), 'utf8');
    await writeFile(join(workspaceRoot, 'receipts', 'bad.json'), '{broken', 'utf8');
    const loaded = await loadScopedDeliveryStatusEvidence({ workspaceRoot, repoRoot, subject: SUBJECT, nowMs: NOW });
    assert.equal(loaded.ok, true);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.scannedFileCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
