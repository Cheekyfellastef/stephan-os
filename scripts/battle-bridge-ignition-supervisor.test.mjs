import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import {
  BATTLE_BRIDGE_IGNITION_AUTHORITY,
  BATTLE_BRIDGE_IGNITION_PHASES,
  BATTLE_BRIDGE_IGNITION_PHASE_STATES,
  collectCanonicalIgnitionSourceTruth,
  createBattleBridgeSupervisorStatus,
  collectOpenClawGateway18789ProcessProof,
  collectServedRuntimeExactHeadProof,
  evaluateCanonicalIgnitionSourceTruth,
  OPENCLAW_18789_PROCESS_PROOF_SCHEMA,
  projectBattleBridgeSupervisorStatus,
  resolveBackendRepairExecution,
  runApprovedBackend8787Start,
  runApprovedOpenClawGateway18789Start,
  runCanonicalSupervisorHousekeep,
  defaultBattleBridgeSharedWorkspace,
  runBattleBridgeIgnitionSupervisor as runBattleBridgeIgnitionSupervisorImpl,
  evaluateServedRuntimeExactHeadProof,
  validateOpenClawGateway18789ProcessProofRecord,
} from './battle-bridge-ignition-supervisor.mjs';
import { buildOpenClawGatewayStartupTarget, npmGlobalBinCandidatesForOpenClaw, resolveOpenClawGatewayStartupExecution } from '../shared/agents/openClawGatewayStartup.mjs';
import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  battleBridgeCanonicalRepositoryArgs,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';


const READY_HEAD = '51600ceb00000000000000000000000000000000';
const readyRuntimeProof = async () => ({ ready: true, currentHead: READY_HEAD, healthOk: true, distOk: true, gitCommitMatches: true, runtimeMarkerMatches: true, gitCommit: READY_HEAD, runtimeMarker: `antifriction-live-v3::${READY_HEAD}::fixture` });

const readyServices = {
  backend: { ready: true },
  'openclaw-gateway': { ready: true },
  'stephanos-ui': { ready: true },
  'shared-workspace': { ready: true },
};

function canonicalSourceTruth(overrides = {}) {
  return {
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head: 'a'.repeat(40),
    originHead: 'a'.repeat(40),
    ...overrides,
  };
}

const COLLECTOR_HEAD = 'a'.repeat(40);
const COLLECTOR_CONFIG = `remote.origin.url\n${BATTLE_BRIDGE_CANONICAL_REMOTE_URL}\0`;

function runSourceCollectorFixture({
  statusBefore = '',
  statusAfter = statusBefore,
  statusFinal = statusAfter,
  configurationBefore = COLLECTOR_CONFIG,
  configurationAfter = configurationBefore,
  trackedVisibilityBefore = 'H tracked-source.mjs\n',
  trackedVisibilityAfter = trackedVisibilityBefore,
  trackedVisibilityFinal = trackedVisibilityAfter,
  branchBefore = 'main',
  branchAfter = branchBefore,
  upstreamBefore = 'origin/main',
  upstreamAfter = upstreamBefore,
  headBefore = COLLECTOR_HEAD,
  headAfter = headBefore,
  originHead = headBefore,
  originHeadAfter = originHead,
  headFinal = headAfter,
  originHeadFinal = originHeadAfter,
  divergence = '0\t0\n',
  failOperation = '',
  topologyAfter = null,
  environment = { PATH: 'C:\\attacker', NODE_OPTIONS: '--require=C:\\attacker\\inject.cjs' },
} = {}) {
  const calls = [];
  const counts = Object.create(null);
  let topologyCalls = 0;
  const topologyOptions = [];
  const stableTopology = Object.freeze({ config: 'stable-config', HEAD: 'stable-head' });
  const inspectTopologyFn = (_cwd, options = {}) => {
    topologyCalls += 1;
    topologyOptions.push(options);
    return topologyCalls === 1
      ? { ok: true, stableIdentities: stableTopology }
      : (topologyAfter || { ok: true, stableIdentities: stableTopology });
  };
  const spawnSyncFn = (command, args, options) => {
    const workTreeIndex = args.findIndex((arg) => String(arg).startsWith('--work-tree='));
    const operationArgs = args.slice(workTreeIndex + 1);
    const operation = String(operationArgs[0] || '');
    counts[operation] = Number(counts[operation] || 0) + 1;
    calls.push({ command, args, operationArgs, options });
    if (operation === failOperation) return { status: 1, stdout: '', stderr: 'fixture failure' };
    if (operation === 'config') return { status: 0, stdout: counts.config === 1 ? configurationBefore : configurationAfter, stderr: '' };
    if (operation === 'ls-files') {
      return { status: 0, stdout: [trackedVisibilityBefore, trackedVisibilityAfter, trackedVisibilityFinal][counts['ls-files'] - 1], stderr: '' };
    }
    if (operation === 'status') {
      return { status: 0, stdout: [statusBefore, statusAfter, statusFinal][counts.status - 1], stderr: '' };
    }
    if (operation === 'branch') return { status: 0, stdout: `${counts.branch === 1 ? branchBefore : branchAfter}\n`, stderr: '' };
    if (operation === 'fetch') return { status: 0, stdout: '', stderr: '' };
    if (operation === 'rev-list') return { status: 0, stdout: divergence, stderr: '' };
    if (operation === 'rev-parse' && operationArgs.includes('@{upstream}')) {
      counts.upstream = Number(counts.upstream || 0) + 1;
      const value = counts.upstream === 1 ? upstreamBefore : upstreamAfter;
      return value === null
        ? { status: 1, stdout: '', stderr: 'no upstream configured' }
        : { status: 0, stdout: `${value}\n`, stderr: '' };
    }
    if (operation === 'rev-parse' && operationArgs[1] === 'HEAD' && operationArgs[2] === 'origin/main') {
      return { status: 0, stdout: `${headFinal}\n${originHeadFinal}\n`, stderr: '' };
    }
    if (operation === 'rev-parse' && operationArgs[1] === 'HEAD') {
      counts.headRead = Number(counts.headRead || 0) + 1;
      return { status: 0, stdout: `${counts.headRead === 1 ? headBefore : headAfter}\n`, stderr: '' };
    }
    if (operation === 'rev-parse' && operationArgs[1] === 'origin/main') {
      counts.originRead = Number(counts.originRead || 0) + 1;
      return { status: 0, stdout: `${counts.originRead === 1 ? originHead : originHeadAfter}\n`, stderr: '' };
    }
    throw new Error(`unexpected fixed Git operation: ${operationArgs.join(' ')}`);
  };
  const result = collectCanonicalIgnitionSourceTruth({
    cwd: '/canonical/repo',
    environment,
    spawnSyncFn,
    inspectTopologyFn,
  });
  return { result, calls, topologyCalls, topologyOptions };
}

function factsFor({ backend = true, openclaw = true, ui = true, stale = [], caveats = [], blockers = [] } = {}) {
  return {
    observedServices: { ...readyServices, backend: { ready: backend }, 'openclaw-gateway': { ready: openclaw }, 'stephanos-ui': { ready: ui }, 'shared-workspace': { ready: stale.length === 0 } },
    staleWorkspaceRecords: stale,
    caveats,
    safetyBlockers: blockers,
    finalVerdict: backend && openclaw && ui && stale.length === 0 && blockers.length === 0 ? 'ready' : 'partial-ui-missing',
  };
}

const canonicalOpenClawIdentity = Object.freeze({
  product: 'OpenClaw',
  runtimeId: 'openclaw-runtime-fixture',
  status: 'ready',
});

const PROCESS_PROOF_APPDATA = 'C:\\Users\\Fixture\\AppData\\Roaming';
const PROCESS_PROOF_ENTRYPOINT = path.win32.join(PROCESS_PROOF_APPDATA, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
const PROCESS_PROOF_OWNER_SID = 'S-1-5-21-1000-2000-3000-1001';

function canonicalProcessProofRecord(overrides = {}) {
  return {
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
    entrypointToken: PROCESS_PROOF_ENTRYPOINT,
    gatewayCommandCanonical: true,
    gatewayToken: 'gateway',
    gatewayActionToken: 'run',
    gatewayPortToken: '',
    commandTokenCount: 4,
    commandLineCanonical: true,
    currentOwnerSid: PROCESS_PROOF_OWNER_SID,
    processOwnerSid: PROCESS_PROOF_OWNER_SID,
    ownerSidMatches: true,
    expectedStarterPid: 0,
    starterPidBound: true,
    supportedStarterLineage: true,
    starterLineageKind: 'canonical-gateway-cmd',
    starterCommandCanonical: true,
    supportedStarterPid: 18788,
    supportedStarterExecutablePath: BATTLE_BRIDGE_WINDOWS_HOST.cmd,
    supportedStarterGatewayPath: path.win32.join('C:\\Users\\Fixture', '.openclaw', 'gateway.cmd'),
    supportedStarterCommandShape: 'cmd-d-s-c',
    lineageCanonical: true,
    ancestorPids: [18788],
    listenerCount: 1,
    localAddress: '127.0.0.1',
    ...overrides,
  };
}

function canonicalOpenClawProcessProofResult(overrides = {}) {
  return Object.freeze({
    ok: true,
    pid: 18789,
    parentPid: 18788,
    processName: 'node.exe',
    executablePath: BATTLE_BRIDGE_WINDOWS_HOST.node,
    ownerSid: PROCESS_PROOF_OWNER_SID,
    localAddress: '127.0.0.1',
    starterLineageKind: 'canonical-gateway-cmd',
    canonicalGatewayStarterLineage: true,
    listenerObserved: true,
    ancestorPids: Object.freeze([18788]),
    ...overrides,
  });
}

const canonicalOpenClawProcessProof = async () => canonicalOpenClawProcessProofResult();

const readyOpenClawAdapter = async () => Object.freeze({
  ready: true,
  started: false,
  reusedExistingRuntime: true,
  healthProof: Object.freeze({ ready: true, identityCanonical: true, processCanonical: true }),
});

function runBattleBridgeIgnitionSupervisor(options = {}) {
  return runBattleBridgeIgnitionSupervisorImpl({
    openClawStartFn: readyOpenClawAdapter,
    ...options,
  });
}

test('supervisor status model exposes required phases and states', () => {
  const status = createBattleBridgeSupervisorStatus();
  assert.deepEqual(Object.keys(status.phases), [...BATTLE_BRIDGE_IGNITION_PHASES]);
  assert.deepEqual(BATTLE_BRIDGE_IGNITION_PHASES.slice(0, 2), ['source truth', 'housekeeping']);
  assert.deepEqual([...BATTLE_BRIDGE_IGNITION_PHASE_STATES], ['pending', 'running', 'ready', 'degraded', 'blocked', 'failed']);
  const updated = projectBattleBridgeSupervisorStatus({ status, phase: 'backend 8787', phaseState: 'ready', readinessReport: factsFor() });
  assert.equal(updated.currentPhase, 'backend 8787');
  assert.equal(updated.services.backend8787.ready, true);
  assert.equal(updated.trafficLight, 'blue');
});

test('publisher is refreshed before UI repair and stale records are refreshed by supervisor', async () => {
  const calls = [];
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-supervisor-'));
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace: workspace,
    housekeepFn: () => calls.push('housekeeping'),
    publisherFn: async () => { calls.push('publisher'); },
    sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => {
      collectCount += 1;
      calls.push(`collect-${collectCount}`);
      return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: collectCount > 2 });
    },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready && !(facts.staleWorkspaceRecords || []).length ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true, logs: { logPath: path.join(workspace, 'logs', 'repair') } })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.slice(0, 5), ['housekeeping', 'publisher', 'collect-1', 'collect-2', 'repair']);
  assert.equal(calls.includes('repair'), true);
  assert.equal(calls.includes('publisher'), true);
  assert.equal(fs.existsSync(path.join(workspace, 'status', 'battle-bridge-ignition-supervisor-current.json')), true);
});

test('partial-ui-missing triggers repair and ready is only reported after 4173 proof', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {},
    publisherFn: async () => {},
    sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ ui: collectCount > 2 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.deepEqual(calls, ['repair']);
  assert.equal(result.status.phases.ready.state, 'ready');
});

test('missing 4173 repair attempt records structured degraded result when proof does not become ready', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { stdout.write(JSON.stringify({ ready: false, action: 'start-ui-4173-spawned-but-not-ready' })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.phases['Stephanos UI 4173'].state, 'blocked');
  assert.notEqual(result.status.phases.ready.state, 'ready');
});

test('non-main stale branch reports blocker to splash/status model', async () => {
  const blocker = { id: 'non-main-source-truth', detail: 'non-main branch', nextOperatorAction: 'Switch through approved source update path.' };
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => ({ blocker }), runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'non-main-source-truth');
  assert.equal(result.status.phases['source truth'].state, 'blocked');
});

test('canonical source truth accepts only clean synchronized main tracking origin/main', () => {
  assert.equal(evaluateCanonicalIgnitionSourceTruth(canonicalSourceTruth()).ok, true);
  for (const [truth, blockerId] of [
    [{ publicationState: 'source-truth-unproven', blockedForRemoteTruth: true }, 'source-truth-unproven'],
    [canonicalSourceTruth({ branch: 'feature/test' }), 'non-main-source-truth'],
    [canonicalSourceTruth({ upstreamBranch: 'origin/feature' }), 'noncanonical-upstream-source-truth'],
    [canonicalSourceTruth({ publicationState: 'local-uncommitted', workingTreeDirty: true }), 'dirty-source-truth'],
    [canonicalSourceTruth({ head: '', originHead: '' }), 'source-head-truth-unproven'],
    [canonicalSourceTruth({ originHead: 'b'.repeat(40) }), 'source-head-truth-unproven'],
    [canonicalSourceTruth({ publicationState: 'stale-behind', behindCount: 1 }), 'stale-source-truth'],
    [canonicalSourceTruth({ publicationState: 'diverged', aheadCount: 1, behindCount: 1, headPublished: false, blockedForRemoteTruth: true }), 'unpublished-source-truth'],
  ]) {
    const result = evaluateCanonicalIgnitionSourceTruth(truth);
    assert.equal(result.ok, false);
    assert.equal(result.blocker.id, blockerId);
  }
});

test('fixed source collector ignores attacker PATH and fetches only the canonical URL after preflight', () => {
  const { result, calls, topologyCalls, topologyOptions } = runSourceCollectorFixture();
  assert.equal(result.ok, true);
  assert.equal(result.publicationState, 'healthy-synced');
  assert.equal(result.head, COLLECTOR_HEAD);
  assert.equal(result.originHead, COLLECTOR_HEAD);
  assert.equal(topologyCalls, 3);
  assert.equal(topologyOptions.every((options) => options.stabilizeIndex === true), true);
  assert.equal(calls.every((call) => call.command === BATTLE_BRIDGE_WINDOWS_HOST.git), true);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.operationArgs[0]), ['config', 'ls-files', 'status']);
  const fetchCall = calls.find((call) => call.operationArgs[0] === 'fetch');
  assert.deepEqual(fetchCall.operationArgs, [
    'fetch', '--prune', BATTLE_BRIDGE_CANONICAL_REMOTE_URL, 'main:refs/remotes/origin/main',
  ]);
  assert.notEqual(fetchCall.options.env.PATH, 'C:\\attacker');
  assert.equal(fetchCall.options.env.NODE_OPTIONS, undefined);
  assert.equal(fetchCall.options.env.GIT_CONFIG_GLOBAL, 'NUL');
  assert.equal(fetchCall.options.shell, false);
});

test('source dirt blocks before the canonical fetch or any service mutation', () => {
  const { result, calls } = runSourceCollectorFixture({
    statusBefore: ' M scripts/run-battle-bridge-ignition.mjs\n',
  });
  assert.equal(result.publicationState, 'local-uncommitted');
  assert.equal(result.workingTreeDirty, true);
  assert.equal(result.blockedForRemoteTruth, true);
  assert.equal(result.blocker.id, 'dirty-source-truth');
  assert.equal(result.blocker.code, 'CANONICAL_CHECKOUT_DIRTY');
  assert.deepEqual(calls.map((call) => call.operationArgs[0]), ['config', 'ls-files', 'status']);
});

test('hidden tracked paths and tracked-visibility drift fail closed around the fetch', () => {
  for (const trackedVisibilityBefore of ['S hidden-source.mjs\n', 'h assumed-source.mjs\n']) {
    const hiddenBefore = runSourceCollectorFixture({ trackedVisibilityBefore });
    assert.equal(hiddenBefore.result.ok, false);
    assert.equal(hiddenBefore.result.blocker.id, 'hidden-tracked-source-truth');
    assert.equal(hiddenBefore.result.blocker.code, 'HIDDEN_TRACKED_PATHS_PRESENT');
    assert.deepEqual(hiddenBefore.calls.map((call) => call.operationArgs[0]), ['config', 'ls-files']);
  }

  const changedAfter = runSourceCollectorFixture({
    trackedVisibilityBefore: 'H tracked-source.mjs\n',
    trackedVisibilityAfter: 'H different-source.mjs\n',
  });
  assert.equal(changedAfter.result.ok, false);
  assert.equal(changedAfter.result.blocker.id, 'hidden-tracked-source-truth');
  assert.equal(changedAfter.result.blocker.code, 'CANONICAL_TRACKED_VISIBILITY_CHANGED');

  const hiddenAfter = runSourceCollectorFixture({
    trackedVisibilityBefore: 'H tracked-source.mjs\n',
    trackedVisibilityAfter: 'S tracked-source.mjs\n',
  });
  assert.equal(hiddenAfter.result.ok, false);
  assert.equal(hiddenAfter.result.blocker.code, 'HIDDEN_TRACKED_PATHS_PRESENT');
});

test('attacker-configured origin is rejected before fetch even when PATH and ambient Git variables are hostile', () => {
  const { result, calls } = runSourceCollectorFixture({
    configurationBefore: 'remote.origin.url\nhttps://attacker.invalid/repository.git\0',
    environment: {
      PATH: 'C:\\attacker',
      GIT_CONFIG_GLOBAL: 'C:\\attacker\\gitconfig',
      GIT_SSH_COMMAND: 'C:\\attacker\\ssh.exe',
      NODE_OPTIONS: '--require=C:\\attacker\\inject.cjs',
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker.code, 'CANONICAL_GIT_CONFIGURATION_INVALID');
  assert.deepEqual(calls.map((call) => call.operationArgs[0]), ['config']);
  assert.equal(calls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.git);
  assert.equal(calls[0].options.env.GIT_SSH_COMMAND, undefined);
});

test('missing or noncanonical upstream blocks before the canonical fetch', () => {
  for (const upstreamBefore of [null, 'origin/feature']) {
    const { result, calls } = runSourceCollectorFixture({ upstreamBefore });
    assert.equal(result.ok, false);
    assert.equal(result.blocker.id, 'noncanonical-upstream-source-truth');
    assert.equal(result.blocker.code, 'CANONICAL_UPSTREAM_UNPROVEN');
    assert.equal(result.hasUpstream, upstreamBefore !== null);
    assert.equal(result.upstreamBranch, upstreamBefore || '');
    assert.equal(calls.some((call) => call.operationArgs[0] === 'fetch'), false);
  }
});

test('collector aligns dream-memory runtime dirt while secret-shaped children remain pre-fetch blockers', () => {
  const runtime = runSourceCollectorFixture({
    statusBefore: '!! memory/.dreams/session.json\n!! memory/dreaming/deep/session.json\n!! memory/dreaming/light/session.json\n!! memory/dreaming/rem/session.json\n',
  });
  assert.equal(runtime.result.ok, true);
  assert.equal(runtime.result.workingTreeDirty, false);
  assert.equal(runtime.result.runtimeOnlyDirt.length, 4);

  const secret = runSourceCollectorFixture({
    statusBefore: '!! memory/.dreams/token.json\n!! memory/dreaming/rem/private-key.json\n',
  });
  assert.equal(secret.result.ok, false);
  assert.equal(secret.result.blocker.code, 'CANONICAL_CHECKOUT_DIRTY');
  assert.deepEqual(secret.calls.map((call) => call.operationArgs[0]), ['config', 'ls-files', 'status']);
});

test('collector final recheck rejects source dirt or topology drift after canonical fetch', () => {
  const dirtyAfter = runSourceCollectorFixture({
    statusBefore: '!! logs/\n',
    statusAfter: '!! logs/\n M scripts/after-fetch.mjs\n',
  });
  assert.equal(dirtyAfter.result.blocker.code, 'CANONICAL_CHECKOUT_DIRTY');
  assert.equal(dirtyAfter.calls.some((call) => call.operationArgs[0] === 'fetch'), true);

  const topologyDrift = runSourceCollectorFixture({
    topologyAfter: { ok: true, stableIdentities: { config: 'changed', HEAD: 'stable-head' } },
  });
  assert.equal(topologyDrift.result.blocker.code, 'CANONICAL_GIT_TOPOLOGY_CHANGED');
});

test('collector repeats status and hidden-index proof after every other post-fetch Git check', () => {
  const lateDirt = runSourceCollectorFixture({
    statusBefore: '',
    statusAfter: '',
    statusFinal: ' M scripts/late-source-change.mjs\n',
  });
  assert.equal(lateDirt.result.ok, false);
  assert.equal(lateDirt.result.blocker.code, 'CANONICAL_CHECKOUT_DIRTY');
  assert.deepEqual(lateDirt.calls.slice(-2).map((call) => call.operationArgs[0]), ['status', 'ls-files']);

  const lateHidden = runSourceCollectorFixture({
    trackedVisibilityBefore: 'H tracked-source.mjs\n',
    trackedVisibilityAfter: 'H tracked-source.mjs\n',
    trackedVisibilityFinal: 'S tracked-source.mjs\n',
  });
  assert.equal(lateHidden.result.ok, false);
  assert.equal(lateHidden.result.blocker.code, 'HIDDEN_TRACKED_PATHS_PRESENT');
  assert.deepEqual(lateHidden.calls.slice(-2).map((call) => call.operationArgs[0]), ['status', 'ls-files']);
});

test('collector binds local and fetched refs again at the final source boundary', () => {
  const lateRefDrift = runSourceCollectorFixture({
    headFinal: 'c'.repeat(40),
    originHeadFinal: 'c'.repeat(40),
  });
  assert.equal(lateRefDrift.result.ok, false);
  assert.equal(lateRefDrift.result.blocker.code, 'CANONICAL_SOURCE_TRUTH_CHANGED');
  assert.deepEqual(lateRefDrift.calls.at(-1).operationArgs, ['rev-parse', 'HEAD', 'origin/main']);
});

test('live source collector fails closed when current origin/main cannot be fetched', () => {
  const { result, calls } = runSourceCollectorFixture({ failOperation: 'fetch' });
  const verdict = evaluateCanonicalIgnitionSourceTruth(result);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocker.id, 'source-truth-unproven');
  assert.equal(verdict.blocker.code, 'FIXED_AUTHORITY_GIT_FAILED');
  assert.deepEqual(calls.slice(0, 7).map((call) => call.operationArgs[0]), ['config', 'ls-files', 'status', 'branch', 'rev-parse', 'rev-parse', 'fetch']);
});

test('standalone supervisor housekeeping ignores hostile PATH and uses only the fixed Git boundary', () => {
  const calls = [];
  let receivedOptions = null;
  const cwd = '/canonical/repo';
  const result = runCanonicalSupervisorHousekeep(
    { dryRun: false, compact: true, preserveRuntimeDirt: true },
    {
      cwd,
      environment: { PATH: 'C:\\attacker', NODE_OPTIONS: '--require=C:\\attacker\\inject.cjs' },
      spawnSyncFn: (command, args, options) => {
        calls.push({ command, args, options });
        return { status: 0, stdout: '', stderr: '' };
      },
      housekeepFn: (options) => {
        receivedOptions = options;
        options.captureStepFn('git-status', 'git', ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
        options.runStepFn('git-clean-runtime-untracked', 'git', ['clean', '-fd', '--', 'data/activity/']);
        return { ok: true };
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(receivedOptions.preserveRuntimeDirt, true);
  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.command === BATTLE_BRIDGE_WINDOWS_HOST.git), true);
  assert.deepEqual(calls[0].args.slice(0, BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length), [...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS]);
  assert.deepEqual(
    calls[0].args.slice(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length, BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length + 2),
    [...battleBridgeCanonicalRepositoryArgs(cwd)],
  );
  assert.equal(calls.every((call) => call.options.env.PATH !== 'C:\\attacker'), true);
  assert.equal(calls.every((call) => call.options.env.NODE_OPTIONS === undefined), true);
  assert.equal(calls.every((call) => call.options.shell === false), true);
});

test('source proof blocks every housekeeping and service mutator before it is called', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSupervisor({
    sourceTruthFn: () => {
      calls.push('source-truth');
      return canonicalSourceTruth({ publicationState: 'diverged', aheadCount: 1, behindCount: 1, headPublished: false, blockedForRemoteTruth: true });
    },
    housekeepFn: () => { calls.push('housekeeping'); },
    publisherFn: async () => { calls.push('publisher'); },
    collectFactsFn: async () => { calls.push('facts'); return factsFor(); },
    backendStartFn: async () => { calls.push('backend'); },
    openClawStartFn: async () => { calls.push('openclaw'); },
    repairFn: async () => { calls.push('ui'); },
    stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'unpublished-source-truth');
  assert.deepEqual(calls, ['source-truth']);
});

test('tracked runtime activity dirt guidance and runtime-only dist caveat are separate', () => {
  const trackedBlocker = { id: 'tracked-runtime-activity-dirt', detail: 'Preserve then restore runtime activity.', nextOperatorAction: 'Preserve runtime activity, restore tracked files, then retry.' };
  const status = projectBattleBridgeSupervisorStatus({ status: createBattleBridgeSupervisorStatus(), readinessReport: factsFor({ caveats: [{ id: 'runtime-only-dirt', detail: 'dist dirt caveat' }], blockers: [trackedBlocker] }) });
  assert.equal(status.blockerId, 'tracked-runtime-activity-dirt');
  assert.equal(status.runtimeOnlyDirtCaveat.id, 'runtime-only-dirt');
  assert.match(status.nextOperatorAction, /Preserve runtime activity/);
});

test('supervisor authority introduces no arbitrary shell, process kill, or OpenClaw mutation', () => {
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.executesArbitraryShell, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.killsProcesses, true);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.mutatesOpenClaw, true);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.executesArbitraryShell, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.killsProcesses, false);
  assert.equal(BATTLE_BRIDGE_IGNITION_AUTHORITY.uiRepairAuthority.startsOpenClawGateway18789, false);
});

test('backend missing plus UI missing does not enter browser/runtime proof and starts approved backend first', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ backend: collectCount > 1, ui: false }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices.backend.ready ? 'partial-ui-missing' : 'blocked-needs-supervisor-repair' }),
    backendStartFn: async ({ commandIdentity }) => { calls.push(commandIdentity.commandText); return { started: true, commandIdentity }; },
    repairFn: async ({ stdout }) => { calls.push('ui-repair'); stdout.write(JSON.stringify({ ready: false })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(calls[0], 'npm run stephanos:battle-bridge:repair');
  assert.equal(result.status.blockerId, 'stephanos-ui-4173-missing');
});

test('backend missing has deterministic backend blocker and no empty blockerId when approved start fails proof', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: false }),
    repairFn: async () => { throw new Error('ui repair must not run without backend'); },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-failed');
  assert.equal(result.status.phases['browser/runtime proof'].state, 'pending');
  assert.match(result.status.nextOperatorAction, /backend repair logs|npm run stephanos:battle-bridge:repair/);
});

test('backend start unavailable returns adapter blocker', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ unavailable: true }),
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.status.blockerId, 'backend-8787-start-unavailable');
  assert.match(result.status.nextOperatorAction, /safe backend start adapter/);
});





test('OpenClaw gateway start blocks with startup-approval-required without approval when 18789 is down', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-no-approval-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: {},
    approved: false,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('unapproved start must not spawn'); },
    fetchFn: async () => { throw new Error('18789 down'); },
  });

  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  const healthLog = JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'));
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, 'startup-approval-required');
  assert.equal(exitLog.error, 'startup-approval-required');
  assert.equal(healthLog.skipped, true);
  assert.equal(healthLog.reason, 'startup-approval-required');
  assert.equal(spawnCalls.length, 0);
});

test('approved OpenClaw gateway start uses config-safe start command shape, env token, health retries, and canonical logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-start-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => { child.stdout.end('openclaw stdout proof\n'); child.stderr.end('openclaw stderr proof\n'); });
      return child;
    },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('not listening before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(result.ready, true);
  assert.equal(spawnCalls[0].command, 'openclaw');
  assert.deepEqual(spawnCalls[0].args, ['gateway', 'start', '--json']);
  assert.doesNotMatch(result.target.commandText, /openclaw config set/);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /openclaw config set/);
  assert.match(`${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`, /openclaw gateway start --json/);
  assert.equal(spawnCalls[0].options.env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN, 'test-token');
  assert.equal(spawnCalls[0].options.env.OPENCLAW_GATEWAY_TOKEN, 'test-token');
  assert.equal(healthCalls >= 2, true);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /openclaw gateway run --force/);
  assert.doesNotMatch(spawnCalls[0].args.join(' '), /--port 18789 --bind loopback|--host/);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.match(result.logPath, /logs[\\/]openclaw-gateway-18789-start/);
  assert.equal(fs.readFileSync(result.logs.stdoutLogPath, 'utf8'), 'openclaw stdout proof\n');
  assert.equal(fs.readFileSync(result.logs.stderrLogPath, 'utf8'), 'openclaw stderr proof\n');
});

test('approved OpenClaw gateway start runs without token and writes non-skipped exit and health logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-no-token-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: {},
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        return healthCalls <= 1
          ? Promise.reject(new Error('not ready yet'))
          : { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });

  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  const healthLog = JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'));
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(`${spawnCalls[0].command} ${spawnCalls[0].args.join(' ')}`, 'openclaw gateway start --json');
  assert.equal(spawnCalls[0].options.env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(spawnCalls[0].options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(exitLog.error, null);
  assert.notEqual(exitLog.error, 'startup-token-missing');
  assert.equal(healthLog.skipped, undefined);
  assert.notEqual(healthLog.reason, 'startup-token-missing');
  assert.equal(healthLog.ready, true);
});

test('OpenClaw config write startup targets still require token and never become gateway start commands', () => {
  const noToken = buildOpenClawGatewayStartupTarget({
    commandText: 'openclaw config set gateway.token secret',
    env: {},
    approved: true,
  });
  const withToken = buildOpenClawGatewayStartupTarget({
    commandText: 'openclaw config set gateway.token secret',
    token: 'test-token',
    approved: true,
  });

  assert.equal(noToken.available, false);
  assert.equal(noToken.reason, 'startup-token-missing');
  assert.equal(noToken.mutatesOpenClawConfig, true);
  assert.equal(withToken.available, false);
  assert.equal(withToken.reason, 'startup-command-violates-guardrails');
  assert.equal(withToken.mutatesOpenClawConfig, true);
  assert.doesNotMatch(noToken.commandText, /^openclaw gateway start --json$/);
  assert.doesNotMatch(withToken.commandText, /^openclaw gateway start --json$/);
});



test('Windows OpenClaw gateway execution uses cmd.exe wrapper for openclaw.cmd instead of direct shim spawn', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  fs.mkdirSync(npmBin, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  fs.writeFileSync(cmdShim, '@echo off\n');
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: '' },
    approved: true,
    platform: 'win32',
    processProofFn: canonicalOpenClawProcessProof,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => { spawnCalls.push({ command, args, options }); return child; },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('down before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.cmd);
  assert.notEqual(spawnCalls[0].command, 'openclaw');
  assert.deepEqual(spawnCalls[0].args, ['/d', '/s', '/c', `""${cmdShim}" gateway start --json"`]);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.target.commandText, 'openclaw gateway start --json');
  assert.equal(result.execution.strategy, 'cmd-shim');
  assert.equal(result.execution.resolvedOpenClawPath, cmdShim);
  assert.doesNotMatch(result.target.commandText, /openclaw config set/);
});

test('Windows OpenClaw gateway execution prefers APPDATA npm node entrypoint when openclaw.mjs exists', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-node-entry-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  const openClawPackage = path.join(npmBin, 'node_modules', 'openclaw');
  const nodeDir = path.join(workspace, 'nodejs');
  fs.mkdirSync(openClawPackage, { recursive: true });
  fs.mkdirSync(nodeDir, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  const openClawMjs = path.win32.join(appData, 'npm', 'node_modules', 'openclaw', 'openclaw.mjs');
  const localMjs = path.join(openClawPackage, 'openclaw.mjs');
  const nodeExe = path.join(nodeDir, 'node.exe');
  fs.writeFileSync(cmdShim, '@echo off\n');
  fs.writeFileSync(localMjs, 'export {};\n');
  fs.writeFileSync(nodeExe, '');
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: nodeDir },
    approved: true,
    platform: 'win32',
    processProofFn: canonicalOpenClawProcessProof,
    existsSync: (candidate) => candidate === cmdShim || candidate === localMjs || candidate === openClawMjs || candidate === BATTLE_BRIDGE_WINDOWS_HOST.node,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => { spawnCalls.push({ command, args, options }); return child; },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('down before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, BATTLE_BRIDGE_WINDOWS_HOST.node);
  assert.deepEqual(spawnCalls[0].args, [openClawMjs, 'gateway', 'start', '--json']);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.execution.strategy, 'node-entrypoint');
  assert.equal(result.execution.resolvedOpenClawPath, openClawMjs);
  assert.equal(result.target.commandText, 'openclaw gateway start --json');
});

test('Windows startup accepts one stable canonical gateway.cmd listener when launcher and listener PIDs differ', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-scheduled-task-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const cmdShim = path.join(appData, 'npm', 'openclaw.cmd');
  fs.mkdirSync(path.dirname(cmdShim), { recursive: true });
  fs.writeFileSync(cmdShim, '@echo off\n');
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let healthCalls = 0;
  const expectedStarterPids = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, USERPROFILE: workspace, Path: '' },
    approved: true,
    platform: 'win32',
    existsSync: (candidate) => candidate === cmdShim,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: () => child,
    processProofFn: async ({ expectedStarterPid = 0 } = {}) => {
      expectedStarterPids.push(expectedStarterPid);
      return canonicalOpenClawProcessProofResult();
    },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('down before start');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.pid, 4242);
  assert.equal(result.healthProof.processProof.pid, 18789);
  assert.equal(result.healthProof.starterLineageBound, true);
  assert.equal(result.healthProof.processSnapshotStable, true);
  assert.deepEqual(expectedStarterPids.slice(-2), [4242, 4242]);
});

test('Windows health identity is rejected when the proven 127 listener changes across the HTTP exchange', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-snapshot-switch-'));
  let proofCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: PROCESS_PROOF_APPDATA, USERPROFILE: 'C:\\Users\\Fixture' },
    approved: true,
    platform: 'win32',
    probeOnly: true,
    processProofFn: async () => {
      proofCalls += 1;
      return canonicalOpenClawProcessProofResult({ pid: proofCalls === 1 ? 18789 : 28789 });
    },
    fetchFn: async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.endsWith('/identity') ? canonicalOpenClawIdentity : { ok: true, status: 'live' }),
    }),
  });
  assert.equal(proofCalls, 2);
  assert.equal(result.ready, false);
  assert.equal(result.healthProof.healthReady, true);
  assert.equal(result.healthProof.identityCanonical, true);
  assert.equal(result.healthProof.processSnapshotStable, false);
  assert.equal(result.error, 'OPENCLAW_18789_EXISTING_LISTENER_IDENTITY_UNPROVEN');
});

test('Windows OpenClaw resolver includes APPDATA npm fallback and only accepts fixed allowlisted command', () => {
  const env = { APPDATA: 'C:\\Users\\operator\\AppData\\Roaming', Path: 'C:\\Windows\\System32' };
  const candidates = npmGlobalBinCandidatesForOpenClaw({ env });
  assert.equal(candidates.includes('C:\\Users\\operator\\AppData\\Roaming' + path.sep + 'npm'), true);
  const target = buildOpenClawGatewayStartupTarget({ commandText: 'openclaw gateway start --json', env, approved: true });
  const resolved = resolveOpenClawGatewayStartupExecution({
    target,
    env,
    platform: 'win32',
    existsSync: (candidate) => candidate.endsWith(`npm${path.sep}openclaw.cmd`),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.command, BATTLE_BRIDGE_WINDOWS_HOST.cmd);
  assert.deepEqual(resolved.commandArgs.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(resolved.commandArgs[3], /^"".*openclaw\.cmd" gateway start --json"$/);
  assert.equal(resolved.strategy, 'cmd-shim');
  assert.equal(resolved.executesArbitraryShell, false);

  const badTarget = { ...target, commandText: 'openclaw gateway start --json && openclaw config set gateway.token secret' };
  const blocked = resolveOpenClawGatewayStartupExecution({ target: badTarget, env, platform: 'win32', existsSync: () => true });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'startup-command-not-fixed-allowlisted');
});

test('Windows unresolved OpenClaw executable is classified as start-failed with canonical logs', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-missing-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: path.join(workspace, 'missing-appdata'), Path: '' },
    approved: true,
    platform: 'win32',
    existsSync: () => false,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('must not spawn unresolved openclaw'); },
    fetchFn: async () => { throw new Error('fetch failed'); },
  });
  assert.equal(spawnCalls.length, 0);
  assert.equal(result.ready, false);
  assert.equal(result.error, 'openclaw-executable-not-found');
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8')).error, 'openclaw-executable-not-found');
  assert.equal(JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8')).error, 'fetch failed');
});

test('approved OpenClaw gateway start writes all log paths on timeout', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-timeout-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: () => child,
    fetchFn: async () => { throw new Error('still down'); },
  });

  assert.equal(result.ready, false);
  assert.equal(result.started, true);
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(fs.existsSync(result.logs.exitLogPath), true);
  assert.equal(fs.existsSync(result.logs.healthProofLogPath), true);
  assert.match(fs.readFileSync(result.logs.healthProofLogPath, 'utf8'), /still down/);
});

test('Windows OpenClaw spawn EINVAL is captured in exit log for start-failed classification', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-win-einval-'));
  const appData = path.join(workspace, 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  fs.mkdirSync(npmBin, { recursive: true });
  const cmdShim = path.join(npmBin, 'openclaw.cmd');
  fs.writeFileSync(cmdShim, '@echo off\n');
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    env: { APPDATA: appData, Path: '' },
    approved: true,
    platform: 'win32',
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: () => {
      const error = new Error('spawn EINVAL');
      error.code = 'EINVAL';
      throw error;
    },
    fetchFn: async () => { throw new Error('fetch failed'); },
  });
  const exitLog = JSON.parse(fs.readFileSync(result.logs.exitLogPath, 'utf8'));
  assert.equal(result.ready, false);
  assert.equal(result.error, 'spawn EINVAL');
  assert.equal(exitLog.error, 'spawn EINVAL');
  assert.equal(exitLog.commandText, 'openclaw gateway start --json');
  assert.equal(exitLog.execution.strategy, 'cmd-shim');
  assert.equal(fs.existsSync(result.logs.stdoutLogPath), true);
  assert.equal(fs.existsSync(result.logs.stderrLogPath), true);
  assert.equal(JSON.parse(fs.readFileSync(result.logs.healthProofLogPath, 'utf8')).error, 'fetch failed');
});

test('approved OpenClaw gateway start reuses healthy 18789 and avoids duplicate start', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-reuse-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    token: 'test-token',
    approved: true,
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('duplicate start must not run'); },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.reusedExistingRuntime, true);
  assert.equal(result.duplicateStartAvoided, true);
  assert.equal(result.started, false);
  assert.equal(spawnCalls.length, 0);
  assert.match(result.logPath, /logs[\\/]openclaw-gateway-18789-start/);
});

test('healthy-looking fake 18789 listener is not reused without canonical process identity', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-fake-listener-'));
  const spawnCalls = [];
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    approved: true,
    platform: 'win32',
    processProofFn: async () => ({ ok: false, blocker: 'OPENCLAW_18789_PROCESS_IDENTITY_INVALID' }),
    spawnFn: (...args) => { spawnCalls.push(args); throw new Error('must not collide with an unproven listener'); },
    fetchFn: async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.endsWith('/health')
        ? { ok: true, status: 'live' }
        : canonicalOpenClawIdentity),
    }),
  });
  assert.equal(result.ready, false);
  assert.equal(result.started, false);
  assert.equal(result.error, 'OPENCLAW_18789_EXISTING_LISTENER_IDENTITY_UNPROVEN');
  assert.equal(result.healthProof.identityCanonical, true);
  assert.equal(result.healthProof.processCanonical, false);
  assert.equal(spawnCalls.length, 0);
});

test('owner-approved cold start carries no ambient approval flag or gateway token', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-openclaw-owner-cold-start-'));
  const child = new EventEmitter();
  child.pid = 18789;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const calls = [];
  let healthCalls = 0;
  const result = await runApprovedOpenClawGateway18789Start({
    sharedWorkspace: workspace,
    ownerApproval: Object.freeze({
      approved: true,
      action: 'RUN_EXACT_HEAD_IGNITION',
      expectedHead: 'a'.repeat(40),
      receiptId: 'b'.repeat(32),
      parentPid: 100,
      childPid: 101,
    }),
    env: {
      APPDATA: 'C:\\Fixture\\AppData\\Roaming',
      STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY: '1',
      STEPHANOS_OPENCLAW_GATEWAY_TOKEN: 'ambient-secret',
      OPENCLAW_GATEWAY_TOKEN: 'ambient-secret-two',
      NODE_OPTIONS: '--require attacker.js',
    },
    readyTimeoutMs: 1,
    retryIntervalMs: 0,
    spawnFn: (command, args, options) => { calls.push({ command, args, options }); return child; },
    fetchFn: async (url) => {
      if (url.endsWith('/health')) {
        healthCalls += 1;
        if (healthCalls === 1) throw new Error('cold');
        return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, status: 'live' }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(canonicalOpenClawIdentity) };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY, undefined);
  assert.equal(calls[0].options.env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(calls[0].options.env.OPENCLAW_GATEWAY_TOKEN, undefined);
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
});

test('Windows 18789 process proof uses only fixed PowerShell script and sanitized environment', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const calls = [];
  const pending = collectOpenClawGateway18789ProcessProof({
    env: { USERPROFILE: 'C:\\Users\\Fixture', APPDATA: PROCESS_PROOF_APPDATA, NODE_OPTIONS: '--require attacker.js', COMSPEC: 'C:\\evil.cmd' },
    spawnFn: (command, args, options) => {
      calls.push({ command, args, options });
      setImmediate(() => {
        child.stdout.end(JSON.stringify(canonicalProcessProofRecord()));
        child.stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    },
  });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /powershell\.exe$/i);
  assert.deepEqual(calls[0].args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.match(calls[0].args[5], /probe-openclaw-gateway-18789-owner\.ps1$/);
  assert.deepEqual(calls[0].args.slice(6), ['-ExpectedStarterPid', '0']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.NODE_OPTIONS, undefined);
  assert.equal(calls[0].options.env.COMSPEC, undefined);
});

test('Windows 18789 process proof record requires owner SID, positional argv, and exact starter identity', () => {
  const environment = { APPDATA: PROCESS_PROOF_APPDATA, USERPROFILE: 'C:\\Users\\Fixture' };
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(canonicalProcessProofRecord(), { env: environment }).ok, true);
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(canonicalProcessProofRecord({
    supportedStarterCommandShape: 'cmd-c',
  }), { env: environment }).ok, true);
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(canonicalProcessProofRecord({
    expectedStarterPid: 4242,
  }), { env: environment, expectedStarterPid: 4242 }).ok, true);
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(canonicalProcessProofRecord({
    gatewayActionToken: '--port', gatewayPortToken: '18789', commandTokenCount: 5,
  }), { env: environment }).ok, true);

  const wrongOwner = canonicalProcessProofRecord({
    processOwnerSid: 'S-1-5-21-1000-2000-3000-2002',
    ownerSidMatches: true,
  });
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(wrongOwner, { env: environment }).ok, false);

  const argvSpoof = canonicalProcessProofRecord({
    entrypointToken: '--eval',
    gatewayActionToken: 'run',
    gatewayPortToken: PROCESS_PROOF_ENTRYPOINT,
    commandTokenCount: 5,
  });
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(argvSpoof, { env: environment }).ok, false);

  const arbitraryCmdParent = canonicalProcessProofRecord({
    supportedStarterGatewayPath: 'C:\\attacker\\gateway.cmd',
  });
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(arbitraryCmdParent, { env: environment }).ok, false);

  const differentLoopbackFamily = canonicalProcessProofRecord({ localAddress: '::1' });
  assert.equal(validateOpenClawGateway18789ProcessProofRecord(differentLoopbackFamily, { env: environment }).ok, false);
});

test('fixed Windows 18789 probe derives owner SID and parses exact command and starter tokens', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'windows', 'probe-openclaw-gateway-18789-owner.ps1'), 'utf8');
  assert.match(source, /CommandLineToArgvW/);
  assert.match(source, /Invoke-CimMethod\s+-InputObject\s+\$Process\s+-MethodName\s+GetOwnerSid/);
  assert.match(source, /\$commandTokens\.Count\s+-eq\s+4[\s\S]*'gateway'[\s\S]*'run'/);
  assert.match(source, /\$commandTokens\.Count\s+-eq\s+5[\s\S]*'--port'[\s\S]*'18789'/);
  assert.match(source, /\.openclaw\\gateway\.cmd/);
  assert.match(source, /\$ancestorTokens\.Count\s+-eq\s+3[\s\S]*'\/c'/);
  assert.match(source, /\$ancestorTokens\.Count\s+-eq\s+5[\s\S]*'\/d'[\s\S]*'\/s'[\s\S]*'\/c'/);
  assert.match(source, /\$_.LocalAddress\s+-eq\s+'127\.0\.0\.1'/);
  assert.doesNotMatch(source, /LocalAddress\s+-in\s+@\([^)]*(?:::1|0\.0\.0\.0)/);
  assert.match(source, /function Test-FullyQualifiedWindowsPath/);
  assert.doesNotMatch(source, /IsPathFullyQualified/);
  assert.doesNotMatch(source, /\$lineageCanonical\s*=\s*\$parentPid\s+-gt\s+0\s+-and\s+\$ancestorPids\.Count/);
});

test('Windows 18789 process proof timeout settles fail-closed when killed child never closes', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; };
  const result = await collectOpenClawGateway18789ProcessProof({
    env: { APPDATA: PROCESS_PROOF_APPDATA, USERPROFILE: 'C:\\Users\\Fixture' },
    spawnFn: () => child,
    timeoutMs: 5,
    killAckTimeoutMs: 5,
  });
  assert.equal(killed, true);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_18789_PROCESS_PROBE_TERMINATION_UNPROVEN');
  assert.equal(result.processProofStateUnproven, true);
});

test('supervisor calls approved OpenClaw startup adapter when 18789 is missing', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => { collectCount += 1; return factsFor({ openclaw: collectCount > 1 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['openclaw-gateway'].ready ? 'ready' : 'partial-openclaw-missing' }),
    openClawStartFn: async ({ sharedWorkspace, probeOnly = false }) => { calls.push({ sharedWorkspace, probeOnly }); return { ready: true, started: !probeOnly, target: { commandText: 'openclaw gateway run --port 18789 --bind loopback' }, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' }, healthProof: { ready: true, health: { json: { ok: true } } } }; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((call) => call.probeOnly), [false, true]);
  assert.equal(result.status.services.openClaw18789.start.logPath, '/canonical/openclaw-log');
});

test('OpenClaw command failure blocks with start-failed and does not run UI repair', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ openclaw: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-openclaw-missing' }),
    openClawStartFn: async () => ({ ready: false, started: false, exitCode: 2, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' } }),
    repairFn: async () => { calls.push('ui-repair'); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'openclaw-gateway-18789-start-failed');
  assert.deepEqual(calls, []);
});

test('OpenClaw running without health proof blocks with no-health-proof and surfaces logPath', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ openclaw: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'partial-openclaw-missing' }),
    openClawStartFn: async () => ({ ready: false, started: true, exitCode: null, logPath: '/canonical/openclaw-log', logs: { logPath: '/canonical/openclaw-log' }, healthProof: { ready: false, health: { json: { service: 'openclaw-readonly-adapter-stub', status: 'healthy' } } } }),
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'openclaw-gateway-18789-no-health-proof');
  assert.equal(result.status.phases['OpenClaw gateway 18789'].logPath, '/canonical/openclaw-log');
  assert.match(result.status.nextOperatorAction, /\/canonical\/openclaw-log/);
});

test('default shared workspace is canonical Documents path, not temp Battle Bridge workspace', () => {
  const workspace = defaultBattleBridgeSharedWorkspace({ env: { USERPROFILE: 'C:\\Users\\Stephan' }, platform: 'win32' });
  assert.equal(workspace, path.join('C:\\Users\\Stephan', 'Documents', 'Stephanos-openclaw-workspace'));
  assert.doesNotMatch(workspace, /AppData|Temp|stephanos-battle-bridge-workspace/i);
});



test('approved backend repair command captures stdout stderr exit code and canonical log paths', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-backend-repair-'));
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawnCalls = [];
  const promise = runApprovedBackend8787Start({
    sharedWorkspace: workspace,
    spawnFn: (command, args, options) => {
      spawnCalls.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.end('backend stdout proof\n');
        child.stderr.end('backend stderr proof\n');
        child.emit('exit', 0, null);
      });
      return child;
    },
  });
  const result = await promise;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(spawnCalls[0].command, 'npm');
  assert.deepEqual(spawnCalls[0].args, ['run', 'stephanos:battle-bridge:repair']);
  assert.equal(spawnCalls[0].options.shell, false);
  assert.equal(result.exitCode, 0);
  assert.match(result.logPath, /battle-bridge-backend-8787-repair/);
  assert.equal(fs.readFileSync(result.logs.stdoutLogPath, 'utf8'), 'backend stdout proof\n');
  assert.equal(fs.readFileSync(result.logs.stderrLogPath, 'utf8'), 'backend stderr proof\n');
});

test('Windows backend repair pins System32 cmd and Program Files npm entrypoints', () => {
  const execution = resolveBackendRepairExecution('win32');
  assert.equal(execution.command, BATTLE_BRIDGE_WINDOWS_HOST.cmd);
  assert.deepEqual(execution.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(execution.args[3], `""${BATTLE_BRIDGE_WINDOWS_HOST.npm}" run stephanos:battle-bridge:repair"`);
});


test('backend repair success without health proof blocks with no-health-proof and surfaces canonical logPath', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-supervisor-canonical-'));
  const logPath = path.join(workspace, 'logs', 'battle-bridge-backend-8787-repair', 'fixture');
  const result = await runBattleBridgeIgnitionSupervisor({
    sharedWorkspace: workspace, housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: true, exitCode: 0, logPath, logs: { logPath, stdoutLogPath: path.join(logPath, 'stdout.log'), stderrLogPath: path.join(logPath, 'stderr.log') } }),
    repairFn: async () => { throw new Error('ui repair must not run without backend health proof'); },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-no-health-proof');
  assert.equal(result.status.phases['backend 8787'].logPath, logPath);
  assert.equal(result.status.services.backend8787.repair.logPath, logPath);
});

test('backend repair nonzero blocks with backend repair failed and does not run UI repair', async () => {
  const calls = [];
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor({ backend: false, ui: false }),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'blocked-needs-supervisor-repair' }),
    backendStartFn: async () => ({ started: false, exitCode: 7, logPath: '/canonical/log' }),
    repairFn: async () => { calls.push('ui-repair'); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'backend-8787-repair-failed');
  assert.deepEqual(calls, []);
});


test('backend and OpenClaw ready with UI missing refreshes publisher before UI repair', async () => {
  const calls = [];
  let collectCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => { calls.push('publisher'); }, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => { collectCount += 1; return collectCount === 1 ? factsFor({ ui: false, stale: ['old UNKNOWN'] }) : factsFor({ ui: collectCount > 2 }); },
    plannerFn: (facts) => ({ ...facts, finalVerdict: facts.observedServices['stephanos-ui'].ready ? 'ready' : 'partial-ui-missing' }),
    repairFn: async ({ stdout }) => { calls.push('repair'); stdout.write(JSON.stringify({ ready: true })); return 0; },
    runtimeProofFn: readyRuntimeProof, stdout: { write() {} },
  });
  assert.equal(calls.indexOf('publisher') < calls.indexOf('repair'), true);
  assert.equal(result.ok, true);
});

test('served runtime exact-head proof accepts only the full lowercase current HEAD in gitCommit and runtimeMarker', () => {
  const currentHead = '51600ceb1234567890abcdef1234567890abcdef';
  const proof = evaluateServedRuntimeExactHeadProof({
    currentHead,
    health: { ok: true, gitCommit: currentHead, runtimeMarker: `antifriction-live-v3::${currentHead}::fixture`, buildTimestamp: '2026-07-10T00:00:00.000Z' },
    dist: { ok: true, statusCode: 200 },
  });
  assert.equal(proof.ready, true);
});

test('served runtime exact-head proof rejects every 7 through 39 character prefix and uppercase SHA', () => {
  const currentHead = '51600ceb1234567890abcdef1234567890abcdef';
  for (let length = 7; length <= 39; length += 1) {
    const prefix = currentHead.slice(0, length);
    const proof = evaluateServedRuntimeExactHeadProof({
      currentHead,
      health: { ok: true, gitCommit: prefix, runtimeMarker: `antifriction-live-v3::${prefix}::fixture` },
      dist: { ok: true, statusCode: 200 },
    });
    assert.equal(proof.ready, false, `prefix length ${length}`);
    assert.equal(proof.gitCommitMatches, false, `gitCommit prefix length ${length}`);
    assert.equal(proof.runtimeMarkerMatches, false, `runtimeMarker prefix length ${length}`);
  }
  const uppercase = currentHead.toUpperCase();
  const uppercaseProof = evaluateServedRuntimeExactHeadProof({
    currentHead,
    health: { ok: true, gitCommit: uppercase, runtimeMarker: `antifriction-live-v3::${uppercase}::fixture` },
    dist: { ok: true, statusCode: 200 },
  });
  assert.equal(uppercaseProof.ready, false);
});

test('served runtime proof rejects oversized localhost bodies before JSON parsing', async () => {
  await assert.rejects(
    collectServedRuntimeExactHeadProof({
      currentHead: '5'.repeat(40),
      fetchFn: async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(16 * 1024 + 1) }),
    }),
    /LOCALHOST_RESPONSE_TOO_LARGE/,
  );
});

test('supervisor blocks with served-runtime-stale when 4173 reports old gitCommit after guarded repair', async () => {
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor(),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'ready' }),
    currentHeadFn: () => '51600ceb1234567890abcdef1234567890abcdef',
    runtimeProofFn: async ({ currentHead }) => evaluateServedRuntimeExactHeadProof({ currentHead, health: { ok: true, gitCommit: '0f0aa30d00000000000000000000000000000000', runtimeMarker: 'antifriction-live-v3::0f0aa30d00000000000000000000000000000000::fixture' }, dist: { ok: true, statusCode: 200 } }),
    repairFn: async ({ stdout }) => { stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status.blockerId, 'served-runtime-stale');
  assert.equal(result.status.currentPhase, 'browser/runtime proof');
  assert.match(result.status.nextOperatorAction, /Rebuild\/restart 4173 through guarded UI repair/);
});

test('stale served runtime triggers guarded repair and final ready only after exact-head proof', async () => {
  let proofCount = 0;
  let repairCount = 0;
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {}, publisherFn: async () => {}, sourceTruthFn: () => canonicalSourceTruth(),
    collectFactsFn: async () => factsFor(),
    plannerFn: (facts) => ({ ...facts, finalVerdict: 'ready' }),
    currentHeadFn: () => '51600ceb1234567890abcdef1234567890abcdef',
    runtimeProofFn: async ({ currentHead }) => {
      proofCount += 1;
      const commit = proofCount > 1 ? currentHead : '0f0aa30d00000000000000000000000000000000';
      return evaluateServedRuntimeExactHeadProof({ currentHead, health: { ok: true, gitCommit: commit, runtimeMarker: `antifriction-live-v3::${commit}::fixture` }, dist: { ok: true, statusCode: 200 } });
    },
    repairFn: async ({ stdout }) => { repairCount += 1; stdout.write(JSON.stringify({ ready: true })); return 0; },
    stdout: { write() {} },
  });
  assert.equal(result.ok, true);
  assert.equal(repairCount, 1);
  assert.equal(result.status.services.stephanosUi4173.servedRuntimeProof.ready, true);
});
