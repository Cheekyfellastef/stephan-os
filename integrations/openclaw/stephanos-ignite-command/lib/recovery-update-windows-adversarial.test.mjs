import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
  buildOpenClawUpdateAuthorization,
  claimOpenClawUpdateInOwnerHandler,
  ensureOpenClawUpdateReceiptRoot,
  resolveOpenClawUpdateReceiptPaths,
  writeNewOpenClawUpdateReceipt,
} from './recovery-update-receipt.mjs';
import {
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
} from '../../../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import {
  OPENCLAW_18789_PROCESS_PROOF_SCHEMA,
  runApprovedOpenClawGateway18789Start,
  validateOpenClawGateway18789ProcessProofRecord,
} from '../../../../scripts/battle-bridge-ignition-supervisor.mjs';

const HEAD = 'a'.repeat(40);
const OWNER = Object.freeze({ authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'update', senderIsOwner: true });

function queuedReceipt(receiptId, hostPid, now = new Date()) {
  return {
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
    receiptId,
    status: 'QUEUED',
    expectedHead: HEAD,
    queuedAtUtc: now.toISOString(),
    authorization: buildOpenClawUpdateAuthorization({ receiptId, expectedHead: HEAD, authenticatedContext: OWNER, hostPid, now }),
    finalVerdict: 'UPDATE_EXECUTION_QUEUED',
    blocker: '',
    pluginReloadProof: 'NOT_STARTED',
  };
}

test('Windows receipt admission rejects an actual junction ancestor', { skip: process.platform !== 'win32' }, () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'update-junction-'));
  const documents = path.join(profile, 'Documents');
  const target = path.join(profile, 'junction-target');
  mkdirSync(documents);
  mkdirSync(target);
  symlinkSync(target, path.join(documents, 'Stephanos-openclaw-workspace'), 'junction');
  const paths = resolveOpenClawUpdateReceiptPaths({ env: { USERPROFILE: profile }, receiptId: '1'.repeat(32) });
  assert.throws(() => ensureOpenClawUpdateReceiptRoot(paths, { create: true }), /UPDATE_RECEIPT_LINKED_ANCESTOR/);
});

test('Windows Git topology rejects an actual objects junction before Git authority', { skip: process.platform !== 'win32' }, () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'update-git-junction-'));
  const target = mkdtempSync(path.join(tmpdir(), 'update-git-objects-target-'));
  mkdirSync(path.join(repoRoot, '.git', 'refs'), { recursive: true });
  writeFileSync(path.join(repoRoot, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(path.join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  symlinkSync(target, path.join(repoRoot, '.git', 'objects'), 'junction');
  assert.equal(inspectBattleBridgeGitTopology(repoRoot).blocker, 'CANONICAL_GIT_REPARSE_POINT_PRESENT');
});

test('Windows CreateNew active lease admits one process and crash evidence blocks a later generation', { skip: process.platform !== 'win32' }, async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'update-cross-process-'));
  const seedPaths = resolveOpenClawUpdateReceiptPaths({ env: { USERPROFILE: profile }, receiptId: 'f'.repeat(32) });
  ensureOpenClawUpdateReceiptRoot(seedPaths, { create: true });
  const barrier = path.join(profile, 'release.barrier');
  const moduleUrl = new URL('./recovery-update-receipt.mjs', import.meta.url).href;
  const childSource = `
    import { existsSync, writeFileSync } from 'node:fs';
    const api = await import(process.argv[1]);
    const [profile, receiptId, readyPath, barrier, head] = process.argv.slice(2);
    const now = new Date();
    const owner = { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'update', senderIsOwner: true };
    const paths = api.resolveOpenClawUpdateReceiptPaths({ env: { USERPROFILE: profile }, receiptId });
    const safeRoot = api.ensureOpenClawUpdateReceiptRoot(paths, { create: false });
    const receipt = {
      schemaVersion: api.OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA,
      receiptId, status: 'QUEUED', expectedHead: head, queuedAtUtc: now.toISOString(),
      authorization: api.buildOpenClawUpdateAuthorization({ receiptId, expectedHead: head, authenticatedContext: owner, hostPid: process.pid, now }),
      finalVerdict: 'UPDATE_EXECUTION_QUEUED', blocker: '', pluginReloadProof: 'NOT_STARTED',
    };
    api.writeNewOpenClawUpdateReceipt({ paths, safeRoot, receipt });
    writeFileSync(readyPath, 'ready');
    while (!existsSync(barrier)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    try {
      api.claimOpenClawUpdateInOwnerHandler({ paths, safeRoot, queued: receipt, claimantPid: process.pid, now });
      process.stdout.write(JSON.stringify({ ok: true, receiptId }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ ok: false, receiptId, blocker: error.code || error.message }));
    }
  `;
  const children = ['1'.repeat(32), '2'.repeat(32)].map((receiptId, index) => {
    const ready = path.join(profile, `ready-${index}`);
    const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource, moduleUrl, profile, receiptId, ready, barrier, HEAD], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const completed = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status) => resolve({ status, stdout, stderr }));
    });
    return { ready, completed };
  });
  for (let attempt = 0; attempt < 500 && !children.every(({ ready }) => existsSync(ready)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(children.every(({ ready }) => existsSync(ready)), true);
  writeFileSync(barrier, 'go');
  const outcomes = await Promise.all(children.map(({ completed }) => completed));
  assert.equal(outcomes.every(({ status, stderr }) => status === 0 && stderr === ''), true, JSON.stringify(outcomes));
  const claims = outcomes.map(({ stdout }) => JSON.parse(stdout));
  assert.equal(claims.filter(({ ok }) => ok).length, 1, JSON.stringify(claims));
  assert.equal(claims.filter(({ ok }) => !ok).length, 1, JSON.stringify(claims));

  const thirdId = '3'.repeat(32);
  const paths = resolveOpenClawUpdateReceiptPaths({ env: { USERPROFILE: profile }, receiptId: thirdId });
  const safeRoot = ensureOpenClawUpdateReceiptRoot(paths, { create: false });
  const receipt = queuedReceipt(thirdId, process.pid);
  writeNewOpenClawUpdateReceipt({ paths, safeRoot, receipt });
  assert.throws(() => claimOpenClawUpdateInOwnerHandler({ paths, safeRoot, queued: receipt }), /PREVIOUS_UPDATE_EXECUTION_UNPROVEN/);
});

test('Windows canonical Git ignores malicious user-global executable configuration', { skip: process.platform !== 'win32' }, () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'update-global-config-'));
  writeFileSync(path.join(profile, '.gitconfig'), '[core]\n\tfsmonitor = C:\\\\attacker.exe\n');
  const environment = createBattleBridgeMinimalChildEnvironment({
    ...process.env,
    USERPROFILE: profile,
    HOME: profile,
    GIT_CONFIG_GLOBAL: path.join(profile, '.gitconfig'),
  }, { git: true });
  const observed = spawnSync(BATTLE_BRIDGE_WINDOWS_HOST.git, [
    ...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
    'config', '--global', '--get', 'core.fsmonitor',
  ], { env: environment, encoding: 'utf8', shell: false, windowsHide: true });
  assert.notEqual(observed.status, 0);
  assert.equal(String(observed.stdout || '').trim(), '');
});

test('Windows topology baseline survives Git index lockfile replacement but binds stable metadata', { skip: process.platform !== 'win32' }, () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'update-index-replace-'));
  const environment = createBattleBridgeMinimalChildEnvironment(process.env, { git: true });
  const runGit = (args) => {
    const result = spawnSync(BATTLE_BRIDGE_WINDOWS_HOST.git, args, {
      cwd: repoRoot,
      env: environment,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
  };
  runGit(['init', '--initial-branch=main']);
  writeFileSync(path.join(repoRoot, 'proof.txt'), 'one\n');
  runGit(['add', 'proof.txt']);
  runGit(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-m', 'one']);
  const before = inspectBattleBridgeGitTopology(repoRoot);
  assert.equal(before.ok, true);
  writeFileSync(path.join(repoRoot, 'proof.txt'), 'two\n');
  runGit(['add', 'proof.txt']);
  runGit(['-c', 'user.name=Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-m', 'two']);
  const after = inspectBattleBridgeGitTopology(repoRoot);
  assert.equal(after.ok, true);
  assert.deepEqual(after.stableIdentities, before.stableIdentities);
  assert.equal(Object.hasOwn(before.stableIdentities, 'index'), false);
});

test('Windows listener proof consumer rejects an injected wrong-owner SID record', { skip: process.platform !== 'win32' }, () => {
  const appData = process.env.APPDATA;
  const userProfile = process.env.USERPROFILE;
  assert.equal(Boolean(appData && userProfile), true);
  const operatorSid = 'S-1-5-21-1000-2000-3000-1001';
  const record = {
    schemaVersion: OPENCLAW_18789_PROCESS_PROOF_SCHEMA,
    ok: true,
    pid: 18789,
    parentPid: 18788,
    processName: 'node.exe',
    executablePath: BATTLE_BRIDGE_WINDOWS_HOST.node,
    executableCanonical: true,
    executableTokenCanonical: true,
    executableToken: BATTLE_BRIDGE_WINDOWS_HOST.node,
    entrypointCanonical: true,
    entrypointToken: path.win32.join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs'),
    gatewayCommandCanonical: true,
    gatewayToken: 'gateway',
    gatewayActionToken: 'run',
    gatewayPortToken: '',
    commandTokenCount: 4,
    commandLineCanonical: true,
    currentOwnerSid: operatorSid,
    processOwnerSid: 'S-1-5-21-1000-2000-3000-2002',
    ownerSidMatches: true,
    expectedStarterPid: 0,
    starterPidBound: true,
    supportedStarterLineage: true,
    starterLineageKind: 'canonical-gateway-cmd',
    starterCommandCanonical: true,
    supportedStarterPid: 18788,
    supportedStarterExecutablePath: BATTLE_BRIDGE_WINDOWS_HOST.cmd,
    supportedStarterGatewayPath: path.win32.join(userProfile, '.openclaw', 'gateway.cmd'),
    supportedStarterCommandShape: 'cmd-c',
    lineageCanonical: true,
    ancestorPids: [18788],
    listenerCount: 1,
    localAddress: '127.0.0.1',
  };
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(record, { env: process.env }).ok, false);
});

test('Windows canonical 18789 proof rejects fake Node with canonical path and gateway argv only in unused eval arguments', { skip: process.platform !== 'win32' }, async (t) => {
  const fakeRoot = mkdtempSync(path.join(tmpdir(), 'update-fake-openclaw-argv-'));
  const isolatedProfile = path.join(fakeRoot, 'profile');
  const proofEnvironment = { ...process.env, USERPROFILE: isolatedProfile };
  const canonicalGatewayDirectory = path.win32.join(isolatedProfile, '.openclaw');
  const canonicalGatewayPath = path.win32.join(canonicalGatewayDirectory, 'gateway.cmd');
  const fakeModulePath = path.join(fakeRoot, 'fake-listener.mjs');
  const fakeSource = `
    import { createServer } from 'node:http';
    const server = createServer((request, response) => {
      if (request.url === '/__shutdown') {
        response.end('{}');
        server.close(() => process.exit(0));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(request.url === '/identity'
        ? { product: 'OpenClaw', runtimeId: 'openclaw-runtime-fake', status: 'ready' }
        : { ok: true, status: 'live' }));
    });
    server.once('error', (error) => { process.stderr.write(error.code || error.message); process.exit(23); });
    server.listen(18789, '127.0.0.1', () => process.stdout.write('READY\\n'));
  `;
  let fake = null;
  let fakeReady = false;
  let closed = Promise.resolve();
  let stdout = '';
  let stderr = '';
  try {
    writeFileSync(fakeModulePath, fakeSource);
    const argvSpoofEntrypoint = path.win32.join(process.env.APPDATA, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
    mkdirSync(canonicalGatewayDirectory, { recursive: true });
    writeFileSync(canonicalGatewayPath, [
      '@echo off',
      `"${BATTLE_BRIDGE_WINDOWS_HOST.node}" --input-type=module --eval "import(process.argv[1])" "${pathToFileURL(fakeModulePath).href}" "${argvSpoofEntrypoint}" gateway run`,
      '',
    ].join('\r\n'), { flag: 'wx' });
    fake = spawn(BATTLE_BRIDGE_WINDOWS_HOST.cmd, ['/d', '/s', '/c', `""${canonicalGatewayPath}""`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    fake.stdout.on('data', (chunk) => { stdout += chunk; });
    fake.stderr.on('data', (chunk) => { stderr += chunk; });
    closed = new Promise((resolve) => fake.once('close', resolve));
    for (let attempt = 0; attempt < 100 && !stdout.includes('READY') && !stderr; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!stdout.includes('READY')) {
      t.skip(`port 18789 unavailable for isolated fake-listener proof (${stderr || 'no readiness'})`);
      return;
    }
    fakeReady = true;
    const workspace = mkdtempSync(path.join(tmpdir(), 'update-fake-openclaw-'));
    const result = await runApprovedOpenClawGateway18789Start({
      sharedWorkspace: workspace,
      platform: 'win32',
      approved: true,
      env: proofEnvironment,
      readyTimeoutMs: 1000,
      retryIntervalMs: 0,
      spawnFn: () => { throw new Error('fake listener must block before startup'); },
    });
    assert.equal(result.ready, false);
    assert.equal(result.started, false);
    assert.equal(result.error, 'OPENCLAW_18789_EXISTING_LISTENER_IDENTITY_UNPROVEN');
    assert.equal(result.healthProof.identityCanonical, true);
    assert.equal(result.healthProof.processCanonical, false);
    assert.equal(result.healthProof.processProof.proofFacets.listenerAddressCanonical, true);
    assert.equal(result.healthProof.processProof.proofFacets.ownerIdentityCanonical, true);
    assert.equal(result.healthProof.processProof.proofFacets.starterLineageCanonical, true);
    assert.equal(result.healthProof.processProof.proofFacets.positionalCommandCanonical, false);
  } finally {
    if (fakeReady) await fetch('http://127.0.0.1:18789/__shutdown').catch(() => null);
    if (fake) {
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
      if (fake.exitCode === null) fake.kill();
    }
    rmSync(fakeRoot, { recursive: true, force: true });
  }
});
