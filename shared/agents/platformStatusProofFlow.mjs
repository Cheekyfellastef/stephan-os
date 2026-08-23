export const PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION = 'platform-status-proof-flow.v1';

export const PLATFORM_STATUS_PROOF_FLOW_STATUS = Object.freeze({
  REQUESTED: 'requested',
  COLLECTING: 'collecting',
  VERIFIED: 'verified',
  BLOCKED: 'blocked',
});

export const PLATFORM_STATUS_PROOF_FLOW_GUARDRAILS = Object.freeze({
  fakeHealthyStatusAllowed: false,
  logOnlyProofAllowed: false,
  browserProofRequiredForUiClaims: true,
  mergeAllowed: false,
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

export function buildPlatformStatusProofFlowContract() {
  return Object.freeze({
    schemaVersion: PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
    contractKind: 'stephanos.platform_status_proof_flow.contract',
    statuses: Object.values(PLATFORM_STATUS_PROOF_FLOW_STATUS),
    requiredEvidence: ['support-snapshot', 'ui-reality', 'proof-command'],
    dashboardFields: ['status', 'currentClaim', 'proofRefs', 'blockers', 'finalVerdict'],
    guardrails: { ...PLATFORM_STATUS_PROOF_FLOW_GUARDRAILS },
    finalVerdict: 'PLATFORM_STATUS_PROOF_FLOW_CONTRACT_READY',
  });
}

export function createPlatformStatusProofClaim(input = {}) {
  const claimId = text(input.claimId, `platform-status-${text(input.status, PLATFORM_STATUS_PROOF_FLOW_STATUS.REQUESTED)}`);
  const status = text(input.status, PLATFORM_STATUS_PROOF_FLOW_STATUS.REQUESTED);
  return Object.freeze({
    schemaVersion: PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
    kind: 'stephanos.platform_status_proof_flow.claim',
    claimId,
    status,
    surface: text(input.surface, 'platform-status'),
    summary: text(input.summary, 'Platform status requires reality proof before it can be reported healthy.'),
    supportSnapshotRefs: list(input.supportSnapshotRefs),
    uiRealityRefs: list(input.uiRealityRefs),
    commandProofRefs: list(input.commandProofRefs || input.proofRefs),
    collectedAt: text(input.collectedAt),
  });
}

export function evaluatePlatformStatusProofFlow(input = {}) {
  const claim = createPlatformStatusProofClaim(input.claim || input);
  const blockers = [];
  if (!claim.supportSnapshotRefs.length) blockers.push('MISSING_SUPPORT_SNAPSHOT');
  if (!claim.uiRealityRefs.length) blockers.push('MISSING_UI_REALITY_PROOF');
  if (!claim.commandProofRefs.length) blockers.push('MISSING_COMMAND_PROOF');

  const verified = blockers.length === 0;
  return Object.freeze({
    schemaVersion: PLATFORM_STATUS_PROOF_FLOW_SCHEMA_VERSION,
    kind: 'stephanos.platform_status_proof_flow.evaluation',
    status: verified ? PLATFORM_STATUS_PROOF_FLOW_STATUS.VERIFIED : PLATFORM_STATUS_PROOF_FLOW_STATUS.BLOCKED,
    currentClaim: claim.claimId,
    claim,
    proofRefs: unique([...claim.supportSnapshotRefs, ...claim.uiRealityRefs, ...claim.commandProofRefs]),
    blockers,
    finalVerdict: verified ? 'PLATFORM_STATUS_PROOF_VERIFIED' : 'PLATFORM_STATUS_PROOF_BLOCKED',
  });
}

export const createPlatformStatusProofFlow = evaluatePlatformStatusProofFlow;
