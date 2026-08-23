const SHA = /^[a-f0-9]{40}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,239}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SURFACES = new Set(['github', 'forge']);
const LANE_STATES = new Set(['building', 'ready', 'blocked', 'complete']);
const PACKET_STATES = new Set(['ready', 'held', 'published', 'rejected']);
const MAX_LANES = 32;
const MAX_PACKETS = 128;
const MAX_PUBLISHED_PACKET_IDS = 1024;
const MAX_CHANGED_FILES = 256;
const MAX_PROOF_REFS = 128;

export const DUAL_FORGE_SCHEMA = 'stephanos.dual-forge-construction-sidecar.v1';
export const DUAL_FORGE_DECISIONS = Object.freeze({
  BLOCKED: 'DUAL_FORGE_BLOCKED',
  BUILDING: 'DUAL_FORGE_BUILDING_IN_PARALLEL',
  INTEGRATION_BUSY: 'DUAL_FORGE_INTEGRATION_BUSY',
  API_BUDGET_HELD: 'DUAL_FORGE_GITHUB_API_BUDGET_HELD',
  SETTLING: 'DUAL_FORGE_PACKETS_SETTLING',
  READY: 'DUAL_FORGE_PACKET_READY_FOR_GITHUB_PUBLICATION',
});

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : Number.NaN;
}

function unique(values) {
  return [...new Set(values)];
}

function parseInstant(value) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? parsed
    : Number.NaN;
}

function safePath(value) {
  const path = text(value).replaceAll('\\', '/');
  return Boolean(
    path
    && path.length <= 512
    && !path.startsWith('/')
    && !/^[a-z]:\//i.test(path)
    && !path.includes('\0')
    && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..')
  );
}

function safeProofRef(value) {
  const ref = text(value).replaceAll('\\', '/');
  return safePath(ref)
    && /^(?:proof|proofs|receipts|evidence\/receipts)\//.test(ref)
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref);
}

function normalizeLane(lane = {}) {
  return Object.freeze({
    laneId: text(lane.laneId),
    goalId: text(lane.goalId),
    surface: text(lane.surface).toLowerCase(),
    state: text(lane.state).toLowerCase(),
    branch: text(lane.branch),
    baseHead: text(lane.baseHead).toLowerCase(),
    head: text(lane.head).toLowerCase(),
  });
}

function normalizePacket(packet = {}) {
  const changedFiles = Array.isArray(packet.changedFiles)
    ? unique(packet.changedFiles.map(text).filter(Boolean)).sort()
    : null;
  const proofRefs = Array.isArray(packet.proofRefs)
    ? unique(packet.proofRefs.map(text).filter(Boolean)).sort()
    : null;
  const dependencies = Array.isArray(packet.dependsOnPacketIds)
    ? unique(packet.dependsOnPacketIds.map(text).filter(Boolean)).sort()
    : null;
  return Object.freeze({
    packetId: text(packet.packetId),
    laneId: text(packet.laneId),
    repository: text(packet.repository),
    state: text(packet.state || 'ready').toLowerCase(),
    baseHead: text(packet.baseHead).toLowerCase(),
    head: text(packet.head).toLowerCase(),
    tree: text(packet.tree).toLowerCase(),
    changedFiles,
    proofRefs,
    dependsOnPacketIds: dependencies,
    settledAtUtc: text(packet.settledAtUtc),
    priority: integer(packet.priority),
  });
}

function normalizeActiveIntegration(activeIntegration) {
  if (activeIntegration === null || activeIntegration === undefined) return null;
  if (!activeIntegration || typeof activeIntegration !== 'object' || Array.isArray(activeIntegration)) {
    return Object.freeze({ packetId: '', head: '' });
  }
  return Object.freeze({
    packetId: text(activeIntegration.packetId),
    head: text(activeIntegration.head).toLowerCase(),
  });
}

function validateApiBudget(raw = {}) {
  const limit = integer(raw.limit);
  const remaining = integer(raw.remaining);
  const reserve = integer(raw.reserve);
  const estimatedPublicationCost = integer(raw.estimatedPublicationCost);
  const resetAtUtc = text(raw.resetAtUtc);
  const resetAtMs = parseInstant(resetAtUtc);
  const blockers = [];
  if (!Number.isSafeInteger(limit) || limit <= 0) blockers.push('github-api-limit-invalid');
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > limit) {
    blockers.push('github-api-remaining-invalid');
  }
  if (!Number.isSafeInteger(reserve) || reserve < 0 || reserve > limit) {
    blockers.push('github-api-reserve-invalid');
  }
  if (!Number.isSafeInteger(estimatedPublicationCost) || estimatedPublicationCost <= 0) {
    blockers.push('github-api-publication-cost-invalid');
  }
  if (!Number.isFinite(resetAtMs)) blockers.push('github-api-reset-invalid');
  const safelyAvailable = blockers.length
    ? 0
    : Math.max(0, remaining - reserve);
  return Object.freeze({
    valid: blockers.length === 0,
    limit,
    remaining,
    reserve,
    estimatedPublicationCost,
    safelyAvailable,
    resetAtUtc: Number.isFinite(resetAtMs) ? new Date(resetAtMs).toISOString() : null,
    blockers: Object.freeze(blockers),
  });
}

function validateLane(lane, canonicalMainHead) {
  const blockers = [];
  if (!SAFE_ID.test(lane.laneId)) blockers.push('lane-id-invalid');
  if (!SAFE_ID.test(lane.goalId)) blockers.push('lane-goal-invalid');
  if (!SURFACES.has(lane.surface)) blockers.push('lane-surface-invalid');
  if (!LANE_STATES.has(lane.state)) blockers.push('lane-state-invalid');
  if (!SAFE_BRANCH.test(lane.branch) || lane.branch.includes('..')) blockers.push('lane-branch-invalid');
  if (!SHA.test(lane.baseHead)) blockers.push('lane-base-invalid');
  if (!SHA.test(lane.head)) blockers.push('lane-head-invalid');
  if (lane.state === 'ready' && lane.baseHead !== canonicalMainHead) blockers.push('lane-base-stale');
  return blockers;
}

function validatePacket(packet, lanesById, canonicalMainHead, nowMs) {
  const blockers = [];
  if (!SAFE_ID.test(packet.packetId)) blockers.push('packet-id-invalid');
  if (!SAFE_ID.test(packet.laneId)) blockers.push('packet-lane-invalid');
  if (!SAFE_REPOSITORY.test(packet.repository)) blockers.push('packet-repository-invalid');
  if (!PACKET_STATES.has(packet.state)) blockers.push('packet-state-invalid');
  if (!SHA.test(packet.baseHead)) blockers.push('packet-base-invalid');
  if (!SHA.test(packet.head)) blockers.push('packet-head-invalid');
  if (!SHA.test(packet.tree)) blockers.push('packet-tree-invalid');
  if (packet.baseHead === packet.head) blockers.push('packet-no-source-change');
  if (packet.baseHead !== canonicalMainHead) blockers.push('packet-base-stale');
  if (!Array.isArray(packet.changedFiles) || packet.changedFiles.length < 1) {
    blockers.push('packet-files-missing');
  } else if (packet.changedFiles.length > MAX_CHANGED_FILES) {
    blockers.push('packet-files-exceed-bound');
  } else if (packet.changedFiles.some((path) => !safePath(path))) {
    blockers.push('packet-file-path-invalid');
  }
  if (!Array.isArray(packet.proofRefs)) blockers.push('packet-proof-refs-invalid');
  else if (packet.proofRefs.length > MAX_PROOF_REFS) blockers.push('packet-proof-refs-exceed-bound');
  else if (packet.proofRefs.some((ref) => !safeProofRef(ref))) blockers.push('packet-proof-ref-unsafe');
  if (!Array.isArray(packet.dependsOnPacketIds)) blockers.push('packet-dependencies-invalid');
  else {
    if (packet.dependsOnPacketIds.some((id) => !SAFE_ID.test(id))) blockers.push('packet-dependency-id-invalid');
    if (packet.dependsOnPacketIds.includes(packet.packetId)) blockers.push('packet-dependency-self');
  }
  if (!Number.isSafeInteger(packet.priority) || packet.priority < 0 || packet.priority > 1000) {
    blockers.push('packet-priority-invalid');
  }
  const settledAtMs = parseInstant(packet.settledAtUtc);
  if (!Number.isFinite(settledAtMs)) blockers.push('packet-settled-at-invalid');
  else if (settledAtMs > nowMs) blockers.push('packet-settled-in-future');
  const lane = lanesById.get(packet.laneId);
  if (!lane) blockers.push('packet-lane-not-found');
  else {
    if (lane.state !== 'ready') blockers.push('packet-lane-not-ready');
    if (lane.baseHead !== packet.baseHead) blockers.push('packet-lane-base-mismatch');
    if (lane.head !== packet.head) blockers.push('packet-lane-head-mismatch');
  }
  return Object.freeze({ blockers, settledAtMs });
}

function authorityProjection() {
  return Object.freeze({
    sourceMutation: false,
    branchUpdate: false,
    forcePush: false,
    merge: false,
    deployment: false,
    runtimeMutation: false,
    credentialAccess: false,
    arbitraryCommand: false,
    publicationRequiresExternalAdapter: true,
  });
}

export function planDualForgeConstructionSidecar(input = {}) {
  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const nowUtc = text(input.nowUtc);
  const nowMs = parseInstant(nowUtc);
  const settleWindowSeconds = integer(input.settleWindowSeconds ?? 120);
  const lanes = Array.isArray(input.lanes) ? input.lanes.map(normalizeLane) : null;
  const packets = Array.isArray(input.packets) ? input.packets.map(normalizePacket) : null;
  const publishedPacketIds = Array.isArray(input.publishedPacketIds)
    ? unique(input.publishedPacketIds.map(text).filter(Boolean)).sort()
    : null;
  const activeIntegration = normalizeActiveIntegration(input.activeIntegration);
  const apiBudget = validateApiBudget(input.githubApiBudget);
  const blockers = [];

  if (!SAFE_REPOSITORY.test(repository)) blockers.push('repository-invalid');
  if (!SHA.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!Number.isFinite(nowMs)) blockers.push('now-invalid');
  if (!Number.isSafeInteger(settleWindowSeconds) || settleWindowSeconds < 0 || settleWindowSeconds > 3600) {
    blockers.push('settle-window-invalid');
  }
  if (!Array.isArray(lanes)) blockers.push('lanes-invalid');
  else if (lanes.length > MAX_LANES) blockers.push('lanes-exceed-bound');
  if (!Array.isArray(packets)) blockers.push('packets-invalid');
  else if (packets.length > MAX_PACKETS) blockers.push('packets-exceed-bound');
  if (!Array.isArray(publishedPacketIds)) blockers.push('published-packet-ids-invalid');
  else if (publishedPacketIds.length > MAX_PUBLISHED_PACKET_IDS) blockers.push('published-packet-ids-exceed-bound');
  else if (publishedPacketIds.some((id) => !SAFE_ID.test(id))) blockers.push('published-packet-id-invalid');
  if (activeIntegration && (!SAFE_ID.test(activeIntegration.packetId) || !SHA.test(activeIntegration.head))) {
    blockers.push('active-integration-invalid');
  }
  if (!apiBudget.valid) blockers.push(...apiBudget.blockers);

  const lanesById = new Map();
  if (Array.isArray(lanes)) {
    for (const lane of lanes) {
      const laneBlockers = validateLane(lane, canonicalMainHead);
      if (laneBlockers.length) blockers.push(...laneBlockers.map((item) => `${item}:${lane.laneId || 'unknown'}`));
      if (lanesById.has(lane.laneId)) blockers.push(`lane-id-duplicate:${lane.laneId}`);
      else lanesById.set(lane.laneId, lane);
    }
  }

  const packetIds = new Set();
  const packetHeadKeys = new Set();
  const normalizedPackets = [];
  if (Array.isArray(packets) && Number.isFinite(nowMs)) {
    for (const packet of packets) {
      const validation = validatePacket(packet, lanesById, canonicalMainHead, nowMs);
      if (validation.blockers.length) {
        blockers.push(...validation.blockers.map((item) => `${item}:${packet.packetId || 'unknown'}`));
      }
      if (packetIds.has(packet.packetId)) blockers.push(`packet-id-duplicate:${packet.packetId}`);
      packetIds.add(packet.packetId);
      const headKey = `${packet.repository}:${packet.head}:${packet.tree}`;
      if (packetHeadKeys.has(headKey)) blockers.push(`packet-head-duplicate:${packet.packetId}`);
      packetHeadKeys.add(headKey);
      normalizedPackets.push(Object.freeze({ ...packet, settledAtMs: validation.settledAtMs }));
    }
  }

  const authority = authorityProjection();
  const surfaces = Object.freeze({
    github: Object.freeze(lanes?.filter((lane) => lane.surface === 'github').map((lane) => lane.laneId) ?? []),
    forge: Object.freeze(lanes?.filter((lane) => lane.surface === 'forge').map((lane) => lane.laneId) ?? []),
  });

  if (blockers.length) {
    return Object.freeze({
      schemaVersion: DUAL_FORGE_SCHEMA,
      valid: false,
      repository,
      canonicalMainHead,
      decision: DUAL_FORGE_DECISIONS.BLOCKED,
      blockers: Object.freeze(unique(blockers)),
      surfaces,
      apiBudget,
      selectedPacket: null,
      waitingPackets: Object.freeze([]),
      authority,
    });
  }

  const published = new Set(publishedPacketIds);
  const waitingPackets = [];
  const eligiblePackets = [];
  const settleWindowMs = settleWindowSeconds * 1000;

  for (const packet of normalizedPackets) {
    if (packet.state !== 'ready') {
      waitingPackets.push(Object.freeze({ packetId: packet.packetId, reason: `packet-state-${packet.state}` }));
      continue;
    }
    if (published.has(packet.packetId)) {
      waitingPackets.push(Object.freeze({ packetId: packet.packetId, reason: 'packet-already-published' }));
      continue;
    }
    const unmetDependencies = packet.dependsOnPacketIds.filter((id) => !published.has(id));
    if (unmetDependencies.length) {
      waitingPackets.push(Object.freeze({
        packetId: packet.packetId,
        reason: 'packet-dependencies-unpublished',
        dependencies: Object.freeze(unmetDependencies),
      }));
      continue;
    }
    if (nowMs - packet.settledAtMs < settleWindowMs) {
      waitingPackets.push(Object.freeze({ packetId: packet.packetId, reason: 'packet-settle-window-active' }));
      continue;
    }
    eligiblePackets.push(packet);
  }

  eligiblePackets.sort((left, right) => (
    right.priority - left.priority
    || left.settledAtMs - right.settledAtMs
    || left.packetId.localeCompare(right.packetId)
  ));

  const conflictingPacketIds = new Set();
  for (let leftIndex = 0; leftIndex < eligiblePackets.length; leftIndex += 1) {
    const left = eligiblePackets[leftIndex];
    const leftPaths = new Set(left.changedFiles);
    for (let rightIndex = leftIndex + 1; rightIndex < eligiblePackets.length; rightIndex += 1) {
      const right = eligiblePackets[rightIndex];
      if (right.changedFiles.some((path) => leftPaths.has(path))) conflictingPacketIds.add(right.packetId);
    }
  }

  const selectedPacket = eligiblePackets.find((packet) => !conflictingPacketIds.has(packet.packetId)) ?? null;
  for (const packetId of conflictingPacketIds) {
    waitingPackets.push(Object.freeze({ packetId, reason: 'packet-path-conflict-with-higher-ranked-packet' }));
  }

  if (activeIntegration) {
    return Object.freeze({
      schemaVersion: DUAL_FORGE_SCHEMA,
      valid: true,
      repository,
      canonicalMainHead,
      decision: DUAL_FORGE_DECISIONS.INTEGRATION_BUSY,
      blockers: Object.freeze([]),
      surfaces,
      apiBudget,
      selectedPacket: null,
      waitingPackets: Object.freeze(waitingPackets),
      activeIntegration,
      authority,
    });
  }

  if (selectedPacket && apiBudget.safelyAvailable < apiBudget.estimatedPublicationCost) {
    return Object.freeze({
      schemaVersion: DUAL_FORGE_SCHEMA,
      valid: true,
      repository,
      canonicalMainHead,
      decision: DUAL_FORGE_DECISIONS.API_BUDGET_HELD,
      blockers: Object.freeze([]),
      surfaces,
      apiBudget,
      selectedPacket: null,
      waitingPackets: Object.freeze([
        ...waitingPackets,
        Object.freeze({ packetId: selectedPacket.packetId, reason: 'github-api-reserve-protected' }),
      ]),
      nextEligibleAtUtc: apiBudget.resetAtUtc,
      authority,
    });
  }

  if (selectedPacket) {
    return Object.freeze({
      schemaVersion: DUAL_FORGE_SCHEMA,
      valid: true,
      repository,
      canonicalMainHead,
      decision: DUAL_FORGE_DECISIONS.READY,
      blockers: Object.freeze([]),
      surfaces,
      apiBudget,
      selectedPacket: Object.freeze({
        packetId: selectedPacket.packetId,
        laneId: selectedPacket.laneId,
        repository: selectedPacket.repository,
        baseHead: selectedPacket.baseHead,
        head: selectedPacket.head,
        tree: selectedPacket.tree,
        changedFiles: Object.freeze([...selectedPacket.changedFiles]),
        proofRefs: Object.freeze([...selectedPacket.proofRefs]),
        priority: selectedPacket.priority,
      }),
      waitingPackets: Object.freeze(waitingPackets),
      authority,
    });
  }

  const hasReadyButSettling = waitingPackets.some((packet) => packet.reason === 'packet-settle-window-active');
  const hasBuildingLanes = lanes.some((lane) => lane.state === 'building');
  return Object.freeze({
    schemaVersion: DUAL_FORGE_SCHEMA,
    valid: true,
    repository,
    canonicalMainHead,
    decision: hasReadyButSettling
      ? DUAL_FORGE_DECISIONS.SETTLING
      : DUAL_FORGE_DECISIONS.BUILDING,
    blockers: Object.freeze([]),
    surfaces,
    apiBudget,
    selectedPacket: null,
    waitingPackets: Object.freeze(waitingPackets),
    building: hasBuildingLanes,
    authority,
  });
}
