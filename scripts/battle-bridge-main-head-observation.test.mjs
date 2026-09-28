import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BATTLE_BRIDGE_MAIN_HEAD_ENDPOINT,
  BATTLE_BRIDGE_MAIN_HEAD_REPOSITORY,
  readBattleBridgeBrokeredMainHead,
} from './battle-bridge-main-head-observation.mjs';

const HEAD = 'a'.repeat(40);

test('main-head observation is fixed to canonical repository and reuses one shared upstream read', async () => {
  assert.equal(BATTLE_BRIDGE_MAIN_HEAD_REPOSITORY, 'Cheekyfellastef/stephan-os');
  assert.equal(BATTLE_BRIDGE_MAIN_HEAD_ENDPOINT, 'repos/Cheekyfellastef/stephan-os/branches/main');

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-main-head-broker-'));
  let calls = 0;
  const spawnSyncFn = (_command, args) => {
    calls += 1;
    assert.deepEqual(args, ['api', BATTLE_BRIDGE_MAIN_HEAD_ENDPOINT]);
    return {
      status: 0,
      stdout: JSON.stringify({ commit: { sha: HEAD } }),
      stderr: '',
    };
  };

  try {
    const first = readBattleBridgeBrokeredMainHead({
      workspaceRoot,
      ghCommand: 'gh-test',
      spawnSyncFn,
      nowMs: Date.parse('2026-09-28T17:00:00.000Z'),
    });
    const second = readBattleBridgeBrokeredMainHead({
      workspaceRoot,
      ghCommand: 'gh-test',
      spawnSyncFn,
      nowMs: Date.parse('2026-09-28T17:00:30.000Z'),
    });

    assert.equal(first.ok, true);
    assert.equal(first.sha, HEAD);
    assert.equal(first.observationSource, 'UPSTREAM_REFRESH');
    assert.equal(second.ok, true);
    assert.equal(second.sha, HEAD);
    assert.equal(second.observationSource, 'SHARED_CACHE');
    assert.equal(second.arbitraryEndpointAllowed, false);
    assert.equal(second.mutationAllowed, false);
    assert.equal(calls, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('invalid branch-head payload fails closed', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-main-head-invalid-'));
  try {
    const result = readBattleBridgeBrokeredMainHead({
      workspaceRoot,
      ghCommand: 'gh-test',
      spawnSyncFn: () => ({ status: 0, stdout: JSON.stringify({ commit: { sha: 'not-a-sha' } }), stderr: '' }),
      nowMs: Date.parse('2026-09-28T17:00:00.000Z'),
    });
    assert.equal(result.ok, false);
    assert.equal(result.sha, '');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
