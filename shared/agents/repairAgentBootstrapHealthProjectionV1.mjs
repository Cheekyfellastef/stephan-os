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

function text(value) {
  return String(value ?? '').trim();
}

function firstTimestamp(...values) {
  return values.map(text).find((value) => value) || '';
}

function healthyRecord({ id, expectedHead, observedAtUtc }) {
  return {
    state: 'HEALTHY',
    observedAtUtc,
    sourceHead: SYNTHETIC_HEAD_BOUND_IDS.includes(id) ? expectedHead : '',
    ...(id === 'repairAgentHealthSupervisor' ? { crossWatchHealthy: true } : {}),
  };
}

function mailboxHealthRecord(mailboxIndex) {
  if (!mailboxIndex || typeof mailboxIndex !== 'object' || Array.isArray(mailboxIndex)) return undefined;
  const blocker = text(mailboxIndex.blocker);
  const observedAtUtc = firstTimestamp(
    mailboxIndex.timestampUtc,
    mailboxIndex.generatedAtUtc,
    mailboxIndex.observedAtUtc,
  );
  if (mailboxIndex.ok === true) return { state: 'HEALTHY', observedAtUtc, blocker: '' };
  if (blocker === 'MAILBOX_RECEIPT_INDEX_NOT_FOUND') return undefined;
  if (blocker === 'MAILBOX_RECEIPT_INDEX_STALE') {
    return { state: 'STALE', observedAtUtc, blocker };
  }
  return { state: 'BLOCKED', observedAtUtc, blocker: blocker || 'MAILBOX_RECEIPT_INDEX_BLOCKED' };
}

function recoveryMeshHealthRecord(recoveryMeshStatus) {
  if (!recoveryMeshStatus || typeof recoveryMeshStatus !== 'object' || Array.isArray(recoveryMeshStatus)) return undefined;
  const observedAtUtc = firstTimestamp(
    recoveryMeshStatus.timestampUtc,
    recoveryMeshStatus.generatedAtUtc,
    recoveryMeshStatus.observedAtUtc,
  );
  const healthy = recoveryMeshStatus.classification === 'RECOVERY_MESH_ALL_SERVICES_HEALTHY';
  return {
    state: healthy ? 'HEALTHY' : 'BLOCKED',
    observedAtUtc,
    blocker: healthy ? '' : text(recoveryMeshStatus.blocker || recoveryMeshStatus.classification || 'RECOVERY_MESH_BLOCKED'),
  };
}

function recoveryLifeboatHealthRecord(recoveryLifeboatHeartbeat) {
  if (!recoveryLifeboatHeartbeat || typeof recoveryLifeboatHeartbeat !== 'object' || Array.isArray(recoveryLifeboatHeartbeat)) return undefined;
  const observedAtUtc = firstTimestamp(
    recoveryLifeboatHeartbeat.completedAtUtc,
    recoveryLifeboatHeartbeat.timestampUtc,
    recoveryLifeboatHeartbeat.observedAtUtc,
  );
  const schemaValid = recoveryLifeboatHeartbeat.schemaVersion === 'stephanos.battle-bridge-recovery-lifeboat-heartbeat.v1';
  const healthy = schemaValid
    && recoveryLifeboatHeartbeat.healthy === true
    && recoveryLifeboatHeartbeat.payloadVerified === true
    && recoveryLifeboatHeartbeat.arbitraryShellAllowed === false
    && recoveryLifeboatHeartbeat.gitMutationAllowed === false
    && recoveryLifeboatHeartbeat.sourceMutationAllowed === false
    && recoveryLifeboatHeartbeat.pcRestartAllowed === false;
  return {
    state: healthy ? 'HEALTHY' : 'BLOCKED',
    observedAtUtc,
    blocker: healthy ? '' : 'RECOVERY_LIFEBOAT_HEARTBEAT_BLOCKED',
  };
}

export function projectRepairAgentBootstrapCanonicalEvidenceV1({
  expectedHead = '',
  observedAtUtc = new Date().toISOString(),
  mailboxIndex,
  recoveryMeshStatus,
  recoveryLifeboatHeartbeat,
} = {}) {
  return evaluateRepairAgentBootstrapHealthProjectionV1({
    expectedHead,
    observedAtUtc,
    githubCommandMailbox: mailboxHealthRecord(mailboxIndex),
    recoveryMesh: recoveryMeshHealthRecord(recoveryMeshStatus),
    recoveryLifeboat: recoveryLifeboatHealthRecord(recoveryLifeboatHeartbeat),
  });
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
