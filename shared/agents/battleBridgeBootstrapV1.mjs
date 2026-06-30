export const BATTLE_BRIDGE_BOOTSTRAP_SCHEMA_VERSION = 'battle-bridge-bootstrap.v1';

export const BATTLE_BRIDGE_BOOTSTRAP_PROOF_FILE = 'battle-bridge-bootstrap-v1-proof.json';
export const BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS = '%USERPROFILE%\\Documents\\Stephanos-openclaw-workspace';

export const BATTLE_BRIDGE_BOOTSTRAP_ACTIONS = Object.freeze({
  CHECK_OPENCLAW_GATEWAY_HEALTH: 'check-openclaw-gateway-health-18789',
  CHECK_STEPHANOS_BACKEND_HEALTH: 'check-stephanos-backend-health-8787',
  CHECK_STEPHANOS_UI_HEALTH: 'check-stephanos-ui-health-4173',
  CHECK_MISSION_ORCHESTRATOR_WORKER_STATUS: 'check-mission-orchestrator-worker-status',
  REQUEST_MISSION_ORCHESTRATOR_WORKER_RESTART: 'request-mission-orchestrator-worker-restart',
  WRITE_SHARED_WORKSPACE_PROOF: 'write-shared-workspace-proof',
});

export const BATTLE_BRIDGE_BOOTSTRAP_ENDPOINTS = Object.freeze({
  [BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_OPENCLAW_GATEWAY_HEALTH]: Object.freeze({ serviceId: 'openclaw-gateway', port: 18789 }),
  [BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_STEPHANOS_BACKEND_HEALTH]: Object.freeze({ serviceId: 'stephanos-backend', port: 8787 }),
  [BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.CHECK_STEPHANOS_UI_HEALTH]: Object.freeze({ serviceId: 'stephanos-ui', port: 4173 }),
});

export const BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION = Object.freeze({
  kind: 'windows-scheduled-task',
  taskName: 'StephanosMissionOrchestratorWorker',
  scriptId: 'scripts/windows/repair-stephanos-battle-bridge.ps1',
  serviceId: 'mission-orchestrator-worker',
});

const ALLOWLIST = new Set(Object.values(BATTLE_BRIDGE_BOOTSTRAP_ACTIONS));
const REQUIRED_PROOF_FIELDS = Object.freeze([
  'WORKER_KILLED',
  'SUPERVISOR_DETECTED_WORKER_DOWN',
  'SUPERVISOR_RESTARTED_WORKER',
  'WORKER_RECOVERED',
  'WORKER_FROM_MAIN',
  'PROOF_WRITTEN_TO_SHARED_WORKSPACE',
  'VISIBLE_POWERSHELL_REQUIRED',
]);

function booleanValue(value) {
  return value === true;
}

function checkedAtUtc(input) {
  return typeof input?.checkedAtUtc === 'string' && input.checkedAtUtc.trim()
    ? input.checkedAtUtc.trim()
    : 'pending';
}

function rejectUnsafeAction(action) {
  if (!ALLOWLIST.has(action)) {
    return {
      accepted: false,
      action,
      reason: 'BATTLE_BRIDGE_BOOTSTRAP_REJECTED_NON_ALLOWLISTED_ACTION',
    };
  }
  return null;
}

export function buildBattleBridgeBootstrapContract() {
  return {
    schemaVersion: BATTLE_BRIDGE_BOOTSTRAP_SCHEMA_VERSION,
    contractKind: 'stephanos.battle_bridge.remote_bootstrap.contract.v1',
    sharedWorkspaceWindows: BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS,
    proofFile: BATTLE_BRIDGE_BOOTSTRAP_PROOF_FILE,
    allowlistedActions: Object.values(BATTLE_BRIDGE_BOOTSTRAP_ACTIONS),
    healthChecks: { ...BATTLE_BRIDGE_BOOTSTRAP_ENDPOINTS },
    workerRestartAbstraction: { ...BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION },
    proofFields: [...REQUIRED_PROOF_FIELDS],
    guardrails: {
      arbitraryShellAllowed: false,
      uncontrolledMutationAllowed: false,
      gitResetHardAllowed: false,
      branchDeletionAllowed: false,
      mergeReadinessFlipAllowed: false,
      tokenOrEnvDumpAllowed: false,
      operatorApprovalSpoofingAllowed: false,
      visiblePowerShellRequiredAsPrimaryUi: false,
    },
    finalVerdict: 'REMOTE_BATTLE_BRIDGE_BOOTSTRAP_CONTRACT_READY',
  };
}

export function createBattleBridgeBootstrapActionRequest(input = {}) {
  const action = typeof input.action === 'string' ? input.action : '';
  const rejected = rejectUnsafeAction(action);
  if (rejected) return rejected;

  if (action === BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.REQUEST_MISSION_ORCHESTRATOR_WORKER_RESTART) {
    return {
      accepted: input.restartAbstraction?.kind === BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION.kind
        && input.restartAbstraction?.taskName === BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION.taskName,
      action,
      serviceId: 'mission-orchestrator-worker',
      mutation: 'bounded-worker-restart-request',
      restartAbstraction: { ...BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION },
      reason: input.restartAbstraction?.kind === BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION.kind
        && input.restartAbstraction?.taskName === BATTLE_BRIDGE_BOOTSTRAP_APPROVED_RESTART_ABSTRACTION.taskName
        ? 'BATTLE_BRIDGE_BOOTSTRAP_ALLOWLISTED_RESTART_REQUEST'
        : 'BATTLE_BRIDGE_BOOTSTRAP_REJECTED_UNAPPROVED_RESTART_ABSTRACTION',
    };
  }

  return {
    accepted: true,
    action,
    serviceId: BATTLE_BRIDGE_BOOTSTRAP_ENDPOINTS[action]?.serviceId || 'mission-orchestrator-worker',
    port: BATTLE_BRIDGE_BOOTSTRAP_ENDPOINTS[action]?.port || null,
    mutation: action === BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.WRITE_SHARED_WORKSPACE_PROOF ? 'bounded-proof-write' : 'none',
    reason: 'BATTLE_BRIDGE_BOOTSTRAP_ALLOWLISTED_ACTION',
  };
}

export function evaluateBattleBridgeBootstrapProof(input = {}) {
  const workerKilled = booleanValue(input.WORKER_KILLED);
  const workerDownDetected = booleanValue(input.SUPERVISOR_DETECTED_WORKER_DOWN);
  const restartRequested = createBattleBridgeBootstrapActionRequest({
    action: BATTLE_BRIDGE_BOOTSTRAP_ACTIONS.REQUEST_MISSION_ORCHESTRATOR_WORKER_RESTART,
    restartAbstraction: input.restartAbstraction,
  });
  const workerRecovered = booleanValue(input.WORKER_RECOVERED);
  const workerFromMain = booleanValue(input.WORKER_FROM_MAIN);
  const proofWritten = booleanValue(input.PROOF_WRITTEN_TO_SHARED_WORKSPACE);
  const visiblePowerShellRequired = booleanValue(input.VISIBLE_POWERSHELL_REQUIRED);
  const supervisorRestartedWorker = restartRequested.accepted && booleanValue(input.SUPERVISOR_RESTARTED_WORKER);
  const success = workerKilled
    && workerDownDetected
    && supervisorRestartedWorker
    && workerRecovered
    && workerFromMain
    && proofWritten
    && visiblePowerShellRequired === false;

  return {
    schemaVersion: BATTLE_BRIDGE_BOOTSTRAP_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.remote_bootstrap.proof.v1',
    checkedAtUtc: checkedAtUtc(input),
    sharedWorkspaceWindows: BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS,
    proofPathWindows: `${BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS}\\${BATTLE_BRIDGE_BOOTSTRAP_PROOF_FILE}`,
    fields: {
      WORKER_KILLED: workerKilled,
      SUPERVISOR_DETECTED_WORKER_DOWN: workerDownDetected,
      SUPERVISOR_RESTARTED_WORKER: supervisorRestartedWorker,
      WORKER_RECOVERED: workerRecovered,
      WORKER_FROM_MAIN: workerFromMain,
      PROOF_WRITTEN_TO_SHARED_WORKSPACE: proofWritten,
      VISIBLE_POWERSHELL_REQUIRED: visiblePowerShellRequired,
    },
    restartRequest: restartRequested,
    sharedWorkspaceMessage: proofWritten
      ? `Battle Bridge bootstrap proof written to ${BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS}`
      : `Battle Bridge bootstrap proof must be written to ${BATTLE_BRIDGE_SHARED_WORKSPACE_WINDOWS}`,
    success,
    finalVerdict: success ? 'REMOTE_BATTLE_BRIDGE_BOOTSTRAP_PROOF_PASS' : 'REMOTE_BATTLE_BRIDGE_BOOTSTRAP_PROOF_BLOCKED',
  };
}
