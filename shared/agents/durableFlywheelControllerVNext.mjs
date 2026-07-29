const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIVE_LANE_STATES = new Set(['ACTIVE', 'IMPLEMENTING', 'CI_REVIEW', 'PROOF_RUNNING']);
const ACTIVE_MACHINERY_STATES = new Set(['ACTIVE', 'RUNNING', 'DISPATCHED', 'WAITING_PROOF']);
const DEFAULT_HEARTBEAT_MAX_AGE_MS = 20 * 60 * 1000;
const DEFAULT_RECEIPT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value) {
  const candidate = text(value);
  if (!candidate || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(candidate)) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function sha(value) {
  const candidate = text(value);
  return candidate && SHA_RE.test(candidate) ? candidate.toLowerCase() : null;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedState(value) {
  return text(value)?.toUpperCase() ?? 'UNKNOWN';
}

function ageMs(at, nowMs) {
  const atMs = timestamp(at);
  return atMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - atMs);
}

function activeLane(lane) {
  return lane && typeof lane === 'object' && ACTIVE_LANE_STATES.has(normalizedState(lane.state));
}

function activeMachine(machine) {
  return machine && typeof machine === 'object' && ACTIVE_MACHINERY_STATES.has(normalizedState(machine.state));
}

function identity(item) {
  return text(item?.id) ?? text(item?.name) ?? text(item?.kind) ?? 'unknown';
}

function duplicateActiveMachinery(machinery) {
  const groups = new Map();
  for (const machine of array(machinery).filter(activeMachine)) {
    const kind = text(machine.kind)?.toLowerCase() ?? 'unknown';
    const entries = groups.get(kind) ?? [];
    entries.push(identity(machine));
    groups.set(kind, entries);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([kind, entries]) => ({ kind, entries }));
}

function validLease(lease, nowMs) {
  if (!lease || typeof lease !== 'object') return false;
  const owner = text(lease.owner);
  const laneId = text(lease.laneId);
  const expiresAtMs = timestamp(lease.expiresAt);
  return Boolean(owner && laneId && expiresAtMs !== null && expiresAtMs > nowMs);
}

function evidenceReceipt(receipt, expectedKind, nowMs, maxAgeMs) {
  if (!receipt || typeof receipt !== 'object') return { valid:false, reason:`missing-${expectedKind}-receipt` };
  if (normalizedState(receipt.state) !== 'COMPLETE') return { valid:false, reason:`${expectedKind}-receipt-not-complete` };
  if (text(receipt.kind)?.toLowerCase() !== expectedKind) return { valid:false, reason:`${expectedKind}-receipt-kind-mismatch` };
  if (ageMs(receipt.at, nowMs) > maxAgeMs) return { valid:false, reason:`${expectedKind}-receipt-stale` };
  return { valid:true, reason:null };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

export function reconcileDurableFlywheelController(snapshot = {}, options = {}) {
  const nowMs = timestamp(options.now ?? snapshot.observedAt) ?? Date.now();
  const heartbeatMaxAgeMs = Number.isFinite(options.heartbeatMaxAgeMs) ? options.heartbeatMaxAgeMs : DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const receiptMaxAgeMs = Number.isFinite(options.receiptMaxAgeMs) ? options.receiptMaxAgeMs : DEFAULT_RECEIPT_MAX_AGE_MS;
  const blockers = [];
  const caveats = [];

  const mainHead = sha(snapshot.github?.mainHead);
  if (!mainHead) blockers.push('github-main-head-unproven');

  const lanes = array(snapshot.github?.implementationLanes).filter(activeLane);
  if (lanes.length > 1) blockers.push('split-brain-multiple-active-implementation-lanes');

  const lease = snapshot.sharedWorkspace?.sourceMutationLease;
  const leaseValid = validLease(lease, nowMs);
  if (lanes.length === 1 && !leaseValid) blockers.push('active-lane-without-valid-source-mutation-lease');
  if (lanes.length === 0 && leaseValid) caveats.push('valid-lease-without-active-lane');
  if (lanes.length === 1 && leaseValid && text(lease.laneId) !== text(lanes[0].id)) blockers.push('lease-lane-binding-mismatch');

  const heartbeatAgeMs = ageMs(snapshot.sharedWorkspace?.controllerHeartbeat?.at, nowMs);
  if (heartbeatAgeMs > heartbeatMaxAgeMs) blockers.push('controller-heartbeat-stale-or-missing');

  const duplicates = duplicateActiveMachinery(snapshot.sharedWorkspace?.machineryInventory);
  if (duplicates.length) blockers.push('duplicate-active-machinery');

  const schedulerReceipt = evidenceReceipt(snapshot.receipts?.scheduler, 'scheduler', nowMs, receiptMaxAgeMs);
  if (!schedulerReceipt.valid) blockers.push(schedulerReceipt.reason);

  if (lanes.length === 1) {
    const executionReceipt = evidenceReceipt(snapshot.receipts?.execution, 'execution', nowMs, receiptMaxAgeMs);
    if (!executionReceipt.valid) blockers.push(executionReceipt.reason);
    const receiptLaneId = text(snapshot.receipts?.execution?.laneId);
    if (executionReceipt.valid && receiptLaneId !== text(lanes[0].id)) blockers.push('execution-receipt-lane-binding-mismatch');
  }

  const runtimeProof = snapshot.battleBridge?.proof;
  if (lanes.some((lane) => normalizedState(lane.state) === 'PROOF_RUNNING')) {
    if (!runtimeProof || normalizedState(runtimeProof.state) !== 'OBSERVED') blockers.push('battle-bridge-proof-missing');
    if (runtimeProof && ageMs(runtimeProof.at, nowMs) > receiptMaxAgeMs) blockers.push('battle-bridge-proof-stale');
    if (runtimeProof && mainHead && sha(runtimeProof.sourceHead) !== mainHead) blockers.push('battle-bridge-proof-source-head-mismatch');
  }

  const status = blockers.length ? 'HOLD' : 'HEALTHY';
  const nextAction = blockers.length
    ? 'publish-reconciliation-receipt-and-stop-without-mutation'
    : lanes.length === 1
      ? 'advance-one-bounded-step-under-existing-lease'
      : 'scheduler-may-select-one-runnable-goal';

  return freeze({
    schema:'Stephanos Durable Flywheel Controller VNext',
    status,
    authoritativeSources:['github', 'shared-workspace', 'battle-bridge-proofs', 'execution-receipts'],
    chatMemoryAuthoritative:false,
    mainHead,
    activeLaneCount:lanes.length,
    activeLane:lanes.length === 1 ? { id:text(lanes[0].id), state:normalizedState(lanes[0].state), headSha:sha(lanes[0].headSha) } : null,
    lease:{ valid:leaseValid, owner:text(lease?.owner), laneId:text(lease?.laneId), expiresAt:text(lease?.expiresAt) },
    heartbeat:{ ageMs:heartbeatAgeMs, fresh:heartbeatAgeMs <= heartbeatMaxAgeMs },
    duplicateMachinery:duplicates,
    blockers,
    caveats,
    mergeAuthority:false,
    leaseSeizureAllowed:false,
    nextAction,
  });
}

export function renderDurableFlywheelReceipt(result) {
  if (!result || typeof result !== 'object') throw new TypeError('result is required');
  return [
    'Durable Flywheel Reconciliation Receipt VNext',
    `Status: ${result.status}`,
    `Main-Head: ${result.mainHead ?? 'unproven'}`,
    `Active-Lanes: ${result.activeLaneCount}`,
    `Lease-Valid: ${result.lease?.valid === true}`,
    `Heartbeat-Fresh: ${result.heartbeat?.fresh === true}`,
    `Merge-Authority: false`,
    `Lease-Seizure-Allowed: false`,
    `Next-Action: ${result.nextAction}`,
    `Blockers: ${result.blockers?.length ? result.blockers.join(', ') : 'none'}`,
    `Caveats: ${result.caveats?.length ? result.caveats.join(', ') : 'none'}`,
  ].join('\n');
}
