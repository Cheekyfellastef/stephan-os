import test from 'node:test';
import assert from 'node:assert/strict';
import { createIgnitionPlan, runIgnitionPlan } from './ignite-stephanos-local-lib.mjs';

test('ignition plan requires rebuild for all known build states', () => {
  for (const state of ['build-missing', 'build-stale', 'build-unverifiable', 'build-current']) {
    const plan = createIgnitionPlan({ state, action: 'rebuild' });
    assert.equal(plan.needsRebuild, true);
    assert.equal(plan.runVerify, true);
  }
});

test('ignition plan enforces rebuild even when preflight says build-current', () => {
  const plan = createIgnitionPlan({ state: 'build-current', action: 'skip-build' });
  assert.equal(plan.needsRebuild, true);
  assert.equal(plan.runVerify, true);
});

test('failed build blocks verify and serve', async () => {
  const calls = [];
  await assert.rejects(() => runIgnitionPlan({
    preflightState: { decision: { state: 'build-stale', action: 'rebuild' } },
    runBuild: async () => {
      calls.push('build');
      throw new Error('build failed');
    },
    runVerify: async () => {
      calls.push('verify');
    },
    runServe: async () => {
      calls.push('serve');
    },
  }));

  assert.deepEqual(calls, ['build']);
});

test('failed verify blocks serve after successful build', async () => {
  const calls = [];
  await assert.rejects(() => runIgnitionPlan({
    preflightState: { decision: { state: 'build-current', action: 'skip-build' } },
    runBuild: async () => {
      calls.push('build');
    },
    runVerify: async () => {
      calls.push('verify');
      throw new Error('verify failed');
    },
    runServe: async () => {
      calls.push('serve');
    },
  }));

  assert.deepEqual(calls, ['build', 'verify']);
});

test('current build still runs build then verify then serve', async () => {
  const calls = [];
  await runIgnitionPlan({
    preflightState: { decision: { state: 'build-current', action: 'skip-build' } },
    runBuild: async () => {
      calls.push('build');
    },
    runVerify: async () => {
      calls.push('verify');
    },
    runServe: async () => {
      calls.push('serve');
    },
  });

  assert.deepEqual(calls, ['build', 'verify', 'serve']);
});

test('stale build runs build then verify then serve', async () => {
  const calls = [];
  await runIgnitionPlan({
    preflightState: { decision: { state: 'build-stale', action: 'rebuild' } },
    runBuild: async () => {
      calls.push('build');
    },
    runVerify: async () => {
      calls.push('verify');
    },
    runServe: async () => {
      calls.push('serve');
    },
  });

  assert.deepEqual(calls, ['build', 'verify', 'serve']);
});
