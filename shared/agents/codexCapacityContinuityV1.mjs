import { adaptLegacyCodexQueueRecordV1 } from './providerNeutralExecutionCompatibilityV1.mjs';
import { planProviderIndependentBuilderIgnitionV1 } from './zeroOpenAiBuilderFailoverV1.mjs';

export const CODEX_CAPACITY_CONTINUITY_SCHEMA = 'stephanos.codex-capacity-continuity.v1';
export const CODEX_CAPACITY_UNAVAILABLE = 'CODEX_CAPACITY_UNAVAILABLE';
export const CODEX_CAPACITY_REROUTE_READY = 'CODEX_CAPACITY_REROUTE_READY';
export const CODEX_CAPACITY_REROUTE_BLOCKED = 'CODEX_CAPACITY_REROUTE_BLOCKED';

const CAPACITY_CODE = /(?:METER_STALLED|CAPACITY_UNAVAILABLE|USAGE_LIMIT|RATE_LIMIT|RATE_LIMIT_EXCEEDED|INSUFFICIENT_QUOTA|QUOTA_EXHAUSTED|TOO_MANY_REQUESTS|HTTP_?429)/i;
const CAPACITY_TEXT = /(?:codex[^\n]{0,80}(?:meter|usage|rate|quota|capacity)[^\n]{0,80}(?:empty|exhausted|limit|unavailable|stalled|exceeded)|(?:usage|rate)\s*limit[^\n]{0,80}(?:reached|exceeded)|(?:quota|capacity)[^\n]{0,80}(?:exhausted|unavailable)|insufficient[_ -]?quota|too many requests|\b429\b)/i;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function collectStrings(value, out = [], depth = 0) {
  if (depth > 5 || out.length >= 64) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = text(value);
    if (normalized) out.push(normalized.slice(0, 2000));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['code', 'blocker', 'reason', 'error', 'message', 'stderr', 'stdout', 'availability', 'state', 'verdict'].includes(key)) {
        collectStrings(item, out, depth + 1);
      }
    }
  }
  return out;
}

export function classifyCodexCapacityOutageV1(input = {}) {
  const evidence = [...new Set(collectStrings(input))];
  const matched = evidence.filter((item) => CAPACITY_CODE.test(item) || CAPACITY_TEXT.test(item));
  return Object.freeze({
    schemaVersion: CODEX_CAPACITY_CONTINUITY_SCHEMA,
    outage: matched.length > 0,
    blocker: matched.length > 0 ? CODEX_CAPACITY_UNAVAILABLE : '',
    matchedEvidence: Object.freeze(matched.slice(0, 8)),
    retryCodexAllowed: false,
    authorityChanged: false,
  });
}

function continuityAuthority() {
  return Object.freeze({
    sourceMutationAllowed: false,
    publicationAllowed: false,
    reviewAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    credentialAccessAllowed: false,
    spendingAllowed: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
}

export function createCodexProviderNeutralHandoffV1(input = {}) {
  const outage = classifyCodexCapacityOutageV1(input.failure || input.capacityEvidence || {});
  const base = {
    schemaVersion: CODEX_CAPACITY_CONTINUITY_SCHEMA,
    outage,
    authority: continuityAuthority(),
  };
  if (!outage.outage) {
    return Object.freeze({
      ...base,
      ok: false,
      blocker: 'CODEX_CAPACITY_OUTAGE_NOT_PROVEN',
      taskEnvelope: null,
      routePlan: null,
      finalVerdict: CODEX_CAPACITY_REROUTE_BLOCKED,
    });
  }

  const adapted = adaptLegacyCodexQueueRecordV1(input.queueRecord, input.context || {});
  if (!adapted.ok) {
    return Object.freeze({
      ...base,
      ok: false,
      blocker: adapted.blocker || 'CODEX_PROVIDER_NEUTRAL_ADAPTATION_BLOCKED',
      adaptationErrors: Object.freeze([...(adapted.errors || [])]),
      taskEnvelope: null,
      routePlan: null,
      finalVerdict: CODEX_CAPACITY_REROUTE_BLOCKED,
    });
  }

  const taskEnvelope = adapted.envelope;
  const routePlan = planProviderIndependentBuilderIgnitionV1({
    ignitionId: text(input.ignitionId) || `codex-capacity-${taskEnvelope.taskId}`,
    correlationId: text(input.correlationId) || taskEnvelope.correlationId,
    requestedSlots: 1,
    requiredCapability: text(input.requiredCapability) || 'sourceImplementation',
    schedulerDecision: { selectedTasks: [taskEnvelope] },
    providerRoutes: Array.isArray(input.providerRoutes) ? input.providerRoutes : [],
    activeLeaseIds: Array.isArray(input.activeLeaseIds) ? input.activeLeaseIds : [],
    seenIgnitionKeys: Array.isArray(input.seenIgnitionKeys) ? input.seenIgnitionKeys : [],
    openAiBlackout: true,
  });
  const selected = routePlan.ignitionRequests?.[0]?.selectedRoute || null;
  const ready = routePlan.finalVerdict === 'PROVIDER_INDEPENDENT_BUILDER_IGNITION_READY'
    && selected
    && selected.providerFamily !== 'OPENAI';

  return Object.freeze({
    ...base,
    ok: ready,
    blocker: ready ? '' : (routePlan.blocker || routePlan.heldTasks?.[0]?.reason || 'NO_QUALIFIED_NON_CODEX_ROUTE'),
    taskEnvelope,
    routePlan,
    selectedRoute: selected,
    preserveIdentity: Object.freeze({
      missionId: taskEnvelope.missionId,
      goalId: taskEnvelope.goalId,
      taskId: taskEnvelope.taskId,
      correlationId: taskEnvelope.correlationId,
      repository: taskEnvelope.repository,
      branch: taskEnvelope.branch,
      exactHeadIfReadOnly: taskEnvelope.exactHeadIfReadOnly,
      expectedStartingHeadIfMutable: taskEnvelope.expectedStartingHeadIfMutable,
      operatorApprovalState: taskEnvelope.operatorApprovalState,
      requiredEvidence: taskEnvelope.requiredEvidence,
    }),
    finalVerdict: ready ? CODEX_CAPACITY_REROUTE_READY : CODEX_CAPACITY_REROUTE_BLOCKED,
  });
}
