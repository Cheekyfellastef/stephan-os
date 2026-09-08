export const BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_SCHEMA = 'stephanos.battle-bridge-out-of-band-observer-receipt.v1';
export const BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_MARKER = '<!-- stephanos-battle-bridge-out-of-band-observer-receipt -->';

const SHA = /^[0-9a-f]{40}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const BLOCKER = /^[A-Z][A-Z0-9_:-]{2,159}$/;

function text(value) {
  return String(value ?? '').trim();
}

function safeHead(value) {
  const candidate = text(value).toLowerCase();
  return SHA.test(candidate) ? candidate : '';
}

function safeRequestId(value) {
  const candidate = text(value);
  return REQUEST_ID.test(candidate) ? candidate : '';
}

function safeBlocker(value, fallback) {
  const candidate = text(value).toUpperCase();
  return BLOCKER.test(candidate) ? candidate : fallback;
}

function safeRunId(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function safeTimestamp(value) {
  const milliseconds = Date.parse(text(value));
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date(0).toISOString();
}

export function buildBattleBridgeOutOfBandObserverReceipt({
  request = {},
  settingsProof = null,
  remoteReceipt = null,
  workflowRunId = 0,
  observedAtUtc = new Date().toISOString(),
  tailnetOutcome = '',
  remoteOutcome = '',
} = {}) {
  const requestId = safeRequestId(request?.requestId);
  const expectedHead = safeHead(request?.expectedHead);
  if (!requestId || !expectedHead) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_SCHEMA,
      requestId,
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1507,
      state: 'BLOCKED',
      blocker: 'OBSERVER_REQUEST_IDENTITY_INVALID',
      expectedHead,
      observedHead: '',
      exactHeadMatch: false,
      settingsReady: false,
      tailnetOutcome: text(tailnetOutcome).toLowerCase(),
      remoteOutcome: text(remoteOutcome).toLowerCase(),
      workflowRunId: safeRunId(workflowRunId),
      observedAtUtc: safeTimestamp(observedAtUtc),
      readOnly: true,
      mutationPerformed: false,
      arbitraryShellAllowed: false,
      arbitraryPowerShellAllowed: false,
      sourceMutationAllowed: false,
      destructiveGitAllowed: false,
      taskMutationAllowed: false,
      processRestartAllowed: false,
      liveOpenClawUpdateAllowed: false,
      secretValuesExposed: false,
      finalVerdict: 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_BLOCKED',
    });
  }

  const settingsReady = settingsProof?.ready === true;
  const remoteOk = remoteReceipt?.ok === true;
  const observedHead = safeHead(remoteReceipt?.observedHead);
  let state = 'UNREACHABLE';
  let blocker = 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_UNREACHABLE';

  if (!settingsReady) {
    state = 'BLOCKED';
    blocker = 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_SETTINGS_BLOCKED';
  } else if (remoteOk && observedHead) {
    if (observedHead === expectedHead) {
      state = 'DONE';
      blocker = '';
    } else {
      state = 'STALE';
      blocker = 'BATTLE_BRIDGE_LOCAL_HEAD_STALE';
    }
  } else if (text(tailnetOutcome).toLowerCase() !== 'success') {
    blocker = 'BATTLE_BRIDGE_TAILNET_UNREACHABLE';
  } else if (text(remoteOutcome).toLowerCase() !== 'success') {
    blocker = 'BATTLE_BRIDGE_SSH_OBSERVER_UNREACHABLE';
  } else {
    blocker = safeBlocker(remoteReceipt?.blocker, 'BATTLE_BRIDGE_REMOTE_PROOF_INVALID');
  }

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_SCHEMA,
    requestId,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    state,
    blocker,
    expectedHead,
    observedHead,
    exactHeadMatch: Boolean(observedHead && observedHead === expectedHead),
    settingsReady,
    tailnetOutcome: text(tailnetOutcome).toLowerCase(),
    remoteOutcome: text(remoteOutcome).toLowerCase(),
    workflowRunId: safeRunId(workflowRunId),
    observedAtUtc: safeTimestamp(observedAtUtc),
    readOnly: true,
    mutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    sourceMutationAllowed: false,
    destructiveGitAllowed: false,
    taskMutationAllowed: false,
    processRestartAllowed: false,
    liveOpenClawUpdateAllowed: false,
    secretValuesExposed: false,
    finalVerdict: state === 'DONE'
      ? 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_PASS'
      : state === 'STALE'
        ? 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_STALE'
        : state === 'BLOCKED'
          ? 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_BLOCKED'
          : 'BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_UNREACHABLE',
  });
}

export function buildBattleBridgeOutOfBandObserverReceiptBody(receipt = {}) {
  const bounded = {
    schemaVersion: receipt.schemaVersion,
    requestId: receipt.requestId,
    repository: receipt.repository,
    issueNumber: receipt.issueNumber,
    state: receipt.state,
    blocker: receipt.blocker,
    expectedHead: receipt.expectedHead,
    observedHead: receipt.observedHead,
    exactHeadMatch: receipt.exactHeadMatch === true,
    settingsReady: receipt.settingsReady === true,
    tailnetOutcome: receipt.tailnetOutcome,
    remoteOutcome: receipt.remoteOutcome,
    workflowRunId: receipt.workflowRunId,
    observedAtUtc: receipt.observedAtUtc,
    readOnly: true,
    mutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    sourceMutationAllowed: false,
    destructiveGitAllowed: false,
    taskMutationAllowed: false,
    processRestartAllowed: false,
    liveOpenClawUpdateAllowed: false,
    secretValuesExposed: false,
    finalVerdict: receipt.finalVerdict,
  };
  return `${BATTLE_BRIDGE_OUT_OF_BAND_OBSERVER_RECEIPT_MARKER}\n\n\`\`\`json\n${JSON.stringify(bounded, null, 2)}\n\`\`\``;
}
