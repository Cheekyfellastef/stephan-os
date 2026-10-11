import {
  readSharedWorkspaceRecordDirectory,
  readSharedWorkspaceDashboardFeed,
} from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { deriveFlywheelWorkspaceView } from '../../shared/runtime/upliftWorkspaceProjectionV1.mjs';
import { planSeedGrowthWorkV1, seedGrowthGoalCompletedV1 } from '../../shared/runtime/seedGrowthWorkV1.mjs';
import {
  resolveSharedWorkspaceRuntimeConfig,
} from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  buildFlywheelAgentUpliftPlanV1,
} from '../../shared/agents/flywheelAgentUpliftV1.mjs';
import {
  createBuildConciergeGoalRequest,
  readBuildConciergeGoalReceipts,
} from './buildConciergeGoalService.js';
import {
  FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1,
  admitFlywheelCanonicalGoalV1,
} from './flywheelCanonicalGoalAdmissionService.js';
import { routeLLMRequest } from './llm/providerRouter.js';

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

function capabilityMarker(capabilityId) {
  return `FLYWHEEL_CAPABILITY:${safeId(capabilityId, 'learned-capability-gap')}`;
}

function existingCandidateForEvent(receipts = [], eventId = '', capabilityId = '') {
  const eventMarker = candidateMarker(eventId);
  const rootMarker = capabilityMarker(capabilityId);
  return list(receipts).find((receipt) => {
    const intentTokens = text(receipt?.goal?.intent).split(/\s+/).filter(Boolean);
    return intentTokens.includes(eventMarker) || intentTokens.includes(rootMarker);
  }) || null;
}

const POSITIVE_LEARNING_RECOVERY_STATES = Object.freeze(new Set([
  'RECOVERED',
  'RESOLVED',
  'REPAIRED',
  'VERIFIED',
  'PROVED',
  'PASSED',
  'PASS',
  'COMPLETE',
  'COMPLETED',
  'RETRY-READY',
  'CLOSED',
  'SUCCESS',
  'SUCCEEDED',
  'DONE',
]));

const NEGATIVE_LEARNING_RECOVERY_STATES = Object.freeze(new Set([
  'FAILED',
  'FAILURE',
  'ERROR',
  'BLOCKED',
  'STALLED',
  'INCOMPLETE',
  'REJECTED',
  'UNSAFE',
  'CANCELLED',
  'CANCELED',
  'ABORTED',
  'HOLD',
  'DEGRADED',
]));

function learningRecoveryProofRefs(event = {}) {
  return [...new Set([
    ...list(event?.proofRefs),
    ...list(event?.evidenceRefs),
    ...list(event?.testAndProofRefs),
    ...list(event?.closedLoopLearning?.verification?.proofRefs),
    ...list(event?.learningCandidate?.testAndProofRefs),
    ...list(event?.flywheelImprovementCandidate?.testAndProofRefs),
  ].map((value) => text(value, '')).filter(Boolean))];
}

function isLearningRecovery(event = {}) {
  const states = [
    event?.status,
    event?.state,
    event?.verdict,
    event?.finalVerdict,
    event?.phase,
  ]
    .map((value) => text(value, '').toUpperCase().replace(/[\s_]+/g, '-'))
    .filter(Boolean);
  const explicitNegativeState = states.some((value) => NEGATIVE_LEARNING_RECOVERY_STATES.has(value));
  if (explicitNegativeState) return false;
  const retryReady = event?.closedLoopLearning?.telemetry?.retryReady === true;
  const exactPositiveState = states.some((value) => POSITIVE_LEARNING_RECOVERY_STATES.has(value));
  if (!retryReady && !exactPositiveState) return false;
  return learningRecoveryProofRefs(event).length > 0;
}

function participantIdentity(event = {}) {
  return safeId(
    event.participantId
      || event.agentId
      || event.workerId
      || event.ownerId
      || event.controllerId
      || event.actor,
    'unknown-participant',
  );
}

function boundedNumber(value, fallback = 0, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, parsed));
}

function recurringFailureCountForEvent(event = {}, events = []) {
  const participantId = participantIdentity(event);
  const capabilityId = capabilityIdentity(event);
  const observedAt = Date.parse(text(event?.timestampUtc));
  return list(events).filter((candidate) => {
    const candidateAt = Date.parse(text(candidate?.timestampUtc));
    return actionableLearningGap(candidate)
      && participantIdentity(candidate) === participantId
      && capabilityIdentity(candidate) === capabilityId
      && (!Number.isFinite(observedAt) || !Number.isFinite(candidateAt) || candidateAt <= observedAt);
  }).length;
}

function buildProductionUpliftPlan(event = {}, eventHistory = []) {
  const capabilityId = capabilityIdentity(event);
  const summary = text(event?.summary || event?.detail || event?.message, capabilityId);
  return buildFlywheelAgentUpliftPlanV1({
    participantId: participantIdentity(event),
    missionId: safeId(event?.missionId || event?.relatedGoal || event?.correlationId, 'flywheel-capability-closure'),
    rootCauseState: text(
      event?.rootCauseState
        || event?.closedLoopLearning?.rootCauseState
        || event?.learningCandidate?.rootCauseState,
      'UNKNOWN',
    ),
    recurringFailureCount: Math.max(
      recurringFailureCountForEvent(event, eventHistory),
      boundedNumber(event?.recurringFailureCount || event?.closedLoopLearning?.telemetry?.failureCount, 0),
    ),
    capabilityGaps: [{
      capabilityId,
      gapId: capabilityId,
      kind: text(event?.eventKind, 'capability-gap'),
      summary,
    }],
    executionReceipts: [event],
    operatorInterventionCount: boundedNumber(
      event?.operatorInterventionCount || event?.closedLoopLearning?.telemetry?.operatorInterventionCount,
      0,
    ),
    conflictingEvidence: event?.conflictingEvidence === true || event?.closedLoopLearning?.conflictingEvidence === true,
    novelGap: event?.novelGap === true || event?.closedLoopLearning?.novelGap === true,
  });
}

function boundedBrainPrompt(event = {}, upliftPlan = {}) {
  const capabilityId = capabilityIdentity(event);
  const summary = text(event?.summary || event?.detail || event?.message, capabilityId).slice(0, 1600);
  const evidenceRefs = [
    ...list(event?.proofRefs),
    ...list(event?.evidenceRefs),
    ...list(event?.closedLoopLearning?.evidenceRefs),
    ...list(event?.learningCandidate?.evidenceRefs),
  ].map((value) => text(value)).filter(Boolean).slice(0, 12);
  const dimensions = list(upliftPlan?.dimensionsNeedingUplift).slice(0, 12);
  return [
    'You are the bounded Stephanos Flywheel diagnosis brain.',
    'Diagnose and design only. Do not claim source, runtime, dispatch, merge, deploy, spend, credential, or approval authority.',
    `Capability gap: ${capabilityId}`,
    `Participant: ${participantIdentity(event)}`,
    `Observed problem: ${summary}`,
    `Uplift dimensions: ${dimensions.join(', ') || 'unknown'}`,
    `Evidence refs: ${evidenceRefs.join(', ') || 'none'}`,
    'Return a concise root-cause hypothesis, evidence gaps, smallest reusable repair, proof/replay plan, risks, and rollback notes.',
  ].join('\n');
}

async function runBoundedFlywheelBrainDiagnosis({
  event,
  upliftPlan,
  routeBrainDiagnosis,
  brainRouterConfig = {},
} = {}) {
  const routeDecision = upliftPlan?.brainRequest?.routeDecision || {};
  try {
    const result = await routeBrainDiagnosis({
      messages: [{ role: 'user', content: boundedBrainPrompt(event, upliftPlan) }],
      systemPrompt: 'Bounded Flywheel diagnosis only. Preserve existing authority gates and route all implementation through canonical Stephanos work machinery.',
      routeDecision,
      freshnessContext: { freshnessNeed: 'low' },
    }, {
      provider: 'ollama',
      routeMode: 'local-first',
      fallbackEnabled: true,
      ollamaLoadMode: 'balanced',
      ...brainRouterConfig,
    });
    return Object.freeze({
      attempted: true,
      ok: result?.ok === true,
      reason: result?.ok === true ? 'FLYWHEEL_BRAIN_DIAGNOSIS_READY' : text(result?.error?.message || result?.fallbackReason, 'FLYWHEEL_BRAIN_DIAGNOSIS_UNAVAILABLE'),
      provider: text(result?.actualProviderUsed || result?.provider),
      model: text(result?.modelUsed || result?.model),
      fallbackUsed: result?.fallbackUsed === true,
      outputText: text(result?.outputText).slice(0, 4000),
      routeDecision: Object.freeze({ ...routeDecision }),
    });
  } catch (error) {
    return Object.freeze({
      attempted: true,
      ok: false,
      reason: text(error?.message, 'FLYWHEEL_BRAIN_DIAGNOSIS_FAILED'),
      provider: '',
      model: '',
      fallbackUsed: false,
      outputText: '',
      routeDecision: Object.freeze({ ...routeDecision }),
    });
  }
}

function unresolvedActionableEvents(events = []) {
  const ordered = [...events].sort((left, right) => Date.parse(text(left?.timestampUtc)) - Date.parse(text(right?.timestampUtc)));
  const actionable = ordered.filter(actionableLearningGap);
  const unresolved = actionable.filter((event) => {
    const capabilityId = capabilityIdentity(event);
    const participantId = participantIdentity(event);
    const observedAt = Date.parse(text(event?.timestampUtc));
    return !ordered.some((candidate) => (
      Date.parse(text(candidate?.timestampUtc)) > observedAt
      && participantIdentity(candidate) === participantId
      && capabilityIdentity(candidate) === capabilityId
      && isLearningRecovery(candidate)
    ));
  });
  return Object.freeze({
    unresolved: Object.freeze(unresolved),
    resolvedHistoricalEventCount: Math.max(0, actionable.length - unresolved.length),
  });
}

function resultBase(overrides = {}) {
  return Object.freeze({
    schemaVersion: FLYWHEEL_LEARNING_GOAL_BRIDGE_SCHEMA_V1,
    ok: true,
    reason: 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_COMPLETE',
    observedActionableEventCount: 0,
    resolvedHistoricalEventCount: 0,
    attachedExistingOwnerCount: 0,
    createdCanonicalGoalCount: 0,
    dedupedCanonicalGoalCount: 0,
    canonicalGoalAdmissionHeldCount: 0,
    createdGoalCandidateCount: 0,
    dedupedGoalCandidateCount: 0,
    heldCount: 0,
    brainDiagnosisAttemptCount: 0,
    brainDiagnosisSuccessCount: 0,
    brainDiagnosisFailureCount: 0,
    brainDiagnoses: Object.freeze([]),
    attachments: Object.freeze([]),
    createdCanonicalGoalIssueNumbers: Object.freeze([]),
    dedupedCanonicalGoalIssueNumbers: Object.freeze([]),
    canonicalGoalAdmissionBlockers: Object.freeze([]),
    createdGoalCandidateIds: Object.freeze([]),
    dedupedGoalCandidateIds: Object.freeze([]),
    errors: Object.freeze([]),
    authority: Object.freeze({
      boundedCanonicalGoalAdmissionAllowed: false,
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
  const maxCanonicalGoals = Math.min(
    maxCandidates,
    FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.maxIssuesPerCycle,
  );

  const readEvents = input.readEvents || readSharedWorkspaceRecordDirectory;
  const readCandidates = input.readGoalCandidates || readBuildConciergeGoalReceipts;
  const createCandidate = input.createGoalCandidate || createBuildConciergeGoalRequest;
  const admitCanonicalGoal = input.admitCanonicalGoal || admitFlywheelCanonicalGoalV1;
  const routeBrainDiagnosis = input.routeBrainDiagnosis || routeLLMRequest;
  const brainDiagnosisAuthorized = input.brainDiagnosisAuthorized === true;
  const maxBrainDiagnoses = Number.isSafeInteger(input.maxBrainDiagnoses)
    ? Math.max(0, Math.min(4, input.maxBrainDiagnoses))
    : 1;

  const eventHistory = await readEvents(resolved.root, 'events', { repoRoot, nowMs });
  const buildConcierge = await readCandidates(input.buildConciergeGoalOptions || {});
  const receipts = [...list(buildConcierge?.receipts)];
  const eventResolution = unresolvedActionableEvents(list(eventHistory?.records));
  const events = [...eventResolution.unresolved];

  const attachments = [];
  const createdCanonicalGoalIssueNumbers = [];
  const dedupedCanonicalGoalIssueNumbers = [];
  const canonicalGoalAdmissionBlockers = [];
  const createdGoalCandidateIds = [];
  const dedupedGoalCandidateIds = [];
  const errors = [...list(eventHistory?.errors)];
  const brainDiagnoses = [];
  let brainDiagnosisAttemptCount = 0;
  let brainDiagnosisSuccessCount = 0;
  let brainDiagnosisFailureCount = 0;
  let attachedExistingOwnerCount = 0;
  let createdCanonicalGoalCount = 0;
  let dedupedCanonicalGoalCount = 0;
  let canonicalGoalAdmissionHeldCount = 0;
  let dedupedGoalCandidateCount = 0;
  let heldCount = 0;
  const seedGrowthAttachments = [];

  for (const event of events) {
    const eventId = eventIdentity(event);
    const capabilityId = capabilityIdentity(event);
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

    const existing = existingCandidateForEvent(receipts, eventId, capabilityId);
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

    const upliftPlan = buildProductionUpliftPlan(event, list(eventHistory?.records));
    let brainDiagnosis = Object.freeze({
      attempted: false,
      ok: false,
      reason: upliftPlan?.brainRequest?.required === true
        ? (brainDiagnosisAuthorized ? 'FLYWHEEL_BRAIN_DIAGNOSIS_CYCLE_LIMIT' : 'FLYWHEEL_BRAIN_DIAGNOSIS_NOT_AUTHORIZED')
        : 'FLYWHEEL_BRAIN_DIAGNOSIS_NOT_REQUIRED',
      provider: '',
      model: '',
      fallbackUsed: false,
      outputText: '',
      routeDecision: Object.freeze({ ...(upliftPlan?.brainRequest?.routeDecision || {}) }),
    });
    if (
      brainDiagnosisAuthorized
      && upliftPlan?.brainRequest?.required === true
      && brainDiagnosisAttemptCount < maxBrainDiagnoses
    ) {
      brainDiagnosis = await runBoundedFlywheelBrainDiagnosis({
        event,
        upliftPlan,
        routeBrainDiagnosis,
        brainRouterConfig: input.brainRouterConfig || {},
      });
      brainDiagnosisAttemptCount += 1;
      if (brainDiagnosis.ok) brainDiagnosisSuccessCount += 1;
      else brainDiagnosisFailureCount += 1;
    }
    brainDiagnoses.push(Object.freeze({
      eventId,
      capabilityId,
      ...brainDiagnosis,
    }));

    if (input.canonicalGoalAdmissionAuthorized === true) {
      try {
        const canonical = await admitCanonicalGoal({
          canonicalGoalAdmissionAuthorized: true,
          root: resolved.root,
          repoRoot,
          nowMs,
          nowUtc: now.toISOString(),
          eventId,
          capabilityId,
          evidenceRefs: [
            ...list(event?.proofRefs),
            ...list(event?.closedLoopLearning?.evidenceRefs),
            ...list(event?.learningCandidate?.evidenceRefs),
            ...list(upliftPlan?.scorecard?.evidenceRefs),
          ],
          flywheelImprovementCandidate: upliftPlan?.improvementCandidate || null,
          upliftPlan,
          brainDiagnosis,
          ...(input.canonicalGoalAdmissionOptions || {}),
          allowIssueCreation: createdCanonicalGoalCount < maxCanonicalGoals,
        });
        const issueNumber = Number(canonical?.issue?.number);
        const createdCanonicalIssue = canonical?.created === true;
        if (createdCanonicalIssue) {
          createdCanonicalGoalCount += 1;
          if (Number.isSafeInteger(issueNumber) && issueNumber > 0) {
            createdCanonicalGoalIssueNumbers.push(issueNumber);
          }
        }
        if (canonical?.ok === true && Number.isSafeInteger(issueNumber) && issueNumber > 0) {
          if (!createdCanonicalIssue) {
            dedupedCanonicalGoalCount += 1;
            dedupedCanonicalGoalIssueNumbers.push(issueNumber);
          }
          attachments.push(Object.freeze({
            eventId,
            capabilityId,
            disposition: createdCanonicalIssue
              ? 'CANONICAL_GOAL_CREATED_AND_ADMITTED'
              : 'DEDUPED_CANONICAL_GOAL_ADMITTED',
            ownerGoals: Object.freeze([`#${issueNumber}`]),
            schedulerGoalId: text(canonical?.schedulerGoal?.goalId),
          }));
          continue;
        }
        canonicalGoalAdmissionHeldCount += 1;
        canonicalGoalAdmissionBlockers.push(`${eventId}:${text(canonical?.reason, 'CANONICAL_GOAL_ADMISSION_HELD')}`);
        if (canonical?.retryableHold === true) {
          attachments.push(Object.freeze({
            eventId,
            capabilityId,
            disposition: 'CANONICAL_GOAL_ADMISSION_RETRY_HELD',
            ownerGoals: Object.freeze(
              Number.isSafeInteger(issueNumber) && issueNumber > 0 ? [`#${issueNumber}`] : [],
            ),
          }));
          continue;
        }
        if (createdCanonicalIssue) {
          attachments.push(Object.freeze({
            eventId,
            capabilityId,
            disposition: 'CANONICAL_GOAL_CREATED_SCHEDULER_ADMISSION_HELD',
            ownerGoals: Object.freeze(
              Number.isSafeInteger(issueNumber) && issueNumber > 0 ? [`#${issueNumber}`] : [],
            ),
          }));
          continue;
        }
      } catch (error) {
        canonicalGoalAdmissionHeldCount += 1;
        canonicalGoalAdmissionBlockers.push(`${eventId}:${text(error?.message, 'CANONICAL_GOAL_ADMISSION_FAILED')}`);
      }
    }

    if (createdGoalCandidateIds.length >= maxCandidates) {
      heldCount += 1;
      attachments.push(Object.freeze({
        eventId,
        disposition: 'HELD_CANDIDATE_LIMIT',
      }));
      continue;
    }

    const diagnosisSummary = brainDiagnosis.ok && brainDiagnosis.outputText
      ? ` Bounded brain diagnosis: ${brainDiagnosis.outputText.replace(/\s+/g, ' ').slice(0, 800)}`
      : '';
    const request = {
      title: `Close learned capability gap: ${capabilityId}`,
      intent: `${candidateMarker(eventId)} ${capabilityMarker(capabilityId)} Resolve the evidenced capability gap ${capabilityId} under mission 2670. Reuse any canonical owner before construction and preserve existing authority gates.${diagnosisSummary}`,
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

  // This is the existing controller reconciliation, lock, admission policy and
  // scheduler store. Seed pressure must not become a second work queue.
  try {
    const readSeedFeed = input.readSeedFeed || readSharedWorkspaceDashboardFeed;
    const currentFeed = await readSeedFeed({ root: resolved.root, repoRoot, nowMs });
    const seedFeed = { ...currentFeed, errors: [...list(currentFeed.errors), ...list(eventHistory?.errors)], records: { ...currentFeed.records,
      eventRecords: list(eventHistory?.records) } };
    const pressures = planSeedGrowthWorkV1(deriveFlywheelWorkspaceView(seedFeed, { nowMs }), seedFeed, nowMs);
    for (const pressure of pressures) {
      const { existingGoal, identityConflict, ...seedGrowthWork } = pressure;
      if (identityConflict) {
        seedGrowthAttachments.push({ pressureKey: pressure.pressureKey, disposition: 'SEED_GOAL_IDENTITY_CONFLICT' });
        continue;
      }
      if (existingGoal) {
        seedGrowthAttachments.push({ seedId: pressure.seedId, pressureKey: pressure.pressureKey,
          ownerGoals: [`#${existingGoal.issueNumber}`],
          disposition: seedGrowthGoalCompletedV1(existingGoal)
            ? 'COMPLETION_PROOF_RETURNED_AWAITING_RUNG_EVIDENCE' : 'ATTACHED_EXISTING_CANONICAL_SEED_GOAL' });
        continue;
      }
      if (input.canonicalGoalAdmissionAuthorized !== true) {
        seedGrowthAttachments.push({ seedId: pressure.seedId, pressureKey: pressure.pressureKey,
          disposition: 'SEED_GOAL_PRODUCTION_AUTHORITY_REQUIRED' });
        continue;
      }
      let canonical;
      try {
        canonical = await admitCanonicalGoal({
          ...(input.canonicalGoalAdmissionOptions || {}),
          root: resolved.root, repoRoot, nowMs, nowUtc: now.toISOString(),
          canonicalGoalAdmissionAuthorized: true,
          eventId: pressure.pressureKey, capabilityId: pressure.pressureKey,
          evidenceRefs: pressure.evidenceRefs, seedGrowthWork,
          allowIssueCreation: createdCanonicalGoalCount < maxCanonicalGoals,
        });
      } catch (error) {
        canonical = { ok: false, reason: text(error?.message, 'SEED_GOAL_ADMISSION_FAILED') };
      }
      const number = Number(canonical?.issue?.number);
      if (canonical?.created === true) {
        createdCanonicalGoalCount += 1;
        if (Number.isSafeInteger(number) && number > 0) createdCanonicalGoalIssueNumbers.push(number);
      }
      if (canonical?.ok === true && canonical?.created !== true) {
        dedupedCanonicalGoalCount += 1;
        dedupedCanonicalGoalIssueNumbers.push(number);
      }
      if (canonical?.ok !== true) {
        canonicalGoalAdmissionHeldCount += 1;
        canonicalGoalAdmissionBlockers.push(`${pressure.pressureKey}:${text(canonical?.reason, 'SEED_GOAL_ADMISSION_HELD')}`);
      }
      seedGrowthAttachments.push({ seedId: pressure.seedId, pressureKey: pressure.pressureKey,
        ownerGoals: Number.isSafeInteger(number) && number > 0 ? [`#${number}`] : [],
        schedulerGoalId: text(canonical?.schedulerGoal?.goalId),
        disposition: text(canonical?.reason, 'SEED_GOAL_ADMISSION_HELD') });
    }
  } catch (error) {
    errors.push(`seed-growth:${text(error?.message, 'SEED_GOAL_RECONCILIATION_FAILED')}`);
  }

  return resultBase({
    ok: errors.length === 0,
    reason: errors.length
      ? 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_DEGRADED'
      : 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_COMPLETE',
    observedActionableEventCount: events.length,
    resolvedHistoricalEventCount: eventResolution.resolvedHistoricalEventCount,
    attachedExistingOwnerCount,
    createdCanonicalGoalCount,
    dedupedCanonicalGoalCount,
    canonicalGoalAdmissionHeldCount,
    createdGoalCandidateCount: createdGoalCandidateIds.length,
    dedupedGoalCandidateCount,
    heldCount,
    brainDiagnosisAttemptCount,
    brainDiagnosisSuccessCount,
    brainDiagnosisFailureCount,
    brainDiagnoses: Object.freeze(brainDiagnoses),
    attachments: Object.freeze(attachments),
    seedGrowthAttachments: Object.freeze(seedGrowthAttachments.map((item) => Object.freeze(item))),
    createdCanonicalGoalIssueNumbers: Object.freeze(createdCanonicalGoalIssueNumbers),
    dedupedCanonicalGoalIssueNumbers: Object.freeze(dedupedCanonicalGoalIssueNumbers),
    canonicalGoalAdmissionBlockers: Object.freeze(canonicalGoalAdmissionBlockers),
    createdGoalCandidateIds: Object.freeze(createdGoalCandidateIds),
    dedupedGoalCandidateIds: Object.freeze(dedupedGoalCandidateIds),
    errors: Object.freeze(errors),
    authority: Object.freeze({
      boundedCanonicalGoalAdmissionAllowed: input.canonicalGoalAdmissionAuthorized === true,
      githubIssueCreationAllowed: input.canonicalGoalAdmissionAuthorized === true,
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      dispatchAllowed: false,
      mergeAllowed: false,
      approvalBypassAllowed: false,
    }),
    finalVerdict: errors.length
      ? 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_DEGRADED'
      : 'FLYWHEEL_LEARNING_GOAL_RECONCILIATION_READY',
  });
}
