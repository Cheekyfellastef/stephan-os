import { removeAcceptedMissionProof } from './missionProofReconciliation.js';

const MAX_PROMPT_BLOCK_LENGTH = 1400;
const KNOWN = new Set(['', 'unknown', 'none', 'n/a', 'null', 'undefined']);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}
function known(value) { const out = text(value, ''); return out && !KNOWN.has(out.toLowerCase()) ? out : ''; }
function list(value) { return Array.isArray(value) ? value.map((item) => text(item, '')).filter(Boolean) : []; }
function uniq(values = [], limit = 12) { return Array.from(new Set(values.map((item) => text(item, '')).filter(Boolean))).slice(0, limit); }
function isUiOk(status = '') { return ['ok', 'ready', 'healthy', 'pass', 'passed'].includes(text(status, '').toLowerCase()); }
function sourceName(name, present) { return present ? name : ''; }
function boundedTitleFromTruth({ packetBay = {}, agentRealityLoop = {}, builderMesh = {}, missionIntelligence = {} } = {}) {
  return known(missionIntelligence.currentMissionSummary)
    || known(packetBay.currentMissionTitle)
    || known(agentRealityLoop.currentMissionTitle)
    || known(builderMesh.currentMissionTitle)
    || 'Stephanos Mission Stack Verification';
}

export function buildProjectAwarenessProjection({
  activeMission = {},
  missionPacket = {},
  intentToBuild = {},
  builderMeshProjection = {},
  packetBayProjection = {},
  agentRealityLoopProjection = {},
  builderWorkbenchProjection = {},
  openClawSourcePackRunner = {},
  missionVerification = {},
  prEvidence = {},
  uiRealityTruth = {},
  openClawWorkspaceHygiene = {},
  operatorProfile = {},
  missionIntelligence = {},
  supportSnapshot = {},
  missionEvidenceContextSummary = {},
  missionProofReconciliation = {},
  now = new Date(),
} = {}) {
  const active = activeMission && typeof activeMission === 'object' ? activeMission : {};
  const packetBay = packetBayProjection && typeof packetBayProjection === 'object' ? packetBayProjection : {};
  const arl = agentRealityLoopProjection && typeof agentRealityLoopProjection === 'object' ? agentRealityLoopProjection : {};
  const mesh = builderMeshProjection && typeof builderMeshProjection === 'object' ? builderMeshProjection : {};
  const workbench = Object.keys(builderWorkbenchProjection || {}).length ? builderWorkbenchProjection : (mesh.builderWorkbenchProjection || {});
  const sourcePack = Object.keys(openClawSourcePackRunner || {}).length ? openClawSourcePackRunner : (workbench.openClawSourcePackRunner || {});
  const hygiene = Object.keys(openClawWorkspaceHygiene || {}).length ? openClawWorkspaceHygiene : (workbench.openClawWorkspaceHygiene || mesh.openClawWorkspaceHygiene || {});
  const verification = missionVerification && typeof missionVerification === 'object' ? missionVerification : {};
  const evidenceContext = missionEvidenceContextSummary && typeof missionEvidenceContextSummary === 'object' ? missionEvidenceContextSummary : {};
  const evidenceAvailable = evidenceContext.available === true;
  const packets = Array.isArray(packetBay.packets) ? packetBay.packets.filter((packet) => packet && typeof packet === 'object') : [];
  const readyPackets = packets.filter((packet) => packet?.status === 'ready-to-copy');
  const localAiProofPacket = readyPackets.find((packet) => text(packet?.target).toLowerCase() === 'local-ai' && text(packet?.kind).toLowerCase().includes('proof'));
  const sourceSummary = uniq([
    sourceName('Active Mission storage', Object.keys(active).length && (known(active.title) || known(active.activeMissionTitle))),
    sourceName('Mission Packet / Intent-to-Build truth', Object.keys(missionPacket || {}).length || Object.keys(intentToBuild || {}).length),
    sourceName('Builder Mesh projection', Object.keys(mesh).length),
    sourceName('Packet Bay projection', Object.keys(packetBay).length),
    sourceName('Agent Reality Loop projection', Object.keys(arl).length),
    sourceName('Builder Workbench projection', Object.keys(workbench).length),
    sourceName('OpenClaw Source Pack Runner truth', Object.keys(sourcePack).length),
    sourceName('Mission Verification truth', Object.keys(verification).length),
    sourceName('PR Evidence truth', Object.keys(prEvidence || {}).length),
    sourceName('UI Reality truth', Object.keys(uiRealityTruth || {}).length || known(supportSnapshot.uiRealityStatus)),
    sourceName('OpenClaw Workspace Hygiene truth', Object.keys(hygiene).length),
    sourceName('Operator Profile truth', Object.keys(operatorProfile || {}).length),
    sourceName('Mission Evidence Context V1B', evidenceAvailable),
  ].filter(Boolean), 18);

  const storedTitle = known(active.title) || known(active.activeMissionTitle);
  const title = storedTitle || boundedTitleFromTruth({ packetBay, agentRealityLoop: arl, builderMesh: mesh, missionIntelligence });
  const missionId = known(active.id) || known(active.activeMissionId) || (storedTitle ? 'active-mission-storage' : 'derived-runtime-mission');
  const rehydrated = sourceSummary.length > 0;
  const rehydrationSource = storedTitle ? 'active-mission-storage' : (Object.keys(packetBay).length || Object.keys(arl).length || Object.keys(mesh).length ? 'derived-runtime-packet-truth' : 'none');
  const provedSystems = uniq([
    ...(packetBay.packetBayStatus ? ['Packet Bay'] : []),
    ...(mesh.builderMeshStatus || mesh.recommendedBuilder ? ['Builder Mesh'] : []),
    ...(arl.projectionSource && arl.projectionSource !== 'none' ? ['Agent Reality Loop'] : []),
    ...(hygiene.workspaceHygieneStatus === 'clean' || hygiene.workspaceDirtDetected === 'no' ? ['OpenClaw workspace hygiene'] : []),
    ...(supportSnapshot.runtimeStatus === 'ready' || supportSnapshot.appLaunchState === 'ready' ? ['Runtime'] : []),
  ]);
  const affectedSubsystems = uniq([
    ...list(mesh.affectedSubsystems),
    ...list(missionIntelligence.affectedSubsystems),
    ...list(active.relatedSystems),
    ...(Object.keys(packetBay).length ? ['packet-bay'] : []),
    ...(Object.keys(arl).length ? ['agent-reality-loop'] : []),
    ...(Object.keys(mesh).length ? ['builder-mesh'] : []),
  ]);
  const requiredProof = uniq([...list(packetBay.requiredProof), ...packets.flatMap((p) => list(p?.requiredProof)), ...list(mesh.requiredProof), ...list(mesh.proofRequiredBeforeMerge), ...list(arl.requiredProof), ...list(verification.requiredProof)]);
  let missingProof = uniq([...list(arl.missingProof), ...list(verification.missingEvidence), ...list(mesh.missingProof), ...packets.flatMap((p) => list(p?.missingProof))], 18);
  const blockers = uniq([...list(arl.blockers), ...list(mesh.blockers), ...list(verification.blockers)], 18);
  const warnings = uniq([...list(mesh.warnings), ...list(workbench.warnings), ...list(verification.warnings)], 18);
  const workspaceDirty = hygiene.workspaceDirtDetected === 'yes' || hygiene.workspaceBlocksIgnition === 'yes' || Number(hygiene.workspaceDirtCount || 0) > 0;
  if (workspaceDirty) blockers.push('OpenClaw workspace hygiene is dirty; run housekeep before routing.');
  const uiStatus = known(uiRealityTruth.status) || known(uiRealityTruth.uiRealityStatus) || known(supportSnapshot.uiRealityStatus) || known(supportSnapshot.chatContextUiRealityStatus);
  if (uiStatus && !isUiOk(uiStatus)) { blockers.push('UI Reality is not OK; browser/UI proof is required.'); missingProof.push('browser/UI proof'); }
  if (evidenceAvailable && evidenceContext.missingProofSummary && evidenceContext.missingProofSummary !== 'none') {
    missingProof.push(...String(evidenceContext.missingProofSummary).split('|').map((item) => text(item, '')).filter(Boolean));
  }
  missingProof = uniq(removeAcceptedMissionProof(missingProof, missionProofReconciliation), 18);
  const verificationPending = ['pending', 'not_ready', 'insufficient_evidence', 'proof-pending', 'technically-clean-but-proof-pending'].includes(text(verification.proofStatus || verification.readinessLevel || verification.returnStatus || verification.missionVerificationProofStatus, '').toLowerCase());
  if (verificationPending && !missingProof.some((item) => /mission verification/i.test(item))) missingProof.push('Mission Verification proof pending');

  let phase = known(active.phase) || known(active.canonicalMissionPhase) || 'unknown';
  if (phase === 'unknown' && localAiProofPacket) phase = 'verification';
  if (phase === 'unknown' && missingProof.length) phase = 'verification';
  if (blockers.length) phase = workspaceDirty || (uiStatus && !isUiOk(uiStatus)) ? 'blocked' : phase;
  let recommendedRoute = known(mesh.recommendedBuilder) || known(arl.recommendedLead) || 'hold';
  if (recommendedRoute === 'local-ai') recommendedRoute = 'local-ai';
  if (blockers.length) recommendedRoute = workspaceDirty || (uiStatus && !isUiOk(uiStatus)) ? 'hold' : recommendedRoute;
  let recommendedRouteReason = known(mesh.recommendedBuilderReason) || known(arl.recommendedLeadReason) || 'Derived from bounded runtime packet truth; no autonomous dispatch is allowed.';
  if (mesh.recommendedBuilder === 'local-ai') recommendedRouteReason = 'Builder Mesh recommends local-ai read-only verification/review.';
  if (blockers.length) recommendedRouteReason = workspaceDirty ? 'OpenClaw workspace hygiene blocks routing until housekeeping proof is clean.' : (uiStatus && !isUiOk(uiStatus) ? 'UI Reality is not OK; browser/UI proof blocks routing.' : recommendedRouteReason);
  const arlBlockedOnProof = text(arl.status).toLowerCase() === 'blocked' && missingProof.length > 0;
  const currentFocus = known(active.currentFocus) || known(missionPacket.currentFocus) || (arlBlockedOnProof ? 'Resolve Agent Reality Loop missing proof blockers.' : (localAiProofPacket ? 'Verify ready local-ai proof packet and close missing proof.' : (known(mesh.nextBestAction) || 'Rehydrate mission context from runtime packet truth.')));
  const nextBestAction = arlBlockedOnProof
    ? `Resolve proof blockers: ${missingProof.slice(0, 3).join(' | ')}`
    : (workspaceDirty ? 'Housekeep OpenClaw workspace dirt, then recapture Support Snapshot proof.'
      : (uiStatus && !isUiOk(uiStatus) ? 'Repair or capture browser/UI Reality proof before routing.'
        : (known(mesh.nextBestAction) || known(arl.nextBestAction) || known(arl.nextAction) || 'Review Project Awareness strip and copy the bounded next proof packet.')));
  const hasRuntimeTruth = Object.keys(packetBay).length || Object.keys(arl).length || Object.keys(mesh).length;
  let status = hasRuntimeTruth ? (blockers.length ? 'blocked' : (storedTitle ? 'active' : 'degraded')) : 'unavailable';
  const confidence = storedTitle ? 'high' : (hasRuntimeTruth ? 'medium' : 'low');
  const operatorDecisionRequired = blockers.length > 0 || missingProof.length > 0 || recommendedRoute === 'operator';
  const promptInjectable = hasRuntimeTruth && sourceSummary.length >= 2 && title !== 'unknown';
  const promptLines = [
    '[Project Awareness Context: bounded truth for mission-planning only]',
    `- mission: ${title}`,
    `- phase: ${phase}`,
    `- current focus: ${currentFocus}`,
    `- next best action: ${nextBestAction}`,
    `- recommended route: ${recommendedRoute}`,
    `- route reason: ${recommendedRouteReason}`,
    `- evidence completeness: ${evidenceAvailable ? evidenceContext.completeness : 'unknown'}`,
    `- evidence next required: ${evidenceAvailable ? evidenceContext.nextRequiredEvidence : 'none'}`,
    `- missing proof: ${missingProof.slice(0, 5).join(' | ') || 'none'}`,
    `- sources: ${sourceSummary.slice(0, 8).join('|') || 'none'}`,
    '- safety: no auto-dispatch, no OpenClaw mutation, no durable mission write without operator approval.',
  ];
  const promptBlock = promptInjectable ? promptLines.join('\n').slice(0, MAX_PROMPT_BLOCK_LENGTH) : '';
  return {
    status, missionId, title, phase, currentFocus, nextBestAction, recommendedRoute, recommendedRouteReason,
    sourceSummary, provedSystems, affectedSubsystems, requiredProof, missingProof, blockers: uniq(blockers, 18), warnings,
    operatorDecisionRequired, promptInjectable, promptBlock,
    projectionSource: storedTitle ? 'active-mission-storage+runtime-truth' : (hasRuntimeTruth ? 'derived-runtime-truth' : 'none'),
    confidence, rehydrated, rehydrationSource,
    updatedAt: now instanceof Date ? now.toISOString() : text(now, new Date().toISOString()),
    durableWriteAllowed: false,
    evidenceCompleteness: evidenceAvailable ? evidenceContext.completeness : 'unavailable',
    evidenceNextRequired: evidenceAvailable ? evidenceContext.nextRequiredEvidence : 'none',
    evidenceMissingProofSummary: evidenceAvailable ? evidenceContext.missingProofSummary : 'none',
    evidenceContextSource: evidenceAvailable ? evidenceContext.source : 'none',
  };
}

export function projectAwarenessSupportSnapshotFields(projection = {}, promptInjected = 'no') {
  const p = projection && typeof projection === 'object' ? projection : {};
  return {
    project_awareness_pack_status: p.status || 'unavailable',
    project_awareness_projection_source: p.projectionSource || 'none',
    project_awareness_current_mission: p.title || 'unknown',
    project_awareness_mission_id: p.missionId || 'unknown',
    project_awareness_mission_phase: p.phase || 'unknown',
    project_awareness_current_focus: p.currentFocus || 'unknown',
    project_awareness_next_best_action: p.nextBestAction || 'unknown',
    project_awareness_recommended_route: p.recommendedRoute || 'hold',
    project_awareness_recommended_route_reason: p.recommendedRouteReason || 'unknown',
    project_awareness_confidence: p.confidence || 'low',
    project_awareness_rehydrated: p.rehydrated ? 'yes' : 'no',
    project_awareness_rehydration_source: p.rehydrationSource || 'none',
    project_awareness_prompt_injectable: p.promptInjectable ? 'yes' : 'no',
    project_awareness_prompt_injected: promptInjected,
    project_awareness_prompt_block_length: String((p.promptBlock || '').length),
    project_awareness_sources_used: list(p.sourceSummary).join('|') || 'none',
    project_awareness_proved_systems: list(p.provedSystems).join('|') || 'none',
    project_awareness_affected_subsystems: list(p.affectedSubsystems).join('|') || 'none',
    project_awareness_missing_proof_summary: list(p.missingProof).join(' | ') || 'none',
    project_awareness_blocker_count: String(list(p.blockers).length),
    project_awareness_warning_count: String(list(p.warnings).length),
    project_awareness_operator_decision_required: p.operatorDecisionRequired ? 'yes' : 'no',
    project_awareness_evidence_completeness: p.evidenceCompleteness || 'unavailable',
    project_awareness_evidence_next_required: p.evidenceNextRequired || 'none',
    project_awareness_evidence_missing_proof_summary: p.evidenceMissingProofSummary || 'none',
    project_awareness_evidence_context_source: p.evidenceContextSource || 'none',
  };
}
