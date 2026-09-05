import {
  CODEX_AVAILABILITY,
  CODEX_TASK_CLASS,
  buildCodexCapacityProjection,
  createMeterObservation,
} from './codexCapacityGovernorV1.mjs';
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { adjudicateForgeSidecarCapacity } from './stallSentinelReviewPipelineV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceStatusRecord,
  isSharedWorkspaceParticipantId,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';

export const MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA = 'stephanos.mission-controller-capacity-router.v1';
export const BUILD_LANE_CAPACITY_RECEIPT_SCHEMA = 'stephanos.build-lane-capacity-receipt.v1';
export const BUILD_LANE_AUTHORITY_RECEIPT_SCHEMA = 'stephanos.build-lane-authority-receipt.v1';
export const BUILD_LANE_PUBLISHER_ATTESTATION_SCHEMA = 'stephanos.build-lane-publisher-attestation.v1';

export const MISSION_CONTROLLER_ROUTE = Object.freeze({
  CODEX: 'CODEX',
  CHATGPT_GITHUB: 'CHATGPT_GITHUB',
  FOUNDRY_FORGE: 'FOUNDRY_FORGE',
  OPENCLAW_LOCAL: 'OPENCLAW_LOCAL',
  WAIT_FOR_PROVEN_CAPACITY: 'WAIT_FOR_PROVEN_CAPACITY',
});
export const MISSION_PROVIDER_ROUTE_INTENT = Object.freeze({
  AUTO: 'AUTO',
  CODEX: MISSION_CONTROLLER_ROUTE.CODEX,
  CHATGPT_GITHUB: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  FOUNDRY_FORGE: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
  OPENCLAW_LOCAL: MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL,
});

export const EXECUTION_SURFACE_FAILURE_CLASS = Object.freeze({
  SOURCE_OR_TEST_FAILURE: 'SOURCE_OR_TEST_FAILURE',
  GITHUB_REJECTION: 'GITHUB_REJECTION',
  CHATGPT_CONNECTOR_FAILURE: 'CHATGPT_CONNECTOR_FAILURE',
  PROVIDER_EXHAUSTION: 'PROVIDER_EXHAUSTION',
  AUTHORIZATION_GATE: 'AUTHORIZATION_GATE',
  RUNTIME_GATE: 'RUNTIME_GATE',
  UNKNOWN_INFRASTRUCTURE_FAILURE: 'UNKNOWN_INFRASTRUCTURE_FAILURE',
});
const REROUTABLE_EXECUTION_SURFACE_FAILURES = new Set([
  EXECUTION_SURFACE_FAILURE_CLASS.GITHUB_REJECTION,
  EXECUTION_SURFACE_FAILURE_CLASS.CHATGPT_CONNECTOR_FAILURE,
  EXECUTION_SURFACE_FAILURE_CLASS.PROVIDER_EXHAUSTION,
  EXECUTION_SURFACE_FAILURE_CLASS.UNKNOWN_INFRASTRUCTURE_FAILURE,
]);

export const MISSION_CONTROLLER_LIVENESS = Object.freeze({
  KEEP_ENABLED: 'KEEP_ENABLED',
  DISABLE_OPERATOR_REQUESTED: 'DISABLE_OPERATOR_REQUESTED',
  DISABLE_SAFE_HOLD: 'DISABLE_SAFE_HOLD',
});
const EXECUTION_SURFACE_SUPPRESSION_MS = 15 * 60 * 1000;

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'route', 'repository', 'workerId', 'state',
  'supportedOperations', 'supportedTaskClasses', 'observedAtUtc', 'expiresAtUtc',
  'queueDepth', 'p95StartLatencySeconds', 'authorityReceiptIds', 'proofRefs',
]);
const AUTHORITY_RECEIPT_KEYS = Object.freeze([
  'schemaVersion', 'receiptId', 'route', 'repository', 'sourceHead', 'workerId',
  'authorizedOperations', 'authorizedTaskClasses', 'issuedAtUtc', 'expiresAtUtc',
  'proofRefs', 'sourceDispatchAllowed', 'sourceMutationAuthorityAdded',
  'mergeAuthorityAdded', 'deploymentAuthorityAdded', 'runtimeMutationAuthorityAdded',
  'protectedMergeDispatchAllowed', 'duplicateDispatchAllowed', 'arbitraryCommandAllowed',
]);
const CAPACITY_STATUS_KEYS = Object.freeze([
  'schemaVersion', 'kind', 'statusId', 'participantId', 'timestampUtc', 'status',
  'summary', 'proofRefs', 'relatedIssue', 'relatedPr', 'capacityReceipt', 'sourceMutationAllowed',
  'mergeAuthority', 'leaseSeizureAllowed',
]);
const PUBLISHER_ATTESTATION_KEYS = Object.freeze([
  'schemaVersion', 'algorithm', 'publicKeySha256', 'statusDigest',
  'authorityReceiptDigests', 'signature',
]);
const SOURCE_ONLY_AUTHORIZED_OPERATIONS = Object.freeze([
  'SOURCE_CONSTRUCTION',
  'FOCUSED_TESTS',
]);
const ROUTE_ADAPTER = Object.freeze({
  [MISSION_CONTROLLER_ROUTE.CODEX]: 'codex',
  [MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB]: 'chatgpt-github',
  [MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE]: 'foundry-forge',
  [MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL]: 'openclaw-local',
});
const BUILD_LANE_RECEIPT_ROUTES = new Set([
  MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
  MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
]);
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const BASE64_SIGNATURE = /^[A-Za-z0-9+/]{80,}={0,2}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_RECEIPT_LIFETIME_MS = 60 * 60 * 1000;
const MAX_AUTHORITY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_METER_AGE_MINUTES = 15;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function list(value) { return Array.isArray(value) ? value : []; }
function timestamp(value) {
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyExecutionSurfaceFailure(observation = {}, expected = {}) {
  const route = text(observation.route).toUpperCase();
  const reason = text(observation.reason).toLowerCase();
  const code = text(observation.errorCode).toUpperCase();
  const httpStatus = Number(observation.httpStatus);
  const attemptCount = Number(observation.attemptCount);
  const observedAtMs = timestamp(observation.observedAtUtc);
  const nowMs = timestamp(expected.nowUtc);
  const exactIdentity = text(observation.missionId) === text(expected.missionId)
    && text(observation.repository) === text(expected.repository)
    && FULL_SHA.test(text(observation.sourceHead))
    && text(observation.sourceHead).toLowerCase() === text(expected.sourceHead).toLowerCase()
    && Object.values(MISSION_CONTROLLER_ROUTE).includes(route)
    && route !== MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY
    && Number.isSafeInteger(attemptCount) && attemptCount >= 1 && attemptCount <= 2
    && observation.expectedReceiptObserved === false
    && observedAtMs !== null && nowMs !== null
    && observedAtMs <= nowMs + 60_000
    && nowMs - observedAtMs <= 15 * 60 * 1000;
  if (!exactIdentity) {
    return frozen({
      valid: false,
      route,
      classification: '',
      reroutable: false,
      reason: 'EXECUTION_SURFACE_FAILURE_OBSERVATION_INVALID',
    });
  }

  let classification = EXECUTION_SURFACE_FAILURE_CLASS.UNKNOWN_INFRASTRUCTURE_FAILURE;
  if (/test|assert|compile|lint|source|regression/.test(reason)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.SOURCE_OR_TEST_FAILURE;
  } else if (/approval|authori[sz]ation|permission gate|operator gate/.test(reason)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.AUTHORIZATION_GATE;
  } else if (/runtime gate|windows authority|consequential runtime|deployment gate/.test(reason)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.RUNTIME_GATE;
  } else if (httpStatus === 401 || httpStatus === 403 || httpStatus === 409 || httpStatus === 422
    || /github rejection|resource not accessible|ruleset|ref update rejected/.test(reason)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.GITHUB_REJECTION;
  } else if (/meter|quota|usage limit|capacity exhausted|rate limit/.test(reason)
    || ['QUOTA_EXCEEDED', 'RATE_LIMITED', 'METER_EXHAUSTED'].includes(code)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.PROVIDER_EXHAUSTION;
  } else if (/chatgpt|connector|tool surface|tool call|execution surface|mutation surface/.test(reason)
    || ['CONNECTOR_ERROR', 'TOOL_UNAVAILABLE', 'EXECUTION_SURFACE_UNAVAILABLE'].includes(code)) {
    classification = EXECUTION_SURFACE_FAILURE_CLASS.CHATGPT_CONNECTOR_FAILURE;
  }
  const reroutable = REROUTABLE_EXECUTION_SURFACE_FAILURES.has(classification);
  return frozen({
    valid: true,
    route,
    classification,
    reroutable,
    attemptCount,
    expectedReceiptObserved: false,
    observedAtUtc: observation.observedAtUtc,
    suppressRouteUntilUtc: reroutable
      ? new Date(nowMs + EXECUTION_SURFACE_SUPPRESSION_MS).toISOString()
      : '',
    reason: 'EXECUTION_SURFACE_FAILURE_CLASSIFIED',
  });
}

export function decideMissionControllerLiveness(input = {}) {
  const explicitOperatorDisable = input.explicitOperatorDisable === true;
  const safeHold = input.safeHold === true;
  const contradictoryEvidenceProved = input.contradictoryEvidenceProved === true;
  if (explicitOperatorDisable) {
    return frozen({
      state: MISSION_CONTROLLER_LIVENESS.DISABLE_OPERATOR_REQUESTED,
      keepEnabled: false,
      disableAllowed: true,
      reason: 'EXPLICIT_OPERATOR_DISABLE',
    });
  }
  if (safeHold && contradictoryEvidenceProved) {
    return frozen({
      state: MISSION_CONTROLLER_LIVENESS.DISABLE_SAFE_HOLD,
      keepEnabled: false,
      disableAllowed: true,
      reason: 'PROVED_SAFE_HOLD',
    });
  }
  return frozen({
    state: MISSION_CONTROLLER_LIVENESS.KEEP_ENABLED,
    keepEnabled: true,
    disableAllowed: false,
    reason: safeHold ? 'SAFE_HOLD_NOT_PROVED' : 'CONTROLLER_REMAINS_WORK_CONSERVING',
  });
}
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function uniqueStrings(value) {
  const values = list(value).map(text).filter(Boolean);
  return values.length === new Set(values).size ? values : null;
}
function exactStringSet(value, expected) {
  const values = uniqueStrings(value);
  return values?.length === expected.length
    && expected.every((entry) => values.includes(entry));
}
function frozen(value) { return Object.freeze(value); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}
function publicKeyDigest(keyInput) {
  const publicKey = createPublicKey(keyInput);
  return `sha256:${createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`;
}

export function createBuildLanePublisherAttestation(status, authorityReceipts, privateKeyPem) {
  const receipts = list(authorityReceipts);
  if (!text(privateKeyPem) || !status || receipts.length === 0) return null;
  const authorityReceiptDigests = Object.fromEntries(receipts.map((receipt) => [
    text(receipt?.receiptId),
    digest(receipt),
  ]));
  if (Object.keys(authorityReceiptDigests).some((receiptId) => !receiptId)
    || Object.keys(authorityReceiptDigests).length !== receipts.length) return null;
  const payload = frozen({
    statusDigest: digest(status),
    authorityReceiptDigests: frozen(authorityReceiptDigests),
  });
  try {
    return frozen({
      schemaVersion: BUILD_LANE_PUBLISHER_ATTESTATION_SCHEMA,
      algorithm: 'Ed25519',
      publicKeySha256: publicKeyDigest(privateKeyPem),
      ...payload,
      signature: sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKeyPem).toString('base64'),
    });
  } catch {
    return null;
  }
}

export function validateBuildLanePublisherAttestation(attestation, status, authorityReceipts, publicKeyPem) {
  const receipts = list(authorityReceipts);
  if (!text(publicKeyPem)
    || !exactKeys(attestation, PUBLISHER_ATTESTATION_KEYS)
    || attestation.schemaVersion !== BUILD_LANE_PUBLISHER_ATTESTATION_SCHEMA
    || attestation.algorithm !== 'Ed25519'
    || !SHA256_DIGEST.test(text(attestation.publicKeySha256))
    || !SHA256_DIGEST.test(text(attestation.statusDigest))
    || !BASE64_SIGNATURE.test(text(attestation.signature))
    || !attestation.authorityReceiptDigests
    || typeof attestation.authorityReceiptDigests !== 'object'
    || Array.isArray(attestation.authorityReceiptDigests)) return false;
  const authorityReceiptIds = uniqueStrings(status?.capacityReceipt?.authorityReceiptIds);
  if (!authorityReceiptIds
    || receipts.length !== authorityReceiptIds.length
    || !exactKeys(attestation.authorityReceiptDigests, authorityReceiptIds)) return false;
  const receiptsById = new Map(receipts.map((receipt) => [text(receipt?.receiptId), receipt]));
  if (receiptsById.size !== receipts.length
    || authorityReceiptIds.some((receiptId) => !receiptsById.has(receiptId))) return false;
  const payload = {
    statusDigest: digest(status),
    authorityReceiptDigests: Object.fromEntries(authorityReceiptIds.map((receiptId) => [
      receiptId,
      digest(receiptsById.get(receiptId)),
    ])),
  };
  try {
    return attestation.publicKeySha256 === publicKeyDigest(publicKeyPem)
      && canonicalJson(payload) === canonicalJson({
        statusDigest: attestation.statusDigest,
        authorityReceiptDigests: attestation.authorityReceiptDigests,
      })
      && verify(
        null,
        Buffer.from(canonicalJson(payload), 'utf8'),
        publicKeyPem,
        Buffer.from(attestation.signature, 'base64'),
      );
  } catch {
    return false;
  }
}

function taskForMission(mission = {}, explicitTask = {}) {
  const allowedFiles = list(mission.allowedFiles);
  const windowsBound = explicitTask.windowsBound === true
    || allowedFiles.some((path) => /(?:^|\/)windows(?:\/|$)|\.ps1$/i.test(text(path)))
    || list(mission.requiredEvidence).some((item) => /windows runtime|battle bridge/i.test(text(item)));
  const taskClass = text(explicitTask.taskClass).toUpperCase()
    || (windowsBound
      ? CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF
      : (text(mission.currentPhase).toUpperCase() === 'REPAIR_REQUIRED'
        ? CODEX_TASK_CLASS.FOCUSED_REPAIR
        : (allowedFiles.length > 4
          ? CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION
          : CODEX_TASK_CLASS.FOCUSED_REPAIR)));
  return frozen({
    taskId: text(explicitTask.taskId) || text(mission.missionId) || 'unknown-mission',
    title: text(explicitTask.title) || text(mission.title) || text(mission.intendedOutcome) || 'Mission implementation',
    taskClass,
    preferredRoute: 'CODEX',
    complexityMultiplier: explicitTask.complexityMultiplier,
    capabilityValue: explicitTask.capabilityValue,
    urgent: explicitTask.urgent === true,
    windowsBound,
  });
}

function codexProjection(status, task, nowUtc) {
  const observedAtUtc = text(status?.observedAtUtc);
  const current = status?.schemaVersion === 'shared-agent-workspace-record.v1'
    && status?.statusId === 'codex-capacity-current'
    && status?.truthState === 'CURRENT'
    && status?.meterTruthUsable === true;
  const observation = createMeterObservation({
    observedAtUtc,
    remainingPercent: current ? status.remainingPercent : undefined,
    availability: current && Object.values(CODEX_AVAILABILITY).includes(status.availability)
      ? status.availability
      : CODEX_AVAILABILITY.UNKNOWN,
    naturalResetAtUtc: current ? status.naturalResetAtUtc : '',
    source: 'shared-workspace-codex-capacity-current',
    confidence: current && ['high', 'medium'].includes(status.confidence) ? status.confidence : 'low',
  });
  return buildCodexCapacityProjection({
    observation,
    nowUtc,
    maxMeterAgeMinutes: MAX_METER_AGE_MINUTES,
    tasks: [task],
  });
}

export function validateBuildLaneCapacityReceipt(receipt, expected = {}) {
  const nowMs = timestamp(expected.nowUtc);
  const observedAtMs = timestamp(receipt?.observedAtUtc);
  const expiresAtMs = timestamp(receipt?.expiresAtUtc);
  const operations = uniqueStrings(receipt?.supportedOperations);
  const classes = uniqueStrings(receipt?.supportedTaskClasses);
  const authorities = uniqueStrings(receipt?.authorityReceiptIds);
  const proofRefs = uniqueStrings(receipt?.proofRefs);
  const route = text(receipt?.route).toUpperCase();
  const valid = exactKeys(receipt, RECEIPT_KEYS)
    && receipt.schemaVersion === BUILD_LANE_CAPACITY_RECEIPT_SCHEMA
    && SAFE_ID.test(text(receipt.receiptId))
    && BUILD_LANE_RECEIPT_ROUTES.has(route)
    && receipt.repository === expected.repository
    && REPOSITORY.test(text(receipt.repository))
    && isSharedWorkspaceParticipantId(receipt.workerId)
    && receipt.state === 'READY'
    && operations?.includes('SOURCE_CONSTRUCTION')
    && operations?.includes('FOCUSED_TESTS')
    && classes?.includes(expected.taskClass)
    && authorities?.length > 0
    && authorities.every((receiptId) => isSharedWorkspaceParticipantId(receiptId)
      && isSharedWorkspaceParticipantId(`${receiptId}.json`))
    && proofRefs?.length > 0
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'))
    && nowMs !== null && observedAtMs !== null && expiresAtMs !== null
    && observedAtMs <= nowMs + 60_000
    && expiresAtMs > nowMs
    && expiresAtMs > observedAtMs
    && expiresAtMs - observedAtMs <= MAX_RECEIPT_LIFETIME_MS
    && Number.isSafeInteger(receipt.queueDepth) && receipt.queueDepth >= 0 && receipt.queueDepth <= 1000
    && Number.isFinite(receipt.p95StartLatencySeconds)
    && receipt.p95StartLatencySeconds >= 0 && receipt.p95StartLatencySeconds <= 24 * 60 * 60;
  return frozen({ valid: Boolean(valid), route, receipt: valid ? receipt : null });
}

export function validateBuildLaneAuthorityReceipt(receipt, expected = {}) {
  const nowMs = timestamp(expected.nowUtc);
  const issuedAtMs = timestamp(receipt?.issuedAtUtc);
  const expiresAtMs = timestamp(receipt?.expiresAtUtc);
  const route = text(receipt?.route).toUpperCase();
  const operations = uniqueStrings(receipt?.authorizedOperations);
  const classes = uniqueStrings(receipt?.authorizedTaskClasses);
  const proofRefs = uniqueStrings(receipt?.proofRefs);
  const valid = exactKeys(receipt, AUTHORITY_RECEIPT_KEYS)
    && receipt.schemaVersion === BUILD_LANE_AUTHORITY_RECEIPT_SCHEMA
    && isSharedWorkspaceParticipantId(receipt.receiptId)
    && isSharedWorkspaceParticipantId(`${receipt.receiptId}.json`)
    && receipt.receiptId === expected.receiptId
    && BUILD_LANE_RECEIPT_ROUTES.has(route)
    && route === text(expected.route).toUpperCase()
    && receipt.repository === expected.repository
    && REPOSITORY.test(text(receipt.repository))
    && FULL_SHA.test(text(receipt.sourceHead))
    && text(receipt.sourceHead).toLowerCase() === text(expected.sourceHead).toLowerCase()
    && isSharedWorkspaceParticipantId(receipt.workerId)
    && receipt.workerId === expected.workerId
    && exactStringSet(operations, SOURCE_ONLY_AUTHORIZED_OPERATIONS)
    && classes?.includes(expected.taskClass)
    && proofRefs?.length > 0
    && proofRefs.every((ref) => SAFE_REF.test(ref) && !ref.includes('..'))
    && nowMs !== null && issuedAtMs !== null && expiresAtMs !== null
    && issuedAtMs <= nowMs + 60_000
    && expiresAtMs > nowMs
    && expiresAtMs > issuedAtMs
    && expiresAtMs - issuedAtMs <= MAX_AUTHORITY_LIFETIME_MS
    && receipt.sourceDispatchAllowed === true
    && [receipt.sourceMutationAuthorityAdded, receipt.mergeAuthorityAdded,
      receipt.deploymentAuthorityAdded, receipt.runtimeMutationAuthorityAdded,
      receipt.protectedMergeDispatchAllowed, receipt.duplicateDispatchAllowed,
      receipt.arbitraryCommandAllowed].every((value) => value === false);
  return frozen({ valid: Boolean(valid), route, receipt: valid ? receipt : null });
}

export function validateBuildLaneCapacityAuthorityChain(capacityReceipt, authorityReceipts, expected = {}) {
  const authorityIds = uniqueStrings(capacityReceipt?.authorityReceiptIds);
  const records = Array.isArray(authorityReceipts) ? authorityReceipts : [];
  if (!authorityIds?.length || records.length !== authorityIds.length) {
    return frozen({ valid: false, receipts: frozen([]), proofRefs: frozen([]), reason: 'BUILD_LANE_AUTHORITY_SET_MISMATCH' });
  }
  const byId = new Map();
  for (const record of records) {
    const receiptId = text(record?.receiptId);
    if (!receiptId || byId.has(receiptId)) {
      return frozen({ valid: false, receipts: frozen([]), proofRefs: frozen([]), reason: 'BUILD_LANE_AUTHORITY_ID_DUPLICATE' });
    }
    byId.set(receiptId, record);
  }
  const validated = [];
  for (const receiptId of authorityIds) {
    const result = validateBuildLaneAuthorityReceipt(byId.get(receiptId), {
      receiptId,
      route: capacityReceipt.route,
      repository: capacityReceipt.repository,
      sourceHead: expected.sourceHead,
      workerId: capacityReceipt.workerId,
      taskClass: expected.taskClass,
      nowUtc: expected.nowUtc,
    });
    if (!result.valid) {
      return frozen({ valid: false, receipts: frozen([]), proofRefs: frozen([]), reason: 'BUILD_LANE_AUTHORITY_RECEIPT_INVALID' });
    }
    validated.push(result.receipt);
  }
  return frozen({
    valid: true,
    receipts: frozen(validated),
    proofRefs: frozen([...new Set(validated.flatMap((record) => record.proofRefs))]),
    reason: 'BUILD_LANE_AUTHORITY_PROVEN',
  });
}

export function validateBuildLaneCapacityStatusRecord(record, expected = {}) {
  const receipt = record?.capacityReceipt;
  const recordValidation = validateSharedWorkspaceRecord(record, { nowMs: timestamp(expected.nowUtc) });
  const classes = uniqueStrings(receipt?.supportedTaskClasses);
  const expectedStatusId = text(expected.route).toUpperCase() === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB
    ? 'chatgpt-github-build-capacity-current'
    : 'foundry-forge-build-capacity-current';
  const receiptsValid = classes?.length > 0 && classes.every((taskClass) => validateBuildLaneCapacityReceipt(receipt, {
    repository: expected.repository,
    taskClass,
    nowUtc: expected.nowUtc,
  }).valid);
  const valid = exactKeys(record, CAPACITY_STATUS_KEYS)
    && recordValidation.valid && !recordValidation.stale
    && record?.kind === SHARED_WORKSPACE_RECORD_KINDS.STATUS
    && record?.statusId === expectedStatusId
    && record?.participantId === receipt?.workerId
    && record?.timestampUtc === receipt?.observedAtUtc
    && record?.status === 'READY'
    && text(receipt?.route).toUpperCase() === text(expected.route).toUpperCase()
    && JSON.stringify(record?.proofRefs || []) === JSON.stringify(receipt?.proofRefs || [])
    && record?.sourceMutationAllowed === false
    && record?.mergeAuthority === false
    && record?.leaseSeizureAllowed === false
    && receiptsValid;
  return frozen({ valid: Boolean(valid), receipt: valid ? receipt : null, validation: recordValidation });
}

export function createBuildLaneCapacityStatusRecord(receipt, options = {}) {
  const firstTaskClass = list(receipt?.supportedTaskClasses)[0];
  const validation = validateBuildLaneCapacityReceipt(receipt, {
    repository: receipt?.repository,
    taskClass: firstTaskClass,
    nowUtc: options.nowUtc || receipt?.observedAtUtc,
  });
  if (!validation.valid) return null;
  const statusId = receipt.route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB
    ? 'chatgpt-github-build-capacity-current'
    : 'foundry-forge-build-capacity-current';
  return frozen({
    ...createSharedWorkspaceStatusRecord({
      statusId,
      participantId: receipt.workerId,
      timestampUtc: receipt.observedAtUtc,
      status: receipt.state,
      summary: `${receipt.route} build capacity is ${receipt.state}; queue depth ${receipt.queueDepth}, p95 start ${receipt.p95StartLatencySeconds}s.`,
      proofRefs: receipt.proofRefs,
    }),
    capacityReceipt: receipt,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export async function publishBuildLaneCapacityToSharedWorkspace(root, receipt, options = {}) {
  const record = createBuildLaneCapacityStatusRecord(receipt, options);
  if (!record) return frozen({ ok: false, reason: 'BUILD_LANE_CAPACITY_RECEIPT_INVALID', record: null });
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs: timestamp(options.nowUtc || receipt.observedAtUtc),
  });
  if (!validation.valid) return frozen({ ok: false, reason: validation.errors[0], record, validation });
  const write = await writeAtomicJson(root, ['status', `${record.statusId}.json`], record, options);
  return frozen({
    ok: write.ok === true,
    reason: write.ok ? 'BUILD_LANE_CAPACITY_PUBLISHED' : write.reason,
    record,
    write,
  });
}

function candidateForReceipt(receipt, expected, authority = null) {
  const validation = validateBuildLaneCapacityReceipt(receipt, expected);
  if (!validation.valid || authority?.valid === false) return null;
  return frozen({
    route: validation.route,
    adapter: ROUTE_ADAPTER[validation.route],
    workerId: receipt.workerId,
    queueDepth: receipt.queueDepth,
    p95StartLatencySeconds: receipt.p95StartLatencySeconds,
    receiptId: receipt.receiptId,
    authorityReceiptIds: frozen([...receipt.authorityReceiptIds]),
    proofRefs: frozen([...new Set([...receipt.proofRefs, ...(authority?.proofRefs || [])])]),
  });
}

function selectFallback(input, task, nowUtc, excludedRoutes = new Set()) {
  const expected = { repository: text(input.mission?.repository), taskClass: task.taskClass, nowUtc };
  const candidates = [];
  if (!task.windowsBound && !excludedRoutes.has(MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB)) {
    const githubAuthority = validateBuildLaneCapacityAuthorityChain(
      input.githubLaneReceipt,
      input.githubLaneAuthorityReceipts,
      { sourceHead: input.sourceHead, taskClass: task.taskClass, nowUtc },
    );
    const github = candidateForReceipt(input.githubLaneReceipt, expected, githubAuthority);
    if (github?.route === MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB) candidates.push(github);
  }
  const forge = adjudicateForgeSidecarCapacity(input.forgeSidecar, { nowUtc });
  const forgeCandidate = candidateForReceipt(input.forgeLaneReceipt, expected);
  if (
    !excludedRoutes.has(MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE)
    && forge?.canCarryRealWork === true
    && forgeCandidate?.route === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE
    && forgeCandidate.authorityReceiptIds.includes(forge.m2ReceiptId)
    && forgeCandidate.authorityReceiptIds.includes(forge.m3RuntimeReceiptId)
  ) candidates.push(forgeCandidate);
  candidates.sort((left, right) => (
    left.p95StartLatencySeconds - right.p95StartLatencySeconds
    || left.queueDepth - right.queueDepth
    || left.route.localeCompare(right.route)
  ));
  return frozen({ selected: candidates[0] || null, candidates: frozen(candidates), forge });
}

export function routeMissionControllerCapacity(input = {}) {
  const nowUtc = text(input.nowUtc);
  const task = taskForMission(input.mission, input.task);
  const controllerLiveness = decideMissionControllerLiveness(input.controllerLiveness);
  const base = {
    schemaVersion: MISSION_CONTROLLER_CAPACITY_ROUTER_SCHEMA,
    missionId: text(input.mission?.missionId),
    repository: text(input.mission?.repository),
    task,
    evaluatedAtUtc: nowUtc,
    controllerLiveness,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  };
  if (timestamp(nowUtc) === null || !base.missionId || !REPOSITORY.test(base.repository)) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY, adapter: '', dispatchAllowed: false, blockers: frozen(['mission-routing-identity-invalid']), finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED' });
  }
  if (input.mission?.dispatch?.status === 'running') {
    return frozen({ ...base, route: text(input.mission.dispatch.adapter).toUpperCase(), adapter: text(input.mission.dispatch.adapter), dispatchAllowed: false, blockers: frozen(['existing-agent-dispatch-owns-mission']), finalVerdict: 'MISSION_CONTROLLER_EXISTING_DISPATCH_PRESERVED' });
  }
  const surfaceFailure = input.executionSurfaceFailure
    ? classifyExecutionSurfaceFailure(input.executionSurfaceFailure, {
      nowUtc,
      missionId: base.missionId,
      repository: base.repository,
      sourceHead: input.sourceHead,
    })
    : null;
  if (surfaceFailure && !surfaceFailure.valid) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY, adapter: '', dispatchAllowed: false, executionSurfaceFailure: surfaceFailure, blockers: frozen(['execution-surface-failure-observation-invalid']), finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED' });
  }
  if (surfaceFailure && !surfaceFailure.reroutable) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY, adapter: '', dispatchAllowed: false, executionSurfaceFailure: surfaceFailure, blockers: frozen([`execution-surface-failure-parked:${surfaceFailure.classification.toLowerCase()}`]), finalVerdict: 'MISSION_CONTROLLER_EXECUTION_FAILURE_PARKED' });
  }
  const excludedRoutes = new Set(surfaceFailure?.reroutable ? [surfaceFailure.route] : []);
  const codex = codexProjection(input.codexStatus, task, nowUtc);
  if (codex.dispatchAllowed && !excludedRoutes.has(MISSION_CONTROLLER_ROUTE.CODEX)) {
    return frozen({ ...base, route: MISSION_CONTROLLER_ROUTE.CODEX, adapter: ROUTE_ADAPTER.CODEX, dispatchAllowed: true, codex, executionSurfaceFailure: surfaceFailure, selectedCapacityReceiptId: null, proofRefs: frozen([]), blockers: frozen([]), finalVerdict: surfaceFailure ? 'MISSION_CONTROLLER_EXECUTION_SURFACE_REROUTED' : 'MISSION_CONTROLLER_ROUTE_READY' });
  }
  const fallback = selectFallback(input, task, nowUtc, excludedRoutes);
  if (fallback.selected) {
    return frozen({ ...base, route: fallback.selected.route, adapter: fallback.selected.adapter, workerId: fallback.selected.workerId, dispatchAllowed: true, codex, executionSurfaceFailure: surfaceFailure, fallbackCandidates: fallback.candidates, selectedCapacityReceiptId: fallback.selected.receiptId, proofRefs: fallback.selected.proofRefs, blockers: frozen([]), finalVerdict: surfaceFailure ? 'MISSION_CONTROLLER_EXECUTION_SURFACE_REROUTED' : 'MISSION_CONTROLLER_FALLBACK_ROUTE_READY' });
  }
  return frozen({
    ...base,
    route: MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY,
    adapter: '',
    dispatchAllowed: false,
    codex,
    executionSurfaceFailure: surfaceFailure,
    fallbackCandidates: fallback.candidates,
    blockers: frozen(['codex-capacity-unavailable', task.windowsBound ? 'proven-windows-capable-fallback-unavailable' : 'proven-build-fallback-unavailable']),
    finalVerdict: 'MISSION_CONTROLLER_CAPACITY_BLOCKED',
  });
}
