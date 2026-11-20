import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';
import {
  readVerifiedStephanosNativeRoutingCandidate,
  readVerifiedStephanosNativeStalePublisherHeadV1,
} from './stephanosNativeCapacityRoutingAdmissionV1.mjs';

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

// The fixed installer and one-task reconciler emit a single compact receipt.
// Never search backwards for plausible JSON: a trailing message or a second
// object makes the result ambiguous and cannot prove installation or restart.
export function parseNativePublisherInstallerReceiptV1(stdout = '') {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > 32 * 1024) return null;
  const raw = stdout.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed : null;
  } catch {
    return null;
  }
}

export async function proveNativePublisherSignedReadbackV1({
  expectedHead = '', repositoryRoot = '', env = process.env, notBeforeUtc = '',
  verify = readVerifiedStephanosNativeRoutingCandidate,
  verifyStale = readVerifiedStephanosNativeStalePublisherHeadV1,
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
  let lastTruthInput = '';
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
        lastTruthInput = '';
      } else {
        const reason = text(v?.reason);
        lastReason = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/.test(reason)
          ? reason : 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_TRUST_NOT_PROVEN';
        lastTruthInput = (lastReason === 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING'
          || lastReason === 'STEPHANOS_NATIVE_ROUTING_TRUTH_READ_FAILED')
          && (v?.truthInput === 'STATUS' || v?.truthInput === 'PUBLIC_KEY')
          ? v.truthInput : '';
        // A source-head-invalid error does not verify the Ed25519 signature.
        // Require separate signed old-head proof observed after StartNow.
        try {
          const stale = await verifyStale({
            nowUtc: now().toISOString(),
            repository: 'Cheekyfellastef/stephan-os',
            sourceHead: expectedHead,
            taskClass: 'FOCUSED_REPAIR',
            root: resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace'),
            repoRoot: repositoryRoot, env,
          });
          const observedAtMs = Date.parse(stale?.capacityObservedAtUtc || '');
          if (stale?.ok === true && stale?.verifiedSignedReceipt === true
            && stale?.expectedHead === expectedHead
            && stale?.repository === 'Cheekyfellastef/stephan-os'
            && /^[0-9a-f]{40}$/.test(stale?.signedStaleHead || '')
            && stale.signedStaleHead !== expectedHead
            && Number.isFinite(observedAtMs) && observedAtMs >= notBeforeMs) {
            sawAuthenticatedStaleHead = true;
          }
        } catch {
          // No stale proof: no task-stop authority.
        }
      }
    } catch {
      lastReason = 'STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_UNAVAILABLE';
      lastTruthInput = '';
    }
    if (attempt < 16) await sleep(10_000);
  }
  // The stale writer may clear its own status before the final sample. Only
  // preserve a witnessed stale head across MISSING, never a new trust error.
  const reason = sawAuthenticatedStaleHead && (
    lastReason === 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING'
    || lastReason === 'STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:source-head-invalid'
  ) ? 'STEPHANOS_NATIVE_PUBLISHER_AUTHENTICATED_STALE_SOURCE_HEAD' : lastReason;
  return Object.freeze({
    ok: false, attempt: 16, sourceHead: expectedHead, reason,
    truthInput: reason === lastReason ? lastTruthInput : '',
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
  const install = run(spawnSyncFn, POWERSHELL, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', installer,
    '-StephanosRepositoryRoot', repositoryRoot,
    '-StartNow',
  ]);
  if (!install.ok) {
    // A PowerShell diagnostic may contain private Windows paths, identities or
    // command arguments. Only the exit status is eligible for public mailbox proof.
    return fail('STEPHANOS_NATIVE_PUBLISHER_INSTALL_FAILED', {
      status: install.status,
    });
  }
  const receipt = parseNativePublisherInstallerReceiptV1(install.stdout);
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

  // StartNow is requested within the fixed installer. An observation from
  // the interval before its completion cannot certify new publisher work.
  // Only post-completion, independently signed current-head capacity qualifies.
  const installCompletedAtUtc = (options.now || (() => new Date()))().toISOString();
  let signed = await proveNativePublisherSignedReadbackV1({
    expectedHead: shape.expectedHead, repositoryRoot, env,
    notBeforeUtc: installCompletedAtUtc,
    verify: options.verifyCandidateFn || readVerifiedStephanosNativeRoutingCandidate,
    verifyStale: options.verifyStaleFn || readVerifiedStephanosNativeStalePublisherHeadV1,
    sleep: options.sleepFn,
    now: options.now || (() => new Date()),
  });
  let recoveryReceipt = null;
  // The fixed task's IgnoreNew policy can leave a pre-upgrade publisher
  // running after a successful installer StartNow. Repair ONLY a typed signed
  // SOURCE-HEAD-INVALID verdict, after canonical main/dirt and installer
  // identity were already proved; never try a generic process kill.
  if (!signed.ok
    && signed.reason === 'STEPHANOS_NATIVE_PUBLISHER_AUTHENTICATED_STALE_SOURCE_HEAD') {
    const recovery = run(spawnSyncFn, POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repositoryRoot, 'scripts', 'windows',
        'reconcile-stephanos-native-capacity-publisher-stale.ps1'),
      '-ExpectedHead', shape.expectedHead,
      '-RequestId', text(command.requestId),
    ]);
    recoveryReceipt = parseNativePublisherInstallerReceiptV1(recovery.stdout);
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
    // An installation-era signed receipt cannot certify the recovery restart.
    // Require a new signed observation after the fixed-task reconciliation ends.
    const recoveryCompletedAtUtc = (options.now || (() => new Date()))().toISOString();
    signed = await proveNativePublisherSignedReadbackV1({
      expectedHead: shape.expectedHead, repositoryRoot, env,
      notBeforeUtc: recoveryCompletedAtUtc,
      verify: options.verifyCandidateFn || readVerifiedStephanosNativeRoutingCandidate,
    verifyStale: options.verifyStaleFn || readVerifiedStephanosNativeStalePublisherHeadV1,
      sleep: options.sleepFn,
      now: options.now || (() => new Date()),
    });
  }
  if (!signed.ok) {
    return fail('STEPHANOS_NATIVE_PUBLISHER_SIGNED_READBACK_NOT_PROVEN', {
      operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
      sourceHead: shape.expectedHead, taskInstalled: true, startRequested: true,
      signedCapacityProven: false, signedReadbackReason: signed.reason,
      signedReadbackTruthInput: signed.truthInput === 'STATUS'
        || signed.truthInput === 'PUBLIC_KEY' ? signed.truthInput : '',
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
