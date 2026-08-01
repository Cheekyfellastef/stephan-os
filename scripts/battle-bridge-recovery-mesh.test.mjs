import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BATTLE_BRIDGE_RECOVERY_MESH_TASK,
  buildLocalSupervisorIngress,
  createFixedRecoveryMeshProbeAdapter,
  readRecoveryMeshIngressFiles,
  runBattleBridgeRecoveryMesh,
} from './battle-bridge-recovery-mesh.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'battle-bridge-recovery-mesh-'));
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

function probeData(healthy) {
  return {
    sourceHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
    branch: 'main',
    worker: { healthy },
    mailbox: { healthy },
    backend: { healthy },
    openclawGateway: { healthy },
  };
}

test('runner recovers once, re-probes, publishes and keeps one executor', async () => {
  const paths = await fixture();
  const modes = [];
  const probeAdapter = {
    run(mode) {
      modes.push(mode);
      return { ok: true, data: mode === 'Inspect' && modes.length === 1 ? probeData(false) : probeData(true) };
    },
  };
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-01T03:00:00.000Z'),
    probeAdapter,
    ingressRequests: [{
      schemaVersion: 'stephanos.battle-bridge-recovery-ingress.v1',
      requestId: 'recovery-github-0001',
      route: 'GITHUB_MAILBOX',
      action: 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER',
      issuedAtUtc: '2026-08-01T02:59:00.000Z',
      expiresAtUtc: '2026-08-01T03:05:00.000Z',
      sourceReceipt: 'github-issue-1507/recovery-github-0001',
      ownerAuthenticated: true,
    }],
    recoveryProbeDelayMs: 0,
    maximumRecoveryProbes: 1,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(modes, ['Inspect', 'Recover', 'Inspect']);
  assert.equal(result.recoveryAttempted, true);
  assert.equal(result.acceptsRuntimeWork, true);
  assert.equal(result.decision.lease.maximumConcurrentExecutors, 1);
  assert.equal(result.bulletproofAcceptanceClaimed, false);
  const status = JSON.parse(await readFile(paths.statusPath, 'utf8'));
  assert.equal(status.classification, 'RECOVERY_MESH_ALL_SERVICES_HEALTHY');
  assert.equal(status.duplicateWorkerAllowed, false);
  const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
  assert.equal(state.activeLease, null);
  assert.ok(state.consumedIdempotencyKeys.includes('GITHUB_MAILBOX:recovery-github-0001'));
});

test('live lock blocks overlapping coordinator before any task recovery', async () => {
  const paths = await fixture();
  await mkdir(path.dirname(paths.lockPath), { recursive: true });
  await writeFile(paths.lockPath, JSON.stringify({ pid: process.pid, acquiredAtUtc: new Date().toISOString() }));
  let calls = 0;
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    probeAdapter: { run() { calls += 1; return { ok: true, data: probeData(true) }; } },
  });
  assert.equal(result.classification, 'RECOVERY_MESH_ALREADY_RUNNING');
  assert.equal(calls, 0);
});

test('ingress reader rejects symlinks and hard links without reading their targets', async () => {
  const paths = await fixture();
  await mkdir(paths.ingressRoot, { recursive: true });
  const victim = path.join(paths.workspaceRoot, 'victim.json');
  await writeFile(victim, JSON.stringify(buildLocalSupervisorIngress(new Date('2026-08-01T03:00:00.000Z'))));
  await symlink(victim, path.join(paths.ingressRoot, 'tailscale_control.json'));
  await link(victim, path.join(paths.ingressRoot, 'openclaw_whatsapp.json'));
  const result = await readRecoveryMeshIngressFiles(paths);
  assert.equal(result.requests.length, 0);
  assert.deepEqual(result.rejected.map((item) => item.blocker), ['RECOVERY_INGRESS_FILE_UNSAFE', 'RECOVERY_INGRESS_FILE_UNSAFE']);
  assert.match(await readFile(victim, 'utf8'), /LOCAL_WINDOWS_SUPERVISOR/);
});

test('fixed probe adapter accepts only Inspect or Recover and never uses a shell', () => {
  const calls = [];
  const adapter = createFixedRecoveryMeshProbeAdapter({
    probeScriptPath: 'C:\\fixed\\probe.ps1',
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0, stdout: JSON.stringify(probeData(true)) };
    },
  });
  assert.equal(adapter.run('Inspect').ok, true);
  assert.equal(adapter.run('Recover').ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.shell === false && call.options.windowsHide === true));
  assert.throws(() => adapter.run('Start-ArbitraryTask'), /Unsupported/);
});

test('task identity remains the single canonical recovery coordinator', () => {
  assert.equal(BATTLE_BRIDGE_RECOVERY_MESH_TASK, 'Stephanos Battle Bridge Recovery Mesh');
});
