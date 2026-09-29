import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runStephanosNativeCapacityPublisherSourceGate,
  summarizeNativePublisherDirt,
} from './stephanos-native-capacity-publisher-source-gate.mjs';

const HEAD = 'a'.repeat(40);

function fixedSpawn(statusOutput = '') {
  const calls = [];
  const spawn = (_executable, args) => {
    calls.push([...args]);
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: statusOutput, stderr: '' };
    throw new Error(`unexpected git invocation: ${args.join(' ')}`);
  };
  spawn.calls = calls;
  return spawn;
}

test('runtime-only tracked memory and untracked logs pass the canonical dirt policy', () => {
  const summary = summarizeNativePublisherDirt([
    ' M stephanos-server/data/memory/durable-memory.json',
    '?? logs/native-capacity-runtime.json',
  ]);
  assert.deepEqual(summary, {
    trackedSourceCount: 0,
    untrackedSourceCount: 0,
    runtimeOnlyCount: 2,
    generatedSourceCount: 0,
    unknownCount: 0,
    blocksSync: false,
  });
});

test('real source dirt remains blocking', () => {
  const summary = summarizeNativePublisherDirt([
    ' M shared/agents/missionWorker.mjs',
    '?? shared/agents/new-source.mjs',
  ]);
  assert.equal(summary.blocksSync, true);
  assert.equal(summary.trackedSourceCount, 1);
  assert.equal(summary.untrackedSourceCount, 1);
});

test('live source gate uses exact main, exact head and untracked-aware status before passing', () => {
  const spawnSyncFn = fixedSpawn(' M stephanos-server/data/memory/durable-memory.json\n?? logs/native-capacity-runtime.json\n');
  const result = runStephanosNativeCapacityPublisherSourceGate({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.dirtSummary.blocksSync, false);
  assert.equal(result.exitCode, 0);
  const statusCall = spawnSyncFn.calls.find((args) => args.includes('status'));
  assert.ok(statusCall.includes('--untracked-files=all'));
});

test('live source gate exits fail-closed before publisher launch when source dirt is real', () => {
  const spawnSyncFn = fixedSpawn(' M shared/agents/missionWorker.mjs\n');
  const result = runStephanosNativeCapacityPublisherSourceGate({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOURCE_DIRT_BLOCKED');
  assert.equal(result.exitCode, 75);
});
