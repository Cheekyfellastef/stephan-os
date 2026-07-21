const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION = 'stephanos.codex-capacity-governor.v1';

export const CODEX_AVAILABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE',
  METER_STALLED: 'METER_STALLED',
  UNKNOWN: 'UNKNOWN',
});

export const CODEX_TASK_CLASS = Object.freeze({
  STATUS: 'STATUS',
  ARCHITECTURE: 'ARCHITECTURE',
  TRIVIAL_FIX: 'TRIVIAL_FIX',
  FOCUSED_REPAIR: 'FOCUSED_REPAIR',
  MULTI_MODULE_IMPLEMENTATION: 'MULTI_MODULE_IMPLEMENTATION',
  EXACT_HEAD_REVIEW: 'EXACT_HEAD_REVIEW',
  WINDOWS_RUNTIME_PROOF: 'WINDOWS_RUNTIME_PROOF',
});

export const CODEX_ROUTE = Object.freeze({
  CODEX: 'CODEX',
  CHATGPT_GITHUB: 'CHATGPT_GITHUB',
  OPENCLAW: 'OPENCLAW',
  LOCAL_AI: 'LOCAL_AI',
  BATTLE_BRIDGE: 'BATTLE_BRIDGE',
  SPLIT_TASK: 'SPLIT_TASK',
  DEFER_UNTIL_RESET: 'DEFER_UNTIL_RESET',
  BLOCKED: 'BLOCKED',
});

export const CODEX_CAPACITY_DECISION = Object.freeze({
  CODEX_DISPATCH_ALLOWED: 'CODEX_DISPATCH_ALLOWED',
  CODEX_ROUTE_ZERO_COST: 'CODEX_ROUTE_ZERO_COST',
  CODEX_ROUTE_SPLIT_TASK: 'CODEX_ROUTE_SPLIT_TASK',
  CODEX_BLOCKED_BY_METER: 'CODEX_BLOCKED_BY_METER',
  CODEX_DEFER_UNTIL_NATURAL_RESET: 'CODEX_DEFER_UNTIL_NATURAL_RESET',
  CODEX_BANKED_RESET_REDEEM_NOW: 'CODEX_BANKED_RESET_REDEEM_NOW',
  CODEX_BANKED_RESET_HOLD: 'CODEX_BANKED_RESET_HOLD',
  CODEX_BANKED_RESET_EXPIRED: 'CODEX_BANKED_RESET_EXPIRED',
  CODEX_CAPACITY_UNKNOWN: 'CODEX_CAPACITY_UNKNOWN',
});

export const DEFAULT_TASK_COST_PERCENT = Object.freeze({
  [CODEX_TASK_CLASS.STATUS]: 0,
  [CODEX_TASK_CLASS.ARCHITECTURE]: 0,
  [CODEX_TASK_CLASS.TRIVIAL_FIX]: 4,
  [CODEX_TASK_CLASS.FOCUSED_REPAIR]: 10,
  [CODEX_TASK_CLASS.MULTI_MODULE_IMPLEMENTATION]: 24,
  [CODEX_TASK_CLASS.EXACT_HEAD_REVIEW]: 8,
  [CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF]: 15,
});

export const DEFAULT_CAPACITY_RESERVES = Object.freeze({
  emergencyRepairPercent: 10,
  exactHeadReviewPercent: 8,
  windowsRuntimePercent: 7,
});

export const DEFAULT_METER_MAX_AGE_MINUTES = 15;
export const DEFAULT_MIN_TASK_COST_SAMPLES = 3;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, number(value, min)));
}

function timestamp(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function sortedBankedResets(resets = []) {
  return (Array.isArray(resets) ? resets : [])
    .map((reset, index) => Object.freeze({
      resetId: text(reset?.resetId || reset?.id, `banked-reset-${index + 1}`),
      expiresAtUtc: text(reset?.expiresAtUtc || reset?.expiresAt),
      grantedAtUtc: text(reset?.grantedAtUtc || reset?.grantedAt),
      source: text(reset?.source, 'codex-usage-ui'),
    }))
    .filter((reset) => Number.isFinite(timestamp(reset.expiresAtUtc)))
    .sort((a, b) => timestamp(a.expiresAtUtc) - timestamp(b.expiresAtUtc));
}

function normalizedTaskClass(value) {
  const candidate = text(value, CODEX_TASK_CLASS.FOCUSED_REPAIR).toUpperCase();
  return Object.values(CODEX_TASK_CLASS).includes(candidate) ? candidate : CODEX_TASK_CLASS.FOCUSED_REPAIR;
}

function routeForTask(task = {}) {
  if (task.preferredRoute && Object.values(CODEX_ROUTE).includes(task.preferredRoute)) return task.preferredRoute;
  const taskClass = normalizedTaskClass(task.taskClass || task.type);
  if (taskClass === CODEX_TASK_CLASS.STATUS) return CODEX_ROUTE.BATTLE_BRIDGE;
  if (taskClass === CODEX_TASK_CLASS.ARCHITECTURE) return CODEX_ROUTE.CHATGPT_GITHUB;
  if (taskClass === CODEX_TASK_CLASS.TRIVIAL_FIX && task.zeroCostCapable !== false) return CODEX_ROUTE.CHATGPT_GITHUB;
  if (taskClass === CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF && task.battleBridgeCapable === true) return CODEX_ROUTE.BATTLE_BRIDGE;
  return CODEX_ROUTE.CODEX;
}

function explicitFiniteNumber(value) {
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
}

export function createMeterObservation(input = {}) {
  const remainingPercentObserved = explicitFiniteNumber(input.remainingPercent);
  const availabilityObserved = Object.values(CODEX_AVAILABILITY).includes(input.availability);
  const remainingPercent = remainingPercentObserved ? clamp(input.remainingPercent, 0, 100) : null;
  const availability = availabilityObserved ? input.availability : CODEX_AVAILABILITY.UNKNOWN;
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.meter_observation',
    observedAtUtc: text(input.observedAtUtc || input.timestampUtc, 'pending'),
    remainingPercent,
    remainingPercentObserved,
    availability,
    availabilityObserved,
    complete: remainingPercentObserved && availabilityObserved,
    naturalResetAtUtc: text(input.naturalResetAtUtc || input.resetAtUtc),
    bankedResets: sortedBankedResets(input.bankedResets),
    source: text(input.source, 'operator-or-browser-observation'),
    confidence: ['high', 'medium', 'low'].includes(input.confidence) ? input.confidence : 'low',
    rawCredentialsCaptured: false,
    arbitraryBrowserAccessAllowed: false,
    finalVerdict: 'CODEX_METER_OBSERVATION_RECORDED',
  });
}

export function createTaskConsumptionReceipt(input = {}) {
  const before = clamp(input.meterBeforePercent, 0, 100);
  const after = clamp(input.meterAfterPercent, 0, 100);
  const observedConsumptionPercent = clamp(
    input.observedConsumptionPercent === undefined ? before - after : input.observedConsumptionPercent,
    0,
    100,
  );
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.task_consumption_receipt',
    receiptId: text(input.receiptId, `codex-capacity-${text(input.taskId, 'task')}`),
    taskId: text(input.taskId, 'unknown-task'),
    taskClass: normalizedTaskClass(input.taskClass),
    model: text(input.model, 'unknown'),
    executionSurface: text(input.executionSurface, 'unknown'),
    filesInspected: Math.max(0, Math.floor(number(input.filesInspected, 0))),
    filesChanged: Math.max(0, Math.floor(number(input.filesChanged, 0))),
    durationMinutes: Math.max(0, number(input.durationMinutes, 0)),
    repairIterations: Math.max(0, Math.floor(number(input.repairIterations, 0))),
    meterBeforePercent: before,
    meterAfterPercent: after,
    observedConsumptionPercent,
    outcome: text(input.outcome, 'unknown'),
    capabilityValue: clamp(input.capabilityValue, 0, 100),
    timestampUtc: text(input.timestampUtc, 'pending'),
    finalVerdict: 'CODEX_TASK_CONSUMPTION_RECORDED',
  });
}

export function buildTaskCostModel(receipts = [], { minSamples = DEFAULT_MIN_TASK_COST_SAMPLES } = {}) {
  const groups = new Map();
  for (const rawReceipt of Array.isArray(receipts) ? receipts : []) {
    const receipt = rawReceipt?.kind === 'stephanos.codex_capacity.task_consumption_receipt'
      ? rawReceipt
      : createTaskConsumptionReceipt(rawReceipt);
    if (!groups.has(receipt.taskClass)) groups.set(receipt.taskClass, []);
    groups.get(receipt.taskClass).push(receipt.observedConsumptionPercent);
  }
  const requiredSamples = Math.max(1, Math.floor(number(minSamples, DEFAULT_MIN_TASK_COST_SAMPLES)));
  const taskClasses = {};
  for (const taskClass of Object.values(CODEX_TASK_CLASS)) {
    const samples = groups.get(taskClass) || [];
    const defaultPercent = DEFAULT_TASK_COST_PERCENT[taskClass];
    const enoughSamples = samples.length >= requiredSamples;
    const observedP50 = samples.length ? percentile(samples, 0.5) : defaultPercent;
    const observedP80 = samples.length ? percentile(samples, 0.8) : defaultPercent;
    taskClasses[taskClass] = Object.freeze({
      sampleCount: samples.length,
      minimumSampleCount: requiredSamples,
      p50Percent: enoughSamples ? Math.max(defaultPercent, observedP50) : defaultPercent,
      p80Percent: enoughSamples ? Math.max(defaultPercent, observedP80) : defaultPercent,
      source: enoughSamples
        ? ((observedP50 < defaultPercent || observedP80 < defaultPercent) ? 'observed-with-conservative-floor' : 'observed')
        : (samples.length ? 'conservative-default-insufficient-samples' : 'conservative-default'),
    });
  }
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.task_cost_model',
    taskClasses: Object.freeze(taskClasses),
    totalSamples: [...groups.values()].reduce((sum, samples) => sum + samples.length, 0),
    minimumSampleCount: requiredSamples,
    finalVerdict: 'CODEX_TASK_COST_MODEL_READY',
  });
}

export function estimateTaskCost(task = {}, costModel = buildTaskCostModel()) {
  const taskClass = normalizedTaskClass(task.taskClass || task.type);
  const model = costModel?.taskClasses?.[taskClass] || {};
  const multiplier = clamp(task.complexityMultiplier === undefined ? 1 : task.complexityMultiplier, 0.25, 4);
  const p50Percent = clamp(number(model.p50Percent, DEFAULT_TASK_COST_PERCENT[taskClass]) * multiplier, 0, 100);
  const p80Percent = clamp(number(model.p80Percent, DEFAULT_TASK_COST_PERCENT[taskClass]) * multiplier, 0, 100);
  return Object.freeze({
    taskId: text(task.taskId || task.id, 'unknown-task'),
    title: text(task.title, taskClass),
    taskClass,
    preferredRoute: routeForTask(task),
    p50Percent,
    p80Percent,
    capabilityValue: clamp(task.capabilityValue === undefined ? 50 : task.capabilityValue, 0, 100),
    urgent: task.urgent === true,
    exactHeadReview: taskClass === CODEX_TASK_CLASS.EXACT_HEAD_REVIEW,
  });
}

function reserveValue(reserves, key, fallback) {
  return clamp(number(reserves?.[key], fallback), 0, 80);
}

function reserveTotal(reserves = DEFAULT_CAPACITY_RESERVES) {
  return clamp(
    reserveValue(reserves, 'emergencyRepairPercent', DEFAULT_CAPACITY_RESERVES.emergencyRepairPercent)
      + reserveValue(reserves, 'exactHeadReviewPercent', DEFAULT_CAPACITY_RESERVES.exactHeadReviewPercent)
      + reserveValue(reserves, 'windowsRuntimePercent', DEFAULT_CAPACITY_RESERVES.windowsRuntimePercent),
    0,
    80,
  );
}

function reserveForTask(reserves, task) {
  let reserved = reserveTotal(reserves);
  if (!task) return reserved;
  if (task.urgent && task.taskClass === CODEX_TASK_CLASS.FOCUSED_REPAIR) {
    reserved -= reserveValue(reserves, 'emergencyRepairPercent', DEFAULT_CAPACITY_RESERVES.emergencyRepairPercent);
  }
  if (task.taskClass === CODEX_TASK_CLASS.EXACT_HEAD_REVIEW) {
    reserved -= reserveValue(reserves, 'exactHeadReviewPercent', DEFAULT_CAPACITY_RESERVES.exactHeadReviewPercent);
  }
  if (task.taskClass === CODEX_TASK_CLASS.WINDOWS_RUNTIME_PROOF) {
    reserved -= reserveValue(reserves, 'windowsRuntimePercent', DEFAULT_CAPACITY_RESERVES.windowsRuntimePercent);
  }
  return clamp(reserved, 0, 80);
}

function meterTrust(observation, nowUtc, maxAgeMinutes) {
  const nowMs = timestamp(nowUtc);
  const observedMs = timestamp(observation.observedAtUtc);
  const ageMs = Number.isFinite(nowMs) && Number.isFinite(observedMs) ? nowMs - observedMs : NaN;
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMinutes * MINUTE_MS;
  const confidenceTrusted = observation.confidence === 'high' || observation.confidence === 'medium';
  const remainingPercentObserved = observation.remainingPercentObserved === true
    || (observation.remainingPercentObserved === undefined && explicitFiniteNumber(observation.remainingPercent));
  const availabilityObserved = observation.availabilityObserved === true
    || (observation.availabilityObserved === undefined && Object.values(CODEX_AVAILABILITY).includes(observation.availability));
  const complete = remainingPercentObserved
    && availabilityObserved
    && Number.isFinite(Number(observation.remainingPercent));
  return Object.freeze({
    fresh,
    confidenceTrusted,
    remainingPercentObserved,
    availabilityObserved,
    complete,
    ageMinutes: Number.isFinite(ageMs) ? ageMs / MINUTE_MS : null,
    trusted: fresh && confidenceTrusted && complete,
  });
}

function completedResetIdsFrom(input = {}) {
  const ids = new Set(
    (Array.isArray(input.completedResetIds) ? input.completedResetIds : [])
      .map((value) => text(value))
      .filter(Boolean),
  );
  for (const receipt of Array.isArray(input.resetCompletionReceipts) ? input.resetCompletionReceipts : []) {
    const finalVerdict = text(
      receipt?.finalVerdict
      || receipt?.result?.finalVerdict
      || receipt?.result?.result?.finalVerdict,
    );
    const resetId = text(receipt?.resetId || receipt?.result?.resetId || receipt?.result?.result?.resetId);
    const confirmed = finalVerdict === 'CODEX_BANKED_RESET_CONFIRMED'
      && (receipt?.ok === true || receipt?.state === 'DONE' || receipt?.result?.ok === true);
    if (confirmed && resetId) ids.add(resetId);
  }
  return ids;
}

export function createResetRedemptionAction(input = {}) {
  const reset = input.reset || {};
  const resetExpiresAtUtc = text(reset.expiresAtUtc);
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.banked_reset_action',
    operation: 'REDEEM_BANKED_CODEX_RATE_LIMIT_RESET',
    resetId: text(reset.resetId),
    expiresAtUtc: resetExpiresAtUtc,
    resetExpiresAtUtc,
    executeAtOrAfterUtc: text(input.executeAtOrAfterUtc || input.nowUtc, 'pending'),
    latestSafeExecutionUtc: text(input.latestSafeExecutionUtc || reset.expiresAtUtc),
    executionSurface: 'BATTLE_BRIDGE_AUTHENTICATED_CODEX_UI',
    fixedUiActionOnly: true,
    singlePressOnly: true,
    genericBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    standingOperatorPolicyRef: text(input.standingOperatorPolicyRef, 'operator-policy/codex-banked-reset-v1'),
    distinctPolicyAuthorizationRequired: true,
    proofRequired: ['meter-before', 'selected-reset-expiry', 'button-pressed', 'meter-after'],
    finalVerdict: 'CODEX_BANKED_RESET_ACTION_READY',
  });
}

export function planBankedReset(input = {}) {
  const observation = input.observation?.kind === 'stephanos.codex_capacity.meter_observation'
    ? input.observation
    : createMeterObservation(input.observation || input);
  const nowUtc = text(input.nowUtc);
  const nowMs = timestamp(nowUtc);
  const maxMeterAgeMinutes = clamp(
    input.maxMeterAgeMinutes === undefined ? DEFAULT_METER_MAX_AGE_MINUTES : input.maxMeterAgeMinutes,
    1,
    120,
  );
  const resetMeterTruth = meterTrust(observation, nowUtc, maxMeterAgeMinutes);
  const resetMeterTrusted = resetMeterTruth.trusted && observation.confidence === 'high';
  if (!Number.isFinite(nowMs)) {
    return Object.freeze({
      decision: CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD,
      selectedReset: null,
      action: null,
      reason: 'A valid current time is required before banked-reset planning.',
      meterTruth: resetMeterTruth,
      finalVerdict: 'CODEX_BANKED_RESET_PLAN_READY',
    });
  }
  const completedResetIds = completedResetIdsFrom(input);
  const naturalResetMs = timestamp(observation.naturalResetAtUtc);
  const unexpired = observation.bankedResets.filter((reset) => timestamp(reset.expiresAtUtc) > nowMs);
  const completedAvailable = unexpired.filter((reset) => completedResetIds.has(reset.resetId));
  const resets = unexpired.filter((reset) => !completedResetIds.has(reset.resetId));
  const expired = observation.bankedResets.filter((reset) => timestamp(reset.expiresAtUtc) <= nowMs);
  const nextReset = resets[0] || null;
  const remainingPercent = resetMeterTruth.complete ? Number(observation.remainingPercent) : null;
  const queueDemandPercent = Math.max(0, number(input.queueDemandPercent, 0));
  const threshold = clamp(input.redeemThresholdPercent === undefined ? 5 : input.redeemThresholdPercent, 0, 25);
  const expiryGuardHours = clamp(input.expiryGuardHours === undefined ? 24 : input.expiryGuardHours, 1, 168);
  const naturalResetGuardHours = clamp(input.naturalResetGuardHours === undefined ? 2 : input.naturalResetGuardHours, 0, 24);
  const hoursToNaturalReset = Number.isFinite(naturalResetMs) ? (naturalResetMs - nowMs) / HOUR_MS : null;
  const hoursToExpiry = nextReset ? (timestamp(nextReset.expiresAtUtc) - nowMs) / HOUR_MS : null;
  const meterBlocked = resetMeterTruth.complete && (
    observation.availability === CODEX_AVAILABILITY.METER_STALLED
    || (observation.availability === CODEX_AVAILABILITY.AVAILABLE && remainingPercent <= threshold)
  );
  const meaningfulDemand = resetMeterTruth.complete && queueDemandPercent > remainingPercent;
  const naturalResetSoon = hoursToNaturalReset !== null && hoursToNaturalReset >= 0 && hoursToNaturalReset <= naturalResetGuardHours;
  const expiryPressure = hoursToExpiry !== null && hoursToExpiry <= expiryGuardHours;
  const expiryBeforeNaturalReset = hoursToExpiry !== null && (hoursToNaturalReset === null || hoursToExpiry < hoursToNaturalReset);
  const canUsePolicy = input.standingOperatorPolicyActive === true;
  const latestSafeExecutionMs = nextReset ? timestamp(nextReset.expiresAtUtc) - HOUR_MS : NaN;
  const safetyWindowOpen = Number.isFinite(latestSafeExecutionMs) && latestSafeExecutionMs > nowMs;
  const shouldRedeem = Boolean(nextReset)
    && resetMeterTrusted
    && canUsePolicy
    && input.activeCodexTask !== true
    && meaningfulDemand
    && !naturalResetSoon
    && safetyWindowOpen
    && (meterBlocked || (expiryPressure && expiryBeforeNaturalReset && remainingPercent <= Math.max(threshold, 10)));

  if (!nextReset) {
    const completionBlocked = completedAvailable.length > 0;
    return Object.freeze({
      decision: expired.length && !completionBlocked
        ? CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_EXPIRED
        : CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD,
      selectedReset: null,
      action: null,
      reason: completionBlocked
        ? 'A completion receipt already exists for every unexpired banked reset currently visible; do not redeem one again.'
        : (expired.length ? 'No unexpired banked Codex reset remains.' : 'No banked Codex reset is available.'),
      completedResetIds: [...completedResetIds],
      expiredResetIds: expired.map((reset) => reset.resetId),
      meterTruth: resetMeterTruth,
      finalVerdict: 'CODEX_BANKED_RESET_PLAN_READY',
    });
  }

  if (shouldRedeem) {
    return Object.freeze({
      decision: CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW,
      selectedReset: nextReset,
      action: createResetRedemptionAction({
        reset: nextReset,
        nowUtc,
        latestSafeExecutionUtc: new Date(latestSafeExecutionMs).toISOString(),
        standingOperatorPolicyRef: input.standingOperatorPolicyRef,
      }),
      reason: meterBlocked
        ? 'Codex capacity is blocked or at the conservative redemption threshold and queued high-value demand exceeds remaining capacity.'
        : 'The earliest banked reset is near expiry before the natural reset and queued demand exceeds remaining capacity.',
      completedResetIds: [...completedResetIds],
      meterTruth: resetMeterTruth,
      finalVerdict: 'CODEX_BANKED_RESET_PLAN_READY',
    });
  }

  let reason = 'Hold the earliest-expiring banked reset until Codex is blocked or near empty and useful queued work needs the capacity.';
  if (!resetMeterTruth.complete) {
    reason = 'The Codex meter observation is incomplete; an explicit remaining percentage and availability state are required before banked-reset planning.';
  } else if (!resetMeterTrusted) {
    reason = !resetMeterTruth.fresh
      ? 'The Codex meter observation is missing, future-dated, or stale; refresh it before banked-reset planning.'
      : 'Banked-reset redemption requires a high-confidence meter observation.';
  } else if (!canUsePolicy) reason = 'A standing operator policy must explicitly authorize automatic banked-reset redemption.';
  else if (input.activeCodexTask === true) reason = 'Do not change capacity state while a Codex task is active.';
  else if (!meaningfulDemand) reason = 'Queued Codex demand does not exceed current remaining capacity.';
  else if (naturalResetSoon) reason = 'The natural meter reset is imminent; preserve the banked reset.';
  else if (!safetyWindowOpen) reason = 'The earliest banked reset is inside its one-hour safety boundary; do not prepare a redemption action.';
  else if (!meterBlocked && observation.availability !== CODEX_AVAILABILITY.AVAILABLE) reason = 'Current Codex availability is not safe for reset planning; refresh the usage state.';
  return Object.freeze({
    decision: CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_HOLD,
    selectedReset: nextReset,
    action: null,
    reason,
    completedResetIds: [...completedResetIds],
    hoursToExpiry,
    hoursToNaturalReset,
    meterTruth: resetMeterTruth,
    finalVerdict: 'CODEX_BANKED_RESET_PLAN_READY',
  });
}

export function forecastStackVelocity(input = {}) {
  const completed = Math.max(0, number(input.verifiedCapabilitySlices, 0));
  const elapsedDays = Math.max(1, number(input.elapsedDays, 7));
  const currentSlicesPerWeek = completed * 7 / elapsedDays;
  const codexContributionFraction = clamp(input.codexContributionFraction === undefined ? 0.3 : input.codexContributionFraction, 0, 1);
  const openClawUpliftFraction = clamp(input.openClawUpliftFraction === undefined ? 0 : input.openClawUpliftFraction, 0, 2);
  const withoutCodexSlicesPerWeek = currentSlicesPerWeek * (1 - codexContributionFraction);
  const withOpenClawUpgradeSlicesPerWeek = withoutCodexSlicesPerWeek * (1 + openClawUpliftFraction) + (currentSlicesPerWeek - withoutCodexSlicesPerWeek);
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.stack_velocity.forecast',
    currentSlicesPerWeek,
    withoutCodexSlicesPerWeek,
    withOpenClawUpgradeSlicesPerWeek,
    primaryConstraint: text(input.primaryConstraint, 'unknown'),
    confidence: completed >= 10 ? 'medium' : 'low',
    verifiedSlicesOnly: true,
    finalVerdict: 'STEPHANOS_STACK_VELOCITY_FORECAST_READY',
  });
}

export function buildCodexCapacityProjection(input = {}) {
  const observation = input.observation?.kind === 'stephanos.codex_capacity.meter_observation'
    ? input.observation
    : createMeterObservation(input.observation || {});
  const costModel = input.costModel || buildTaskCostModel(input.receipts || []);
  const taskForecasts = (Array.isArray(input.tasks) ? input.tasks : []).map((task) => estimateTaskCost(task, costModel));
  const codexTasks = taskForecasts.filter((task) => task.preferredRoute === CODEX_ROUTE.CODEX);
  const zeroCostTasks = taskForecasts.filter((task) => task.preferredRoute !== CODEX_ROUTE.CODEX);
  const nextCodexTask = codexTasks[0] || null;
  const queuedCodexDemandPercent = codexTasks.reduce((sum, task) => sum + task.p80Percent, 0);
  const reserves = Object.freeze({ ...DEFAULT_CAPACITY_RESERVES, ...(input.reserves || {}) });
  const configuredReservedPercent = reserveTotal(reserves);
  const reservedPercent = reserveForTask(reserves, nextCodexTask);
  const observedRemainingPercent = Number.isFinite(Number(observation.remainingPercent)) ? Number(observation.remainingPercent) : 0;
  const safelySchedulablePercent = Math.max(0, observedRemainingPercent - reservedPercent);
  const shortfallPercent = Math.max(0, queuedCodexDemandPercent - safelySchedulablePercent);
  const evaluationUtc = text(input.nowUtc);
  const maxMeterAgeMinutes = clamp(
    input.maxMeterAgeMinutes === undefined ? DEFAULT_METER_MAX_AGE_MINUTES : input.maxMeterAgeMinutes,
    1,
    120,
  );
  const meterTruth = meterTrust(observation, evaluationUtc, maxMeterAgeMinutes);
  const resetPlan = planBankedReset({
    observation,
    nowUtc: evaluationUtc,
    maxMeterAgeMinutes,
    queueDemandPercent: queuedCodexDemandPercent,
    activeCodexTask: input.activeCodexTask,
    standingOperatorPolicyActive: meterTruth.trusted && input.standingOperatorPolicyActive,
    standingOperatorPolicyRef: input.standingOperatorPolicyRef,
    completedResetIds: input.completedResetIds,
    resetCompletionReceipts: input.resetCompletionReceipts,
    redeemThresholdPercent: input.redeemThresholdPercent,
    expiryGuardHours: input.expiryGuardHours,
    naturalResetGuardHours: input.naturalResetGuardHours,
  });
  const velocity = forecastStackVelocity(input.stackVelocity || {});

  let decision = CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED;
  let route = CODEX_ROUTE.CODEX;
  let reason = 'Observed capacity covers the next Codex-suitable task while preserving configured reserves.';
  if (!nextCodexTask && zeroCostTasks.length) {
    decision = CODEX_CAPACITY_DECISION.CODEX_ROUTE_ZERO_COST;
    route = zeroCostTasks[0].preferredRoute;
    reason = 'Queued work has a safe zero-cost route and should not consume Codex capacity.';
  } else if (!meterTruth.trusted) {
    decision = CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN;
    route = CODEX_ROUTE.BLOCKED;
    if (!meterTruth.complete) {
      reason = 'An explicit remaining percentage and availability state are required before Codex dispatch.';
    } else if (!Number.isFinite(timestamp(evaluationUtc)) || !Number.isFinite(timestamp(observation.observedAtUtc))) {
      reason = 'A valid evaluation time and meter observation timestamp are required before Codex dispatch.';
    } else if (!meterTruth.confidenceTrusted) {
      reason = 'Current Codex meter confidence is too low; refresh the usage observation before dispatch.';
    } else {
      reason = `Current Codex meter observation is stale (${Math.round(meterTruth.ageMinutes)} minutes old); refresh it before dispatch.`;
    }
  } else if (resetPlan.decision === CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW) {
    decision = CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW;
    route = CODEX_ROUTE.DEFER_UNTIL_RESET;
    reason = resetPlan.reason;
  } else if (observation.availability !== CODEX_AVAILABILITY.AVAILABLE) {
    decision = observation.availability === CODEX_AVAILABILITY.UNKNOWN
      ? CODEX_CAPACITY_DECISION.CODEX_CAPACITY_UNKNOWN
      : CODEX_CAPACITY_DECISION.CODEX_BLOCKED_BY_METER;
    route = CODEX_ROUTE.BLOCKED;
    reason = `Codex availability is ${observation.availability}; dispatch is blocked until an executable AVAILABLE state is freshly observed.`;
  } else if (nextCodexTask && nextCodexTask.p80Percent > safelySchedulablePercent) {
    if (observation.naturalResetAtUtc) {
      decision = CODEX_CAPACITY_DECISION.CODEX_DEFER_UNTIL_NATURAL_RESET;
      route = CODEX_ROUTE.DEFER_UNTIL_RESET;
      reason = 'The next Codex task does not fit inside safely schedulable capacity; preserve reserves and wait for the natural reset or split the task.';
    } else {
      decision = CODEX_CAPACITY_DECISION.CODEX_BLOCKED_BY_METER;
      route = CODEX_ROUTE.SPLIT_TASK;
      reason = 'The next Codex task does not fit inside safely schedulable capacity and no trusted reset time is known.';
    }
  }

  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_GOVERNOR_SCHEMA_VERSION,
    kind: 'stephanos.codex_capacity.projection',
    observation,
    evaluationUtc,
    maxMeterAgeMinutes,
    meterTruth,
    reserves,
    configuredReservedPercent,
    reservedPercent,
    safelySchedulablePercent,
    taskForecasts,
    queuedCodexDemandPercent,
    queuedZeroCostTasks: zeroCostTasks.length,
    shortfallPercent,
    nextCodexTask,
    decision,
    selectedRoute: route,
    reason,
    dispatchAllowed: decision === CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED,
    resetPlan,
    stackVelocity: velocity,
    exactNextAction: resetPlan.decision === CODEX_CAPACITY_DECISION.CODEX_BANKED_RESET_REDEEM_NOW
      ? 'Redeem the selected banked reset through the fixed Battle Bridge authenticated Codex UI action, capture before/after meter proof, then recalculate the queue.'
      : (decision === CODEX_CAPACITY_DECISION.CODEX_DISPATCH_ALLOWED
        ? 'Dispatch only the highest-value Codex-suitable task and record a before/after capacity receipt.'
        : reason),
    finalVerdict: 'CODEX_CAPACITY_PROJECTION_READY',
  });
}
