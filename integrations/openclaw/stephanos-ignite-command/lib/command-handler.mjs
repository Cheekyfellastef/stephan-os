import { renderIgniteCommand, resolveIgniteCommand } from './ignite-status.mjs';
import { wakeBattleBridgeRecoveryMesh } from './recovery-wake.mjs';

function bool(value) {
  return value === true ? 'true' : 'false';
}

function renderExactHeadUpdateStatus(result) {
  const lines = [
    `BATTLE_BRIDGE_EXACT_HEAD_UPDATE_STATUS=${result.ok ? 'OBSERVED' : 'BLOCKED'}`,
    `RECEIPT_ID=${result.receiptId || ''}`,
    `EXECUTION_STATUS=${result.status || 'UNPROVEN'}`,
    `EXPECTED_HEAD=${result.expectedHead || ''}`,
    `SOURCE_HEAD=${result.sourceHead || ''}`,
    `EXPECTED_HEAD_MATCH=${bool(result.expectedHeadMatch)}`,
    `SOURCE_INSTALLED=${bool(result.sourceInstalled)}`,
    `RUNTIME_PROOF_PASSED=${bool(result.runtimeProofPassed)}`,
    `RUNTIME_PROOF_PENDING=${bool(result.runtimeProofPending)}`,
    `PLUGIN_RELOAD_PROOF_PENDING=${bool(result.pluginReloadProofPending)}`,
    `SERVED_UI_EXACT_HEAD=${bool(result.servedUiExactHead)}`,
    `RETRY_SAFE=${bool(result.retrySafe)}`,
    `EXECUTION_STATE_UNPROVEN=${bool(result.executionStateUnproven)}`,
    `RESULT_AUTHENTICITY_PROVEN=${bool(result.resultAuthenticityProven)}`,
    `RESULT_PERSISTENCE_PROVEN=${bool(result.resultPersistenceProven)}`,
    `DURABLE_RECEIPT_STATUS_OBSERVED=${result.durableReceiptStatusObserved || ''}`,
    `VERDICT=${result.finalVerdict || 'UPDATE_STATUS_UNPROVEN'}`,
  ];
  if (result.blocker) lines.push(`REASON=${result.blocker}`);
  lines.push('CURRENT_INVOCATION_READ_ONLY=true');
  return lines.join('\n');
}

function renderExactHeadUpdateResult(result) {
  const lines = [
    `BATTLE_BRIDGE_EXACT_HEAD_UPDATE=${result.ok ? 'ACCEPTED' : 'BLOCKED'}`,
    `EXPECTED_HEAD=${result.expectedHead || ''}`,
    `SOURCE_HEAD=${result.sourceHead || ''}`,
    `EXPECTED_HEAD_MATCH=${bool(result.expectedHeadMatch)}`,
    `SOURCE_INSTALLED=${bool(result.sourceInstalled)}`,
    `RUNTIME_PROOF_PASSED=${bool(result.runtimeProofPassed)}`,
    `RUNTIME_PROOF_PENDING=${bool(result.runtimeProofPending)}`,
    `PLUGIN_RELOAD_PROOF_PENDING=${bool(result.pluginReloadProofPending)}`,
    `SERVED_UI_EXACT_HEAD=${bool(result.servedUiExactHead)}`,
    `VERDICT=${result.finalVerdict || 'UPDATE_FAILED'}`,
  ];
  if (result.blocker) lines.push(`REASON=${result.blocker}`);
  lines.push('DESTRUCTIVE_GIT_ALLOWED=false');
  lines.push('ARBITRARY_SHELL_ALLOWED=false');
  lines.push('PC_RESTART_ALLOWED=false');
  return lines.join('\n');
}

export async function handleStephanosIgniteCommand(ctx, {
  queueUpdateFn = null,
  readUpdateStatusFn = null,
  wakeFn = wakeBattleBridgeRecoveryMesh,
} = {}) {
  const resolved = resolveIgniteCommand(ctx?.args || 'help');
  if (!resolved.ok) return { text: resolved.text };
  if (resolved.command === 'wake') {
    const result = await wakeFn({
      authenticatedContext: { authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' },
    });
    if (!result.ok) return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=BLOCKED\nREASON=${result.blocker}` };
    return { text: `BATTLE_BRIDGE_RECOVERY_WAKE=QUEUED\nREQUEST_ID=${result.requestId}\nROUTE=${result.route}\nONE_CANONICAL_COORDINATOR=true` };
  }
  if (resolved.command === 'update') {
    if (typeof queueUpdateFn !== 'function') return { text: 'BATTLE_BRIDGE_EXACT_HEAD_UPDATE=BLOCKED\nREASON=OWNER_HANDLER_CAPABILITY_REQUIRED' };
    const result = await queueUpdateFn({
      expectedHead: resolved.expectedHead,
      authenticatedContext: {
        authenticatedByHost: true,
        commandName: 'stephanos-ignite',
        command: 'update',
        senderIsOwner: ctx?.senderIsOwner === true,
      },
    });
    if (result.receiptId) return { text: `${renderExactHeadUpdateResult(result)}\nRECEIPT_ID=${result.receiptId}` };
    return { text: renderExactHeadUpdateResult(result) };
  }
  if (resolved.command === 'update-status') {
    if (typeof readUpdateStatusFn !== 'function') return { text: 'BATTLE_BRIDGE_EXACT_HEAD_UPDATE_STATUS=BLOCKED\nREASON=OWNER_HANDLER_CAPABILITY_REQUIRED' };
    const result = await readUpdateStatusFn({
      receiptId: resolved.receiptId,
      authenticatedContext: {
        authenticatedByHost: true,
        commandName: 'stephanos-ignite',
        command: 'update-status',
        senderIsOwner: ctx?.senderIsOwner === true,
      },
    });
    return { text: renderExactHeadUpdateStatus(result) };
  }
  return { text: renderIgniteCommand(ctx?.args || 'help') };
}

export function createStephanosIgniteCommandHandler(dependencies) {
  return (ctx) => handleStephanosIgniteCommand(ctx, dependencies);
}
