import {
  readSharedWorkspaceRecordDirectory,
} from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
} from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  createBuildConciergeGoalRequest,
  readBuildConciergeGoalReceipts,
} from './buildConciergeGoalService.js';

export const FLYWHEEL_LEARNING_GOAL_BRIDGE_SCHEMA_V1 = 'stephanos.flywheel-learning-goal-bridge.v1';
export const FLYWHEEL_LEARNING_GOAL_SOURCE_V1 = 'Flywheel mission 2670';
export const FLYWHEEL_LEARNING_GOAL_DEFAULT_LIMIT_V1 = 4;

const NON_ROOT_OWNER_ISSUES = new Set([2647, 2670, 2671]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeId(value, fallback = 'learning-gap') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return normalized || fallback;
}

function issueRefsFromValue(value) {
  const source = text(value);
  const refs = [];
  const pattern = /(?:\b(?:goal|issue):\s*#?([1-9]\d*)\b)|(?:#([1-9]\d*))/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const issue = Number(match[1] || match[2]);
    if (Number.isSafeInteger(issue) && issue > 0) refs.push(issue);
  }
  return refs;
}

function ownerIssueRefs(event = {}) {
  const learning = event?.closedLoopLearning || {};
  const candidate = event?.learningCandidate || {};
  const values = [
    event.relatedIssue,
    event.relatedGoal,
    event.canonicalOwnerGoal,
    event.ownerGoal,
    ...list(learning.targetRefs),
    ...list(candidate.componentAndOwnerRefs),
    ...list(candidate.existingGoalCandidates),
  ];
  return [...new Set(values.flatMap(issueRefsFromValue))]
    .filter((issue) => !NON_ROOT_OWNER_ISSUES.has(issue));
}

function actionableLearningGap(event = {}) {
  const learning = event?.closedLoopLearning;
  if (
    learning?.learningEligibleCapabilityFailure === true
    && learning?.telemetry?.retryReady !== true
  ) return true;
  const candidate = event?.flywheelImprovementCandidate || event?.learningCandidate;
  return candidate?.requiresExistingGoalSearch === true
    || candidate?.repairReplayRequired === true;
}

function eventIdentity(event = {}) {
  return safeId(event.eventId || event.correlationId || event.learningCandidate?.recordKey || event.timestampUtc);
}

function capabilityIdentity(event = {}) {
  return safeId(
    event?.closedLoopLearning?.capabilityId
      || event?.flywheelImprovementCandidate?.gapId
      || event?.learningCandidate?.capabilityId
      || event?.learningCandidate?.recordKey
      || event?.eventKind,
    'learned-capability-gap',
  );
}

function candidateMarker(eventId) {
  return `FLYWHEEL_EVENT:${eventId}`;
}

function existingCandidateForEvent(receipts = [], eventId = '') {
  const marker = candidateMarker(eventId);
  return list(receipts).find((receipt) => text(receipt?.goal?.intent).includes(marker)) || null;
}

function resultBase(overrides = {}) {
  return Object.freeze({
    schemaVersion: FLYWHEEL_LEARNING_GOAL_BRIDGE_SCHEMA_V1,
    ok: true,
    reason: 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_COMPLETE',
    observedActionableEventCount: 0,
    attachedExistingOwnerCount: 0,
    createdGoalCandidateCount: 0,
    dedupedGoalCandidateCount: 0,
    heldCount: 0,
    attachments: Object.freeze([]),
    createdGoalCandidateIds: Object.freeze([]),
    dedupedGoalCandidateIds: Object.freeze([]),
    errors: Object.freeze([]),
    authority: Object.freeze({
      githubIssueCreationAllowed: false,
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      dispatchAllowed: false,
      mergeAllowed: false,
      approvalBypassAllowed: false,
    }),
    finalVerdict: 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_READY',
    ...overrides,
  });
}

export async function reconcileFlywheelLearningGoalsV1(input = {}) {
  const repoRoot = input.repoRoot || process.cwd();
  const resolved = resolveSharedWorkspaceRuntimeConfig({
    root: input.root || input.workspaceRoot,
    env: input.env,
    repoRoot,
  });
  if (!resolved.ok) {
    return resultBase({
      ok: false,
      reason: resolved.reason,
      finalVerdict: 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_UNAVAILABLE',
    });
  }

  const nowMs = Number.isFinite(input.nowMs)
    ? input.nowMs
    : Number.isFinite(Date.parse(text(input.nowUtc)))
      ? Date.parse(text(input.nowUtc))
      : Date.now();
  const now = new Date(nowMs);
  const maxCandidates = Number.isSafeInteger(input.maxCandidates)
    ? Math.max(1, Math.min(16, input.maxCandidates))
    : FLYWHEEL_LEARNING_GOAL_DEFAULT_LIMIT_V1;

  const readEvents = input.readEvents || readSharedWorkspaceRecordDirectory;
  const readCandidates = input.readGoalCandidates || readBuildConciergeGoalReceipts;
  const createCandidate = input.createGoalCandidate || createBuildConciergeGoalRequest;

  const eventHistory = await readEvents(resolved.root, 'events', { repoRoot, nowMs });
  const buildConcierge = await readCandidates(input.buildConciergeGoalOptions || {});
  const receipts = [...list(buildConcierge?.receipts)];
  const events = list(eventHistory?.records)
    .filter(actionableLearningGap)
    .sort((left, right) => Date.parse(text(left?.timestampUtc)) - Date.parse(text(right?.timestampUtc)));

  const attachments = [];
  const createdGoalCandidateIds = [];
  const dedupedGoalCandidateIds = [];
  const errors = [...list(eventHistory?.errors)];
  let attachedExistingOwnerCount = 0;
  let dedupedGoalCandidateCount = 0;
  let heldCount = 0;

  for (const event of events) {
    const eventId = eventIdentity(event);
    const owners = ownerIssueRefs(event);
    if (owners.length) {
      attachedExistingOwnerCount += 1;
      attachments.push(Object.freeze({
        eventId,
        disposition: 'ATTACH_TO_EXISTING_GOAL',
        ownerGoals: Object.freeze(owners.map((issue) => `#${issue}`)),
      }));
      continue;
    }

    const existing = existingCandidateForEvent(receipts, eventId);
    if (existing) {
      dedupedGoalCandidateCount += 1;
      const candidateId = text(existing?.goal?.id || existing?.receiptId);
      if (candidateId) dedupedGoalCandidateIds.push(candidateId);
      attachments.push(Object.freeze({
        eventId,
        disposition: 'DEDUPED_EXISTING_GOAL_CANDIDATE',
        candidateId,
      }));
      continue;
    }

    if (createdGoalCandidateIds.length >= maxCandidates) {
      heldCount += 1;
      attachments.push(Object.freeze({
        eventId,
        disposition: 'HELD_CANDIDATE_LIMIT',
      }));
      continue;
    }

    const capabilityId = capabilityIdentity(event);
    const request = {
      title: `Close learned capability gap: ${capabilityId}`,
      intent: `${candidateMarker(eventId)} Resolve the evidenced capability gap ${capabilityId} under mission 2670. Reuse any canonical owner before construction and preserve existing authority gates.`,
      priority: 'normal',
      requestedBy: 'durable-flywheel-controller',
      sourceSurface: FLYWHEEL_LEARNING_GOAL_SOURCE_V1,
    };
    try {
      const created = await createCandidate(request, {
        ...(input.buildConciergeGoalOptions || {}),
        now,
      });
      if (created?.ok !== true) {
        errors.push(`${eventId}:${list(created?.errors).join(',') || text(created?.reason, 'GOAL_CANDIDATE_CREATE_FAILED')}`);
        attachments.push(Object.freeze({ eventId, disposition: 'GOAL_CANDIDATE_CREATE_FAILED' }));
        continue;
      }
      const receipt = created.receipt || null;
      if (receipt) receipts.push(receipt);
      const candidateId = text(created?.candidate?.id || created?.receipt?.goal?.id || created?.receipt?.receiptId);
      if (candidateId) createdGoalCandidateIds.push(candidateId);
      attachments.push(Object.freeze({
        eventId,
        disposition: 'BOUNDED_GOAL_CANDIDATE_CREATED',
        candidateId,
      }));
    } catch (error) {
      errors.push(`${eventId}:${text(error?.message, 'GOAL_CANDIDATE_CREATE_FAILED')}`);
      attachments.push(Object.freeze({ eventId, disposition: 'GOAL_CANDIDATE_CREATE_FAILED' }));
    }
  }

  return resultBase({
    ok: errors.length === 0,
    reason: errors.length
      ? 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_DEGRADED'
      : 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_COMPLETE',
    observedActionableEventCount: events.length,
    attachedExistingOwnerCount,
    createdGoalCandidateCount: createdGoalCandidateIds.length,
    dedupedGoalCandidateCount,
    heldCount,
    attachments: Object.freeze(attachments),
    createdGoalCandidateIds: Object.freeze(createdGoalCandidateIds),
    dedupedGoalCandidateIds: Object.freeze(dedupedGoalCandidateIds),
    errors: Object.freeze(errors),
    finalVerdict: errors.length
      ? 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_DEGRADED'
      : 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_READY',
  });
}
