import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUAL_FORGE_DECISIONS,
  DUAL_FORGE_SCHEMA,
  planDualForgeConstructionSidecar,
} from './dualForgeConstructionSidecarV1.mjs';

const MAIN = 'a'.repeat(40);
const NOW = '2026-08-06T12:00:00Z';

function lane(overrides = {}) {
  return {
    laneId: 'lane-github-1',
    goalId: 'goal-1671',
    surface: 'github',
    state: 'ready',
    branch: 'feat/github-lane',
    baseHead: MAIN,
    head: 'b'.repeat(40),
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    packetId: 'packet-1',
    laneId: 'lane-github-1',
    repository: 'Cheekyfellastef/stephan-os',
    state: 'ready',
    baseHead: MAIN,
    head: 'b'.repeat(40),
    tree: 'c'.repeat(40),
    changedFiles: ['shared/agents/example.mjs'],
    proofRefs: ['proofs/local/packet-1'],
    dependsOnPacketIds: [],
    settledAtUtc: '2026-08-06T11:55:00Z',
    priority: 100,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: MAIN,
    nowUtc: NOW,
    settleWindowSeconds: 120,
    githubApiBudget: {
      limit: 1000,
      remaining: 700,
      reserve: 200,
      estimatedPublicationCost: 100,
      resetAtUtc: '2026-08-06T13:00:00Z',
    },
    lanes: [
      lane(),
      lane({
        laneId: 'lane-forge-1',
        goalId: 'goal-2000',
        surface: 'forge',
        branch: 'feat/forge-lane',
        head: 'd'.repeat(40),
      }),
    ],
    packets: [packet()],
    publishedPacketIds: [],
    activeIntegration: null,
    ...overrides,
  };
}

test('GitHub and Forge lanes build together while one packet enters integration', () => {
  const result = planDualForgeConstructionSidecar(input());

  assert.equal(result.schemaVersion, DUAL_FORGE_SCHEMA);
  assert.equal(result.valid, true);
  assert.equal(result.decision, DUAL_FORGE_DECISIONS.READY);
  assert.deepEqual(result.surfaces.github, ['lane-github-1']);
  assert.deepEqual(result.surfaces.forge, ['lane-forge-1']);
  assert.equal(result.selectedPacket.packetId, 'packet-1');
  assert.equal(result.authority.merge, false);
  assert.equal(result.authority.sourceMutation, false);
  assert.equal(result.authority.publicationRequiresExternalAdapter, true);
});

test('GitHub API reserve holds publication without slowing construction lanes', () => {
  const result = planDualForgeConstructionSidecar(input({
    githubApiBudget: {
      limit: 1000,
      remaining: 240,
      reserve: 200,
      estimatedPublicationCost: 100,
      resetAtUtc: '2026-08-06T13:00:00Z',
    },
  }));

  assert.equal(result.valid, true);
  assert.equal(result.decision, DUAL_FORGE_DECISIONS.API_BUDGET_HELD);
  assert.equal(result.selectedPacket, null);
  assert.equal(result.nextEligibleAtUtc, '2026-08-06T13:00:00.000Z');
  assert.ok(result.waitingPackets.some((item) => item.reason === 'github-api-reserve-protected'));
});

test('an active integration serializes publication while both construction surfaces remain admitted', () => {
  const result = planDualForgeConstructionSidecar(input({
    activeIntegration: { packetId: 'packet-active', head: 'e'.repeat(40) },
  }));

  assert.equal(result.decision, DUAL_FORGE_DECISIONS.INTEGRATION_BUSY);
  assert.equal(result.selectedPacket, null);
  assert.deepEqual(result.surfaces.forge, ['lane-forge-1']);
  assert.equal(result.activeIntegration.packetId, 'packet-active');
});

test('settle window coalesces rapid local completions before GitHub publication', () => {
  const result = planDualForgeConstructionSidecar(input({
    packets: [packet({ settledAtUtc: '2026-08-06T11:59:30Z' })],
  }));

  assert.equal(result.decision, DUAL_FORGE_DECISIONS.SETTLING);
  assert.equal(result.selectedPacket, null);
  assert.deepEqual(result.waitingPackets, [
    { packetId: 'packet-1', reason: 'packet-settle-window-active' },
  ]);
});

test('stale exact-base packets fail closed rather than being rebased implicitly', () => {
  const stale = 'f'.repeat(40);
  const result = planDualForgeConstructionSidecar(input({
    lanes: [lane({ baseHead: stale })],
    packets: [packet({ baseHead: stale })],
  }));

  assert.equal(result.valid, false);
  assert.equal(result.decision, DUAL_FORGE_DECISIONS.BLOCKED);
  assert.ok(result.blockers.includes('lane-base-stale:lane-github-1'));
  assert.ok(result.blockers.includes('packet-base-stale:packet-1'));
});

test('unpublished dependencies keep a settled packet outside the integration lane', () => {
  const result = planDualForgeConstructionSidecar(input({
    packets: [packet({ dependsOnPacketIds: ['packet-prerequisite'] })],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.selectedPacket, null);
  assert.ok(result.waitingPackets.some((item) => (
    item.packetId === 'packet-1'
    && item.reason === 'packet-dependencies-unpublished'
    && item.dependencies[0] === 'packet-prerequisite'
  )));
});

test('overlapping packets are ordered deterministically and only the higher-ranked packet is selected', () => {
  const forgePacket = packet({
    packetId: 'packet-forge',
    laneId: 'lane-forge-1',
    head: 'd'.repeat(40),
    tree: 'e'.repeat(40),
    priority: 200,
  });
  const githubPacket = packet({ priority: 100 });
  const result = planDualForgeConstructionSidecar(input({
    packets: [githubPacket, forgePacket],
  }));

  assert.equal(result.selectedPacket.packetId, 'packet-forge');
  assert.ok(result.waitingPackets.some((item) => (
    item.packetId === 'packet-1'
    && item.reason === 'packet-path-conflict-with-higher-ranked-packet'
  )));
});

test('packet selection is stable regardless of input order', () => {
  const first = packet({ packetId: 'packet-a', priority: 100, changedFiles: ['a.mjs'] });
  const second = packet({
    packetId: 'packet-b',
    laneId: 'lane-forge-1',
    head: 'd'.repeat(40),
    tree: 'e'.repeat(40),
    priority: 200,
    changedFiles: ['b.mjs'],
  });

  const left = planDualForgeConstructionSidecar(input({ packets: [first, second] }));
  const right = planDualForgeConstructionSidecar(input({ packets: [second, first] }));

  assert.equal(left.selectedPacket.packetId, 'packet-b');
  assert.equal(right.selectedPacket.packetId, 'packet-b');
});

test('unsafe paths, duplicate packet identities and invented authority are rejected or absent', () => {
  const duplicated = packet({ changedFiles: ['../outside.mjs'] });
  const result = planDualForgeConstructionSidecar(input({
    packets: [duplicated, duplicated],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('packet-file-path-invalid:packet-1'));
  assert.ok(result.blockers.includes('packet-id-duplicate:packet-1'));
  assert.equal(result.authority.forcePush, false);
  assert.equal(Object.hasOwn(result.authority, 'approval'), false);
});
