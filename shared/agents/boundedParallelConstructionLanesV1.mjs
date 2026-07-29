const SHA_RE = /^[0-9a-f]{40}$/i;
const TERMINAL_STATES = new Set(['READY_FOR_INTEGRATION', 'BLOCKED', 'SUPERSEDED', 'FAILED', 'CANCELLED']);
const ACTIVE_STATES = new Set(['ADMITTED', 'BUILDING', 'TESTING', 'PROOF_RUNNING']);
const FORBIDDEN_CAPABILITIES = new Set(['MERGE', 'DEPLOY', 'APPROVE', 'LEASE_SEIZE', 'RUNTIME_MUTATE']);
const DEFAULT_MAX_LANES = 4;

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
  const candidate = text(value)?.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!candidate || candidate.startsWith('/') || candidate.includes('../') || candidate === '..') return null;
  return candidate.replace(/\/$/, '');
}

function normalizedContract(value) {
  return text(value)?.toLowerCase() ?? null;
}

function normalizedState(value) {
  return text(value)?.toUpperCase() ?? 'UNKNOWN';
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
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function normalizeOwnership(candidate = {}) {
  const rawPaths = array(candidate.paths);
  const rawContracts = array(candidate.contracts);
  const paths = rawPaths.map(normalizedPath).filter(Boolean);
  const contracts = rawContracts.map(normalizedContract).filter(Boolean);
  const invalidPaths = rawPaths.length !== paths.length;
  const invalidContracts = rawContracts.length !== contracts.length;
  return freeze({
    paths:unique(paths).sort(),
    contracts:unique(contracts).sort(),
    invalidPaths,
    invalidContracts,
  });
}

function normalizeLane(candidate = {}) {
  const ownership = normalizeOwnership(candidate.ownership);
  const capabilities = unique(array(candidate.capabilities).map((value) => text(value)?.toUpperCase()).filter(Boolean)).sort();
  return freeze({
    id:text(candidate.id),
    goalId:text(candidate.goalId),
    branch:text(candidate.branch),
    baseSha:sha(candidate.baseSha),
    headSha:sha(candidate.headSha),
    state:normalizedState(candidate.state),
    ownership,
    capabilities,
    dependencies:unique(array(candidate.dependencies).map(text).filter(Boolean)).sort(),
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
    || lane.capabilities.some((capability) => FORBIDDEN_CAPABILITIES.has(capability));
}

function activeLane(lane) {
  return ACTIVE_STATES.has(lane.state);
}

function activeIntegrationLane(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const id = text(candidate.id);
  const branch = text(candidate.branch);
  const state = normalizedState(candidate.state);
  return id && branch && !TERMINAL_STATES.has(state) ? freeze({ id, branch, state, ownership:normalizeOwnership(candidate.ownership) }) : null;
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

export function evaluateConstructionLaneAdmission(candidateInput, snapshot = {}, options = {}) {
  const candidate = normalizeLane(candidateInput);
  const maxLanes = Number.isSafeInteger(options.maxLanes) && options.maxLanes > 0 ? options.maxLanes : DEFAULT_MAX_LANES;
  const laneInputs = array(snapshot.constructionLanes);
  const lanes = laneInputs.map(normalizeLane);
  const integrationLane = activeIntegrationLane(snapshot.integrationLane);

  if (laneInvalid(candidate)) return decision('REJECTED', candidate, ['CANDIDATE_CONTRACT_INVALID']);
  if (laneInputs.some((lane) => !lane || typeof lane !== 'object' || Array.isArray(lane)) || lanes.some(laneInvalid)) {
    return decision('REJECTED', candidate, ['ACTIVE_LANE_INVENTORY_INVALID']);
  }
  if (!dependenciesSatisfied(candidate, snapshot.completedGoalIds)) {
    return decision('SERIAL_QUEUE', candidate, ['DEPENDENCIES_INCOMPLETE']);
  }

  const active = lanes.filter(activeLane);
  if (active.length >= maxLanes) return decision('SERIAL_QUEUE', candidate, ['CONSTRUCTION_CAPACITY_FULL']);

  const conflicts = conflictCodes(candidate, lanes, integrationLane);
  if (conflicts.codes.length) return decision('SERIAL_QUEUE', candidate, conflicts.codes, conflicts.details);

  return decision('ADMITTED', candidate, [], [{
    leaseKind:'BOUNDED_CONSTRUCTION',
    ownedPaths:candidate.ownership.paths,
    ownedContracts:candidate.ownership.contracts,
  }]);
}

export function createConstructionLaneLease(admission, options = {}) {
  if (!admission || admission.status !== 'ADMITTED') throw new TypeError('admission must be an ADMITTED decision');
  const issuedAt = text(options.issuedAt);
  const expiresAt = text(options.expiresAt);
  if (!issuedAt || !expiresAt || !Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new TypeError('issuedAt and expiresAt must be valid increasing timestamps');
  }
  return freeze({
    schema:'Stephanos Bounded Construction Lease V1',
    laneId:text(options.laneId),
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

export function createReadyForIntegrationReceipt(laneInput, evidence = {}) {
  const lane = normalizeLane(laneInput);
  if (laneInvalid(lane) || !lane.headSha) throw new TypeError('lane must include valid identity, ownership, baseSha and headSha');
  const testRefs = unique(array(evidence.testRefs).map(text).filter(Boolean));
  const proofRefs = unique(array(evidence.proofRefs).map(text).filter(Boolean));
  const observedAt = text(evidence.observedAt);
  const currentMainSha = sha(evidence.currentMainSha);
  if (!testRefs.length || !proofRefs.length || !observedAt || !currentMainSha) throw new TypeError('testRefs, proofRefs, observedAt and currentMainSha are required');

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
