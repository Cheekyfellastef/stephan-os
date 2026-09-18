import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  STEPHANOS_NATIVE_ADAPTER,
  STEPHANOS_NATIVE_ROUTE,
  validateStephanosNativeSourceAuthority,
  verifyStephanosNativeCapacityReceipt,
} from './stephanosNativeCapacityReceiptV1.mjs';
import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA = 'stephanos.native-routing-admission.v1';
export const STEPHANOS_NATIVE_CAPACITY_STATUS_ID = 'stephanos-native-capacity-current';
export const STEPHANOS_NATIVE_CAPACITY_PUBLIC_KEY_FILE = 'stephanos-native-capacity-public.pem';

const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERIFIED_CANDIDATES = new WeakSet();

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function frozen(value) {
  return Object.freeze(value);
}

function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map(text).filter(Boolean);
  return normalized.length === value.length && normalized.length === new Set(normalized).size
    ? normalized
    : null;
}

function missionRunnerRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_RUNNER_ROOT);
  if (configured) return resolve(configured);
  const profile = text(env.USERPROFILE);
  return profile ? resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner') : '';
}

function publicKeyPath(env = process.env) {
  const root = missionRunnerRoot(env);
  return root ? resolve(root, 'keys', STEPHANOS_NATIVE_CAPACITY_PUBLIC_KEY_FILE) : '';
}

function receiptDigest(receipt) {
  try {
    return createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  } catch {
    return '';
  }
}

export function isVerifiedStephanosNativeRoutingCandidate(candidate) {
  return Boolean(candidate) && VERIFIED_CANDIDATES.has(candidate);
}

export async function readVerifiedStephanosNativeRoutingCandidate(options = {}) {
  const nowUtc = text(options.nowUtc);
  const repository = text(options.repository);
  const sourceHead = text(options.sourceHead).toLowerCase();
  const taskClass = text(options.taskClass).toUpperCase();
  const root = text(options.root);
  const repoRoot = text(options.repoRoot);

  if (
    timestamp(nowUtc) === null
    || !REPOSITORY.test(repository)
    || !FULL_SHA.test(sourceHead)
    || !SAFE_ID.test(taskClass)
    || !root
    || !repoRoot
  ) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: 'STEPHANOS_NATIVE_ROUTING_IDENTITY_INVALID',
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const statusPath = resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: ['status', `${STEPHANOS_NATIVE_CAPACITY_STATUS_ID}.json`],
  });
  const keyPath = publicKeyPath(options.env || process.env);
  if (!statusPath.ok || !keyPath) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: 'STEPHANOS_NATIVE_ROUTING_TRUST_PATH_UNAVAILABLE',
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  let status;
  let publicKeyPem;
  try {
    status = JSON.parse(await readFile(statusPath.path, 'utf8'));
    publicKeyPem = await readFile(keyPath, 'utf8');
  } catch (error) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: error?.code === 'ENOENT'
        ? 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING'
        : 'STEPHANOS_NATIVE_ROUTING_TRUTH_READ_FAILED',
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const receipt = status?.capacityReceipt;
  const authority = status?.sourceAuthority;
  const payload = receipt?.payload;
  const workerId = text(payload?.workerId);
  const keyId = text(receipt?.keyId);
  const proofRefs = uniqueStrings(payload?.proofRefs);
  const attestation = status?.publisherAttestation;
  const expected = { repository, sourceHead, workerId, nowUtc, keyId };

  const receiptValidation = verifyStephanosNativeCapacityReceipt(receipt, {
    publicKeyPem,
    expected,
  });
  if (!receiptValidation.valid) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: `STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:${receiptValidation.errors[0] || 'unknown'}`,
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const authorityValidation = validateStephanosNativeSourceAuthority(authority, receipt, {
    publicKeyPem,
    expected,
  });
  if (!authorityValidation.valid) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: `STEPHANOS_NATIVE_SOURCE_AUTHORITY_INVALID:${authorityValidation.errors[0] || 'unknown'}`,
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const statusBound = status?.schemaVersion === 'shared-agent-workspace-record.v1'
    && status?.statusId === STEPHANOS_NATIVE_CAPACITY_STATUS_ID
    && status?.status === 'READY'
    && status?.participantId === workerId
    && status?.sourceMutationAllowed === true
    && status?.arbitraryCommandAllowed === false
    && status?.mergeAuthority === false
    && status?.leaseSeizureAllowed === false
    && status?.duplicateDispatchAllowed === false
    && attestation?.keyId === keyId
    && text(attestation?.sourceHead).toLowerCase() === sourceHead
    && attestation?.receiptSha256 === receiptDigest(receipt)
    && proofRefs?.length > 0
    && proofRefs.includes(text(attestation?.proofRef));
  if (!statusBound) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: 'STEPHANOS_NATIVE_CAPACITY_STATUS_BINDING_INVALID',
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const taskBound = payload.supportedTaskClasses.includes(taskClass)
    && authority.allowedTaskClasses.includes(taskClass)
    && payload.supportedOperations.includes('SOURCE_CONSTRUCTION')
    && payload.supportedOperations.includes('FOCUSED_TESTS')
    && authority.allowedOperations.includes('SOURCE_CONSTRUCTION')
    && authority.allowedOperations.includes('FOCUSED_TESTS');
  if (!taskBound) {
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
      ok: false,
      reason: 'STEPHANOS_NATIVE_TASK_NOT_QUALIFIED',
      candidate: null,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  const candidate = frozen({
    schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
    route: STEPHANOS_NATIVE_ROUTE,
    adapter: STEPHANOS_NATIVE_ADAPTER,
    workerId,
    repository,
    sourceHead,
    taskClass,
    provider: text(payload.provider),
    transport: text(payload.transport),
    endpoint: text(payload.endpoint),
    model: text(payload.model),
    queueDepth: payload.queueDepth,
    p95StartLatencySeconds: payload.p95StartLatencySeconds,
    capacityReceiptId: payload.receiptId,
    authorityReceiptIds: frozen([authority.authorityId]),
    proofRefs: frozen([...proofRefs]),
    sourceMutationAllowed: true,
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
  VERIFIED_CANDIDATES.add(candidate);

  return frozen({
    schemaVersion: STEPHANOS_NATIVE_ROUTING_ADMISSION_SCHEMA,
    ok: true,
    reason: 'STEPHANOS_NATIVE_ROUTING_CANDIDATE_VERIFIED',
    candidate,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}