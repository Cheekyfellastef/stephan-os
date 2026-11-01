import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1 as paths,
  WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_BLOBS_V1 as blobs,
  analyzeWindowsAuthorityCanonicalMailboxNativeEvidenceReviewV1 as review,
} from './windowsAuthorityCanonicalMailboxNativeEvidenceReviewV1.mjs';

const HEAD = 'a'.repeat(40), BASE = 'b'.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os';
const blob = content => {
  const b = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
};
function fixture(changes = {}) {
  return {
    repository: REPO, prNumber: 3302,
    branch: 'codex/2315-saturated-rotation-control-v1',
    sourceHead: HEAD, baseSha: BASE,
    analysis: { findings: paths.map(path => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
      counts: { P0: 7, P1: 0, P2: 0 } },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: REPO, sourceHead: HEAD, sourceCommitSha: HEAD, baseSha: BASE,
      liveMainBeforeSha: BASE, liveMainAfterSha: BASE, parents: [BASE],
      comparison: { status: 'ahead', aheadBy: 1, behindBy: 0,
        baseCommitSha: BASE, mergeBaseCommitSha: BASE },
    },
    sources: [], ...changes,
  };
}
test('recognises only the original seven P0 native source escalation, without preauthorising it', () => {
  const x = review(fixture());
  assert.equal(x.eligible, true);
  assert.equal(x.clean, false);
  assert.deepEqual(x.reviewedPaths, paths);
  assert.equal(x.findings.filter(f => f.code === 'mailbox-native-source-blob-mismatch').length, 7);
  for (const flag of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed',
    'providerQualificationAuthority', 'nativeProducerQualified', 'nativeEvidenceAuthenticated',
    'freezeCertified', 'epochAdoptionAuthorized', 'arbitraryExecutionAllowed']) assert.equal(x[flag], false, flag);
});
test('scope, source head, base, PR, branch and lineage never fall through', () => {
  const base = fixture();
  const cases = [
    { prNumber: 3268 }, { branch: 'other' }, { repository: 'other/repo' },
    { sourceHead: BASE }, { baseSha: HEAD },
    { analysis: { findings: base.analysis.findings.slice(0, 6), counts: { P0: 6, P1: 0, P2: 0 } } },
    { analysis: { findings: [...base.analysis.findings.slice(0, 6), base.analysis.findings[0]],
      counts: { P0: 7, P1: 0, P2: 0 } } },
    { analysis: { findings: base.analysis.findings.map(f => ({ ...f, severity: 'P1' })),
      counts: { P0: 7, P1: 0, P2: 0 } } },
    { lineageEvidence: { ...base.lineageEvidence, liveMainAfterSha: HEAD } },
    { lineageEvidence: { ...base.lineageEvidence, comparison:
      { ...base.lineageEvidence.comparison, behindBy: 1 } } },
  ];
  for (const changes of cases) {
    const r = review(fixture(changes));
    assert.equal(r.eligible, false, JSON.stringify(changes));
    assert.equal(r.clean, false);
  }
});
test('synthetic source, forged blob hashes, duplicates and broadened source estate remain findings', () => {
  const sources = paths.map(path => {
    const content = 'synthetic source for ' + path + '\n';
    return { schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: REPO, path, ref: HEAD, exists: true, size: Buffer.byteLength(content),
      blobSha: blob(content), content };
  });
  const r = review(fixture({ sources }));
  assert.equal(r.eligible, true);
  assert.equal(r.clean, false);
  assert.equal(r.findings.filter(f => f.code === 'mailbox-native-source-blob-mismatch').length, 7);
  const duplicate = review(fixture({ sources: [...sources, sources[0]] }));
  assert.equal(duplicate.clean, false);
  assert.ok(duplicate.findings.some(f => f.code === 'mailbox-native-source-estate-widened'));
  const unknown = review(fixture({ sources: [...sources.slice(0, -1),
    { ...sources[0], path: 'scripts/windows/unreviewed.ps1' }] }));
  assert.equal(unknown.clean, false);
  assert.ok(unknown.findings.some(f => f.code === 'mailbox-native-source-estate-widened'));
});
test('proxy and accessor source cannot run caller code', () => {
  let calls = 0;
  const source = { path: paths[0] };
  Object.defineProperty(source, 'content', { enumerable: true, get() { calls++; throw Error('EXECUTED'); } });
  const x = review(fixture({ sources: [source] }));
  assert.equal(x.clean, false);
  assert.equal(calls, 0);
  const proxied = review(fixture({ sources: [new Proxy({ path: paths[0] }, {
    get() { calls++; throw Error('EXECUTED'); },
    ownKeys() { calls++; throw Error('EXECUTED'); },
  })] }));
  assert.equal(proxied.clean, false);
  assert.equal(calls, 0);
});
test('each actual reviewed Windows blob is pinned and no reviewer self-approval exists', () => {
  assert.equal(paths.length, 7);
  assert.deepEqual(Object.keys(blobs).sort(), [...paths].sort());
  for (const path of paths) assert.match(blobs[path], /^[a-f0-9]{40}$/);
  assert.ok(Object.isFrozen(paths));
  assert.ok(Object.isFrozen(blobs));
});
