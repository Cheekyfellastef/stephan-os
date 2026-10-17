// Fixed, non-privileged execution slice inside the original Core daemon.
// Gate 13 signed capacity can be rechecked while Gate 8 original custody
// remains held. This is deliberately NOT a source/lease/Windows-task repair.
import { createHash } from 'node:crypto';

export const GATE_READ_ONLY_EXECUTION_SCHEMA_V1 = 'stephanos.goal-gate-readonly-execution.v1';
const HEAD = /^[a-f0-9]{40}$/;
const SAFE_REASON = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function hold(sourceHead, reason) {
  return Object.freeze({
    schemaVersion: GATE_READ_ONLY_EXECUTION_SCHEMA_V1,
    sourceHead: HEAD.test(sourceHead) ? sourceHead : '',
    mode: 'READ_ONLY_HOLD', attempted: false, passed: false,
    gateId: 0, reason, proofHash: '',
    originalSourceLeaseUntouched: true, sourceMutationAllowed: false,
    windowsTaskMutationAllowed: false, mergeAuthority: false,
    admissionAuthority: false, approvalAuthority: false,
  });
}

export async function executeCoreGateReadOnlyActionV1(steward = {}, {
  sourceHead = '', observedAtUtc = '', nowUtc = '',
  gamingProtected = false, probeNativeRouting,
} = {}) {
  const nowMs = Date.parse(nowUtc);
  const observedMs = Date.parse(observedAtUtc);
  if (!HEAD.test(sourceHead) || steward.observedHead !== sourceHead ||
      !Number.isFinite(nowMs) || !Number.isFinite(observedMs) ||
      observedMs > nowMs + 60_000 || nowMs - observedMs > 120_000) {
    return hold(sourceHead, 'GATE_READ_ONLY_SOURCE_OR_FRESHNESS_UNPROVEN');
  }
  if (gamingProtected || steward.decision === 'GAMING_PROTECTED') {
    return hold(sourceHead, 'GATE_READ_ONLY_GAMING_PROTECTED');
  }
  // Do not treat a proposal for protected evidence, signer, Windows custody,
  // quarantine or lease action as an automatic grant.
  const action = steward.nextAction;
  if (steward.mode !== 'SHADOW_READ_ONLY' ||
      steward.decision !== 'PROPOSE_EXISTING_AUTHORITY_ACTION' ||
      action?.gateId !== 13 ||
      action?.action !== 'RECHECK_SIGNED_NATIVE_PUBLISHER' ||
      action?.authority !== 'native-capacity-publisher' ||
      action?.mode !== 'READ_ONLY' ||
      action?.proofRef !== 'workspace:status/stephanos-native-capacity-current.json') {
    return hold(sourceHead, 'GATE_READ_ONLY_ACTION_NOT_QUALIFIED');
  }
  if (typeof probeNativeRouting !== 'function') {
    return hold(sourceHead, 'GATE_READ_ONLY_PROBE_UNAVAILABLE');
  }
  let signedCapacityProven = false;
  let reason = '';
  try {
    // Fixed, trusted local verifier. No caller-defined executable, URL, path,
    // restart or arbitrary shell is accepted by this adapter.
    const result = await probeNativeRouting();
    signedCapacityProven = result?.ok === true &&
      result?.candidate?.sourceHead === sourceHead;
    reason = signedCapacityProven ? 'SIGNED_NATIVE_CAPACITY_CURRENT' :
      String(result?.reason || 'SIGNED_NATIVE_CAPACITY_NOT_PROVEN');
  } catch {
    reason = 'GATE_READ_ONLY_PROBE_FAILED';
  }
  if (!SAFE_REASON.test(reason)) reason = 'SIGNED_NATIVE_CAPACITY_NOT_PROVEN';
  const outcome = Object.freeze({
    schemaVersion: GATE_READ_ONLY_EXECUTION_SCHEMA_V1,
    sourceHead, observedAtUtc: nowUtc, mode: 'BOUNDED_READ_ONLY_EXECUTED',
    attempted: true, passed: signedCapacityProven,
    gateId: 13, action: 'RECHECK_SIGNED_NATIVE_PUBLISHER',
    reason,
    // A signed observation is not a native task repair or a green 23-gate
    // chain. Core will resample the full proof-backed gate state separately.
    gateClearedByThisAction: false,
    originalSourceLeaseUntouched: true, sourceMutationAllowed: false,
    windowsTaskMutationAllowed: false, mergeAuthority: false,
    admissionAuthority: false, approvalAuthority: false,
  });
  return Object.freeze({
    ...outcome,
    proofHash: createHash('sha256').update(JSON.stringify(outcome)).digest('hex'),
  });
}
