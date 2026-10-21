import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGoalDiscoveryWorkspaceV1 } from './goalDiscoveryWorkspaceV1.mjs';
import { readGoalBuilderWorkerHeartbeatAgeMs, runSovereignCommanderGoalBuilderRepair } from '../../scripts/sovereign-commander-goal-builder-repair.mjs';

test('refill and custody use one workspace precedence and ignore unrelated legacy aliases', () => {
  const env = { USERPROFILE: resolve(tmpdir(), 'fixture-home'), STEPHANOS_SHARED_AGENT_WORKSPACE: resolve(tmpdir(), 'configured') };
  const paths = { workspaceRoot: resolve(tmpdir(), 'fallback') };
  const builderOptions = { sharedWorkspaceRoot: resolve(tmpdir(), 'explicit'), env: { STEPHANOS_SHARED_AGENT_WORKSPACE: resolve(tmpdir(), 'builder-env') } };
  assert.equal(resolveGoalDiscoveryWorkspaceV1({ builderOptions, env, paths }), builderOptions.sharedWorkspaceRoot);
  delete builderOptions.sharedWorkspaceRoot;
  assert.equal(resolveGoalDiscoveryWorkspaceV1({ builderOptions, env, paths }), builderOptions.env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  assert.equal(resolveGoalDiscoveryWorkspaceV1({ env, paths }), env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  delete env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  assert.equal(resolveGoalDiscoveryWorkspaceV1({ env, paths }), paths.workspaceRoot);
  env.STEPHANOS_OPENCLAW_WORKSPACE = resolve(tmpdir(), 'different-legacy-workspace');
  assert.equal(resolveGoalDiscoveryWorkspaceV1({ env }), join(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace'));
});

test('fresh default heartbeat cannot admit stale configured workspace and fresh configured evidence is usable', () => {
  const configured = resolve(tmpdir(), 'worker-custody-configured');
  const env = { USERPROFILE: resolve(tmpdir(), 'worker-custody-home'), STEPHANOS_SHARED_AGENT_WORKSPACE: configured };
  const heartbeat = join(resolveGoalDiscoveryWorkspaceV1({ env }), 'status', 'mission-orchestrator-worker-heartbeat.json');
  for (const fresh of [false, true]) {
    const seen = [], calls = [];
    const result = runSovereignCommanderGoalBuilderRepair({
      readWorkerHeartbeatAgeMs: () => readGoalBuilderWorkerHeartbeatAgeMs({ env, nowMs: 1_000_000,
        statFn(path) { seen.push(path); assert.equal(path, heartbeat); return { mtimeMs: fresh ? 1_000_000 : 0 }; } }),
      runStep(step) { calls.push(step.id); return { ok: true, status: 0 }; },
    });
    assert.deepEqual(seen, [heartbeat]);
    assert.equal(calls.includes('goal-discovery-heartbeat'), fresh);
    assert.equal(calls.includes('start-mission-orchestrator-worker'), false);
    if (!fresh) { assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN'); assert.equal(result.repairApplied, false); }
  }
});
