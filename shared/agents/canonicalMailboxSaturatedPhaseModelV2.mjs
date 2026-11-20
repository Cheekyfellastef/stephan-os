// Goal #2315. Pure structural model for the original saturated-mailbox
// rotation authority. This module grants NO execution, signing, fencing,
// source synchronization, protected merge or native custody authority.
// It is deliberately independent of GitHub, runtime, credentials and clocks.

export const ROTATION_V2_STATES = Object.freeze([
  'PRE_MERGE', 'MERGED_NOT_ADOPTED', 'ADOPTED_NOT_VERIFIED',
  'VERIFIED', 'CANCELLED',
]);
export const ROTATION_V2_OPERATIONS = Object.freeze([
  'FREEZE', 'DRAIN', 'STATUS', 'CANCEL', 'VERIFY',
]);

export const ROTATION_V2_STRUCTURAL_MATRIX = Object.freeze({
  PRE_MERGE: Object.freeze({
    FREEZE: 'PRE_MERGE_EFFECT_CANDIDATE',
    DRAIN: 'PRE_MERGE_EFFECT_CANDIDATE',
    STATUS: 'GUARDED_READ_ONLY_CANDIDATE',
    CANCEL: 'PRE_MERGE_EFFECT_CANDIDATE',
    VERIFY: 'DENY',
  }),
  MERGED_NOT_ADOPTED: Object.freeze({
    FREEZE: 'DENY', DRAIN: 'DENY',
    STATUS: 'MERGED_BRIDGE_READ_ONLY_CANDIDATE',
    CANCEL: 'DENY', VERIFY: 'DENY',
  }),
  ADOPTED_NOT_VERIFIED: Object.freeze({
    FREEZE: 'DENY', DRAIN: 'DENY',
    STATUS: 'GUARDED_READ_ONLY_CANDIDATE',
    CANCEL: 'DENY', VERIFY: 'ADOPTED_VERIFY_CANDIDATE',
  }),
  VERIFIED: Object.freeze({
    FREEZE: 'DENY', DRAIN: 'DENY',
    STATUS: 'HISTORICAL_READ_ONLY',
    CANCEL: 'HISTORICAL_READ_ONLY',
    VERIFY: 'HISTORICAL_READ_ONLY',
  }),
  CANCELLED: Object.freeze({
    FREEZE: 'DENY', DRAIN: 'DENY',
    STATUS: 'HISTORICAL_READ_ONLY',
    CANCEL: 'HISTORICAL_READ_ONLY',
    VERIFY: 'DENY',
  }),
});

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isSha40 = v => typeof v === 'string' && SHA40.test(v);
const isSha256 = v => typeof v === 'string' && SHA256.test(v);
const exactKeys = (o, keys) => {
  try {
    if (o === null || typeof o !== 'object') return false;
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) return false;
    const ownKeys = Reflect.ownKeys(o);
    if (ownKeys.length !== keys.length || keys.some(k => !Object.hasOwn(o, k))) return false;
    // Values are not read from getters or accessors. The trust-boundary verifier
    // must independently reject Proxies and untrusted deserialized objects.
    return ownKeys.every(k => {
      const d = Object.getOwnPropertyDescriptor(o, k);
      return typeof k === 'string' && d && Object.hasOwn(d, 'value');
    });
  } catch { return false; }
};

const SOURCE_KEYS = Object.freeze([
  'protectedMainHead', 'protectedMainTreeSha', 'installedHead',
  'installedTreeSha', 'installedClosureSha256', 'sourceRole',
]);
const ACTIVATION_KEYS = Object.freeze([
  'headSha', 'baseSha', 'treeSha', 'mergeCommitSha', 'mergeTreeSha', 'state',
]);
const EPOCH_KEYS = Object.freeze([
  'predecessorIssue', 'successorIssue', 'activeIssue', 'retiredPredecessor',
]);
const PREPARATION_KEYS = Object.freeze([
  'headSha', 'treeSha', 'closureSha256', 'originalFrozenAuthenticated',
]);

function structuralSourceConsistent(state, source, activation, epoch, preparation) {
  if (!exactKeys(source, SOURCE_KEYS) || !exactKeys(activation, ACTIVATION_KEYS)
    || !exactKeys(epoch, EPOCH_KEYS) || !exactKeys(preparation, PREPARATION_KEYS)) {
    return 'SOURCE_STATE_UNPROVEN';
  }
  if (![source.protectedMainHead, source.protectedMainTreeSha,
    source.installedHead, source.installedTreeSha,
    activation.headSha, activation.baseSha, activation.treeSha,
    preparation.headSha, preparation.treeSha].every(isSha40)
    || !isSha256(source.installedClosureSha256)
    || !isSha256(preparation.closureSha256)
    || (activation.mergeCommitSha !== null && !isSha40(activation.mergeCommitSha))
    || (activation.mergeTreeSha !== null && !isSha40(activation.mergeTreeSha))) {
    return 'SOURCE_STATE_UNPROVEN';
  }
  if (epoch.predecessorIssue !== 3149 || epoch.successorIssue !== 3258
    || !Number.isSafeInteger(epoch.activeIssue)
    || typeof epoch.retiredPredecessor !== 'boolean') return 'EPOCH_STATE_UNPROVEN';
  if (typeof preparation.originalFrozenAuthenticated !== 'boolean')
    return 'SOURCE_STATE_UNPROVEN';

  const isPreparation = source.sourceRole === 'PREPARATION';
  const isAdopted = source.sourceRole === 'ADOPTED';
  const originalInstalled = source.installedHead === preparation.headSha
    && source.installedTreeSha === preparation.treeSha
    && source.installedClosureSha256 === preparation.closureSha256;
  const unchangedPreparation = isPreparation && originalInstalled;
  const merged = activation.state === 'MERGED' &&
    isSha40(activation.mergeCommitSha) && isSha40(activation.mergeTreeSha) &&
    source.protectedMainHead === activation.mergeCommitSha &&
    source.protectedMainTreeSha === activation.mergeTreeSha;
  const originalFrozen = preparation.originalFrozenAuthenticated === true;

  if (state === 'PRE_MERGE') {
    if (activation.state !== 'OPEN' || activation.mergeCommitSha !== null
      || activation.mergeTreeSha !== null || activation.baseSha !== source.protectedMainHead
      || !unchangedPreparation || source.installedHead !== source.protectedMainHead
      || source.installedTreeSha !== source.protectedMainTreeSha
      || epoch.activeIssue !== epoch.predecessorIssue || epoch.retiredPredecessor) {
      return 'SOURCE_STATE_UNPROVEN';
    }
  } else if (state === 'MERGED_NOT_ADOPTED') {
    if (!merged || !unchangedPreparation || !originalFrozen
      || epoch.activeIssue !== epoch.predecessorIssue || epoch.retiredPredecessor
      || source.installedHead === source.protectedMainHead) return 'SOURCE_STATE_UNPROVEN';
  } else if (state === 'ADOPTED_NOT_VERIFIED') {
    if (!merged || !originalFrozen || !isAdopted
      || source.installedHead !== source.protectedMainHead
      || source.installedTreeSha !== source.protectedMainTreeSha
      || epoch.activeIssue !== epoch.successorIssue || !epoch.retiredPredecessor)
      return 'SOURCE_STATE_UNPROVEN';
  } else if (state === 'VERIFIED') {
    if (!merged || !originalFrozen || !isAdopted
      || source.installedHead !== source.protectedMainHead
      || source.installedTreeSha !== source.protectedMainTreeSha
      || epoch.activeIssue !== epoch.successorIssue || !epoch.retiredPredecessor)
      return 'SOURCE_STATE_UNPROVEN';
  } else if (state === 'CANCELLED') {
    if (activation.state !== 'OPEN' || activation.mergeCommitSha !== null
      || activation.mergeTreeSha !== null || !unchangedPreparation
      || source.installedHead !== source.protectedMainHead
      || source.installedTreeSha !== source.protectedMainTreeSha
      || epoch.activeIssue !== epoch.predecessorIssue || epoch.retiredPredecessor)
      return 'SOURCE_STATE_UNPROVEN';
  }
  return '';
}

/**
 * Non-authoritative preflight only. A matching phase is NOT consent or native
 * execution permission. The original trust enrollment, owner comment readback,
 * signed artifact, guard/drain/Actions proof and operation-specific checks must
 * independently validate at the point of effect.
 */
export function classifySaturatedMailboxRotationPhaseV2(input = {}) {
  const result = (blocker, mode = 'DENY') => Object.freeze({
    ok: blocker === '', mode, blocker,
    structuralCandidate: blocker === '' && mode !== 'DENY',
    // These negative outputs are intentionally INVARIANT across every input.
    consentAuthenticated: false, nativeProducerQualified: false,
    signedNativeEvidenceVerified: false, nativeExecutionAuthorized: false,
    sourceMutationAuthorized: false, protectedMergeAuthorized: false,
    freezeCertified: false, epochAdoptionAuthorized: false,
  });
  if (!exactKeys(input, ['state', 'operation', 'source', 'activation', 'epoch', 'preparation']))
    return result('ROTATION_PHASE_INPUT_INVALID');
  const {state, operation, source, activation, epoch, preparation} = input;
  if (!ROTATION_V2_STATES.includes(state) || !ROTATION_V2_OPERATIONS.includes(operation))
    return result('ROTATION_PHASE_OR_OPERATION_INVALID');
  const blocker = structuralSourceConsistent(state, source, activation, epoch, preparation);
  if (blocker) return result(blocker);
  const mode = ROTATION_V2_STRUCTURAL_MATRIX[state][operation];
  return mode === 'DENY' ? result('ROTATION_OPERATION_DENIED_FOR_PHASE') : result('', mode);
}
