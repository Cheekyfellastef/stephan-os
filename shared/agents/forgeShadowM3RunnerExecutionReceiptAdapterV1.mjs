import { createHash } from 'node:crypto';

import {
  FORGE_SHADOW_M3_RUNTIME_READY,
  FORGE_SHADOW_M3_RUNTIME_RECEIPT_SCHEMA,
  planForgeShadowM3RunnerRuntime,
} from './forgeShadowM3RunnerRuntimePlanV1.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const PROOF_REF = /^proofs\/forge-shadow-m3\/[a-z0-9][a-z0-9._:-]{2,127}\/[0-9a-f]{64}\.json$/i;
const MAX_AUTHORIZATION_MS = 2 * 60 * 60 * 1000;
const MAX_RUNNER_EXECUTION_MS = 60 * 60 * 1000;

export const FORGE_SHADOW_M3_EXECUTION_ADAPTER_SCHEMA =
  'stephanos.forge-shadow-m3-runner-execution-adapter.v1';
export const FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA =
  'stephanos.forge-shadow-m3-runner-execution-observation.v1';
export const FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA =
  'stephanos.forge-shadow-m3-runner-runtime-authorization.v1';
export const FORGE_SHADOW_M3_EXECUTION_READY = 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY';
export const FORGE_SHADOW_M3_EXECUTION_BLOCKED = 'FORGE_SHADOW_M3_RUNNER_EXECUTION_BLOCKED';
export const FORGE_SHADOW_M3_EXECUTION_SURFACE = 'CONNECTED_WINDOWS_BATTLE_BRIDGE';
export const FORGE_SHADOW_M3_CANARY_WORKFLOW = 'forge-shadow-m3-isolation-canary-v1';
export const FORGE_SHADOW_M3_CANARY_SCENARIO = 'EXACT_HEAD_ISOLATION_AND_TEARDOWN';

const INPUT_KEYS = ['runtimePlanInput', 'runtimeAuthorization'];
const AUTHORIZATION_KEYS = [
  'schemaVersion', 'authorizationId', 'repository', 'expectedHead', 'expectedTree',
  'runtimePlanDigest', 'issuedAtUtc', 'expiresAtUtc', 'executionSurface',
  'operatorApproved', 'm3Only',
];
const OBSERVATION_KEYS = [
  'schemaVersion', 'runnerId', 'poolId', 'runnerClass', 'runtimeBoundary',
  'sourceHead', 'sourceTree', 'artifactDigest', 'artifactSetDigest',
  'startedAtUtc', 'completedAtUtc', 'installed', 'registered', 'connected',
  'ephemeralRegistration', 'canaryWorkflowId', 'canaryScenario', 'canaryHead',
  'canaryTree', 'canarySucceeded', 'unregistered',
  'registrationCredentialDestroyed', 'workspaceDestroyed', 'runtimeBoundaryDestroyed',
  'zeroResidualRegistration', 'zeroResidualCredential', 'zeroResidualWorkspace',
  'credentialLogged', 'credentialPersisted', 'publicExposure', 'tailscaleExposure',
  'canonicalCheckoutMounted', 'containerSocketMounted', 'hostProcessAccess',
  'sourceMutation', 'gitRefWrite', 'mergeAuthority', 'deploymentAuthority',
  'arbitraryCommand', 'proofRefs',
];
const RECEIPT_KEYS = [
  'schemaVersion', 'receiptId', 'repository', 'sourceHead', 'sourceTree',
  'artifactSetDigest', 'runnerIdentities', 'linuxReviewRunnerConnected',
  'windowsProofRunnerConnected', 'teardownComplete', 'zeroResidualRegistration',
  'zeroResidualCredential', 'zeroResidualWorkspace', 'canCarryRealWork',
  'finalVerdict', 'completedAt', 'proofRefs', 'payloadSha256',
];
const FORBIDDEN_FIELDS = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'credentials', 'cookie', 'session', 'password', 'secret', 'secrets', 'privatekey',
  'publickey', 'dockerhost', 'podmansocket', 'dockersocket', 'registrationtoken',
  'registrationkey', 'selector', 'javascript',
]);

const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(stable(value), 'utf8').digest('hex')}`;
}

function sha256Hex(value) {
  return createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function instant(value) {
  const normalized = text(value);
  const parsed = EXPLICIT_TIMEZONE.test(normalized) ? Date.parse(normalized) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function findForbidden(value, trail = []) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, nested] of Object.entries(value)) {
    const next = [...trail, key];
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) return next.join('.');
    if (Array.isArray(nested)) {
      for (let index = 0; index < nested.length; index += 1) {
        const found = findForbidden(nested[index], [...next, String(index)]);
        if (found) return found;
      }
    } else {
      const found = findForbidden(nested, next);
      if (found) return found;
    }
  }
  return '';
}

function safeProofRefs(value, runnerId = '') {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const refs = value.map(text);
  if (new Set(refs).size !== refs.length) return null;
  if (!refs.every((ref) => PROOF_REF.test(ref) && !ref.includes('..'))) return null;
  if (runnerId && !refs.every((ref) => ref.startsWith(`proofs/forge-shadow-m3/${runnerId}/`))) return null;
  return Object.freeze([...refs].sort());
}

function falseAuthority() {
  return Object.freeze({
    runtimeMutation: false,
    futureExecution: false,
    sourceMutation: false,
    gitRefWrite: false,
    githubCredentialAccess: false,
    secretAccess: false,
    merge: false,
    deployment: false,
    arbitraryCommand: false,
  });
}

function blocked(blockers, runtimePlanDigest = '') {
  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_EXECUTION_ADAPTER_SCHEMA,
    ok: false,
    finalVerdict: FORGE_SHADOW_M3_EXECUTION_BLOCKED,
    blockers: Object.freeze(unique(blockers)),
    runtimePlanDigest,
    receipt: null,
    authority: falseAuthority(),
  });
}

export function buildForgeShadowM3RuntimePlanDigest(plan) {
  return sha256(plan);
}

function validateAuthorization(authorization, plan, planDigest, nowMs, blockers) {
  if (!exactKeys(authorization, AUTHORIZATION_KEYS)) {
    blockers.push('runtime-authorization-fields-invalid');
    return null;
  }
  const unsafe = findForbidden(authorization);
  if (unsafe) blockers.push(`runtime-authorization-unsafe-field:${unsafe}`);
  const issuedMs = instant(authorization.issuedAtUtc);
  const expiresMs = instant(authorization.expiresAtUtc);
  if (authorization.schemaVersion !== FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA) blockers.push('runtime-authorization-schema-invalid');
  if (!SAFE_ID.test(text(authorization.authorizationId))) blockers.push('runtime-authorization-id-invalid');
  if (authorization.repository !== plan.repository) blockers.push('runtime-authorization-repository-mismatch');
  if (text(authorization.expectedHead).toLowerCase() !== plan.canonicalMainHead) blockers.push('runtime-authorization-head-mismatch');
  if (text(authorization.expectedTree).toLowerCase() !== plan.canonicalMainTree) blockers.push('runtime-authorization-tree-mismatch');
  if (text(authorization.runtimePlanDigest).toLowerCase() !== planDigest) blockers.push('runtime-authorization-plan-digest-mismatch');
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) blockers.push('runtime-authorization-time-invalid');
  else {
    if (expiresMs <= issuedMs || expiresMs - issuedMs > MAX_AUTHORIZATION_MS) blockers.push('runtime-authorization-window-invalid');
    if (nowMs < issuedMs) blockers.push('runtime-authorization-not-yet-valid');
    if (nowMs >= expiresMs) blockers.push('runtime-authorization-expired');
  }
  if (authorization.executionSurface !== FORGE_SHADOW_M3_EXECUTION_SURFACE) blockers.push('runtime-authorization-surface-mismatch');
  if (authorization.operatorApproved !== true) blockers.push('runtime-authorization-operator-approval-required');
  if (authorization.m3Only !== true) blockers.push('runtime-authorization-m3-only-required');
  return blockers.length ? null : Object.freeze({
    authorizationId: text(authorization.authorizationId),
    issuedAtUtc: new Date(issuedMs).toISOString(),
    expiresAtUtc: new Date(expiresMs).toISOString(),
    expiresMs,
  });
}

function validateObservation(value, runner, artifact, plan, authorization, blockers) {
  const prefix = text(runner?.runnerId) || 'unknown-runner';
  if (!exactKeys(value, OBSERVATION_KEYS)) {
    blockers.push(`runner-observation-fields-invalid:${prefix}`);
  }
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const unsafe = findForbidden(value);
  if (unsafe) blockers.push(`runner-observation-unsafe-field:${prefix}:${unsafe}`);
  const startedMs = instant(value.startedAtUtc);
  const completedMs = instant(value.completedAtUtc);
  const refs = safeProofRefs(value.proofRefs, prefix);
  if (value.schemaVersion !== FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA) blockers.push(`runner-observation-schema-invalid:${prefix}`);
  if (value.runnerId !== runner.runnerId || value.poolId !== runner.poolId || value.runnerClass !== runner.runnerClass) blockers.push(`runner-identity-mismatch:${prefix}`);
  if (value.runtimeBoundary !== runner.runtimeBoundary) blockers.push(`runner-boundary-mismatch:${prefix}`);
  if (text(value.sourceHead).toLowerCase() !== plan.canonicalMainHead) blockers.push(`runner-head-mismatch:${prefix}`);
  if (text(value.sourceTree).toLowerCase() !== plan.canonicalMainTree) blockers.push(`runner-tree-mismatch:${prefix}`);
  if (text(value.artifactDigest).toLowerCase() !== artifact.artifactDigest) blockers.push(`runner-artifact-mismatch:${prefix}`);
  if (text(value.artifactSetDigest).toLowerCase() !== plan.artifactSetDigest) blockers.push(`runner-artifact-set-mismatch:${prefix}`);
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) blockers.push(`runner-time-invalid:${prefix}`);
  else {
    if (startedMs < instant(authorization.issuedAtUtc) || completedMs > authorization.expiresMs) blockers.push(`runner-time-outside-authorization:${prefix}`);
    if (completedMs < startedMs || completedMs - startedMs > MAX_RUNNER_EXECUTION_MS) blockers.push(`runner-duration-invalid:${prefix}`);
  }
  if (value.installed !== true || value.registered !== true || value.connected !== true) blockers.push(`runner-execution-incomplete:${prefix}`);
  if (value.ephemeralRegistration !== true) blockers.push(`runner-registration-not-ephemeral:${prefix}`);
  if (value.canaryWorkflowId !== FORGE_SHADOW_M3_CANARY_WORKFLOW || value.canaryScenario !== FORGE_SHADOW_M3_CANARY_SCENARIO) blockers.push(`runner-canary-identity-mismatch:${prefix}`);
  if (text(value.canaryHead).toLowerCase() !== plan.canonicalMainHead || text(value.canaryTree).toLowerCase() !== plan.canonicalMainTree) blockers.push(`runner-canary-source-mismatch:${prefix}`);
  if (value.canarySucceeded !== true) blockers.push(`runner-canary-failed:${prefix}`);
  for (const field of [
    'unregistered', 'registrationCredentialDestroyed', 'workspaceDestroyed',
    'runtimeBoundaryDestroyed', 'zeroResidualRegistration', 'zeroResidualCredential',
    'zeroResidualWorkspace',
  ]) {
    if (value[field] !== true) blockers.push(`runner-teardown-incomplete:${prefix}:${field}`);
  }
  for (const field of [
    'credentialLogged', 'credentialPersisted', 'publicExposure', 'tailscaleExposure',
    'canonicalCheckoutMounted', 'containerSocketMounted', 'hostProcessAccess',
    'sourceMutation', 'gitRefWrite', 'mergeAuthority', 'deploymentAuthority',
    'arbitraryCommand',
  ]) {
    if (value[field] !== false) blockers.push(`runner-authority-invalid:${prefix}:${field}`);
  }
  if (!refs) blockers.push(`runner-proof-refs-invalid:${prefix}`);
  if (blockers.length) return null;
  return Object.freeze({
    runnerId: runner.runnerId,
    poolId: runner.poolId,
    runnerClass: runner.runnerClass,
    runtimeBoundary: runner.runtimeBoundary,
    artifactDigest: artifact.artifactDigest,
    startedAtUtc: new Date(startedMs).toISOString(),
    completedAtUtc: new Date(completedMs).toISOString(),
    installed: true,
    registered: true,
    connected: true,
    ephemeralRegistration: true,
    canarySucceeded: true,
    unregistered: true,
    registrationCredentialDestroyed: true,
    workspaceDestroyed: true,
    runtimeBoundaryDestroyed: true,
    zeroResidualRegistration: true,
    zeroResidualCredential: true,
    zeroResidualWorkspace: true,
    proofRefs: refs,
  });
}

function buildReceipt(plan, authorization, observations) {
  const proofRefs = Object.freeze(unique(observations.flatMap((item) => item.proofRefs)).sort());
  const completedAt = observations.map((item) => item.completedAtUtc).sort().at(-1);
  const runnerIdentities = Object.freeze(observations.map((item) => item.runnerId).sort());
  const body = {
    schemaVersion: FORGE_SHADOW_M3_RUNTIME_RECEIPT_SCHEMA,
    receiptId: `forge-m3-runtime-${authorization.authorizationId}`,
    repository: plan.repository,
    sourceHead: plan.canonicalMainHead,
    sourceTree: plan.canonicalMainTree,
    artifactSetDigest: `sha256:${plan.artifactSetDigest}`,
    runnerIdentities,
    linuxReviewRunnerConnected: runnerIdentities.includes('stephanos-forge-linux-runner-01'),
    windowsProofRunnerConnected: runnerIdentities.includes('stephanos-forge-windows-proof-runner-01'),
    teardownComplete: observations.every((item) => (
      item.unregistered && item.registrationCredentialDestroyed
      && item.workspaceDestroyed && item.runtimeBoundaryDestroyed
    )),
    zeroResidualRegistration: observations.every((item) => item.zeroResidualRegistration),
    zeroResidualCredential: observations.every((item) => item.zeroResidualCredential),
    zeroResidualWorkspace: observations.every((item) => item.zeroResidualWorkspace),
    canCarryRealWork: true,
    finalVerdict: FORGE_SHADOW_M3_EXECUTION_READY,
    completedAt,
    proofRefs,
  };
  return Object.freeze({ ...body, payloadSha256: sha256Hex(body) });
}

export function validateForgeShadowM3RunnerRuntimeReceipt(receipt, {
  expectedRepository = '',
  expectedHead = '',
  expectedTree = '',
  expectedArtifactSetDigest = '',
} = {}) {
  const blockers = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) blockers.push('receipt-fields-invalid');
  if (receipt?.schemaVersion !== FORGE_SHADOW_M3_RUNTIME_RECEIPT_SCHEMA) blockers.push('receipt-schema-invalid');
  if (!SAFE_ID.test(text(receipt?.receiptId))) blockers.push('receipt-id-invalid');
  if (receipt?.finalVerdict !== FORGE_SHADOW_M3_EXECUTION_READY) blockers.push('receipt-verdict-invalid');
  if (expectedRepository && receipt?.repository !== expectedRepository) blockers.push('receipt-repository-mismatch');
  if (expectedHead && text(receipt?.sourceHead).toLowerCase() !== text(expectedHead).toLowerCase()) blockers.push('receipt-head-mismatch');
  if (expectedTree && text(receipt?.sourceTree).toLowerCase() !== text(expectedTree).toLowerCase()) blockers.push('receipt-tree-mismatch');
  if (!SHA40.test(text(receipt?.sourceHead).toLowerCase()) || !SHA40.test(text(receipt?.sourceTree).toLowerCase())) blockers.push('receipt-source-identity-invalid');
  const expectedArtifactDigest = text(expectedArtifactSetDigest).toLowerCase();
  const normalizedExpectedArtifactDigest = SHA256_HEX.test(expectedArtifactDigest)
    ? `sha256:${expectedArtifactDigest}`
    : expectedArtifactDigest;
  if (normalizedExpectedArtifactDigest && text(receipt?.artifactSetDigest).toLowerCase() !== normalizedExpectedArtifactDigest) blockers.push('receipt-artifact-set-mismatch');
  if (!DIGEST.test(text(receipt?.artifactSetDigest).toLowerCase())) blockers.push('receipt-digest-invalid');
  const runnerIds = Array.isArray(receipt?.runnerIdentities) ? receipt.runnerIdentities.map(text) : [];
  if (runnerIds.length !== 2 || new Set(runnerIds).size !== 2
      || !runnerIds.includes('stephanos-forge-linux-runner-01')
      || !runnerIds.includes('stephanos-forge-windows-proof-runner-01')) blockers.push('receipt-runner-estate-invalid');
  for (const field of [
    'linuxReviewRunnerConnected', 'windowsProofRunnerConnected', 'teardownComplete',
    'zeroResidualRegistration', 'zeroResidualCredential', 'zeroResidualWorkspace',
    'canCarryRealWork',
  ]) if (receipt?.[field] !== true) blockers.push(`receipt-runtime-proof-incomplete:${field}`);
  if (!safeProofRefs(receipt?.proofRefs)) blockers.push('receipt-proof-refs-invalid');
  if (!Number.isFinite(instant(receipt?.completedAt))) blockers.push('receipt-completion-time-invalid');
  const { payloadSha256, ...body } = receipt || {};
  if (!SHA256_HEX.test(text(payloadSha256).toLowerCase()) || sha256Hex(body) !== text(payloadSha256).toLowerCase()) blockers.push('receipt-content-digest-invalid');
  return Object.freeze({
    ok: blockers.length === 0,
    finalVerdict: blockers.length === 0 ? FORGE_SHADOW_M3_EXECUTION_READY : FORGE_SHADOW_M3_EXECUTION_BLOCKED,
    blockers: Object.freeze(unique(blockers)),
    receipt: blockers.length === 0 ? receipt : null,
  });
}

export async function executeForgeShadowM3RunnerPlan(input = {}, {
  platform = process.platform,
  now = () => new Date(),
  executeRunner,
} = {}) {
  const blockers = [];
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');
  const unsafe = findForbidden(input);
  if (unsafe) blockers.push(`unsafe-field:${unsafe}`);
  if (platform !== 'win32') blockers.push('connected-windows-battle-bridge-required');
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : instant(nowValue);
  if (!Number.isFinite(nowMs)) blockers.push('execution-now-invalid');
  const trustedNowUtc = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : '';
  const suppliedPlanInput = input.runtimePlanInput;
  const trustedPlanInput = suppliedPlanInput && typeof suppliedPlanInput === 'object'
    && !Array.isArray(suppliedPlanInput)
    ? {
        ...suppliedPlanInput,
        nowUtc: trustedNowUtc,
        admissionInput: suppliedPlanInput.admissionInput
          && typeof suppliedPlanInput.admissionInput === 'object'
          && !Array.isArray(suppliedPlanInput.admissionInput)
          ? { ...suppliedPlanInput.admissionInput, nowUtc: trustedNowUtc }
          : suppliedPlanInput.admissionInput,
      }
    : suppliedPlanInput;
  let plan;
  try { plan = planForgeShadowM3RunnerRuntime(trustedPlanInput); }
  catch { blockers.push('runtime-plan-threw'); }
  if (!plan || plan.valid !== true || plan.finalVerdict !== FORGE_SHADOW_M3_RUNTIME_READY) blockers.push('runtime-plan-not-ready');
  const planDigest = plan ? buildForgeShadowM3RuntimePlanDigest(plan) : '';
  const authorization = plan && Number.isFinite(nowMs)
    ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, nowMs, blockers)
    : null;
  if (typeof executeRunner !== 'function') blockers.push('fixed-runner-executor-not-configured');
  if (blockers.length) return blocked(blockers, planDigest);

  const observations = [];
  for (const runner of plan.runners) {
    const artifact = plan.runnerArtifacts.find((item) => item.runnerClass === runner.runnerClass);
    if (!artifact) return blocked([`runner-artifact-not-found:${runner.runnerId}`], planDigest);
    const runnerNowValue = now();
    const runnerNowMs = runnerNowValue instanceof Date ? runnerNowValue.getTime() : instant(runnerNowValue);
    const runnerAuthorizationBlockers = [];
    const liveAuthorization = Number.isFinite(runnerNowMs)
      ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, runnerNowMs, runnerAuthorizationBlockers)
      : null;
    if (!Number.isFinite(runnerNowMs)) runnerAuthorizationBlockers.push(`runner-execution-now-invalid:${runner.runnerId}`);
    if (!liveAuthorization) return blocked(runnerAuthorizationBlockers, planDigest);
    const remainingAuthorizationMs = liveAuthorization.expiresMs - runnerNowMs;
    if (remainingAuthorizationMs <= 0) return blocked([`runner-authorization-expired:${runner.runnerId}`], planDigest);

    let raw;
    const controller = new AbortController();
    let deadlineTimer;
    try {
      const executionRequest = Object.freeze({
        authorization: input.runtimeAuthorization,
        runtimePlan: plan,
        runner,
        artifact,
        executionDeadlineUtc: liveAuthorization.expiresAtUtc,
        signal: controller.signal,
        canary: Object.freeze({
          workflowId: FORGE_SHADOW_M3_CANARY_WORKFLOW,
          scenario: FORGE_SHADOW_M3_CANARY_SCENARIO,
          repository: plan.repository,
          head: plan.canonicalMainHead,
          tree: plan.canonicalMainTree,
        }),
      });
      const deadline = new Promise((resolveDeadline) => {
        deadlineTimer = setTimeout(() => {
          controller.abort();
          resolveDeadline({ deadlineExceeded: true });
        }, remainingAuthorizationMs);
      });
      const outcome = await Promise.race([
        Promise.resolve().then(() => executeRunner(executionRequest)).then((value) => ({ value })),
        deadline,
      ]);
      if (outcome.deadlineExceeded) return blocked([`runner-execution-deadline-exceeded:${runner.runnerId}`], planDigest);
      raw = outcome.value;
    } catch {
      return blocked([`runner-executor-threw:${runner.runnerId}`], planDigest);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    const runnerBlockers = [];
    const observation = validateObservation(raw, runner, artifact, plan, authorization, runnerBlockers);
    if (!observation) return blocked(runnerBlockers, planDigest);
    observations.push(observation);
  }

  const receipt = buildReceipt(plan, authorization, observations);
  const validation = validateForgeShadowM3RunnerRuntimeReceipt(receipt, {
    expectedRepository: plan.repository,
    expectedHead: plan.canonicalMainHead,
    expectedTree: plan.canonicalMainTree,
    expectedArtifactSetDigest: plan.artifactSetDigest,
  });
  if (!validation.ok) return blocked(validation.blockers, planDigest);
  return Object.freeze({
    schemaVersion: FORGE_SHADOW_M3_EXECUTION_ADAPTER_SCHEMA,
    ok: true,
    finalVerdict: FORGE_SHADOW_M3_EXECUTION_READY,
    blockers: Object.freeze([]),
    runtimePlanDigest: planDigest,
    receipt,
    authority: falseAuthority(),
  });
}
