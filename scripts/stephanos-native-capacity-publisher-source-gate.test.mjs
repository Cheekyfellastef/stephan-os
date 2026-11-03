import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runStephanosNativeCapacityPublisherSourceGate,
  summarizeNativePublisherDirt,
} from './stephanos-native-capacity-publisher-source-gate.mjs';

import { inspectStephanosNativeCapacitySourceIdentity } from './stephanos-native-capacity-publisher.mjs';

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

test('signed native publisher accepts generated dist and runtime logs without losing capacity', () => {
  const spawnSyncFn = fixedSpawn(' M apps/stephanos/dist/index.html\n?? logs/native-runtime.json\n');
  const result = inspectStephanosNativeCapacitySourceIdentity({
    env: { USERPROFILE: 'C:\\Users\\Operator', STEPHANOS_GIT_EXECUTABLE: 'git' },
    spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.branch, 'main');
  assert.ok(spawnSyncFn.calls.find((args) => args.includes('status')).includes('--untracked-files=all'));
});

test('signed native publisher rejects both tracked and untracked source changes', () => {
  for (const dirt of [
    ' M scripts/stephanos-native-capacity-publisher.mjs\n',
    '?? shared/agents/unreviewed-source.mjs\n',
  ]) {
    const result = inspectStephanosNativeCapacitySourceIdentity({
      env: { USERPROFILE: 'C:\\Users\\Operator', STEPHANOS_GIT_EXECUTABLE: 'git' },
      spawnSyncFn: fixedSpawn(dirt),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'native-capacity-source-dirty');
  }
});

test('signed native publisher retains exact pinned-head and main-only safety', () => {
  const env = { USERPROFILE: 'C:\\Users\\Operator', STEPHANOS_GIT_EXECUTABLE: 'git' };
  const mismatch = inspectStephanosNativeCapacitySourceIdentity({
    env: { ...env, STEPHANOS_MISSION_WORKER_HEAD_SHA: 'b'.repeat(40) },
    spawnSyncFn: fixedSpawn(''),
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'native-capacity-launch-head-mismatch');

  const regular = fixedSpawn('');
  const nonMain = inspectStephanosNativeCapacitySourceIdentity({
    env,
    spawnSyncFn: (executable, args, options) => args.includes('branch')
      ? { status: 0, stdout: 'repair\n', stderr: '' }
      : regular(executable, args, options),
  });
  assert.equal(nonMain.ok, false);
  assert.equal(nonMain.reason, 'native-capacity-source-not-main');
});
