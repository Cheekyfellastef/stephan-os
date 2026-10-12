export const CONVERSATION_LEARNING_JOURNEY_SCHEMA_V1 = 'stephanos.conversation-learning-journey.v1';

const list = value => Array.isArray(value) ? value : [];
const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const text = value => String(value ?? '').trim();

// Read-only presentation: signals are conversation hints, not independently
// verified capability failures. No source-turn or protocol role grants authority.
export function deriveConversationLearningJourneyV1({ uplift = null, feedState = 'unavailable' } = {}) {
  const observed = uplift && typeof uplift === 'object' ? uplift : {};
  const upstream = text(feedState).toLowerCase();
  // Dashboard stale/partial may be caused by unrelated GitHub or programme telemetry.
  // Conversation freshness comes from the independently validated uplift state.
  const feedUsable = ['ready', 'current', 'reported', 'reachable', 'stale', 'partial'].includes(upstream);
  const indexComplete = observed.state === 'ready';
  const available = indexComplete && feedUsable;
  const signals = available ? list(observed.candidates).filter(item =>
    item && typeof item.id === 'string' && item.classification === 'CONVERSATION_HINT_REVIEW_REQUIRED'
      && item.provenCapabilityFailure === false
  ) : [];
  const candidates = signals.map(item => Object.freeze({
    id: item.id,
    title: text(item.title) || 'Unnamed investigation hint',
    mentions: number(item.mentionCount),
    evidenceCount: list(item.sourceTurnRefs).length,
    readyForInvestigation: item.eligibleForBoundedInvestigation === true
      && list(item.sourceTurnRefs).length >= 2,
    state: item.eligibleForBoundedInvestigation === true ? 'INVESTIGATION_ELIGIBLE' : 'EVIDENCE_NEEDED',
  }));
  const readyCount = candidates.filter(item => item.readyForInvestigation).length;
  return Object.freeze({
    schemaVersion: CONVERSATION_LEARNING_JOURNEY_SCHEMA_V1,
    state: available ? 'REPORTED' : indexComplete ? 'TRANSPORT_UNAVAILABLE' : 'UNKNOWN',
    threadId: text(observed.threadId),
    indexedTurns: available ? number(observed.turnCount) : null,
    gapHints: available ? candidates.length : null,
    investigationEligible: available ? readyCount : null,
    // There is currently no exact source-turn -> admitted goal -> builder
    // pickup -> executed proof linkage in this feed. Never invent zeros.
    admittedGoals: null,
    builderPickups: null,
    provenImprovements: null,
    candidates: Object.freeze(candidates),
    source: 'Canonical Shared Workspace conversation via existing backend feed',
    reason: available ? 'Conversation signals reported; independent investigation required'
      : indexComplete ? 'Conversation source is ready but its transport cannot be verified'
      : 'Full conversation history is not currently verified',
    provenanceNote: 'Operator is a protocol role, not proof of human authorship. A candidate is not a goal, build or completed improvement.',
  });
}
