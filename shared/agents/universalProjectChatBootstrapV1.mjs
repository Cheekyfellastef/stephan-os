import { buildStephanosCapabilityRegistrySummary } from './stephanosCapabilityRegistry.mjs';

export const UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_SCHEMA = 'stephanos.universal-project-chat-bootstrap.v1';
export const UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_OWNER_ISSUE = 1418;
export const UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SHA_40 = /^[0-9a-f]{40}$/i;

export const UNIVERSAL_PROJECT_CHAT_RUNBOOK_ORDER = Object.freeze([
  Object.freeze({
    order: 1,
    path: 'AGENTS.md',
    purpose: 'Repository-wide operating doctrine, risk boundaries, continuity routes and operator communication rules.',
  }),
  Object.freeze({
    order: 2,
    path: 'shared/agents/universalProjectChatBootstrapV1.RUNBOOK.md',
    purpose: 'Mandatory new-chat startup sequence and no-orphan behaviour.',
  }),
  Object.freeze({
    order: 3,
    path: 'docs/operations/chatgpt-shared-workspace-live-status.md',
    purpose: 'Canonical current-head and Shared Workspace truth semantics.',
  }),
  Object.freeze({
    order: 4,
    path: 'docs/shared-agent-workspace-v1-runbook.md',
    purpose: 'Shared Agent Workspace safety and persistence boundaries.',
  }),
]);

export const UNIVERSAL_PROJECT_CHAT_REQUIRED_BEFORE = Object.freeze([
  'CAPABILITY_DENIAL',
  'DECLARE_GLOBAL_BLOCKER',
  'CREATE_GOAL',
  'CREATE_BRANCH',
  'CREATE_PULL_REQUEST',
  'CREATE_CONTROLLER',
  'CREATE_WORKER',
  'CREATE_SCHEDULER',
  'CREATE_MONITOR',
  'SELECT_MUTATION_LANE',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compactWorkspaceRecord(record = null) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  return Object.freeze({
    kind: text(record.kind),
    timestampUtc: text(record.timestampUtc),
    status: text(record.status),
    title: text(record.title),
    summary: text(record.summary),
    proofRefs: Object.freeze(Array.isArray(record.proofRefs) ? record.proofRefs.map(String).slice(0, 12) : []),
  });
}

function compactControllerFleet(fleet = null) {
  if (!fleet || typeof fleet !== 'object' || Array.isArray(fleet)) return null;
  const controllers = Array.isArray(fleet.controllers) ? fleet.controllers.slice(0, 5).map((controller) => Object.freeze({
    controllerId: text(controller?.controllerId),
    title: text(controller?.title),
    freshness: text(controller?.freshness),
    activityState: text(controller?.activityState),
    trafficLight: text(controller?.trafficLight),
    observedEnabled: typeof controller?.observedEnabled === 'boolean' ? controller.observedEnabled : null,
    materialActionsSucceeded: Number.isFinite(Number(controller?.materialActionsSucceeded)) ? Number(controller.materialActionsSucceeded) : 0,
    activeLaneCount: Number.isFinite(Number(controller?.activeLaneCount)) ? Number(controller.activeLaneCount) : 0,
    parkedLaneCount: Number.isFinite(Number(controller?.parkedLaneCount)) ? Number(controller.parkedLaneCount) : 0,
    safeEligibleWorkRemaining: Number.isFinite(Number(controller?.safeEligibleWorkRemaining)) ? Number(controller.safeEligibleWorkRemaining) : 0,
    blocker: text(controller?.blocker),
    lastMaterialActionAtUtc: text(controller?.lastMaterialActionAtUtc),
    runId: text(controller?.runId),
    runStartedAtUtc: text(controller?.runStartedAtUtc),
    runCompletedAtUtc: text(controller?.runCompletedAtUtc),
    sourceStatusId: text(controller?.sourceStatusId),
    sourceParticipantId: text(controller?.sourceParticipantId),
    livenessState: text(controller?.livenessState),
    targetMaterialLanes: Number(controller?.targetMaterialLanes || 0),
    materialLaneCount: Number(controller?.materialLaneCount || 0),
    enablementTransitions: Object.freeze(Array.isArray(controller?.enablementTransitions)
      ? controller.enablementTransitions.slice(-8).map((transition) => Object.freeze({
        observedEnabled: typeof transition?.observedEnabled === 'boolean' ? transition.observedEnabled : null,
        timestampUtc: text(transition?.timestampUtc),
        statusId: text(transition?.statusId),
      })) : []),
    exactNextAction: text(controller?.exactNextAction),
    proofRefs: Object.freeze(Array.isArray(controller?.proofRefs) ? controller.proofRefs.map(String).slice(0, 12) : []),
  })) : [];
  return Object.freeze({
    schemaVersion: text(fleet.schemaVersion),
    expectedControllerCount: Number.isFinite(Number(fleet.expectedControllerCount)) ? Number(fleet.expectedControllerCount) : controllers.length,
    finalVerdict: text(fleet.finalVerdict),
    allCurrent: fleet.allCurrent === true,
    allObservedEnabled: fleet.allObservedEnabled === true,
    counts: Object.freeze({
      building: Number(fleet?.counts?.building || 0),
      amber: Number(fleet?.counts?.amber || 0),
      red: Number(fleet?.counts?.red || 0),
      unknown: Number(fleet?.counts?.unknown || 0),
    }),
    metrics: Object.freeze({
      MATERIAL_ACTIONS_SUCCEEDED: Number(fleet?.metrics?.MATERIAL_ACTIONS_SUCCEEDED || 0),
      ACTIVE_MATERIAL_LANES: Number(fleet?.metrics?.ACTIVE_MATERIAL_LANES || 0),
      TARGET_MATERIAL_LANES: Number(fleet?.metrics?.TARGET_MATERIAL_LANES || 0),
      SAFE_ELIGIBLE_WORK_WAITING_WHILE_CAPACITY_FREE: Number(fleet?.metrics?.SAFE_ELIGIBLE_WORK_WAITING_WHILE_CAPACITY_FREE || 0),
    }),
    controllers: Object.freeze(controllers),
  });
}

function compactCapability(capability = {}) {
  return Object.freeze({
    capabilityId: text(capability.capabilityId),
    category: text(capability.category),
    ownerIssue: Number.isInteger(capability.ownerIssue) ? capability.ownerIssue : null,
    discoveryRoute: text(capability.discoveryRoute),
    requiresOperatorApproval: capability.requiresOperatorApproval === true,
    runtimeMutationAllowed: capability.runtimeMutationAllowed === true,
  });
}

function unique(values) {
  return Object.freeze([...new Set(values.filter(Boolean))]);
}

export function buildUniversalProjectChatBootstrapV1({
  headTruth = {},
  workspaceProjection = {},
  timestampUtc = new Date(0).toISOString(),
} = {}) {
  const githubMainHead = text(headTruth.githubMainHead).toLowerCase();
  const windowsCheckoutHead = text(headTruth.windowsCheckoutHead).toLowerCase();
  const sourceHead = SHA_40.test(githubMainHead) ? githubMainHead : '';
  const registry = buildStephanosCapabilityRegistrySummary({
    sourceHead,
    generatedAtUtc: text(timestampUtc),
  });

  const blockers = [];
  if (!sourceHead) blockers.push('CANONICAL_GITHUB_MAIN_HEAD_UNPROVEN');
  if (!SHA_40.test(windowsCheckoutHead)) blockers.push('WINDOWS_CHECKOUT_HEAD_UNPROVEN');
  if (headTruth.freshness !== 'CURRENT') blockers.push('CANONICAL_SOURCE_HEAD_TRUTH_NOT_CURRENT');
  if (headTruth.sourceHeadsAgree !== true) blockers.push('CANONICAL_SOURCE_HEADS_NOT_CONVERGED');
  if (workspaceProjection?.aggregationOk === false) blockers.push('SHARED_WORKSPACE_AGGREGATION_BLOCKED');
  if (registry.finalVerdict !== 'STEPHANOS_CAPABILITY_REGISTRY_PASS') blockers.push('CAPABILITY_REGISTRY_INVALID');

  const ready = blockers.length === 0;
  return Object.freeze({
    schemaVersion: UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_SCHEMA,
    ownerIssue: UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_OWNER_ISSUE,
    repository: UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_REPOSITORY,
    generatedAtUtc: text(timestampUtc),
    sourceHead,
    windowsCheckoutHead: SHA_40.test(windowsCheckoutHead) ? windowsCheckoutHead : '',
    sourceHeadsAgree: headTruth.sourceHeadsAgree === true,
    ready,
    finalVerdict: ready
      ? 'UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_READY'
      : 'UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_BLOCKED',
    blockers: unique(blockers),
    runbookOrder: UNIVERSAL_PROJECT_CHAT_RUNBOOK_ORDER,
    requiredBefore: UNIVERSAL_PROJECT_CHAT_REQUIRED_BEFORE,
    discovery: Object.freeze({
      currentTruthOperation: 'READ_CURRENT_STATUS',
      capabilityRegistryRoute: 'capability-registry',
      sharedWorkspaceRoute: 'shared-agent-workspace',
      operatorAttentionOperation: 'READ_OPERATOR_ATTENTION',
      activeExecutionLaneRoute: 'shared-workspace:active-execution-lane',
      latestDurableReceiptRoute: 'shared-workspace:latest-receipt',
    }),
    currentState: Object.freeze({
      currentGoal: compactWorkspaceRecord(workspaceProjection?.currentGoal),
      currentStatus: compactWorkspaceRecord(workspaceProjection?.currentStatus),
      latestProof: compactWorkspaceRecord(workspaceProjection?.latestProof),
      controllerFleet: compactControllerFleet(workspaceProjection?.controllerFleet),
      workspaceAggregationOk: workspaceProjection?.aggregationOk !== false,
      workspaceAggregationReason: text(workspaceProjection?.aggregationReason),
    }),
    capabilityRegistry: Object.freeze({
      schemaVersion: registry.schemaVersion,
      registryVersion: registry.registryVersion,
      sourceHead: registry.sourceHead,
      capabilityCount: registry.capabilityCount,
      finalVerdict: registry.finalVerdict,
      capabilities: Object.freeze((registry.capabilities || []).map(compactCapability)),
    }),
    operatingRules: Object.freeze({
      chatLocalMemoryIsSystemOfRecord: false,
      denyCapabilityBeforeDiscoveryAllowed: false,
      createDuplicateLaneBeforeDiscoveryAllowed: false,
      duplicateActiveExecutionAllowed: false,
      rebuildVerifiedWorkAfterRouteFailure: false,
      continueFromNewestDurableReceipt: true,
      exactCurrentMainRequiredForMutationPlanning: true,
      standingApprovalMustBeReadNotInferred: true,
      activeExecutionLaneMustBeReadNotGuessed: true,
      alternateQualifiedRouteMustBeTriedBeforeGlobalBlocker: true,
      operatorApprovalMayBeInferred: false,
    }),
  });
}
