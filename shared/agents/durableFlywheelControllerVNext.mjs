import { buildMissionScheduler } from '../runtime/missionScheduler.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const ACTIVE_LANE_STATES = new Set(['ACTIVE', 'IMPLEMENTING', 'CI_REVIEW', 'PROOF_RUNNING']);
const ACTIVE_MACHINERY_STATES = new Set(['ACTIVE', 'RUNNING', 'DISPATCHED', 'WAITING_PROOF']);
const DEFAULT_HEARTBEAT_MAX_AGE_MS = 20 * 60 * 1000;
const DEFAULT_RECEIPT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_FUTURE_SKEW_MS = 60 * 1000;

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

function hasOwn(object, key) {
  return Boolean(object && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key));
}

function normalizedState(value) {
  return text(value)?.toUpperCase() ?? 'UNKNOWN';
}

function evidenceAge(at, nowMs, futureSkewMs) {
  const atMs = timestamp(at);
  if (atMs === null || nowMs === null) return { ageMs:Number.POSITIVE_INFINITY, future:false, valid:false };
  if (atMs - nowMs > futureSkewMs) return { ageMs:Number.POSITIVE_INFINITY, future:true, valid:false };
  return { ageMs:Math.max(0, nowMs - atMs), future:false, valid:true };
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
  if (!lease || typeof lease !== 'object' || nowMs === null) return false;
  const owner = text(lease.owner);
  const laneId = text(lease.laneId);
  const expiresAtMs = timestamp(lease.expiresAt);
  return Boolean(owner && laneId && expiresAtMs !== null && expiresAtMs > nowMs);
}

function evidenceReceipt(receipt, expectedKind, nowMs, maxAgeMs, futureSkewMs) {
  if (!receipt || typeof receipt !== 'object') return { valid:false, reason:`missing-${expectedKind}-receipt` };
  if (normalizedState(receipt.state) !== 'COMPLETE') return { valid:false, reason:`${expectedKind}-receipt-not-complete` };
  if (text(receipt.kind)?.toLowerCase() !== expectedKind) return { valid:false, reason:`${expectedKind}-receipt-kind-mismatch` };
  const age = evidenceAge(receipt.at, nowMs, futureSkewMs);
  if (age.future) return { valid:false, reason:`${expectedKind}-receipt-future-dated` };
  if (!age.valid || age.ageMs > maxAgeMs) return { valid:false, reason:`${expectedKind}-receipt-stale` };
  return { valid:true, reason:null };
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const key of Object.keys(value)) value[key] = freeze(value[key]);
  return Object.freeze(value);
}

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function schedulerInputFromSnapshot(snapshot, now) {
  const supplied = snapshot.schedulerInput && typeof snapshot.schedulerInput === 'object'
    ? snapshot.schedulerInput
    : {};
  return {
    ...supplied,
    now: supplied.now ?? now ?? snapshot.observedAt,
    goals: supplied.goals ?? array(snapshot.github?.goals),
    proofHeadShas: supplied.proofHeadShas ?? array(snapshot.receipts?.proofHeadShas),
    proofReceipts: supplied.proofReceipts ?? array(snapshot.receipts?.proofReceipts),
    proofRefs: supplied.proofRefs ?? array(snapshot.receipts?.proofRefs),
    correlationId: supplied.correlationId ?? text(snapshot.correlationId) ?? undefined,
  };
}

function cycleReceipt({ reconciliation, scheduler = null, execution = null }) {
  return freeze({
    schema:'Stephanos Durable Flywheel Startup Cycle VNext',
    status:reconciliation.status === 'HOLD'
      ? 'HOLD'
      : execution?.status ?? (scheduler ? 'SCHEDULER_DECIDED' : 'RECONCILED'),
    chatMemoryAuthoritative:false,
    reconciliation,
    schedulerDecision:scheduler?.decisionReceipt ?? null,
    execution:execution ?? null,
  });
}

export function reconcileDurableFlywheelController(snapshot = {}, options = {}) {
  const suppliedNow = options.now ?? snapshot.observedAt;
  const nowMs = timestamp(suppliedNow);
  const heartbeatMaxAgeMs = Number.isFinite(options.heartbeatMaxAgeMs) ? options.heartbeatMaxAgeMs : DEFAULT_HEARTBEAT_MAX_AGE_MS;
  const receiptMaxAgeMs = Number.isFinite(options.receiptMaxAgeMs) ? options.receiptMaxAgeMs : DEFAULT_RECEIPT_MAX_AGE_MS;
  const futureSkewMs = Number.isFinite(options.futureSkewMs) && options.futureSkewMs >= 0 ? options.futureSkewMs : DEFAULT_FUTURE_SKEW_MS;
  const blockers = [];
  const caveats = [];

  if (nowMs === null) blockers.push('reconciliation-time-unproven');

  const mainHead = sha(snapshot.github?.mainHead);
  if (!mainHead) blockers.push('github-main-head-unproven');

  const implementationLanesPresent = hasOwn(snapshot.github, 'implementationLanes');
  const implementationLanesValid = implementationLanesPresent && Array.isArray(snapshot.github.implementationLanes);
  if (!implementationLanesValid) blockers.push('github-implementation-lanes-unproven');
  const lanes = implementationLanesValid ? snapshot.github.implementationLanes.filter(activeLane) : [];
  if (lanes.length > 1) blockers.push('split-brain-multiple-active-implementation-lanes');
  if (lanes.length === 1 && !sha(lanes[0].headSha)) blockers.push('active-lane-head-unproven');

  const lease = snapshot.sharedWorkspace?.sourceMutationLease;
  const leaseValid = validLease(lease, nowMs);
  if (lanes.length === 1 && !leaseValid) blockers.push('active-lane-without-valid-source-mutation-lease');
  if (lanes.length === 0 && leaseValid) blockers.push('valid-lease-without-active-lane');
  if (lanes.length === 1 && leaseValid && text(lease.laneId) !== text(lanes[0].id)) blockers.push('lease-lane-binding-mismatch');

  const heartbeat = evidenceAge(snapshot.sharedWorkspace?.controllerHeartbeat?.at, nowMs, futureSkewMs);
  if (heartbeat.future) blockers.push('controller-heartbeat-future-dated');
  else if (!heartbeat.valid || heartbeat.ageMs > heartbeatMaxAgeMs) blockers.push('controller-heartbeat-stale-or-missing');

  const machineryInventoryPresent = hasOwn(snapshot.sharedWorkspace, 'machineryInventory');
  const machineryInventoryValid = machineryInventoryPresent && Array.isArray(snapshot.sharedWorkspace.machineryInventory);
  if (!machineryInventoryValid) blockers.push('shared-workspace-machinery-inventory-unproven');
  const duplicates = machineryInventoryValid ? duplicateActiveMachinery(snapshot.sharedWorkspace.machineryInventory) : [];
  if (duplicates.length) blockers.push('duplicate-active-machinery');

  const schedulerReceipt = evidenceReceipt(snapshot.receipts?.scheduler, 'scheduler', nowMs, receiptMaxAgeMs, futureSkewMs);
  if (!schedulerReceipt.valid) blockers.push(schedulerReceipt.reason);

  if (lanes.length === 1) {
    const executionReceipt = evidenceReceipt(snapshot.receipts?.execution, 'execution', nowMs, receiptMaxAgeMs, futureSkewMs);
    if (!executionReceipt.valid) blockers.push(executionReceipt.reason);
    const receiptLaneId = text(snapshot.receipts?.execution?.laneId);
    if (executionReceipt.valid && receiptLaneId !== text(lanes[0].id)) blockers.push('execution-receipt-lane-binding-mismatch');
  }

  const runtimeProof = snapshot.battleBridge?.proof;
  if (lanes.some((lane) => normalizedState(lane.state) === 'PROOF_RUNNING')) {
    if (!runtimeProof || normalizedState(runtimeProof.state) !== 'OBSERVED') blockers.push('battle-bridge-proof-missing');
    if (runtimeProof) {
      const proofAge = evidenceAge(runtimeProof.at, nowMs, futureSkewMs);
      if (proofAge.future) blockers.push('battle-bridge-proof-future-dated');
      else if (!proofAge.valid || proofAge.ageMs > receiptMaxAgeMs) blockers.push('battle-bridge-proof-stale');
    }
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
    observedAt:text(suppliedNow),
    mainHead,
    activeLaneCount:lanes.length,
    activeLane:lanes.length === 1 ? { id:text(lanes[0].id), state:normalizedState(lanes[0].state), headSha:sha(lanes[0].headSha) } : null,
    lease:{ valid:leaseValid, owner:text(lease?.owner), laneId:text(lease?.laneId), expiresAt:text(lease?.expiresAt) },
    heartbeat:{ ageMs:heartbeat.ageMs, fresh:heartbeat.valid && heartbeat.ageMs <= heartbeatMaxAgeMs, futureDated:heartbeat.future },
    duplicateMachinery:duplicates,
    blockers,
    caveats,
    mergeAuthority:false,
    leaseSeizureAllowed:false,
    nextAction,
  });
}

export async function runDurableFlywheelStartupCycle(machinery = {}, options = {}) {
  const loadDurableSnapshot = requireFunction(machinery.loadDurableSnapshot, 'loadDurableSnapshot');
  const publishReceipt = requireFunction(machinery.publishReceipt, 'publishReceipt');
  const snapshot = await loadDurableSnapshot();
  const reconciliation = reconcileDurableFlywheelController(snapshot, options);

  if (reconciliation.status === 'HOLD') {
    const receipt = cycleReceipt({ reconciliation });
    await publishReceipt(receipt);
    return receipt;
  }

  if (reconciliation.activeLaneCount === 1) {
    const advanceActiveLane = requireFunction(machinery.advanceActiveLane, 'advanceActiveLane');
    const execution = await advanceActiveLane({
      snapshot,
      lane:reconciliation.activeLane,
      lease:reconciliation.lease,
      boundedSteps:1,
      mergeAuthority:false,
      leaseSeizureAllowed:false,
    });
    const receipt = cycleReceipt({ reconciliation, execution });
    await publishReceipt(receipt);
    return receipt;
  }

  const scheduler = buildMissionScheduler(schedulerInputFromSnapshot(snapshot, options.now));
  if (scheduler.failClosed || !scheduler.selectedGoal) {
    const receipt = cycleReceipt({ reconciliation, scheduler });
    await publishReceipt(receipt);
    return receipt;
  }

  const dispatchSelectedGoal = requireFunction(machinery.dispatchSelectedGoal, 'dispatchSelectedGoal');
  const execution = await dispatchSelectedGoal({
    snapshot,
    selectedGoal:scheduler.selectedGoal,
    selectedRoute:scheduler.selectedRoute,
    selectedLifecycle:scheduler.selectedLifecycle,
    schedulerReceipt:scheduler.decisionReceipt,
    boundedSteps:1,
    createReplacementMachinery:false,
    mergeAuthority:false,
    leaseSeizureAllowed:false,
  });
  const receipt = cycleReceipt({ reconciliation, scheduler, execution });
  await publishReceipt(receipt);
  return receipt;
}

export function renderDurableFlywheelReceipt(result) {
  if (!result || typeof result !== 'object') throw new TypeError('result is required');
  return [
    'Durable Flywheel Reconciliation Receipt VNext',
    `Status: ${result.status}`,
    `Observed-At: ${result.observedAt ?? 'unproven'}`,
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
