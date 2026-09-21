import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchExactHeadWindowsBrowserProof,
  runNativeExactHeadWindowsBrowserProof,
} from './exactHeadWindowsBrowserProofDispatch.mjs';

const HEAD = 'a'.repeat(40);
const COMMAND = {
  requestId: 'music-native-proof-reroute-20260921',
  prNumber: 2311,
  expectedHead: HEAD,
  proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
};

function proofPayload(overrides = {}) {
  return {
    schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v3',
    runtimeSourceHead: HEAD,
    mergeReady: true,
    blocking: [],
    proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    scenarioEvidenceAccepted: true,
    ...overrides,
  };
}

function identityReaders() {
  return {
    readPullRequestHead: async () => ({ ok: true, head: HEAD }),
    readLocalHead: async () => ({ ok: true, head: HEAD }),
  };
}

test('native Windows proof invokes the existing deterministic runner with exact identity and no Codex process', () => {
  const calls = [];
  const result = runNativeExactHeadWindowsBrowserProof(COMMAND, { proofTarget: 'PULL_REQUEST_HEAD' }, {
    repoRoot: 'C:\\stephan-os',
    runnerPath: 'C:\\stephan-os\\scripts\\browser-proof-runner.mjs',
    nodeExecutable: 'node.exe',
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, stdout: `${JSON.stringify(proofPayload())}\n`, stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'node.exe');
  assert.equal(calls[0].options.cwd, 'C:\\stephan-os');
  assert.deepEqual(calls[0].args.slice(1), [
    '--url', 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    '--expected-head', HEAD,
    '--proof-target', 'PULL_REQUEST_HEAD',
    '--proof-scenario', 'MUSIC_RATING_PRESERVES_PLAYBACK',
    '--no-artifacts',
    '--machine-json',
  ]);
  assert.ok(!calls.some((call) => /codex/i.test(call.executable)));
});

test('production browser proof is Stephanos-native first when no Codex integration is supplied', async () => {
  let nativeCalls = 0;
  const result = await dispatchExactHeadWindowsBrowserProof(COMMAND, {
    platform: 'win32',
    repositoryRoot: 'C:\\stephan-os',
    ...identityReaders(),
    runNativeProof: async () => {
      nativeCalls += 1;
      return { ok: true, blocker: '', proof: proofPayload() };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.executionProvider, 'STEPHANOS_NATIVE');
  assert.equal(result.proofCompleted, true);
  assert.equal(result.codexRerouted, false);
  assert.equal(nativeCalls, 1);
});

test('empty Codex meter reroutes an explicitly injected legacy proof call to Stephanos native without retrying Codex', async () => {
  let codexCalls = 0;
  let nativeCalls = 0;
  const result = await dispatchExactHeadWindowsBrowserProof(COMMAND, {
    platform: 'win32',
    ...identityReaders(),
    integration: {
      integrationId: 'legacy-codex-fixture',
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch() {
        codexCalls += 1;
        throw new Error('Codex usage limit reached; meter empty.');
      },
    },
    runNativeProof: async () => {
      nativeCalls += 1;
      return { ok: true, blocker: '', proof: proofPayload() };
    },
  });
  assert.equal(codexCalls, 1);
  assert.equal(nativeCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.executionProvider, 'STEPHANOS_NATIVE');
  assert.equal(result.codexRerouted, true);
  assert.equal(result.proofCompleted, true);
});

test('ordinary Codex dispatch defects remain defects and are not falsely relabelled as capacity outages', async () => {
  let nativeCalls = 0;
  const result = await dispatchExactHeadWindowsBrowserProof(COMMAND, {
    platform: 'win32',
    ...identityReaders(),
    integration: {
      integrationId: 'legacy-codex-fixture',
      paths: { repoRoot: 'C:\\stephan-os' },
      capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
      dispatch() {
        return {
          accepted: true,
          workerSpawned: true,
          blocker: 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED',
          lockReleased: false,
          lockRelease: { ok: false, blocker: 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED', reason: 'owner-changed' },
        };
      },
    },
    runNativeProof: async () => {
      nativeCalls += 1;
      return { ok: true, proof: proofPayload() };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED');
  assert.equal(nativeCalls, 0);
});

test('native proof fails closed on wrong runtime head even when the process exits zero', () => {
  const result = runNativeExactHeadWindowsBrowserProof(COMMAND, {}, {
    repoRoot: 'C:\\stephan-os',
    runnerPath: 'runner.mjs',
    nodeExecutable: 'node.exe',
    spawnSyncFn: () => ({
      status: 0,
      stdout: `${JSON.stringify(proofPayload({ runtimeSourceHead: 'b'.repeat(40) }))}\n`,
      stderr: '',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_RUNTIME_SOURCE_HEAD_MISMATCH');
});
