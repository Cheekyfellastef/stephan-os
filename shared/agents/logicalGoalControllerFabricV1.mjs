import { CANONICAL_CONTROLLER_FLEET } from './controllerFleetTelemetryV1.mjs';

export const LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA = 'stephanos.logical-goal-controller-fabric.v1';
export const LOGICAL_GOAL_CONTROLLER_SCHEMA = 'stephanos.logical-goal-controller.v1';
export const LOGICAL_GOAL_CONTROLLER_FABRIC_FILE = 'logical-goal-controller-fabric-current.json';

const TERMINAL_LIFECYCLES = new Set([
  'DUPLICATE',
  'SUPERSEDED',
  'CANCELLED',
  'CLOSED',
  'MERGED',
]);

const PARKED_LIFECYCLES = new Set([
  'BLOCKED',
  'STALLED',
  'WAITING_FOR_DEPENDENCY',
  'WAITING_FOR_EXTERNAL_CONDITION',
  'APPROVAL_REQUIRED',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function issueNumber(value) {
  const normalized = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stableHost(issue, fleet) {
  return fleet[issue % fleet.length];
}

function continuityState(lifecycle) {
  if (TERMINAL_LIFECYCLES.has(lifecycle)) return 'RETIRED';
  if (lifecycle === 'ACTIVE') return 'ACTIVE';
  if (PARKED_LIFECYCLES.has(lifecycle)) return 'PARKED';
  return 'TRACKING';
}

function freezeController(value) {
  return Object.freeze({
    ...value,
    resourceIds: Object.freeze([...value.resourceIds]),
  });
}

export function buildLogicalGoalControllerMonitorProposals(fabric = {}, options = {}) {
  if (fabric?.schemaVersion !== LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA || fabric?.valid !== true) return Object.freeze([]);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const nextDueUtc = new Date(nowMs).toISOString();
  return Object.freeze(list(fabric.controllers)
    .filter((controller) => controller?.schemaVersion === LOGICAL_GOAL_CONTROLLER_SCHEMA)
    .filter((controller) => controller?.retired !== true)
    .map((controller) => {
      const issue = issueNumber(controller.goalIssueNumber);
      const monitorId = text(controller.logicalControllerId);
      if (!issue || monitorId !== `logical-goal-${issue}`) return null;
      const topic = text(controller.goalTitle, `Goal #${issue}`).slice(0, 220);
      return Object.freeze({
        schemaVersion: 'stephanos.monitor-admission-proposal.v1',
        monitorId,
        idempotencyKey: `logical-${monitorId}`,
        handlerType: 'SCHEDULED_SUMMARY',
        boundedSubject: Object.freeze({
          topic,
          scope: `controller:${monitorId}`,
        }),
        schedule: Object.freeze({
          intervalMs: 60_000,
          nextDueUtc,
        }),
        mode: 'RECURRING',
        notificationPolicy: 'STATE_CHANGE',
        relatedIssueOrGoal: `#${issue}`,
        enabled: true,
        proofRefs: Object.freeze(['proof/logical-goal-controller-fabric.json']),
      });
    })
    .filter(Boolean));
}

export function projectLogicalGoalControllerFabric(input = {}) {
  const scheduler = input.scheduler;
  const observedAtUtc = text(input.observedAtUtc);
  const repository = text(input.repository, 'Cheekyfellastef/stephan-os');
  const fleet = list(input.physicalControllers).length
    ? input.physicalControllers
    : CANONICAL_CONTROLLER_FLEET;
  const blockers = [];

  if (scheduler?.schemaVersion !== 'stephanos.mission-scheduler.v1') {
    blockers.push('MISSION_SCHEDULER_SCHEMA_INVALID_OR_MISSING');
  }
  if (!Array.isArray(scheduler?.portfolio)) blockers.push('MISSION_SCHEDULER_PORTFOLIO_INVALID_OR_MISSING');
  if (!fleet.length || fleet.some((item) => !text(item?.controllerId) || !text(item?.title))) {
    blockers.push('PHYSICAL_CONTROLLER_FLEET_INVALID_OR_MISSING');
  }

  const selectedIssues = new Set([
    issueNumber(scheduler?.decisionReceipt?.selectedIssue),
    ...list(scheduler?.decisionReceipt?.selectedIssues).map(issueNumber),
  ].filter(Boolean));

  const controllers = [];
  const seenIssues = new Set();
  if (!blockers.length) {
    for (const row of scheduler.portfolio) {
      const issue = issueNumber(row?.issue);
      if (!issue) {
        blockers.push('LOGICAL_CONTROLLER_GOAL_IDENTITY_INVALID');
        continue;
      }
      if (seenIssues.has(issue)) {
        blockers.push(`LOGICAL_CONTROLLER_GOAL_IDENTITY_DUPLICATE:#${issue}`);
        continue;
      }
      seenIssues.add(issue);

      const host = stableHost(issue, fleet);
      const lifecycle = text(row?.lifecycle, 'UNKNOWN').toUpperCase();
      const state = continuityState(lifecycle);
      controllers.push(freezeController({
        schemaVersion: LOGICAL_GOAL_CONTROLLER_SCHEMA,
        logicalControllerId: `logical-goal-${issue}`,
        repository,
        goalIssueNumber: issue,
        goalRef: `#${issue}`,
        goalTitle: text(row?.title, `Goal #${issue}`),
        lifecycle,
        route: text(row?.route, 'WAITING_FOR_EXTERNAL_CONDITION'),
        resourceIds: list(row?.resourceIds).map((value) => text(value)).filter(Boolean),
        hostControllerId: host.controllerId,
        hostControllerTitle: host.title,
        continuityState: state,
        retired: state === 'RETIRED',
        selectedForAdmission: selectedIssues.has(issue),
        schedulerOwned: true,
        workerMutationAuthorityRequired: true,
        executionOwner: 'canonical-mission-scheduler-and-mission-worker',
        currentTruthSource: 'mission-scheduler.portfolio',
        promptMissionAuthoritative: false,
        terminalEvictionRequired: true,
        sourceMutationAllowed: false,
        mergeAuthority: false,
        deploymentAuthority: false,
        runtimeMutationAuthority: false,
      }));
    }
  }

  const duplicateControllerIds = controllers
    .map((item) => item.logicalControllerId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateControllerIds.length) blockers.push('LOGICAL_CONTROLLER_IDENTITY_DUPLICATE');

  const hostLoads = fleet.map((host) => Object.freeze({
    controllerId: host.controllerId,
    title: host.title,
    logicalControllerCount: controllers.filter((item) => item.hostControllerId === host.controllerId).length,
    activeCount: controllers.filter((item) => item.hostControllerId === host.controllerId && item.continuityState === 'ACTIVE').length,
    trackingCount: controllers.filter((item) => item.hostControllerId === host.controllerId && item.continuityState === 'TRACKING').length,
    parkedCount: controllers.filter((item) => item.hostControllerId === host.controllerId && item.continuityState === 'PARKED').length,
  }));

  const valid = blockers.length === 0;
  return Object.freeze({
    schemaVersion: LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA,
    valid,
    finalVerdict: valid
      ? 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY'
      : 'LOGICAL_GOAL_CONTROLLER_FABRIC_HOLD',
    observedAtUtc,
    repository,
    physicalControllerCount: fleet.length,
    logicalControllerCount: controllers.length,
    activeLogicalControllerCount: controllers.filter((item) => item.continuityState === 'ACTIVE').length,
    trackingLogicalControllerCount: controllers.filter((item) => item.continuityState === 'TRACKING').length,
    parkedLogicalControllerCount: controllers.filter((item) => item.continuityState === 'PARKED').length,
    retiredLogicalControllerCount: controllers.filter((item) => item.retired).length,
    controllers: Object.freeze(controllers),
    hostLoads: Object.freeze(hostLoads),
    blockers: Object.freeze([...new Set(blockers)]),
    schedulerIsSoleGoalSelectionAuthority: true,
    oneMutationWriterPerResourceStillRequired: true,
    physicalControllersAreContinuityHostsNotMutationOwners: true,
    currentTruthMustBeReconciledEveryCycle: true,
    stableHostRule: 'goalIssueNumber modulo physicalControllerCount',
    stalePromptMissionMayNotOverrideCanonicalTruth: true,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    createsScheduler: false,
    createsWorker: false,
    createsQueue: false,
  });
}
