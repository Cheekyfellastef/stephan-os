import {
  evaluateRepairAgentHealthSupervisorV1,
} from './repairAgentHealthSupervisorV1.mjs';

export const REPAIR_AGENT_BOOTSTRAP_HEALTH_PROJECTION_SCHEMA =
  'stephanos.repair-agent-bootstrap-health-projection.v1';

const PROJECTED_IDS = Object.freeze([
  'githubCommandMailbox',
  'recoveryMesh',
  'recoveryLifeboat',
]);

const SYNTHETIC_HEAD_BOUND_IDS = Object.freeze([
  'githubSync',
  'postSyncRefresh',
  'workerWatchdog',
  'missionWorker',
  'repairAgentHealthSupervisor',
]);

function healthyRecord({ id, expectedHead, observedAtUtc }) {
  return {
    state: 'HEALTHY',
    observedAtUtc,
    sourceHead: SYNTHETIC_HEAD_BOUND_IDS.includes(id) ? expectedHead : '',
    ...(id === 'repairAgentHealthSupervisor' ? { crossWatchHealthy: true } : {}),
  };
}

export function evaluateRepairAgentBootstrapHealthProjectionV1({
  expectedHead = '',
  observedAtUtc = new Date().toISOString(),
  githubCommandMailbox,
  recoveryMesh,
  recoveryLifeboat,
} = {}) {
  const systems = {};
  for (const id of SYNTHETIC_HEAD_BOUND_IDS) {
    systems[id] = healthyRecord({ id, expectedHead, observedAtUtc });
  }
  systems.githubCommandMailbox = githubCommandMailbox;
  systems.recoveryMesh = recoveryMesh;
  systems.recoveryLifeboat = recoveryLifeboat;

  const assessment = evaluateRepairAgentHealthSupervisorV1({
    expectedHead,
    observedAtUtc,
    systems,
  });

  const projectedSystems = assessment.systems.filter((system) => PROJECTED_IDS.includes(system.id));
  const hardHold = assessment.ok !== true || projectedSystems.some((system) => system.state === 'HARD_HOLD');
  const repairCandidates = projectedSystems.filter((system) => system.repairRequired === true);
  const allRequiredHealthy = !hardHold
    && projectedSystems.length === PROJECTED_IDS.length
    && projectedSystems.every((system) => system.state === 'HEALTHY');

  return Object.freeze({
    ok: !hardHold,
    schemaVersion: REPAIR_AGENT_BOOTSTRAP_HEALTH_PROJECTION_SCHEMA,
    classification: hardHold
      ? 'CONTROL_PLANE_BOOTSTRAP_HEALTH_EVIDENCE_BLOCKED'
      : allRequiredHealthy
        ? 'CONTROL_PLANE_BOOTSTRAP_ALL_REQUIRED_HEALTHY'
        : 'CONTROL_PLANE_BOOTSTRAP_REPAIR_REQUIRED',
    blocker: hardHold ? (assessment.blocker || 'BOOTSTRAP_HEALTH_EVIDENCE_INVALID') : '',
    expectedHead: assessment.expectedHead,
    observedAtUtc: assessment.observedAtUtc,
    systems: Object.freeze(projectedSystems),
    repairCandidates: Object.freeze(repairCandidates),
    allRequiredHealthy,
    arbitraryTaskNameAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  });
}
