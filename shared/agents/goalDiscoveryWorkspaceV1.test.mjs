import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveGoalDiscoveryWorkspaceV1 } from './goalDiscoveryWorkspaceV1.mjs';
import { readGoalBuilderWorkerHeartbeatAgeMs } from '../../scripts/sovereign-commander-goal-builder-repair.mjs';

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

test('live repair cannot honor an override unsupported by canonical Windows publishers', () => {
  const configured = resolve(tmpdir(), 'worker-custody-configured');
  const env = { USERPROFILE: resolve(tmpdir(), 'worker-custody-home'), STEPHANOS_SHARED_AGENT_WORKSPACE: configured };
  assert.equal(readGoalBuilderWorkerHeartbeatAgeMs({ env,
    readSourceIdentity() { assert.fail('unsupported workspace cannot reach evidence admission'); } }), null);
});
