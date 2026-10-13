import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  coreGamingProtectionFromGovernor,
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

test('Core gaming posture uses canonical VR governor state and never admits unknown local work', async () => {
  const normal = {
    schemaVersion: 'stephanos.vr-resource-governor.v1',
    active: false, phase: 'NORMAL',
  };
  assert.equal(coreGamingProtectionFromGovernor(normal), false);
  for (const state of [
    null, {}, { ...normal, active: 'false' },
    { ...normal, schemaVersion: 'other' },
    { ...normal, active: true, phase: 'GAMING' },
    { ...normal, active: true, phase: 'COOLDOWN' },
    { ...normal, active: false, phase: 'GAMING' },
  ]) assert.equal(coreGamingProtectionFromGovernor(state), true);
  const source = await readFile(new URL('../../scripts/stephanos-core-daemon.mjs', import.meta.url), 'utf8');
  assert.match(source, /gamingStatePath = resolve\(workspaceRoot, 'vr', 'vr-resource-governor-current\.json'\)/);
  assert.match(source, /coreGamingProtectionFromGovernor\(JSON\.parse\(await readFile\(gamingStatePath, 'utf8'\)\)\)/);
  assert.match(source, /No authoritative gaming truth means no new local CPU\/GPU-intensive work/);
  assert.doesNotMatch(source, /resolve\(workspaceRoot, 'status', 'vr-resource-governor-current\.json'\)/);
});
