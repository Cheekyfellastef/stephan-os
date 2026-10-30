// Read-only translation of existing validated Shared Workspace closed-loop
// learning events into Sovereign Commander skill proposals. This does NOT
// qualify, authorise, install, run or merge any capability.
export const SOVEREIGN_NATIVE_GAP_INTAKE_SCHEMA = 'stephanos.sovereign-native-gap-intake.v1';
export const SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES = 2;
// Retain the complete bounded unresolved inventory, not just the two
// proposals admitted to a single compiler cycle.
export const SOVEREIGN_NATIVE_GAP_MAX_RETAINED = 128;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ID = /^[a-z][a-z0-9-]{2,79}$/;
const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/;

function eventIdentity(record, nowMs) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.schemaVersion !== 'shared-agent-workspace-record.v1'
    || record.kind !== 'stephanos.shared_workspace.event'
    || record.participantId !== 'sovereign-commander'
    || !EVENT_ID.test(String(record.eventId || ''))) return null;
  const learning = record.closedLoopLearning;
  if (!learning || learning.schemaVersion !== 'stephanos.closed-loop-learning.v1'
    || learning.failureClass !== 'CAPABILITY_GAP'
    || learning.genuineCapabilityFailure !== true
    || learning.learningEligibleCapabilityFailure !== true
    || learning.attemptedBy !== 'sovereign-commander'
    || !ID.test(String(learning.capabilityId || ''))) return null;
  // Do not steal work with another canonical owner. A missing target does
  // not itself grant construction authority, since this is proposal-only.
  const targets = Array.isArray(learning.targetRefs) ? learning.targetRefs : [];
  if (targets.length && !targets.some((ref) =>
    ref === '#2573' || ref === 'goal:#2573' || ref === 'goal:2573')) return null;
  const at = Date.parse(String(record.timestampUtc || ''));
  if (!Number.isFinite(at) || at > nowMs + 60_000
    || nowMs - at > RECENT_WINDOW_MS) return null;
  return {
    capabilityId: learning.capabilityId,
    eventId: record.eventId,
    timestampUtc: new Date(at).toISOString(),
  };
}

export function extractSovereignNativeCapabilityGapsV1(events = [], {
  nowUtc = new Date().toISOString(),
  priorGaps = [],
} = {}) {
  const parsedNow = Date.parse(nowUtc);
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const source = Array.isArray(events) ? events : [];
  const byCapability = new Map();
  for (const record of source) {
    const item = eventIdentity(record, nowMs);
    if (!item) continue;
    let group = byCapability.get(item.capabilityId);
    if (!group) {
      group = { capabilityId: item.capabilityId, events: new Map() };
      byCapability.set(item.capabilityId, group);
    }
    // Never count duplicate event IDs twice.
    group.events.set(item.eventId, item.timestampUtc);
  }
  // Prior accepted gap observations remain pending even when their discovery
  // event ages beyond the intake window or the event reader goes degraded.
  // This is retention of a *proposal*, never proof of activation or authority.
  // Do not accept arbitrary prior status rows without original event identity.
  for (const prior of (Array.isArray(priorGaps) ? priorGaps : []).slice(0, SOVEREIGN_NATIVE_GAP_MAX_RETAINED)) {
    if (!prior || !ID.test(String(prior.capabilityId || ''))
      || prior.origin !== 'sovereign-native-event'
      || prior.state !== 'BUILDABLE_GAP'
      || prior.sourceIsRuntimeParityProof !== false
      || prior.constructionAdmissionAllowed !== false
      || !Array.isArray(prior.evidenceEventIds)
      || !prior.evidenceEventIds.length) continue;
    const ids = prior.evidenceEventIds.slice(0, 3);
    if (ids.some((id) => !EVENT_ID.test(String(id)))) continue;
    let group = byCapability.get(prior.capabilityId);
    if (!group) {
      group = { capabilityId: prior.capabilityId, events: new Map() };
      byCapability.set(prior.capabilityId, group);
    }
    for (const id of ids) group.events.set(id, 'RETAINED_UNTIL_PROVEN_CLOSED');
    const count = Number(prior.observationCount);
    group.retainedCount = Math.max(group.retainedCount || 0,
      Number.isSafeInteger(count) && count > 0 ? Math.min(count, 1_000_000) : ids.length);
  }
  const ordered = [...byCapability.values()]
    .sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
  const retainedGaps = Object.freeze(ordered.slice(0, SOVEREIGN_NATIVE_GAP_MAX_RETAINED).map((group) =>
    Object.freeze({
      capabilityId: group.capabilityId,
      origin: 'sovereign-native-event',
      state: 'BUILDABLE_GAP',
      observationCount: Math.max(group.events.size, group.retainedCount || 0),
      evidenceEventIds: Object.freeze([...group.events.keys()].sort().slice(0, 3)),
      sourceIsRuntimeParityProof: false,
      constructionAdmissionAllowed: false,
    }),
  ));
  // Compiler intake is deliberately capped at two per cycle. The durable
  // inventory stays separate so waiting proposals cannot evaporate as their
  // original seven-day discovery records age out.
  const gaps = Object.freeze(retainedGaps.slice(0, SOVEREIGN_NATIVE_GAP_MAX_CANDIDATES));
  return Object.freeze({
    schemaVersion: SOVEREIGN_NATIVE_GAP_INTAKE_SCHEMA,
    observedEventCount: source.length,
    candidateTotalCount: ordered.length,
    candidateCount: gaps.length,
    candidatesTruncated: ordered.length > gaps.length,
    retainedGaps,
    retainedCount: retainedGaps.length,
    retentionTruncated: ordered.length > retainedGaps.length,
    gaps,
    readOnly: true,
    proofOfNewExecutableCapability: false,
    automaticAdmissionAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    finalVerdict: ordered.length ? 'SOVEREIGN_NATIVE_GAP_PROPOSALS_READY' : 'SOVEREIGN_NATIVE_GAP_NO_QUALIFIED_EVENTS',
  });
}
