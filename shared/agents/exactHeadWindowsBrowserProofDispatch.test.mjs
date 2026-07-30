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
    integration: {
      integrationId: 'test-windows-integration',
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch(packet) {
        calls.push(packet);
        return { accepted: true, started: true, jobId: packet.jobId, proofRefs: [`proof/${packet.jobId}.json`] };
      },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.executionSurface, 'WINDOWS_BATTLE_BRIDGE_EDGE');
  assert.equal(result.mergeAuthority, false);
});
