import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSharedWorkspaceProofRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  projectSharedWorkspaceProofIndexV1,
  projectSharedWorkspaceProofIndex,
} from './sharedWorkspaceProofIndexV1.mjs';

const NOW = Date.parse('2026-10-27T16:20:00Z');
function record(input = {}) {
  return createSharedWorkspaceProofRecord({
    proofId: 'integrated-goal-1290', correlationId: 'goal-1290-proof',
    participantId: 'sovereign-reviewer',
    timestampUtc: new Date(NOW).toISOString(), relatedIssue: '#1290',
    relatedPr: '#3284', status: 'PASS', proofRefs: ['proof/goal-1290'],
    ...input,
  });
}
test('Agents Tile facade, Goal Dashboard and bounded relay use one validation/classification source', () => {
  const candidate = {
    ...record(), sourceHead: 'a'.repeat(40), proofClass: 'REVIEW',
    reviewRunId: 40544604790, reviewArtifactId: 12752700920,
  };
  const bad = { ...record({ proofId: 'bad' }), proofRefs: ['../../etc/passwd'] };
  const feed = { state: 'ready', records: { proofRecords: [candidate, bad], goalRecords: [], receiptRecords: [] } };
  const shared = projectSharedWorkspaceProofIndexV1({ sourceAvailable: true, proofRecords: feed.records.proofRecords, nowMs: NOW });
  const scoped = projectSharedWorkspaceProofIndex({ feed, nowMs: NOW });
  assert.equal(shared.visibleCount, 1);
  assert.equal(shared.rejectedRecordCount, 1);
  assert.equal(scoped.total, shared.totalValidRecords);
  assert.deepEqual(scoped.entries.map(x => x.proofId), shared.entries.map(x => x.proofId));
  assert.deepEqual(scoped.entries.map(x => x.stage), shared.entries.map(x => x.stage));
  assert.deepEqual(scoped.entries.map(x => x.state), shared.entries.map(x => x.state));
  assert.equal(scoped.entries[0].sourceLink, shared.entries[0].sourceLink);
  assert.equal(scoped.entries[0].state, 'UNVERIFIED');
  assert.equal(scoped.entries[0].independentVerification, false);
  assert.equal(scoped.grantsExecutionOrMergeAuthority, false);
  assert.equal(JSON.stringify(scoped).includes('proof/goal-1290'), false);
});
test('scoped filtering is applied before the bounded page is produced', () => {
  const records = Array.from({ length: 40 }, (_, n) => record({
    proofId: 'proof-' + n, relatedIssue: n >= 30 ? '#1290' : '#2315',
    timestampUtc: new Date(NOW - n * 1000).toISOString(),
  }));
  const index = projectSharedWorkspaceProofIndexV1({
    sourceAvailable: true, proofRecords: records, nowMs: NOW, goal: 1290, maxItems: 5,
  });
  assert.equal(index.totalValidRecords, 10);
  assert.equal(index.visibleCount, 5);
  assert.ok(index.entries.every(x => x.goal === 1290));
});
test('invalid selectors and stale feed preserve fail-closed no-authority states', () => {
  const feed = { state: 'ready', records: { proofRecords: [record()] } };
  assert.equal(projectSharedWorkspaceProofIndex({ feed, goal: '../../etc' }).state, 'INVALID_FILTER');
  assert.equal(projectSharedWorkspaceProofIndex({ feed: { ...feed, state: 'error' } }).state, 'INACCESSIBLE');
  assert.equal(projectSharedWorkspaceProofIndex({ feed: { ...feed, state: 'stale' } }).state, 'STALE');
});
test('both UI views and backend route call the same canonical proof-index module', async () => {
  const paths = [
    ['../../stephanos-ui/src/components/SharedWorkspaceProofIndex.jsx', /feed\?\.proofIndex/],
    ['../../stephanos-server/routes/shared-workspace.js', /projectSharedWorkspaceProofIndex/],
    ['./chatGptParticipantBridgeV1.mjs', /projectSharedWorkspaceProofIndexV1/],
    ['./shared-workspace-dashboard-feed.mjs', /projectSharedWorkspaceProofIndexV1/],
    ['../../apps/goal-dashboard/index.html', /renderSharedProofIndex/],
  ];
  for (const [relative, expected] of paths) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, expected, relative);
  }
});

test('browser-only proof index view does not import the Node filesystem store', async () => {
  const ui = await readFile(new URL('../../stephanos-ui/src/components/SharedWorkspaceProofIndex.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /from ['"]\.\.\/\.\.\/\.\.\/shared\/agents\/sharedWorkspaceProofIndexV1\.mjs['"]/);
  assert.match(ui, /source\.entries\.filter/);
  assert.match(ui, /safeSourceLink/);
});
