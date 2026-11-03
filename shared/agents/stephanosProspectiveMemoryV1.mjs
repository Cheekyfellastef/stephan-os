import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION = 'stephanos.prospective-memory.v1';
export const STEPHANOS_PROSPECTIVE_MEMORY_PROJECTION_VERSION = 'stephanos.prospective-memory-projection.v1';
export const STEPHANOS_PROSPECTIVE_MEMORY_MAX_LOOPS = 512;
export const STEPHANOS_PROSPECTIVE_MEMORY_MAX_REFS = 24;
export const STEPHANOS_PROSPECTIVE_MEMORY_MAX_SERIALIZED_BYTES = 256 * 1024;

export const STEPHANOS_PROSPECTIVE_MEMORY_CLASSES = Object.freeze([
  'PROMISE', 'DEFERRED_GOAL', 'REVISIT_CONDITION', 'OPEN_THREAD', 'REMINDER', 'FOLLOW_UP',
]);
export const STEPHANOS_PROSPECTIVE_MEMORY_ORIGINS = Object.freeze([
  'OPERATOR_REQUEST', 'GOAL_STATE', 'PARTICIPANT_COMMITMENT', 'MODEL_PROPOSAL', 'UNKNOWN',
]);
export const STEPHANOS_PROSPECTIVE_MEMORY_PROMOTION = Object.freeze([
  'CONFIRMED', 'CANDIDATE', 'REJECTED', 'UNKNOWN',
]);
export const STEPHANOS_PROSPECTIVE_MEMORY_STATES = Object.freeze([
  'OPEN', 'BLOCKED', 'CLOSED', 'EXPIRED', 'CANCELLED', 'UNKNOWN',
]);
export const STEPHANOS_PROSPECTIVE_MEMORY_TRIGGERS = Object.freeze([
  'NONE', 'AT_TIME', 'ON_CONDITION', 'ON_RECEIPT', 'ON_OPERATOR_RETURN', 'UNKNOWN',
]);
export const STEPHANOS_PROSPECTIVE_MEMORY_FRESHNESS = Object.freeze([
  'FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const CLASSES = new Set(STEPHANOS_PROSPECTIVE_MEMORY_CLASSES);
const ORIGINS = new Set(STEPHANOS_PROSPECTIVE_MEMORY_ORIGINS);
const PROMOTION = new Set(STEPHANOS_PROSPECTIVE_MEMORY_PROMOTION);
const STATES = new Set(STEPHANOS_PROSPECTIVE_MEMORY_STATES);
const TRIGGERS = new Set(STEPHANOS_PROSPECTIVE_MEMORY_TRIGGERS);
const FRESHNESS = new Set(STEPHANOS_PROSPECTIVE_MEMORY_FRESHNESS);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:operator|participant|goal|issue|pr|intent|thread|receipt|evidence|proof|workspace|memory|project|component|condition|runtime):\/\/[a-z0-9][a-z0-9._:/#@-]{0,220}$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|raw prompt|raw response|psychological profile|mental diagnosis|personality disorder|credential)\b/i;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;
const LOOP_KEYS = Object.freeze([
  'schemaVersion', 'loopId', 'continuityKey', 'loopClass', 'origin', 'promotionState',
  'summary', 'whyItMatters', 'state', 'authorityClass', 'freshness', 'openedAtUtc',
  'dueAtUtc', 'closedAtUtc', 'triggerKind', 'triggerRefs', 'ownerRef', 'sourceRefs',
  'proofRefs', 'supersedesLoopId', 'supersededByLoopId',
]);
const INPUT_KEYS = Object.freeze(['observedAtUtc', 'openLoops']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  prospectiveMemoryWriteAllowed: false,
  durablePromotionAllowed: false,
  reminderCreationAllowed: false,
  scheduleCreationAllowed: false,
  triggerRegistrationAllowed: false,
  autoDispatchAllowed: false,
  commandExecutionAllowed: false,
  goalMutationAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return INVALID;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function denseStringArray(value, maximum = STEPHANOS_PROSPECTIVE_MEMORY_MAX_REFS) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.keys(descriptors).length !== length + 1) return INVALID;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || typeof descriptor.value !== 'string') return INVALID;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function safeText(value, maximum) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !SENSITIVE_TEXT.test(value)
    && !LOCAL_PATH.test(value);
}

function safeRef(value) {
  return typeof value === 'string' && SAFE_REF.test(value) && !value.includes('..')
    && !SENSITIVE_TEXT.test(value) && !LOCAL_PATH.test(value);
}

function normalizeOptionalTimestamp(value, field, errors) {
  if (value === null) return null;
  if (!exactTimestamp(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeOptionalId(value, field, errors) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeRefs(value, field, errors) {
  const values = denseStringArray(value);
  if (values === INVALID) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const output = [];
  for (const item of values) {
    if (!safeRef(item)) errors.push(`${field}-contains-unsafe-ref`);
    else output.push(item);
  }
  if (new Set(output).size !== output.length) errors.push(`${field}-contains-duplicate`);
  return output;
}

function normalizeLoop(value, index) {
  const errors = [];
  const loop = exactObject(value, LOOP_KEYS);
  if (loop === INVALID) return { loop: null, errors: [`loop-${index}:invalid-exact-data-shape`] };

  if (loop.schemaVersion !== STEPHANOS_PROSPECTIVE_MEMORY_SCHEMA_VERSION) errors.push('schemaVersion-mismatch');
  if (!SAFE_ID.test(loop.loopId || '')) errors.push('loopId-invalid');
  if (!SAFE_ID.test(loop.continuityKey || '')) errors.push('continuityKey-invalid');
  const loopClass = CLASSES.has(loop.loopClass) ? loop.loopClass : 'OPEN_THREAD';
  if (!CLASSES.has(loop.loopClass)) errors.push('loopClass-invalid');
  const origin = ORIGINS.has(loop.origin) ? loop.origin : 'UNKNOWN';
  if (!ORIGINS.has(loop.origin)) errors.push('origin-invalid');
  const promotionState = PROMOTION.has(loop.promotionState) ? loop.promotionState : 'UNKNOWN';
  if (!PROMOTION.has(loop.promotionState)) errors.push('promotionState-invalid');
  if (!safeText(loop.summary, 640)) errors.push('summary-invalid');
  if (!safeText(loop.whyItMatters, 640)) errors.push('whyItMatters-invalid');
  const state = STATES.has(loop.state) ? loop.state : 'UNKNOWN';
  if (!STATES.has(loop.state)) errors.push('state-invalid');
  const authorityClass = AUTHORITY_CLASSES.has(loop.authorityClass)
    ? loop.authorityClass : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!AUTHORITY_CLASSES.has(loop.authorityClass)) errors.push('authorityClass-invalid');
  const freshness = FRESHNESS.has(loop.freshness) ? loop.freshness : 'UNKNOWN';
  if (!FRESHNESS.has(loop.freshness)) errors.push('freshness-invalid');

  if (origin === 'MODEL_PROPOSAL' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.INFERRED) {
    errors.push('model-proposal-must-remain-inferred');
  }
  if (origin === 'MODEL_PROPOSAL' && promotionState === 'CONFIRMED') errors.push('model-proposal-cannot-self-confirm');
  if (promotionState === 'CONFIRMED' && authorityClass !== STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY) {
    errors.push('confirmed-loop-requires-shared-authority');
  }

  if (!exactTimestamp(loop.openedAtUtc)) errors.push('openedAtUtc-invalid');
  const openedAtMs = exactTimestamp(loop.openedAtUtc) ? Date.parse(loop.openedAtUtc) : 0;
  const dueAtUtc = normalizeOptionalTimestamp(loop.dueAtUtc, 'dueAtUtc', errors);
  const dueAtMs = dueAtUtc ? Date.parse(dueAtUtc) : null;
  const closedAtUtc = normalizeOptionalTimestamp(loop.closedAtUtc, 'closedAtUtc', errors);
  const closedAtMs = closedAtUtc ? Date.parse(closedAtUtc) : null;
  if (dueAtMs !== null && dueAtMs < openedAtMs) errors.push('dueAtUtc-before-openedAtUtc');
  if (closedAtMs !== null && closedAtMs < openedAtMs) errors.push('closedAtUtc-before-openedAtUtc');
  if (['OPEN', 'BLOCKED'].includes(state) && closedAtUtc) errors.push('active-state-cannot-have-closedAtUtc');
  if (['CLOSED', 'EXPIRED', 'CANCELLED'].includes(state) && !closedAtUtc) errors.push('terminal-state-requires-closedAtUtc');

  const triggerKind = TRIGGERS.has(loop.triggerKind) ? loop.triggerKind : 'UNKNOWN';
  if (!TRIGGERS.has(loop.triggerKind)) errors.push('triggerKind-invalid');
  const triggerRefs = normalizeRefs(loop.triggerRefs, 'triggerRefs', errors);
  if (triggerKind === 'AT_TIME' && !dueAtUtc) errors.push('time-trigger-requires-dueAtUtc');
  if (['ON_CONDITION', 'ON_RECEIPT'].includes(triggerKind) && triggerRefs.length === 0) errors.push('reference-trigger-requires-triggerRefs');
  if (triggerKind === 'NONE' && triggerRefs.length) errors.push('none-trigger-cannot-have-triggerRefs');

  if (!safeRef(loop.ownerRef)) errors.push('ownerRef-invalid');
  const sourceRefs = normalizeRefs(loop.sourceRefs, 'sourceRefs', errors);
  const proofRefs = normalizeRefs(loop.proofRefs, 'proofRefs', errors);
  if (!sourceRefs.length && !proofRefs.length) errors.push('source-or-proof-ref-required');

  const supersedesLoopId = normalizeOptionalId(loop.supersedesLoopId, 'supersedesLoopId', errors);
  const supersededByLoopId = normalizeOptionalId(loop.supersededByLoopId, 'supersededByLoopId', errors);
  if (supersedesLoopId === loop.loopId || supersededByLoopId === loop.loopId) errors.push('loop-cannot-supersede-itself');
  if (supersededByLoopId && ['OPEN', 'BLOCKED'].includes(state)) errors.push('superseded-loop-cannot-remain-active');

  return {
    loop: Object.freeze({
      loopId: loop.loopId,
      continuityKey: loop.continuityKey,
      loopClass,
      origin,
      promotionState,
      summary: loop.summary,
      whyItMatters: loop.whyItMatters,
      state,
      authorityClass,
      freshness,
      openedAtUtc: loop.openedAtUtc,
      openedAtMs,
      dueAtUtc,
      dueAtMs,
      closedAtUtc,
      triggerKind,
      triggerRefs: Object.freeze(triggerRefs),
      ownerRef: loop.ownerRef,
      sourceRefs: Object.freeze(sourceRefs),
      proofRefs: Object.freeze(proofRefs),
      supersedesLoopId,
      supersededByLoopId,
    }),
    errors: errors.map((error) => `loop-${index}:${error}`),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function publicLoop(loop, observedAtMs) {
  const { openedAtMs, dueAtMs, ...rest } = loop;
  const overdue = ['OPEN', 'BLOCKED'].includes(loop.state) && dueAtMs !== null && dueAtMs < observedAtMs;
  const dueNow = ['OPEN', 'BLOCKED'].includes(loop.state) && dueAtMs !== null && dueAtMs === observedAtMs;
  return Object.freeze({ ...rest, overdue, dueNow });
}

function safeHold(errors) {
  return deepFreeze({
    schemaVersion: STEPHANOS_PROSPECTIVE_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_PROSPECTIVE_MEMORY',
    projectionId: '',
    observedAtUtc: '',
    verdict: 'SAFE_HOLD',
    openLoops: [],
    activeOpenLoops: [],
    candidateOpenLoops: [],
    historicalOpenLoops: [],
    rejectedOpenLoops: [],
    overdueLoopIds: [],
    continuityConflicts: [],
    authority: AUTHORITY,
    valid: false,
    validationErrors: errors,
  });
}

function projectionId(observedAtUtc, loops) {
  return `prospective-${createHash('sha256').update(JSON.stringify({ observedAtUtc, loops })).digest('hex').slice(0, 32)}`;
}

export function buildStephanosProspectiveMemoryV1(input = {}) {
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) return safeHold(['input-invalid-exact-data-shape']);
  const errors = [];
  if (!exactTimestamp(observed.observedAtUtc)) errors.push('observedAtUtc-invalid');
  const observedAtMs = exactTimestamp(observed.observedAtUtc) ? Date.parse(observed.observedAtUtc) : 0;

  let descriptors;
  try {
    if (!Array.isArray(observed.openLoops) || Object.getPrototypeOf(observed.openLoops) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(observed.openLoops);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > STEPHANOS_PROSPECTIVE_MEMORY_MAX_LOOPS || Object.keys(descriptors).length !== length + 1) throw new Error();
  } catch {
    errors.push('openLoops-must-be-dense-bounded-array');
  }

  const loops = [];
  if (descriptors && !errors.includes('openLoops-must-be-dense-bounded-array')) {
    for (let index = 0; index < descriptors.length.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        errors.push(`loop-${index}:must-be-own-enumerable-data-entry`);
        continue;
      }
      const normalized = normalizeLoop(descriptor.value, index);
      errors.push(...normalized.errors);
      if (normalized.loop) loops.push(normalized.loop);
    }
  }

  const ids = loops.map((loop) => loop.loopId);
  if (new Set(ids).size !== ids.length) errors.push('loopIds-must-be-unique');
  const byId = new Map(loops.map((loop) => [loop.loopId, loop]));
  for (const loop of loops) {
    if (loop.supersedesLoopId) {
      const prior = byId.get(loop.supersedesLoopId);
      if (!prior) errors.push(`loop-${loop.loopId}:supersedes-not-present:${loop.supersedesLoopId}`);
      else {
        if (prior.continuityKey !== loop.continuityKey) errors.push(`loop-${loop.loopId}:supersedes-different-continuity-key`);
        if (prior.supersededByLoopId !== loop.loopId) errors.push(`loop-${loop.loopId}:supersession-not-reciprocal`);
      }
    }
    if (loop.supersededByLoopId) {
      const replacement = byId.get(loop.supersededByLoopId);
      if (!replacement) errors.push(`loop-${loop.loopId}:supersededBy-not-present:${loop.supersededByLoopId}`);
      else {
        if (replacement.continuityKey !== loop.continuityKey) errors.push(`loop-${loop.loopId}:supersededBy-different-continuity-key`);
        if (replacement.supersedesLoopId !== loop.loopId) errors.push(`loop-${loop.loopId}:supersession-not-reciprocal`);
      }
    }
  }

  for (const loop of loops) {
    const visited = new Set();
    let cursor = loop;
    while (cursor?.supersedesLoopId) {
      if (visited.has(cursor.loopId)) {
        errors.push(`loop-${loop.loopId}:supersession-cycle-detected`);
        break;
      }
      visited.add(cursor.loopId);
      cursor = byId.get(cursor.supersedesLoopId);
    }
  }

  if (Buffer.byteLength(JSON.stringify(loops), 'utf8') > STEPHANOS_PROSPECTIVE_MEMORY_MAX_SERIALIZED_BYTES) {
    errors.push('openLoops-serialized-size-exceeds-bound');
  }
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length) return safeHold(uniqueErrors);

  const ordered = [...loops].sort((a, b) => compareText(a.continuityKey, b.continuityKey)
    || a.openedAtMs - b.openedAtMs || compareText(a.loopId, b.loopId));
  const publicLoops = ordered.map((loop) => publicLoop(loop, observedAtMs));
  const activeOpenLoops = publicLoops.filter((loop) => loop.promotionState === 'CONFIRMED'
    && loop.authorityClass === STEPHANOS_MEMORY_AUTHORITY_CLASS.SHARED_AUTHORITY
    && ['OPEN', 'BLOCKED'].includes(loop.state));
  const candidateOpenLoops = publicLoops.filter((loop) => loop.promotionState === 'CANDIDATE');
  const historicalOpenLoops = publicLoops.filter((loop) => ['CLOSED', 'EXPIRED', 'CANCELLED'].includes(loop.state)
    || loop.supersededByLoopId !== null);
  const rejectedOpenLoops = publicLoops.filter((loop) => loop.promotionState === 'REJECTED');
  const overdueLoopIds = activeOpenLoops.filter((loop) => loop.overdue).map((loop) => loop.loopId);

  const continuityConflicts = [];
  const byContinuity = new Map();
  for (const loop of activeOpenLoops) {
    const group = byContinuity.get(loop.continuityKey) || [];
    group.push(loop.loopId);
    byContinuity.set(loop.continuityKey, group);
  }
  for (const [continuityKey, loopIds] of byContinuity) {
    if (loopIds.length > 1) continuityConflicts.push(Object.freeze({ continuityKey, loopIds: Object.freeze([...loopIds].sort(compareText)) }));
  }
  continuityConflicts.sort((a, b) => compareText(a.continuityKey, b.continuityKey));

  const verdict = continuityConflicts.length
    ? 'PROSPECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS'
    : 'PROSPECTIVE_MEMORY_PROJECTED';

  return deepFreeze({
    schemaVersion: STEPHANOS_PROSPECTIVE_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_PROSPECTIVE_MEMORY',
    projectionId: projectionId(observed.observedAtUtc, publicLoops),
    observedAtUtc: observed.observedAtUtc,
    verdict,
    openLoops: publicLoops,
    activeOpenLoops,
    candidateOpenLoops,
    historicalOpenLoops,
    rejectedOpenLoops,
    overdueLoopIds,
    continuityConflicts,
    authority: AUTHORITY,
    valid: true,
    validationErrors: [],
  });
}
