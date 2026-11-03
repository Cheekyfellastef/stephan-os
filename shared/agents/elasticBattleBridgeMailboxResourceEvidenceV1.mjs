const SHA_RE = /^[0-9a-f]{40}$/i;
const SAFE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResources(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) => text(entry)).filter(Boolean);
  if (normalized.length !== value.length || normalized.some((entry) => !SAFE_RESOURCE_ID.test(entry))) return null;
  return Object.freeze([...new Set(normalized)]);
}

function fail(blocker) {
  return Object.freeze({
    ok: false,
    exactSourceBound: false,
    blocker,
    activeResourceIds: Object.freeze([]),
    commandMetadata: Object.freeze({}),
    mutationAuthority: false,
  });
}

export function deriveElasticMailboxResourceEvidence({
  schedulerSnapshot = null,
  currentHead = '',
  now = new Date(),
  staleAfterMs = 5 * 60 * 1000,
} = {}) {
  if (!schedulerSnapshot || typeof schedulerSnapshot !== 'object' || Array.isArray(schedulerSnapshot)) {
    return fail('MAILBOX_RESOURCE_SNAPSHOT_INVALID');
  }

  const expectedHead = text(currentHead).toLowerCase();
  const snapshotHead = text(schedulerSnapshot.sourceHead).toLowerCase();
  if (!SHA_RE.test(expectedHead) || !SHA_RE.test(snapshotHead) || expectedHead !== snapshotHead) {
    return fail('MAILBOX_RESOURCE_HEAD_MISMATCH');
  }

  const observedMs = timestampMs(schedulerSnapshot.observedAtUtc);
  const nowMs = now instanceof Date ? now.getTime() : timestampMs(now);
  if (!Number.isFinite(nowMs) || observedMs === null || observedMs > nowMs || nowMs - observedMs > staleAfterMs) {
    return fail('MAILBOX_RESOURCE_SNAPSHOT_STALE');
  }

  if (schedulerSnapshot.mutationAuthority !== false || schedulerSnapshot.exactSourceBound !== true) {
    return fail('MAILBOX_RESOURCE_AUTHORITY_INVALID');
  }

  const activeResourceIds = normalizeResources(schedulerSnapshot.activeResourceIds);
  if (activeResourceIds === null) return fail('MAILBOX_ACTIVE_RESOURCE_SCOPE_INVALID');

  if (!Array.isArray(schedulerSnapshot.commandClaims)) return fail('MAILBOX_COMMAND_CLAIMS_INVALID');
  const metadata = Object.create(null);
  const seen = new Set();
  for (const claim of schedulerSnapshot.commandClaims) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return fail('MAILBOX_COMMAND_CLAIM_INVALID');
    const requestId = text(claim.requestId);
    if (!SAFE_REQUEST_ID.test(requestId) || seen.has(requestId)) return fail('MAILBOX_COMMAND_CLAIM_ID_INVALID');
    seen.add(requestId);
    const resources = normalizeResources(claim.resourceIds);
    if (resources === null || resources.length === 0) return fail('MAILBOX_COMMAND_RESOURCE_SCOPE_REQUIRED');
    metadata[requestId] = Object.freeze({
      laneId: text(claim.laneId) || requestId,
      resources,
      approvalGated: claim.approvalGated === true,
      blocked: claim.blocked === true,
      providerAvailable: claim.providerAvailable !== false,
    });
  }

  return Object.freeze({
    ok: true,
    exactSourceBound: true,
    sourceHead: expectedHead,
    observedAtUtc: new Date(observedMs).toISOString(),
    activeResourceIds,
    commandMetadata: Object.freeze(metadata),
    mutationAuthority: false,
  });
}
