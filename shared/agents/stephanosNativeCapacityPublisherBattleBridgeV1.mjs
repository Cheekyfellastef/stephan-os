import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';
import { readVerifiedStephanosNativeRoutingCandidate } from './stephanosNativeCapacityRoutingAdmissionV1.mjs';

export const STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION = 'INSTALL_STEPHANOS_NATIVE_CAPACITY_PUBLISHER';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const TIMEOUT_MS = 60_000;

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE);
  return profile ? resolve(profile, 'Documents', 'GitHub', 'stephan-os') : '';
}

export function validateStephanosNativeCapacityPublisherInstallCommandShape(command = {}) {
  if (text(command?.operation) !== STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead }),
  });
}

export function isTerminalizableStephanosNativeCapacityPublisherBlocker(value) {
  return new Set([
    'STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED',
    'STEPHANOS_NATIVE_PUBLISHER_EXPECTED_HEAD_REQUIRED',
  ]).has(text(value));
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024,
    ...options,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

function lastJsonObject(stdout = '') {
  const lines = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

export async function proveNativePublisherSignedReadbackV1({
  expectedHead = '', repositoryRoot = '', env = process.env, notBeforeUtc = '',
  verify = readVerifiedStephanosNativeRoutingCandidate,
  sleep = (ms) => new Promise(resolveWait => setTimeout(resolveWait, ms)),
  now = () => new Date(),
} = {}) {
  // StartNow is not execution proof. Require post-request publication of
  // independently verified signed current-head capacity.
  const notBeforeMs = Date.parse(notBeforeUtc);
  if (!Number.isFinite(notBeforeMs)) {
    return Object.freeze({ ok: false, attempt: 0, sourceHead: expectedHead,
      reason: 'STEPHANOS_NATIVE_PUBLISHER_POST_START_BOUNDARY_MISSING',
      finalVerdict: 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_HELD' });
  }
  let sawAuthenticatedStaleHead = false;
  let lastReason = 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_STATUS_NOT_YET_PROVEN';
  for (let attempt = 1; attempt <= 16; attempt += 1) {
    try {
      const v = await verify({
        nowUtc: now().toISOString(),
        repository: 'Cheekyfellastef/stephan-os',
        sourceHead: expectedHead,
        taskClass: 'FOCUSED_REPAIR',
        root: resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace'),
        repoRoot: repositoryRoot, env,
      });
      const c = v?.candidate;
      if (v?.ok === true && c?.sourceHead === expectedHead
        && c?.repository === 'Cheekyfellastef/stephan-os'
        && c?.taskClass === 'FOCUSED_REPAIR'
        && c?.sourceMutationAllowed === true
        && c?.mergeAuthority === false && c?.leaseSeizureAllowed === false) {
        const observedAtMs = Date.parse(c?.capacityObservedAtUtc || '');
        if (Number.isFinite(observedAtMs) && observedAtMs >= notBeforeMs) {
          return Object.freeze({
            ok: true, attempt, sourceHead: expectedHead,
            capacityObservedAtUtc: c.capacityObservedAtUtc,
            finalVerdict: 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_CAPACITY_LIVE_PROVEN',
          });
        }
        lastReason = 'STEPHANOS_NATIVE_PUBLISHER_POST_START_SIGNED_RECEIPT_UNPROVEN';
      } else {
        const reason = text(v?.reason);
        lastReason = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(reason)
          ? reason : 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_TRUST_NOT_PROVEN';
        if (lastReason === 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID') {
          sawAuthenticatedStaleHead = true;
        }
      }
    } catch {
      lastReason = 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_UNAVAILABLE';
    }
    if (attempt < 16) await sleep(10_000);
  }
  // The stale writer may clear its own status before the final sample. Only
  // preserve a witnessed stale head across MISSING, never a new trust error.
  const reason = sawAuthenticatedStaleHead && lastReason === 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING'
    ? 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID' : lastReason;
  return Object.freeze({
    ok: false, attempt: 16, sourceHead: expectedHead, reason,
    finalVerdict: 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_HELD',
  });
}

export async function executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command = {}, options = {}) {
  const shape = validateStephanosNativeCapacityPublisherInstallCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  if (!repositoryRoot) return fail('STEPHANOS_NATIVE_PUBLISHER_USERPROFILE_REQUIRED');
  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const dirt = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok || !dirt.ok) return fail('STEPHANOS_NATIVE_PUBLISHER_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('STEPHANOS_NATIVE_PUBLISHER_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_HEAD_MISMATCH', { expectedHead: shape.expectedHead, observedHead });
  }
  const dirtClassification = classifyDirt(splitLines(dirt.stdout));
  const dirtSummary = Object.freeze({
    trackedSourceCount: dirtClassification.trackedSource.length,
    untrackedSourceCount: dirtClassification.untrackedSource.length,
    runtimeOnlyCount: dirtClassification.runtimeOnly.length,
    generatedSourceCount: dirtClassification.generatedSource.length,
    unknownCount: dirtClassification.unknown.length,
    blocksSync: dirtClassification.blocksSync === true,
  });
  if (dirtClassification.blocksSync) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_SOURCE_DIRT_BLOCKED', { dirtSummary });
  }

  const installer = resolve(repositoryRoot, 'scripts', 'windows', 'install-stephanos-native-capacity-publisher.ps1');
  const installRequestedAtUtc = (options.now || (() => new Date()))().toISOString();
  const install = run(spawnSyncFn, POWERSHELL, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', installer,
    '-StephanosRepositoryRoot', repositoryRoot,
    '-StartNow',
  ]);
  if (!install.ok) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_INSTALL_FAILED', {
      status: install.status,
      stderr: text(install.stderr).slice(0, 500),
    });
  }
  const receipt = lastJsonObject(install.stdout);
  if (
    !receipt
    || receipt.finalVerdict !== 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED'
    || text(receipt.sourceHead).toLowerCase() !== shape.expectedHead
    || receipt.startRequested !== true
    || receipt.arbitraryCommandAllowed !== false
    || receipt.mergeAuthority !== false
    || receipt.leaseSeizureAllowed !== false
  ) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_INSTALL_RECEIPT_INVALID');
  }

  let signed = await proveNativePublisherSignedReadbackV1({
    expectedHead: shape.expectedHead, repositoryRoot, env,
    notBeforeUtc: installRequestedAtUtc,
    verify: options.verifyCandidateFn || readVerifiedStephanosNativeRoutingCandidate,
    sleep: options.sleepFn,
    now: options.now || (() => new Date()),
  });
  let recoveryReceipt = null;
  // The fixed task's IgnoreNew policy can leave a pre-upgrade publisher
  // running after a successful installer StartNow. Repair ONLY a typed signed
  // SOURCE-HEAD-INVALID verdict, after canonical main/dirt and installer
  // identity were already proved; never try a generic process kill.
  if (!signed.ok
    && signed.reason === 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:SOURCE-HEAD-INVALID') {
    const recovery = run(spawnSyncFn, POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repositoryRoot, 'scripts', 'windows',
        'reconcile-stephanos-native-capacity-publisher-stale.ps1'),
      '-ExpectedHead', shape.expectedHead,
      '-RequestId', text(command.requestId),
    ]);
    recoveryReceipt = lastJsonObject(recovery.stdout);
    if (!recovery.ok
      || recoveryReceipt?.finalVerdict !== 'NATIVE_PUBLISHER_FIXED_TASK_RESTART_REQUESTED'
      || recoveryReceipt.expectedHead !== shape.expectedHead
      || recoveryReceipt.taskName !== 'Stephanos Native Capacity Publisher'
      || recoveryReceipt.signedCapacityVerified !== false
      || recoveryReceipt.leaseReleaseAllowed !== false
      || recoveryReceipt.sourceMutationAllowed !== false
      || recoveryReceipt.mergeAuthority !== false) {
      return fail('STEPHANOS_NATIVE_PUBLISHER_BOUNDED_RESTART_BLOCKED', {
        signedCapacityProven: false, previousSignedReason: signed.reason,
        taskName: 'Stephanos Native Capacity Publisher',
        noOtherTaskTouched: true,
        mergeAuthority: false, leaseSeizureAllowed: false,
      });
    }
    signed = await proveNativePublisherSignedReadbackV1({
      expectedHead: shape.expectedHead, repositoryRoot, env,
    notBeforeUtc: installRequestedAtUtc,
      verify: options.verifyCandidateFn || readVerifiedStephanosNativeRoutingCandidate,
      sleep: options.sleepFn,
      now: options.now || (() => new Date()),
    });
  }
  if (!signed.ok) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_NOT_PROVEN', {
      operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
      sourceHead: shape.expectedHead, taskInstalled: true, startRequested: true,
      signedCapacityProven: false, signedReadbackReason: signed.reason,
      boundedRestartAttempted: recoveryReceipt !== null,
      mergeAuthority: false, leaseSeizureAllowed: false,
    });
  }
  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
    requestId: text(command.requestId),
    finalVerdict: 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_CAPACITY_LIVE_PROVEN',
    taskInstalled: true,
    signedCapacityProven: true,
    signedReadbackAttempt: signed.attempt,
    boundedRestartAttempted: recoveryReceipt !== null,
    sourceHead: shape.expectedHead,
    expectedHead: shape.expectedHead,
    expectedHeadMatch: true,
    taskName: text(receipt.taskName),
    startRequested: true,
    dirtSummary,
    arbitraryCommandAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    destructiveGitAllowed: false,
  });
}
