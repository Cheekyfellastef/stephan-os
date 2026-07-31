import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExactHeadWindowsBrowserProofPacket,
  createWindowsSafeBrowserProofJobId,
  dispatchExactHeadWindowsBrowserProof,
} from './exactHeadWindowsBrowserProofDispatch.mjs';

const command = {
  requestId: 'music-rating-browser-proof-20260730',
  prNumber: 1628,
  expectedHead: '8157899b743e1e931601feb4a01efb91e3e6249b',
  proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
};

test('builds one approved read-only exact-head Windows proof packet', () => {
  const packet = buildExactHeadWindowsBrowserProofPacket(command, '2026-07-30T20:00:00.000Z');
  assert.equal(packet.status, 'READY_FOR_MANUAL_DISPATCH');
  assert.match(packet.prompt, /Microsoft Edge/);
  assert.match(packet.prompt, /strictly identical/);
  assert.match(packet.prompt, /EXPECTED_HEAD_MISMATCH/);
  assert.match(packet.prompt, /runtimeSourceHead/);
  assert.deepEqual(packet.requestedProofCommands, [
    'git rev-parse HEAD',
    `node scripts/browser-proof-runner.mjs --url http://127.0.0.1:4173/apps/stephanos/dist/index.html --expected-head ${command.expectedHead} --proof-scenario MUSIC_RATING_PRESERVES_PLAYBACK --no-artifacts --machine-json`,
  ]);
  assert.deepEqual(packet.exactHeadProof, {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: command.prNumber,
    expectedHead: command.expectedHead,
    proofTarget: 'PULL_REQUEST_HEAD',
    pullRequestHead: '',
    proofScenario: command.proofScenario,
  });
});

test('binds a post-merge proof to both immutable PR provenance and the merged main runtime head', async () => {
  const pullRequestHead = command.expectedHead;
  const mergeCommitHead = '3465beca92e0651598a77668c4426451aadad0b2';
  const mergedCommand = {
    ...command,
    expectedHead: mergeCommitHead,
    proofTarget: 'MERGED_MAIN',
    pullRequestHead,
  };
  const calls = [];
  const result = await dispatchExactHeadWindowsBrowserProof(mergedCommand, {
    platform: 'win32',
    now: () => '2026-07-31T20:00:00.000Z',
    readPullRequestHead: async () => ({
      ok: true,
      head: pullRequestHead,
      merged: true,
      state: 'closed',
      mergeCommitHead,
      baseBranch: 'main',
    }),
    readLocalHead: async () => ({ ok: true, head: mergeCommitHead }),
    integration: {
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) {
        calls.push(packet);
        return { accepted: true, started: true, jobId: packet.jobId };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.proofTarget, 'MERGED_MAIN');
  assert.equal(result.expectedHead, mergeCommitHead);
  assert.equal(result.pullRequestHead, pullRequestHead);
  assert.equal(result.mergeCommitHead, mergeCommitHead);
  assert.equal(result.localHead, mergeCommitHead);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].exactHeadProof, {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: command.prNumber,
    expectedHead: mergeCommitHead,
    proofTarget: 'MERGED_MAIN',
    pullRequestHead,
    proofScenario: command.proofScenario,
  });
});

test('rejects post-merge PR-head substitution, unrelated merges, missing provenance, stale main, and head movement', async () => {
  const pullRequestHead = command.expectedHead;
  const mergeCommitHead = '3465beca92e0651598a77668c4426451aadad0b2';
  const mergedCommand = { ...command, expectedHead: mergeCommitHead, proofTarget: 'MERGED_MAIN', pullRequestHead };
  const integration = {
    paths: { repoRoot: 'C:\\stephan-os' },
    capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
    dispatch() { assert.fail('dispatch must not run'); },
  };
  const identity = { ok: true, head: pullRequestHead, merged: true, state: 'closed', mergeCommitHead, baseBranch: 'main' };
  const run = (overrides = {}) => dispatchExactHeadWindowsBrowserProof(overrides.command || mergedCommand, {
    platform: 'win32', integration,
    readPullRequestHead: overrides.readPullRequestHead || (async () => identity),
    readLocalHead: overrides.readLocalHead || (async () => ({ ok: true, head: mergeCommitHead })),
  });

  assert.equal((await run({ command: { ...mergedCommand, pullRequestHead: 'a'.repeat(40) } })).blocker, 'PR_HEAD_MISMATCH');
  assert.equal((await run({
    readPullRequestHead: async () => ({ ...identity, mergeCommitHead: 'b'.repeat(40) }),
  })).blocker, 'MERGE_COMMIT_MISMATCH');
  assert.equal((await run({ command: { ...mergedCommand, pullRequestHead: '' } })).blocker, 'PR_PROVENANCE_HEAD_REQUIRED');
  assert.equal((await run({ readLocalHead: async () => ({ ok: true, head: 'c'.repeat(40) }) })).blocker, 'EXPECTED_HEAD_MISMATCH');

  let identityReads = 0;
  const moved = await run({
    readPullRequestHead: async () => {
      identityReads += 1;
      return identityReads === 1 ? identity : { ...identity, head: 'd'.repeat(40) };
    },
  });
  assert.equal(moved.blocker, 'PR_HEAD_MISMATCH');
});

test('derives a deterministic Windows-safe job id instead of using a raw mailbox request id as a path', () => {
  const requestId = 'proof:2026-07-30T20:00:00Z';
  const first = createWindowsSafeBrowserProofJobId(requestId);
  const second = createWindowsSafeBrowserProofJobId(requestId);
  assert.equal(first, second);
  assert.match(first, /^windows-browser-proof-[0-9a-f]{32}$/);
  assert.doesNotMatch(first, /[<>:"/\\|?*]/);
  assert.equal(buildExactHeadWindowsBrowserProofPacket({ ...command, requestId }).jobId, first);
});

test('fails closed away from Windows', async () => {
  const result = await dispatchExactHeadWindowsBrowserProof(command, { platform: 'linux' });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WINDOWS_EXECUTION_SURFACE_REQUIRED');
});

test('dispatches once through the existing local Codex integration', async () => {
  const calls = [];
  const result = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    now: () => '2026-07-30T20:00:00.000Z',
    readPullRequestHead: async () => ({ ok: true, head: command.expectedHead }),
    readLocalHead: async () => ({ ok: true, head: command.expectedHead }),
    integration: {
      integrationId: 'test-windows-integration',
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) {
        calls.push(packet);
        return { accepted: true, started: true, jobId: packet.jobId, proofRefs: [`proof/${packet.jobId}.json`] };
      },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.pullRequestHead, command.expectedHead);
  assert.equal(result.localHead, command.expectedHead);
  assert.equal(result.executionSurface, 'WINDOWS_BATTLE_BRIDGE_EDGE');
  assert.equal(result.mergeAuthority, false);
});

test('blocks the healthy mailbox verdict when a spawned worker cannot release the dispatch lock', async () => {
  const result = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    now: () => '2026-07-30T20:00:00.000Z',
    readPullRequestHead: async () => ({ ok: true, head: command.expectedHead }),
    readLocalHead: async () => ({ ok: true, head: command.expectedHead }),
    integration: {
      integrationId: 'test-windows-integration',
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) {
        return {
          accepted: true,
          workerSpawned: true,
          jobId: packet.jobId,
          proofRefs: [`proof/${packet.jobId}.json`],
          blocker: 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED',
          lockReleased: false,
          lockRelease: {
            ok: false,
            blocker: 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED',
            reason: 'owner-changed',
          },
        };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED');
  assert.equal(result.blocker, 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED');
  assert.equal(result.dispatchAccepted, true);
  assert.equal(result.workerSpawned, true);
  assert.equal(result.taskId, createWindowsSafeBrowserProofJobId(command.requestId));
  assert.equal(result.lockReleased, false);
  assert.equal(result.lockRelease.reason, 'owner-changed');
});

test('blocks the healthy mailbox verdict when the final dispatch receipt cannot be persisted', async () => {
  const result = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    now: () => '2026-07-30T20:00:00.000Z',
    readPullRequestHead: async () => command.expectedHead,
    readLocalHead: async () => command.expectedHead,
    integration: {
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch: () => ({
        accepted: true,
        workerSpawned: true,
        lockReleased: true,
        lockRelease: { ok: true, blocker: '', receiptPersisted: false },
      }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOCAL_CODEX_DISPATCH_RECEIPT_PERSIST_FAILED');
  assert.equal(result.dispatchAccepted, true);
  assert.equal(result.workerSpawned, true);
  assert.equal(result.lockReleased, true);
  assert.equal(result.lockRelease.receiptPersisted, false);
});

test('blocks before local inspection or dispatch when the PR head changed', async () => {
  const calls = [];
  let localReads = 0;
  const changedHead = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    readPullRequestHead: async () => ({ ok: true, head: changedHead }),
    readLocalHead: async () => {
      localReads += 1;
      return { ok: true, head: command.expectedHead };
    },
    integration: {
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) { calls.push(packet); },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PR_HEAD_MISMATCH');
  assert.equal(result.pullRequestHead, changedHead);
  assert.equal(localReads, 0);
  assert.equal(calls.length, 0);
});

test('blocks before dispatch when the Windows checkout is not the approved head', async () => {
  const calls = [];
  const localHead = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    readPullRequestHead: async () => command.expectedHead,
    readLocalHead: async () => ({ ok: true, head: localHead }),
    integration: {
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) { calls.push(packet); },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXPECTED_HEAD_MISMATCH');
  assert.equal(result.pullRequestHead, command.expectedHead);
  assert.equal(result.localHead, localHead);
  assert.equal(calls.length, 0);
});

test('fails closed when either exact-head lookup cannot be proved', async () => {
  const integration = {
    paths: { repoRoot: 'C:\\stephan-os' },
    capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
    dispatch() { assert.fail('dispatch must not run'); },
  };
  const githubFailure = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    integration,
    readPullRequestHead: async () => ({ ok: false, blocker: 'PR_HEAD_LOOKUP_FAILED' }),
  });
  assert.equal(githubFailure.blocker, 'PR_HEAD_LOOKUP_FAILED');

  const localFailure = await dispatchExactHeadWindowsBrowserProof(command, {
    platform: 'win32',
    integration,
    readPullRequestHead: async () => command.expectedHead,
    readLocalHead: async () => ({ ok: false, blocker: 'LOCAL_HEAD_LOOKUP_FAILED' }),
  });
  assert.equal(localFailure.blocker, 'LOCAL_HEAD_LOOKUP_FAILED');
});
