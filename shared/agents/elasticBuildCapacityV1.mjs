export const ELASTIC_BUILD_CAPACITY_SCHEMA = 'stephanos.elastic-build-capacity.v1';
export const MINIMUM_BUILD_LANES = 5;
export const MAXIMUM_BUILD_LANES = 16;

const SAFE_RESOURCE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/i;
const SAFE_REPOSITORY_PATH_SEGMENT = /^[a-z0-9._-]+$/i;
const WIN32_RESERVED_PATH_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function repositoryPathResource(value) {
  const match = value.match(/^repo:([^:]+\/[^:]+):path:(.+)$/);
  if (!match) return null;
  const segments = match[2].split('/');
  if (segments.some((segment) => (
    !segment
    || segment === '.'
    || segment === '..'
    || !SAFE_REPOSITORY_PATH_SEGMENT.test(segment)
    || segment.endsWith('.')
    || segment.endsWith(' ')
    || WIN32_RESERVED_PATH_STEM.test(segment)
  ))) return null;
  return { repository:match[1], path:segments.join('/') };
}

function canonicalResourceId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SAFE_RESOURCE_ID.test(normalized)) return null;
  if (!normalized.startsWith('repo:') || !normalized.includes(':path:')) return normalized;
  const parsed = repositoryPathResource(normalized);
  return parsed ? `repo:${parsed.repository}:path:${parsed.path}` : null;
}

function resourceIds(value) {
  if (!denseArray(value)) return null;
  const normalized = value.map(canonicalResourceId);
  if (normalized.some((entry) => entry === null) || new Set(normalized).size !== normalized.length) return null;
  return normalized.sort();
}

function resourceConflictIndex(initial = []) {
  const exact = new Set();
  const roots = new Map();
  const add = (resourceId) => {
    exact.add(resourceId);
    const parsed = repositoryPathResource(resourceId);
    if (!parsed) return;
    let node = roots.get(parsed.repository);
    if (!node) {
      node = { terminal:false, children:new Map() };
      roots.set(parsed.repository, node);
    }
    for (const segment of parsed.path.split('/')) {
      if (!node.children.has(segment)) node.children.set(segment, { terminal:false, children:new Map() });
      node = node.children.get(segment);
    }
    node.terminal = true;
  };
  const conflicts = (resourceId) => {
    if (exact.has(resourceId)) return true;
    const parsed = repositoryPathResource(resourceId);
    if (!parsed) return false;
    let node = roots.get(parsed.repository);
    if (!node) return false;
    if (node.terminal) return true;
    for (const segment of parsed.path.split('/')) {
      node = node.children.get(segment);
      if (!node) return false;
      if (node.terminal) return true;
    }
    return node.children.size > 0;
  };
  for (const resourceId of initial) add(resourceId);
  return { add, conflicts };
}

export function projectCanonicalResourceIds(value) {
  const normalized = resourceIds(value);
  return freeze({
    valid:normalized !== null,
    resourceIds:normalized ?? [],
    finalVerdict:normalized === null ? 'RESOURCE_IDS_INVALID' : 'RESOURCE_IDS_CANONICAL',
  });
}

export function adjudicateResourceScopeOverlap(left, right) {
  const leftProjection = projectCanonicalResourceIds(left);
  const rightProjection = projectCanonicalResourceIds(right);
  if (!leftProjection.valid || !rightProjection.valid) {
    return freeze({ valid:false, overlaps:false, conflictingResourceIds:[], finalVerdict:'RESOURCE_SCOPE_OVERLAP_INVALID' });
  }
  const owned = resourceConflictIndex(leftProjection.resourceIds);
  const conflictingResourceIds = rightProjection.resourceIds.filter((resourceId) => owned.conflicts(resourceId));
  return freeze({
    valid:true,
    overlaps:conflictingResourceIds.length > 0,
    conflictingResourceIds,
    finalVerdict:conflictingResourceIds.length ? 'RESOURCE_SCOPES_OVERLAP' : 'RESOURCE_SCOPES_DISJOINT',
  });
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

export function deriveElasticBuildWidth(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const minimum = integer(source.minimumLanes) ?? MINIMUM_BUILD_LANES;
  const maximum = integer(source.maximumLanes) ?? MAXIMUM_BUILD_LANES;
  const active = integer(source.activeLaneCount);
  const ready = integer(source.readyIndependentWorkCount);
  const available = integer(source.availableExecutorSlots);
  const invalid = minimum < MINIMUM_BUILD_LANES
    || maximum < minimum
    || maximum > MAXIMUM_BUILD_LANES
    || active === null
    || ready === null
    || available === null;

  if (invalid) return freeze({
    schemaVersion:ELASTIC_BUILD_CAPACITY_SCHEMA,
    status:'SAFE_HOLD_INVALID_CAPACITY',
    minimumLanes:minimum,
    maximumLanes:maximum,
    activeLaneCount:active,
    readyIndependentWorkCount:ready,
    availableExecutorSlots:available,
    desiredWidth:0,
    remainingAdmissionSlots:0,
    scaleAction:'SAFE_HOLD',
    reasonCodes:['INVALID_CAPACITY_EVIDENCE'],
    mutationAuthority:false,
  });

  const demandedWidth = active + ready;
  const healthyBaseline = available >= minimum;
  const desiredWidth = Math.min(maximum, available, Math.max(minimum, demandedWidth));
  const remainingAdmissionSlots = Math.max(0, desiredWidth - active);
  const status = healthyBaseline ? 'RUNNING' : 'DEGRADED_CAPACITY';
  const scaleAction = !healthyBaseline
    ? 'SAFE_HOLD'
    : desiredWidth > active
      ? 'SCALE_OUT'
      : desiredWidth < active
        ? 'SCALE_IN'
        : 'HOLD';
  const reasonCodes = [
    ...(!healthyBaseline ? ['BASELINE_CAPACITY_SHORTFALL'] : []),
    ...(demandedWidth > maximum ? ['POLICY_MAXIMUM_REACHED'] : []),
    ...(ready > remainingAdmissionSlots ? ['ELIGIBLE_WORK_REMAINS_QUEUED'] : []),
  ];
  return freeze({
    schemaVersion:ELASTIC_BUILD_CAPACITY_SCHEMA,
    status,
    minimumLanes:minimum,
    maximumLanes:maximum,
    activeLaneCount:active,
    readyIndependentWorkCount:ready,
    availableExecutorSlots:available,
    desiredWidth,
    remainingAdmissionSlots,
    scaleAction,
    reasonCodes,
    mutationAuthority:false,
  });
}

export function selectResourceDisjointCandidates(candidates = [], options = {}) {
  if (!denseArray(candidates)) return freeze({ selected:[], held:[], reasonCodes:['INVALID_CANDIDATE_INVENTORY'] });
  const limit = integer(options.limit);
  const active = resourceIds(options.activeResourceIds ?? []);
  if (limit === null || limit > MAXIMUM_BUILD_LANES || active === null) {
    return freeze({ selected:[], held:[], reasonCodes:['INVALID_PARALLEL_SELECTION_POLICY'] });
  }

  const candidateIds = candidates.map((candidate) => typeof candidate?.candidateId === 'string' ? candidate.candidateId.trim() : '');
  const candidateIdCounts = new Map();
  for (const id of candidateIds) if (id) candidateIdCounts.set(id, (candidateIdCounts.get(id) ?? 0) + 1);
  const duplicateCandidateIds = new Set([...candidateIdCounts].filter(([, count]) => count > 1).map(([id]) => id));
  if (duplicateCandidateIds.size) return freeze({
    selected:[],
    held:candidateIds.map((id) => ({
      candidateId:id || null,
      reasonCode:duplicateCandidateIds.has(id) ? 'DUPLICATE_CANDIDATE_ID' : 'INVALID_CANDIDATE_INVENTORY',
    })),
    reasonCodes:['DUPLICATE_CANDIDATE_ID', ...(candidateIds.some((id) => !duplicateCandidateIds.has(id)) ? ['INVALID_CANDIDATE_INVENTORY'] : [])],
  });

  const owned = resourceConflictIndex(active);
  const selected = [];
  const held = [];
  for (const candidate of candidates) {
    const id = typeof candidate?.candidateId === 'string' ? candidate.candidateId.trim() : '';
    const resources = resourceIds(candidate?.resourceIds);
    if (!id || !resources || resources.length === 0) {
      held.push({ candidateId:id || null, reasonCode:'RESOURCE_SCOPE_REQUIRED' });
      continue;
    }
    const conflicts = resources.filter((resourceId) => owned.conflicts(resourceId));
    if (conflicts.length) {
      held.push({ candidateId:id, reasonCode:'RESOURCE_CONFLICT', conflictingResourceIds:conflicts });
      continue;
    }
    if (selected.length >= limit) {
      held.push({ candidateId:id, reasonCode:'PARALLEL_CAPACITY_FULL' });
      continue;
    }
    selected.push(candidate);
    for (const resourceId of resources) owned.add(resourceId);
  }
  return freeze({
    selected,
    held,
    reasonCodes:[...new Set(held.map(({ reasonCode }) => reasonCode))],
  });
}
