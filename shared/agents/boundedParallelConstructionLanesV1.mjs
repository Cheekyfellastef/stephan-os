import { validateVerifierResult } from './verificationHarness.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const TERMINAL_STATES = new Set(['READY_FOR_INTEGRATION', 'BLOCKED', 'SUPERSEDED', 'FAILED', 'CANCELLED']);
const ACTIVE_STATES = new Set(['ADMITTED', 'BUILDING', 'TESTING', 'PROOF_RUNNING']);
const KNOWN_STATES = new Set([...ACTIVE_STATES, ...TERMINAL_STATES]);
const INTEGRATION_STATES = new Set([...KNOWN_STATES, 'CI_REVIEW', 'INTEGRATING']);
const FORBIDDEN_CAPABILITIES = new Set(['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']);
const DEFAULT_MAX_LANES = 4;
const MAX_CONSTRUCTION_LEASE_MS = 24 * 60 * 60 * 1000;
const MAX_ISSUANCE_CLOCK_SKEW_MS = 60 * 1000;
const EXACT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const ADMITTED_DECISIONS = new WeakMap();

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sha(value) {
  const candidate = text(value);
  return candidate && SHA_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function normalizedPath(value) {
  const supplied = text(value);
  if (!supplied || /^[a-z]:/i.test(supplied)) return null;
  const candidate = supplied.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!candidate || candidate.startsWith('/')) return null;
  const segments = candidate.split('/');
  if (segments.some((segment) => segment === '..')) return null;
  if (segments.some((segment) => segment !== '.' && /[. ]$/.test(segment))) return null;
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
  if (normalized.toLowerCase() === '.git' || normalized.toLowerCase().startsWith('.git/')) return null;
  return normalized || null;
}

function normalizedContract(value) {
  return text(value)?.toLowerCase() ?? null;
}

function normalizedState(value) {
  return text(value)?.toUpperCase() ?? 'UNKNOWN';
}

function timestamp(value) {
  const candidate = text(value);
  const match = candidate?.match(EXACT_TIMESTAMP);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    return null;
  }
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function unique(values) {
  return [...new Set(values)];
}

function pathOverlaps(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft === normalizedRight
    || normalizedLeft.startsWith(`${normalizedRight}/`)
    || normalizedRight.startsWith(`${normalizedLeft}/`);
}

function normalizeOwnership(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) candidate = {};
  const pathsProvided = candidate.paths !== undefined;
  const contractsProvided = candidate.contracts !== undefined;
  const rawPaths = array(candidate.paths);
  const rawContracts = array(candidate.contracts);
  const paths = rawPaths.map(normalizedPath).filter(Boolean);
  const contracts = rawContracts.map(normalizedContract).filter(Boolean);
  const invalidPaths = (pathsProvided && !Array.isArray(candidate.paths)) || rawPaths.length !== paths.length;
  const invalidContracts = (contractsProvided && !Array.isArray(candidate.contracts)) || rawContracts.length !== contracts.length;
  return freeze({
    paths:unique(paths).sort(),
    contracts:unique(contracts).sort(),
    invalidPaths,
    invalidContracts,
  });
}

function normalizeLane(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) candidate = {};
  const ownership = normalizeOwnership(candidate.ownership);
  const rawCapabilities = array(candidate.capabilities);
  const rawDependencies = array(candidate.dependencies);
  const capabilities = unique(rawCapabilities.map((value) => text(value)?.toUpperCase()).filter(Boolean)).sort();
  const dependencies = unique(rawDependencies.map(text).filter(Boolean)).sort();
  return freeze({
    id:text(candidate.id),
    goalId:text(candidate.goalId),
    branch:text(candidate.branch),
    baseSha:sha(candidate.baseSha),
    headSha:sha(candidate.headSha),
    state:normalizedState(candidate.state),
    ownership,
    capabilities,
    dependencies,
    invalidCapabilities:(candidate.capabilities !== undefined && !Array.isArray(candidate.capabilities))
      || rawCapabilities.length !== capabilities.length,
    invalidDependencies:(candidate.dependencies !== undefined && !Array.isArray(candidate.dependencies))
      || rawDependencies.length !== dependencies.length,
    heartbeatAt:text(candidate.heartbeatAt),
  });
}

function laneInvalid(lane) {
  return !SAFE_ID.test(lane.id ?? '')
    || !SAFE_ID.test(lane.goalId ?? '')
    || !SAFE_BRANCH.test(lane.branch ?? '')
    || lane.branch.includes('..')
    || !lane.baseSha
    || lane.ownership.invalidPaths
    || lane.ownership.invalidContracts
    || (lane.ownership.paths.length === 0 && lane.ownership.contracts.length === 0)
    || lane.invalidCapabilities
    || lane.invalidDependencies
    || !KNOWN_STATES.has(lane.state)
    || lane.capabilities.some((capability) => FORBIDDEN_CAPABILITIES.has(capability));
}

function activeLane(lane) {
  return ACTIVE_STATES.has(lane.state);
}

function normalizeIntegrationLane(candidate) {
  if (candidate === null) return freeze({ invalid:false, lane:null });
  if (candidate === undefined) return freeze({ invalid:true, lane:null });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return freeze({ invalid:true, lane:null });
  const id = text(candidate.id);
  const branch = text(candidate.branch);
  const state = normalizedState(candidate.state);
  const ownership = normalizeOwnership(candidate.ownership);
  const terminal = TERMINAL_STATES.has(state);
  const invalid = !id
    || !SAFE_ID.test(id)
    || !SAFE_BRANCH.test(branch ?? '')
    || branch.includes('..')
    || !INTEGRATION_STATES.has(state)
    || ownership.invalidPaths
    || ownership.invalidContracts
    || (!terminal && ownership.paths.length === 0 && ownership.contracts.length === 0);
  return freeze({
    invalid,
    lane:invalid || terminal ? null : { id, branch, state, ownership },
  });
}

function ownershipConflict(left, right) {
  const pathConflicts = [];
  for (const leftPath of left.paths) {
    for (const rightPath of right.paths) {
      if (pathOverlaps(leftPath, rightPath)) pathConflicts.push([leftPath, rightPath]);
    }
  }
  const rightContracts = new Set(right.contracts);
  const contractConflicts = left.contracts.filter((contract) => rightContracts.has(contract));
  return freeze({ pathConflicts, contractConflicts });
}

function conflictCodes(candidate, lanes, integrationLane) {
  const codes = [];
  const details = [];
  for (const lane of lanes) {
    if (!activeLane(lane)) continue;
    if (lane.id === candidate.id) codes.push('DUPLICATE_ACTIVE_LANE_ID');
    if (lane.goalId === candidate.goalId) codes.push('DUPLICATE_ACTIVE_GOAL');
    if (lane.branch === candidate.branch) codes.push('DUPLICATE_ACTIVE_BRANCH');
    const conflict = ownershipConflict(candidate.ownership, lane.ownership);
    if (conflict.pathConflicts.length) {
      codes.push('PATH_OWNERSHIP_OVERLAP');
      details.push({ laneId:lane.id, ...conflict });
    }
    if (conflict.contractConflicts.length) {
      codes.push('CONTRACT_OWNERSHIP_OVERLAP');
      details.push({ laneId:lane.id, ...conflict });
    }
  }
  if (integrationLane) {
    if (integrationLane.id === candidate.id) codes.push('INTEGRATION_LANE_ID_COLLISION');
    if (integrationLane.branch === candidate.branch) codes.push('INTEGRATION_LANE_BRANCH_COLLISION');
    const conflict = ownershipConflict(candidate.ownership, integrationLane.ownership);
    if (conflict.pathConflicts.length) {
      codes.push('INTEGRATION_LANE_PATH_OVERLAP');
      details.push({ laneId:integrationLane.id, ...conflict });
    }
    if (conflict.contractConflicts.length) {
      codes.push('INTEGRATION_LANE_CONTRACT_OVERLAP');
      details.push({ laneId:integrationLane.id, ...conflict });
    }
  }
  return freeze({ codes:unique(codes), details });
}

function dependenciesSatisfied(candidate, completedGoalIds) {
  const completed = new Set(array(completedGoalIds).map(text).filter(Boolean));
  return candidate.dependencies.every((dependency) => completed.has(dependency));
}

function decision(status, candidate, reasonCodes, details = []) {
  return freeze({
    schema:'Stephanos Parallel Construction Admission V1',
    status,
    laneId:candidate.id,
    goalId:candidate.goalId,
    branch:candidate.branch,
    baseSha:candidate.baseSha,
    reasonCodes:unique(reasonCodes),
    details,
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
    leaseSeizureAllowed:false,
    runtimeMutationAllowed:false,
  });
}

function inventoryFingerprint(lanes, integration, completedGoalIds, maxLanes) {
  return JSON.stringify({
    lanes,
    integration,
    completedGoalIds:unique(array(completedGoalIds).map(text).filter(Boolean)).sort(),
    maxLanes,
  });
}

function evaluateConstructionLaneAdmissionInternal(candidateInput, snapshot = {}, options = {}, authorityToken = null) {
  const candidate = normalizeLane(candidateInput);
  const optionRecord = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const maxLanesProvided = Object.hasOwn(optionRecord, 'maxLanes');
  if (maxLanesProvided && (!Number.isSafeInteger(optionRecord.maxLanes) || optionRecord.maxLanes <= 0)) {
    return decision('REJECTED', candidate, ['CONSTRUCTION_CAPACITY_LIMIT_INVALID']);
  }
  const maxLanes = maxLanesProvided ? optionRecord.maxLanes : DEFAULT_MAX_LANES;
  const snapshotValid = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
  if (!snapshotValid) return decision('REJECTED', candidate, ['ACTIVE_LANE_INVENTORY_INVALID']);
  const laneInventoryProvided = Object.hasOwn(snapshot, 'constructionLanes');
  if (!laneInventoryProvided || !denseArray(snapshot.constructionLanes)) {
    return decision('REJECTED', candidate, ['ACTIVE_LANE_INVENTORY_INVALID']);
  }
  if (!Object.hasOwn(snapshot, 'integrationLane')) {
    return decision('REJECTED', candidate, ['INTEGRATION_LANE_INVENTORY_INVALID']);
  }
  const laneInputs = array(snapshot.constructionLanes);
  const lanes = laneInputs.map(normalizeLane);
  const integration = normalizeIntegrationLane(snapshot.integrationLane);
  const integrationLane = integration.lane;

  if (laneInvalid(candidate)) return decision('REJECTED', candidate, ['CANDIDATE_CONTRACT_INVALID']);
  if (!ACTIVE_STATES.has(candidate.state)) return decision('REJECTED', candidate, ['CANDIDATE_STATE_NOT_ADMISSIBLE']);
  if (laneInputs.some((lane) => !lane || typeof lane !== 'object' || Array.isArray(lane)) || lanes.some(laneInvalid)) {
    return decision('REJECTED', candidate, ['ACTIVE_LANE_INVENTORY_INVALID']);
  }
  if (integration.invalid) return decision('REJECTED', candidate, ['INTEGRATION_LANE_INVENTORY_INVALID']);
  if (!dependenciesSatisfied(candidate, snapshot.completedGoalIds)) {
    return decision('SERIAL_QUEUE', candidate, ['DEPENDENCIES_INCOMPLETE']);
  }

  const active = lanes.filter(activeLane);
  if (active.length >= maxLanes) return decision('SERIAL_QUEUE', candidate, ['CONSTRUCTION_CAPACITY_FULL']);

  const conflicts = conflictCodes(candidate, lanes, integrationLane);
  if (conflicts.codes.length) return decision('SERIAL_QUEUE', candidate, conflicts.codes, conflicts.details);

  const admitted = decision('ADMITTED', candidate, [], [{
    leaseKind:'BOUNDED_CONSTRUCTION',
    ownedPaths:candidate.ownership.paths,
    ownedContracts:candidate.ownership.contracts,
  }]);
  ADMITTED_DECISIONS.set(admitted, {
    candidate,
    consumed:false,
    authorityToken,
    inventoryFingerprint:inventoryFingerprint(lanes, integration, snapshot.completedGoalIds, maxLanes),
  });
  return admitted;
}

export function evaluateConstructionLaneAdmission(candidateInput, snapshot = {}, options = {}) {
  return evaluateConstructionLaneAdmissionInternal(candidateInput, snapshot, options);
}

function validAdmittedDecision(admission) {
  const ownership = normalizeOwnership({
    paths:admission?.details?.[0]?.ownedPaths,
    contracts:admission?.details?.[0]?.ownedContracts,
  });
  return Boolean(
    admission
    && typeof admission === 'object'
    && !Array.isArray(admission)
    && ADMITTED_DECISIONS.has(admission)
    && admission.schema === 'Stephanos Parallel Construction Admission V1'
    && admission.status === 'ADMITTED'
    && text(admission.laneId)
    && text(admission.goalId)
    && text(admission.branch)
    && sha(admission.baseSha)
    && Array.isArray(admission.reasonCodes)
    && admission.reasonCodes.length === 0
    && Array.isArray(admission.details)
    && admission.details.length === 1
    && admission.details[0]?.leaseKind === 'BOUNDED_CONSTRUCTION'
    && !ownership.invalidPaths
    && !ownership.invalidContracts
    && (ownership.paths.length > 0 || ownership.contracts.length > 0)
    && JSON.stringify(ownership.paths) === JSON.stringify(admission.details[0].ownedPaths)
    && JSON.stringify(ownership.contracts) === JSON.stringify(admission.details[0].ownedContracts)
    && admission.mergeAuthority === false
    && admission.deploymentAuthority === false
    && admission.approvalAuthority === false
    && admission.leaseSeizureAllowed === false
    && admission.runtimeMutationAllowed === false
  );
}

async function createConstructionLaneLease(admission, options, authorityToken, reserveConstructionLane, trustedNowMs) {
  if (!validAdmittedDecision(admission)) throw new TypeError('admission must be the validated ADMITTED decision returned by the evaluator');
  const reservation = ADMITTED_DECISIONS.get(admission);
  if (!authorityToken || reservation.authorityToken !== authorityToken) {
    throw new TypeError('admission must be issued by this bounded construction authority');
  }
  if (reservation.consumed) throw new TypeError('admission reservation has already been consumed');
  const snapshot = options.inventorySnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !denseArray(snapshot.constructionLanes)
    || !Object.hasOwn(snapshot, 'integrationLane')) {
    throw new TypeError('a current explicit inventory snapshot is required');
  }
  const optionRecord = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const maxLanes = Object.hasOwn(optionRecord, 'maxLanes') ? optionRecord.maxLanes : DEFAULT_MAX_LANES;
  if (!Number.isSafeInteger(maxLanes) || maxLanes <= 0) throw new TypeError('current inventory capacity must be valid');
  const currentLanes = snapshot.constructionLanes.map(normalizeLane);
  const currentIntegration = normalizeIntegrationLane(snapshot.integrationLane);
  if (currentLanes.some(laneInvalid) || currentIntegration.invalid) {
    throw new TypeError('current inventory must be canonical and complete');
  }
  const currentFingerprint = inventoryFingerprint(
    currentLanes,
    currentIntegration,
    snapshot.completedGoalIds,
    maxLanes,
  );
  if (currentFingerprint !== reservation.inventoryFingerprint) {
    throw new TypeError('admission inventory is stale and must be re-evaluated');
  }
  const laneId = text(options.laneId);
  if (!laneId || laneId !== admission.laneId) throw new TypeError('laneId must exactly match the admitted lane');
  const issuedAt = text(options.issuedAt);
  const expiresAt = text(options.expiresAt);
  const issuedAtMs = timestamp(issuedAt);
  const expiresAtMs = timestamp(expiresAt);
  const nowMs = Number(trustedNowMs());
  if (issuedAtMs === null
    || expiresAtMs === null
    || !Number.isFinite(nowMs)
    || Math.abs(issuedAtMs - nowMs) > MAX_ISSUANCE_CLOCK_SKEW_MS
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > MAX_CONSTRUCTION_LEASE_MS) {
    throw new TypeError('issuedAt must match the trusted issuance clock and expiresAt must be a valid bounded timestamp');
  }
  const lease = freeze({
    schema:'Stephanos Bounded Construction Lease V1',
    laneId,
    goalId:admission.goalId,
    branch:admission.branch,
    baseSha:admission.baseSha,
    headSha:reservation.candidate.headSha,
    state:reservation.candidate.state,
    issuedAt,
    expiresAt,
    ownedPaths:admission.details[0]?.ownedPaths ?? [],
    ownedContracts:admission.details[0]?.ownedContracts ?? [],
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
    leaseSeizureAllowed:false,
    runtimeMutationAllowed:false,
  });
  const reserved = await reserveConstructionLane({
    lease,
    lane:reservation.candidate,
    expectedInventoryFingerprint:currentFingerprint,
    expectedActiveLaneCount:currentLanes.filter(activeLane).length,
    maxLanes,
  });
  const reservationId = text(reserved?.reservationId);
  if (reserved?.accepted !== true
    || !SAFE_ID.test(reservationId ?? '')
    || reserved.inventoryFingerprint !== currentFingerprint) {
    throw new TypeError('canonical construction-lane reservation was not atomically affirmed');
  }
  reservation.consumed = true;
  return freeze({
    ...lease,
    reservationId,
    inventoryFingerprint:currentFingerprint,
  });
}

async function exactHeadEvidenceRefs(values, lane, name, evidenceKind, resolveVerifierEvidence) {
  if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array`);
  const refs = [];
  for (const suppliedRef of values) {
    const ref = text(suppliedRef);
    if (!ref) throw new TypeError(`${name} must contain immutable evidence references`);
    const resolved = await resolveVerifierEvidence({
      ref,
      evidenceKind,
      branch:lane.branch,
      headSha:lane.headSha,
    });
    const value = resolved?.result;
    const validation = validateVerifierResult(value);
    if (resolved?.authenticated !== true
      || resolved?.immutable !== true
      || resolved.ref !== ref
      || !validation.valid
      || value.status !== 'PASS'
      || !text(value.finalVerdict)?.endsWith('_PASS')
      || resolved.evidenceKind !== evidenceKind
      || !ref
      || !array(value.proofRefs).includes(ref)
      || timestamp(value.timestampUtc) === null
      || text(resolved.branch) !== lane.branch
      || sha(resolved.headSha) !== lane.headSha) {
      throw new TypeError(`${name} evidence must match the lane branch and exact head`);
    }
    refs.push(ref);
  }
  return unique(refs);
}

async function exactHeadLaneFromReservation(
  reservationRef,
  resolveConstructionLaneReservation,
  trustedNowMs,
) {
  const ref = text(reservationRef);
  if (!ref || !SAFE_ID.test(ref)) throw new TypeError('reservationRef must be an immutable construction-lane reference');
  const resolved = await resolveConstructionLaneReservation({ reservationId:ref });
  const lane = normalizeLane(resolved?.lane);
  const issuedAtMs = timestamp(resolved?.issuedAt);
  const expiresAtMs = timestamp(resolved?.expiresAt);
  const nowMs = Number(trustedNowMs());
  if (resolved?.authenticated !== true
    || resolved?.active !== true
    || resolved?.immutable !== true
    || resolved?.reservationId !== ref
    || !text(resolved?.inventoryFingerprint)
    || issuedAtMs === null
    || expiresAtMs === null
    || !Number.isFinite(nowMs)
    || issuedAtMs - nowMs > MAX_ISSUANCE_CLOCK_SKEW_MS
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > MAX_CONSTRUCTION_LEASE_MS
    || expiresAtMs <= nowMs
    || laneInvalid(lane)
    || !lane.headSha
    || !ACTIVE_STATES.has(lane.state)) {
    throw new TypeError('reservationRef must resolve to an authenticated active exact-head construction lease');
  }
  return lane;
}

async function createReadyForIntegrationReceipt(
  reservationRef,
  evidence,
  resolveConstructionLaneReservation,
  resolveVerifierEvidence,
  resolveMainHead,
  trustedNowMs,
) {
  const lane = await exactHeadLaneFromReservation(
    reservationRef,
    resolveConstructionLaneReservation,
    trustedNowMs,
  );
  const testRefs = await exactHeadEvidenceRefs(evidence.testRefs, lane, 'testRefs', 'TEST', resolveVerifierEvidence);
  const proofRefs = await exactHeadEvidenceRefs(evidence.proofRefs, lane, 'proofRefs', 'PROOF', resolveVerifierEvidence);
  const currentLane = await exactHeadLaneFromReservation(
    reservationRef,
    resolveConstructionLaneReservation,
    trustedNowMs,
  );
  if (JSON.stringify(currentLane) !== JSON.stringify(lane)) {
    throw new TypeError('construction lease changed while readiness evidence was resolving');
  }
  const main = await resolveMainHead({ branch:'main' });
  const currentMainSha = sha(main?.headSha);
  if (main?.authenticated !== true
    || main?.immutable !== true
    || main?.branch !== 'main'
    || !currentMainSha) {
    throw new TypeError('current main head must be resolved through authenticated immutable repository truth');
  }
  const observedAt = text(evidence.observedAt);
  const observedAtMs = timestamp(observedAt);
  const nowMs = Number(trustedNowMs());
  if (observedAtMs === null
    || !Number.isFinite(nowMs)
    || Math.abs(observedAtMs - nowMs) > MAX_ISSUANCE_CLOCK_SKEW_MS) {
    throw new TypeError('observedAt must be valid and match the trusted observation clock');
  }

  return freeze({
    schema:'Stephanos Ready For Integration Receipt V1',
    status:'READY_FOR_INTEGRATION',
    laneId:currentLane.id,
    goalId:currentLane.goalId,
    branch:currentLane.branch,
    baseSha:currentLane.baseSha,
    headSha:currentLane.headSha,
    currentMainSha,
    mainDrifted:currentLane.baseSha !== currentMainSha,
    ownedPaths:currentLane.ownership.paths,
    ownedContracts:currentLane.ownership.contracts,
    testRefs,
    proofRefs,
    caveats:unique(array(evidence.caveats).map(text).filter(Boolean)),
    observedAt,
    requiresFreshIntegrationValidation:true,
    mergeAuthority:false,
    deploymentAuthority:false,
    approvalAuthority:false,
  });
}

export function createBoundedParallelConstructionAuthority(adapters = {}) {
  const reserveConstructionLane = requiredFunction(adapters.reserveConstructionLane, 'reserveConstructionLane');
  const resolveConstructionLaneReservation = requiredFunction(
    adapters.resolveConstructionLaneReservation,
    'resolveConstructionLaneReservation',
  );
  const resolveVerifierEvidence = requiredFunction(adapters.resolveVerifierEvidence, 'resolveVerifierEvidence');
  const resolveMainHead = requiredFunction(adapters.resolveMainHead, 'resolveMainHead');
  const trustedNowMs = requiredFunction(adapters.nowMs, 'nowMs');
  const authorityToken = freeze({});
  return freeze({
    evaluateAdmission(candidateInput, snapshot = {}, options = {}) {
      return evaluateConstructionLaneAdmissionInternal(candidateInput, snapshot, options, authorityToken);
    },
    issueLease(admission, options = {}) {
      return createConstructionLaneLease(
        admission,
        options,
        authorityToken,
        reserveConstructionLane,
        trustedNowMs,
      );
    },
    createReadyReceipt(reservationRef, evidence = {}) {
      return createReadyForIntegrationReceipt(
        reservationRef,
        evidence,
        resolveConstructionLaneReservation,
        resolveVerifierEvidence,
        resolveMainHead,
        trustedNowMs,
      );
    },
  });
}
