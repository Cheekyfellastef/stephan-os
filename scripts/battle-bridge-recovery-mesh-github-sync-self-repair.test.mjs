import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runBattleBridgeRecoveryMesh } from './battle-bridge-recovery-mesh.mjs';

const HEAD = '6bafa9bdd4b62fc46821157bb4546229ad0680c7';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'battle-bridge-recovery-sync-heal-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(path.join(repoRoot, 'scripts', 'windows'), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const paths = {
    repoRoot,
    workspaceRoot,
    probeScriptPath: path.join(repoRoot, 'scripts', 'windows', 'probe-battle-bridge-recovery-mesh.ps1'),
    ingressRoot: path.join(workspaceRoot, 'requests', 'battle-bridge-recovery'),
    statePath: path.join(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-state.json'),
    statusPath: path.join(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-current.json'),
    lockPath: path.join(workspaceRoot, 'locks', 'battle-bridge-recovery-mesh.lock'),
  };
  await writeFile(paths.probeScriptPath, '# fixed probe\n');
  return paths;
}

function healthyProbe() {
  return {
    sourceHead: HEAD,
    branch: 'main',
    worker: { healthy: true },
    mailbox: { healthy: true },
    backend: { healthy: true },
    openclawGateway: { healthy: true },
  };
}

test('recovery mesh supervises GitHub Sync only after publication and recovery lease release', async () => {
  const paths = await fixture();
  const calls = [];
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-07T12:50:00.000Z'),
    platform: 'win32',
    probeAdapter: { run(mode) { assert.equal(mode, 'Inspect'); return { ok: true, data: healthyProbe() }; } },
    sourceHeadReader: () => HEAD,
    githubSyncSelfRepairFn(input) {
      calls.push(input);
      assert.equal(existsSync(paths.statusPath), true, 'mesh status must be published before sync wake');
      const state = JSON.parse(readFileSync(paths.statePath, 'utf8'));
      assert.equal(state.activeLease, null, 'recovery lease must be released before sync wake');
      return {
        ok: true,
        blocker: '',
        sourceHead: HEAD,
        codexRequired: false,
        mutationPerformed: true,
        finalVerdict: 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_REPAIRED',
      };
    },
    recoveryProbeDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.acceptsRuntimeWork, true);
  assert.equal(result.githubSyncSelfRepair.finalVerdict, 'BATTLE_BRIDGE_GITHUB_SYNC_TASK_REPAIRED');
  assert.equal(result.githubSyncSelfRepair.codexRequired, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].repoRoot, paths.repoRoot);
  assert.equal(calls[0].expectedHead, HEAD);
  assert.equal(calls[0].platform, 'win32');
});

test('GitHub Sync self-repair failure blocks runtime acceptance without inventing a new recovery lane', async () => {
  const paths = await fixture();
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-07T12:51:00.000Z'),
    platform: 'win32',
    probeAdapter: { run() { return { ok: true, data: healthyProbe() }; } },
    sourceHeadReader: () => HEAD,
    githubSyncSelfRepairFn() {
      return {
        ok: false,
        blocker: 'GITHUB_SYNC_SELF_REPAIR_FIXED_INSTALLER_FAILED',
        codexRequired: false,
        mutationPerformed: false,
      };
    },
    recoveryProbeDelayMs: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.acceptsRuntimeWork, false);
  assert.equal(result.classification, 'GITHUB_SYNC_SELF_REPAIR_FIXED_INSTALLER_FAILED');
  assert.equal(result.githubSyncSelfRepair.codexRequired, false);
  assert.equal(result.decision.oneExecutorEnforced, true);
  assert.equal(result.decision.duplicateWorkerAllowed, false);
});
