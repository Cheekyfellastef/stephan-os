import { projectGoalBuildGateObservatoryV1 } from './goalBuildGateObservatoryV1.mjs';
export const PUBLIC_GOAL_GATE_SCHEMA_V1 = 'stephanos.public-goal-build-gate-observatory.v1';
const HEAD = /^[0-9a-f]{40}$/;
const ALLOWED_REFS = new Set([
  'workspace:status/stephanos-core-daemon-current.json',
  'workspace:status/stephanos-native-capacity-current.json',
]);
const SAFE_BLOCKER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;

// Called ONLY by Battle Bridge's existing authenticated outbound beacon.
// Suppresses private paths, signed payloads, full status records and keys.
export function projectPublicGoalGateObservatoryV1(coreStatus = null, {
  sourceHead = '', nowMs = Date.now(), verifiedObservatory = null,
} = {}) {
  if (!HEAD.test(sourceHead)) return null;
  const sourceBound = coreStatus?.sourceHead === sourceHead
    && coreStatus?.goalBuildGateEvidence?.sourceHead === sourceHead;
  // Pages receives all 23 named gates even before the steward starts. In that
  // case all are unverified. An absent/stale core record NEVER makes green.
  const obs = verifiedObservatory?.sourceHead === sourceHead
    && verifiedObservatory?.schemaVersion === 'stephanos.goal-build-gate-observatory.v1'
    && Array.isArray(verifiedObservatory?.gates) && verifiedObservatory.gates.length === 23
    ? verifiedObservatory
    : projectGoalBuildGateObservatoryV1({
      statusRecords: sourceBound ? [coreStatus] : [],
      nowMs, staleAfterMs: 3 * 60_000,
    });
  return Object.freeze({
    schemaVersion: PUBLIC_GOAL_GATE_SCHEMA_V1,
    sourceHead, observedAtUtc: obs.observedAtUtc,
    observationStatus: obs.observationStatus,
    diagnosticOnly: true,
    approvalAuthority: false, mergeAuthority: false,
    firstActionableGate: obs.firstActionableGate,
    simultaneousVetoes: obs.simultaneousVetoes,
    counts: obs.counts,
    gates: Object.freeze(obs.gates.map(g => Object.freeze({
      id: g.id, title: g.title, owner: g.owner, group: g.group,
      status: g.status,
      typedBlocker: SAFE_BLOCKER.test(g.typedBlocker || '') ? g.typedBlocker : '',
      waitingOnGate: g.waitingOnGate,
      proofRef: ALLOWED_REFS.has(g.proofRef) || /^workspace:proof\/goal-gate-(?:[1-9]|1[0-9]|2[0-3])$/.test(String(g.proofRef || '')) ? g.proofRef : '',
      observedAtUtc: g.observedAtUtc,
    }))),
  });
}
