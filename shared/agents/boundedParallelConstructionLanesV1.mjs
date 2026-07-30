const SHA_RE = /^[0-9a-f]{40}$/i;
const TERMINAL_STATES = new Set(['READY_FOR_INTEGRATION', 'BLOCKED', 'SUPERSEDED', 'FAILED', 'CANCELLED']);
const ACTIVE_STATES = new Set(['ADMITTED', 'BUILDING', 'TESTING', 'PROOF_RUNNING']);
const KNOWN_STATES = new Set([...ACTIVE_STATES, ...TERMINAL_STATES]);
const INTEGRATION_STATES = new Set([...KNOWN_STATES, 'CI_REVIEW', 'INTEGRATING']);
const FORBIDDEN_CAPABILITIES = new Set(['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']);
const DEFAULT_MAX_LANES = 4;
const EXACT_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i;
const ADMITTED_DECISIONS = new WeakMap();

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

function normalizedPath(value) {
  const supplied = text(value);
  if (!supplied || /^[a-z]:/i.test(supplied)) return null;
  const candidate = supplied.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!candidate || candidate.startsWith('/')) return null;
  const segments = candidate.split('/');
  if (segments.some((segment) => segment === '..')) return null;
  const normalized = segments.filter((segment) => segment && segment !== '.').join('/');
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
  return !lane.id
    || !lane.goalId
    || !lane.branch
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
  if (candidate === undefined || candidate === null) return freeze({ invalid:false, lane:null });
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return freeze({ invalid:true, lane:null });
  const id = text(candidate.id);
  const branch = text(candidate.branch);
  const state = normalizedState(candidate.state);
  const ownership = normalizeOwnership(candidate.ownership);
  const terminal = TERMINAL_STATES.has(state);
  const invalid = !id
    || !branch
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

export function evaluateConstructionLaneAdmission(candidateInput, snapshot = {}, options = {}) {
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
  if (!laneInventoryProvided || !Array.isArray(snapshot.constructionLanes)) {
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
    inventoryFingerprint:inventoryFingerprint(lanes, integration, snapshot.completedGoalIds, maxLanes),
  });
  return admitted;
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

export function createConstructionLaneLease(admission, options = {}) {
  if (!validAdmittedDecision(admission)) throw new TypeError('admission must be the validated ADMITTED decision returned by the evaluator');
  const reservation = ADMITTED_DECISIONS.get(admission);
  if (reservation.consumed) throw new TypeError('admission reservation has already been consumed');
  const snapshot = options.inventorySnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Array.isArray(snapshot.constructionLanes)
    || !Object.hasOwn(snapshot, 'integrationLane')) {
    throw new TypeError('a current explicit inventory snapshot is required');
  }
  const optionRecord = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const maxLanes = Object.hasOwn(optionRecord, 'maxLanes') ? optionRecord.maxLanes : DEFAULT_MAX_LANES;
  if (!Number.isSafeInteger(maxLanes) || maxLanes <= 0) throw new TypeError('current inventory capacity must be valid');
  const currentLanes = snapshot.constructionLanes.map(normalizeLane);
  const currentIntegration = normalizeIntegrationLane(snapshot.integrationLane);
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
  if (issuedAtMs === null || expiresAtMs === null || expiresAtMs <= issuedAtMs) {
    throw new TypeError('issuedAt and expiresAt must be valid increasing timestamps');
  }
  reservation.consumed = true;
  return freeze({
    schema:'Stephanos Bounded Construction Lease V1',
    laneId,
    goalId:admission.goalId,
    branch:admission.branch,
    baseSha:admission.baseSha,
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
}

function exactHeadEvidenceRefs(values, lane, name, evidenceKind) {
  if (!Array.isArray(values) || !values.length) throw new TypeError(`${name} must be a non-empty array`);
  const refs = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must contain structured exact-head evidence`);
    const ref = text(value.ref);
    const validation = validateVerifierResult(value);
    if (!validation.valid
      || value.status !== 'PASS'
      || !text(value.finalVerdict)?.endsWith('_PASS')
      || value.evidenceKind !== evidenceKind
      || !ref
      || !array(value.proofRefs).includes(ref)
      || text(value.branch) !== lane.branch
      || sha(value.headSha) !== lane.headSha) {
      throw new TypeError(`${name} evidence must match the lane branch and exact head`);
    }
    refs.push(ref);
  }
  return unique(refs);
}

export function createReadyForIntegrationReceipt(laneInput, evidence = {}) {
  const lane = normalizeLane(laneInput);
  if (laneInvalid(lane) || !lane.headSha) throw new TypeError('lane must include valid identity, ownership, baseSha and headSha');
  if (!ACTIVE_STATES.has(lane.state)) throw new TypeError('lane state is not eligible for readiness');
  const testRefs = exactHeadEvidenceRefs(evidence.testRefs, lane, 'testRefs', 'TEST');
  const proofRefs = exactHeadEvidenceRefs(evidence.proofRefs, lane, 'proofRefs', 'PROOF');
  const observedAt = text(evidence.observedAt);
  const observedAtMs = timestamp(observedAt);
  const currentMainSha = sha(evidence.currentMainSha);
  if (observedAtMs === null || !currentMainSha) {
    throw new TypeError('observedAt and currentMainSha must be valid');
  }

  return freeze({
    schema:'Stephanos Ready For Integration Receipt V1',
    status:'READY_FOR_INTEGRATION',
    laneId:lane.id,
    goalId:lane.goalId,
    branch:lane.branch,
    baseSha:lane.baseSha,
    headSha:lane.headSha,
    currentMainSha,
    mainDrifted:lane.baseSha !== currentMainSha,
    ownedPaths:lane.ownership.paths,
    ownedContracts:lane.ownership.contracts,
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
import { validateVerifierResult } from './verificationHarness.mjs';
