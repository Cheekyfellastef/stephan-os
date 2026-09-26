import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
  createAgentCapabilityRecord,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';
import {
  CAPABILITY_PATH,
  GOAL_BUILDING_AGENT_CLASS,
  GOAL_BUILDING_AGENT_ID,
  GOAL_BUILDING_AGENT_KNOWLEDGE_DOMAINS,
  GOAL_BUILDING_AGENT_QA_CAPABILITY,
  GOAL_BUILDING_AGENT_RELATED_ISSUE,
  GOAL_BUILDING_AGENT_SCHEMA_VERSION,
  GOAL_BUILDING_AGENT_TASK_TYPES,
  GOAL_BUILDING_OPERATING_STATES,
  MAX_STATUS_ITEMS,
  PRODUCTIVE_MISSION_PHASES,
  boundedText,
  capabilityShapeBlockers,
  clock,
  list,
  safeId,
  sameStringSet,
  text,
  timestampVerdict,
  unique,
} from './goalBuildingAgentV1.contract.mjs';
import { evaluateGoalBuildingProgramme } from './goalBuildingAgentV1.evaluator.mjs';
import {
  GOAL_BUILDING_RUNTIME_STATES,
  projectGoalBuildingRuntimeTruth,
} from './goalBuildingAgentV1.observation.mjs';

export function createGoalBuildingAgentCapabilityRecord(input = {}) {
  const base = createAgentCapabilityRecord({
    agentId: GOAL_BUILDING_AGENT_ID,
    timestampUtc: text(input.timestampUtc, new Date().toISOString()),
    mode: 'read_first',
    boundedWritePath: CAPABILITY_PATH,
    trustedBuilder: false,
    proofRefs: list(input.proofRefs).map(String),
  });
  return Object.freeze({
    ...base,
    participantSchemaVersion: GOAL_BUILDING_AGENT_SCHEMA_VERSION,
    agentClass: GOAL_BUILDING_AGENT_CLASS,
    qaCapability: GOAL_BUILDING_AGENT_QA_CAPABILITY,
    knowledgeDomains: GOAL_BUILDING_AGENT_KNOWLEDGE_DOMAINS,
    acceptedTaskTypes: GOAL_BUILDING_AGENT_TASK_TYPES,
    lifecycleState: 'READ_ONLY_CANDIDATE',
    mutationAuthority: 'NONE_BY_PARTICIPATION',
    implementationAuthority: 'GOVERNED_TASK_CONTRACT_REQUIRED',
    mergeAuthority: false,
    deploymentAuthority: false,
    arbitraryShellAllowed: false,
    leaseSeizureAllowed: false,
    selfPromotionAllowed: false,
  });
}

export function buildGoalBuildingAgentReadiness(input = {}) {
  const capability = input.capability || createGoalBuildingAgentCapabilityRecord(input);
  const validationOptions = input.validationOptions || {};
  const validation = validateSharedWorkspaceRecord(capability, validationOptions);
  const blockers = [...capabilityShapeBlockers(capability)];
  const capabilityTimestamp = timestampVerdict(capability?.timestampUtc, {
    ...clock(validationOptions),
    maxAgeMs: Number.POSITIVE_INFINITY,
  });
  if (!validation.valid) blockers.push(`capability-invalid:${validation.refusalReason || 'unknown'}`);
  if (validation.stale) blockers.push('capability-stale');
  if (capabilityTimestamp === 'INVALID') blockers.push('capability-timestamp-invalid');
  if (capabilityTimestamp === 'FUTURE') blockers.push('capability-future-dated');
  if (capability.agentId !== GOAL_BUILDING_AGENT_ID) blockers.push('participant-id-mismatch');
  if (capability.participantSchemaVersion !== GOAL_BUILDING_AGENT_SCHEMA_VERSION) blockers.push('participant-schema-version-mismatch');
  if (capability.agentClass !== GOAL_BUILDING_AGENT_CLASS) blockers.push('agent-class-mismatch');
  if (capability.qaCapability !== GOAL_BUILDING_AGENT_QA_CAPABILITY) blockers.push('qa-capability-missing');
  if (!sameStringSet(capability.knowledgeDomains, GOAL_BUILDING_AGENT_KNOWLEDGE_DOMAINS)) blockers.push('knowledge-domains-mismatch');
  if (!sameStringSet(capability.acceptedTaskTypes, GOAL_BUILDING_AGENT_TASK_TYPES)) blockers.push('task-types-mismatch');
  if (capability.lifecycleState !== 'READ_ONLY_CANDIDATE') blockers.push('lifecycle-state-widened');
  if (capability.mode !== 'read_first') blockers.push('mode-widened');
  if (capability.boundedWritePath !== CAPABILITY_PATH) blockers.push('bounded-write-path-mismatch');
  if (capability.trustedBuilder !== false) blockers.push('trusted-builder-widened');
  if (capability.mutationAuthority !== 'NONE_BY_PARTICIPATION') blockers.push('mutation-authority-widened');
  if (capability.implementationAuthority !== 'GOVERNED_TASK_CONTRACT_REQUIRED') blockers.push('implementation-authority-widened');
  if (capability.mergeAuthority !== false) blockers.push('merge-authority-widened');
  if (capability.deploymentAuthority !== false) blockers.push('deployment-authority-widened');
  if (capability.arbitraryShellAllowed !== false) blockers.push('arbitrary-shell-widened');
  if (capability.leaseSeizureAllowed !== false) blockers.push('lease-seizure-widened');
  if (capability.selfPromotionAllowed !== false) blockers.push('self-promotion-widened');
  if (list(capability.proofRefs).length === 0) blockers.push('participant-proof-required');
  return Object.freeze({
    schemaVersion: GOAL_BUILDING_AGENT_SCHEMA_VERSION,
    participantId: GOAL_BUILDING_AGENT_ID,
    readyForSharedWorkspaceRegistration: blockers.length === 0,
    productionEligible: false,
    implementationEligible: false,
    blockers: Object.freeze(unique(blockers)),
    nextMilestone: blockers.length === 0
      ? 'M2_WIRE_CANONICAL_PROGRAMME_OBSERVATION_AND_STATUS_PROJECTION'
      : 'M1_REPAIR_GOAL_BUILDING_AGENT_PARTICIPANT_CONTRACT',
  });
}

function runtimeTruthFor(input, certificate) {
  if (input.runtimeTruth && typeof input.runtimeTruth === 'object') return input.runtimeTruth;
  if (!input.workerBeacon && !input.missionWorkerBeacon) return null;
  return projectGoalBuildingRuntimeTruth({ ...input, certificate });
}

function runtimeBuildingAnswer(runtimeTruth, certificate) {
  if (runtimeTruth.state === GOAL_BUILDING_RUNTIME_STATES.BUILDING) {
    const identity = runtimeTruth.currentGoalId || runtimeTruth.currentMissionId || runtimeTruth.workerTaskId || 'current goal';
    const movement = runtimeTruth.secondsSinceMeaningfulMovement === null
      ? 'meaningful movement is current'
      : `last meaningful movement was ${runtimeTruth.secondsSinceMeaningfulMovement}s ago`;
    return `Yes. BUILDING is physically proven for ${identity} at ${runtimeTruth.currentPhase || 'active execution'}; ${movement}.`;
  }
  if (runtimeTruth.state === GOAL_BUILDING_RUNTIME_STATES.ALIVE_BUT_STALLED) {
    const age = runtimeTruth.secondsSinceMeaningfulMovement === null
      ? 'meaningful movement is unproven'
      : `no meaningful movement for ${runtimeTruth.secondsSinceMeaningfulMovement}s`;
    return `No. The Mission Worker is alive but stalled: ${age}. ${runtimeTruth.stallReason || runtimeTruth.blocker || certificate.summary}`;
  }
  if (runtimeTruth.state === GOAL_BUILDING_RUNTIME_STATES.BLOCKED) {
    return `No. Goal building is BLOCKED: ${runtimeTruth.blocker || certificate.summary}`;
  }
  if (runtimeTruth.state === GOAL_BUILDING_RUNTIME_STATES.IDLE) {
    return 'No build is active. The exact-current worker is healthy and truthfully IDLE with no eligible work proven.';
  }
  return `No. Active goal building is UNKNOWN rather than proven. ${runtimeTruth.blocker || certificate.summary}`;
}

export function answerGoalBuildingQuestion(input = {}) {
  const certificate = input.certificate || evaluateGoalBuildingProgramme(input);
  const runtimeTruth = runtimeTruthFor(input, certificate);
  const question = boundedText(input.question, '', 300).toLowerCase();
  let questionKind = 'PROGRAMME_STATUS';
  let answer = certificate.summary;
  if (/actually building|building now|is stephanos building|what.*building/.test(question)) {
    questionKind = 'ACTIVE_BUILD_TRUTH';
    if (runtimeTruth) {
      answer = runtimeBuildingAnswer(runtimeTruth, certificate);
    } else {
      answer = certificate.isActuallyBuilding
        ? `Yes. Durable progress is proven for ${certificate.productiveMissionCount} active mission(s): ${certificate.activeMissions.filter((mission) => PRODUCTIVE_MISSION_PHASES.has(mission.phase)).slice(0, 5).map((mission) => `${mission.goalId} at ${mission.phase}`).join('; ')}.`
        : `No. Active goal-building progress is not currently proven. ${certificate.summary}`;
    }
  } else if (/who.*own|owner|who.*fix/.test(question)) {
    questionKind = 'BLOCKER_OWNERSHIP';
    answer = certificate.blockers.length > 0
      ? `Blocker ownership: ${certificate.blockers.slice(0, MAX_STATUS_ITEMS).map((blocker) => `${blocker.blockerId} -> ${blocker.ownerId || 'UNOWNED'} via ${blocker.route || 'UNROUTED'}`).join('; ')}.`
      : 'No owned blocker is currently recorded.';
  } else if (/block|slow|stuck|stall/.test(question)) {
    questionKind = 'BLOCKER_STATUS';
    if (runtimeTruth?.stalled) {
      answer = `The Mission Worker is alive but stalled: ${runtimeTruth.stallReason || runtimeTruth.blocker || 'meaningful movement is not recent'}.`;
    } else {
      const reasons = [...certificate.blockingReasons, ...certificate.degradedReasons].slice(0, MAX_STATUS_ITEMS);
      answer = reasons.length > 0 ? `Current programme-health defects: ${reasons.join('; ')}.` : 'No programme-health blocker is currently recorded.';
    }
  } else if (/need me|operator|approval/.test(question)) {
    questionKind = 'OPERATOR_ACTION';
    answer = certificate.operatorActionRequired
      ? `Yes. Exact operator action required: ${certificate.operatorActionTarget}`
      : 'No operator action is currently required.';
  } else if (/100 percent|100%|why.*not.*full|full capacity/.test(question)) {
    questionKind = 'FULL_OPERATION_STATUS';
    answer = certificate.state === GOAL_BUILDING_OPERATING_STATES.FULLY_OPERATIONAL
      ? 'Stephanos programme operations are proven at 100 percent under the evidence-backed operating definition.'
      : `Stephanos is not at 100 percent. Evidence: ${[...certificate.evidenceProblems, ...certificate.blockingReasons, ...certificate.degradedReasons].slice(0, MAX_STATUS_ITEMS).join('; ') || 'active progress is not proven'}.`;
  } else if (/next|what happens/.test(question)) {
    questionKind = 'NEXT_ACTION';
    answer = runtimeTruth?.nextAutomaticAction || certificate.nextAction;
  }
  return Object.freeze({
    schemaVersion: GOAL_BUILDING_AGENT_SCHEMA_VERSION,
    participantId: GOAL_BUILDING_AGENT_ID,
    questionKind,
    answer: boundedText(answer, 'Programme status unavailable.', 1200),
    state: certificate.state,
    isCapableOfBuilding: certificate.isCapableOfBuilding,
    isActuallyBuilding: runtimeTruth ? runtimeTruth.buildingProven : certificate.isActuallyBuilding,
    runtimeTruthState: runtimeTruth?.state || '',
    secondsSinceMeaningfulMovement: runtimeTruth?.secondsSinceMeaningfulMovement ?? null,
    evidenceHead: certificate.expectedHead,
    evaluatedAtUtc: certificate.evaluatedAtUtc,
  });
}

function statusBody(certificate, runtimeTruth = null) {
  const body = {
    state: certificate.state,
    isCapableOfBuilding: certificate.isCapableOfBuilding,
    isActuallyBuilding: runtimeTruth ? runtimeTruth.buildingProven : certificate.isActuallyBuilding,
    programmeMode: certificate.programmeMode,
    expectedHead: certificate.expectedHead,
    activeMissionCount: certificate.activeMissionCount,
    productiveMissionCount: certificate.productiveMissionCount,
    waitingMissionCount: certificate.waitingMissionCount,
    stalledMissionCount: certificate.stalledMissionCount,
    eligibleQueuedGoalCount: certificate.eligibleQueuedGoalCount,
    qualifiedCapacity: certificate.qualifiedCapacity,
    idleQualifiedCapacity: certificate.idleQualifiedCapacity,
    activeMissions: certificate.activeMissions.slice(0, MAX_STATUS_ITEMS).map((mission) => ({
      missionId: mission.missionId,
      goalId: mission.goalId,
      laneId: mission.laneId,
      ownerId: mission.ownerId,
      phase: mission.phase,
      lastProgressAtUtc: mission.lastProgressAtUtc,
      nextAction: mission.nextAction,
    })),
    blockers: certificate.blockers.slice(0, MAX_STATUS_ITEMS).map((blocker) => ({
      blockerId: blocker.blockerId,
      severity: blocker.severity,
      ownerId: blocker.ownerId,
      route: blocker.route,
      missionId: blocker.missionId,
      goalId: blocker.goalId,
      nextAction: blocker.nextAction,
    })),
    evidenceProblems: certificate.evidenceProblems.slice(0, MAX_STATUS_ITEMS),
    blockingReasons: certificate.blockingReasons.slice(0, MAX_STATUS_ITEMS),
    degradedReasons: certificate.degradedReasons.slice(0, MAX_STATUS_ITEMS),
    operatorActionRequired: certificate.operatorActionRequired,
    operatorActionTarget: certificate.operatorActionTarget,
    nextAction: runtimeTruth?.nextAutomaticAction || certificate.nextAction,
    safetyLocks: certificate.safetyLocks,
  };
  if (runtimeTruth) body.runtimeTruth = runtimeTruth;
  return JSON.stringify(body);
}

export function createGoalBuildingAgentParticipantStatusRecord(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const proofRefs = list(input.proofRefs).map(String);
  const certificate = input.certificate || evaluateGoalBuildingProgramme(input);
  const runtimeTruth = runtimeTruthFor(input, certificate);
  const record = Object.freeze({
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.PARTICIPANT_STATUS,
    participantStatusId: safeId(input.participantStatusId, 'goal-building-agent-status-v1'),
    participantId: GOAL_BUILDING_AGENT_ID,
    timestampUtc,
    correlationId: safeId(input.correlationId, 'goal-building-agent-v1'),
    relatedIssue: GOAL_BUILDING_AGENT_RELATED_ISSUE,
    status: certificate.state,
    summary: runtimeTruth ? runtimeBuildingAnswer(runtimeTruth, certificate) : certificate.summary,
    body: statusBody(certificate, runtimeTruth),
    proofRefs,
  });
  const validation = validateSharedWorkspaceRecord(record, input.validationOptions || {});
  if (validation.valid && !validation.stale && proofRefs.length > 0) return record;
  return Object.freeze({
    ...record,
    status: GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD,
    summary: proofRefs.length === 0
      ? 'Goal Building Agent status publication is blocked because caller-supplied proof references are missing.'
      : 'Goal Building Agent status publication is blocked because the Shared Workspace record is invalid or stale.',
    body: JSON.stringify({
      state: GOAL_BUILDING_OPERATING_STATES.SAFE_HOLD,
      publicationBlocker: proofRefs.length === 0 ? 'participant-proof-required' : (validation.refusalReason || 'status-record-stale'),
      safetyLocks: certificate.safetyLocks,
    }),
  });
}

export function createGoalBuildingAgentWorkspaceRecords(input = {}) {
  const timestampUtc = text(input.timestampUtc, new Date().toISOString());
  const proofRefs = list(input.proofRefs).map(String);
  const capability = createGoalBuildingAgentCapabilityRecord({ ...input, timestampUtc, proofRefs });
  const readiness = buildGoalBuildingAgentReadiness({ ...input, capability });
  const certificate = input.certificate || evaluateGoalBuildingProgramme(input);
  const runtimeTruth = runtimeTruthFor(input, certificate);
  const status = createGoalBuildingAgentParticipantStatusRecord({ ...input, timestampUtc, proofRefs, certificate, runtimeTruth });
  return Object.freeze({
    schemaVersion: GOAL_BUILDING_AGENT_SCHEMA_VERSION,
    capability,
    readiness,
    certificate,
    runtimeTruth,
    status,
    validations: Object.freeze({
      capability: validateSharedWorkspaceRecord(capability, input.validationOptions || {}),
      status: validateSharedWorkspaceRecord(status, input.validationOptions || {}),
    }),
  });
}
