#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
} from './battle-bridge-ignition-supervisor.mjs';
import { runIgnitionHousekeep } from './ignite-stephanos-local.mjs';
import {
  battleBridgeCanonicalRepositoryArgs,
  resolveBattleBridgeGitExecution,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendStarterScript = path.join(repoRoot, 'scripts', 'windows', 'start-stephanos-backend.ps1');
const approvedRuntimeRestartScript = path.join(repoRoot, 'scripts', 'windows', 'restart-approved-stephanos-runtime.ps1');
const ui4173RefreshScript = path.join(repoRoot, 'scripts', 'refresh-stephanos-ui-4173.mjs');
const backendHealthUrl = 'http://127.0.0.1:8787/api/health';
const SHA40 = /^[0-9a-f]{40}$/;
const SUPERVISOR_PRESERVED_MUTATION_LABELS = new Map([
  ['git-restore-auto-generated', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-clean-dist-untracked', 'preserve the currently served generated dist until exact-head browser proof completes'],
  ['git-restore-runtime-tracked', 'preserve runtime-owned durable memory; runtime dirt is evidence, not source cleanup authority'],
  ['git-clean-runtime-untracked', 'preserve untracked runtime-owned data; runtime dirt is evidence, not cleanup authority'],
]);

function proveExpectedCurrentGitHead({
  expectedHead,
  currentHeadFn = getCurrentGitHead,
  platform = process.platform,
  blockerPrefix = 'IGNITION',
} = {}) {
  const expected = String(expectedHead || '').trim().toLowerCase();
  if (!SHA40.test(expected)) {
    return Object.freeze({
      ok: false,
      blocker: `${blockerPrefix}_EXPECTED_HEAD_UNPROVEN`,
      expectedHead: expected,
      currentHead: '',
    });
  }

  let currentHead = '';
  try {
    currentHead = String(currentHeadFn({ cwd: repoRoot, platform }) || '').trim().toLowerCase();
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: `${blockerPrefix}_CURRENT_HEAD_UNPROVEN`,
      expectedHead: expected,
      currentHead: '',
      error: error?.message || String(error),
    });
  }
  if (!SHA40.test(currentHead)) {
    return Object.freeze({
      ok: false,
      blocker: `${blockerPrefix}_CURRENT_HEAD_UNPROVEN`,
      expectedHead: expected,
      currentHead,
    });
  }
  if (currentHead !== expected) {
    return Object.freeze({
      ok: false,
      blocker: `${blockerPrefix}_EXACT_HEAD_CHANGED`,
      expectedHead: expected,
      currentHead,
    });
  }
  return Object.freeze({ ok: true, expectedHead: expected, currentHead });
}

export function bindCanonicalSourceTruthToProvenHead({ sourceTruthFn, expectedHead } = {}) {
  if (typeof sourceTruthFn !== 'function') throw new TypeError('sourceTruthFn must be a function');
  const expected = String(expectedHead || '').trim().toLowerCase();
  if (!SHA40.test(expected)) throw new Error('IGNITION_EXPECTED_HEAD_UNPROVEN');

  return (options = {}) => {
    const sourceTruth = sourceTruthFn(options);
    if (!evaluateCanonicalIgnitionSourceTruth(sourceTruth).ok) return sourceTruth;
    const head = String(sourceTruth?.head || '').trim().toLowerCase();
    const originHead = String(sourceTruth?.originHead || '').trim().toLowerCase();
    if (head === expected && originHead === expected) return sourceTruth;
    return Object.freeze({
      ...sourceTruth,
      headPublished: false,
      blockedForRemoteTruth: true,
      publicationState: 'source-truth-unproven',
      blocker: Object.freeze({
        id: 'ignition-exact-head-changed-before-service-mutation',
        code: 'IGNITION_EXACT_HEAD_CHANGED',
        detail: 'Canonical source truth changed after the entry proof and before service mutation.',
        nextOperatorAction: 'Do not mutate runtime services; restore one canonical exact head, then retry Ignition.',
      }),
    });
  };
}

export function runStep(label, command, args, {
  cwd = repoRoot,
  env = process.env,
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const fixedGit = command === 'git' || command === BATTLE_BRIDGE_WINDOWS_HOST.git;
  const gitExecution = fixedGit ? resolveBattleBridgeGitExecution({ platform, environment: env }) : null;
  const executable = fixedGit
    ? gitExecution.executable
    : (command === 'powershell.exe'
      ? BATTLE_BRIDGE_WINDOWS_HOST.powershell
      : (command === 'cmd.exe' ? BATTLE_BRIDGE_WINDOWS_HOST.cmd : command));
  const fixedArgs = fixedGit ? [...gitExecution.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(cwd), ...args] : args;
  console.log(`[IGNITION ENTRY] ${label}: ${executable} ${fixedArgs.join(' ')}`);
  const result = spawnSyncFn(executable, fixedArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: fixedGit ? gitExecution.environment : env,
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
  platform = process.platform,
  spawnSyncFn = spawnSync,
} = {}) {
  const gitExecution = resolveBattleBridgeGitExecution({ platform, environment: env });
  if (command !== 'git' && command !== BATTLE_BRIDGE_WINDOWS_HOST.git && command !== gitExecution.executable) {
    throw new Error(`FIXED_AUTHORITY_GIT_COMMAND_REQUIRED:${label}`);
  }
  const result = spawnSyncFn(
    gitExecution.executable,
    [...gitExecution.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(cwd), ...args],
    { cwd, env: gitExecution.environment, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120_000 },
  );
  if (result?.error || result?.status !== 0) {
    throw new Error(`${label} failed through fixed authority Git (${result?.error?.message || result?.status || 'unknown'}).`);
  }
  return Object.freeze({ stdout: String(result?.stdout || ''), stderr: String(result?.stderr || '') });
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
  {
    housekeepFn = runIgnitionHousekeep,
    runStepFn = null,
    captureStepFn = null,
    cwd = repoRoot,
    env = process.env,
    platform = process.platform,
    spawnSyncFn = spawnSync,
  } = {},
) {
  const fixedRunStep = runStepFn || ((label, command, args) => runStep(
    label,
    command,
    args,
    { cwd, env, platform, spawnSyncFn },
  ));
  const fixedCaptureStep = captureStepFn || ((label, command, args) => captureFixedAuthorityGitStep(
    label,
    command,
    args,
    { cwd, env, platform, spawnSyncFn },
  ));
  return housekeepFn({
    ...options,
    repoRoot: cwd,
    preserveRuntimeDirt: true,
    captureStepFn: fixedCaptureStep,
    runStepFn: createSupervisorHousekeepRunStep({ runStepFn: fixedRunStep }),
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

export async function probeCanonicalBackendHealth({ fetchFn = timeoutFetch } = {}) {
  try {
    const response = await fetchFn(backendHealthUrl, { timeoutMs: 4_000 });
    const payload = await response.json();
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
  }
}

export function backendStarterInvocation(expectedHead) {
  return Object.freeze({
    command: 'powershell.exe',
    args: Object.freeze([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      backendStarterScript,
      '-ExpectedHead',
      expectedHead,
      '-StartupTimeoutSeconds',
      '90',
      '-PollIntervalSeconds',
      '2',
    ]),
  });
}

function approvedBackendRestartInvocation(currentHead) {
  return Object.freeze({
    command: 'powershell.exe',
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
  expectedHead = '',
  runStepFn = runStep,
  currentHeadFn = getCurrentGitHead,
  fetchFn = timeoutFetch,
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({ ok: true, action: 'backend-preflight-skipped-non-windows', restartAttempted: false });
  }

  const entryHeadProof = proveExpectedCurrentGitHead({
    expectedHead,
    currentHeadFn,
    platform,
    blockerPrefix: 'BACKEND_8787',
  });
  if (!entryHeadProof.ok) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: entryHeadProof.blocker,
      expectedHead: entryHeadProof.expectedHead,
      currentHead: entryHeadProof.currentHead,
      restartAttempted: false,
    });
  }

  const currentHead = entryHeadProof.currentHead;
  const starter = backendStarterInvocation(currentHead);
  if (runStepFn('backend-8787-preflight', starter.command, [...starter.args])) {
    return Object.freeze({ ok: true, action: 'backend-preflight-pass', restartAttempted: false });
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
  const restartHeadProof = proveExpectedCurrentGitHead({
    expectedHead,
    currentHeadFn,
    platform,
    blockerPrefix: 'BACKEND_8787',
  });
  if (!restartHeadProof.ok) {
    return Object.freeze({
      ok: false,
      action: 'backend-preflight-blocked',
      blocker: restartHeadProof.blocker,
      expectedHead: restartHeadProof.expectedHead,
      currentHead: restartHeadProof.currentHead,
      observedSourceHead: before.sourceHead,
      restartAttempted: false,
    });
  }
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
  platform = process.platform,
  proofFn = collectServedRuntimeExactHeadProof,
  fetchFn = timeoutFetch,
} = {}) {
  const currentHead = currentHeadFn({ cwd: repoRoot, platform });
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

function canonicalUiRefreshInvocation(expectedHead) {
  return {
    command: process.execPath,
    args: [ui4173RefreshScript, '--expected-head', expectedHead],
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
  expectedHead = '',
  currentHeadFn = getCurrentGitHead,
  probeFn = probeLiveUiExactHead,
  waitFn = waitForLiveUiExactHead,
  runStepFn = runStep,
} = {}) {
  const before = await probeFn({ currentHeadFn, platform });
  const entryHeadProof = proveExpectedCurrentGitHead({
    expectedHead,
    currentHeadFn,
    platform,
    blockerPrefix: 'STEPHANOS_UI_4173',
  });
  if (!entryHeadProof.ok) {
    const error = new Error(`${entryHeadProof.blocker}: expected ${entryHeadProof.expectedHead || 'unproven'}, observed ${entryHeadProof.currentHead || 'unproven'}.`);
    error.code = entryHeadProof.blocker;
    throw error;
  }

  if (!before.reachable) {
    console.log(`[IGNITION ENTRY] 4173 preflight: no live UI proof available (${before.error || 'listener unavailable'}); the full supervisor remains responsible for cold-start repair.`);
    return { action: 'defer-cold-start-to-supervisor', before, after: null };
  }

  if (before.ready) {
    console.log(`[IGNITION ENTRY] 4173 preflight: existing served runtime is exact-head and reusable (${before.currentHead}).`);
    return { action: 'reuse-exact-head-ui', before, after: before };
  }

  console.log('[IGNITION ENTRY] 4173 preflight: live UI is stale; running bounded build, verify, restart handoff, and exact-head proof.');
  const invocation = canonicalUiRefreshInvocation(entryHeadProof.expectedHead);
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
  currentHeadFn = getCurrentGitHead,
  backendPreflightFn = ensureBackend8787ConvergedBeforeSupervisor,
  uiPreflightFn = ensureLiveUiConvergedBeforeSupervisor,
  supervisorFn = runBattleBridgeIgnitionSupervisor,
} = {}) {
  process.chdir(repoRoot);
  const sharedWorkspace = sharedWorkspaceFromArgs();

  const sourceTruth = sourceTruthFn({ cwd: repoRoot, platform });
  const canonicalSourceTruth = evaluateCanonicalIgnitionSourceTruth(sourceTruth);
  if (!canonicalSourceTruth.ok) {
    await writePreSupervisorFailureStatus({
      sharedWorkspace,
      phase: 'source truth',
      blockerId: canonicalSourceTruth.blocker.id,
      detail: canonicalSourceTruth.blocker.detail,
      nextOperatorAction: canonicalSourceTruth.blocker.nextOperatorAction,
    });
    console.error(`[IGNITION ENTRY] Battle Bridge preflight blocked before service mutation because canonical source truth is not ready (${canonicalSourceTruth.blocker.id}).`);
    return 2;
  }

  const expectedHead = String(canonicalSourceTruth.sourceTruth.head || '').trim().toLowerCase();
  const boundSourceTruthFn = bindCanonicalSourceTruthToProvenHead({ sourceTruthFn, expectedHead });
  const proveSourceTruthBeforeMutation = async () => {
    const nextSourceTruth = boundSourceTruthFn({ cwd: repoRoot, platform });
    const nextCanonicalSourceTruth = evaluateCanonicalIgnitionSourceTruth(nextSourceTruth);
    if (nextCanonicalSourceTruth.ok) return true;
    const sourceBlocker = nextCanonicalSourceTruth.blocker || {};
    await writePreSupervisorFailureStatus({
      sharedWorkspace,
      phase: 'source truth',
      blockerId: sourceBlocker.id || 'source-truth-unproven',
      detail: sourceBlocker.detail || 'Canonical source truth changed before service mutation.',
      nextOperatorAction: sourceBlocker.nextOperatorAction || 'Restore one canonical exact head, then retry Ignition.',
    });
    console.error(`[IGNITION ENTRY] Battle Bridge preflight blocked because canonical source truth changed before service mutation (${sourceBlocker.id || 'source-truth-unproven'}).`);
    return false;
  };

  if (platform === 'win32') {
    if (!await proveSourceTruthBeforeMutation()) return 2;
    const backend = await backendPreflightFn({ platform, expectedHead, currentHeadFn });
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

  if (!await proveSourceTruthBeforeMutation()) return 2;
  try {
    await uiPreflightFn({ platform, expectedHead, currentHeadFn });
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
    platform,
    housekeepFn: (options) => runSupervisorHousekeepPreservingLiveRuntime(options, { platform }),
    // Re-run the same fixed collector inside the standalone supervisor before
    // its own housekeeping boundary; do not fall back to a weaker adapter.
    sourceTruthFn: boundSourceTruthFn,
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
