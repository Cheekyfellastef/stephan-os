import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODEX_RECOVERY_DECISION,
  CODEX_WORKSPACE_STATE,
  attachLocalBuildEvidence,
  attachRemotePublicationEvidence,
  createCodexWorkspaceAttempt,
  createPatchEscrowBundle,
  parsePatchEscrowComment,
  planCodexWorkspaceRecovery,
  reassemblePatchEscrow,
  renderPatchEscrowChunkComment,
  renderPatchEscrowManifestComment,
  renderPatchEscrowPublishComment,
  renewCodexWorkspaceLease,
  validateCodexWorkspaceAttempt,
  validatePatchEscrowManifest,
  workspaceLeaseIsActive,
} from './codexPatchEscrow.mjs';

const BASE_SHA = 'a'.repeat(40);
const LOCAL_SHA = 'b'.repeat(40);
const REMOTE_SHA = 'c'.repeat(40);

function baseAttempt(overrides = {}) {
  return createCodexWorkspaceAttempt({
    issueNumber: 1503,
    jobId: 'codex-job-1503',
    attemptNumber: 3,
    baseSha: BASE_SHA,
    targetBranch: 'patch-escrow/issue-1503-123456789abc',
    createdAtUtc: '2026-07-13T10:00:00Z',
    leaseOwner: 'codex-task-abc',
    leaseSeconds: 900,
    ...overrides,
  });
}

test('workspace attempts have stable readable job, attempt, and workspace identities', () => {
  const attempt = baseAttempt();
  assert.equal(attempt.attemptId, 'codex-job-1503-a003');
  assert.equal(attempt.workspaceId, 'ws-codex-job-1503-a003');
  assert.equal(attempt.state, CODEX_WORKSPACE_STATE.LEASED);
  assert.equal(validateCodexWorkspaceAttempt(attempt).valid, true);
});

test('active leases block duplicate attempts and can only be renewed by the current owner', () => {
  const attempt = baseAttempt();
  assert.equal(workspaceLeaseIsActive(attempt, '2026-07-13T10:05:00Z'), true);
  const blocked = renewCodexWorkspaceLease(attempt, {
    leaseOwner: 'different-task',
    nowUtc: '2026-07-13T10:05:00Z',
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'lease-owned-by-another-workspace');
  const renewed = renewCodexWorkspaceLease(attempt, {
    leaseOwner: 'codex-task-abc',
    nowUtc: '2026-07-13T10:05:00Z',
    leaseSeconds: 1200,
  });
  assert.equal(renewed.ok, true);
  assert.equal(renewed.attempt.heartbeatAtUtc, '2026-07-13T10:05:00.000Z');
});

test('patch escrow chunks reassemble deterministically even when comments arrive out of order', () => {
  const patch = 'diff --git a/a.mjs b/a.mjs\n--- a/a.mjs\n+++ b/a.mjs\n@@ -1 +1 @@\n-old\n+new\n';
  const bundle = createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch,
    chunkChars: 12,
    changedFiles: ['shared/agents/a.mjs'],
    testProfile: 'shared-agents',
    commitMessage: 'Repair issue #1503',
    prTitle: 'Repair issue #1503',
    prBody: 'Bounded patch escrow publication.',
  });
  assert.equal(validatePatchEscrowManifest(bundle.manifest).valid, true);
  const result = reassemblePatchEscrow(bundle.manifest, [...bundle.chunks].reverse());
  assert.equal(result.ok, true);
  assert.equal(result.patch.toString('utf8'), patch);
});

test('missing, duplicate, or corrupt patch chunks fail closed', () => {
  const bundle = createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch: '0123456789abcdef0123456789abcdef',
    chunkChars: 8,
    changedFiles: ['shared/agents/a.mjs'],
    testProfile: 'node-changed',
    commitMessage: 'Repair issue #1503',
    prTitle: 'Repair issue #1503',
  });
  assert.equal(reassemblePatchEscrow(bundle.manifest, bundle.chunks.slice(1)).ok, false);
  assert.equal(reassemblePatchEscrow(bundle.manifest, [bundle.chunks[0], bundle.chunks[0], ...bundle.chunks.slice(2)]).ok, false);
  const corrupted = bundle.chunks.map((chunk, index) => index === 0 ? { ...chunk, data: `${chunk.data.slice(0, -1)}A` } : chunk);
  assert.equal(reassemblePatchEscrow(bundle.manifest, corrupted).ok, false);
});

test('comment protocol round-trips manifest, chunks, and final owner publish request', () => {
  const bundle = createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch: 'patch-body',
    changedFiles: ['shared/agents/a.mjs'],
    testProfile: 'node-changed',
    commitMessage: 'Repair issue #1503',
    prTitle: 'Repair issue #1503',
  });
  const manifest = parsePatchEscrowComment(renderPatchEscrowManifestComment(bundle.manifest));
  const chunk = parsePatchEscrowComment(renderPatchEscrowChunkComment(bundle.chunks[0]));
  const publish = parsePatchEscrowComment(renderPatchEscrowPublishComment(bundle.manifest.bundleId));
  assert.equal(manifest.marker, 'PATCH_ESCROW_MANIFEST_V1');
  assert.equal(chunk.marker, 'PATCH_ESCROW_CHUNK_V1');
  assert.equal(publish.marker, 'PATCH_ESCROW_PUBLISH_V1');
  assert.equal(publish.payload.bundleId, bundle.manifest.bundleId);
});

test('expired local work with a valid escrow publishes instead of rebuilding', () => {
  const initial = baseAttempt({ leaseSeconds: 60 });
  const withEvidence = attachLocalBuildEvidence(initial, {
    localHeadSha: LOCAL_SHA,
    patchSha256: 'd'.repeat(64),
    patchRef: 'github-issue://1503/patch-issue-1503-dddddddddddd',
    testsPassed: true,
    updatedAtUtc: '2026-07-13T10:01:00Z',
  }).attempt;
  const plan = planCodexWorkspaceRecovery({ attempts: [withEvidence], nowUtc: '2026-07-13T11:00:00Z' });
  assert.equal(plan.decision, CODEX_RECOVERY_DECISION.PUBLISH_ESCROW);
});

test('active workspaces are reused rather than creating duplicate rebuilds', () => {
  const plan = planCodexWorkspaceRecovery({ attempts: [baseAttempt()], nowUtc: '2026-07-13T10:05:00Z' });
  assert.equal(plan.decision, CODEX_RECOVERY_DECISION.REUSE_ACTIVE_ATTEMPT);
});

test('local commit SHAs never count as remote publication proof', () => {
  const attempt = attachLocalBuildEvidence(baseAttempt(), {
    localHeadSha: LOCAL_SHA,
    testsPassed: true,
    updatedAtUtc: '2026-07-13T10:10:00Z',
  }).attempt;
  const blocked = attachRemotePublicationEvidence(attempt, {
    branch: attempt.targetBranch,
    remoteHeadSha: LOCAL_SHA,
    remoteHeadReachable: false,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'remote-head-not-proven');
});

test('remote branch and PR states require reachable exact-head evidence', () => {
  const attempt = baseAttempt();
  const branch = attachRemotePublicationEvidence(attempt, {
    branch: attempt.targetBranch,
    remoteHeadSha: REMOTE_SHA,
    remoteHeadReachable: true,
    verifiedAtUtc: '2026-07-13T10:20:00Z',
  });
  assert.equal(branch.ok, true);
  assert.equal(branch.attempt.state, CODEX_WORKSPACE_STATE.REMOTE_BRANCH_VERIFIED);
  const pr = attachRemotePublicationEvidence(branch.attempt, {
    branch: attempt.targetBranch,
    remoteHeadSha: REMOTE_SHA,
    remoteHeadReachable: true,
    prNumber: 1600,
    verifiedAtUtc: '2026-07-13T10:21:00Z',
  });
  assert.equal(pr.ok, true);
  assert.equal(pr.attempt.state, CODEX_WORKSPACE_STATE.PR_LIVE);
  assert.equal(planCodexWorkspaceRecovery({ attempts: [pr.attempt] }).decision, CODEX_RECOVERY_DECISION.TRACK_LIVE_PR);
});

test('unsafe and generated paths are rejected from patch escrow manifests', () => {
  const bundle = createPatchEscrowBundle({
    issueNumber: 1503,
    baseSha: BASE_SHA,
    patch: 'patch',
    changedFiles: ['apps/stephanos/dist/index.html'],
    testProfile: 'node-changed',
    commitMessage: 'Unsafe patch',
    prTitle: 'Unsafe patch',
  });
  const validation = validatePatchEscrowManifest(bundle.manifest);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(','), /unsafe-changed-files/);
});
