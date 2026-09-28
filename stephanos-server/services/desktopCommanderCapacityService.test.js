import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESKTOP_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS,
  DESKTOP_COMMANDER_WORKER_ID,
  refreshDesktopCommanderCapacity,
} from './desktopCommanderCapacityService.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-09-28T01:00:00.000Z');

function baseOptions(overrides = {}) {
  const publications = [];
  const proofs = [];
  return {
    options: {
      paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
      now: NOW,
      readSourceHead: async () => HEAD,
      probeDesktopCommander: async () => ({
        ok: true,
        commanderProcessCount: 1,
        watchdogTaskState: 'Running',
        probeLatencyMs: 55,
      }),
      readQueue: async () => [
        { adapter: 'desktop-commander' },
        { adapter: 'foundry-forge' },
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

test('publishes fresh Desktop Commander source capacity only from proven watchdog health', async () => {
  const { options, publications, proofs } = baseOptions();
  const result = await refreshDesktopCommanderCapacity(options);
  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.workerId, DESKTOP_COMMANDER_WORKER_ID);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.queueDepth, 1);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.arbitraryCommandAllowed, false);

  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].commanderProcessCount, 1);
  assert.equal(proofs[0].watchdogTaskState, 'Running');
  assert.equal(proofs[0].latencySemantics, 'conservative routing ceiling; not an empirical p95 claim');

  assert.equal(publications.length, 1);
  const receipt = publications[0];
  assert.equal(receipt.route, 'DESKTOP_COMMANDER');
  assert.equal(receipt.workerId, DESKTOP_COMMANDER_WORKER_ID);
  assert.equal(receipt.queueDepth, 1);
  assert.equal(receipt.p95StartLatencySeconds, DESKTOP_COMMANDER_CONSERVATIVE_START_LATENCY_SECONDS);
  assert.deepEqual(receipt.supportedTaskClasses, ['FOCUSED_REPAIR']);
  assert.deepEqual(receipt.authorityReceiptIds, []);
  assert.deepEqual(receipt.supportedOperations, ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']);
  assert.equal(Date.parse(receipt.expiresAtUtc) - Date.parse(receipt.observedAtUtc), 4 * 60 * 1000);
});

test('Commander capacity fails closed when worker health or exact source head is not proven', async () => {
  const noHealth = baseOptions({
    probeDesktopCommander: async () => ({ ok: false, reason: 'DESKTOP_COMMANDER_NOT_HEALTHY' }),
  });
  const healthResult = await refreshDesktopCommanderCapacity(noHealth.options);
  assert.equal(healthResult.available, false);
  assert.equal(healthResult.reason, 'DESKTOP_COMMANDER_NOT_HEALTHY');
  assert.equal(noHealth.publications.length, 0);

  const noHead = baseOptions({ readSourceHead: async () => '' });
  const headResult = await refreshDesktopCommanderCapacity(noHead.options);
  assert.equal(headResult.available, false);
  assert.equal(headResult.reason, 'DESKTOP_COMMANDER_SOURCE_HEAD_UNPROVEN');
  assert.equal(noHead.publications.length, 0);
});

test('Commander proof must publish before scheduler capacity can be advertised', async () => {
  const { options, publications } = baseOptions({
    writeProof: async () => ({ ok: false, reason: 'workspace-write-failed' }),
  });
  const result = await refreshDesktopCommanderCapacity(options);
  assert.equal(result.available, false);
  assert.match(result.reason, /^DESKTOP_COMMANDER_PROOF_PUBLICATION_FAILED:/);
  assert.equal(publications.length, 0);
});

test('Commander queue depth counts only Desktop Commander mission actions', async () => {
  const { options, publications } = baseOptions({
    readQueue: async () => [
      { adapter: 'desktop-commander' },
      { adapter: 'desktop-commander' },
      { adapter: 'foundry-forge' },
      { adapter: 'codex' },
    ],
  });
  const result = await refreshDesktopCommanderCapacity(options);
  assert.equal(result.queueDepth, 2);
  assert.equal(publications[0].queueDepth, 2);
});
