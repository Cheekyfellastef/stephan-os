import {
  OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS,
  evaluateOpenClawUpdateCapabilityOutcomeV1,
} from './openClawUpdateCapabilityOutcomeV1.mjs';
import {
  OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS,
  evaluateOpenClawUpdateCapabilityCandidateV1,
} from './openClawUpdateCapabilityCandidateGateV1.mjs';

export const OPENCLAW_UPDATE_FINAL_ACCEPTANCE_SCHEMA = 'stephanos.openclaw-update-final-acceptance.v1';
export const OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS = Object.freeze({
  BLOCK_UPDATE: 'BLOCK_UPDATE',
  PRE_UPDATE_READY: 'PRE_UPDATE_EQUAL_OR_BETTER_READY',
  POST_UPDATE_PROOF_REQUIRED: 'POST_UPDATE_PROOF_REQUIRED',
  POST_UPDATE_FAILED: 'POST_UPDATE_FAILED_ROLLBACK_REQUIRED',
  UPDATED_AND_VERIFIED: 'UPDATED_AND_EQUAL_OR_BETTER_VERIFIED',
  ROLLED_BACK: 'ROLLED_BACK_AND_CAPABILITIES_PRESERVED',
});

const INPUT_KEYS = Object.freeze([
  'stagedUpdate',
  'capabilityLedger',
  'capabilityComparisons',
  'qualificationReplay',
]);

function dataRecord(value, expectedKeys = null) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return null;
    const actual = ownKeys.map(String).sort();
    if (expectedKeys) {
      const wanted = [...expectedKeys].sort();
      if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) return null;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const snapshot = {};
    for (const key of actual) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function output({ status, blockers = [], capabilityOutcome = null, candidateGate = null, rollbackRequired = false }) {
  const accepted = status === OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.UPDATED_AND_VERIFIED;
  return Object.freeze({
    schemaVersion: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_SCHEMA,
    status,
    blockers: Object.freeze([...new Set(blockers)].sort()),
    capabilityOutcome,
    candidateGate,
    updatePromotionAllowed: accepted,
    providerRoutingResumeAllowed: accepted,
    rollbackRequired,
    authority: Object.freeze({
      updateExecutionAllowed: false,
      runtimeMutationAllowed: false,
      sourceMutationAllowed: false,
      approvalAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      providerQualificationAllowed: false,
    }),
  });
}

export function evaluateOpenClawUpdateFinalAcceptanceV1(input = {}) {
  const snapshot = dataRecord(input, INPUT_KEYS);
  if (!snapshot) return output({ status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.BLOCK_UPDATE, blockers: ['FINAL_ACCEPTANCE_SCHEMA_INVALID'] });

  const capabilityOutcome = evaluateOpenClawUpdateCapabilityOutcomeV1({
    capabilityLedger: snapshot.capabilityLedger,
    comparisons: snapshot.capabilityComparisons,
  });
  if (capabilityOutcome.status !== OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.EQUAL_OR_BETTER) {
    return output({
      status: capabilityOutcome.status === OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.REGRESSION
        ? OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_FAILED
        : OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.BLOCK_UPDATE,
      blockers: capabilityOutcome.blockers,
      capabilityOutcome,
      rollbackRequired: capabilityOutcome.status === OPENCLAW_UPDATE_CAPABILITY_OUTCOME_STATUS.REGRESSION,
    });
  }

  const candidateGate = evaluateOpenClawUpdateCapabilityCandidateV1({
    stagedUpdate: snapshot.stagedUpdate,
    capabilityLedger: snapshot.capabilityLedger,
    qualificationReplay: snapshot.qualificationReplay,
  });

  switch (candidateGate.status) {
    case OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.PRE_UPDATE_CAPABILITY_GATE_READY:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.PRE_UPDATE_READY,
        capabilityOutcome,
        candidateGate,
      });
    case OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_PROOF_REQUIRED:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_PROOF_REQUIRED,
        blockers: candidateGate.blockers,
        capabilityOutcome,
        candidateGate,
      });
    case OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.POST_UPDATE_CAPABILITY_REPLAY_FAILED:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_FAILED,
        blockers: candidateGate.blockers,
        capabilityOutcome,
        candidateGate,
        rollbackRequired: true,
      });
    case OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.UPDATED_AND_CAPABILITIES_VERIFIED:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.UPDATED_AND_VERIFIED,
        capabilityOutcome,
        candidateGate,
      });
    case OPENCLAW_UPDATE_CAPABILITY_CANDIDATE_STATUS.ROLLED_BACK_AND_CAPABILITIES_PRESERVED:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.ROLLED_BACK,
        capabilityOutcome,
        candidateGate,
      });
    default:
      return output({
        status: OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.BLOCK_UPDATE,
        blockers: candidateGate.blockers,
        capabilityOutcome,
        candidateGate,
        rollbackRequired: candidateGate.rollbackRequired === true,
      });
  }
}
