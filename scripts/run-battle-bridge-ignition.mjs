#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fstatSync, readSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  collectCanonicalIgnitionSourceTruth,
  collectServedRuntimeExactHeadProof,
  createBattleBridgeSupervisorStatus,
  defaultBattleBridgeSharedWorkspace,
  evaluateCanonicalIgnitionSourceTruth,
  getCurrentGitHead,
  projectBattleBridgeSupervisorStatus,
  runBattleBridgeIgnitionSupervisor,
  runApprovedOpenClawGateway18789Start,
} from './battle-bridge-ignition-supervisor.mjs';
import { runIgnitionHousekeep } from './ignite-stephanos-local.mjs';
import {
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  battleBridgeCanonicalRepositoryArgs,
  createBattleBridgeMinimalChildEnvironment,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA } from '../shared/agents/battleBridgeExactHeadAsyncUpdateV1.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendStarterScript = path.join(repoRoot, 'scripts', 'windows', 'start-stephanos-backend.ps1');
const approvedRuntimeRestartScript = path.join(repoRoot, 'scripts', 'windows', 'restart-approved-stephanos-runtime.ps1');
const ui4173RefreshScript = path.join(repoRoot, 'scripts', 'refresh-stephanos-ui-4173.mjs');
const backendHealthUrl = 'http://127.0.0.1:8787/api/health';
const SHA40 = /^[0-9a-f]{40}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const MAX_IGNITION_APPROVAL_BYTES = 4096;
const SUPERVISOR_PRESERVED_MUTATION_LABELS = new Map([
  ['git-restore-auto-generated', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-clean-dist-untracked', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-restore-runtime-tracked', 'preserve runtime-owned durable memory; runtime dirt is evidence, not source cleanup authority'],
  ['git-clean-runtime-untracked', 'preserve runtime-owned durable memory; this recovery lane has no delete authority'],
]);

function deferRootWorkspaceMove({ paths = [] } = {}) {
  return {
    destinationRoot: null,
    migrationDirectory: null,
    moved: [],
    skipped: paths.map((pathname) => ({ path: pathname, reason: 'recovery-lane-move-authority-disabled' })),
  };
}

export function bindCanonicalSourceTruthToOwnerApproval({ sourceTruthFn, approval } = {}) {
  if (typeof sourceTruthFn !== 'function') throw new TypeError('sourceTruthFn must be a function');
  if (approval?.approved !== true) return sourceTruthFn;
  const expectedHead = String(approval.expectedHead || '').trim().toLowerCase();
  if (!SHA40.test(expectedHead)) throw new Error('OWNER_IGNITION_EXPECTED_HEAD_INVALID');

  return (options = {}) => {
    const sourceTruth = sourceTruthFn(options);
    if (!evaluateCanonicalIgnitionSourceTruth(sourceTruth).ok) return sourceTruth;
    const head = String(sourceTruth?.head || '').trim().toLowerCase();
    const originHead = String(sourceTruth?.originHead || '').trim().toLowerCase();
    if (head === expectedHead && originHead === expectedHead) return sourceTruth;
    return Object.freeze({
      ...sourceTruth,
      ok: false,
      headPublished: false,
      blockedForRemoteTruth: true,
      publicationState: 'source-truth-unproven',
      blocker: Object.freeze({
        id: 'owner-ignition-exact-head-mismatch',
        code: 'OWNER_IGNITION_EXACT_HEAD_MISMATCH',
        detail: 'Canonical source truth no longer matches the commit approved for this one-use ignition.',
        nextOperatorAction: 'Do not start runtime services; re-enter through the authenticated exact-head owner update route.',
      }),
    });
  };
}

export function runStep(label, command, args, { cwd = repoRoot, env = process.env } = {}) {
  const fixedGit = command === 'git' || command === BATTLE_BRIDGE_WINDOWS_HOST.git;
  const executable = fixedGit
    ? BATTLE_BRIDGE_WINDOWS_HOST.git
    : (command === 'powershell.exe'
      ? BATTLE_BRIDGE_WINDOWS_HOST.powershell
      : (command === 'cmd.exe' ? BATTLE_BRIDGE_WINDOWS_HOST.cmd : command));
  const fixedArgs = fixedGit ? [...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS, ...battleBridgeCanonicalRepositoryArgs(cwd), ...args] : args;
  console.log(`[IGNITION ENTRY] ${label}: ${executable} ${fixedArgs.join(' ')}`);
  const result = spawnSync(executable, fixedArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: fixedGit ? createBattleBridgeMinimalChildEnvironment(env, { git: true }) : env,
  });

  if (result.error || result.status !== 0) {
    const details = [
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error?.message || 'none'}`,
    ].join(', ');
    console.error(`[IGNITION ENTRY] ${label} failed (${details})`);
    return false;
  }

  return true;
}

export function captureFixedAuthorityGitStep(label, command, args, {
  cwd = repoRoot,
  env = process.env,
  spawnSyncFn = spawnSync,
} = {}) {
  if (command !== 'git' && command !== BATTLE_BRIDGE_WINDOWS_HOST.git) {
    throw new Error(`FIXED_AUTHORITY_GIT_COMMAND_REQUIRED:${label}`);
  }
  const result = spawnSyncFn(
    BATTLE_BRIDGE_WINDOWS_HOST.git,
    [...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS, ...battleBridgeCanonicalRepositoryArgs(cwd), ...args],
    { cwd, env: createBattleBridgeMinimalChildEnvironment(env, { git: true }), encoding: 'utf8', shell: false, windowsHide: true, timeout: 120_000 },
  );
  if (result?.error || result?.status !== 0) {
    throw new Error(`${label} failed through fixed authority Git (${result?.error?.message || result?.status || 'unknown'}).`);
  }
  return Object.freeze({ stdout: String(result?.stdout || ''), stderr: String(result?.stderr || '') });
}

export function readOwnerIgnitionApprovalFromPipe({
  fd = 3,
  parentPid = process.ppid,
  childPid = process.pid,
  readSyncFn = readSync,
  fstatFn = fstatSync,
} = {}) {
  let info;
  try { info = fstatFn(fd); } catch { return null; }
  if (!info?.isFIFO?.() && !info?.isSocket?.()) return null;
  const bounded = Buffer.alloc(MAX_IGNITION_APPROVAL_BYTES + 1);
  let length = 0;
  try {
    // The producer writes one sub-PIPE_BUF JSON frame. A single bounded read
    // neither waits for EOF from a writer that keeps its handle open nor
    // allocates beyond the fixed maximum-plus-one rejection byte.
    length = readSyncFn(fd, bounded, 0, bounded.length, null);
    if (!Number.isSafeInteger(length) || length < 0) return null;
  } catch { return null; }
  const bytes = bounded.subarray(0, length);
  if (bytes.length < 2 || bytes.length > MAX_IGNITION_APPROVAL_BYTES) return null;
  let approval;
  try { approval = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  const exactKeys = [
    'action', 'childPid', 'expectedHead', 'nonce', 'parentPid', 'receiptId', 'schemaVersion',
  ];
  if (!approval || typeof approval !== 'object' || Array.isArray(approval)
      || JSON.stringify(Object.keys(approval).sort()) !== JSON.stringify(exactKeys)) return null;
  if (approval.schemaVersion !== BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA
      || approval.action !== 'RUN_EXACT_HEAD_IGNITION'
      || !SHA40.test(String(approval.expectedHead || '').toLowerCase())
      || !HEX32.test(String(approval.receiptId || '').toLowerCase())
      || !HEX32.test(String(approval.nonce || '').toLowerCase())
      || Number(approval.parentPid) !== Number(parentPid)
      || Number(approval.childPid) !== Number(childPid)) return null;
  return Object.freeze({
    approved: true,
    action: approval.action,
    expectedHead: String(approval.expectedHead).toLowerCase(),
    receiptId: String(approval.receiptId).toLowerCase(),
    parentPid: Number(parentPid),
    childPid: Number(childPid),
  });
}

export function createSupervisorHousekeepRunStep({ runStepFn = runStep } = {}) {
  return (label, command, args) => {
    const preservationReason = SUPERVISOR_PRESERVED_MUTATION_LABELS.get(label);
    if (preservationReason) {
      console.log(`[IGNITION ENTRY] ${label} deferred: ${preservationReason}.`);
      return true;
    }

    const ok = runStepFn(label, command, args);
    if (!ok) throw new Error(`${label} failed during Battle Bridge supervisor housekeeping.`);
    return true;
  };
}

export function runSupervisorHousekeepPreservingLiveRuntime(
  options = {},
  { housekeepFn = runIgnitionHousekeep, runStepFn = runStep } = {},
) {
  return housekeepFn({
    ...options,
    captureStepFn: (label, command, args) => captureFixedAuthorityGitStep(label, command, args),
    runStepFn: createSupervisorHousekeepRunStep({ runStepFn }),
    moveRootOpenClawWorkspaceDirtFn: deferRootWorkspaceMove,
  });
}

export const runSupervisorHousekeepPreservingLiveDist = runSupervisorHousekeepPreservingLiveRuntime;

function timeoutFetch(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 4_000);
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      Accept: 'application/json,text/html,*/*',
      'Cache-Control': 'no-cache',
      ...(options.headers || {}),
    },
  });
}

async function readBoundedJsonResponse(response, maxBytes = 16 * 1024) {
  if (response?.body?.getReader || typeof response?.text === 'function') {
    let text = '';
    if (response?.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value || []);
          total += chunk.length;
          if (total > maxBytes) throw new Error('BACKEND_HEALTH_RESPONSE_TOO_LARGE');
          chunks.push(chunk);
        }
      } finally {
        if (total > maxBytes) await reader.cancel?.().catch?.(() => {});
        reader.releaseLock?.();
      }
      text = Buffer.concat(chunks, total).toString('utf8');
    } else {
      text = String(await response.text());
      if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('BACKEND_HEALTH_RESPONSE_TOO_LARGE');
    }
    return JSON.parse(text);
  }
  const payload = await response.json();
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxBytes) throw new Error('BACKEND_HEALTH_RESPONSE_TOO_LARGE');
  return payload;
}

export async function probeCanonicalBackendHealth({ fetchFn = timeoutFetch } = {}) {
  let timer;
  try {
    const operation = (async () => {
      const response = await fetchFn(backendHealthUrl, { timeoutMs: 4_000 });
      return { response, payload: await readBoundedJsonResponse(response) };
    })();
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('BACKEND_HEALTH_RESPONSE_TIMEOUT')), 4_500);
      timer.unref?.();
    });
    const { response, payload } = await Promise.race([operation, timeout]);
    const sourceHead = String(payload?.backendIdentity?.sourceHead || '').trim().toLowerCase();
    const canonical = Number(response?.status || 0) === 200
      && payload?.schemaVersion === 'stephanos.backend-health.v1'
      && payload?.backendIdentity?.runtimeId === 'stephanos-battle-bridge-backend'
      && SHA40.test(sourceHead);
    return Object.freeze({
      reachable: true,
      canonical,
      sourceHead: canonical ? sourceHead : '',
      error: '',
    });
  } catch (error) {
    return Object.freeze({
      reachable: false,
      canonical: false,
      sourceHead: '',
      error: error?.message || String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

function backendStarterInvocation() {
  return Object.freeze({
    command: BATTLE_BRIDGE_WINDOWS_HOST.powershell,
    args: Object.freeze([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      backendStarterScript,
      '-StartupTimeoutSeconds',
      '90',
      '-PollIntervalSeconds',
      '2',
    ]),
  });
}

function approvedBackendRestartInvocation(currentHead) {
  return Object.freeze({
    command: BATTLE_BRIDGE_WINDOWS_HOST.powershell,
    args: Object.freeze([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      approvedRuntimeRestartScript,
      '-Target',
      'backend',
      '-ExpectedHead',
      currentHead,
      '-TimeoutSeconds',
      '90',
    ]),
  });
}

export async function ensureBackend8787ConvergedBeforeSupervisor({
  platform = process.platform,
  runStepFn = runStep,
  currentHeadFn = getCurrentGitHead,
  fetchFn = timeoutFetch,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({ ok: true, action: 'backend-preflight-skipped-non-windows', restartAttempted: false });
  }

  const starter = backendStarterInvocation();
  if (runStepFn('backend-8787-preflight', starter.command, [...starter.args])) {
    return Object.freeze({ ok: true, action: 'backend-preflight-pass', restartAttempted: false });
  }

  const currentHead = String(currentHeadFn({ cwd: repoRoot }) || '').trim().toLowerCase();
  if (!SHA40.test(currentHead)) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: 'BACKEND_8787_CURRENT_HEAD_UNPROVEN',
      restartAttempted: false,
    });
  }

  const before = await probeCanonicalBackendHealth({ fetchFn });
  if (!before.canonical || !before.sourceHead || before.sourceHead === currentHead) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: before.canonical
        ? 'BACKEND_8787_SAME_HEAD_PREFLIGHT_FAILED'
        : 'BACKEND_8787_STALE_LISTENER_NOT_QUALIFIED',
      currentHead,
      observedSourceHead: before.sourceHead,
      restartAttempted: false,
    });
  }

  console.log(`[IGNITION ENTRY] 8787 preflight: canonical stale backend ${before.sourceHead} occupies the port; delegating replacement to the approved exact-head restart primitive for ${currentHead}.`);
  const restart = approvedBackendRestartInvocation(currentHead);
  const restarted = runStepFn('backend-8787-approved-stale-restart', restart.command, [...restart.args]);
  if (!restarted) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: 'BACKEND_8787_APPROVED_STALE_RESTART_FAILED',
      currentHead,
      observedSourceHead: before.sourceHead,
      restartAttempted: true,
    });
  }

  const after = await probeCanonicalBackendHealth({ fetchFn });
  if (!after.canonical || after.sourceHead !== currentHead) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: 'BACKEND_8787_APPROVED_RESTART_EXACT_HEAD_PROOF_FAILED',
      currentHead,
      observedSourceHead: after.sourceHead,
      restartAttempted: true,
    });
  }

  return Object.freeze({
    ok: true,
    action: 'backend-approved-stale-restart-pass',
    currentHead,
    replacedSourceHead: before.sourceHead,
    restartAttempted: true,
  });
}

export async function probeLiveUiExactHead({
  currentHeadFn = getCurrentGitHead,
  proofFn = collectServedRuntimeExactHeadProof,
  fetchFn = timeoutFetch,
} = {}) {
  const currentHead = currentHeadFn({ cwd: repoRoot });
  try {
    const proof = await proofFn({ currentHead, fetchFn });
    return {
      reachable: true,
      ready: proof?.ready === true,
      currentHead,
      proof,
      error: '',
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      currentHead,
      proof: null,
      error: error?.message || String(error),
    };
  }
}

function canonicalUiRefreshInvocation() {
  return {
    command: process.execPath,
    args: [ui4173RefreshScript],
  };
}

export async function waitForLiveUiExactHead({
  probeFn = probeLiveUiExactHead,
  timeoutMs = 120_000,
  intervalMs = 500,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  do {
    last = await probeFn();
    if (last.ready) return last;
    if (Date.now() >= deadline) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  } while (Date.now() <= deadline);

  return last || { reachable: false, ready: false, error: 'no exact-head proof collected' };
}

export async function ensureLiveUiConvergedBeforeSupervisor({
  platform = process.platform,
  probeFn = probeLiveUiExactHead,
  waitFn = waitForLiveUiExactHead,
  runStepFn = runStep,
} = {}) {
  const before = await probeFn();

  if (!before.reachable) {
    console.log(`[IGNITION ENTRY] 4173 preflight: no live UI proof available (${before.error || 'listener unavailable'}); the full supervisor remains responsible for cold-start repair.`);
    return { action: 'defer-cold-start-to-supervisor', before, after: null };
  }

  if (before.ready) {
    console.log(`[IGNITION ENTRY] 4173 preflight: existing served runtime is exact-head and reusable (${before.currentHead}).`);
    return { action: 'reuse-exact-head-ui', before, after: before };
  }

  console.log('[IGNITION ENTRY] 4173 preflight: live UI is stale; running bounded build, verify, restart handoff, and exact-head proof.');
  const invocation = canonicalUiRefreshInvocation(platform);
  const refreshStarted = runStepFn('refresh-stale-ui-4173', invocation.command, invocation.args);
  if (!refreshStarted) {
    throw new Error('Bounded UI 4173 refresh failed before Battle Bridge supervisor proof.');
  }

  const after = await waitFn();
  if (!after?.ready) {
    throw new Error(`Bounded UI 4173 refresh completed without exact-head browser proof (${after?.error || 'served runtime remained stale'}).`);
  }

  console.log(`[IGNITION ENTRY] 4173 preflight: stale runtime converged to exact HEAD ${after.currentHead}.`);
  return { action: 'refreshed-stale-ui', before, after };
}

function sharedWorkspaceFromArgs(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--shared-workspace');
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function writePreSupervisorFailureStatus({
  sharedWorkspace = defaultBattleBridgeSharedWorkspace(),
  phase = 'backend 8787',
  blockerId = 'ignition-pre-supervisor-failure',
  detail = 'Ignition failed before the Battle Bridge supervisor could start.',
  nextOperatorAction = 'Inspect the bounded ignition child logs, resolve the exact blocker, then retry Ignition.',
} = {}) {
  let status = createBattleBridgeSupervisorStatus();
  status = projectBattleBridgeSupervisorStatus({
    status,
    phase,
    phaseState: 'blocked',
    blocker: {
      id: blockerId,
      detail,
      nextOperatorAction,
    },
  });

  const statusDir = path.resolve(sharedWorkspace, 'status');
  const statusPath = path.join(statusDir, 'battle-bridge-ignition-supervisor-current.json');
  await fs.mkdir(statusDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
  return { statusPath, status };
}

export async function main({
  platform = process.platform,
  sourceTruthFn = collectCanonicalIgnitionSourceTruth,
  backendPreflightFn = ensureBackend8787ConvergedBeforeSupervisor,
  uiPreflightFn = ensureLiveUiConvergedBeforeSupervisor,
  supervisorFn = runBattleBridgeIgnitionSupervisor,
  approvalFn = readOwnerIgnitionApprovalFromPipe,
  currentHeadFn = getCurrentGitHead,
} = {}) {
  process.chdir(repoRoot);
  const sharedWorkspace = sharedWorkspaceFromArgs();
  const approval = approvalFn();
  if (approval?.approved === true) {
    let currentHead = '';
    try {
      currentHead = String(currentHeadFn({ cwd: repoRoot, platform }) || '').trim().toLowerCase();
    } catch {
      await writePreSupervisorFailureStatus({
        sharedWorkspace,
        phase: 'source truth',
        blockerId: 'owner-ignition-current-head-unproven',
        detail: 'The fixed current source head could not be read for the one-use owner ignition approval.',
        nextOperatorAction: 'Do not start runtime services; restore canonical Git source truth and re-enter through the authenticated exact-head owner update route.',
      });
      return 1;
    }
    if (currentHead !== approval.expectedHead) {
      await writePreSupervisorFailureStatus({
        sharedWorkspace,
        phase: 'source truth',
        blockerId: 'owner-ignition-exact-head-mismatch',
        detail: 'The one-use owner ignition approval did not match the fixed current source head.',
        nextOperatorAction: 'Do not start runtime services; re-enter through the authenticated exact-head owner update route.',
      });
      return 1;
    }
  }

  const ownerBoundSourceTruthFn = bindCanonicalSourceTruthToOwnerApproval({ sourceTruthFn, approval });
  const sourceTruth = ownerBoundSourceTruthFn({ cwd: repoRoot });
  const canonicalSourceTruth = evaluateCanonicalIgnitionSourceTruth(sourceTruth);
  if (!canonicalSourceTruth.ok) {
    const sourceBlocker = canonicalSourceTruth.blocker || {};
    await writePreSupervisorFailureStatus({
      sharedWorkspace,
      phase: 'source truth',
      blockerId: sourceBlocker.id || 'source-truth-unproven',
      detail: sourceBlocker.detail || 'Canonical clean, current main source truth was not proven before any backend, UI, or OpenClaw service mutation.',
      nextOperatorAction: sourceBlocker.nextOperatorAction || 'Use the bounded owner exact-head update route or restore canonical main source truth, then retry Ignition.',
    });
    return 2;
  }

  if (platform === 'win32') {
    const backend = await backendPreflightFn({ platform });
    if (!backend.ok) {
      await writePreSupervisorFailureStatus({
        sharedWorkspace,
        phase: 'backend 8787',
        blockerId: 'backend-8787-preflight-failed-before-supervisor',
        detail: `The bounded backend 8787 preflight failed before the Battle Bridge supervisor could publish its first heartbeat (${backend.blocker || 'unknown backend preflight blocker'}).`,
        nextOperatorAction: 'Inspect the bounded backend preflight and approved-restart logs, resolve the reported source/runtime or listener blocker, then retry Ignition.',
      });
      console.error(`[IGNITION ENTRY] Battle Bridge supervisor not started because the backend-only 8787 preflight failed (${backend.blocker || 'unknown blocker'}).`);
      return 1;
    }
  }

  try {
    await uiPreflightFn({ platform });
  } catch (error) {
    await writePreSupervisorFailureStatus({
      sharedWorkspace,
      phase: 'Stephanos UI 4173',
      blockerId: 'stephanos-ui-4173-preflight-failed-before-supervisor',
      detail: error?.message || 'The bounded UI 4173 preflight failed before the Battle Bridge supervisor could publish its first heartbeat.',
      nextOperatorAction: 'Inspect the bounded UI refresh/proof logs, resolve the exact-head served-runtime blocker, then retry Ignition.',
    });
    throw error;
  }

  const result = await supervisorFn({
    sharedWorkspace,
    housekeepFn: (options) => runSupervisorHousekeepPreservingLiveRuntime(options),
    sourceTruthFn: ownerBoundSourceTruthFn,
    currentHeadFn: (options = {}) => currentHeadFn({ ...options, platform }),
    ...(approval?.approved === true ? {
      openClawStartFn: (options) => runApprovedOpenClawGateway18789Start({
        ...options,
        env: process.env,
        token: '',
        approved: true,
        ownerApproval: approval,
        platform,
      }),
    } : {}),
  });

  return result.ok ? 0 : 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
