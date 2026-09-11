import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runFreshIgnition,
  runIgnitionWithSync,
} from './run-battle-bridge-ignition-with-sync.mjs';

const HEAD = 'a'.repeat(40);

test('ignition waits for canonical fast-forward preflight and launches a fresh ignition process', async () => {
  const calls = [];
  const result = await runIgnitionWithSync({
    argv: ['--example-safe-flag'],
    sourceUpdateFn: async () => ({
      sourceUpdateProof: { localHeadBefore: HEAD, localHeadAfter: HEAD },
    }),
    ignitionFn: ({ argv }) => {
      calls.push(argv);
      return { ok: true, status: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.ignitionStarted, true);
  assert.equal(result.sourceUpdated, false);
  assert.deepEqual(calls, [['--example-safe-flag']]);
});

test('safe fast-forward refresh completes before fresh ignition begins', async () => {
  const sequence = [];
  const result = await runIgnitionWithSync({
    sourceUpdateFn: async () => {
      sequence.push('fast-forward-preflight');
      return {
        sourceUpdateProof: { localHeadBefore: 'b'.repeat(40), localHeadAfter: HEAD },
      };
    },
    ignitionFn: () => {
      sequence.push('fresh-ignition');
      return { ok: true, status: 0 };
    },
  });

  assert.deepEqual(sequence, ['fast-forward-preflight', 'fresh-ignition']);
  assert.equal(result.sourceUpdated, true);
});

test('dirty, divergent, or failed source update blocks before service mutation', async () => {
  let ignitionCalls = 0;
  const result = await runIgnitionWithSync({
    sourceUpdateFn: async () => { throw new Error('BLOCKED_DIRTY_SOURCE'); },
    ignitionFn: () => {
      ignitionCalls += 1;
      return { ok: true, status: 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BLOCKED_DIRTY_SOURCE');
  assert.equal(result.ignitionStarted, false);
  assert.equal(ignitionCalls, 0);
});

test('fresh ignition transport is fixed, shell-free, and forwards only argv tokens', () => {
  const calls = [];
  const result = runFreshIgnition({
    argv: ['--approve-openclaw-service-restart'],
    spawnSyncFn(command, argv, options) {
      calls.push({ command, argv, options });
      return { status: 0 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].argv[0], /run-battle-bridge-ignition\.mjs$/);
  assert.deepEqual(calls[0].argv.slice(1), ['--approve-openclaw-service-restart']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'inherit');
});
