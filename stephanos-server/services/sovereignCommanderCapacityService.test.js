import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOVEREIGN_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS,
  SOVEREIGN_COMMANDER_WORKER_ID,
  refreshSovereignCommanderCapacity,
} from './sovereignCommanderCapacityService.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-10-06T14:30:00.000Z');

function baseOptions(overrides = {}) {
  const publications = [];
  const proofs = [];
  return {
    options: {
      paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
      now: NOW,
      readSourceHead: async () => HEAD,
      probeSovereignCommander: async () => ({
        ok: true,
        proofHash: 'b'.repeat(64),
        probeLatencyMs: 5,
        canEditFiles: true,
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
      }),
      readQueue: async () => [
        { adapter: 'sovereign-commander' },
        { adapter: 'desktop-commander' },
      ],
      writeProof: async (record) => {
        proofs.push(record);
        return { ok: true, reason: 'proof-written' };
      },
      publishCapacity: async (receipt) => {
        publications.push(receipt);
        return { ok: true, reason: 'BUILD_LANE_CAPACITY_PUBLISHED' };
      },
      ...overrides,
    },
    publications,
    proofs,
  };
}

test('publishes exact-head Sovereign Commander meter-free source capacity', async () => {
  const { options, publications, proofs } = baseOptions();
  const result = await refreshSovereignCommanderCapacity(options);

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.workerId, SOVEREIGN_COMMANDER_WORKER_ID);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.queueDepth, 1);
  assert.equal(result.vendorMeterRequired, false);
  assert.equal(result.externalSaasRelayRequired, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryCommandAllowed, false);
  assert.match(result.commandProofHash, /^[a-f0-9]{64}$/);

  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].sourceConstructionAllowed, true);
  assert.equal(proofs[0].vendorMeterRequired, false);
  assert.equal(proofs[0].sourceHead, HEAD);

  assert.equal(publications.length, 1);
  const receipt = publications[0];
  assert.equal(receipt.route, 'SOVEREIGN_COMMANDER');
  assert.equal(receipt.workerId, SOVEREIGN_COMMANDER_WORKER_ID);
  assert.equal(receipt.sourceHead, HEAD);
  assert.equal(receipt.queueDepth, 1);
  assert.equal(receipt.p95StartLatencySeconds, SOVEREIGN_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS);
  assert.deepEqual(receipt.supportedTaskClasses, ['FOCUSED_REPAIR']);
  assert.deepEqual(receipt.supportedOperations, ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']);
});

test('Sovereign Commander capacity fails closed when capability proof or exact head is missing', async () => {
  const noCapability = baseOptions({
    probeSovereignCommander: async () => ({ ok: false, reason: 'SOVEREIGN_COMMANDER_CAPABILITY_PROBE_FAILED' }),
  });
  const capabilityResult = await refreshSovereignCommanderCapacity(noCapability.options);
  assert.equal(capabilityResult.available, false);
  assert.equal(capabilityResult.reason, 'SOVEREIGN_COMMANDER_CAPABILITY_PROBE_FAILED');
  assert.equal(noCapability.publications.length, 0);

  const noHead = baseOptions({ readSourceHead: async () => '' });
  const headResult = await refreshSovereignCommanderCapacity(noHead.options);
  assert.equal(headResult.available, false);
  assert.equal(headResult.reason, 'SOVEREIGN_COMMANDER_SOURCE_HEAD_UNPROVEN');
  assert.equal(noHead.publications.length, 0);
});

test('Sovereign Commander proof must publish before scheduler capacity is advertised', async () => {
  const { options, publications } = baseOptions({
    writeProof: async () => ({ ok: false, reason: 'workspace-write-failed' }),
  });
  const result = await refreshSovereignCommanderCapacity(options);
  assert.equal(result.available, false);
  assert.match(result.reason, /^SOVEREIGN_COMMANDER_PROOF_PUBLICATION_FAILED:/);
  assert.equal(publications.length, 0);
});
