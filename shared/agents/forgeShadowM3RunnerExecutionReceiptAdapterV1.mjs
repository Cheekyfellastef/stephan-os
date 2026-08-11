import { createHash, randomUUID } from 'node:crypto';

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
const MAX_RUNNER_PROOF_REFS = 8;
const MAX_RECEIPT_PROOF_REFS = 16;

export const FORGE_SHADOW_M3_EXECUTION_ADAPTER_SCHEMA =
  'stephanos.forge-shadow-m3-runner-execution-adapter.v1';
export const FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA =
  'stephanos.forge-shadow-m3-runner-execution-observation.v1';
export const FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA =
  'stephanos.forge-shadow-m3-runner-runtime-authorization.v1';
export const FORGE_SHADOW_M3_OPERATOR_APPROVAL_SCHEMA =
  'stephanos.forge-shadow-m3-operator-approval-receipt.v1';
export const FORGE_SHADOW_M3_OPERATOR_APPROVAL_VERIFICATION_SCHEMA =
  'stephanos.forge-shadow-m3-operator-approval-verification.v1';
export const FORGE_SHADOW_M3_AUTHORIZATION_RESERVATION_SCHEMA =
  'stephanos.forge-shadow-m3-authorization-reservation.v1';
export const FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA =
  'stephanos.forge-shadow-m3-runner-termination-acknowledgement.v1';
export const FORGE_SHADOW_M3_EXECUTION_READY = 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY';
export const FORGE_SHADOW_M3_EXECUTION_BLOCKED = 'FORGE_SHADOW_M3_RUNNER_EXECUTION_BLOCKED';
export const FORGE_SHADOW_M3_EXECUTION_SURFACE = 'CONNECTED_WINDOWS_BATTLE_BRIDGE';
export const FORGE_SHADOW_M3_CANARY_WORKFLOW = 'forge-shadow-m3-isolation-canary-v1';
export const FORGE_SHADOW_M3_CANARY_SCENARIO = 'EXACT_HEAD_ISOLATION_AND_TEARDOWN';

const INPUT_KEYS = ['runtimePlanInput', 'runtimeAuthorization'];
const AUTHORIZATION_KEYS = [
  'schemaVersion', 'authorizationId', 'repository', 'expectedHead', 'expectedTree',
  'runtimePlanDigest', 'issuedAtUtc', 'expiresAtUtc', 'executionSurface',
  'approvalReceipt', 'm3Only',
];
const APPROVAL_KEYS = [
  'schemaVersion', 'issuer', 'decision', 'proofRef', 'repository', 'expectedHead',
  'expectedTree', 'runtimePlanDigest', 'authorizationId', 'executionSurface',
  'issuedAtUtc', 'expiresAtUtc', 'payloadSha256',
];
const APPROVAL_VERIFICATION_KEYS = [
  'schemaVersion', 'verifierId', 'verified', 'proofRef', 'approvalPayloadSha256',
  'authorizationId', 'repository', 'expectedHead', 'expectedTree',
  'runtimePlanDigest', 'executionSurface', 'verifiedAtUtc',
];
const AUTHORIZATION_RESERVATION_KEYS = [
  'schemaVersion', 'reserverId', 'reservationId', 'reserved', 'authorizationId',
  'receiptId', 'approvalPayloadSha256', 'repository', 'expectedHead', 'expectedTree',
  'runtimePlanDigest', 'reservedAtUtc',
];
const OBSERVATION_KEYS = [
  'schemaVersion', 'authorizationId', 'invocationId', 'runnerId', 'poolId',
  'runnerClass', 'runtimeBoundary',
  'forgeService', 'forgeListener', 'registrationRepository', 'registrationScope',
  'registrationMode', 'oneJobMode', 'registrationProofRef',
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
const EXECUTION_RESULT_KEYS = ['observation', 'terminationAcknowledgement'];
const TERMINATION_ACK_KEYS = [
  'schemaVersion', 'authorizationId', 'invocationId', 'runnerId', 'terminated',
  'teardownAcknowledged', 'acknowledgedAtUtc',
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
const OPERATOR_APPROVAL_ISSUER = 'STEPHANOS_OPERATOR_APPROVAL_GATE';
const OPERATOR_APPROVAL_DECISION = 'APPROVED';
const OPERATOR_APPROVAL_VERIFIER = 'STEPHANOS_OPERATOR_APPROVAL_VERIFIER';
const OPERATOR_AUTHORIZATION_RESERVER = 'STEPHANOS_OPERATOR_AUTHORIZATION_RESERVER';
const APPROVAL_PROOF_REF = /^proofs\/operator-approvals\/[a-z0-9][a-z0-9._:-]{7,127}\/[0-9a-f]{64}\.json$/i;

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

function trustedNowMs(now) {
  try {
    const value = now();
    return value instanceof Date ? value.getTime() : instant(value);
  } catch {
    return Number.NaN;
  }
}

function findForbidden(value, trail = [], seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return [...trail, 'cyclic-reference'].join('.');
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const next = [...trail, key];
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) return next.join('.');
    if (Array.isArray(nested)) {
      for (let index = 0; index < nested.length; index += 1) {
        const found = findForbidden(nested[index], [...next, String(index)], seen);
        if (found) return found;
      }
    } else {
      const found = findForbidden(nested, next, seen);
      if (found) return found;
    }
  }
  seen.delete(value);
  return '';
}

function safeProofRefs(value, runnerId = '', maximum = MAX_RUNNER_PROOF_REFS) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null;
  const refs = value.map(text);
  if (new Set(refs).size !== refs.length) return null;
  if (!refs.every((ref) => PROOF_REF.test(ref) && !ref.includes('..'))) return null;
  if (runnerId && !refs.every((ref) => ref.startsWith(`proofs/forge-shadow-m3/${runnerId}/`))) return null;
  return Object.freeze([...refs].sort());
}

function supportedRunnerEstate(plan) {
  const identities = Array.isArray(plan?.runners)
    ? plan.runners.map((runner) => text(runner?.runnerId)).sort()
    : [];
  return identities.length === 2
    && identities[0] === 'stephanos-forge-linux-runner-01'
    && identities[1] === 'stephanos-forge-windows-proof-runner-01';
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

function validateApprovalReceipt(receipt, authorization, plan, planDigest, nowMs, blockers) {
  if (!exactKeys(receipt, APPROVAL_KEYS)) {
    blockers.push('operator-approval-fields-invalid');
    return null;
  }
  const unsafe = findForbidden(receipt);
  if (unsafe) blockers.push(`operator-approval-unsafe-field:${unsafe}`);
  const issuedMs = instant(receipt.issuedAtUtc);
  const expiresMs = instant(receipt.expiresAtUtc);
  const { payloadSha256, ...body } = receipt;
  if (receipt.schemaVersion !== FORGE_SHADOW_M3_OPERATOR_APPROVAL_SCHEMA) blockers.push('operator-approval-schema-invalid');
  if (receipt.issuer !== OPERATOR_APPROVAL_ISSUER) blockers.push('operator-approval-issuer-invalid');
  if (receipt.decision !== OPERATOR_APPROVAL_DECISION) blockers.push('operator-approval-decision-invalid');
  if (!APPROVAL_PROOF_REF.test(text(receipt.proofRef))
      || !text(receipt.proofRef).startsWith(`proofs/operator-approvals/${text(authorization.authorizationId)}/`)) blockers.push('operator-approval-proof-ref-invalid');
  if (receipt.repository !== plan.repository) blockers.push('operator-approval-repository-mismatch');
  if (text(receipt.expectedHead).toLowerCase() !== plan.canonicalMainHead) blockers.push('operator-approval-head-mismatch');
  if (text(receipt.expectedTree).toLowerCase() !== plan.canonicalMainTree) blockers.push('operator-approval-tree-mismatch');
  if (text(receipt.runtimePlanDigest).toLowerCase() !== planDigest) blockers.push('operator-approval-plan-digest-mismatch');
  if (receipt.authorizationId !== authorization.authorizationId) blockers.push('operator-approval-authorization-mismatch');
  if (receipt.executionSurface !== authorization.executionSurface) blockers.push('operator-approval-surface-mismatch');
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) blockers.push('operator-approval-time-invalid');
  else {
    if (issuedMs !== instant(authorization.issuedAtUtc) || expiresMs !== instant(authorization.expiresAtUtc)) blockers.push('operator-approval-window-mismatch');
    if (nowMs < issuedMs) blockers.push('operator-approval-not-yet-valid');
    if (nowMs >= expiresMs) blockers.push('operator-approval-expired');
  }
  if (!SHA256_HEX.test(text(payloadSha256).toLowerCase())
      || sha256Hex(body) !== text(payloadSha256).toLowerCase()) blockers.push('operator-approval-content-digest-invalid');
  return blockers.length ? null : Object.freeze({
    issuer: receipt.issuer,
    decision: receipt.decision,
    proofRef: receipt.proofRef,
    payloadSha256: text(payloadSha256).toLowerCase(),
  });
}

function validateApprovalVerification(value, receipt, authorization, plan, planDigest, nowMs, blockers) {
  if (!exactKeys(value, APPROVAL_VERIFICATION_KEYS)) {
    blockers.push('operator-approval-verification-fields-invalid');
    return null;
  }
  const verifiedAtMs = instant(value.verifiedAtUtc);
  if (value.schemaVersion !== FORGE_SHADOW_M3_OPERATOR_APPROVAL_VERIFICATION_SCHEMA) {
    blockers.push('operator-approval-verification-schema-invalid');
  }
  if (value.verifierId !== OPERATOR_APPROVAL_VERIFIER) blockers.push('operator-approval-verifier-invalid');
  if (value.verified !== true) blockers.push('operator-approval-not-verified');
  if (value.proofRef !== receipt.proofRef) blockers.push('operator-approval-verification-proof-ref-mismatch');
  if (text(value.approvalPayloadSha256).toLowerCase() !== text(receipt.payloadSha256).toLowerCase()) {
    blockers.push('operator-approval-verification-digest-mismatch');
  }
  if (value.authorizationId !== authorization.authorizationId) blockers.push('operator-approval-verification-authorization-mismatch');
  if (value.repository !== plan.repository) blockers.push('operator-approval-verification-repository-mismatch');
  if (text(value.expectedHead).toLowerCase() !== plan.canonicalMainHead) blockers.push('operator-approval-verification-head-mismatch');
  if (text(value.expectedTree).toLowerCase() !== plan.canonicalMainTree) blockers.push('operator-approval-verification-tree-mismatch');
  if (text(value.runtimePlanDigest).toLowerCase() !== planDigest) blockers.push('operator-approval-verification-plan-digest-mismatch');
  if (value.executionSurface !== authorization.executionSurface) blockers.push('operator-approval-verification-surface-mismatch');
  if (!Number.isFinite(verifiedAtMs)
      || verifiedAtMs < instant(receipt.issuedAtUtc)
      || verifiedAtMs > nowMs
      || verifiedAtMs >= instant(receipt.expiresAtUtc)) {
    blockers.push('operator-approval-verification-time-invalid');
  }
  return blockers.length ? null : Object.freeze({
    verifierId: value.verifierId,
    proofRef: value.proofRef,
    approvalPayloadSha256: text(value.approvalPayloadSha256).toLowerCase(),
    verifiedAtUtc: new Date(verifiedAtMs).toISOString(),
  });
}

function validateAuthorizationReservation(value, receipt, authorization, plan, planDigest, nowMs, blockers) {
  if (!exactKeys(value, AUTHORIZATION_RESERVATION_KEYS)) {
    blockers.push('runtime-authorization-reservation-fields-invalid');
    return null;
  }
  const reservedAtMs = instant(value.reservedAtUtc);
  const expectedReceiptId = `forge-m3-runtime-${authorization.authorizationId}`;
  if (value.schemaVersion !== FORGE_SHADOW_M3_AUTHORIZATION_RESERVATION_SCHEMA) blockers.push('runtime-authorization-reservation-schema-invalid');
  if (value.reserverId !== OPERATOR_AUTHORIZATION_RESERVER) blockers.push('runtime-authorization-reserver-invalid');
  if (!SAFE_ID.test(text(value.reservationId))) blockers.push('runtime-authorization-reservation-id-invalid');
  if (value.reserved !== true) blockers.push('runtime-authorization-already-consumed');
  if (value.authorizationId !== authorization.authorizationId) blockers.push('runtime-authorization-reservation-authorization-mismatch');
  if (value.receiptId !== expectedReceiptId) blockers.push('runtime-authorization-reservation-receipt-mismatch');
  if (text(value.approvalPayloadSha256).toLowerCase() !== text(receipt.payloadSha256).toLowerCase()) blockers.push('runtime-authorization-reservation-approval-mismatch');
  if (value.repository !== plan.repository) blockers.push('runtime-authorization-reservation-repository-mismatch');
  if (text(value.expectedHead).toLowerCase() !== plan.canonicalMainHead) blockers.push('runtime-authorization-reservation-head-mismatch');
  if (text(value.expectedTree).toLowerCase() !== plan.canonicalMainTree) blockers.push('runtime-authorization-reservation-tree-mismatch');
  if (text(value.runtimePlanDigest).toLowerCase() !== planDigest) blockers.push('runtime-authorization-reservation-plan-mismatch');
  if (!Number.isFinite(reservedAtMs)
      || reservedAtMs < instant(receipt.issuedAtUtc)
      || reservedAtMs > nowMs
      || reservedAtMs >= instant(receipt.expiresAtUtc)) blockers.push('runtime-authorization-reservation-time-invalid');
  return blockers.length ? null : Object.freeze({
    reservationId: value.reservationId,
    reservedAtUtc: new Date(reservedAtMs).toISOString(),
  });
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
  if (!SAFE_ID.test(`forge-m3-runtime-${text(authorization.authorizationId)}`)) blockers.push('runtime-authorization-receipt-id-invalid');
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
  const approvalReceipt = validateApprovalReceipt(
    authorization.approvalReceipt, authorization, plan, planDigest, nowMs, blockers,
  );
  if (authorization.m3Only !== true) blockers.push('runtime-authorization-m3-only-required');
  return blockers.length ? null : Object.freeze({
    authorizationId: text(authorization.authorizationId),
    issuedAtUtc: new Date(issuedMs).toISOString(),
    expiresAtUtc: new Date(expiresMs).toISOString(),
    expiresMs,
    approvalReceipt,
  });
}

function validateObservation(value, runner, artifact, plan, authorization, invocation, settledMs, blockers) {
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
  if (value.authorizationId !== authorization.authorizationId) blockers.push(`runner-authorization-identity-mismatch:${prefix}`);
  if (value.invocationId !== invocation.invocationId) blockers.push(`runner-invocation-identity-mismatch:${prefix}`);
  if (value.runnerId !== runner.runnerId || value.poolId !== runner.poolId || value.runnerClass !== runner.runnerClass) blockers.push(`runner-identity-mismatch:${prefix}`);
  if (value.runtimeBoundary !== runner.runtimeBoundary) blockers.push(`runner-boundary-mismatch:${prefix}`);
  if (value.forgeService !== runner.forgeService || value.forgeListener !== runner.forgeListener) blockers.push(`runner-forge-target-mismatch:${prefix}`);
  if (value.registrationRepository !== plan.repository || value.registrationScope !== 'repository') blockers.push(`runner-registration-scope-mismatch:${prefix}`);
  if (value.registrationMode !== runner.registrationMode || value.oneJobMode !== true) blockers.push(`runner-registration-mode-mismatch:${prefix}`);
  if (text(value.sourceHead).toLowerCase() !== plan.canonicalMainHead) blockers.push(`runner-head-mismatch:${prefix}`);
  if (text(value.sourceTree).toLowerCase() !== plan.canonicalMainTree) blockers.push(`runner-tree-mismatch:${prefix}`);
  if (text(value.artifactDigest).toLowerCase() !== artifact.artifactDigest) blockers.push(`runner-artifact-mismatch:${prefix}`);
  if (text(value.artifactSetDigest).toLowerCase() !== plan.artifactSetDigest) blockers.push(`runner-artifact-set-mismatch:${prefix}`);
  if (!Number.isFinite(startedMs) || !Number.isFinite(completedMs)) blockers.push(`runner-time-invalid:${prefix}`);
  else {
    if (startedMs < invocation.startedMs
        || completedMs > authorization.expiresMs
        || completedMs > settledMs) blockers.push(`runner-time-outside-invocation:${prefix}`);
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
  if (!refs || !refs.includes(value.registrationProofRef)) blockers.push(`runner-registration-proof-ref-invalid:${prefix}`);
  if (blockers.length) return null;
  return Object.freeze({
    runnerId: runner.runnerId,
    poolId: runner.poolId,
    runnerClass: runner.runnerClass,
    runtimeBoundary: runner.runtimeBoundary,
    forgeService: runner.forgeService,
    forgeListener: runner.forgeListener,
    registrationRepository: plan.repository,
    registrationScope: 'repository',
    registrationMode: runner.registrationMode,
    oneJobMode: true,
    registrationProofRef: value.registrationProofRef,
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

function validateTerminationAcknowledgement(value, runner, authorization, invocation, settledMs, deadlineMs, blockers) {
  const prefix = text(runner?.runnerId) || 'unknown-runner';
  if (!exactKeys(value, TERMINATION_ACK_KEYS)) {
    blockers.push(`runner-termination-ack-fields-invalid:${prefix}`);
    return null;
  }
  const acknowledgedMs = instant(value.acknowledgedAtUtc);
  if (value.schemaVersion !== FORGE_SHADOW_M3_TERMINATION_ACK_SCHEMA) blockers.push(`runner-termination-ack-schema-invalid:${prefix}`);
  if (value.authorizationId !== authorization.authorizationId) blockers.push(`runner-termination-ack-authorization-mismatch:${prefix}`);
  if (value.invocationId !== invocation.invocationId) blockers.push(`runner-termination-ack-invocation-mismatch:${prefix}`);
  if (value.runnerId !== runner.runnerId) blockers.push(`runner-termination-ack-runner-mismatch:${prefix}`);
  if (value.terminated !== true || value.teardownAcknowledged !== true) blockers.push(`runner-termination-not-acknowledged:${prefix}`);
  if (!Number.isFinite(acknowledgedMs)
      || acknowledgedMs < invocation.startedMs
      || acknowledgedMs > settledMs
      || acknowledgedMs > deadlineMs) blockers.push(`runner-termination-ack-time-invalid:${prefix}`);
  return blockers.length ? null : Object.freeze({ acknowledgedAtUtc: new Date(acknowledgedMs).toISOString() });
}

function createTerminationProofGate({ runner, authorization, invocation, deadlineMs, now }) {
  const invalidBlockers = new Set();
  const waiters = new Set();
  let latestProof = null;

  const proofFor = (minimumAcknowledgedMs = invocation.startedMs) => {
    if (!latestProof) return null;
    if (latestProof.acknowledgedMs < minimumAcknowledgedMs) {
      invalidBlockers.add(`runner-termination-before-observation-complete:${runner.runnerId}`);
      return null;
    }
    return latestProof;
  };

  const publish = (value, observedMs) => {
    let trustedObservedMs = observedMs;
    if (!Number.isFinite(trustedObservedMs)) {
      trustedObservedMs = trustedNowMs(now);
    }
    const candidateBlockers = [];
    if (!Number.isFinite(trustedObservedMs)) {
      candidateBlockers.push(`runner-termination-ack-observation-now-invalid:${runner.runnerId}`);
    }
    let proof = null;
    if (Number.isFinite(trustedObservedMs)) {
      try {
        proof = validateTerminationAcknowledgement(
          value, runner, authorization, invocation,
          trustedObservedMs, deadlineMs, candidateBlockers,
        );
      } catch {
        candidateBlockers.push(`runner-termination-ack-inspection-threw:${runner.runnerId}`);
      }
    }
    for (const blocker of candidateBlockers) invalidBlockers.add(blocker);
    if (!proof) return false;

    const acknowledgedMs = instant(proof.acknowledgedAtUtc);
    if (!latestProof || acknowledgedMs >= latestProof.acknowledgedMs) {
      latestProof = Object.freeze({ ...proof, acknowledgedMs });
    }
    for (const waiter of [...waiters]) {
      const accepted = proofFor(waiter.minimumAcknowledgedMs);
      if (!accepted) continue;
      waiters.delete(waiter);
      waiter.resolve(accepted);
    }
    return true;
  };

  const waitFor = (minimumAcknowledgedMs = invocation.startedMs) => {
    const accepted = proofFor(minimumAcknowledgedMs);
    if (accepted) return Promise.resolve(accepted);
    return new Promise((resolve) => {
      waiters.add(Object.freeze({ minimumAcknowledgedMs, resolve }));
    });
  };

  return Object.freeze({
    publish,
    proofFor,
    waitFor,
    blockers: () => Object.freeze([...invalidBlockers]),
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
  if (!safeProofRefs(receipt?.proofRefs, '', MAX_RECEIPT_PROOF_REFS)) blockers.push('receipt-proof-refs-invalid');
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
  verifyOperatorApproval,
  reserveOperatorAuthorization,
  createInvocationId = () => `forge-m3-invocation-${randomUUID()}`,
} = {}) {
  const blockers = [];
  if (!exactKeys(input, INPUT_KEYS)) blockers.push('input-fields-invalid');
  const unsafe = findForbidden(input);
  if (unsafe) blockers.push(`unsafe-field:${unsafe}`);
  if (platform !== 'win32') blockers.push('connected-windows-battle-bridge-required');
  const nowMs = trustedNowMs(now);
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
  if (plan && !supportedRunnerEstate(plan)) blockers.push('runtime-plan-runner-estate-unsupported');
  const planDigest = plan ? buildForgeShadowM3RuntimePlanDigest(plan) : '';
  let authorization = plan && Number.isFinite(nowMs)
    ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, nowMs, blockers)
    : null;
  if (typeof executeRunner !== 'function') blockers.push('fixed-runner-executor-not-configured');
  if (typeof verifyOperatorApproval !== 'function') blockers.push('operator-approval-verifier-not-configured');
  if (typeof reserveOperatorAuthorization !== 'function') blockers.push('runtime-authorization-reserver-not-configured');
  if (typeof createInvocationId !== 'function') blockers.push('invocation-identity-generator-not-configured');
  if (blockers.length) return blocked(blockers, planDigest);

  let approvalVerification;
  try {
    approvalVerification = await verifyOperatorApproval(Object.freeze({
      approvalReceipt: input.runtimeAuthorization.approvalReceipt,
      authorizationId: authorization.authorizationId,
      repository: plan.repository,
      expectedHead: plan.canonicalMainHead,
      expectedTree: plan.canonicalMainTree,
      runtimePlanDigest: planDigest,
      executionSurface: input.runtimeAuthorization.executionSurface,
      nowUtc: new Date(nowMs).toISOString(),
    }));
  } catch {
    blockers.push('operator-approval-verifier-threw');
  }
  const verificationNowMs = trustedNowMs(now);
  if (!Number.isFinite(verificationNowMs)) blockers.push('operator-approval-verification-now-invalid');
  const verifiedAuthorization = plan && Number.isFinite(verificationNowMs)
    ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, verificationNowMs, blockers)
    : null;
  const verifiedApproval = approvalVerification && validateApprovalVerification(
    approvalVerification,
    input.runtimeAuthorization.approvalReceipt,
    input.runtimeAuthorization,
    plan,
    planDigest,
    verificationNowMs,
    blockers,
  );
  if (!verifiedApproval || !verifiedAuthorization) return blocked(blockers, planDigest);
  authorization = verifiedAuthorization;

  let reservation;
  try {
    reservation = await reserveOperatorAuthorization(Object.freeze({
      authorizationId: authorization.authorizationId,
      receiptId: `forge-m3-runtime-${authorization.authorizationId}`,
      approvalPayloadSha256: verifiedApproval.approvalPayloadSha256,
      repository: plan.repository,
      expectedHead: plan.canonicalMainHead,
      expectedTree: plan.canonicalMainTree,
      runtimePlanDigest: planDigest,
      nowUtc: new Date(verificationNowMs).toISOString(),
    }));
  } catch {
    blockers.push('runtime-authorization-reserver-threw');
  }
  const reservationNowMs = trustedNowMs(now);
  if (!Number.isFinite(reservationNowMs)) blockers.push('runtime-authorization-reservation-now-invalid');
  const reservedAuthorization = plan && Number.isFinite(reservationNowMs)
    ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, reservationNowMs, blockers)
    : null;
  const validatedReservation = reservation && validateAuthorizationReservation(
    reservation,
    input.runtimeAuthorization.approvalReceipt,
    input.runtimeAuthorization,
    plan,
    planDigest,
    reservationNowMs,
    blockers,
  );
  if (!validatedReservation || !reservedAuthorization) return blocked(blockers, planDigest);
  authorization = reservedAuthorization;

  const observations = [];
  const invocationIds = new Set();
  for (const runner of plan.runners) {
    const artifact = plan.runnerArtifacts.find((item) => item.runnerClass === runner.runnerClass);
    if (!artifact) return blocked([`runner-artifact-not-found:${runner.runnerId}`], planDigest);
    const runnerNowMs = trustedNowMs(now);
    const runnerAuthorizationBlockers = [];
    const liveAuthorization = Number.isFinite(runnerNowMs)
      ? validateAuthorization(input.runtimeAuthorization, plan, planDigest, runnerNowMs, runnerAuthorizationBlockers)
      : null;
    if (!Number.isFinite(runnerNowMs)) runnerAuthorizationBlockers.push(`runner-execution-now-invalid:${runner.runnerId}`);
    if (!liveAuthorization) return blocked(runnerAuthorizationBlockers, planDigest);
    const executionDeadlineMs = Math.min(
      liveAuthorization.expiresMs,
      runnerNowMs + MAX_RUNNER_EXECUTION_MS,
    );
    const remainingExecutionMs = executionDeadlineMs - runnerNowMs;
    if (remainingExecutionMs <= 0) return blocked([`runner-authorization-expired:${runner.runnerId}`], planDigest);

    const invocationId = text(createInvocationId({
      authorizationId: liveAuthorization.authorizationId,
      runnerId: runner.runnerId,
    }));
    if (!SAFE_ID.test(invocationId) || invocationIds.has(invocationId)) {
      return blocked([`runner-invocation-id-invalid:${runner.runnerId}`], planDigest);
    }
    invocationIds.add(invocationId);
    const invocation = Object.freeze({ invocationId, startedMs: runnerNowMs });

    const controller = new AbortController();
    const terminationGate = createTerminationProofGate({
      runner,
      authorization: liveAuthorization,
      invocation,
      deadlineMs: executionDeadlineMs,
      now,
    });
    let deadlineTimer;
    let executorSettlement;
    let outcome;
    try {
      const executionRequest = Object.freeze({
        authorization: input.runtimeAuthorization,
        authorizationId: liveAuthorization.authorizationId,
        invocationId,
        runtimePlan: plan,
        runner,
        artifact,
        executionDeadlineUtc: new Date(executionDeadlineMs).toISOString(),
        signal: controller.signal,
        acknowledgeTermination: (value) => terminationGate.publish(value),
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
        }, remainingExecutionMs);
      });
      executorSettlement = Promise.resolve()
        .then(() => executeRunner(executionRequest))
        .then((value) => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' }));
      outcome = await Promise.race([
        executorSettlement,
        deadline,
      ]);
    } catch {
      controller.abort();
      await terminationGate.waitFor(invocation.startedMs);
      return blocked([
        `runner-executor-threw:${runner.runnerId}`,
        ...terminationGate.blockers(),
      ], planDigest);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }

    const deadlineExceeded = outcome.deadlineExceeded === true;
    const settled = deadlineExceeded ? await executorSettlement : outcome;
    const runnerBlockers = [];
    if (deadlineExceeded) runnerBlockers.push(`runner-execution-deadline-exceeded:${runner.runnerId}`);
    if (settled.status !== 'fulfilled') runnerBlockers.push(`runner-executor-threw:${runner.runnerId}`);
    const settledNowMs = trustedNowMs(now);
    if (!Number.isFinite(settledNowMs)) runnerBlockers.push(`runner-settlement-now-invalid:${runner.runnerId}`);
    else if (settledNowMs > executionDeadlineMs) runnerBlockers.push(`runner-settlement-after-deadline:${runner.runnerId}`);

    if (settled.status !== 'fulfilled') {
      controller.abort();
      await terminationGate.waitFor(invocation.startedMs);
      return blocked([...runnerBlockers, ...terminationGate.blockers()], planDigest);
    }

    try {
      const executionResult = settled.value;
      if (!exactKeys(executionResult, EXECUTION_RESULT_KEYS)) {
        controller.abort();
        runnerBlockers.push(`runner-execution-result-fields-invalid:${runner.runnerId}`);
        await terminationGate.waitFor(invocation.startedMs);
        return blocked([...runnerBlockers, ...terminationGate.blockers()], planDigest);
      }

      terminationGate.publish(executionResult.terminationAcknowledgement, settledNowMs);
      const observation = validateObservation(
        executionResult.observation,
        runner,
        artifact,
        plan,
        liveAuthorization,
        invocation,
        settledNowMs,
        runnerBlockers,
      );
      const minimumAcknowledgedMs = observation
        ? instant(observation.completedAtUtc)
        : invocation.startedMs;
      let termination = terminationGate.proofFor(minimumAcknowledgedMs);
      const invalidTerminationProof = terminationGate.blockers().length > 0;
      if (!termination || !observation || runnerBlockers.length || invalidTerminationProof) {
        controller.abort();
        if (!termination) termination = await terminationGate.waitFor(minimumAcknowledgedMs);
        return blocked([
          ...runnerBlockers,
          ...terminationGate.blockers(),
        ], planDigest);
      }

      observations.push(observation);
    } catch {
      controller.abort();
      await terminationGate.waitFor(invocation.startedMs);
      return blocked([
        ...runnerBlockers,
        `runner-execution-result-inspection-threw:${runner.runnerId}`,
        ...terminationGate.blockers(),
      ], planDigest);
    }
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
