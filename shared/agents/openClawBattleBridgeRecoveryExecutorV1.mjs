import {
  planAttestedMobileRecovery,
} from './battleBridgeMobileRecoveryLifeboatV1.mjs';

export const OPENCLAW_BATTLE_BRIDGE_RECOVERY_EXECUTOR_SCHEMA = 'stephanos.openclaw-battle-bridge-recovery-executor.v1';
export const OPENCLAW_BATTLE_BRIDGE_RECOVERY_PROVIDER = 'openclaw-standalone';
export const OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_ID = 'battle-bridge-lifeboat-fixed-control-plane-actions-v1';
export const OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH = 'actions/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1';

export const OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS = Object.freeze([
  'PROBE_BATTLE_BRIDGE',
  'WAKE_CANONICAL_MAILBOX',
  'WAKE_CANONICAL_RECOVERY_MESH',
]);

const QUALIFIED_ACTIONS = new Set(OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS);
const FIXED_OPERATION_BY_ACTION = Object.freeze({
  PROBE_BATTLE_BRIDGE: 'PROBE_BATTLE_BRIDGE',
  WAKE_CANONICAL_MAILBOX: 'WAKE_CANONICAL_MAILBOX',
  WAKE_CANONICAL_RECOVERY_MESH: 'WAKE_CANONICAL_RECOVERY_MESH',
});

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_RECOVERY_EXECUTOR_SCHEMA,
    provider: OPENCLAW_BATTLE_BRIDGE_RECOVERY_PROVIDER,
    blocker,
    executionPacket: null,
    arbitraryShellAllowed: false,
    callerSelectedExecutableAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedUrlAllowed: false,
    callerSelectedTaskAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    pcRestartAllowed: false,
    ...details,
  });
}

export function prepareOpenClawBattleBridgeRecoveryExecution({
  request,
  attestation,
  nowMs = Date.now(),
  consumedRequestIds = [],
} = {}) {
  const planned = planAttestedMobileRecovery({
    request,
    attestation,
    nowMs,
    consumedRequestIds,
  });

  if (!planned.ok || !planned.plan) {
    return blocked('OPENCLAW_RECOVERY_ATTESTATION_BLOCKED', {
      upstreamBlockers: Object.freeze([...(planned.blockers || [])]),
    });
  }

  if (!QUALIFIED_ACTIONS.has(planned.plan.action)) {
    return blocked('OPENCLAW_RECOVERY_ACTION_NOT_YET_QUALIFIED', {
      requestId: planned.plan.requestId,
      action: planned.plan.action,
      qualifiedActions: OPENCLAW_BATTLE_BRIDGE_QUALIFIED_ACTIONS,
    });
  }

  const executionPacket = Object.freeze({
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_RECOVERY_EXECUTOR_SCHEMA,
    provider: OPENCLAW_BATTLE_BRIDGE_RECOVERY_PROVIDER,
    requestId: planned.plan.requestId,
    action: planned.plan.action,
    fixedOperation: FIXED_OPERATION_BY_ACTION[planned.plan.action],
    fixedAdapterId: OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_ID,
    fixedAdapterRelativePath: OPENCLAW_BATTLE_BRIDGE_FIXED_ADAPTER_RELATIVE_PATH,
    executorRootPolicy: 'ACTIVE_KNOWN_GOOD_LIFEBOAT_BANK_OUTSIDE_REPOSITORY',
    sourceCheckoutRequiredToStartExecutor: false,
    openClawGatewayRequired: false,
    openClawMissionRunnerMayInvoke: true,
    lifeboatSentinelMayInvoke: true,
    freshPostActionProofRequired: true,
    arbitraryShellAllowed: false,
    callerSelectedExecutableAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedUrlAllowed: false,
    callerSelectedTaskAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    pcRestartAllowed: false,
  });

  return Object.freeze({
    ok: true,
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_RECOVERY_EXECUTOR_SCHEMA,
    provider: OPENCLAW_BATTLE_BRIDGE_RECOVERY_PROVIDER,
    blocker: '',
    executionPacket,
    arbitraryShellAllowed: false,
    callerSelectedExecutableAllowed: false,
    callerSelectedPathAllowed: false,
    callerSelectedUrlAllowed: false,
    callerSelectedTaskAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    pcRestartAllowed: false,
  });
}
