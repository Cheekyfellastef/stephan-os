export const PROVIDER_NEUTRAL_DISPATCH_RECOVERY_SCHEMA = 'stephanos.provider-neutral-dispatch-recovery.v1';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,159}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const TERMINAL_STATES = new Set(['DONE', 'FAILED', 'BLOCKED']);

const ZERO_AUTHORITY = Object.freeze({
  redispatchAllowed: false,
  sourceMutationAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  credentialAccessAllowed: false,
  spendingAllowed: false,
  leaseSeizureAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeId(value) {
  const normalized = text(value);
  return SAFE_ID.test(normalized) ? normalized : '';
}

function safeSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function recoveryResult(candidate = {}, fields = {}) {
  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_DISPATCH_RECOVERY_SCHEMA,
    dispatchJobId: safeId(candidate.dispatchJobId),
    batonId: safeId(candidate.batonId),
    repository: text(candidate.repository),
    expectedHead: safeSha(candidate.expectedHead),
    providerFamily: text(candidate?.selectedRoute?.providerFamily).toUpperCase(),
    adapterId: text(candidate?.selectedRoute?.adapterId).toLowerCase(),
    providerTaskId: '',
    providerExecutionStarted: false,
    resultReadbackOperation: '',
    terminalState: '',
    receiptProofRef: '',
    automaticRedispatchAllowed: false,
    authority: ZERO_AUTHORITY,
    ...fields,
  });
}

function candidateBlocker(candidate = {}) {
  if (!safeId(candidate.dispatchJobId)) return 'PROVIDER_NEUTRAL_RECOVERY_JOB_ID_INVALID';
  if (!safeId(candidate.batonId)) return 'PROVIDER_NEUTRAL_RECOVERY_BATON_ID_INVALID';
  if (!safeSha(candidate.expectedHead)) return 'PROVIDER_NEUTRAL_RECOVERY_EXPECTED_HEAD_INVALID';
  if (!text(candidate.repository).includes('/')) return 'PROVIDER_NEUTRAL_RECOVERY_REPOSITORY_INVALID';
  if (!safeId(candidate?.selectedRoute?.adapterId)) return 'PROVIDER_NEUTRAL_RECOVERY_ADAPTER_INVALID';
  return '';
}

function validateReceiptBinding(candidate = {}, receipt = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_INVALID';
  }
  if (receipt.verified !== true) return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_NOT_VERIFIED';
  if (safeId(receipt.dispatchJobId) !== safeId(candidate.dispatchJobId)) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_JOB_MISMATCH';
  }
  if (safeSha(receipt.expectedHead) !== safeSha(candidate.expectedHead)) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_HEAD_MISMATCH';
  }
  if (text(receipt.repository) !== text(candidate.repository)) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_REPOSITORY_MISMATCH';
  }
  if (text(receipt.providerFamily).toUpperCase() !== text(candidate?.selectedRoute?.providerFamily).toUpperCase()) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_PROVIDER_MISMATCH';
  }
  if (text(receipt.adapterId).toLowerCase() !== text(candidate?.selectedRoute?.adapterId).toLowerCase()) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_ADAPTER_MISMATCH';
  }
  const providerTaskId = safeId(receipt.providerTaskId);
  const readback = safeId(receipt.resultReadbackOperation);
  const proofRef = text(receipt.verificationProofRef);
  if (!providerTaskId || receipt.providerExecutionStarted !== true || !readback || !proofRef) {
    return 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_EXECUTION_TRUTH_INVALID';
  }
  return '';
}

export function reconcileProviderNeutralDispatchReceipt(candidate = {}, receipt = null) {
  const blocker = candidateBlocker(candidate);
  if (blocker) {
    return recoveryResult(candidate, {
      ok: false,
      blocker,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_BLOCKED',
      exactNextAction: 'Repair or quarantine the malformed durable baton before any provider action.',
    });
  }

  if (receipt == null) {
    return recoveryResult(candidate, {
      ok: true,
      blocker: '',
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_UNRESOLVED',
      exactNextAction: 'Check the selected provider for a verified execution receipt. Do not redispatch from baton evidence alone.',
    });
  }

  const receiptBlocker = validateReceiptBinding(candidate, receipt);
  if (receiptBlocker) {
    return recoveryResult(candidate, {
      ok: false,
      blocker: receiptBlocker,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_RECEIPT_CONFLICT',
      exactNextAction: 'Quarantine the conflicting receipt and re-read execution truth from the selected provider.',
    });
  }

  const terminalState = text(receipt.terminalState).toUpperCase();
  return recoveryResult(candidate, {
    ok: true,
    blocker: '',
    providerTaskId: safeId(receipt.providerTaskId),
    providerExecutionStarted: true,
    resultReadbackOperation: safeId(receipt.resultReadbackOperation),
    terminalState: TERMINAL_STATES.has(terminalState) ? terminalState : '',
    receiptProofRef: text(receipt.verificationProofRef),
    finalVerdict: TERMINAL_STATES.has(terminalState)
      ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_TERMINAL_CONFIRMED'
      : 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_EXECUTION_CONFIRMED',
    exactNextAction: TERMINAL_STATES.has(terminalState)
      ? 'Consume the verified provider result through the recorded readback operation; do not redispatch.'
      : 'Continue readback for the verified provider task; do not redispatch.',
  });
}

export async function reconcileProviderNeutralDispatchCandidates(candidates = [], options = {}) {
  const readExecutionReceipt = options.readExecutionReceipt;
  const bounded = Array.isArray(candidates) ? candidates.slice(0, 64) : [];
  const results = [];

  for (const candidate of bounded) {
    let receipt = null;
    if (typeof readExecutionReceipt === 'function' && !candidateBlocker(candidate)) {
      try {
        receipt = await readExecutionReceipt(Object.freeze({ ...candidate }));
      } catch {
        results.push(recoveryResult(candidate, {
          ok: false,
          blocker: 'PROVIDER_NEUTRAL_RECOVERY_RECEIPT_READ_FAILED',
          finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_RECEIPT_READ_FAILED',
          exactNextAction: 'Retry the provider receipt read on the same dispatch job. Do not redispatch.',
        }));
        continue;
      }
    }
    results.push(reconcileProviderNeutralDispatchReceipt(candidate, receipt));
  }

  const unresolvedCount = results.filter((item) => item.finalVerdict === 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_UNRESOLVED').length;
  const confirmedCount = results.filter((item) => item.providerExecutionStarted === true).length;
  const blockedCount = results.filter((item) => item.ok !== true).length;
  const truncated = Array.isArray(candidates) && candidates.length > bounded.length;
  return Object.freeze({
    ok: blockedCount === 0 && !truncated,
    blocker: blockedCount
      ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_HAS_BLOCKERS'
      : truncated
        ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_TRUNCATED'
        : '',
    schemaVersion: PROVIDER_NEUTRAL_DISPATCH_RECOVERY_SCHEMA,
    results: Object.freeze(results),
    candidateCount: results.length,
    confirmedCount,
    unresolvedCount,
    blockedCount,
    truncated,
    automaticRedispatchAllowed: false,
    authority: ZERO_AUTHORITY,
    finalVerdict: blockedCount || truncated
      ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_ATTENTION_REQUIRED'
      : unresolvedCount
        ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_WAITING_FOR_RECEIPTS'
        : 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_RECONCILED',
  });
}

export async function recoverProviderNeutralDispatches(options = {}) {
  const listCandidates = options.listCandidates;
  if (typeof listCandidates !== 'function') {
    return Object.freeze({
      ok: false,
      blocker: 'PROVIDER_NEUTRAL_RECOVERY_DISCOVERY_UNAVAILABLE',
      schemaVersion: PROVIDER_NEUTRAL_DISPATCH_RECOVERY_SCHEMA,
      results: Object.freeze([]),
      candidateCount: 0,
      confirmedCount: 0,
      unresolvedCount: 0,
      blockedCount: 0,
      truncated: false,
      automaticRedispatchAllowed: false,
      authority: ZERO_AUTHORITY,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_BLOCKED',
    });
  }

  let discovery;
  try {
    discovery = await listCandidates();
  } catch {
    discovery = null;
  }
  if (!discovery || discovery.ok !== true || !Array.isArray(discovery.candidates)) {
    return Object.freeze({
      ok: false,
      blocker: text(discovery?.blocker) || 'PROVIDER_NEUTRAL_RECOVERY_DISCOVERY_FAILED',
      schemaVersion: PROVIDER_NEUTRAL_DISPATCH_RECOVERY_SCHEMA,
      results: Object.freeze([]),
      candidateCount: 0,
      confirmedCount: 0,
      unresolvedCount: 0,
      blockedCount: 0,
      truncated: discovery?.truncated === true,
      automaticRedispatchAllowed: false,
      authority: ZERO_AUTHORITY,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_BLOCKED',
    });
  }

  const reconciled = await reconcileProviderNeutralDispatchCandidates(discovery.candidates, options);
  const truncated = discovery.truncated === true || reconciled.truncated;
  return Object.freeze({
    ...reconciled,
    ok: reconciled.ok === true && !truncated,
    blocker: reconciled.blocker || (truncated ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_TRUNCATED' : ''),
    discoveryInvalidCount: Number.isSafeInteger(discovery.invalidCount) ? discovery.invalidCount : 0,
    truncated,
    finalVerdict: truncated
      ? 'PROVIDER_NEUTRAL_DISPATCH_RECOVERY_ATTENTION_REQUIRED'
      : reconciled.finalVerdict,
  });
}
