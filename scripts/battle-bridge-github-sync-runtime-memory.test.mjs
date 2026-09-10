import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyDirt,
  evaluateSyncPolicy,
  SYNC_CLASSIFICATIONS,
} from './battle-bridge-github-sync-policy.mjs';

const HEAD = 'a'.repeat(40);
const baseFacts = Object.freeze({
  currentBranch: 'main',
  originUrl: 'https://github.com/Cheekyfellastef/stephan-os.git',
  localHead: HEAD,
  remoteHead: HEAD,
  mergeBase: HEAD,
  fetchOk: true,
});

const runtimeMemoryPath = 'stephanos-server/data/memory/durable-memory.json';

test('only an unstaged modification of canonical durable memory is runtime-only', () => {
  const accepted = classifyDirt([` M ${runtimeMemoryPath}`]);
  assert.deepEqual(accepted.runtimeOnly, [runtimeMemoryPath]);
  assert.equal(accepted.blocksSync, false);
  assert.equal(
    evaluateSyncPolicy({ ...baseFacts, statusLines: [` M ${runtimeMemoryPath}`] }).classification,
    SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE,
  );

  for (const status of ['M ', 'MM', ' D', 'D ', 'A ', 'R ', '??']) {
    const dirt = classifyDirt([`${status} ${runtimeMemoryPath}`]);
    assert.equal(dirt.blocksSync, true, `status ${JSON.stringify(status)} must remain blocking`);
    assert.equal(dirt.runtimeOnly.length, 0);
    assert.equal(
      evaluateSyncPolicy({ ...baseFacts, statusLines: [`${status} ${runtimeMemoryPath}`] }).classification,
      SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE,
    );
  }
});

test('nearby memory paths remain source dirt', () => {
  const path = 'stephanos-server/data/memory/other.json';
  const dirt = classifyDirt([` M ${path}`]);
  assert.deepEqual(dirt.trackedSource, [path]);
  assert.equal(dirt.blocksSync, true);
});
