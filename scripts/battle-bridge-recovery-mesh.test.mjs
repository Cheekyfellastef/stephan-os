import test from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BATTLE_BRIDGE_RECOVERY_MESH_TASK,
  BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE,
  buildLocalSupervisorIngress,
  createFixedRecoveryMeshProbeAdapter,
  createFixedRecoveryMeshMutexVerifier,
  readRecoveryMeshIngressFiles,
  runBattleBridgeRecoveryMesh,
  verifyRecoveryMeshAuthenticationEvidence,
} from './battle-bridge-recovery-mesh.mjs';
import { validateBattleBridgeRecoveryIngress } from '../shared/agents/battleBridgeRecoveryMeshV1.mjs';

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

async function createGitHubAuthorityFixture(paths, suffix = 'dispatch-head-race') {
  const mailboxRequestId = `req-1507-${suffix}`;
  const requestId = `recovery-${suffix}`;
  const mailboxRef = `receipts/github-command-mailbox/${mailboxRequestId}.json`;
  const authRef = `receipts/battle-bridge-recovery-auth/${requestId}.json`;
  const authorityHead = '6bafa9bdd4b62fc46821157bb4546229ad0680c7';
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...mailboxRef.split('/'))), { recursive: true });
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...authRef.split('/'))), { recursive: true });
  await writeFile(path.join(paths.workspaceRoot, ...mailboxRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: mailboxRequestId,
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    state: 'ACCEPTED',
    acceptedAt: '2026-08-01T02:59:30.000Z',
    expectedHead: authorityHead,
  }));
  await writeFile(path.join(paths.workspaceRoot, ...authRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-auth-receipt.v1',
    requestId,
    route: 'GITHUB_MAILBOX',
    issuer: 'battle-bridge-github-command-mailbox',
    subject: mailboxRequestId,
    upstreamProofRef: mailboxRef,
    issuedAtUtc: '2026-08-01T02:59:30.000Z',
    expiresAtUtc: '2026-08-01T03:04:30.000Z',
    verifiedByFixedAdapter: true,
    authorityHead,
  }));
  return {
    authorityHead,
    request: {
      schemaVersion: 'stephanos.battle-bridge-recovery-ingress.v1',
      requestId,
      route: 'GITHUB_MAILBOX',
      action: 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER',
      issuedAtUtc: '2026-08-01T02:59:30.000Z',
      expiresAtUtc: '2026-08-01T03:04:30.000Z',
      sourceReceipt: mailboxRef,
      authenticationEvidence: {
        schemaVersion: 'stephanos.battle-bridge-recovery-auth-evidence.v1',
        route: 'GITHUB_MAILBOX',
        issuer: 'battle-bridge-github-command-mailbox',
        subject: mailboxRequestId,
        proofRef: authRef,
        verified: true,
      },
    },
  };
}

test('runner recovers once, re-probes, publishes and keeps one executor', async () => {
  const paths = await fixture();
  const mailboxRef = 'receipts/github-command-mailbox/recovery-github-0001.json';
  const authRef = 'receipts/battle-bridge-recovery-auth/recovery-github-0001.json';
  await mkdir(path.join(paths.workspaceRoot, 'receipts', 'github-command-mailbox'), { recursive: true });
  await mkdir(path.join(paths.workspaceRoot, 'receipts', 'battle-bridge-recovery-auth'), { recursive: true });
  await writeFile(path.join(paths.workspaceRoot, ...mailboxRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-recovery-github-0001',
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    state: 'ACCEPTED',
    acceptedAt: '2026-08-01T02:59:30.000Z',
    expectedHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
  }));
  await writeFile(path.join(paths.workspaceRoot, ...authRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-auth-receipt.v1',
    requestId: 'recovery-github-0001',
    route: 'GITHUB_MAILBOX',
    issuer: 'battle-bridge-github-command-mailbox',
    subject: 'req-1507-recovery-github-0001',
    upstreamProofRef: mailboxRef,
    issuedAtUtc: '2026-08-01T02:59:00.000Z',
    expiresAtUtc: '2026-08-01T03:04:00.000Z',
    verifiedByFixedAdapter: true,
    authorityHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
  }));
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
      sourceReceipt: mailboxRef,
      authenticationEvidence: {
        schemaVersion: 'stephanos.battle-bridge-recovery-auth-evidence.v1',
        route: 'GITHUB_MAILBOX',
        issuer: 'battle-bridge-github-command-mailbox',
        subject: 'req-1507-recovery-github-0001',
        proofRef: authRef,
        verified: true,
      },
    }],
    recoveryProbeDelayMs: 0,
    maximumRecoveryProbes: 1,
    sourceHeadReader: (() => {
      const heads = [
        '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
        '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
      ];
      return () => heads.shift() || '';
    })(),
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
  assert.equal(status.acceptedRouteEvidence[0].authenticationEvidence.issuer, 'battle-bridge-github-command-mailbox');
  assert.equal(status.acceptedRouteEvidence[0].sourceReceipt, mailboxRef);
  assert.equal(status.acceptedRouteEvidence[0].consumerVerification.consumerVerified, true);
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

test('stale lock is never unlinked by an un-serialized Node contender', async () => {
  const paths = await fixture();
  await mkdir(path.dirname(paths.lockPath), { recursive: true });
  const stale = { pid: 999999, token: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', acquiredAtUtc: '2026-08-01T02:00:00.000Z' };
  await writeFile(paths.lockPath, JSON.stringify(stale));
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-01T03:00:00.000Z'),
    processIsAliveFn: () => false,
    probeAdapter: { run() { throw new Error('probe must not run'); } },
  });
  assert.equal(result.classification, 'RECOVERY_MESH_STALE_LOCK_REQUIRES_SERIAL_RECLAIM');
  assert.deepEqual(JSON.parse(await readFile(paths.lockPath, 'utf8')), stale);
});

test('malformed durable state ledger blocks replay instead of resetting authority', async () => {
  const paths = await fixture();
  await mkdir(path.dirname(paths.statePath), { recursive: true });
  await writeFile(paths.statePath, '{"activeLease":');
  let calls = 0;
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    probeAdapter: { run() { calls += 1; return { ok: true, data: probeData(true) }; } },
  });
  assert.equal(result.classification, 'RECOVERY_MESH_AUTHORITY_FILE_READ_FAILED');
  assert.equal(calls, 0);
});

test('semantically invalid persisted lease timestamps block dispatch', async () => {
  const paths = await fixture();
  await mkdir(path.dirname(paths.statePath), { recursive: true });
  await writeFile(paths.statePath, JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-mesh-runner.v1',
    consumedIdempotencyKeys: [],
    activeLease: {
      schemaVersion: 'stephanos.battle-bridge-recovery-mesh.v1',
      leaseId: 'recovery-mesh:recovery-invalid-lease',
      requestId: 'recovery-invalid-lease',
      route: 'GITHUB_MAILBOX',
      executor: 'Stephanos Battle Bridge Recovery Mesh',
      acquiredAtUtc: '2026-08-01T02:59:00.000Z',
      expiresAtUtc: 'not-a-date',
      maximumConcurrentExecutors: 1,
    },
  }));
  let calls = 0;
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    probeAdapter: { run() { calls += 1; return { ok: true, data: probeData(true) }; } },
  });
  assert.equal(result.classification, 'RECOVERY_MESH_STATE_LEDGER_INVALID');
  assert.equal(calls, 0);
});

test('stale or head-unbound GitHub authority receipts are rejected', async () => {
  const paths = await fixture();
  const mailboxRef = 'receipts/github-command-mailbox/recovery-github-stale.json';
  const authRef = 'receipts/battle-bridge-recovery-auth/recovery-github-stale.json';
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...mailboxRef.split('/'))), { recursive: true });
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...authRef.split('/'))), { recursive: true });
  await writeFile(path.join(paths.workspaceRoot, ...mailboxRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', requestId: 'req-1507-stale',
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH', repository: 'Cheekyfellastef/stephan-os', issueNumber: 1507,
    state: 'ACCEPTED', acceptedAt: '2026-08-01T02:30:00.000Z', expectedHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
  }));
  await writeFile(path.join(paths.workspaceRoot, ...authRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-auth-receipt.v1', requestId: 'recovery-github-stale', route: 'GITHUB_MAILBOX',
    issuer: 'battle-bridge-github-command-mailbox', subject: 'req-1507-stale', upstreamProofRef: mailboxRef,
    authorityHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7', issuedAtUtc: '2026-08-01T02:59:00.000Z',
    expiresAtUtc: '2026-08-01T03:04:00.000Z', verifiedByFixedAdapter: true,
  }));
  const result = await runBattleBridgeRecoveryMesh({ paths, expectedPaths: paths, now: new Date('2026-08-01T03:00:00.000Z'),
    ingressRequests: [{ schemaVersion: 'stephanos.battle-bridge-recovery-ingress.v1', requestId: 'recovery-github-stale', route: 'GITHUB_MAILBOX',
      action: 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER', issuedAtUtc: '2026-08-01T02:59:00.000Z', expiresAtUtc: '2026-08-01T03:04:00.000Z', sourceReceipt: mailboxRef,
      authenticationEvidence: { schemaVersion: 'stephanos.battle-bridge-recovery-auth-evidence.v1', route: 'GITHUB_MAILBOX', issuer: 'battle-bridge-github-command-mailbox', subject: 'req-1507-stale', proofRef: authRef, verified: true } }],
    probeAdapter: { run() { return { ok: true, data: probeData(true) }; } } });
  assert.equal(result.decision.selected.route, 'LOCAL_WINDOWS_SUPERVISOR');
  assert.ok(result.decision.rejected.some((item) => item.blocker === 'RECOVERY_MESH_GITHUB_AUTH_RECEIPT_INVALID'));
});

test('consumer rereads live checkout head before accepting GitHub authority', async () => {
  const paths = await fixture();
  const mailboxRef = 'receipts/github-command-mailbox/req-1507-head-race.json';
  const authRef = 'receipts/battle-bridge-recovery-auth/recovery-head-race.json';
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...mailboxRef.split('/'))), { recursive: true });
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...authRef.split('/'))), { recursive: true });
  await writeFile(path.join(paths.workspaceRoot, ...mailboxRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', requestId: 'req-1507-head-race',
    operation: 'WAKE_BATTLE_BRIDGE_RECOVERY_MESH', repository: 'Cheekyfellastef/stephan-os', issueNumber: 1507,
    state: 'ACCEPTED', acceptedAt: '2026-08-01T02:59:30.000Z', expectedHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7',
  }));
  await writeFile(path.join(paths.workspaceRoot, ...authRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-auth-receipt.v1', requestId: 'recovery-head-race', route: 'GITHUB_MAILBOX',
    issuer: 'battle-bridge-github-command-mailbox', subject: 'req-1507-head-race', upstreamProofRef: mailboxRef,
    authorityHead: '6bafa9bdd4b62fc46821157bb4546229ad0680c7', issuedAtUtc: '2026-08-01T02:59:30.000Z',
    expiresAtUtc: '2026-08-01T03:04:30.000Z', verifiedByFixedAdapter: true,
  }));
  const request = validateBattleBridgeRecoveryIngress({
    schemaVersion: 'stephanos.battle-bridge-recovery-ingress.v1', requestId: 'recovery-head-race', route: 'GITHUB_MAILBOX',
    action: 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER', issuedAtUtc: '2026-08-01T02:59:30.000Z', expiresAtUtc: '2026-08-01T03:04:30.000Z',
    sourceReceipt: mailboxRef, authenticationEvidence: { schemaVersion: 'stephanos.battle-bridge-recovery-auth-evidence.v1', route: 'GITHUB_MAILBOX',
      issuer: 'battle-bridge-github-command-mailbox', subject: 'req-1507-head-race', proofRef: authRef, verified: true },
  }, { nowMs: Date.parse('2026-08-01T03:00:00.000Z') }).request;
  const result = await verifyRecoveryMeshAuthenticationEvidence(paths, [request], {
    now: new Date('2026-08-01T03:00:00.000Z'), sourceHeadReader: () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(result.blocker, 'RECOVERY_MESH_GITHUB_AUTH_RECEIPT_INVALID');
});

test('checkout drift after inspection blocks the actual recovery dispatch', async () => {
  const paths = await fixture();
  const { authorityHead, request } = await createGitHubAuthorityFixture(paths);
  const modes = [];
  let headReads = 0;
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-01T03:00:00.000Z'),
    ingressRequests: [request],
    sourceHeadReader: () => (++headReads === 1 ? authorityHead : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    probeAdapter: {
      run(mode) {
        modes.push(mode);
        return { ok: true, data: probeData(false) };
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification, 'RECOVERY_MESH_GITHUB_DISPATCH_HEAD_CHANGED');
  assert.equal(headReads, 2);
  assert.deepEqual(modes, ['Inspect']);
  assert.equal(result.dispatchHeadVerification.authorityHead, authorityHead);
  assert.equal(result.dispatchHeadVerification.liveSourceHead, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
});

test('forged external identity evidence is rejected without suppressing the local supervisor', async () => {
  const paths = await fixture();
  const authRef = 'receipts/battle-bridge-recovery-auth/recovery-forged-0001.json';
  await mkdir(path.dirname(path.join(paths.workspaceRoot, ...authRef.split('/'))), { recursive: true });
  await writeFile(path.join(paths.workspaceRoot, ...authRef.split('/')), JSON.stringify({
    schemaVersion: 'stephanos.battle-bridge-recovery-auth-receipt.v1',
    requestId: 'recovery-forged-0001',
    route: 'GITHUB_MAILBOX',
    issuer: 'battle-bridge-github-command-mailbox',
    subject: 'req-1507-forged-0001',
    upstreamProofRef: 'forged/local/assertion',
    issuedAtUtc: '2026-08-01T02:59:00.000Z',
    expiresAtUtc: '2026-08-01T03:04:00.000Z',
    verifiedByFixedAdapter: true,
  }));
  const result = await runBattleBridgeRecoveryMesh({
    paths,
    expectedPaths: paths,
    now: new Date('2026-08-01T03:00:00.000Z'),
    ingressRequests: [{
      schemaVersion: 'stephanos.battle-bridge-recovery-ingress.v1',
      requestId: 'recovery-forged-0001',
      route: 'GITHUB_MAILBOX',
      action: 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER',
      issuedAtUtc: '2026-08-01T02:59:00.000Z',
      expiresAtUtc: '2026-08-01T03:05:00.000Z',
      sourceReceipt: 'forged/local/assertion',
      authenticationEvidence: {
        schemaVersion: 'stephanos.battle-bridge-recovery-auth-evidence.v1',
        route: 'GITHUB_MAILBOX',
        issuer: 'battle-bridge-github-command-mailbox',
        subject: 'req-1507-forged-0001',
        proofRef: authRef,
        verified: true,
      },
    }],
    probeAdapter: { run() { return { ok: true, data: probeData(true) }; } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision.selected.route, 'LOCAL_WINDOWS_SUPERVISOR');
  assert.ok(result.decision.rejected.some((item) => item.requestId === 'recovery-forged-0001' && item.blocker === 'RECOVERY_MESH_GITHUB_AUTH_REF_INVALID'));
});

test('linked workspace ancestors are rejected before any status or lock write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'battle-bridge-recovery-linked-'));
  const repoRoot = path.join(root, 'repo');
  const victimRoot = path.join(root, 'victim');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(path.join(repoRoot, 'scripts', 'windows'), { recursive: true });
  await mkdir(victimRoot, { recursive: true });
  await writeFile(path.join(repoRoot, 'scripts', 'windows', 'probe-battle-bridge-recovery-mesh.ps1'), '# fixed probe\n');
  await symlink(victimRoot, workspaceRoot, 'dir');
  const paths = {
    repoRoot,
    workspaceRoot,
    probeScriptPath: path.join(repoRoot, 'scripts', 'windows', 'probe-battle-bridge-recovery-mesh.ps1'),
    ingressRoot: path.join(workspaceRoot, 'requests', 'battle-bridge-recovery'),
    statePath: path.join(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-state.json'),
    statusPath: path.join(workspaceRoot, 'status', 'battle-bridge-recovery-mesh-current.json'),
    lockPath: path.join(workspaceRoot, 'locks', 'battle-bridge-recovery-mesh.lock'),
  };
  const result = await runBattleBridgeRecoveryMesh({ paths, expectedPaths: paths });
  assert.equal(result.classification, 'RECOVERY_MESH_LINKED_ANCESTOR_REJECTED');
  await assert.rejects(readFile(path.join(victimRoot, 'status', 'battle-bridge-recovery-mesh-current.json')), /ENOENT/);
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
  assert.ok(calls.every((call) => call.executable === BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE));
  assert.ok(calls.every((call) => call.options.shell === false && call.options.windowsHide === true));
  assert.throws(() => adapter.run('Start-ArbitraryTask'), /Unsupported/);
});

test('mutex verifier requires fixed parent-bound Windows attestation', () => {
  const calls = [];
  const verifier = createFixedRecoveryMeshMutexVerifier({
    verifierScriptPath: 'C:\\fixed\\verify-mutex.ps1',
    spawnSyncFn: (executable, args, options) => {
      calls.push({ executable, args, options });
      return { status: 0, stdout: 'MUTEX_OWNERSHIP_VERIFIED=true\n' };
    },
  });
  assert.equal(verifier.verify({ launcherPid: 123, nodePid: 456 }).ok, true);
  assert.equal(verifier.verify({ launcherPid: 0, nodePid: 456 }).blocker, 'RECOVERY_MESH_MUTEX_ATTESTATION_PID_INVALID');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, BATTLE_BRIDGE_WINDOWS_POWERSHELL_EXECUTABLE);
  assert.notEqual(calls[0].executable, 'powershell.exe');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args.slice(-4), ['-LauncherPid', '123', '-NodePid', '456']);
});

test('mutex attestation is inside every runner invocation rather than the CLI wrapper', async () => {
  const source = await readFile(new URL('./battle-bridge-recovery-mesh.mjs', import.meta.url), 'utf8');
  const runnerStart = source.indexOf('export async function runBattleBridgeRecoveryMesh');
  const attestation = source.indexOf('const mutexVerification = verifyCurrentRecoveryMeshMutexAuthority(env);', runnerStart);
  const pathValidation = source.indexOf('const pathValidation = validateRecoveryMeshPaths', runnerStart);
  assert.ok(runnerStart >= 0 && attestation > runnerStart && pathValidation > attestation);
  const directWrapper = source.slice(source.indexOf('if (isDirectCliEntrypoint())'));
  assert.match(directWrapper, /const result = await runBattleBridgeRecoveryMesh\(\);/);
  assert.doesNotMatch(directWrapper, /createFixedRecoveryMeshMutexVerifier|mutexVerification/);
});

test('task identity remains the single canonical recovery coordinator', () => {
  assert.equal(BATTLE_BRIDGE_RECOVERY_MESH_TASK, 'Stephanos Battle Bridge Recovery Mesh');
  const local = buildLocalSupervisorIngress(new Date('2026-08-01T03:00:00.000Z'));
  assert.equal(validateBattleBridgeRecoveryIngress(local, { nowMs: Date.parse('2026-08-01T03:00:00.000Z') }).ok, true);
});
