function text(v, f = '') { const s = String(v ?? '').trim(); return s || f; }
function list(v) { return Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : String(v || '').split('|').map((x) => text(x)).filter(Boolean); }
function unique(v) { return Array.from(new Set(list(v))); }
function normProof(v) { return text(v).replace(/^missing-/, '').replace(/-missing$/, '').replace(/^browser-proof$/, 'browser-proof-checklist').replace(/^build$/, 'build-proof').replace(/^verify$/, 'verify-proof'); }
function yes(v) { return v === true || text(v).toLowerCase() === 'yes'; }
function firstObject(...values) { return values.find((v) => v && typeof v === 'object') || {}; }

export const COCKPIT_PROJECTION_FIELDS = Object.freeze([
  'currentMission','currentStatus','acceptedProof','missingProof','missingProofCount','nextBestAction','mergeSafety','whoShouldActNext','recommendedPacket','recommendedSurface','openClawMutationLockState','codexMutationLockState','lastCommandDeckIntakeResult','evidenceIntakeState','latestCommandDeckIntakeClassification','packetBayRecommendation','arlRecommendation','mergeReadiness','mergeBlockers','nextProofToCollect','debugDrilldown'
]);

export function buildCockpitProjection(input = {}) {
  const runtime = input.runtimeStatusModel || input.runtimeStatus || input.project?.runtimeStatusModel || {};
  const relief = firstObject(runtime.operatorReliefProjection, input.operatorReliefProjection);
  const reconciliation = firstObject(runtime.missionProofReconciliation, relief.missionProofReconciliation, input.missionProofReconciliation);
  const ledger = firstObject(runtime.missionEvidenceLedgerProjection, relief.missionEvidenceLedgerProjection, input.missionEvidenceLedgerProjection);
  const awareness = firstObject(runtime.projectAwarenessProjection, relief.projectAwarenessProjection, input.projectAwarenessProjection);
  const arl = firstObject(runtime.agentRealityLoopProjection, relief.agentRealityLoopProjection, input.agentRealityLoopProjection);
  const packetBay = firstObject(runtime.packetBayProjection, relief.packetBayProjection, input.packetBayProjection);
  const builderMesh = firstObject(runtime.builderMeshProjection, relief.builderMeshProjection, input.builderMeshProjection);
  const evidenceIntake = firstObject(runtime.commandDeckUniversalIntake?.evidenceReturnIntakeProjection, runtime.evidenceReturnIntakeProjection, input.evidenceReturnIntakeProjection);
  const uiReality = firstObject(runtime.uiRealityTruth, relief.uiRealityTruth, input.uiRealityTruth);
  const prEvidence = firstObject(runtime.prEvidenceModel, runtime.githubPrEvidence, input.prEvidenceModel);

  const acceptedProof = unique(reconciliation.acceptedItems || reconciliation.acceptedProof || ledger.acceptedProof).map(normProof);
  const missingSource = reconciliation.remainingMissingItems || reconciliation.missingProof || ledger.missingProof || ledger.missingProofSummary || arl.missingProof || arl.supportSnapshotFields?.agent_reality_loop_missing_proof_summary || packetBay.missingProof;
  const missingProof = unique(missingSource).map(normProof).filter(Boolean);
  const nextProofToCollect = missingProof[0] || text(ledger.nextRequiredEvidence, 'operator-review');
  const mergeReadiness = text(prEvidence.mergeReadiness || runtime.prEvidenceMergeReadiness || arl.mergeRecommendation || ledger.mergeReadiness, 'hold').toLowerCase();
  const mergeSafe = ['merge-candidate', 'ready', 'safe', 'already-merged'].includes(mergeReadiness) && missingProof.length === 0 && (ledger.trustedForMerge === true || yes(runtime.trustedForMerge));
  const openClawLocked = arl.openClawMutationLocked !== false && ledger.openClawMutationLocked !== false && !yes(runtime.openClawMutationAllowed);
  const intakeClass = text(runtime.commandDeckUniversalIntake?.classification || evidenceIntake.classification || evidenceIntake.intent || runtime.lastCommandDeckIntakeClassification, 'unavailable');

  return {
    projectionId: 'operator-cockpit-view-v1',
    projectionSource: 'canonical-cockpit-projection-runtime-truth-v1',
    currentMission: text(awareness.title || awareness.missionTitle || ledger.missionTitle || runtime.currentMission, 'Current Stephanos mission'),
    currentStatus: text(awareness.status || ledger.status || arl.status || 'monitoring'),
    acceptedProof,
    missingProof,
    missingProofCount: missingProof.length,
    nextProofToCollect,
    nextBestAction: text(reconciliation.nextBestAction || ledger.nextAction || (missingProof.length ? `Collect ${nextProofToCollect}.` : ''), missingProof.length ? `Collect ${nextProofToCollect}.` : 'Review evidence and hold for operator merge decision.'),
    mergeSafety: mergeSafe ? 'yes / candidate' : 'no / hold',
    mergeReadiness: mergeSafe ? 'candidate' : 'hold',
    mergeBlockers: missingProof.length ? missingProof : unique(prEvidence.missingProof || ledger.mergeBlockers),
    whoShouldActNext: missingProof.length ? 'Codex / Operator proof collector' : 'Operator',
    recommendedPacket: text(packetBay.recommendedPacketId || packetBay.recommendedPacket || packetBay.nextPacketId || 'proof-collection-packet'),
    recommendedSurface: text(packetBay.recommendedSurface || builderMesh.recommendedSurface || 'Command Deck'),
    openClawMutationLockState: openClawLocked ? 'locked' : 'unlocked',
    codexMutationLockState: ledger.codexAutoDispatchAllowed === true ? 'dispatch-allowed' : 'locked',
    lastCommandDeckIntakeResult: text(evidenceIntake.result || evidenceIntake.status || runtime.lastCommandDeckIntakeResult || 'unavailable'),
    evidenceIntakeState: text(evidenceIntake.status || evidenceIntake.intakeStatus || 'unavailable'),
    latestCommandDeckIntakeClassification: intakeClass,
    packetBayRecommendation: text(packetBay.nextAction || packetBay.recommendation || 'Collect missing proof through Packet Bay.'),
    arlRecommendation: text(arl.nextAction || arl.recommendation || arl.mergeRecommendation || 'Hold mutation until evidence is trusted.'),
    uiRealityState: text(uiReality.status || 'unavailable'),
    builderMeshRecommendation: text(builderMesh.nextBestAction || builderMesh.recommendedBuilder || 'Review Builder Mesh truth.'),
    debugDrilldown: { ledgerSource: text(ledger.projectionSource, 'none'), reconciliationStatus: text(reconciliation.status, 'unavailable'), rawDiagnosticsAvailable: true },
  };
}

export function renderCockpitSummaryMarkup(projection = {}) {
  const p = projection?.projectionSource ? projection : buildCockpitProjection(projection);
  const escape = (v) => String(v ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div class="cockpit-summary-view" data-cockpit-projection="operator-cockpit-view-v1"><div><strong>Mission status:</strong> ${escape(p.currentStatus)}</div><div><strong>Next best action:</strong> ${escape(p.nextBestAction)}</div><div><strong>Missing proof:</strong> ${p.missingProofCount}</div><div><strong>Merge safety:</strong> ${escape(p.mergeSafety)}</div></div>`;
}
