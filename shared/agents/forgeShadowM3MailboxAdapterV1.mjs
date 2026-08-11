import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY,
  prepareForgeShadowM3RunnerArtifacts,
} from './forgeShadowM3ArtifactPreparationV1.mjs';
import { createForgeShadowM3FixedProofExecutor } from './forgeShadowM3FixedProofExecutorV1.mjs';
import {
  FORGE_SHADOW_M3_EXECUTION_READY,
  FORGE_SHADOW_M3_EXECUTION_SURFACE,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
  buildForgeShadowM3RuntimePlanDigest,
  executeForgeShadowM3RunnerPlan,
} from './forgeShadowM3RunnerExecutionReceiptAdapterV1.mjs';
import { planForgeShadowM3RunnerRuntime } from './forgeShadowM3RunnerRuntimePlanV1.mjs';
import { getReadableMailboxReceiptFilenames } from './windowsSafeMailboxReceiptFilename.mjs';

export const FORGE_SHADOW_M3_PREPARE_OPERATION = 'PREPARE_FORGE_SHADOW_M3_ARTIFACTS';
export const FORGE_SHADOW_M3_EXECUTE_OPERATION = 'EXECUTE_FORGE_SHADOW_M3';
export const FORGE_SHADOW_M3_MAILBOX_OPERATIONS = Object.freeze([
  FORGE_SHADOW_M3_PREPARE_OPERATION,
  FORGE_SHADOW_M3_EXECUTE_OPERATION,
]);

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA40 = /^[0-9a-f]{40}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RECEIPT_SCHEMA = 'stephanos.battle-bridge-github-command-receipt.v1';
const MAX_RECEIPT_BYTES = 256 * 1024;
const COMMON_FIELDS = new Set([
  'schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber', 'branch',
  'operatorApproval', 'expectedHead', 'expiresAt',
]);
const M3_FIELDS = Object.freeze([
  'expectedTree', 'observationId', 'm3Only', 'm2RequestId', 'artifactRequestId',
  'runtimeAuthorizationId', 'runtimePlanDigest', 'planAtUtc', 'runtimeExpiresAtUtc',
]);
const PREPARE_FIELDS = new Set(['expectedTree', 'observationId', 'm3Only']);
const EXECUTE_FIELDS = new Set([
  'expectedTree', 'm3Only', 'm2RequestId', 'artifactRequestId', 'runtimeAuthorizationId',
  'runtimePlanDigest', 'planAtUtc', 'runtimeExpiresAtUtc',
]);

const text = (value) => String(value ?? '').trim();

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, ...details });
}

function instant(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return Number.NaN;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function forgeShadowM3MailboxFields() {
  return Object.freeze([...M3_FIELDS]);
}

export function validateForgeShadowM3MailboxCommand(command = {}, { now = new Date() } = {}) {
  if (!FORGE_SHADOW_M3_MAILBOX_OPERATIONS.includes(command.operation)) return fail('FORGE_M3_OPERATION_INVALID');
  const operationFields = command.operation === FORGE_SHADOW_M3_PREPARE_OPERATION ? PREPARE_FIELDS : EXECUTE_FIELDS;
  const unexpected = Object.keys(command).find((field) => !COMMON_FIELDS.has(field) && !operationFields.has(field));
  if (unexpected) return fail('FORGE_M3_FIELD_NOT_ALLOWED', { field: unexpected });
  if (!SHA40.test(text(command.expectedHead)) || !SHA40.test(text(command.expectedTree))) {
    return fail('FORGE_M3_SOURCE_IDENTITY_REQUIRED');
  }
  if (command.m3Only !== true) return fail('FORGE_M3_ONLY_REQUIRED');

  if (command.operation === FORGE_SHADOW_M3_PREPARE_OPERATION) {
    if (!SAFE_ID.test(text(command.observationId)) || text(command.observationId) === text(command.requestId)) {
      return fail('FORGE_M3_OBSERVATION_ID_INVALID');
    }
    return Object.freeze({
      ok: true,
      command: Object.freeze({
        expectedTree: text(command.expectedTree).toLowerCase(),
        observationId: text(command.observationId),
        m3Only: true,
      }),
    });
  }

  for (const [field, value] of [
    ['m2RequestId', command.m2RequestId],
    ['artifactRequestId', command.artifactRequestId],
    ['runtimeAuthorizationId', command.runtimeAuthorizationId],
  ]) {
    if (!SAFE_ID.test(text(value))) return fail('FORGE_M3_REFERENCE_ID_INVALID', { field });
  }
  if (command.m2RequestId === command.artifactRequestId
      || [command.m2RequestId, command.artifactRequestId].includes(command.requestId)) {
    return fail('FORGE_M3_REFERENCE_IDS_MUST_DIFFER');
  }
  if (!DIGEST.test(text(command.runtimePlanDigest))) return fail('FORGE_M3_RUNTIME_PLAN_DIGEST_INVALID');
  const nowMs = now instanceof Date ? now.getTime() : instant(now);
  const planAtMs = instant(command.planAtUtc);
  const runtimeExpiresMs = instant(command.runtimeExpiresAtUtc);
  const commandExpiresMs = instant(command.expiresAt);
  if (![nowMs, planAtMs, runtimeExpiresMs, commandExpiresMs].every(Number.isFinite)) {
    return fail('FORGE_M3_RUNTIME_TIME_INVALID');
  }
  if (planAtMs > nowMs || nowMs >= runtimeExpiresMs || runtimeExpiresMs <= planAtMs
      || runtimeExpiresMs - planAtMs > 2 * 60 * 60 * 1000
      || runtimeExpiresMs > commandExpiresMs) return fail('FORGE_M3_RUNTIME_WINDOW_INVALID');
  return Object.freeze({
    ok: true,
    command: Object.freeze({
      expectedTree: text(command.expectedTree).toLowerCase(),
      m3Only: true,
      m2RequestId: text(command.m2RequestId),
      artifactRequestId: text(command.artifactRequestId),
      runtimeAuthorizationId: text(command.runtimeAuthorizationId),
      runtimePlanDigest: text(command.runtimePlanDigest).toLowerCase(),
      planAtUtc: new Date(planAtMs).toISOString(),
      runtimeExpiresAtUtc: new Date(runtimeExpiresMs).toISOString(),
    }),
  });
}

function fixedReceiptRoot() {
  const workspace = resolve(process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || join(homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  return join(workspace, 'receipts', 'github-command-mailbox');
}

export function readForgeShadowM3MailboxReceipt(requestId, { receiptRoot = fixedReceiptRoot() } = {}) {
  if (!SAFE_ID.test(text(requestId))) throw new Error('FORGE_M3_RECEIPT_ID_INVALID');
  for (const filename of getReadableMailboxReceiptFilenames(requestId)) {
    const receiptPath = join(receiptRoot, filename);
    let info;
    try { info = lstatSync(receiptPath); }
    catch (error) { if (error?.code === 'ENOENT') continue; throw new Error('FORGE_M3_RECEIPT_READ_FAILED'); }
    if (!info.isFile() || info.size < 2 || info.size > MAX_RECEIPT_BYTES) throw new Error('FORGE_M3_RECEIPT_FILE_INVALID');
    let receipt;
    try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); }
    catch { throw new Error('FORGE_M3_RECEIPT_JSON_INVALID'); }
    if (receipt?.schemaVersion !== RECEIPT_SCHEMA || receipt?.requestId !== requestId) {
      throw new Error('FORGE_M3_RECEIPT_IDENTITY_INVALID');
    }
    return receipt;
  }
  throw new Error('FORGE_M3_RECEIPT_NOT_FOUND');
}

function fixedPool(runnerClass, artifactDigest) {
  const linux = runnerClass === 'linux-isolated';
  return Object.freeze({
    poolId: linux ? 'forge-linux-build-test-v1' : 'forge-windows-proof-v1',
    runnerClass,
    count: 1,
    runtimeBoundary: linux ? 'forge-linux-rootless-ephemeral' : 'battle-bridge-windows-proof-sandbox',
    runtimeArtifactDigest: artifactDigest,
    workloadIds: Object.freeze(linux
      ? ['linux-shared-agent-tests', 'linux-stephanos-ui-build']
      : ['windows-source-controlled-proof']),
    cpuLimit: linux ? 4 : 2,
    memoryMiB: 4096,
    diskMiB: 16384,
    maxJobMinutes: linux ? 45 : 60,
    maxConcurrentJobs: 1,
    artifactRetentionDays: 14,
    maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job',
    artifactPolicy: 'immutable-content-addressed',
    networkPolicy: linux
      ? 'forge-loopback-and-approved-readonly-egress'
      : 'battle-bridge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization',
    ephemeralWorkspace: true,
    limitedUser: true,
    privileged: false,
    hostNetwork: false,
    hostProcessAccess: false,
    canonicalCheckoutMounted: false,
    containerSocketMounted: false,
    githubCredentialAvailable: false,
    persistentSecrets: false,
    publicInbound: false,
    tailscaleInbound: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    registrationRequested: false,
    executed: false,
  });
}

function terminalResult(receipt, operation, head, tree) {
  if (receipt?.operation !== operation || receipt?.state !== 'DONE' || text(receipt?.blocker)
      || text(receipt?.expectedHead).toLowerCase() !== head
      || (tree && text(receipt?.expectedTree).toLowerCase() !== tree)
      || receipt?.result?.ok !== true || receipt?.result?.verdict !== 'COMMAND_EXECUTION_COMPLETE'
      || receipt?.result?.operation !== operation || receipt?.result?.requestId !== receipt.requestId) return null;
  return receipt.result.result;
}

export async function executeForgeShadowM3ArtifactPreparationOnBattleBridge(command = {}, {
  now = () => new Date(),
  prepare = prepareForgeShadowM3RunnerArtifacts,
} = {}) {
  const nowValue = now();
  const result = await prepare({
    repository: REPOSITORY,
    expectedHead: text(command.expectedHead).toLowerCase(),
    expectedTree: text(command.expectedTree).toLowerCase(),
    requestId: text(command.requestId),
    observationId: text(command.observationId),
    requestedAtUtc: (nowValue instanceof Date ? nowValue : new Date(nowValue)).toISOString(),
    operatorApproved: command.operatorApproval === 'operator-approved',
    m3Only: command.m3Only === true,
  });
  return result?.ok === true && result?.finalVerdict === FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY
    ? result
    : Object.freeze({ ...result, ok: false });
}

export async function executeForgeShadowM3OnBattleBridge(command = {}, {
  now = () => new Date(),
  platform = process.platform,
  readReceipt = readForgeShadowM3MailboxReceipt,
  executePlan = executeForgeShadowM3RunnerPlan,
  createExecutor = createForgeShadowM3FixedProofExecutor,
} = {}) {
  const head = text(command.expectedHead).toLowerCase();
  const tree = text(command.expectedTree).toLowerCase();
  let m2Receipt;
  let artifactReceipt;
  try {
    m2Receipt = await readReceipt(command.m2RequestId);
    artifactReceipt = await readReceipt(command.artifactRequestId);
  } catch (error) {
    return fail(error?.message || 'FORGE_M3_PREREQUISITE_RECEIPT_READ_FAILED');
  }
  const m2Result = terminalResult(m2Receipt, 'INSTALL_FORGE_SHADOW_M2', head, '');
  const artifactResult = terminalResult(artifactReceipt, FORGE_SHADOW_M3_PREPARE_OPERATION, head, tree);
  if (!m2Result) return fail('FORGE_M3_M2_RECEIPT_INVALID');
  if (!artifactResult || artifactResult.finalVerdict !== FORGE_SHADOW_M3_ARTIFACT_PREPARATION_READY
      || artifactResult.cacheReceipt?.valid !== true || artifactResult.sourceHead !== head
      || artifactResult.sourceTree !== tree || !Array.isArray(artifactResult.artifactResolutions)
      || artifactResult.artifactResolutions.length !== 2) return fail('FORGE_M3_ARTIFACT_RECEIPT_INVALID');

  const artifacts = artifactResult.artifactResolutions;
  const runtimePlanInput = Object.freeze({
    repository: REPOSITORY,
    canonicalMainHead: head,
    canonicalMainTree: tree,
    nowUtc: command.planAtUtc,
    admissionInput: Object.freeze({
      repository: REPOSITORY,
      canonicalMainHead: head,
      canonicalMainTree: tree,
      nowUtc: command.planAtUtc,
      m2Receipt,
      runnerPools: Object.freeze([
        fixedPool('windows-proof-isolated', artifacts.find((item) => item.runnerClass === 'windows-proof-isolated')?.artifactDigest),
        fixedPool('linux-isolated', artifacts.find((item) => item.runnerClass === 'linux-isolated')?.artifactDigest),
      ]),
    }),
    artifactResolutions: artifacts,
  });
  const plan = planForgeShadowM3RunnerRuntime(runtimePlanInput);
  if (plan?.valid !== true) return fail('FORGE_M3_RUNTIME_PLAN_NOT_READY', { blockers: plan?.blockers || [] });
  const planDigest = buildForgeShadowM3RuntimePlanDigest(plan);
  if (planDigest !== text(command.runtimePlanDigest).toLowerCase()) {
    return fail('FORGE_M3_RUNTIME_PLAN_DIGEST_MISMATCH', { observedRuntimePlanDigest: planDigest });
  }
  const result = await executePlan({
    runtimePlanInput,
    runtimeAuthorization: Object.freeze({
      schemaVersion: FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
      authorizationId: command.runtimeAuthorizationId,
      repository: REPOSITORY,
      expectedHead: head,
      expectedTree: tree,
      runtimePlanDigest: planDigest,
      issuedAtUtc: command.planAtUtc,
      expiresAtUtc: command.runtimeExpiresAtUtc,
      executionSurface: FORGE_SHADOW_M3_EXECUTION_SURFACE,
      operatorApproved: command.operatorApproval === 'operator-approved',
      m3Only: command.m3Only === true,
    }),
  }, {
    platform,
    now,
    executeRunner: createExecutor(),
  });
  return result?.ok === true && result?.finalVerdict === FORGE_SHADOW_M3_EXECUTION_READY
    ? result
    : Object.freeze({ ...result, ok: false });
}
