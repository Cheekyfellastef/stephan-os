import { ELASTIC_BUILD_CAPACITY_SCHEMA } from './elasticBuildCapacityV1.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const HARD_MAX_MAILBOX_WIDTH = 5;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function deriveMailboxCapacityEvidenceFromScheduler({
  schedulerCapacity = null,
  schedulerHead = '',
  currentHead = '',
  observedAtUtc = '',
  now = new Date(),
  staleAfterMs = 5 * 60 * 1000,
} = {}) {
  const fail = (blocker) => Object.freeze({
    ok: false,
    exactSourceBound: false,
    provenWidth: 1,
    observedAtUtc: text(observedAtUtc),
    blocker,
    mutationAuthority: false,
  });

  const expectedHead = text(currentHead).toLowerCase();
  const evidenceHead = text(schedulerHead).toLowerCase();
  if (!SHA_RE.test(expectedHead) || !SHA_RE.test(evidenceHead) || evidenceHead !== expectedHead) {
    return fail('MAILBOX_SCHEDULER_HEAD_MISMATCH');
  }

  const observedMs = timestampMs(observedAtUtc);
  const nowMs = now instanceof Date ? now.getTime() : timestampMs(now);
  if (!Number.isFinite(nowMs) || observedMs === null || observedMs > nowMs || nowMs - observedMs > staleAfterMs) {
    return fail('MAILBOX_SCHEDULER_EVIDENCE_STALE');
  }

  if (!schedulerCapacity || typeof schedulerCapacity !== 'object' || Array.isArray(schedulerCapacity)) {
    return fail('MAILBOX_SCHEDULER_CAPACITY_INVALID');
  }
  if (schedulerCapacity.schemaVersion !== ELASTIC_BUILD_CAPACITY_SCHEMA || schedulerCapacity.status !== 'RUNNING') {
    return fail('MAILBOX_SCHEDULER_CAPACITY_NOT_RUNNING');
  }
  if (schedulerCapacity.mutationAuthority !== false) {
    return fail('MAILBOX_SCHEDULER_AUTHORITY_INVALID');
  }

  const desiredWidth = integer(schedulerCapacity.desiredWidth);
  const availableExecutorSlots = integer(schedulerCapacity.availableExecutorSlots);
  const activeLaneCount = integer(schedulerCapacity.activeLaneCount);
  if (desiredWidth === null || availableExecutorSlots === null || activeLaneCount === null || desiredWidth < 1) {
    return fail('MAILBOX_SCHEDULER_CAPACITY_INVALID');
  }

  const provenWidth = Math.max(1, Math.min(HARD_MAX_MAILBOX_WIDTH, desiredWidth, availableExecutorSlots));
  return Object.freeze({
    ok: true,
    exactSourceBound: true,
    provenWidth,
    observedAtUtc: new Date(observedMs).toISOString(),
    sourceHead: expectedHead,
    activeLaneCount,
    schedulerDesiredWidth: desiredWidth,
    availableExecutorSlots,
    blocker: '',
    mutationAuthority: false,
  });
}
