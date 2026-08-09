export const ELASTIC_BUILD_CAPACITY_SCHEMA = 'stephanos.elastic-build-capacity.v1';
export const MINIMUM_BUILD_LANES = 5;
export const MAXIMUM_BUILD_LANES = 16;

const SAFE_RESOURCE_ID = /^[a-z0-9][a-z0-9._:/-]{0,239}$/i;

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

function resourceIds(value) {
  if (!denseArray(value)) return null;
  const normalized = value.map((entry) => typeof entry === 'string' ? entry.trim().toLowerCase() : '');
  if (normalized.some((entry) => !SAFE_RESOURCE_ID.test(entry))) return null;
  return [...new Set(normalized)].sort();
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

  const owned = new Set(active);
  const selected = [];
  const held = [];
  for (const candidate of candidates) {
    const id = typeof candidate?.candidateId === 'string' ? candidate.candidateId.trim() : '';
    const resources = resourceIds(candidate?.resourceIds);
    if (!id || !resources || resources.length === 0) {
      held.push({ candidateId:id || null, reasonCode:'RESOURCE_SCOPE_REQUIRED' });
      continue;
    }
    const conflicts = resources.filter((resourceId) => owned.has(resourceId));
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
