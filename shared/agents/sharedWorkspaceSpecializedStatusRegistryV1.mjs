export const SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY_SCHEMA = 'stephanos.shared-workspace-specialized-status-registry.v1';

function record({ fileName, schemaIds, sourcePaths, role }) {
  return Object.freeze({
    directory: 'status',
    fileName,
    schemaIds: Object.freeze([...schemaIds]),
    sourcePaths: Object.freeze([...sourcePaths]),
    role,
    dashboardAuthority: false,
    authority: 'specialized-consumer-only',
  });
}

export const SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS = Object.freeze([
  record({
    fileName: 'battle-bridge-break-glass-nonce.json',
    schemaIds: ['stephanos.battle-bridge-break-glass-nonce.v1'],
    sourcePaths: ['scripts/windows/request-battle-bridge-recovery.ps1'],
    role: 'single-use-recovery-authority',
  }),
  record({
    fileName: 'battle-bridge-ignition-supervisor-current.json',
    schemaIds: ['stephanos.battle-bridge-ignition-supervisor.v1'],
    sourcePaths: [
      'scripts/battle-bridge-ignition-supervisor.mjs',
      'scripts/run-battle-bridge-ignition.mjs',
    ],
    role: 'ignition-supervisor-projection',
  }),
  record({
    fileName: 'battle-bridge-recovery-mesh-launch-current.json',
    schemaIds: ['stephanos.battle-bridge-recovery-mesh-launch.v1'],
    sourcePaths: ['scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1'],
    role: 'recovery-mesh-launch-projection',
  }),
  record({
    fileName: 'battle-bridge-recovery-mesh-state.json',
    schemaIds: ['stephanos.battle-bridge-recovery-mesh-runner.v1'],
    sourcePaths: ['scripts/battle-bridge-recovery-mesh.mjs'],
    role: 'recovery-mesh-consumption-state',
  }),
  record({
    fileName: 'battle-bridge-worker-watchdog-launch-current.json',
    schemaIds: ['stephanos.battle-bridge-worker-watchdog-launch.v1'],
    sourcePaths: ['scripts/windows/run-battle-bridge-worker-watchdog-hidden.ps1'],
    role: 'worker-watchdog-launch-projection',
  }),
  record({
    fileName: 'guarded-goal-runner-current.json',
    schemaIds: ['stephanos.guarded-goal-runner-current.v1'],
    sourcePaths: ['scripts/guarded-goal-runner-current.mjs'],
    role: 'guarded-goal-runner-projection',
  }),
  record({
    fileName: 'guarded-goal-runner-pr-current.json',
    schemaIds: ['stephanos.guarded-goal-runner-pr-proof.v1'],
    sourcePaths: [
      'scripts/guarded-goal-runner-current.mjs',
      'scripts/guarded-goal-runner-pr-proof-current.mjs',
      'shared/agents/guardedGoalRunnerV1.mjs',
    ],
    role: 'guarded-goal-runner-pr-proof',
  }),
  record({
    fileName: 'ignition-browser-surfaces-current.json',
    schemaIds: ['stephanos.ignition-browser-surface-receipt.v1'],
    sourcePaths: ['windows/Launch-Stephanos-Local.ps1'],
    role: 'ignition-browser-window-proof',
  }),
  record({
    fileName: 'mission-orchestrator-worker-heartbeat.json',
    schemaIds: ['stephanos.mission-orchestrator-worker-heartbeat.v1'],
    sourcePaths: ['scripts/mission-orchestrator-worker-heartbeat.mjs'],
    role: 'mission-worker-liveness-projection',
  }),
  record({
    fileName: 'stephanos-backend-runtime.json',
    schemaIds: ['stephanos.backend-runtime.v1'],
    sourcePaths: ['scripts/windows/start-stephanos-backend.ps1'],
    role: 'backend-runtime-identity-projection',
  }),
]);

export const SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY = Object.freeze({
  schemaVersion: SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY_SCHEMA,
  records: SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS,
  matchingPolicy: 'exact-directory-and-filename',
  defaultUnregisteredDisposition: 'dashboard-validation-required',
});

export const SPECIALIZED_NON_DASHBOARD_STATUS_FILES = Object.freeze(
  SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS.map(({ fileName }) => fileName),
);

const RECORD_BY_FILE = new Map(
  SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS.map((entry) => [entry.fileName, entry]),
);

export function getSharedWorkspaceSpecializedStatusRecord(fileName) {
  return RECORD_BY_FILE.get(String(fileName ?? '')) || null;
}

export function isSharedWorkspaceSpecializedStatusFile({ directory, fileName } = {}) {
  return directory === 'status' && RECORD_BY_FILE.has(String(fileName ?? ''));
}
