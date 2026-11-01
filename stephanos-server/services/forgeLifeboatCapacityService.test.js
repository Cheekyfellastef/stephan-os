import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORGE_LIFEBOAT_WORKER_ID,
  forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { refreshForgeLifeboatCapacity } from './forgeLifeboatCapacityService.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-09-18T09:00:00.000Z');

function baseOptions(overrides = {}) {
  const publications = [];
  const proofs = [];
  return {
    options: {
      paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
      now: NOW,
      readSourceHead: async () => HEAD,
      probeLocalBuilder: async () => ({
        ok: true,
        latencyMs: 1250,
        requestSha256: '1'.repeat(64),
        responseSha256: '2'.repeat(64),
      }),
      readQueue: async () => [
        { adapter: 'foundry-forge' },
        { adapter: 'codex' },
        { adapter: 'foundry-forge' },
      ],
      writeProof: async (record) => {
        proofs.push(record);
        return { ok: true, reason: 'proof-written' };
      },
      publishCapacity: async (observation) => {
        publications.push(observation);
        return {
          finalVerdict: 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED',
          publication: { ok: true },
          workerScopedPublication: { ok: true },
        };
      },
      ...overrides,
    },
    publications,
    proofs,
  };
}

test('publishes one short-lived Lane 6 receipt from a real local-model probe and pending queue depth', async () => {
  const { options, publications, proofs } = baseOptions();
  const result = await refreshForgeLifeboatCapacity(options);

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.queueDepth, 2);
  assert.equal(result.observedResponseLatencySeconds, 1.25);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.arbitraryCommandAllowed, false);

  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].sourceHead, HEAD);
  assert.equal(proofs[0].sampleCount, 1);
  assert.equal(proofs[0].latencySemantics, 'single live generation response latency; conservative upper bound for start latency');

  assert.equal(publications.length, 1);
  assert.equal(publications[0].route, 'FOUNDRY_FORGE');
  assert.equal(publications[0].workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(publications[0].queueDepth, 2);
  assert.equal(publications[0].p95StartLatencySeconds, 1.25);
  assert.deepEqual(publications[0].authorityReceiptIds, [forgeLifeboatAuthorityReceiptId(HEAD)]);
  assert.deepEqual(publications[0].proofRefs, [forgeLifeboatProofRef(HEAD)]);
});

test('normalizes the existing STEP HANOS Ollama /api/chat endpoint shape to the fixed loopback base', async () => {
  const observedEndpoints = [];
  const { options, proofs } = baseOptions({
    env: { STEPHANOS_OLLAMA_ENDPOINT: 'http://127.0.0.1:11434/api/chat' },
    probeLocalBuilder: async ({ endpoint }) => {
      observedEndpoints.push(endpoint);
      return {
        ok: true,
        latencyMs: 900,
        requestSha256: '3'.repeat(64),
        responseSha256: '4'.repeat(64),
      };
    },
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.available, true);
  assert.deepEqual(observedEndpoints, ['http://127.0.0.1:11434']);
  assert.equal(proofs[0].endpoint, 'http://127.0.0.1:11434');
});

test('uses canonical git command for Lane 6 source-head proof and preserves an explicit override', async () => {
  const observedCommands = [];
  const spawn = (command) => {
    observedCommands.push(command);
    return { error: null, status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };

  const defaultRun = baseOptions({ readSourceHead: undefined, spawnSyncFn: spawn });
  const defaultResult = await refreshForgeLifeboatCapacity(defaultRun.options);
  assert.equal(defaultResult.available, true);

  const overrideRun = baseOptions({ readSourceHead: undefined, spawnSyncFn: spawn, gitCommand: 'test-git-override' });
  const overrideResult = await refreshForgeLifeboatCapacity(overrideRun.options);
  assert.equal(overrideResult.available, true);

  assert.deepEqual(observedCommands, ['git', 'test-git-override']);
});

test('does not advertise Lane 6 when source head or local model proof is missing', async () => {
  const noHead = baseOptions({ readSourceHead: async () => '' });
  const headResult = await refreshForgeLifeboatCapacity(noHead.options);
  assert.equal(headResult.available, false);
  assert.equal(headResult.reason, 'FORGE_LIFEBOAT_SOURCE_HEAD_UNPROVEN');
  assert.equal(noHead.publications.length, 0);

  const noModel = baseOptions({
    probeLocalBuilder: async () => ({ ok: false, reason: 'FORGE_LIFEBOAT_MODEL_PROBE_TIMEOUT' }),
  });
  const modelResult = await refreshForgeLifeboatCapacity(noModel.options);
  assert.equal(modelResult.available, false);
  assert.equal(modelResult.reason, 'FORGE_LIFEBOAT_MODEL_PROBE_TIMEOUT');
  assert.equal(noModel.publications.length, 0);
});

test('proof publication must succeed before the lifeboat can advertise source capacity', async () => {
  const { options, publications } = baseOptions({
    writeProof: async () => ({ ok: false, reason: 'workspace-write-failed' }),
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.available, false);
  assert.match(result.reason, /^FORGE_LIFEBOAT_PROOF_PUBLICATION_FAILED:/);
  assert.equal(publications.length, 0);
});
