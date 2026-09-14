import assert from 'node:assert/strict';
import test from 'node:test';

import { claimDriverNeutralExternalConstruction } from './driverNeutralExternalPickupService.js';

function claim(adapter = 'chatgpt-github') {
  return {
    adapter,
    processingPath: 'C:/queue/processing/action-1.json',
    item: {
      actionId: 'action-1',
      missionId: 'critical-1622-autonomy-cycle',
      payload: {
        actionId: 'action-1',
        missionId: 'critical-1622-autonomy-cycle',
        adapter,
        repository: 'Cheekyfellastef/stephan-os',
        branch: 'fix/1622-driver-neutral-external-pickup-v1',
        allowedFiles: ['stephanos-server/services/**'],
        requiredTests: ['node --test stephanos-server/services/driverNeutralExternalPickupService.test.js'],
        requiredEvidence: ['canonical external pickup'],
      },
    },
  };
}

function writer(calls) {
  return async (root, segments, handoff) => {
    calls.push({ root, segments, handoff, body: JSON.parse(handoff.body) });
    return { ok: true, path: `${root}/${segments.join('/')}` };
  };
}

test('claims chatgpt-github through canonical Mission Worker queue and publishes one driver-neutral handoff', async () => {
  const calls = [];
  const result = await claimDriverNeutralExternalConstruction({
    sharedWorkspaceRoot: 'C:/workspace',
    repoRoot: 'C:/repo',
    now: new Date('2026-09-14T12:00:00.000Z'),
    claimNext: async (adapter) => adapter === 'chatgpt-github' ? claim(adapter) : null,
    writeHandoff: writer(calls),
  });
  assert.equal(result.ok, true);
  assert.equal(result.claimed, true);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.classification, 'EXTERNAL_CONSTRUCTION_CLAIMED');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.claimState, 'CLAIMED');
  assert.equal(calls[0].body.oneWriterRequired, true);
  assert.equal(calls[0].body.leaseSeizureAllowed, false);
});

test('tries foundry-forge when chatgpt-github has no ready item', async () => {
  const seen = [];
  const calls = [];
  const result = await claimDriverNeutralExternalConstruction({
    sharedWorkspaceRoot: 'C:/workspace',
    repoRoot: 'C:/repo',
    claimNext: async (adapter) => {
      seen.push(adapter);
      return adapter === 'foundry-forge' ? claim(adapter) : null;
    },
    writeHandoff: writer(calls),
  });
  assert.deepEqual(seen, ['chatgpt-github', 'foundry-forge']);
  assert.equal(result.claimed, true);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(calls.length, 1);
});

test('truthfully remains idle when neither external lane has work', async () => {
  const result = await claimDriverNeutralExternalConstruction({
    claimNext: async () => null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.claimed, false);
  assert.equal(result.classification, 'NO_EXTERNAL_CONSTRUCTION_READY');
});
