import {
  STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION,
  reconcileStephanosResearchEvidenceV1,
} from './stephanosResearchCouncilV1.mjs';

export const STEPHANOS_RESEARCH_EXECUTION_HANDOFF_SCHEMA_VERSION = 'stephanos.research-execution-handoff.v1';
export const STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION = 'stephanos.research-execution-return.v1';

export const STEPHANOS_RESEARCH_EXECUTION_STATES = Object.freeze({
  NO_EXECUTION_REQUIRED: 'NO_EXECUTION_REQUIRED',
  READY_FOR_EXISTING_SCHEDULER: 'READY_FOR_EXISTING_SCHEDULER',
  WAITING_FOR_QUALIFIED_ROUTE: 'WAITING_FOR_QUALIFIED_ROUTE',
  BLOCKED_UNSAFE_OR_UNKNOWN: 'BLOCKED_UNSAFE_OR_UNKNOWN',
});

export const STEPHANOS_RESEARCH_EXECUTION_TASK_TYPES = Object.freeze({
  DIRECT: 'RESEARCH_DIRECT',
  SPECIALIST: 'RESEARCH_SPECIALIST',
  COUNCIL: 'RESEARCH_COUNCIL',
});

export const STEPHANOS_RESEARCH_EXISTING_SCHEDULER_ROUTES = Object.freeze([
  'CHATGPT_GITHUB',
  'OPENCLAW_LOCAL',
  'BATTLE_BRIDGE_FIXED_TEST',
  'REMOTE_CODEX',
]);

const EXECUTABLE_RESEARCH_ROUTES = new Set([
  'DIRECT_BOUNDED_RESEARCH',
  'SINGLE_SPECIALIST_RESEARCH',
  'MULTI_AGENT_RESEARCH_COUNCIL',
]);
const EXISTING_SCHEDULER_ROUTES = new Set(STEPHANOS_RESEARCH_EXISTING_SCHEDULER_ROUTES);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function plainObject(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return null;
    }
    return value;
  } catch {
    return null;
  }
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const output = String(value).trim();
  return output || fallback;
}

function id(value, fallback = '') {
  const output = text(value);
  return SAFE_ID.test(output) ? output : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== null && entry !== undefined) : [];
}

function freezeList(values) {
  return Object.freeze([...values]);
}

function authorityBoundary() {
  return Object.freeze({
    dispatchPerformed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    runtimeMutationAllowed: false,
    openClawMutationAllowed: false,
    arbitraryShellAllowed: false,
    credentialOrAccountChangeAllowed: false,
    spendingAllowed: false,
    knowledgeAutoPromotionAllowed: false,
    finalSynthesisOwner: 'stephanos',
    existingSchedulerOwnsExecution: true,
  });
}

function invalidHandoff(reason, mission = null) {
  return Object.freeze({
    schemaVersion: STEPHANOS_RESEARCH_EXECUTION_HANDOFF_SCHEMA_VERSION,
    valid: false,
    state: STEPHANOS_RESEARCH_EXECUTION_STATES.BLOCKED_UNSAFE_OR_UNKNOWN,
    reason,
    researchMissionId: mission?.researchMissionId || null,
    missionFingerprint: mission?.missionFingerprint || null,
    schedulerRoute: null,
    requestedTaskType: null,
    executionCapabilityRefs: freezeList([]),
    authority: authorityBoundary(),
  });
}

function taskTypeForResearchRoute(route) {
  if (route === 'DIRECT_BOUNDED_RESEARCH') return STEPHANOS_RESEARCH_EXECUTION_TASK_TYPES.DIRECT;
  if (route === 'SINGLE_SPECIALIST_RESEARCH') return STEPHANOS_RESEARCH_EXECUTION_TASK_TYPES.SPECIALIST;
  if (route === 'MULTI_AGENT_RESEARCH_COUNCIL') return STEPHANOS_RESEARCH_EXECUTION_TASK_TYPES.COUNCIL;
  return null;
}

function normalizeCapabilities(input) {
  return list(input).map((candidate) => {
    const item = plainObject(candidate);
    if (!item) return null;
    const capabilityRef = id(item.capabilityRef);
    const schedulerRoute = text(item.schedulerRoute).toUpperCase();
    const taskTypes = list(item.taskTypes).map((entry) => text(entry).toUpperCase()).filter(Boolean);
    if (!capabilityRef || !EXISTING_SCHEDULER_ROUTES.has(schedulerRoute)) return null;
    return Object.freeze({
      capabilityRef,
      schedulerRoute,
      taskTypes: freezeList(taskTypes),
      qualified: item.qualified === true,
      available: item.available !== false,
      providerNeutral: item.providerNeutral !== false,
      providerId: id(item.providerId),
      researcherId: id(item.researcherId),
      role: text(item.role).toUpperCase(),
    });
  }).filter(Boolean);
}

function selectCapability(capabilities, taskType, researcher = null) {
  const eligible = capabilities.filter((entry) => (
    entry.qualified
    && entry.available
    && entry.providerNeutral
    && entry.taskTypes.includes(taskType)
  ));
  if (!researcher) return eligible[0] || null;
  return eligible.find((entry) => (
    (entry.researcherId && entry.researcherId === researcher.researcherId)
    || (entry.providerId && entry.providerId === researcher.providerId && (!entry.role || entry.role === researcher.role))
  )) || null;
}

export function createStephanosResearchExecutionHandoffV1(input = {}) {
  try {
    const request = plainObject(input);
    const mission = plainObject(request?.mission);
    if (!request || !mission || mission.schemaVersion !== STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION) {
      return invalidHandoff('research-mission-invalid', mission);
    }
    const researchMissionId = id(mission.researchMissionId);
    const missionFingerprint = text(mission.missionFingerprint);
    const researchRoute = text(mission.researchRoute).toUpperCase();
    if (!researchMissionId || !missionFingerprint || !researchRoute) {
      return invalidHandoff('research-mission-identity-incomplete', mission);
    }

    if (researchRoute === 'ANSWER_FROM_CANONICAL_KNOWLEDGE') {
      return Object.freeze({
        schemaVersion: STEPHANOS_RESEARCH_EXECUTION_HANDOFF_SCHEMA_VERSION,
        valid: true,
        state: STEPHANOS_RESEARCH_EXECUTION_STATES.NO_EXECUTION_REQUIRED,
        reason: 'canonical-knowledge-route-needs-no-external-execution',
        researchMissionId,
        missionFingerprint,
        parentIntentId: id(mission.parentIntentId, 'operator-intent'),
        researchRoute,
        requestedTaskType: null,
        schedulerRoute: null,
        executionCapabilityRefs: freezeList([]),
        resultContract: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
        returnTo: 'reconcileStephanosResearchEvidenceV1',
        authority: authorityBoundary(),
      });
    }

    if (!EXECUTABLE_RESEARCH_ROUTES.has(researchRoute)) {
      return invalidHandoff('research-route-not-executable-through-research-fabric', mission);
    }

    const taskType = taskTypeForResearchRoute(researchRoute);
    const capabilities = normalizeCapabilities(request.executionCapabilities);
    const researchers = list(mission.researchers).map((entry) => plainObject(entry)).filter(Boolean);
    const selected = [];

    if (researchRoute === 'DIRECT_BOUNDED_RESEARCH') {
      const capability = selectCapability(capabilities, taskType);
      if (capability) selected.push(capability);
    } else {
      if (researchers.length === 0) return invalidHandoff('research-route-requires-researcher-identity', mission);
      for (const researcher of researchers) {
        const capability = selectCapability(capabilities, taskType, researcher);
        if (!capability) {
          return Object.freeze({
            ...invalidHandoff('qualified-research-execution-capability-unavailable', mission),
            valid: true,
            state: STEPHANOS_RESEARCH_EXECUTION_STATES.WAITING_FOR_QUALIFIED_ROUTE,
            missingResearcherId: id(researcher.researcherId),
          });
        }
        selected.push(capability);
      }
    }

    if (selected.length === 0) {
      return Object.freeze({
        ...invalidHandoff('qualified-research-execution-capability-unavailable', mission),
        valid: true,
        state: STEPHANOS_RESEARCH_EXECUTION_STATES.WAITING_FOR_QUALIFIED_ROUTE,
      });
    }

    const schedulerRoutes = [...new Set(selected.map((entry) => entry.schedulerRoute))];
    const schedulerRoute = schedulerRoutes.length === 1 ? schedulerRoutes[0] : 'CHATGPT_GITHUB';
    const executionCapabilityRefs = selected.map((entry) => entry.capabilityRef);

    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_EXECUTION_HANDOFF_SCHEMA_VERSION,
      valid: true,
      state: STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER,
      reason: 'research-mission-bound-to-qualified-existing-execution-capability',
      researchMissionId,
      missionFingerprint,
      parentIntentId: id(mission.parentIntentId, 'operator-intent'),
      researchRoute,
      requestedTaskType: taskType,
      schedulerRoute,
      schedulerOwnerGoal: '#1556',
      researchFoundationGoals: freezeList(['#1596', '#1597', '#1902']),
      executionCapabilityRefs: freezeList(executionCapabilityRefs),
      providerSubstitutionAllowed: true,
      missionIdentityMustRemainExact: true,
      resultContract: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
      returnTo: 'reconcileStephanosResearchEvidenceV1',
      forbiddenActions: freezeList(list(mission.forbiddenActions).map((entry) => text(entry)).filter(Boolean)),
      authority: authorityBoundary(),
    });
  } catch {
    return invalidHandoff('research-execution-handoff-failed-closed');
  }
}

function executionReturnViolatesAuthority(item) {
  return item.sourceMutated === true
    || item.mergePerformed === true
    || item.deploymentPerformed === true
    || item.runtimeMutated === true
    || item.openClawMutated === true
    || item.arbitraryShellUsed === true
    || item.credentialOrAccountChanged === true
    || item.spendingPerformed === true
    || item.knowledgeAutoPromoted === true;
}

export function reconcileStephanosResearchExecutionReturnV1(input = {}) {
  try {
    const request = plainObject(input);
    const mission = plainObject(request?.mission);
    const handoff = plainObject(request?.handoff);
    const executionReturn = plainObject(request?.executionReturn);
    if (!request || !mission || !handoff || !executionReturn) return null;
    if (mission.schemaVersion !== STEPHANOS_RESEARCH_MISSION_SCHEMA_VERSION) return null;
    if (handoff.schemaVersion !== STEPHANOS_RESEARCH_EXECUTION_HANDOFF_SCHEMA_VERSION) return null;
    if (handoff.valid !== true || handoff.state !== STEPHANOS_RESEARCH_EXECUTION_STATES.READY_FOR_EXISTING_SCHEDULER) return null;
    if (executionReturn.schemaVersion !== STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION) return null;
    if (executionReturnViolatesAuthority(executionReturn)) return null;

    const missionId = id(mission.researchMissionId);
    const missionFingerprint = text(mission.missionFingerprint);
    if (!missionId || !missionFingerprint) return null;
    if (id(handoff.researchMissionId) !== missionId || text(handoff.missionFingerprint) !== missionFingerprint) return null;
    if (id(executionReturn.researchMissionId) !== missionId) return null;
    if (text(executionReturn.missionFingerprint) !== missionFingerprint) return null;
    if (text(executionReturn.researchRoute).toUpperCase() !== text(mission.researchRoute).toUpperCase()) return null;
    const executionRoute = text(executionReturn.schedulerRoute).toUpperCase();
    if (!EXISTING_SCHEDULER_ROUTES.has(executionRoute) || executionRoute !== handoff.schedulerRoute) return null;
    if (text(executionReturn.state).toUpperCase() !== 'COMPLETED') return null;

    const results = list(executionReturn.researchResults).map((entry) => plainObject(entry)).filter(Boolean);
    if (results.length === 0) return null;

    const packet = reconcileStephanosResearchEvidenceV1({
      mission,
      results,
      canonicalFacts: request.canonicalFacts,
      licenceAndReuseNotes: request.licenceAndReuseNotes,
      confidenceBasis: request.confidenceBasis,
      stephanosSynthesis: request.stephanosSynthesis,
      implicationsForStephanos: request.implicationsForStephanos,
      candidateMethodUpdates: request.candidateMethodUpdates,
      candidateCapabilityGaps: request.candidateCapabilityGaps,
      recommendedNextAction: request.recommendedNextAction,
      whatChangedMyView: request.whatChangedMyView,
    });
    if (!packet || packet.researchMissionId !== missionId) return null;

    return Object.freeze({
      schemaVersion: STEPHANOS_RESEARCH_EXECUTION_RETURN_SCHEMA_VERSION,
      accepted: true,
      researchMissionId: missionId,
      missionFingerprint,
      executionRoute,
      providerSubstitutionUsed: executionReturn.providerSubstitutionUsed === true,
      evidencePacket: packet,
      authority: authorityBoundary(),
    });
  } catch {
    return null;
  }
}
