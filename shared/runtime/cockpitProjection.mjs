function text(v, f = '') { const s = String(v ?? '').trim(); return s || f; }
function list(v) { return Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : String(v || '').split('|').map((x) => text(x)).filter(Boolean); }
function unique(v) { return Array.from(new Set(list(v))); }
function normProof(v) { return text(v).replace(/^missing-/, '').replace(/-missing$/, '').replace(/^browser-proof$/, 'browser-proof-checklist').replace(/^build$/, 'build-proof').replace(/^verify$/, 'verify-proof'); }
function yes(v) { return v === true || text(v).toLowerCase() === 'yes'; }
function firstObject(...values) { return values.find((v) => v && typeof v === 'object') || {}; }

export const COCKPIT_PROJECTION_FIELDS = Object.freeze([
  'currentMission','currentStatus','acceptedProof','missingProof','missingProofCount','cockpitActionStatus','cockpitPrimaryActionLabel','cockpitPrimaryActionTargetSurface','cockpitPrimaryActionTargetPaneId','cockpitPrimaryActionTargetPacketId','cockpitPrimaryActionKind','cockpitPrimaryActionReason','cockpitSecondaryActions','cockpitActionMutationAllowed','cockpitActionRequiresOperatorApproval','cockpitActionSource','nextBestAction','mergeSafety','whoShouldActNext','recommendedPacket','recommendedSurface','openClawMutationLockState','codexMutationLockState','lastCommandDeckIntakeResult','evidenceIntakeState','latestCommandDeckIntakeClassification','packetBayRecommendation','arlRecommendation','mergeReadiness','mergeBlockers','nextProofToCollect','debugDrilldown'
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

  const actionModel = deriveCockpitActionModel({
    projectionSource: 'canonical-cockpit-projection-runtime-truth-v1',
    missingProof, nextProofToCollect, nextBestAction: text(reconciliation.nextBestAction || ledger.nextAction || (missingProof.length ? `Collect ${nextProofToCollect}.` : ''), missingProof.length ? `Collect ${nextProofToCollect}.` : 'Review evidence and hold for operator merge decision.'),
    mergeSafety: mergeSafe ? 'yes / candidate' : 'no / hold', recommendedPacket: text(packetBay.recommendedPacketId || packetBay.recommendedPacket || packetBay.nextPacketId || 'proof-collection-packet'), recommendedSurface: text(packetBay.recommendedSurface || builderMesh.recommendedSurface || 'Command Deck'), packetBayRecommendation: text(packetBay.nextAction || packetBay.recommendation || 'Collect missing proof through Packet Bay.'), lastCommandDeckIntakeResult: text(evidenceIntake.result || evidenceIntake.status || runtime.lastCommandDeckIntakeResult || 'unavailable'), evidenceIntakeState: text(evidenceIntake.status || evidenceIntake.intakeStatus || 'unavailable'), openClawMutationLockState: openClawLocked ? 'locked' : 'unlocked', codexMutationLockState: ledger.codexAutoDispatchAllowed === true ? 'dispatch-allowed' : 'locked',
  });

  return {
    projectionId: 'operator-cockpit-view-v1',
    projectionSource: 'canonical-cockpit-projection-runtime-truth-v1',
    currentMission: text(awareness.title || awareness.missionTitle || ledger.missionTitle || runtime.currentMission, 'Current Stephanos mission'),
    currentStatus: text(awareness.status || ledger.status || arl.status || (missingProof.length ? 'blocked' : 'ready')),
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
    ...actionModel,
    debugDrilldown: { ledgerSource: text(ledger.projectionSource, 'none'), reconciliationStatus: text(reconciliation.status, 'unavailable'), rawDiagnosticsAvailable: true },
  };
}

export function deriveCockpitActionModel(projection = {}) {
  const p = projection?.projectionSource ? projection : buildCockpitProjection(projection);
  const missing = unique(p.missingProof).map(normProof);
  const firstMissing = normProof(p.nextProofToCollect || missing[0] || '');
  const recommendedPacket = text(p.recommendedPacket, 'proof-collection-packet');
  const base = {
    cockpitActionStatus: 'available',
    cockpitPrimaryActionLabel: 'Open proof intake',
    cockpitPrimaryActionTargetSurface: text(p.recommendedSurface, 'Command Deck'),
    cockpitPrimaryActionTargetPaneId: 'commandDeck',
    cockpitPrimaryActionTargetPacketId: recommendedPacket,
    cockpitPrimaryActionKind: 'focus-proof-intake',
    cockpitPrimaryActionReason: `Derived from canonical cockpit projection: ${text(p.nextBestAction, 'collect proof')}`,
    cockpitSecondaryActions: [],
    cockpitActionMutationAllowed: 'no',
    cockpitActionRequiresOperatorApproval: 'yes',
    cockpitActionSource: 'canonical cockpit projection',
  };
  const setProof = (proof) => ({ ...base, cockpitPrimaryActionLabel: `Collect ${proof}`, cockpitPrimaryActionTargetSurface: 'Command Deck / Evidence Return Intake', cockpitPrimaryActionTargetPaneId: 'commandDeck', cockpitPrimaryActionTargetPacketId: `packet-${proof}`, cockpitPrimaryActionKind: 'focus-proof-intake', cockpitPrimaryActionReason: `Missing proof ${proof} is next in canonical cockpit projection.` });
  if (firstMissing === 'build-proof') return setProof('build-proof');
  if (firstMissing === 'verify-proof') return setProof('verify-proof');
  if (firstMissing === 'browser-proof-checklist') return { ...base, cockpitPrimaryActionLabel: 'Collect browser proof', cockpitPrimaryActionTargetSurface: 'Browser Proof checklist', cockpitPrimaryActionTargetPaneId: 'missionConsolePanel', cockpitPrimaryActionTargetPacketId: 'packet-browser-proof-checklist', cockpitPrimaryActionKind: 'focus-browser-proof', cockpitPrimaryActionReason: 'Browser proof checklist is next in canonical cockpit projection.' };
  if (firstMissing === 'pr-evidence') return { ...base, cockpitPrimaryActionLabel: 'Collect PR evidence', cockpitPrimaryActionTargetSurface: 'PR Evidence / Packet Bay', cockpitPrimaryActionTargetPaneId: 'missionConsolePanel', cockpitPrimaryActionTargetPacketId: 'packet-pr-evidence', cockpitPrimaryActionKind: 'focus-pr-evidence', cockpitPrimaryActionReason: 'PR evidence is next in canonical cockpit projection.' };
  if (firstMissing === 'source-pack-output') return { ...base, cockpitPrimaryActionLabel: 'Collect source-pack output', cockpitPrimaryActionTargetSurface: 'Source Pack / Builder Workbench', cockpitPrimaryActionTargetPaneId: 'missionConsolePanel', cockpitPrimaryActionTargetPacketId: 'packet-source-pack-output', cockpitPrimaryActionKind: 'focus-source-pack', cockpitPrimaryActionReason: 'Source Pack output is next in canonical cockpit projection.' };
  if (String(p.mergeSafety || '').toLowerCase().includes('hold')) return { ...base, cockpitPrimaryActionLabel: 'Review proof blockers', cockpitPrimaryActionKind: 'focus-proof-intake', cockpitPrimaryActionReason: 'Merge is hold; cockpit routing never exposes merge as a primary action.' };
  return { ...base, cockpitPrimaryActionLabel: 'Review evidence packets', cockpitPrimaryActionTargetSurface: 'Packet Bay', cockpitPrimaryActionTargetPaneId: 'missionConsolePanel', cockpitPrimaryActionKind: 'focus-packet-bay' };
}

export function cockpitRenderSignature(projection = {}) {
  return [
    text(projection.currentStatus, 'unknown'),
    Array.isArray(projection.acceptedProof) ? projection.acceptedProof.join('|') : text(projection.acceptedProof, 'none'),
    Array.isArray(projection.missingProof) ? projection.missingProof.join('|') : text(projection.missingProof, 'none'),
    String(Number(projection.missingProofCount || 0)),
    text(projection.nextBestAction, 'n/a'),
    text(projection.mergeSafety, 'no / hold'),
    text(projection.openClawMutationLockState, 'locked'),
    text(projection.codexMutationLockState, 'locked'),
  ].join(' :: ');
}

export function renderCockpitSummaryMarkup(projection = {}) {
  const p = projection?.projectionSource ? projection : buildCockpitProjection(projection);
  const escape = (v) => String(v ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const signature = cockpitRenderSignature(p);
  const status = escape(p.currentStatus || 'monitoring');
  const missing = Number(p.missingProofCount || 0);
  const hold = String(p.mergeSafety || '').toLowerCase().includes('hold') ? 'hold' : 'clear';
  return `<div class="cockpit-summary-view cockpit-summary-compact cockpit-shortcut-card" data-cockpit-surface="landing-tile" data-cockpit-projection="operator-cockpit-view-v1" data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature="${escape(signature)}" data-cockpit-visible-detail-field-count="0" data-cockpit-shortcut-role="preserved"><section class="cockpit-visual-dashboard cockpit-visual-compact" data-cockpit-block="shortcut-visual" data-cockpit-kind="visual" data-cockpit-surface="landing-tile" data-cockpit-visual="true" data-cockpit-animation-enabled="yes" data-cockpit-animation-mode="subtle" data-cockpit-animated-elements="status-orb|proof-strip|next-action-beacon|lock-chips" data-cockpit-animation-truth-impact="none" data-cockpit-reduced-motion-respected="yes" data-cockpit-projection-source="canonical cockpit projection" data-cockpit-render-signature="${escape(signature)}" aria-label="Cockpit shortcut visual"><div class="cockpit-visual-orb" data-cockpit-visual-current-status="${status}"><span>Cockpit</span></div><div class="cockpit-visual-proof-strip" data-cockpit-visual-missing-count="${missing}"><span class="proof-missing">${status}</span><span class="proof-missing">missing ${missing}</span><span class="cockpit-chip cockpit-lock-chip">merge ${hold}</span></div></section><div class="cockpit-shortcut-copy" data-cockpit-block="summary-readout" data-cockpit-kind="text" data-cockpit-text="true"><strong>Cockpit</strong><span>Shortcut to the canonical Stephanos cockpit.</span><span class="cockpit-pointer">Open Cockpit →</span></div></div>`;
}
