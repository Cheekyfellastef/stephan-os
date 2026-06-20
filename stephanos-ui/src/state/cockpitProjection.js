function text(v, f = '') { const s = String(v ?? '').trim(); return s || f; }
function list(v) { return Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : String(v || '').split('|').map((x) => text(x)).filter(Boolean); }
function unique(v) { return Array.from(new Set(list(v))); }
function normProof(v) { return text(v).replace(/^missing-/, '').replace(/-missing$/, '').replace(/^browser-proof$/, 'browser-proof-checklist').replace(/^build$/, 'build-proof').replace(/^verify$/, 'verify-proof'); }
function yes(v) { return v === true || text(v).toLowerCase() === 'yes'; }

const PROOF_ORDER = Object.freeze(['build-proof', 'verify-proof', 'browser-proof-checklist', 'pr-evidence', 'source-pack-output']);

export const OPERATOR_PROOF_CONCIERGE_BROWSER_PACKET = `Browser proof checklist completed manually.

Observed in live browser:
- Cockpit pane opens and remains visible.
- Cockpit primary dashboard is visible.
- Command Deck proof submit lifecycle works: Execute clears the input field after accepted proof.
- Submitted proof remains visible in Command Deck answer history/echo.
- Cockpit Action Routing focuses the correct target safely.
- No command was auto-run by cockpit routing.
- No Codex auto-dispatch occurred.
- OpenClaw mutation remained locked.
- Merge readiness remained no / hold.
- No obvious broken collapse/pane behaviour was visible.
- No red runtime error overlay was visible.

Known caveat:
- Expanded Cockpit visual/text readouts may still drift from canonical projection values, but cockpit/action routing uses canonical projection and not rendered text.

This browser proof is accepted for current manual UI behaviour, while preserving the known cockpit visual/text drift caveat.`;

function proofPacketFor(target) {
  if (target === 'build-proof') return `Build proof completed manually.

Paste exact build evidence here:
- Command run:
- Result: pass/fail
- Key output summary:
- Generated dist not committed: yes
- Merge readiness remains no / hold until all proof is complete.`;
  if (target === 'verify-proof') return `Verify proof completed manually.

Paste exact verify evidence here:
- Command run:
- Result: pass/fail
- Key output summary:
- Build proof remains accepted: yes
- Generated dist not committed: yes
- Merge readiness remains no / hold until all proof is complete.`;
  if (target === 'browser-proof-checklist') return OPERATOR_PROOF_CONCIERGE_BROWSER_PACKET;
  if (target === 'pr-evidence') return `PR evidence packet.

Provide:
- PR URL or PR number if available:
- Branch/commit evidence:
- Clean status evidence:
- Guard verdict:
- No generated dist committed: yes/no
- Merge still held until source-pack-output exists: yes`;
  if (target === 'source-pack-output') return `Source-pack proof packet.

Provide:
- Changed files summary:
- Committed source-only proof:
- Generated dist excluded proof:
- Tests/build/verify summary:
- Guard/pr-clean result:
- Final clean git status:`;
  if (target === 'proof-state-reconciliation') return `Proof-state diagnostic packet.

Contradiction detected:
- Merge is hold but missing proof is none; reconcile mission proof state, merge blockers, PR evidence, and source-pack output.

Operator diagnostic checklist:
- Compare Mission Proof Accepted Items against required proof order.
- Compare Mission Proof Remaining Missing Items against Operator Cockpit Missing Proof.
- Inspect merge blockers, PR evidence status, and source-pack-output status.
- Keep merge readiness as no / hold until the contradiction is reconciled.
- Do not auto-submit, auto-run commands, dispatch Codex, or unlock OpenClaw.`;
  return '';
}

function mergeIsHold(value) { return String(value || '').toLowerCase().includes('hold') || String(value || '').toLowerCase().includes('no'); }

export function buildOperatorProofConciergeProjection(input = {}) {
  const reconciliation = firstObject(input.missionProofReconciliation, input.reconciliation);
  const accepted = unique(reconciliation.acceptedItems || reconciliation.acceptedProof || input.acceptedProof).map(normProof);
  const missing = unique(reconciliation.remainingMissingItems || reconciliation.missingProof || input.missingProof).map(normProof).filter(Boolean);
  const missingSet = new Set(missing);
  const nextProof = PROOF_ORDER.find((proof) => missingSet.has(proof)) || missing[0] || '';
  const mergeSafety = input.mergeSafety || 'no / hold';
  const contradictionDetected = !nextProof && missing.length === 0 && mergeIsHold(mergeSafety);
  const effectiveNextProof = contradictionDetected ? 'proof-state-reconciliation' : nextProof;
  const packetText = proofPacketFor(effectiveNextProof);
  const openClawLocked = input.openClawMutationLockState === 'locked' || input.openClawMutationLocked !== false;
  const codexAllowed = input.codexAutoDispatchAllowed === true || input.codexMutationLockState === 'dispatch-allowed';
  return {
    status: nextProof ? 'available' : (contradictionDetected ? 'blocked' : 'complete'),
    nextProof: effectiveNextProof || 'none',
    nextActionLabel: nextProof ? (nextProof === 'browser-proof-checklist' ? 'Copy browser proof checklist' : nextProof === 'pr-evidence' ? 'Copy PR evidence packet' : nextProof === 'source-pack-output' ? 'Copy source-pack output packet' : `Copy ${nextProof} packet`) : (contradictionDetected ? 'Copy proof-state diagnostic packet' : 'Review proof state'),
    whyThisProofIsNeeded: nextProof ? `${nextProof} is the next missing proof in canonical Mission Proof Reconciliation order.` : (contradictionDetected ? 'Merge is hold but canonical Mission Proof Reconciliation reports no remaining missing proof; diagnostic reconciliation is required.' : 'No missing proof target is available from canonical Mission Proof Reconciliation.'),
    copyPacketAvailable: packetText ? 'yes' : 'no',
    packetKind: effectiveNextProof || 'none',
    packetText,
    packetLength: String(packetText.length),
    proofStateContradictionDetected: contradictionDetected ? 'yes' : 'no',
    contradictionReason: contradictionDetected ? 'Merge is hold but missing proof is none; reconcile mission proof state, merge blockers, PR evidence, and source-pack output.' : 'none',
    usesCanonicalProofState: 'yes',
    mutationAllowed: 'no',
    codexAutoDispatchAllowed: codexAllowed ? 'yes' : 'no',
    openClawMutationLocked: openClawLocked ? 'yes' : 'no',
    mergeSafety,
    lastCopyResult: text(input.lastCopyResult, 'none'),
  };
}

function firstObject(...values) { return values.find((v) => v && typeof v === 'object') || {}; }

export const COCKPIT_PROJECTION_FIELDS = Object.freeze([
  'currentMission','currentStatus','operatorProofConcierge','acceptedProof','missingProof','missingProofCount','cockpitActionStatus','cockpitPrimaryActionLabel','cockpitPrimaryActionTargetSurface','cockpitPrimaryActionTargetPaneId','cockpitPrimaryActionTargetPacketId','cockpitPrimaryActionKind','cockpitPrimaryActionReason','cockpitSecondaryActions','cockpitActionMutationAllowed','cockpitActionRequiresOperatorApproval','cockpitActionSource','nextBestAction','mergeSafety','whoShouldActNext','recommendedPacket','recommendedSurface','openClawMutationLockState','codexMutationLockState','lastCommandDeckIntakeResult','evidenceIntakeState','latestCommandDeckIntakeClassification','packetBayRecommendation','arlRecommendation','mergeReadiness','mergeBlockers','nextProofToCollect','debugDrilldown'
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

  const conciergeProjection = buildOperatorProofConciergeProjection({ missionProofReconciliation: { ...reconciliation, remainingMissingItems: missingProof }, mergeSafety: mergeSafe ? 'yes / candidate' : 'no / hold', openClawMutationLockState: openClawLocked ? 'locked' : 'unlocked', codexMutationLockState: ledger.codexAutoDispatchAllowed === true ? 'dispatch-allowed' : 'locked' });

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
    operatorProofConcierge: conciergeProjection,
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
  if (firstMissing === 'browser-proof-checklist') return { ...base, cockpitPrimaryActionLabel: 'Copy browser proof checklist', cockpitPrimaryActionTargetPacketId: 'packet-browser-proof-checklist', cockpitPrimaryActionKind: 'focus-concierge-packet', cockpitPrimaryActionTargetSurface: 'Operator Proof Concierge', cockpitPrimaryActionReason: 'Browser proof checklist packet is next in canonical proof concierge projection.' };
  if (firstMissing === 'pr-evidence') return { ...base, cockpitPrimaryActionLabel: 'Copy PR evidence packet', cockpitPrimaryActionTargetPacketId: 'packet-pr-evidence', cockpitPrimaryActionKind: 'focus-concierge-packet', cockpitPrimaryActionTargetSurface: 'Operator Proof Concierge', cockpitPrimaryActionReason: 'PR evidence packet is next in canonical proof concierge projection.' };
  if (firstMissing === 'source-pack-output') return { ...base, cockpitPrimaryActionLabel: 'Copy source-pack output packet', cockpitPrimaryActionTargetPacketId: 'packet-source-pack-output', cockpitPrimaryActionKind: 'focus-concierge-packet', cockpitPrimaryActionTargetSurface: 'Operator Proof Concierge', cockpitPrimaryActionReason: 'Source-pack packet is next in canonical proof concierge projection.' };
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
