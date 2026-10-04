import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectStephanosCoreDaemonState,
  shouldReloadStephanosCoreDaemon,
} from './stephanosCoreDaemonV1.mjs';

const HEAD = 'a'.repeat(40);

test('core daemon is a coordinator, not a second authority plane', () => {
  const state = projectStephanosCoreDaemonState({
    sourceHead: HEAD,
    sovereignCommanderHealthy: true,
    backendHealthy: true,
    missionWorkerHeartbeatAgeMs: 10_000,
    gamingActive: false,
  });
  assert.equal(state.readiness, 'READY');
  assert.equal(state.daemonHealthy, true);
  assert.equal(state.uiRequired, false);
  assert.equal(state.sourceMutationAllowed, false);
  assert.equal(state.mergeAuthority, false);
  assert.equal(state.schedulerAuthority, false);
  assert.equal(state.leaseAuthority, false);
  assert.equal(state.canonicalMissionWorkerOnly, true);
  assert.equal(state.sovereignCommanderIsMachineExecutor, true);
  assert.equal(state.duplicateControllerFabricAllowed, false);
});

test('UI/backend loss degrades observed stack without killing the core', () => {
  const state = projectStephanosCoreDaemonState({
    sourceHead: HEAD,
    sovereignCommanderHealthy: true,
    backendHealthy: false,
    missionWorkerHeartbeatAgeMs: 10_000,
    gamingActive: true,
  });
  assert.equal(state.daemonHealthy, true);
  assert.equal(state.readiness, 'DEGRADED');
  assert.equal(state.computePosture, 'GAMING_PROTECTED');
});

test('core daemon deliberately reloads when canonical source head advances', () => {
  assert.equal(shouldReloadStephanosCoreDaemon(HEAD, HEAD), false);
  assert.equal(shouldReloadStephanosCoreDaemon(HEAD, 'b'.repeat(40)), true);
  assert.equal(shouldReloadStephanosCoreDaemon('', HEAD), true);
});
