import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExactHeadWindowsBrowserProofPacket,
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
  assert.deepEqual(packet.requestedProofCommands, ['git rev-parse HEAD', 'npm run stephanos:browser-proof']);
  assert.deepEqual(packet.exactHeadProof, {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: command.prNumber,
    expectedHead: command.expectedHead,
  });
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
