import { buildOperatorGuidanceProjection } from './operatorGuidanceRendering.js';
import { deriveUiRealityStatus } from './uiRealityStatus.js';
import { buildMissionRepairLoopModel } from './missionRepairLoopModel.js';
import { parsePrReferenceFromPrompt } from './githubPrEvidenceProvider.js';
import { projectCanonicalPrEvidence } from './prEvidenceCanonicalProjection.js';
import { diagnoseProviderDrift } from './providerRoutingTruth.js';
import { buildOpenClawControlBridgeProjection } from '../../../shared/agents/openClawControlBridge.mjs';
import { derivePacketBayProjection } from './packetBayProjection.js';
import { buildProjectAwarenessProjection, projectAwarenessSupportSnapshotFields } from './projectAwarenessProjection.js';
import { deriveMissionEvidenceLedgerProjection, deriveMissionEvidenceContextSummary } from './missionEvidenceLedgerModel.js';
import { deriveEvidenceReturnIntakeProjection } from './evidenceReturnIntakeModel.js';
import { buildMissionProofReconciliation, missionProofReconciliationSupportSnapshotFields, reconciledMissionMissingProof } from './missionProofReconciliation.js';
import { buildCockpitProjection, deriveCockpitActionModel } from './cockpitProjection.js';
const BACKEND_HEALTH_FRESHNESS_MS = 30_000;

function asText(value, fallback = 'n/a') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
}


function cockpitRenderSignature(projection = {}) {
  return [
    asText(projection.currentStatus, 'unknown'),
    Array.isArray(projection.acceptedProof) ? projection.acceptedProof.join('|') : asText(projection.acceptedProof, 'none'),
    Array.isArray(projection.missingProof) ? projection.missingProof.join('|') : asText(projection.missingProof, 'none'),
    String(Number(projection.missingProofCount || 0)),
    asText(projection.nextBestAction, 'n/a'),
    asText(projection.mergeSafety, 'no / hold'),
    asText(projection.openClawMutationLockState, 'locked'),
    asText(projection.codexMutationLockState, 'locked'),
  ].join(' :: ');
}

function deriveCockpitDomProof(projection = {}) {
  const doc = globalThis.document;
  const canonicalSource = 'canonical cockpit projection';
  const expectedSignature = cockpitRenderSignature(projection);
  const fallback = {
    landingPresent: 'no', landingExpected: 'unknown', landingMountStatus: 'unknown', landingProjectionSource: canonicalSource, landingRenderSignature: expectedSignature,
    expandedPresent: 'no', expandedExpected: 'unknown', expandedMountStatus: 'unknown', expandedProjectionSource: canonicalSource, expandedRenderSignature: expectedSignature,
    surfaceDriftDetected: 'unknown', surfaceDriftReason: 'live-dom-unavailable', operatorVisualPresent: 'no', operatorPrimaryDashboardPresent: 'no', operatorVisualPosition: 'unknown', operatorPrimaryDashboardPosition: 'unknown', operatorPrimaryVisualLabel: 'unknown', operatorFirstContentBlockKind: 'unknown', operatorFirstContentBlockLabel: 'unknown', landingFirstContentBlockKind: 'unknown', landingPrimaryVisualPosition: 'unknown', expandedFirstContentBlockKind: 'unknown', expandedPrimaryVisualPosition: 'unknown', cockpitVisualLayoutVerdict: 'UNKNOWN', cockpitVisualLayoutFailureReason: 'live-dom-unavailable', landingTileTextDensity: 'unknown', landingTileTextBloatDetected: 'unknown', landingTileVisibleDetailFieldCount: '0', landingTileShortcutRolePreserved: 'unknown', landingVisualPresent: 'no', landingVisualPosition: 'unknown', expandedVisualPresent: 'no', expandedVisualPosition: 'unknown', visualProjectionSource: canonicalSource, visualTextDriftDetected: 'unknown', visualTextDriftReason: 'live-dom-unavailable', operatorCockpitLayoutDensity: 'unknown', operatorCockpitEmptySpaceWarning: 'unknown', expandedDetailGridPresent: 'no', expandedDetailCardCount: '0', expandedProofChipsPresent: 'no', expandedCollapsedEmptyFieldsCount: '0', expandedDebugCollapsedByDefault: 'unknown', expandedLayoutDensityVerdict: 'UNKNOWN', expandedLayoutDensityFailureReason: 'live-dom-unavailable', expandedSummaryReadoutPosition: 'unknown', expandedDetailTextPosition: 'unknown', expandedRouteTopologyPosition: 'unknown', cockpitVisualHierarchyVerdict: 'UNKNOWN', cockpitVisualHierarchyFailureReason: 'live-dom-unavailable',
    animationEnabled: 'yes', animationMode: 'subtle', animatedElements: 'status-orb|proof-strip|next-action-beacon|lock-chips', animationTruthImpact: 'none', reducedMotionRespected: 'yes',
  };
  if (!doc?.querySelector) return fallback;
  const read = (node, name, empty = 'missing') => asText(node?.getAttribute?.(name), empty);
  const visible = (node) => !!node && !(node.hidden || node.getAttribute?.('aria-hidden') === 'true');
  const landing = doc.querySelector('[data-cockpit-surface="landing-tile"]');
  const expanded = doc.querySelector('[data-cockpit-surface="expanded-pane"]');
  const currentPath = asText(globalThis.location?.pathname, '');
  const landingExpected = currentPath === '/' || currentPath === '' ? 'yes' : 'no';
  const expandedExpected = visible(expanded) ? 'yes' : 'no';
  const mountStatus = (node, expected, inactive) => node ? 'mounted' : (expected === 'yes' ? 'missing-expected' : inactive);
  const landingSig = read(landing, 'data-cockpit-render-signature', expectedSignature);
  const expandedSig = read(expanded, 'data-cockpit-render-signature', expectedSignature);
  const landingSource = read(landing, 'data-cockpit-projection-source', canonicalSource);
  const expandedSource = read(expanded, 'data-cockpit-projection-source', canonicalSource);
  const landingVisual = landing?.querySelector?.('[data-cockpit-block="shortcut-visual"], [data-cockpit-visual="true"]') || null;
  const expandedVisual = expanded?.querySelector?.('[data-cockpit-block="primary-dashboard"]') || null;
  const landingTextNode = landing?.querySelector?.('[data-cockpit-text="true"]') || null;
  const expandedText = expanded?.querySelector?.('[data-cockpit-block="detail-grid"]') || expanded?.querySelector?.('[data-cockpit-text="true"]') || null;
  const expandedSummary = expanded?.querySelector?.('[data-cockpit-block="summary-readout"]') || null;
  const expandedGrid = expanded?.querySelector?.('[data-cockpit-block="detail-grid"]') || null;
  const expandedRoute = expanded?.querySelector?.('[data-cockpit-block="route-topology"]') || null;
  const expandedDebug = expanded?.querySelector?.('[data-cockpit-block="debug-drilldown"]') || null;
  const blockKind = (node) => read(node, 'data-cockpit-block', 'unknown');
  const firstBlock = (root) => Array.from(root?.querySelectorAll?.('[data-cockpit-block]') || []).find(visible) || null;
  const label = (node) => asText(node?.getAttribute?.('aria-label') || node?.querySelector?.('h3,h4,strong')?.textContent || node?.textContent, 'unknown').slice(0, 80);
  const position = (a, b, before = 'before-text', after = 'after-text') => a && b && a.compareDocumentPosition ? ((a.compareDocumentPosition(b) & (globalThis.Node?.DOCUMENT_POSITION_FOLLOWING || 4)) ? before : after) : (a ? before : 'unknown');
  const landingFirst = firstBlock(landing);
  const expandedFirst = firstBlock(expanded);
  const landingDetailCount = Number(read(landing, 'data-cockpit-visible-detail-field-count', String(landing?.querySelectorAll?.('[data-cockpit-text-current-status],[data-cockpit-text-next-action],[data-cockpit-text-merge-safety],[data-cockpit-text-openclaw-lock]')?.length || 0)));
  const landingText = asText(landing?.textContent, '');
  const bloatDetected = landingDetailCount > 1 || landingText.length > 220 || /Next best action|Accepted Proof|Merge safety|OpenClaw \/ Codex|proof-collection-packet/i.test(landingText);
  const landingDensity = landing ? (bloatDetected ? 'verbose' : 'compact') : 'unknown';

  const dashboardFirst = expanded && blockKind(expandedFirst) === 'primary-dashboard';
  const summaryBeforeDashboard = expandedSummary && expandedVisual && position(expandedSummary, expandedVisual, 'before-primary-dashboard', 'after-primary-dashboard') === 'before-primary-dashboard';
  const detailBeforeDashboard = expandedGrid && expandedVisual && position(expandedGrid, expandedVisual, 'before-primary-dashboard', 'after-primary-dashboard') === 'before-primary-dashboard';
  const routeFirstRouting = expandedRoute && blockKind(expandedFirst) === 'route-topology' && read(expandedRoute, 'data-cockpit-kind') === 'routing';
  const hierarchyReason = !expandedVisual ? 'primary-dashboard-missing' : summaryBeforeDashboard ? 'summary-readout-before-primary-dashboard' : detailBeforeDashboard ? 'detail-text-before-primary-dashboard' : routeFirstRouting ? 'route-topology-not-primary-dashboard' : !dashboardFirst ? 'primary-dashboard-not-first-substantial-block' : 'none';
  const cardCount = Number(read(expandedGrid, 'data-cockpit-card-count', String(expanded?.querySelectorAll?.('[data-cockpit-block="detail-card"]')?.length || 0)));
  const proofChipsPresent = expanded?.querySelector?.('[data-cockpit-block="proof-chip-list"]') ? 'yes' : 'no';
  const emptyCollapsedCount = expanded?.querySelectorAll?.('[data-cockpit-empty-field-collapsed="yes"]')?.length || 0;
  const density = expandedGrid && cardCount >= 6 && proofChipsPresent === 'yes' ? 'compact' : (expandedGrid ? 'loose' : 'unknown');
  const emptyWarning = density === 'compact' && read(expandedGrid, 'data-cockpit-empty-space-warning', 'no') === 'no' ? 'no' : 'yes';
  const densityVerdict = density === 'compact' && emptyWarning === 'no' ? 'OK' : (density === 'unknown' ? 'FAIL' : 'WARN');
  const densityReason = densityVerdict === 'OK' ? 'none' : 'cockpit-detail-layout-too-sparse';

  const mounted = [[landing, landingSig, landingSource], [expanded, expandedSig, expandedSource]].filter(([node]) => !!node);
  const signatureMismatch = mounted.length > 1 && new Set(mounted.map(([, sig]) => sig)).size > 1;
  const sourceMismatch = mounted.some(([, , source]) => source !== canonicalSource);
  const surfaceDrift = signatureMismatch || sourceMismatch ? 'yes' : 'no';
  const surfaceReason = surfaceDrift === 'no' ? 'none' : (signatureMismatch ? 'mounted-cockpit-surface-render-signatures-disagree' : 'mounted-cockpit-surface-source-mismatch');
  const expected = {
    status: asText(projection.currentStatus, 'unknown'), accepted: (projection.acceptedProof || []).join('|') || 'none', missing: (projection.missingProof || []).join('|') || 'none', missingCount: String(Number(projection.missingProofCount || 0)), next: asText(projection.nextBestAction, 'n/a'), merge: asText(projection.mergeSafety, 'no / hold'), openclaw: asText(projection.openClawMutationLockState, 'locked'), codex: asText(projection.codexMutationLockState, 'locked'),
  };
  const driftReasons = [];
  const checkPair = (label, visual, textNode) => {
    if (!visual || !textNode) return;
    const pairs = [
      ['mission-status', read(visual.querySelector?.('[data-cockpit-visual-current-status]') || visual, 'data-cockpit-visual-current-status'), read(textNode, 'data-cockpit-text-current-status'), expected.status],
      ['accepted-proof', read(visual.querySelector?.('[data-cockpit-visual-accepted-proof]') || visual, 'data-cockpit-visual-accepted-proof'), read(textNode, 'data-cockpit-text-accepted-proof'), expected.accepted],
      ['missing-proof', read(visual.querySelector?.('[data-cockpit-visual-missing-proof]') || visual, 'data-cockpit-visual-missing-proof'), read(textNode, 'data-cockpit-text-missing-proof'), expected.missing],
      ['missing-count', read(visual.querySelector?.('[data-cockpit-visual-missing-count]') || visual, 'data-cockpit-visual-missing-count'), read(textNode, 'data-cockpit-text-missing-count'), expected.missingCount],
      ['next-action', read(visual.querySelector?.('[data-cockpit-visual-next-action]') || visual, 'data-cockpit-visual-next-action'), read(textNode, 'data-cockpit-text-next-action'), expected.next],
      ['merge-safety', read(visual.querySelector?.('[data-cockpit-visual-merge-safety]') || visual, 'data-cockpit-visual-merge-safety'), read(textNode, 'data-cockpit-text-merge-safety'), expected.merge],
      ['openclaw-lock', read(visual.querySelector?.('[data-cockpit-visual-openclaw-lock]') || visual, 'data-cockpit-visual-openclaw-lock'), read(textNode, 'data-cockpit-text-openclaw-lock'), expected.openclaw],
      ['codex-lock', read(visual.querySelector?.('[data-cockpit-visual-codex-lock]') || visual, 'data-cockpit-visual-codex-lock'), read(textNode, 'data-cockpit-text-codex-lock'), expected.codex],
    ];
    for (const [field, v, t, e] of pairs) if (v !== e || t !== e) driftReasons.push(`${label}-${field}:visual=${v};text=${t};projection=${e}`);
  };
  checkPair('landing', landingVisual, null);
  checkPair('expanded', expandedVisual, expandedText);
  const animationNode = expandedVisual || landingVisual;
  return {
    landingPresent: landing ? 'yes' : 'no', landingExpected, landingMountStatus: mountStatus(landing, landingExpected, 'not-mounted-current-route'), landingProjectionSource: landingSource, landingRenderSignature: landingSig,
    expandedPresent: expanded ? 'yes' : 'no', expandedExpected, expandedMountStatus: mountStatus(expanded, expandedExpected, 'not-mounted-inactive-pane'), expandedProjectionSource: expandedSource, expandedRenderSignature: expandedSig,
    surfaceDriftDetected: surfaceDrift, surfaceDriftReason: surfaceReason,
    operatorVisualPresent: landingVisual || expandedVisual ? 'yes' : 'no', operatorPrimaryDashboardPresent: expandedVisual ? 'yes' : 'no', operatorVisualPosition: (position(landingVisual, landingTextNode) === 'before-text' || position(expandedVisual, expandedText) === 'before-text') ? 'before-text' : 'unknown', operatorPrimaryDashboardPosition: expandedVisual ? (dashboardFirst ? 'before-summary-and-text' : 'after-text') : 'missing', operatorPrimaryVisualLabel: label(expandedVisual || landingVisual), operatorFirstContentBlockKind: blockKind(expandedFirst || landingFirst), operatorFirstContentBlockLabel: label(expandedFirst || landingFirst), landingFirstContentBlockKind: blockKind(landingFirst), landingPrimaryVisualPosition: position(landingVisual, landingTextNode), expandedFirstContentBlockKind: blockKind(expandedFirst), expandedPrimaryVisualPosition: expandedVisual ? (dashboardFirst ? 'before-summary-and-text' : position(expandedVisual, expandedText)) : 'missing', expandedSummaryReadoutPosition: position(expandedSummary, expandedVisual, 'before-primary-dashboard', 'after-primary-dashboard'), expandedDetailTextPosition: position(expandedGrid, expandedVisual, 'before-primary-dashboard', 'after-primary-dashboard'), expandedRouteTopologyPosition: position(expandedRoute, expandedGrid, 'before-detail-grid', 'after-cockpit-truth-blocks'), cockpitVisualLayoutVerdict: hierarchyReason === 'none' ? 'OK' : 'FAIL', cockpitVisualLayoutFailureReason: hierarchyReason, cockpitVisualHierarchyVerdict: hierarchyReason === 'none' ? 'OK' : 'FAIL', cockpitVisualHierarchyFailureReason: hierarchyReason, operatorCockpitLayoutDensity: density, operatorCockpitEmptySpaceWarning: emptyWarning, expandedDetailGridPresent: expandedGrid ? 'yes' : 'no', expandedDetailCardCount: String(cardCount), expandedProofChipsPresent: proofChipsPresent, expandedCollapsedEmptyFieldsCount: String(emptyCollapsedCount), expandedDebugCollapsedByDefault: expandedDebug && !expandedDebug.open ? 'yes' : (expandedDebug ? 'no' : 'unknown'), expandedLayoutDensityVerdict: densityVerdict, expandedLayoutDensityFailureReason: densityReason, landingTileTextDensity: landingDensity, landingTileTextBloatDetected: bloatDetected ? 'yes' : 'no', landingTileVisibleDetailFieldCount: String(landingDetailCount), landingTileShortcutRolePreserved: !landing || read(landing, 'data-cockpit-shortcut-role', 'missing') === 'preserved' ? 'yes' : 'no',
    landingVisualPresent: landingVisual ? 'yes' : 'no', landingVisualPosition: position(landingVisual, landingTextNode), expandedVisualPresent: expandedVisual ? 'yes' : 'no', expandedVisualPosition: position(expandedVisual, expandedText), visualProjectionSource: canonicalSource,
    visualTextDriftDetected: driftReasons.length ? 'yes' : 'no', visualTextDriftReason: driftReasons.length ? driftReasons.join('|') : 'none',
    animationEnabled: read(animationNode, 'data-cockpit-animation-enabled', 'yes'), animationMode: read(animationNode, 'data-cockpit-animation-mode', 'subtle'), animatedElements: read(animationNode, 'data-cockpit-animated-elements', 'status-orb|proof-strip|next-action-beacon|lock-chips'), animationTruthImpact: read(animationNode, 'data-cockpit-animation-truth-impact', 'none'), reducedMotionRespected: read(animationNode, 'data-cockpit-reduced-motion-respected', 'yes'),
  };
}

function isDefaultWorkbenchMetadataValue(key = '', value = '') {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;
  if (key === 'builder_workbench_status') return normalized === 'unavailable';
  if (key === 'builder_workbench_codex_fallback_still_needed' || key === 'builder_workbench_deterministic_answer_used') return normalized === 'no';
  if (key.startsWith('openclaw_source_pack_')) return ['none', 'unknown', 'n/a', 'idle', 'no', '0', 'locked', 'forbidden', 'not-run', 'source-pack-runner-idle', 'copy the source pack cli prompt and paste a bounded source-pack result.'].includes(normalized);
  if (key.startsWith('openclaw_patch_planner_')) return ['none', 'unknown', 'n/a', 'idle', 'no', '0', 'locked', 'forbidden', 'copy the openclaw patch planner prompt and run it externally/read-only.'].includes(normalized);
  if (key.startsWith('openclaw_workspace_')) return ['none', 'unknown', 'n/a', 'clean', 'no', '0', 'locked', 'no cleanup needed.'].includes(normalized);
  if (key.startsWith('openclaw_route_') || key.startsWith('openclaw_sanity_') || key.startsWith('openclaw_template_') || key.startsWith('openclaw_wrong_repo_') || key.startsWith('openclaw_exact_response_') || key === 'openclaw_cli_banner_ignored' || key === 'openclaw_dashboard_failure_examples' || key === 'openclaw_minimum_viable_route_recommendation' || key === 'openclaw_model_pin_mismatch_warnings' || key === 'openclaw_doctor_non_blocking_findings' || key === 'openclaw_trusted_for_builder_routing' || key.startsWith('openclaw_active_session_') || key === 'openclaw_plaintext_token_security_warning') return ['none', 'unknown', 'n/a', 'idle', 'no', 'paste an openclaw result to run the sanity gate before builder mesh routing.'].includes(normalized);
  if (key.startsWith('builder_mesh_')) return ['none', 'unknown', 'n/a', 'idle', 'no', '0', 'hold', 'operator clarification is required before routing.', 'operator-relief-existing-truth-v1'].includes(normalized);
  if (key === 'builder_workbench_codex_fallback_reason') return normalized === 'none';
  if (key === 'builder_workbench_next_best_action') return normalized === 'copy local ai/openclaw packets and paste bounded read-only results.';
  if (['workbench_answer_context_used', 'local_ai_runner_response_retained', 'local_ai_runner_dispatch_attempted', 'local_ai_runner_request_sent', 'local_ai_runner_parse_attempted'].includes(key)) return normalized === 'no';
  if (['workbench_answer_source', 'workbench_parsed_result_source'].includes(key)) return normalized === 'none';
  if (key === 'local_ai_runner_parse_input_length') return normalized === '0';
  if (key === 'local_ai_runner_parse_result_status') return normalized === 'empty';
  if (key === 'local_ai_runner_error_message') return normalized === 'none';
  if (key === 'workbench_output_viewport_status') return normalized === 'unknown';
  return ['none', 'unknown', 'n/a'].includes(normalized);
}

function pickWorkbenchTruth(key, defaultValue, ...candidates) {
  const meaningful = candidates.find((value) => !isDefaultWorkbenchMetadataValue(key, value));
  if (meaningful !== undefined && meaningful !== null && String(meaningful).trim() !== '') return meaningful;
  const present = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return present !== undefined ? present : defaultValue;
}


function buildBuilderMeshMetadataFromProjection(mesh = {}, source = 'none') {
  const projection = mesh && typeof mesh === 'object' ? mesh : {};
  const present = Object.keys(projection).length > 0;
  const joinList = (value) => Array.isArray(value) ? value.join(' | ') : asText(value, 'none');
  return {
    builder_mesh_status: projection.builderMeshStatus || 'unavailable',
    builder_mesh_recommended_builder: projection.recommendedBuilder || 'hold',
    builder_mesh_reason: projection.recommendedBuilderReason || projection.codexReason || 'Operator clarification is required before routing.',
    builder_mesh_task_kind: projection.taskKind || 'unknown',
    builder_mesh_openclaw_eligible: projection.openClawEligible === true ? 'yes' : 'no',
    builder_mesh_local_ai_eligible: projection.localAiEligible === true ? 'yes' : 'no',
    builder_mesh_codex_eligible: projection.codexEligible === true ? 'yes' : 'no',
    builder_mesh_required_proof: joinList(projection.requiredProof || projection.proofRequiredBeforeMerge || []),
    builder_mesh_missing_proof: joinList(projection.missingProof || []),
    builder_mesh_next_best_action: projection.nextBestAction || 'Hold for operator clarification.',
    builder_mesh_projection_source: projection.builderMeshProjectionSource || (present ? source : 'none'),
  };
}

function buildWorkbenchMetadataFromProjection(workbench = {}, source = 'none') {
  const projection = workbench && typeof workbench === 'object' ? workbench : {};
  const present = Object.keys(projection).length > 0;
  return {
    builder_workbench_status: projection.workbenchStatus || 'unavailable',
    builder_workbench_local_ai_review_result_present: projection.localAiReviewResultPresent ? 'yes' : 'no',
    local_ai_runner_status: projection.localAiRunnerStatus || 'idle',
    local_ai_runner_selected_model: projection.localAiRunnerSelectedModel || 'none',
    local_ai_runner_last_run_result: projection.localAiRunnerLastRunResult || 'none',
    local_ai_runner_last_run_blocked_reason: projection.localAiRunnerLastRunBlockedReason || 'none',
    local_ai_runner_error_message: projection.localAiRunnerErrorMessage || 'none',
    local_ai_runner_dispatch_attempted: projection.localAiRunnerDispatchAttempted || 'no',
    local_ai_runner_request_sent: projection.localAiRunnerRequestSent || 'no',
    local_ai_runner_parsed_result_present: projection.localAiRunnerParsedResultPresent ? 'yes' : 'no',
    workbench_answer_context_used: projection.workbenchAnswerContextUsed || 'no',
    workbench_answer_source: projection.workbenchAnswerSource || 'none',
    workbench_parsed_result_source: projection.workbenchParsedResultSource || projection.localAiReview?.source || projection.openClawResearch?.source || 'none',
    local_ai_runner_response_retained: projection.localAiRunnerResponseRetained || (projection.localAiRunnerRawResponse ? 'yes' : 'no'),
    local_ai_runner_parse_attempted: projection.localAiRunnerParseAttempted || 'no',
    local_ai_runner_parse_input_length: String(projection.localAiRunnerParseInputLength ?? (projection.localAiRunnerRawResponse || '').length ?? 0),
    local_ai_runner_parse_result_status: projection.localAiRunnerParseResultStatus || projection.localAiReview?.resultStatus || 'empty',
    workbench_output_viewport_status: projection.workbenchOutputViewportStatus || 'unknown',
    builder_workbench_openclaw_research_result_present: projection.openClawResearchResultPresent ? 'yes' : 'no',
    openclaw_web_research_intake_status: projection.openClawWebResearchIntake?.status || 'idle',
    openclaw_web_access_status: projection.openClawWebResearchIntake?.webAccessStatus || 'unknown',
    openclaw_research_source_count: String(projection.openClawWebResearchIntake?.sourceCount ?? 0),
    openclaw_research_valid_url_count: String(projection.openClawWebResearchIntake?.validUrlCount ?? 0),
    openclaw_research_placeholder_leakage_detected: projection.openClawWebResearchIntake?.placeholderLeakageDetected || 'no',
    openclaw_research_forbidden_leakage_detected: projection.openClawWebResearchIntake?.forbiddenLeakageDetected || 'no',
    openclaw_research_task_frame_adherence: projection.openClawWebResearchIntake?.taskFrameAdherence || 'unknown',
    openclaw_research_trusted_for_canon: projection.openClawWebResearchIntake?.resultTrustedForCanon || 'no',
    openclaw_research_next_operator_action: projection.openClawWebResearchIntake?.nextOperatorAction || 'Copy the bounded prompt, run OpenClaw externally/manually, then paste source-cited results for deterministic intake.',
    builder_workbench_patch_plan_present: projection.patchPlanPresent ? 'yes' : 'no',
    builder_workbench_patch_plan_risk: projection.patchPlanRisk || 'unknown',
    builder_workbench_approval_required_before_patch: projection.approvalRequiredBeforePatch === false ? 'no' : 'yes',
    builder_workbench_codex_fallback_still_needed: projection.codexFallbackStillNeeded ? 'yes' : 'no',
    builder_workbench_codex_fallback_reason: projection.codexFallbackReason || 'none',
    builder_workbench_next_best_action: projection.nextBestAction || 'Copy Local AI/OpenClaw packets and paste bounded read-only results.',
    openclaw_route_id: projection.openClawSanityGate?.routeId || 'unknown',
    openclaw_route_label: projection.openClawSanityGate?.routeLabel || 'unknown',
    openclaw_route_trust_status: projection.openClawSanityGate?.routeTrustStatus || 'untrusted',
    openclaw_route_sanity_status: projection.openClawSanityGate?.routeSanityStatus || 'unknown',
    openclaw_route_task_frame_status: projection.openClawSanityGate?.routeTaskFrameStatus || 'unknown',
    openclaw_route_session_id: projection.openClawSanityGate?.routeSessionId || 'unknown',
    openclaw_active_session_count: projection.openClawSanityGate?.activeSessionCount || '0',
    openclaw_active_session_contamination_risk: projection.openClawSanityGate?.activeSessionContaminationRisk || 'no',
    openclaw_route_model_pinned: projection.openClawSanityGate?.routeModelPinned || 'unknown',
    openclaw_route_model_configured_primary: projection.openClawSanityGate?.routeModelConfiguredPrimary || 'unknown',
    openclaw_route_model_mismatch_detected: projection.openClawSanityGate?.routeModelMismatchDetected || 'no',
    openclaw_model_pin_mismatch_warnings: (projection.openClawSanityGate?.modelPinMismatchWarnings || []).join(' | ') || 'none',
    openclaw_plaintext_token_security_warning: projection.openClawSanityGate?.plaintextTokenSecurityWarning || 'no',
    openclaw_doctor_non_blocking_findings: (projection.openClawSanityGate?.doctorNonBlockingFindings || []).join(' | ') || 'none',
    openclaw_dashboard_failure_examples: (projection.openClawSanityGate?.dashboardFailureExamples || []).join(' | ') || 'none',
    openclaw_minimum_viable_route_recommendation: projection.openClawSanityGate?.minimumViableRouteRecommendation || 'Use stephanos-scout / llama3.2 CLI for bounded source-pack processing only; OpenClaw cannot mutate files.',
    openclaw_sanity_status: projection.openClawSanityGate?.sanityStatus || 'idle',
    openclaw_sanity_failure_reason: projection.openClawSanityGate?.failureReason || 'none',
    openclaw_exact_response_status: projection.openClawSanityGate?.exactResponseStatus || 'unknown',
    openclaw_exact_response_payload: projection.openClawSanityGate?.exactResponsePayload || 'none',
    openclaw_cli_banner_ignored: projection.openClawSanityGate?.cliBannerIgnored || 'no',
    openclaw_template_leakage_detected: projection.openClawSanityGate?.templateLeakageDetected || 'no',
    openclaw_wrong_repo_path_detected: projection.openClawSanityGate?.wrongRepoPathDetected || 'no',
    openclaw_trusted_for_builder_routing: projection.openClawSanityGate?.trustedForBuilderRouting || 'no',
    openclaw_sanity_next_operator_action: projection.openClawSanityGate?.nextOperatorAction || 'Paste an OpenClaw result to run the sanity gate before Builder Mesh routing.',
    openclaw_patch_planner_status: projection.openClawPatchPlanner?.patchPlannerStatus || 'idle',
    openclaw_patch_planner_risk_level: projection.openClawPatchPlanner?.riskLevel || 'unknown',
    openclaw_patch_planner_likely_file_count: String(projection.openClawPatchPlanner?.likelyFiles?.length ?? 0),
    openclaw_patch_planner_required_test_count: String(projection.openClawPatchPlanner?.requiredTests?.length ?? 0),
    openclaw_patch_planner_browser_proof_required: projection.openClawPatchPlanner?.browserProofRequired || 'unknown',
    openclaw_patch_planner_forbidden_action_detected: projection.openClawPatchPlanner?.forbiddenActionsDetected || 'no',
    openclaw_patch_planner_placeholder_leakage_detected: projection.openClawPatchPlanner?.placeholderLeakageDetected || 'no',
    openclaw_patch_planner_codex_fallback_needed: projection.openClawPatchPlanner?.codexFallbackNeeded || 'unknown',
    openclaw_patch_planner_trusted_for_patch: projection.openClawPatchPlanner?.trustedForPatch || 'no',
    openclaw_patch_planner_next_operator_action: projection.openClawPatchPlanner?.nextOperatorAction || 'Copy the OpenClaw Patch Planner Prompt and run it externally/read-only.',
    openclaw_source_pack_runner_status: projection.openClawSourcePackRunner?.sourcePackStatus || 'idle',
    openclaw_source_pack_route: projection.openClawSourcePackRunner?.route || 'stephanos-scout / llama3.2 CLI',
    openclaw_source_pack_model: projection.openClawSourcePackRunner?.model || 'ollama/llama3.2:3b',
    openclaw_source_pack_result_present: projection.openClawSourcePackRunner?.sourcePackResultPresent || 'no',
    openclaw_source_pack_source_bounded: projection.openClawSourcePackRunner?.sourceBounded || 'unknown',
    openclaw_source_pack_hallucinated_sources_detected: projection.openClawSourcePackRunner?.hallucinatedSourcesDetected || 'no',
    openclaw_source_pack_template_leakage_detected: projection.openClawSourcePackRunner?.templateLeakageDetected || 'no',
    openclaw_source_pack_asks_for_next_detected: projection.openClawSourcePackRunner?.asksForNextDetected || 'no',
    openclaw_source_pack_useful_fact_count: String(projection.openClawSourcePackRunner?.usefulFactCount ?? 0),
    openclaw_source_pack_unknown_count: String(projection.openClawSourcePackRunner?.unknownCount ?? 0),
    openclaw_source_pack_risk_count: String(projection.openClawSourcePackRunner?.riskCount ?? 0),
    openclaw_source_pack_next_question_count: String(projection.openClawSourcePackRunner?.nextQuestionCount ?? 0),
    openclaw_source_pack_handoff_present: projection.openClawSourcePackRunner?.handoffPacketPresent || 'no',
    openclaw_source_pack_trusted_for_canon: projection.openClawSourcePackRunner?.trustedForCanon || 'no',
    openclaw_source_pack_trusted_for_research: projection.openClawSourcePackRunner?.trustedForResearch || 'no',
    openclaw_source_pack_codex_fallback_needed: projection.openClawSourcePackRunner?.codexFallbackNeeded || 'unknown',
    openclaw_source_pack_judgment_stale: projection.openClawSourcePackRunner?.sourcePackJudgmentStale || 'no',
    openclaw_source_pack_last_judged_text_length: String(projection.openClawSourcePackRunner?.sourcePackLastJudgedTextLength ?? 0),
    openclaw_source_pack_current_text_length: String(projection.openClawSourcePackRunner?.sourcePackCurrentTextLength ?? 0),
    openclaw_source_pack_last_judged_output_length: String(projection.openClawSourcePackRunner?.sourcePackLastJudgedOutputLength ?? 0),
    openclaw_source_pack_current_output_length: String(projection.openClawSourcePackRunner?.sourcePackCurrentOutputLength ?? 0),
    openclaw_source_pack_projection_written: projection.openClawSourcePackRunner?.sourcePackProjectionWritten || 'no',
    openclaw_source_pack_projection_source: projection.openClawSourcePackRunner?.sourcePackProjectionSource || 'source-pack-runner-idle',
    openclaw_source_pack_text_textarea_mounted: projection.openClawSourcePackDiagnostics?.textTextareaMounted || projection.openClawSourcePackRunner?.diagnostics?.textTextareaMounted || 'unknown',
    openclaw_source_pack_output_textarea_mounted: projection.openClawSourcePackDiagnostics?.outputTextareaMounted || projection.openClawSourcePackRunner?.diagnostics?.outputTextareaMounted || 'unknown',
    openclaw_source_pack_text_dom_value_length: String(projection.openClawSourcePackDiagnostics?.textDomValueLength ?? projection.openClawSourcePackRunner?.diagnostics?.textDomValueLength ?? '0'),
    openclaw_source_pack_output_dom_value_length: String(projection.openClawSourcePackDiagnostics?.outputDomValueLength ?? projection.openClawSourcePackRunner?.diagnostics?.outputDomValueLength ?? '0'),
    openclaw_source_pack_output_onchange_fired: projection.openClawSourcePackDiagnostics?.outputOnChangeFired || projection.openClawSourcePackRunner?.diagnostics?.outputOnChangeFired || 'no',
    openclaw_source_pack_output_state_length: String(projection.openClawSourcePackDiagnostics?.outputStateLength ?? projection.openClawSourcePackRunner?.diagnostics?.outputStateLength ?? '0'),
    openclaw_source_pack_judgment_button_clicked: projection.openClawSourcePackDiagnostics?.judgmentButtonClicked || projection.openClawSourcePackRunner?.diagnostics?.judgmentButtonClicked || 'no',
    openclaw_source_pack_judgment_read_output_length: String(projection.openClawSourcePackDiagnostics?.judgmentReadOutputLength ?? projection.openClawSourcePackRunner?.diagnostics?.judgmentReadOutputLength ?? '0'),
    openclaw_source_pack_judgment_read_source: projection.openClawSourcePackDiagnostics?.judgmentReadSource || projection.openClawSourcePackRunner?.diagnostics?.judgmentReadSource || 'not-run',
    openclaw_source_pack_active_surface: projection.openClawSourcePackDiagnostics?.activeSurface || projection.openClawSourcePackRunner?.diagnostics?.activeSurface || 'unknown',
    openclaw_source_pack_runner_render_gate: projection.openClawSourcePackDiagnostics?.runnerRenderGate || projection.openClawSourcePackRunner?.diagnostics?.runnerRenderGate || 'unknown',
    openclaw_source_pack_runner_render_blocker: projection.openClawSourcePackDiagnostics?.runnerRenderBlocker || projection.openClawSourcePackRunner?.diagnostics?.runnerRenderBlocker || 'unknown',
    openclaw_source_pack_parent_panel_id: projection.openClawSourcePackDiagnostics?.parentPanelId || projection.openClawSourcePackRunner?.diagnostics?.parentPanelId || 'unknown',
    openclaw_source_pack_controls_mounted_count: String(projection.openClawSourcePackDiagnostics?.controlsMountedCount ?? projection.openClawSourcePackRunner?.diagnostics?.controlsMountedCount ?? '0'),
    openclaw_source_pack_next_operator_action: projection.openClawSourcePackRunner?.nextOperatorAction || 'Copy the Source Pack CLI Prompt and paste a bounded source-pack result.',
    openclaw_workspace_hygiene_status: projection.openClawWorkspaceHygiene?.workspaceHygieneStatus || 'clean',
    openclaw_workspace_dirt_detected: projection.openClawWorkspaceHygiene?.workspaceDirtDetected || 'no',
    openclaw_workspace_dirt_paths: (projection.openClawWorkspaceHygiene?.workspaceDirtPaths || []).join(' | ') || 'none',
    openclaw_workspace_dirt_count: String(projection.openClawWorkspaceHygiene?.workspaceDirtCount ?? 0),
    openclaw_workspace_blocks_ignition: projection.openClawWorkspaceHygiene?.workspaceBlocksIgnition || 'no',
    openclaw_workspace_recommended_cleanup: projection.openClawWorkspaceHygiene?.workspaceRecommendedCleanup || 'No cleanup needed.',
    openclaw_workspace_safe_runtime_directory: projection.openClawWorkspaceHygiene?.workspaceSafeRuntimeDirectory || 'unknown',
    openclaw_workspace_mutation_authority: projection.openClawWorkspaceHygiene?.workspaceMutationAuthority || 'locked',
    openclaw_workspace_next_operator_action: projection.openClawWorkspaceHygiene?.workspaceNextOperatorAction || 'No OpenClaw workspace dirt detected.',
    builder_workbench_projection_source: present ? source : 'none',
    builder_workbench_metadata_source: present ? 'support-snapshot-live-operator-relief-projection' : 'none',
    builder_workbench_deterministic_answer_used: 'no',
    builder_workbench_projection_drop_boundary: present ? 'none' : 'builder-workbench-projection-not-found-in-live-runtime-status',
  };
}


function resolveLiveBuilderMeshProjection(runtimeStatus = {}) {
  const candidates = [
    ['runtimeStatus.operatorReliefProjection.builderMeshProjection', runtimeStatus?.operatorReliefProjection?.builderMeshProjection],
    ['runtimeStatus.runtimeContext.operatorReliefProjection.builderMeshProjection', runtimeStatus?.runtimeContext?.operatorReliefProjection?.builderMeshProjection],
    ['runtimeStatus.missionState.operatorReliefProjection.builderMeshProjection', runtimeStatus?.missionState?.operatorReliefProjection?.builderMeshProjection],
    ['runtimeStatus.inputMissionState.operatorReliefProjection.builderMeshProjection', runtimeStatus?.inputMissionState?.operatorReliefProjection?.builderMeshProjection],
    ['runtimeStatus.builderMeshProjection', runtimeStatus?.builderMeshProjection],
  ];
  const found = candidates.find(([, value]) => value && typeof value === 'object' && Object.keys(value).length > 0);
  return found ? { source: found[0], projection: found[1] } : { source: 'none', projection: {} };
}


function evidenceReturnIntakeSupportSnapshotFields(projection = {}) {
  const intake = projection && typeof projection === 'object' ? projection : {};
  return {
    evidenceReturnIntakeStatus: intake.status || 'unavailable',
    evidenceReturnIntakeAvailable: intake.intakeAvailable ? 'yes' : 'no',
    evidenceReturnIntakeSource: intake.intakeSource || 'none',
    evidenceReturnIntakeRelatedPacketId: intake.relatedPacketId || 'none',
    evidenceReturnIntakeRelatedMissionId: intake.relatedMissionId || 'mission-unknown',
    evidenceReturnIntakeRelatedEvidenceType: intake.relatedEvidenceType || 'none',
    evidenceReturnIntakeParsedResultPresent: intake.parsedResultPresent ? 'yes' : 'no',
    evidenceReturnIntakeParsedResultStatus: intake.parsedResultStatus || 'unknown',
    evidenceReturnIntakeProofObservedCount: String(intake.proofObservedCount ?? 0),
    evidenceReturnIntakeProofFailedCount: String(intake.proofFailedCount ?? 0),
    evidenceReturnIntakeProofPendingReviewCount: String(intake.proofPendingReviewCount ?? 0),
    evidenceReturnIntakeProofBlockedCount: String(intake.proofBlockedCount ?? 0),
    evidenceReturnIntakeMissingProofResolved: intake.missingProofResolved ? 'yes' : 'no',
    evidenceReturnIntakeRemainingMissingProofSummary: intake.remainingMissingProofSummary || 'none',
    evidenceReturnIntakeTrustedForMerge: intake.trustedForMerge ? 'yes' : 'no',
    evidenceReturnIntakeTrustedForCanon: intake.trustedForCanon ? 'yes' : 'no',
    evidenceReturnIntakeRecommendedNextAction: intake.recommendedNextAction || 'Paste returned proof and classify/review.',
    evidenceReturnIntakeMutationAllowed: intake.mutationAllowed ? 'yes' : 'no',
    evidenceReturnIntakeDurableWriteAllowed: intake.durableWriteAllowed ? 'yes' : 'no',
    evidenceReturnIntakeOperatorApprovalRequiredForWrite: intake.operatorApprovalRequiredForWrite === false ? 'no' : 'yes',
    evidenceReturnIntakeOpenClawMutationLocked: intake.openClawMutationLocked === false ? 'no' : 'yes',
    evidenceReturnIntakeCodexAutoDispatchAllowed: intake.codexAutoDispatchAllowed ? 'yes' : 'no',
    browserProofIntakeStatus: intake.browserProofIntakeStatus || 'unavailable',
    browserProofKnownCaveatPresent: intake.browserProofKnownCaveatPresent ? 'yes' : 'no',
    browserProofCaveatBlocking: intake.browserProofCaveatBlocking ? 'yes' : 'no',
    browserProofRejectionReason: intake.browserProofRejectionReason || 'none',
    browserProofAcceptedWithCaveat: intake.browserProofAcceptedWithCaveat ? 'yes' : 'no',
    evidenceReturnIntakeConfidence: intake.confidence || 'low',
    evidenceIntakeAutomationStatus: intake.status || 'idle',
    evidenceIntakeClassifiedProofCount: String(intake.classifiedProofCount ?? intake.proofObservedCount ?? 0),
    evidenceIntakeAcceptedProofItems: (intake.acceptedProofItems || []).join('|') || 'none',
    evidenceIntakeRejectedProofItems: (intake.rejectedProofItems || []).join('|') || 'none',
    evidenceIntakeClassificationConfidence: intake.confidence || 'low',
    evidenceIntakeLastClassifiedSource: intake.lastClassifiedSource || intake.intakeSource || 'none',
    evidenceIntakeRemainingMissingItems: (intake.remainingMissingProofItems || []).join('|') || intake.remainingMissingProofSummary || 'none',
    evidenceIntakeNextBestAction: intake.recommendedNextAction || 'Paste returned proof into Evidence Return Intake.',
    evidenceIntakeEchoPresent: intake.rawIntakeText ? 'yes' : 'no',
    evidenceIntakeEchoSource: intake.rawIntakeText ? (intake.intakeSource || 'operator-paste') : 'none',
    evidenceIntakeEchoClassifiedItems: (intake.parsedFindings || []).map((item) => `${item.evidenceType}:${item.status}`).join('|') || 'none',
    evidenceReturnIntakeWarningCount: String((intake.warnings || []).length),
    evidenceReturnIntakeSummary: intake.summary || 'Evidence Return Intake unavailable.',
  };
}

function missionEvidenceLedgerSupportSnapshotFields(projection = {}) {
  const ledger = projection && typeof projection === 'object' ? projection : {};
  const topEntrySummary = Array.isArray(ledger.topEntries)
    ? ledger.topEntries.map((entry) => `${entry.type || entry.eventType || 'entry'}: ${entry.summary || 'no summary'}`).filter(Boolean).join(' | ')
    : '';
  return {
    missionEvidenceLedgerStatus: ledger.status || 'unavailable',
    missionEvidenceLedgerMissionId: ledger.missionId || 'mission-unknown',
    missionEvidenceLedgerMissionTitle: ledger.missionTitle || 'unknown',
    missionEvidenceLedgerMissionPhase: ledger.missionPhase || 'unknown',
    missionEvidenceCompleteness: ledger.completeness || 'low',
    missionEvidenceLedgerEntryCount: String(ledger.entryCount ?? 0),
    missionEvidenceLedgerProofEntryCount: String(ledger.proofEntryCount ?? 0),
    missionEvidenceLedgerWarningCount: String(ledger.warningCount ?? 0),
    missionEvidenceLedgerBlockerCount: String(ledger.blockerCount ?? 0),
    missionEvidenceLedgerPendingReviewCount: String(ledger.pendingReviewCount ?? 0),
    missionEvidenceLatestEvent: ledger.latestEvent || 'none',
    missionEvidenceNextRequired: ledger.nextRequiredEvidence || 'none',
    missionEvidenceLedgerNextAction: ledger.nextAction || 'not reported',
    missionEvidenceLedgerProjectionSource: ledger.projectionSource || 'none',
    missionEvidenceLedgerConfidence: ledger.confidence || 'low',
    missionEvidenceLedgerDurableWriteAllowed: ledger.durableWriteAllowed ? 'yes' : 'no',
    missionEvidenceLedgerOperatorApprovalRequiredForWrite: ledger.operatorApprovalRequiredForWrite === false ? 'no' : 'yes',
    missionEvidenceLedgerMutationAllowed: ledger.mutationAllowed ? 'yes' : 'no',
    missionEvidenceLedgerOpenClawMutationLocked: ledger.openClawMutationLocked === false ? 'no' : 'yes',
    missionEvidenceLedgerCodexAutoDispatchAllowed: ledger.codexAutoDispatchAllowed ? 'yes' : 'no',
    missionEvidenceLedgerTopEntrySummary: topEntrySummary || 'none',
    missionEvidenceLedgerMissingProofSummary: ledger.missingProofSummary || 'none',
    missionEvidenceLedgerTrustedForMerge: ledger.trustedForMerge ? 'yes' : 'no',
    missionEvidenceLedgerTrustedForCanon: ledger.trustedForCanon ? 'yes' : 'no',
  };
}

function missionEvidenceLedgerProjectionFromRuntimeFields(runtimeStatus = {}) {
  const status = asText(runtimeStatus?.missionEvidenceLedgerStatus, '');
  const source = asText(runtimeStatus?.missionEvidenceLedgerProjectionSource, '');
  const entryCount = Number(runtimeStatus?.missionEvidenceLedgerEntryCount || 0);
  if (status === 'unavailable' || (!status && !source && entryCount === 0)) return null;
  return {
    status: status || (entryCount > 0 ? 'active' : 'unavailable'),
    missionId: runtimeStatus?.missionEvidenceLedgerMissionId,
    missionTitle: runtimeStatus?.missionEvidenceLedgerMissionTitle,
    missionPhase: runtimeStatus?.missionEvidenceLedgerMissionPhase,
    completeness: runtimeStatus?.missionEvidenceCompleteness,
    entryCount,
    proofEntryCount: Number(runtimeStatus?.missionEvidenceLedgerProofEntryCount || 0),
    warningCount: Number(runtimeStatus?.missionEvidenceLedgerWarningCount || 0),
    blockerCount: Number(runtimeStatus?.missionEvidenceLedgerBlockerCount || 0),
    pendingReviewCount: Number(runtimeStatus?.missionEvidenceLedgerPendingReviewCount || 0),
    latestEvent: runtimeStatus?.missionEvidenceLatestEvent,
    nextRequiredEvidence: runtimeStatus?.missionEvidenceNextRequired,
    nextAction: runtimeStatus?.missionEvidenceLedgerNextAction,
    projectionSource: source || 'runtime-status-mission-evidence-ledger-fields',
    confidence: runtimeStatus?.missionEvidenceLedgerConfidence,
    durableWriteAllowed: String(runtimeStatus?.missionEvidenceLedgerDurableWriteAllowed || '').toLowerCase() === 'yes',
    operatorApprovalRequiredForWrite: String(runtimeStatus?.missionEvidenceLedgerOperatorApprovalRequiredForWrite || 'yes').toLowerCase() !== 'no',
    mutationAllowed: String(runtimeStatus?.missionEvidenceLedgerMutationAllowed || '').toLowerCase() === 'yes',
    openClawMutationLocked: String(runtimeStatus?.missionEvidenceLedgerOpenClawMutationLocked || 'yes').toLowerCase() !== 'no',
    codexAutoDispatchAllowed: String(runtimeStatus?.missionEvidenceLedgerCodexAutoDispatchAllowed || '').toLowerCase() === 'yes',
    trustedForMerge: String(runtimeStatus?.missionEvidenceLedgerTrustedForMerge || '').toLowerCase() === 'yes',
    trustedForCanon: String(runtimeStatus?.missionEvidenceLedgerTrustedForCanon || '').toLowerCase() === 'yes',
    missingProofSummary: runtimeStatus?.missionEvidenceLedgerMissingProofSummary,
    topEntries: runtimeStatus?.missionEvidenceLedgerTopEntrySummary && runtimeStatus.missionEvidenceLedgerTopEntrySummary !== 'none'
      ? [{ type: 'runtime-field', summary: runtimeStatus.missionEvidenceLedgerTopEntrySummary }]
      : [],
  };
}

function resolveLiveBuilderWorkbenchProjection(runtimeStatus = {}) {
  const candidates = [
    ['runtimeStatus.operatorReliefProjection.builderMeshProjection.builderWorkbenchProjection', runtimeStatus?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection],
    ['runtimeStatus.runtimeContext.operatorReliefProjection.builderMeshProjection.builderWorkbenchProjection', runtimeStatus?.runtimeContext?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection],
    ['runtimeStatus.missionState.operatorReliefProjection.builderMeshProjection.builderWorkbenchProjection', runtimeStatus?.missionState?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection],
    ['runtimeStatus.inputMissionState.operatorReliefProjection.builderMeshProjection.builderWorkbenchProjection', runtimeStatus?.inputMissionState?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection],
    ['runtimeStatus.builderMeshProjection.builderWorkbenchProjection', runtimeStatus?.builderMeshProjection?.builderWorkbenchProjection],
  ];
  const found = candidates.find(([, value]) => value && typeof value === 'object' && Object.keys(value).length > 0);
  return found ? { source: found[0], projection: found[1] } : { source: 'none', projection: {} };
}

function resolveBuilderWorkbenchSupportMetadata(executionMetadata = {}, runtimeStatus = {}) {
  const live = resolveLiveBuilderWorkbenchProjection(runtimeStatus);
  const liveMetadata = buildWorkbenchMetadataFromProjection(live.projection, live.source);
  const liveMesh = resolveLiveBuilderMeshProjection(runtimeStatus);
  const liveMeshMetadata = buildBuilderMeshMetadataFromProjection(liveMesh.projection, liveMesh.source);
  const fields = [
    ['builder_mesh_status', 'unavailable'],
    ['builder_mesh_recommended_builder', 'hold'],
    ['builder_mesh_reason', 'Operator clarification is required before routing.'],
    ['builder_mesh_task_kind', 'unknown'],
    ['builder_mesh_openclaw_eligible', 'no'],
    ['builder_mesh_local_ai_eligible', 'no'],
    ['builder_mesh_codex_eligible', 'no'],
    ['builder_mesh_required_proof', 'none'],
    ['builder_mesh_missing_proof', 'none'],
    ['builder_mesh_next_best_action', 'Hold for operator clarification.'],
    ['builder_mesh_projection_source', 'none'],
    ['builder_workbench_status', 'unavailable'],
    ['builder_workbench_local_ai_review_result_present', 'no'],
    ['local_ai_runner_status', 'idle'],
    ['local_ai_runner_selected_model', 'none'],
    ['local_ai_runner_last_run_result', 'none'],
    ['local_ai_runner_last_run_blocked_reason', 'none'],
    ['local_ai_runner_error_message', 'none'],
    ['local_ai_runner_dispatch_attempted', 'no'],
    ['local_ai_runner_request_sent', 'no'],
    ['local_ai_runner_parsed_result_present', 'no'],
    ['workbench_answer_context_used', 'no'],
    ['workbench_answer_source', 'none'],
    ['workbench_parsed_result_source', 'none'],
    ['local_ai_runner_response_retained', 'no'],
    ['local_ai_runner_parse_attempted', 'no'],
    ['local_ai_runner_parse_input_length', '0'],
    ['local_ai_runner_parse_result_status', 'empty'],
    ['workbench_output_viewport_status', 'unknown'],
    ['builder_workbench_openclaw_research_result_present', 'no'],
    ['openclaw_web_research_intake_status', 'idle'],
    ['openclaw_web_access_status', 'unknown'],
    ['openclaw_research_source_count', '0'],
    ['openclaw_research_valid_url_count', '0'],
    ['openclaw_research_placeholder_leakage_detected', 'no'],
    ['openclaw_research_forbidden_leakage_detected', 'no'],
    ['openclaw_research_task_frame_adherence', 'unknown'],
    ['openclaw_research_trusted_for_canon', 'no'],
    ['openclaw_research_next_operator_action', 'Copy the bounded prompt, run OpenClaw externally/manually, then paste source-cited results for deterministic intake.'],
    ['builder_workbench_patch_plan_present', 'no'],
    ['builder_workbench_patch_plan_risk', 'unknown'],
    ['builder_workbench_approval_required_before_patch', 'yes'],
    ['builder_workbench_codex_fallback_still_needed', 'no'],
    ['builder_workbench_codex_fallback_reason', 'none'],
    ['builder_workbench_next_best_action', 'Copy Local AI/OpenClaw packets and paste bounded read-only results.'],
    ['openclaw_route_id', 'unknown'],
    ['openclaw_route_label', 'unknown'],
    ['openclaw_route_trust_status', 'untrusted'],
    ['openclaw_route_sanity_status', 'unknown'],
    ['openclaw_route_task_frame_status', 'unknown'],
    ['openclaw_route_session_id', 'unknown'],
    ['openclaw_active_session_count', '0'],
    ['openclaw_active_session_contamination_risk', 'no'],
    ['openclaw_route_model_pinned', 'unknown'],
    ['openclaw_route_model_configured_primary', 'unknown'],
    ['openclaw_route_model_mismatch_detected', 'no'],
    ['openclaw_model_pin_mismatch_warnings', 'none'],
    ['openclaw_plaintext_token_security_warning', 'no'],
    ['openclaw_doctor_non_blocking_findings', 'none'],
    ['openclaw_dashboard_failure_examples', 'none'],
    ['openclaw_minimum_viable_route_recommendation', 'Use stephanos-scout / llama3.2 CLI for bounded source-pack processing only; OpenClaw cannot mutate files.'],
    ['openclaw_sanity_status', 'idle'],
    ['openclaw_sanity_failure_reason', 'none'],
    ['openclaw_exact_response_status', 'unknown'],
    ['openclaw_exact_response_payload', 'none'],
    ['openclaw_cli_banner_ignored', 'no'],
    ['openclaw_template_leakage_detected', 'no'],
    ['openclaw_wrong_repo_path_detected', 'no'],
    ['openclaw_trusted_for_builder_routing', 'no'],
    ['openclaw_sanity_next_operator_action', 'Paste an OpenClaw result to run the sanity gate before Builder Mesh routing.'],
    ['openclaw_patch_planner_status', 'idle'],
    ['openclaw_patch_planner_risk_level', 'unknown'],
    ['openclaw_patch_planner_likely_file_count', '0'],
    ['openclaw_patch_planner_required_test_count', '0'],
    ['openclaw_patch_planner_browser_proof_required', 'unknown'],
    ['openclaw_patch_planner_forbidden_action_detected', 'no'],
    ['openclaw_patch_planner_placeholder_leakage_detected', 'no'],
    ['openclaw_patch_planner_codex_fallback_needed', 'unknown'],
    ['openclaw_patch_planner_trusted_for_patch', 'no'],
    ['openclaw_patch_planner_next_operator_action', 'Copy the OpenClaw Patch Planner Prompt and run it externally/read-only.'],
    ['openclaw_source_pack_runner_status', 'idle'],
    ['openclaw_source_pack_route', 'stephanos-scout / llama3.2 CLI'],
    ['openclaw_source_pack_model', 'ollama/llama3.2:3b'],
    ['openclaw_source_pack_result_present', 'no'],
    ['openclaw_source_pack_source_bounded', 'unknown'],
    ['openclaw_source_pack_hallucinated_sources_detected', 'no'],
    ['openclaw_source_pack_template_leakage_detected', 'no'],
    ['openclaw_source_pack_asks_for_next_detected', 'no'],
    ['openclaw_source_pack_useful_fact_count', '0'],
    ['openclaw_source_pack_unknown_count', '0'],
    ['openclaw_source_pack_risk_count', '0'],
    ['openclaw_source_pack_next_question_count', '0'],
    ['openclaw_source_pack_handoff_present', 'no'],
    ['openclaw_source_pack_trusted_for_canon', 'no'],
    ['openclaw_source_pack_trusted_for_research', 'no'],
    ['openclaw_source_pack_codex_fallback_needed', 'unknown'],
    ['openclaw_source_pack_judgment_stale', 'no'],
    ['openclaw_source_pack_last_judged_text_length', '0'],
    ['openclaw_source_pack_current_text_length', '0'],
    ['openclaw_source_pack_last_judged_output_length', '0'],
    ['openclaw_source_pack_current_output_length', '0'],
    ['openclaw_source_pack_projection_written', 'no'],
    ['openclaw_source_pack_projection_source', 'source-pack-runner-idle'],
    ['openclaw_source_pack_text_textarea_mounted', 'unknown'],
    ['openclaw_source_pack_output_textarea_mounted', 'unknown'],
    ['openclaw_source_pack_text_dom_value_length', '0'],
    ['openclaw_source_pack_output_dom_value_length', '0'],
    ['openclaw_source_pack_output_onchange_fired', 'no'],
    ['openclaw_source_pack_output_state_length', '0'],
    ['openclaw_source_pack_judgment_button_clicked', 'no'],
    ['openclaw_source_pack_judgment_read_output_length', '0'],
    ['openclaw_source_pack_judgment_read_source', 'not-run'],
    ['openclaw_source_pack_active_surface', 'unknown'],
    ['openclaw_source_pack_runner_render_gate', 'unknown'],
    ['openclaw_source_pack_runner_render_blocker', 'unknown'],
    ['openclaw_source_pack_parent_panel_id', 'unknown'],
    ['openclaw_source_pack_controls_mounted_count', '0'],
    ['openclaw_source_pack_next_operator_action', 'Copy the Source Pack CLI Prompt and paste a bounded source-pack result.'],
    ['openclaw_workspace_hygiene_status', 'clean'],
    ['openclaw_workspace_dirt_detected', 'no'],
    ['openclaw_workspace_dirt_paths', 'none'],
    ['openclaw_workspace_dirt_count', '0'],
    ['openclaw_workspace_blocks_ignition', 'no'],
    ['openclaw_workspace_recommended_cleanup', 'No cleanup needed.'],
    ['openclaw_workspace_safe_runtime_directory', 'unknown'],
    ['openclaw_workspace_mutation_authority', 'locked'],
    ['openclaw_workspace_next_operator_action', 'No OpenClaw workspace dirt detected.'],
    ['builder_workbench_projection_source', 'none'],
    ['builder_workbench_metadata_source', 'none'],
    ['builder_workbench_deterministic_answer_used', 'no'],
    ['builder_workbench_projection_drop_boundary', 'none'],
  ];
  return Object.fromEntries(fields.map(([key, fallback]) => [
    key,
    pickWorkbenchTruth(key, fallback, executionMetadata?.[key], liveMetadata[key], liveMeshMetadata[key]),
  ]));
}

function asList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return ['- n/a'];
  }
  return value.map((item) => `- ${asText(item, 'n/a')}`);
}


function getDocument() {
  return globalThis?.document || globalThis?.window?.document || null;
}

function elementExists(node) {
  return Boolean(node);
}

function safeGetComputedStyle(node) {
  if (!node || typeof globalThis?.getComputedStyle !== 'function') {
    return { display: 'block', visibility: 'visible', opacity: '1' };
  }
  try {
    return globalThis.getComputedStyle(node);
  } catch (_error) {
    return { display: 'block', visibility: 'visible', opacity: '1' };
  }
}

function getNodeRect(node) {
  const rect = node?.getBoundingClientRect?.();
  if (!rect) {
    return { top: 0, bottom: 0, left: 0, right: 0, width: Number(node?.clientWidth || 0), height: Number(node?.clientHeight || 0) };
  }
  const height = Number.isFinite(Number(rect.height)) ? Number(rect.height) : Math.max(0, Number(rect.bottom || 0) - Number(rect.top || 0));
  const width = Number.isFinite(Number(rect.width)) ? Number(rect.width) : Math.max(0, Number(rect.right || 0) - Number(rect.left || 0));
  return { ...rect, height, width };
}

function nodeHasBox(node) {
  if (!node) return false;
  const rect = getNodeRect(node);
  return rect.width > 0 && rect.height > 0;
}

function isNodeStyleHidden(node) {
  if (!node) return false;
  const style = safeGetComputedStyle(node);
  return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
}

function findCollapsedAncestor(node, stopAt = null) {
  let current = node?.parentElement || null;
  while (current && current !== stopAt) {
    if (isNodeStyleHidden(current)) return { node: current, reason: 'hidden-style' };
    const rect = getNodeRect(current);
    const clientHeight = Number(current.clientHeight || 0);
    if ((rect.height <= 0 && clientHeight <= 0) || current.hidden === true) {
      return { node: current, reason: 'collapsed-ancestor' };
    }
    current = current.parentElement || null;
  }
  return null;
}

function findVisibleMeasureNode(card, root = null) {
  if (!card) return null;
  if (nodeHasBox(card)) return card;
  const wrapper = card.closest?.('[data-testid="latest-assistant-answer-pane"], [data-testid="assistant-answer-pane"], [data-answer-role="assistant"][data-answer-final="true"]') || null;
  if (wrapper && wrapper !== card && nodeHasBox(wrapper)) return wrapper;
  let current = card.parentElement || null;
  while (current && current !== root) {
    const ownsAssistantCard = current.querySelector?.('[data-answer-role="assistant"][data-answer-final="true"][data-assistant-answer-id]') === card;
    if (ownsAssistantCard && nodeHasBox(current)) return current;
    current = current.parentElement || null;
  }
  return card;
}

function computeNodeVisibilityProof(card, { root = null, viewportHeight = 0 } = {}) {
  if (!card) {
    return { visible: 'no', visualProof: 'missing', blocker: 'wrong-node', measureNode: null, rect: getNodeRect(null) };
  }
  const measureNode = findVisibleMeasureNode(card, root);
  const rect = getNodeRect(measureNode);
  if (isNodeStyleHidden(measureNode) || isNodeStyleHidden(card)) {
    return { visible: 'no', visualProof: 'present-not-visible', blocker: 'hidden-style', measureNode, rect };
  }
  const collapsedAncestor = findCollapsedAncestor(measureNode, root);
  if (collapsedAncestor) {
    return { visible: 'no', visualProof: 'present-not-visible', blocker: collapsedAncestor.reason, measureNode, rect };
  }
  if (rect.height <= 0 || Number(measureNode?.clientHeight || 0) <= 0) {
    return { visible: 'no', visualProof: 'present-not-visible', blocker: 'zero-height', measureNode, rect };
  }
  if (rect.width <= 0) {
    return { visible: 'no', visualProof: 'present-not-visible', blocker: 'zero-height', measureNode, rect };
  }
  const viewportBottom = Number(viewportHeight || globalThis?.window?.innerHeight || 0);
  if (viewportBottom > 0 && (rect.bottom <= 0 || rect.top >= viewportBottom)) {
    return { visible: 'no', visualProof: 'present-not-visible', blocker: 'offscreen', measureNode, rect };
  }
  return { visible: 'yes', visualProof: 'visible', blocker: 'none', measureNode, rect };
}

function isAcceptableCommandDeckRoot(root) {
  if (!root?.querySelector) return false;
  const owner = String(root.getAttribute?.('data-surface-owner-key') || '').trim();
  const panel = String(root.getAttribute?.('data-panel-id') || root.closest?.('[data-panel-id]')?.getAttribute?.('data-panel-id') || '').trim();
  if (owner && owner !== 'commandDeck-pane') return false;
  if (panel && panel !== 'commandDeck') return false;
  return true;
}

function pickVisibleCommandDeckRoot(doc, checkedRootSelector) {
  const roots = Array.from(doc.querySelectorAll?.(checkedRootSelector) || []);
  if (roots.length === 0) {
    const single = doc.querySelector?.(checkedRootSelector) || null;
    return single && isAcceptableCommandDeckRoot(single) ? single : single;
  }
  const acceptable = roots.filter(isAcceptableCommandDeckRoot);
  const candidates = acceptable.length > 0 ? acceptable : roots;
  return candidates.find((node) => !isNodeStyleHidden(node) && nodeHasBox(node)) || candidates[0] || null;
}

function measureTextLengthDrift(domLength, metadataLength) {
  const finalLength = Number(metadataLength || 0);
  if (!Number.isFinite(finalLength) || finalLength <= 0) {
    return { drift: 'no', reason: 'final-metadata-text-length-unavailable' };
  }
  const liveLength = Number(domLength || 0);
  const absoluteDelta = Math.abs(liveLength - finalLength);
  const wildRatio = liveLength > Math.max(finalLength * 5, finalLength + 200);
  const drift = absoluteDelta > 200 && wildRatio;
  return {
    drift: drift ? 'yes' : 'no',
    reason: drift ? `dom-text-length-${liveLength}-differs-from-final-metadata-${finalLength}` : 'none',
  };
}

function sampleLiveCommandDeckProof(preferredAssistantAnswerId = '', finalAssistantTextLength = 0) {
  const doc = getDocument();
  const checkedRootSelector = '[data-testid="command-deck-root"][data-ai-chat-command-deck="true"], [data-ai-chat-command-deck="true"][data-panel-id="commandDeck"], [data-panel-id="commandDeck"] [data-testid="command-deck-root"], [data-panel-id="commandDeck"], [data-testid="command-deck-root"]';
  if (!doc?.querySelector) {
    return { source: 'missing', rootSelectorChecked: checkedRootSelector };
  }
  const root = pickVisibleCommandDeckRoot(doc, checkedRootSelector);
  if (!root?.querySelector) {
    return { source: 'missing', rootSelectorChecked: checkedRootSelector };
  }
  const history = root.querySelector('[data-testid="command-deck-answer-history"], [data-testid="command-deck-body"] [data-testid="command-deck-answer-history"], [data-pane-id="answer-history"] [data-testid="command-deck-answer-history"]');
  const queryRoot = history || root;
  const composer = root.querySelector('[data-testid="command-deck-composer"]');
  const input = root.querySelector('[data-testid="command-deck-input"]');
  const execute = root.querySelector('[data-testid="command-deck-execute"]');
  const inputVisible = computeNodeVisibilityProof(input, { root }).visible === 'yes';
  const executeVisible = computeNodeVisibilityProof(execute, { root }).visible === 'yes';
  const inputScrollHeight = Number(input?.scrollHeight || 0);
  const inputClientHeight = Number(input?.clientHeight || 0);
  const inputLarge = inputScrollHeight > 160 || String(input?.value || '').length > 600 || String(input?.dataset?.largeInputFixture || '').toLowerCase() === 'true';
  const inputAutoResizeEnabled = String(input?.dataset?.autoResize || '').toLowerCase() === 'true';
  const finalAssistantSelector = '[data-answer-role="assistant"][data-answer-final="true"][data-assistant-answer-id]';
  const answers = Array.from(queryRoot.querySelectorAll(finalAssistantSelector));
  const preferred = preferredAssistantAnswerId
    ? answers.find((node) => String(node.getAttribute?.('data-assistant-answer-id') || '') === String(preferredAssistantAnswerId))
    : null;
  const visibleAnswers = answers.filter((node) => computeNodeVisibilityProof(node, { root }).visible === 'yes');
  const latest = preferred || visibleAnswers[visibleAnswers.length - 1] || answers[answers.length - 1] || null;
  const visibility = computeNodeVisibilityProof(latest, { root });
  const measureNode = visibility.measureNode || latest;
  const answerTextLength = latest?.textContent?.trim?.().length || 0;
  const drift = measureTextLengthDrift(answerTextLength, finalAssistantTextLength);
  return {
    source: 'live-dom',
    rootSelectorChecked: checkedRootSelector,
    root,
    rootFound: elementExists(root) ? 'yes' : 'no',
    historyFound: elementExists(history) ? 'yes' : 'no',
    composerFound: elementExists(composer) ? 'yes' : 'no',
    inputFound: elementExists(input) ? 'yes' : 'no',
    executeFound: elementExists(execute) ? 'yes' : 'no',
    commandDeckInputAutoResizeEnabled: inputAutoResizeEnabled ? 'yes' : 'no',
    commandDeckInputScrollHeight: String(inputScrollHeight),
    commandDeckInputClientHeight: String(inputClientHeight),
    commandDeckInputCanScroll: inputScrollHeight > inputClientHeight ? 'yes' : 'no',
    commandDeckExecuteButtonVisible: executeVisible ? 'yes' : 'no',
    commandDeckExecuteVisibleWithLargeInput: inputLarge ? (executeVisible ? 'yes' : 'no') : 'not-large',
    commandDeckLargePasteUsabilityStatus: inputAutoResizeEnabled && inputVisible && executeVisible && inputScrollHeight > 0 && inputClientHeight > 0 && (!inputLarge || executeVisible) ? 'OK' : 'fail',
    answerPaneCount: String(answers.length),
    latestAnswerFound: elementExists(latest) ? 'yes' : 'no',
    latestFinalAssistantCardFound: elementExists(latest) ? 'yes' : 'no',
    latestAnswerId: latest?.getAttribute?.('data-assistant-answer-id') || 'none',
    latestAnswerFinal: latest?.getAttribute?.('data-answer-final') || 'no',
    latestAnswerTextLength: String(answerTextLength),
    latestAssistantAnswerVisible: visibility.visible,
    latestAssistantVisualProof: visibility.visualProof,
    latestAssistantVisibilityBlocker: visibility.blocker,
    latestAssistantTextLengthDrift: drift.drift,
    latestAssistantTextLengthDriftReason: drift.reason,
    answerPaneClientHeight: String(measureNode?.clientHeight ?? 0),
    answerPaneScrollHeight: String(measureNode?.scrollHeight ?? 0),
    answerContainerClientHeight: String(history?.clientHeight ?? 0),
    answerContainerScrollHeight: String(history?.scrollHeight ?? 0),
    latestAnswerCardClientHeight: String(measureNode?.clientHeight ?? 0),
    latestAnswerCardScrollHeight: String(measureNode?.scrollHeight ?? 0),
    answerViewportClientHeight: String(history?.clientHeight ?? 0),
    answerViewportScrollHeight: String(history?.scrollHeight ?? 0),
    ownerAttr: root.getAttribute?.('data-surface-owner-key') || 'unknown',
    submissionSourceAttr: root.getAttribute?.('data-submission-source') || 'unknown',
  };
}
function deriveCommandDeckProof({ aiConsoleAnswerScroll = {}, commandDeckLocalReveal = null, executionMetadata = {} } = {}) {
  const live = sampleLiveCommandDeckProof(aiConsoleAnswerScroll?.latestAssistantAnswerId || executionMetadata?.final_assistant_message_id || '', executionMetadata?.final_assistant_text_length || 0);
  const localRootRef = asText(commandDeckLocalReveal?.rootRefPresent || aiConsoleAnswerScroll?.commandDeckLocalRootRefPresent, 'no') === 'yes';
  const localHistoryRef = asText(commandDeckLocalReveal?.historyRefPresent || aiConsoleAnswerScroll?.commandDeckLocalHistoryRefPresent, 'no') === 'yes';
  const localLatestRef = asText(commandDeckLocalReveal?.latestAnswerRefPresent || aiConsoleAnswerScroll?.commandDeckLocalLatestAnswerRefPresent, 'no') === 'yes';
  const metadataRendered = asText(executionMetadata?.answer_delivery_rendered || executionMetadata?.command_pipeline_last_answer_pane_rendered, 'no') === 'yes';
  const answerPaneCount = Number.parseInt(live.answerPaneCount || aiConsoleAnswerScroll?.answerPaneCount || '0', 10) || 0;
  const renderProofSource = live.source === 'live-dom' && answerPaneCount > 0
    ? 'live-dom'
    : (localLatestRef || (localRootRef && localHistoryRef && metadataRendered))
      ? 'local-ref'
      : metadataRendered
        ? 'final-metadata'
        : 'missing';
  const latestAssistantDomProofSource = live.latestAnswerFound === 'yes'
    ? 'live-dom'
    : localLatestRef
      ? 'local-ref'
      : 'missing';
  const renderedWithZeroPaneExplanation = metadataRendered && answerPaneCount === 0 && renderProofSource === 'local-ref'
    ? 'render-proof-from-local-ref'
    : 'none';
  return {
    live,
    renderProofSource,
    latestAssistantDomProofSource,
    renderedWithZeroPaneExplanation,
    visibleDeckRootFound: live.rootFound || aiConsoleAnswerScroll?.visibleDeckRootFound || 'no',
    historyContainerFound: live.historyFound || aiConsoleAnswerScroll?.historyContainerFound || 'no',
    composerFound: live.composerFound || aiConsoleAnswerScroll?.composerFound || 'no',
    inputFound: live.inputFound || aiConsoleAnswerScroll?.inputFound || 'no',
    executeFound: live.executeFound || aiConsoleAnswerScroll?.executeFound || 'no',
    answerPaneCount: live.source === 'live-dom' ? live.answerPaneCount : asText(aiConsoleAnswerScroll?.answerPaneCount, '0'),
    latestAssistantAnswerDomFound: live.latestAnswerFound === 'yes' ? 'yes' : asText(aiConsoleAnswerScroll?.latestAssistantAnswerDomFound || aiConsoleAnswerScroll?.targetFound, 'no'),
    latestAssistantAnswerId: live.latestAnswerFound === 'yes' ? live.latestAnswerId : asText(aiConsoleAnswerScroll?.latestAssistantAnswerId, 'none'),
    latestAssistantAnswerFinal: live.latestAnswerFound === 'yes' ? live.latestAnswerFinal : asText(aiConsoleAnswerScroll?.latestAssistantAnswerFinal, 'no'),
    latestAssistantAnswerTextLength: live.latestAnswerFound === 'yes' ? live.latestAnswerTextLength : asText(aiConsoleAnswerScroll?.latestAssistantAnswerTextLength, '0'),
    latestFinalAssistantCardFound: live.latestFinalAssistantCardFound === 'yes' ? 'yes' : asText(aiConsoleAnswerScroll?.latestFinalAssistantCardFound, 'no'),
    latestAssistantAnswerVisible: live.latestAnswerFound === 'yes' ? live.latestAssistantAnswerVisible : asText(aiConsoleAnswerScroll?.latestAssistantAnswerVisible, 'no'),
    latestAssistantVisualProof: live.latestAnswerFound === 'yes' ? live.latestAssistantVisualProof : (asText(aiConsoleAnswerScroll?.latestAssistantAnswerVisible, 'no') === 'yes' ? 'visible' : (asText(aiConsoleAnswerScroll?.latestAssistantAnswerDomFound || aiConsoleAnswerScroll?.targetFound, 'no') === 'yes' ? 'present-not-visible' : 'missing')),
    latestAssistantVisibilityBlocker: live.latestAnswerFound === 'yes' ? live.latestAssistantVisibilityBlocker : asText(aiConsoleAnswerScroll?.latestAssistantVisibilityBlocker, 'unknown'),
    latestAssistantTextLengthDrift: live.latestAnswerFound === 'yes' ? live.latestAssistantTextLengthDrift : asText(aiConsoleAnswerScroll?.latestAssistantTextLengthDrift, 'no'),
    latestAssistantTextLengthDriftReason: live.latestAnswerFound === 'yes' ? live.latestAssistantTextLengthDriftReason : asText(aiConsoleAnswerScroll?.latestAssistantTextLengthDriftReason, 'none'),
    answerPaneClientHeight: live.latestAnswerFound === 'yes' ? live.answerPaneClientHeight : asText(aiConsoleAnswerScroll?.answerPaneClientHeight, '0'),
    answerPaneScrollHeight: live.latestAnswerFound === 'yes' ? live.answerPaneScrollHeight : asText(aiConsoleAnswerScroll?.answerPaneScrollHeight, '0'),
    answerContainerClientHeight: live.source === 'live-dom' ? live.answerContainerClientHeight : asText(aiConsoleAnswerScroll?.answerContainerClientHeight, '0'),
    answerContainerScrollHeight: live.source === 'live-dom' ? live.answerContainerScrollHeight : asText(aiConsoleAnswerScroll?.answerContainerScrollHeight, '0'),
    latestAnswerCardClientHeight: live.latestAnswerFound === 'yes' ? live.latestAnswerCardClientHeight : asText(aiConsoleAnswerScroll?.latestAnswerCardClientHeight, '0'),
    latestAnswerCardScrollHeight: live.latestAnswerFound === 'yes' ? live.latestAnswerCardScrollHeight : asText(aiConsoleAnswerScroll?.latestAnswerCardScrollHeight, '0'),
    answerViewportClientHeight: live.source === 'live-dom' ? live.answerViewportClientHeight : asText(aiConsoleAnswerScroll?.answerViewportClientHeight, '0'),
    answerViewportScrollHeight: live.source === 'live-dom' ? live.answerViewportScrollHeight : asText(aiConsoleAnswerScroll?.answerViewportScrollHeight, '0'),
  };
}

function isElementHiddenForMissionConsoleSample(node) {
  if (!node) return true;
  const attr = (name) => (typeof node.getAttribute === 'function' ? String(node.getAttribute(name) || '').trim().toLowerCase() : '');
  if (attr('hidden') === 'true' || attr('aria-hidden') === 'true' || attr('data-collapsed') === 'true') return true;
  const style = node.style || {};
  if (String(style.display || '').toLowerCase() === 'none' || String(style.visibility || '').toLowerCase() === 'hidden') return true;
  if (typeof node.getClientRects === 'function') {
    try {
      const rects = node.getClientRects();
      if (rects && rects.length === 0) return true;
    } catch {}
  }
  return false;
}

function collectMissionConsoleNodes(root, selector) {
  if (!root) return [];
  if (typeof root.querySelectorAll === 'function') {
    try { return Array.from(root.querySelectorAll(selector) || []); } catch { return []; }
  }
  if (typeof root.querySelector === 'function') {
    const node = root.querySelector(selector);
    return node ? [node] : [];
  }
  return [];
}

function getMissionConsoleNodeAttr(node, name, fallback = '') {
  return typeof node?.getAttribute === 'function' ? (node.getAttribute(name) || fallback) : fallback;
}

function sampleLiveMissionConsoleComponentTrace() {
  const doc = getDocument();
  if (!doc?.querySelector) return null;
  const wrapperSelector = '[data-testid="ai-core-mission-console"]';
  const markerSelector = '[data-mission-console-component="MissionConsoleTile"]';
  const aiCoreNodes = collectMissionConsoleNodes(doc, wrapperSelector);
  const wrapperFacts = aiCoreNodes.map((node, index) => {
    const markers = collectMissionConsoleNodes(node, markerSelector);
    const panelId = getMissionConsoleNodeAttr(node, 'data-panel-id', getMissionConsoleNodeAttr(node, 'data-pane-id', 'unknown'));
    const hidden = isElementHiddenForMissionConsoleSample(node);
    return { node, index, markers, panelId, visible: !hidden };
  });
  const visibleWrappers = wrapperFacts.filter((fact) => fact.visible);
  const canonicalVisibleWrapper = visibleWrappers.find((fact) => fact.panelId === 'aiCoreMissionConsolePanel' && fact.markers.length > 0)
    || visibleWrappers.find((fact) => fact.panelId === 'aiCoreMissionConsolePanel')
    || wrapperFacts.find((fact) => fact.panelId === 'aiCoreMissionConsolePanel' && fact.markers.length > 0)
    || wrapperFacts.find((fact) => fact.markers.length > 0)
    || wrapperFacts[0]
    || null;
  const selectedMarker = canonicalVisibleWrapper?.markers?.[0] || null;
  const aiCorePane = selectedMarker ? null : doc.querySelector('[data-pane-id="aiCoreMissionConsolePanel"]');
  const paneMarker = selectedMarker ? null : aiCorePane?.querySelector?.(markerSelector);
  const marker = selectedMarker || paneMarker || null;
  const markerPanelId = getMissionConsoleNodeAttr(marker, 'data-mission-console-panel-id', 'unknown');
  const wrapperMarkerCounts = wrapperFacts.map((fact) => `${fact.index}:${fact.panelId}:${fact.visible ? 'visible' : 'hidden'}:${fact.markers.length}`).join('|') || 'none';
  const selectedWrapperIndex = canonicalVisibleWrapper ? String(canonicalVisibleWrapper.index) : 'none';
  const selectedWrapperReason = canonicalVisibleWrapper
    ? (canonicalVisibleWrapper.visible && canonicalVisibleWrapper.panelId === 'aiCoreMissionConsolePanel' ? 'visible-ai-core-panel'
      : canonicalVisibleWrapper.visible ? 'visible-ai-core-wrapper'
      : canonicalVisibleWrapper.markers.length > 0 ? 'hidden-wrapper-with-marker-fallback'
      : 'first-wrapper-fallback')
    : (paneMarker ? 'pane-fallback' : 'none');
  if (!marker) {
    return {
      source: 'missing',
      selectorPathChecked: `${wrapperSelector} ${markerSelector} | [data-pane-id="aiCoreMissionConsolePanel"] ${markerSelector}`,
      aiCoreWrapperCount: String(aiCoreNodes.length),
      aiCoreVisibleWrapperCount: String(visibleWrappers.length),
      markerCountByWrapper: wrapperMarkerCounts,
      selectedWrapperIndex,
      selectedWrapperReason,
      selectorMissReason: aiCoreNodes.length === 0 ? 'ai-core-wrapper-missing' : 'missionconsoletile-marker-missing-under-selected-wrapper',
    };
  }
  const markerInsideAiCoreWrapper = canonicalVisibleWrapper?.node?.contains?.(marker) || selectedMarker === marker;
  return {
    source: markerInsideAiCoreWrapper ? 'live-dom' : 'pane-fallback',
    selectorPathChecked: markerInsideAiCoreWrapper ? `${wrapperSelector} ${markerSelector}` : `[data-pane-id="aiCoreMissionConsolePanel"] ${markerSelector}`,
    isMissionConsoleTile: getMissionConsoleNodeAttr(marker, 'data-mission-console-component') === 'MissionConsoleTile' ? 'yes' : 'no',
    panelId: markerPanelId,
    registrationEffectSeen: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-effect-seen', 'no'),
    registrationCallbackPropPresent: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-prop-present', 'no'),
    registrationCallbackInvoked: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-invoked', 'no'),
    registrationCallbackCallAttempted: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-call-attempted', 'no'),
    registrationCallbackReturned: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-returned', 'no'),
    registrationCallbackReturnType: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-type', 'unknown'),
    registrationCallbackReturnHandled: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-handled', 'no'),
    registrationCallbackReturnHandler: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-handler', 'unknown'),
    registrationCallbackReturnPanelId: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-panel-id', 'unknown'),
    registrationCallbackReturnSourceSurface: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-source-surface', 'unknown'),
    registrationCallbackReturnInstanceId: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-instance-id', 'unknown'),
    registrationCallbackReturnIdentity: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-identity', 'unknown'),
    registrationCallbackReturnSideEffectStatus: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-side-effect-status', 'unknown'),
    registrationCallbackReturnRegisteredInstanceSeen: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-registered-instance-seen', 'no'),
    registrationCallbackReturnRegisteredInstanceCount: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-registered-instance-count', '0'),
    registrationCallbackReturnDiagnosticsStamp: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-diagnostics-stamp', '0'),
    registrationCallbackReturnRegistryOwnerId: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-return-registry-owner-id', 'unknown'),
    registrationCallbackError: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-error', 'none'),
    registrationDropBoundary: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-drop-boundary', 'visible-surface-not-missionconsoletile'),
    registrationCallbackSource: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-source', 'unknown'),
    registrationCallbackPanelId: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-panel-id', 'unknown'),
    registrationCallbackIdentity: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-identity', 'unknown'),
    aiCoreWrapperCount: String(aiCoreNodes.length),
    aiCoreVisibleWrapperCount: String(visibleWrappers.length),
    markerCountByWrapper: wrapperMarkerCounts,
    selectedWrapperIndex,
    selectedWrapperReason,
    selectedMarkerPanelId: markerPanelId,
    selectedMarkerCallbackPresent: getMissionConsoleNodeAttr(marker, 'data-mission-console-registration-callback-prop-present', 'no'),
    selectorMissReason: 'none',
  };
}

function normalizeTruthText(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'n/a' || normalized === 'unknown' || normalized === 'none') return '';
  return normalized;
}

function isUnknownValue(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return !text
    || text === 'n/a'
    || text === 'unknown'
    || text === 'none'
    || text === 'null'
    || text === 'undefined';
}

function normalizeProjectAwarenessProjection({
  responseMode = 'direct-answer',
  metadata = {},
  providerIdsUsed = [],
} = {}) {
  const asKnown = (value) => {
    const normalized = String(value ?? '').trim();
    return normalized && !isUnknownValue(normalized) ? normalized : '';
  };
  const sources = String(metadata?.project_awareness_sources_used || '')
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item && item !== 'none');
  const hasMeaningfulField = Boolean(
    sources.length
    || asKnown(metadata?.project_awareness_current_mission)
    || asKnown(metadata?.project_awareness_next_best_action)
    || asKnown(metadata?.project_awareness_recommended_route)
    || asKnown(metadata?.project_awareness_operator_workflow_preference)
    || asKnown(metadata?.project_awareness_codex_role)
    || asKnown(metadata?.project_awareness_openclaw_role),
  );
  let projectAwarenessStatus = metadata?.project_awareness_pack_status || 'unavailable';
  if (projectAwarenessStatus === 'unavailable' && hasMeaningfulField) {
    projectAwarenessStatus = 'degraded';
  }
  const sourceSet = new Set(
    String(metadata?.chat_context_sources_used || '')
      .split('|')
      .map((item) => item.trim())
      .filter((item) => item && item !== 'none'),
  );
  if (responseMode === 'mission-planning' && projectAwarenessStatus !== 'unavailable') {
    sourceSet.add('projectAwareness');
  }
  const missionProviderReady = providerIdsUsed.includes('missionState');
  let chatContextMissionState = metadata?.chat_context_mission_state || 'unknown';
  if (responseMode === 'mission-planning' && (missionProviderReady || projectAwarenessStatus !== 'unavailable') && isUnknownValue(chatContextMissionState)) {
    chatContextMissionState = 'degraded';
  }
  let chatContextPackStatus = metadata?.chat_context_pack_status || 'unavailable';
  if (chatContextPackStatus === 'unavailable' && responseMode === 'mission-planning' && providerIdsUsed.length > 0) {
    chatContextPackStatus = 'degraded';
  }
  return {
    projectAwarenessStatus,
    projectAwarenessSourcesUsed: sources.length ? sources.join('|') : 'none',
    chatContextPackStatus,
    chatContextMissionState,
    chatContextSourcesUsed: sourceSet.size > 0 ? Array.from(sourceSet).join('|') : 'none',
  };
}


function firstKnownValue(candidates = [], fallback = 'n/a') {
  for (const candidate of candidates) {
    if (!isUnknownValue(candidate)) return String(candidate).trim();
  }
  return fallback;
}

function deriveMissionConsoleBridgeParityBlocker(executionMetadata = {}) {
  const explicit = asText(executionMetadata?.mission_console_bridge_parity_blocker, '');
  if (explicit) return explicit;
  const instanceCount = Number.parseInt(asText(executionMetadata?.mission_console_instance_count, '0'), 10);
  const visiblePublished = String(executionMetadata?.mission_console_visible_instance_published || '').trim().toLowerCase();
  const bridgePublished = String(executionMetadata?.operator_relief_bridge_published || '').trim().toLowerCase();
  if (Number.isFinite(instanceCount) && instanceCount <= 0) return 'instance-not-registered';
  if (visiblePublished === 'no') return 'visible-instance-not-published';
  if (bridgePublished === 'no') return 'projection-not-published';
  return 'bridge-instance-diagnostics-unavailable';
}


function normalizeMissionConsoleIdList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim() && value.trim() !== 'none') {
    return value.split('|').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function normalizeMissionConsoleDiagnostics(runtimeStatus = {}, executionMetadata = {}) {
  const storeDiagnostics = runtimeStatus?.operatorReliefProjectionBridge?.diagnostics
    && typeof runtimeStatus.operatorReliefProjectionBridge.diagnostics === 'object'
    ? runtimeStatus.operatorReliefProjectionBridge.diagnostics
    : {};
  const runtimeContextAlias = runtimeStatus?.runtimeContext?.operatorReliefBridgeDiagnostics
    && typeof runtimeStatus.runtimeContext.operatorReliefBridgeDiagnostics === 'object'
    ? runtimeStatus.runtimeContext.operatorReliefBridgeDiagnostics
    : {};
  const liveDiagnostics = runtimeContextAlias;
  const storeDiagnosticKeys = Object.keys(storeDiagnostics);
  const runtimeContextAliasKeys = Object.keys(runtimeContextAlias);
  const runtimeStatusAliasKeys = runtimeContextAliasKeys;
  const storeDiagnosticsPresent = storeDiagnosticKeys.length > 0;
  const runtimeContextAliasPresent = runtimeContextAliasKeys.length > 0;
  const runtimeStatusAliasPresent = runtimeStatusAliasKeys.length > 0;
  let runtimeDiagnosticsDropBoundary = 'none';
  if (!runtimeContextAliasPresent) {
    runtimeDiagnosticsDropBoundary = storeDiagnosticsPresent ? 'runtime-context-alias-missing' : 'runtime-context-missing-bridge-diagnostics';
  } else if (!runtimeStatusAliasPresent) {
    runtimeDiagnosticsDropBoundary = 'runtime-status-alias-missing';
  } else if (storeDiagnosticsPresent && storeDiagnostics.registrationDiagnosticsStamp
    && runtimeContextAlias.registrationDiagnosticsStamp
    && Number(runtimeContextAlias.registrationDiagnosticsStamp) < Number(storeDiagnostics.registrationDiagnosticsStamp)) {
    runtimeDiagnosticsDropBoundary = 'runtime-context-stale-before-store-write';
  } else if (storeDiagnosticsPresent && storeDiagnostics.publisherRegistryOwnerId
    && runtimeContextAlias.publisherRegistryOwnerId
    && storeDiagnostics.publisherRegistryOwnerId !== runtimeContextAlias.publisherRegistryOwnerId) {
    runtimeDiagnosticsDropBoundary = 'support-snapshot-wrong-runtime-object';
  }
  const liveDiagnosticKeys = Object.keys(liveDiagnostics);
  const livePublisherInstanceIds = normalizeMissionConsoleIdList(liveDiagnostics?.publisherRegistryInstanceIds);
  const livePublisherCount = Number(liveDiagnostics?.publisherRegistryInstanceCount);
  const liveCount = livePublisherInstanceIds.length > 0
    ? livePublisherInstanceIds.length
    : (Number.isFinite(livePublisherCount) ? livePublisherCount : Number(liveDiagnostics?.missionConsoleInstanceCount));
  const liveHasInstances = Number.isFinite(liveCount) && liveCount > 0;
  const liveRegistrationStamp = Number(liveDiagnostics?.registrationDiagnosticsStamp || 0);
  const liveHasStampedPublisherDiagnostics = liveRegistrationStamp > 0
    && liveDiagnostics?.publisherRegistryOwnerId
    && liveDiagnostics?.publisherSource
    && liveHasInstances;
  const liveHasRegistrationDiagnostics = liveRegistrationStamp > 0
    || liveDiagnostics?.appHandlerEntered === 'yes'
    || liveDiagnostics?.registrationAppHandlerSeen === 'yes';
  const liveHasCanonicalBridge = Object.keys(liveDiagnostics).length > 0
    && (liveDiagnostics?.published === 'yes' || liveHasInstances || liveHasRegistrationDiagnostics || Array.isArray(liveDiagnostics?.projectionKeysSeen));
  const executionCount = Number(executionMetadata?.mission_console_instance_count);
  const executionHasInstances = Number.isFinite(executionCount) && executionCount > 0;
  const useLiveDiagnostics = liveHasStampedPublisherDiagnostics || liveHasCanonicalBridge;
  const liveDomComponentTrace = sampleLiveMissionConsoleComponentTrace() || {};
  const uiRealityComponentTrace = Object.keys(liveDomComponentTrace).length && liveDomComponentTrace.source !== 'missing'
    ? liveDomComponentTrace
    : (runtimeStatus?.runtimeContext?.uiReality?.aiCoreMissionConsole?.componentTrace || {});
  const componentTraceSource = asText(
    uiRealityComponentTrace?.source,
    useLiveDiagnostics ? 'runtime-context' : (executionMetadata?.mission_console_component_trace_source || 'missing'),
  );
  const liveMarkerStamp = Number(uiRealityComponentTrace?.registrationCallbackReturnDiagnosticsStamp || 0);
  const executionRegistrationStamp = Number(executionMetadata?.mission_console_registration_diagnostics_stamp || 0);
  const registrationDiagnosticsSource = useLiveDiagnostics
    ? 'runtimeContext.operatorReliefBridgeDiagnostics'
    : (liveMarkerStamp > executionRegistrationStamp ? 'live-marker' : (Object.keys(executionMetadata).length ? 'final-execution-metadata' : 'missing'));
  const source = Object.keys(liveDiagnostics).length
    ? (useLiveDiagnostics ? 'live-operator-relief-bridge' : registrationDiagnosticsSource)
    : (Object.keys(executionMetadata).length ? registrationDiagnosticsSource : 'missing');
  const selected = useLiveDiagnostics ? liveDiagnostics : {};
  const selectedPublisherInstanceIds = useLiveDiagnostics ? normalizeMissionConsoleIdList(selected?.publisherRegistryInstanceIds) : [];
  const selectedCount = useLiveDiagnostics ? liveCount : executionCount;
  const selectedBridgeCapableInstanceIds = useLiveDiagnostics ? normalizeMissionConsoleIdList(selected?.missionConsoleBridgeCapableInstanceIds) : [];
  const selectedMarkerPanelId = asText(liveDomComponentTrace?.selectedMarkerPanelId || uiRealityComponentTrace?.selectedMarkerPanelId, 'unknown');
  const canonicalVisibleInstanceId = useLiveDiagnostics
    ? firstKnownValue([
      selectedMarkerPanelId,
      selected?.missionConsoleVisibleInstanceId,
      executionMetadata?.mission_console_visible_instance_id,
    ], 'unknown')
    : (executionMetadata?.mission_console_visible_instance_id || 'unknown');
  const visibleInstanceIsRegistered = selectedPublisherInstanceIds.includes(canonicalVisibleInstanceId)
    || normalizeMissionConsoleIdList(selected?.missionConsoleInstanceIds).includes(canonicalVisibleInstanceId);
  const visibleInstanceIsBridgeCapable = selectedBridgeCapableInstanceIds.length <= 0
    ? visibleInstanceIsRegistered
    : selectedBridgeCapableInstanceIds.includes(canonicalVisibleInstanceId);
  const canonicalVisibleInstancePublished = useLiveDiagnostics
    ? (visibleInstanceIsRegistered && visibleInstanceIsBridgeCapable ? 'yes' : (selected?.visibleInstancePublished || selected?.missionConsoleVisibleInstancePublished || executionMetadata?.mission_console_visible_instance_published || 'no'))
    : (executionMetadata?.mission_console_visible_instance_published || 'no');
  const runtimePathValid = runtimeContextAliasPresent
    && liveHasInstances
    && liveRegistrationStamp > 0
    && (selected?.missionConsoleBridgeParityStatus === 'OK' || selected?.bridgeParityBlocker === 'none' || selected?.missionConsoleBridgeParityBlocker === 'none');
  if (runtimePathValid) {
    runtimeDiagnosticsDropBoundary = 'none';
  }
  return {
    source,
    callbackSeen: useLiveDiagnostics
      ? (selected?.registrationCallbackInvoked || 'no')
      : (executionMetadata?.mission_console_registration_callback_seen || 'no'),
    storeUpdated: useLiveDiagnostics
      ? (selected?.storeUpdated || 'no')
      : (executionMetadata?.operator_relief_bridge_store_updated || 'no'),
    runtimeContextSeen: useLiveDiagnostics
      ? (selected?.runtimeContextSeen || 'no')
      : (executionMetadata?.operator_relief_bridge_runtime_context_seen || 'no'),
    operatorReliefBridgePublished: useLiveDiagnostics
      ? (selected?.published || executionMetadata?.operator_relief_bridge_published || 'no')
      : (executionMetadata?.operator_relief_bridge_published || selected?.published || 'no'),
    operatorReliefBridgeSourceSurface: useLiveDiagnostics
      ? (selected?.sourceSurface || executionMetadata?.operator_relief_bridge_source_surface || 'unknown')
      : (executionMetadata?.operator_relief_bridge_source_surface || 'unknown'),
    operatorReliefBridgeProjectionKeysSeen: useLiveDiagnostics
      ? (Array.isArray(selected?.projectionKeysSeen) ? selected.projectionKeysSeen.join('|') : (executionMetadata?.operator_relief_bridge_projection_keys_seen || 'none'))
      : (executionMetadata?.operator_relief_bridge_projection_keys_seen || (Array.isArray(selected?.projectionKeysSeen) ? selected.projectionKeysSeen.join('|') : 'none')),
    operatorReliefBridgeAgentRealityLoopSeen: useLiveDiagnostics
      ? (selected?.agentRealityLoopSeen ? 'yes' : (executionMetadata?.operator_relief_bridge_agent_reality_loop_seen || 'no'))
      : (executionMetadata?.operator_relief_bridge_agent_reality_loop_seen || (selected?.agentRealityLoopSeen ? 'yes' : 'no')),
    operatorReliefBridgeLastUpdatedAt: useLiveDiagnostics
      ? (selected?.lastUpdatedAt || executionMetadata?.operator_relief_bridge_last_updated_at || 'unknown')
      : (executionMetadata?.operator_relief_bridge_last_updated_at || 'unknown'),
    registrationDiagnosticsSource,
    registrationDiagnosticsStamp: useLiveDiagnostics
      ? (selected?.registrationDiagnosticsStamp || '0')
      : (liveMarkerStamp > executionRegistrationStamp ? (uiRealityComponentTrace?.registrationCallbackReturnDiagnosticsStamp || '0') : (executionMetadata?.mission_console_registration_diagnostics_stamp || '0')),
    registrationDiagnosticsOwnerId: useLiveDiagnostics
      ? (selected?.operatorReliefBridgeDiagnosticsStoreOwnerId || selected?.missionConsoleBridgeInstancesRefOwnerId || selected?.publisherRegistryOwnerId || 'unknown')
      : (liveMarkerStamp > executionRegistrationStamp ? (uiRealityComponentTrace?.registrationCallbackReturnRegistryOwnerId || 'unknown') : (executionMetadata?.mission_console_registration_diagnostics_owner_id || 'unknown')),
    storeBridgeDiagnosticsPresent: (storeDiagnosticsPresent || runtimeContextAliasPresent) ? 'yes' : 'no',
    rawStoreBridgeDiagnosticsPresent: storeDiagnosticsPresent ? 'yes' : 'no',
    storeBridgeDiagnosticsKeys: storeDiagnosticKeys.length ? storeDiagnosticKeys.sort().join('|') : 'none',
    storeBridgeDiagnosticsStamp: storeDiagnostics?.registrationDiagnosticsStamp ? String(storeDiagnostics.registrationDiagnosticsStamp) : '0',
    runtimeContextBridgeAliasPresent: runtimeContextAliasPresent ? 'yes' : 'no',
    runtimeContextBridgeAliasKeys: runtimeContextAliasKeys.length ? runtimeContextAliasKeys.sort().join('|') : 'none',
    runtimeStatusBridgeAliasPresent: runtimeStatusAliasPresent ? 'yes' : 'no',
    runtimeStatusBridgeAliasKeys: runtimeStatusAliasKeys.length ? runtimeStatusAliasKeys.sort().join('|') : 'none',
    runtimeDiagnosticsDropBoundary,
    runtimeDiagnosticsPresent: liveDiagnosticKeys.length > 0 ? 'yes' : 'no',
    runtimeDiagnosticsKeys: liveDiagnosticKeys.length ? liveDiagnosticKeys.sort().join('|') : 'none',
    runtimePublisherRegistryCount: liveHasStampedPublisherDiagnostics ? String(liveCount) : '0',
    runtimeDiagnosticsStamp: liveRegistrationStamp ? String(liveRegistrationStamp) : '0',
    runtimeDiagnosticsSourceId: liveDiagnosticKeys.length ? 'runtimeContext.operatorReliefBridgeDiagnostics' : 'missing',
    supportSnapshotDiagnosticsSourceId: useLiveDiagnostics ? 'runtimeContext.operatorReliefBridgeDiagnostics' : registrationDiagnosticsSource,
    registrationDiagnosticsLastUpdatedAt: useLiveDiagnostics
      ? (selected?.registrationDiagnosticsLastUpdatedAt || 'unknown')
      : (executionMetadata?.mission_console_registration_diagnostics_last_updated_at || 'unknown'),
    missionConsoleInstanceCount: Number.isFinite(selectedCount) ? String(selectedCount) : String(executionMetadata?.mission_console_instance_count || 0),
    missionConsoleInstanceIds: useLiveDiagnostics
      ? (selectedPublisherInstanceIds.length ? selectedPublisherInstanceIds.join('|') : (Array.isArray(selected?.missionConsoleInstanceIds) ? selected.missionConsoleInstanceIds.join('|') : (executionMetadata?.mission_console_instance_ids || 'none')))
      : (executionMetadata?.mission_console_instance_ids || 'none'),
    missionConsoleVisibleInstanceId: canonicalVisibleInstanceId,
    missionConsoleBridgeCapableInstanceIds: useLiveDiagnostics
      ? (selectedBridgeCapableInstanceIds.length ? selectedBridgeCapableInstanceIds.join('|') : (executionMetadata?.mission_console_bridge_capable_instance_ids || 'none'))
      : (executionMetadata?.mission_console_bridge_capable_instance_ids || 'none'),
    missionConsoleInstancesMissingBridgeCallback: useLiveDiagnostics
      ? (Array.isArray(selected?.missionConsoleInstancesMissingBridgeCallback) ? selected.missionConsoleInstancesMissingBridgeCallback.join('|') : (executionMetadata?.mission_console_instances_missing_bridge_callback || 'none'))
      : (executionMetadata?.mission_console_instances_missing_bridge_callback || 'none'),
    missionConsoleLastPublishingInstanceId: useLiveDiagnostics
      ? (selected?.missionConsoleLastPublishingInstanceId || executionMetadata?.mission_console_last_publishing_instance_id || 'unknown')
      : (executionMetadata?.mission_console_last_publishing_instance_id || 'unknown'),
    missionConsoleLastPublishingSourceSurface: useLiveDiagnostics
      ? (selected?.missionConsoleLastPublishingSourceSurface || executionMetadata?.mission_console_last_publishing_source_surface || 'unknown')
      : (executionMetadata?.mission_console_last_publishing_source_surface || 'unknown'),
    missionConsoleVisibleInstancePublished: canonicalVisibleInstancePublished,
    missionConsoleBridgeParityStatus: useLiveDiagnostics
      ? (selected?.missionConsoleBridgeParityStatus || executionMetadata?.mission_console_bridge_parity_status || 'WARN')
      : (executionMetadata?.mission_console_bridge_parity_status || 'WARN'),
    missionConsoleBridgeParityBlocker: useLiveDiagnostics
      ? (selected?.bridgeParityBlocker || selected?.missionConsoleBridgeParityBlocker || executionMetadata?.mission_console_bridge_parity_blocker || '')
      : (executionMetadata?.mission_console_bridge_parity_blocker || ''),
    registrationEffectSeen: useLiveDiagnostics
      ? (selected?.registrationEffectSeen || 'no')
      : (executionMetadata?.mission_console_registration_effect_seen || 'no'),
    registrationEffectPanelId: useLiveDiagnostics
      ? (selected?.registrationEffectPanelId || 'unknown')
      : (executionMetadata?.mission_console_registration_effect_panel_id || 'unknown'),
    registrationCallbackPropPresent: useLiveDiagnostics
      ? (selected?.registrationCallbackPropPresent || 'no')
      : (executionMetadata?.mission_console_registration_callback_prop_present || 'no'),
    registrationCallbackInvoked: useLiveDiagnostics
      ? (selected?.registrationCallbackInvoked || 'no')
      : (executionMetadata?.mission_console_registration_callback_seen || 'no'),
    appHandlerEntered: useLiveDiagnostics
      ? (selected?.appHandlerEntered || selected?.registrationAppHandlerSeen || 'no')
      : (executionMetadata?.mission_console_registration_app_handler_seen || 'no'),
    appHandlerEnteredAt: useLiveDiagnostics
      ? (selected?.appHandlerEnteredAt || 'unknown')
      : (executionMetadata?.mission_console_registration_app_handler_entered_at || 'unknown'),
    receivedCallbackIdentity: useLiveDiagnostics
      ? (selected?.receivedCallbackIdentity || selected?.registrationCallbackIdentity || 'unknown')
      : (executionMetadata?.mission_console_registration_received_callback_identity || 'unknown'),
    registrationAppHandlerSeen: useLiveDiagnostics
      ? (selected?.registrationAppHandlerSeen || selected?.appHandlerEntered || 'no')
      : (executionMetadata?.mission_console_registration_app_handler_seen || 'no'),
    registrationStoreWriteAttempted: useLiveDiagnostics
      ? (selected?.registrationStoreWriteAttempted || 'no')
      : (executionMetadata?.mission_console_registration_store_write_attempted || 'no'),
    registrationStoreWriteAccepted: useLiveDiagnostics
      ? (selected?.registrationStoreWriteAccepted || 'no')
      : (executionMetadata?.mission_console_registration_store_write_accepted || 'no'),
    registrationReceivedPanelId: useLiveDiagnostics
      ? (selected?.registrationReceivedPanelId || 'unknown')
      : (executionMetadata?.mission_console_registration_received_panel_id || 'unknown'),
    registrationReceivedSourceSurface: useLiveDiagnostics
      ? (selected?.registrationReceivedSourceSurface || 'unknown')
      : (executionMetadata?.mission_console_registration_received_source_surface || 'unknown'),
    registrationReceivedInstanceId: useLiveDiagnostics
      ? (selected?.registrationReceivedInstanceId || 'unknown')
      : (executionMetadata?.mission_console_registration_received_instance_id || 'unknown'),
    registrationCallbackSource: useLiveDiagnostics
      ? (selected?.registrationCallbackSource || uiRealityComponentTrace?.registrationCallbackSource || 'unknown')
      : (executionMetadata?.mission_console_registration_callback_source || uiRealityComponentTrace?.registrationCallbackSource || 'unknown'),
    registrationCallbackPanelId: useLiveDiagnostics
      ? (selected?.registrationCallbackPanelId || uiRealityComponentTrace?.registrationCallbackPanelId || 'unknown')
      : (executionMetadata?.mission_console_registration_callback_panel_id || uiRealityComponentTrace?.registrationCallbackPanelId || 'unknown'),
    registrationCallbackIdentity: useLiveDiagnostics
      ? (selected?.registrationCallbackIdentity || uiRealityComponentTrace?.registrationCallbackIdentity || 'unknown')
      : (executionMetadata?.mission_console_registration_callback_identity || uiRealityComponentTrace?.registrationCallbackIdentity || 'unknown'),
    componentTraceSource,
    componentTraceSelectorChecked: asText(liveDomComponentTrace?.selectorPathChecked || uiRealityComponentTrace?.selectorPathChecked, 'n/a'),
    aiCoreWrapperCount: asText(liveDomComponentTrace?.aiCoreWrapperCount || uiRealityComponentTrace?.aiCoreWrapperCount, 'unknown'),
    aiCoreVisibleWrapperCount: asText(liveDomComponentTrace?.aiCoreVisibleWrapperCount || uiRealityComponentTrace?.aiCoreVisibleWrapperCount, 'unknown'),
    markerCountByWrapper: asText(liveDomComponentTrace?.markerCountByWrapper || uiRealityComponentTrace?.markerCountByWrapper, 'none'),
    selectedWrapperIndex: asText(liveDomComponentTrace?.selectedWrapperIndex || uiRealityComponentTrace?.selectedWrapperIndex, 'none'),
    selectedWrapperReason: asText(liveDomComponentTrace?.selectedWrapperReason || uiRealityComponentTrace?.selectedWrapperReason, 'none'),
    selectedMarkerPanelId: asText(liveDomComponentTrace?.selectedMarkerPanelId || uiRealityComponentTrace?.selectedMarkerPanelId, 'unknown'),
    selectedMarkerCallbackPresent: asText(liveDomComponentTrace?.selectedMarkerCallbackPresent || uiRealityComponentTrace?.selectedMarkerCallbackPresent, 'no'),
    selectorMissReason: asText(liveDomComponentTrace?.selectorMissReason || uiRealityComponentTrace?.selectorMissReason, 'none'),
    visibleComponentIsMissionConsoleTile: asText(uiRealityComponentTrace?.isMissionConsoleTile, useLiveDiagnostics ? 'yes' : (executionMetadata?.mission_console_visible_component_is_missionconsoletile || 'no')),
    visibleComponentPanelId: asText(uiRealityComponentTrace?.panelId, useLiveDiagnostics ? (selected?.registrationEffectPanelId || selected?.missionConsoleVisibleInstanceId || 'unknown') : (executionMetadata?.mission_console_visible_component_panel_id || 'unknown')),
    componentEffectSeen: asText(uiRealityComponentTrace?.registrationEffectSeen, useLiveDiagnostics ? (selected?.registrationEffectSeen || 'no') : (executionMetadata?.mission_console_component_effect_seen || 'no')),
    componentCallbackPropPresent: asText(uiRealityComponentTrace?.registrationCallbackPropPresent, useLiveDiagnostics ? (selected?.registrationCallbackPropPresent || 'no') : (executionMetadata?.mission_console_component_callback_prop_present || 'no')),
    componentCallbackInvoked: asText(uiRealityComponentTrace?.registrationCallbackInvoked, useLiveDiagnostics ? (selected?.registrationCallbackInvoked || 'no') : (executionMetadata?.mission_console_component_callback_invoked || 'no')),
    componentCallbackCallAttempted: asText(uiRealityComponentTrace?.registrationCallbackCallAttempted, useLiveDiagnostics ? (selected?.registrationCallbackCallAttempted || 'no') : (executionMetadata?.mission_console_component_callback_call_attempted || 'no')),
    componentCallbackReturned: asText(uiRealityComponentTrace?.registrationCallbackReturned, useLiveDiagnostics ? (selected?.registrationCallbackReturned || 'no') : (executionMetadata?.mission_console_component_callback_returned || 'no')),
    componentCallbackReturnType: asText(uiRealityComponentTrace?.registrationCallbackReturnType, useLiveDiagnostics ? (selected?.registrationCallbackReturnType || 'unknown') : (executionMetadata?.mission_console_component_callback_return_type || 'unknown')),
    componentCallbackReturnHandled: asText(uiRealityComponentTrace?.registrationCallbackReturnHandled, useLiveDiagnostics ? (selected?.registrationCallbackReturnHandled || 'no') : (executionMetadata?.mission_console_component_callback_return_handled || 'no')),
    componentCallbackReturnHandler: asText(uiRealityComponentTrace?.registrationCallbackReturnHandler, useLiveDiagnostics ? (selected?.registrationCallbackReturnHandler || 'unknown') : (executionMetadata?.mission_console_component_callback_return_handler || 'unknown')),
    componentCallbackReturnPanelId: asText(uiRealityComponentTrace?.registrationCallbackReturnPanelId, useLiveDiagnostics ? (selected?.registrationCallbackReturnPanelId || 'unknown') : (executionMetadata?.mission_console_component_callback_return_panel_id || 'unknown')),
    componentCallbackReturnSourceSurface: asText(uiRealityComponentTrace?.registrationCallbackReturnSourceSurface, useLiveDiagnostics ? (selected?.registrationCallbackReturnSourceSurface || 'unknown') : (executionMetadata?.mission_console_component_callback_return_source_surface || 'unknown')),
    componentCallbackReturnInstanceId: asText(uiRealityComponentTrace?.registrationCallbackReturnInstanceId, useLiveDiagnostics ? (selected?.registrationCallbackReturnInstanceId || 'unknown') : (executionMetadata?.mission_console_component_callback_return_instance_id || 'unknown')),
    componentCallbackReturnIdentity: asText(uiRealityComponentTrace?.registrationCallbackReturnIdentity, useLiveDiagnostics ? (selected?.registrationCallbackReturnIdentity || 'unknown') : (executionMetadata?.mission_console_component_callback_return_identity || 'unknown')),
    componentCallbackReturnSideEffectStatus: asText(uiRealityComponentTrace?.registrationCallbackReturnSideEffectStatus, useLiveDiagnostics ? (selected?.registrationCallbackReturnSideEffectStatus || 'unknown') : (executionMetadata?.mission_console_component_callback_return_side_effect_status || 'unknown')),
    componentCallbackReturnRegisteredInstanceSeen: asText(uiRealityComponentTrace?.registrationCallbackReturnRegisteredInstanceSeen, useLiveDiagnostics ? (selected?.registrationCallbackReturnRegisteredInstanceSeen || 'no') : (executionMetadata?.mission_console_component_callback_return_registered_instance_seen || 'no')),
    componentCallbackReturnRegisteredInstanceCount: asText(uiRealityComponentTrace?.registrationCallbackReturnRegisteredInstanceCount, useLiveDiagnostics ? (selected?.registrationCallbackReturnRegisteredInstanceCount || '0') : (executionMetadata?.mission_console_component_callback_return_registered_instance_count || '0')),
    componentCallbackReturnDiagnosticsStamp: asText(uiRealityComponentTrace?.registrationCallbackReturnDiagnosticsStamp, useLiveDiagnostics ? (selected?.registrationCallbackReturnDiagnosticsStamp || selected?.registrationDiagnosticsStamp || '0') : (executionMetadata?.mission_console_component_callback_return_diagnostics_stamp || '0')),
    componentCallbackReturnRegistryOwnerId: asText(uiRealityComponentTrace?.registrationCallbackReturnRegistryOwnerId, useLiveDiagnostics ? (selected?.registrationCallbackReturnRegistryOwnerId || selected?.missionConsoleBridgeInstancesRefOwnerId || 'unknown') : (executionMetadata?.mission_console_component_callback_return_registry_owner_id || 'unknown')),
    appBridgeHandlerOwnerId: useLiveDiagnostics ? (selected?.appBridgeHandlerOwnerId || 'unknown') : (executionMetadata?.mission_console_app_bridge_handler_owner_id || 'unknown'),
    missionConsoleBridgeInstancesRefOwnerId: useLiveDiagnostics ? (selected?.missionConsoleBridgeInstancesRefOwnerId || 'unknown') : (executionMetadata?.mission_console_bridge_instances_ref_owner_id || 'unknown'),
    publishOperatorReliefProjectionBridgeOwnerId: useLiveDiagnostics ? (selected?.publishOperatorReliefProjectionBridgeOwnerId || 'unknown') : (executionMetadata?.mission_console_publish_operator_relief_projection_bridge_owner_id || 'unknown'),
    operatorReliefBridgeDiagnosticsStoreOwnerId: useLiveDiagnostics ? (selected?.operatorReliefBridgeDiagnosticsStoreOwnerId || 'unknown') : (executionMetadata?.operator_relief_bridge_diagnostics_store_owner_id || 'unknown'),
    operatorReliefBridgeDiagnosticsStoreSourceId: useLiveDiagnostics ? (selected?.operatorReliefBridgeDiagnosticsStoreSourceId || 'unknown') : (executionMetadata?.operator_relief_bridge_diagnostics_store_source_id || 'unknown'),
    publisherRegistryOwnerId: useLiveDiagnostics ? (selected?.publisherRegistryOwnerId || 'unknown') : (executionMetadata?.mission_console_publisher_registry_owner_id || 'unknown'),
    publisherRegistryInstanceCount: useLiveDiagnostics ? String(selectedPublisherInstanceIds.length || selected?.publisherRegistryInstanceCount || selected?.missionConsoleInstanceCount || '0') : (executionMetadata?.mission_console_publisher_registry_instance_count || '0'),
    publisherRegistryInstanceIds: useLiveDiagnostics ? (selectedPublisherInstanceIds.length ? selectedPublisherInstanceIds.join('|') : 'none') : (executionMetadata?.mission_console_publisher_registry_instance_ids || 'none'),
    publisherSource: useLiveDiagnostics ? firstKnownValue([selected?.publisherSource, executionMetadata?.mission_console_publisher_source], 'unknown') : (executionMetadata?.mission_console_publisher_source || 'unknown'),
    componentCallbackError: asText(uiRealityComponentTrace?.registrationCallbackError, useLiveDiagnostics ? (selected?.registrationCallbackError || 'none') : (executionMetadata?.mission_console_component_callback_error || 'none')),
    registrationDropBoundary: useLiveDiagnostics
      ? (selected?.operatorReliefBridgeDiagnosticsDropBoundary || selected?.registrationDropBoundary || uiRealityComponentTrace?.registrationDropBoundary || 'none')
      : (uiRealityComponentTrace?.registrationDropBoundary || executionMetadata?.mission_console_registration_drop_boundary || executionMetadata?.operator_relief_bridge_drop_boundary || runtimeDiagnosticsDropBoundary || (liveDiagnosticKeys.length <= 0 ? 'runtime-context-missing-bridge-diagnostics' : (liveHasInstances && !liveHasStampedPublisherDiagnostics ? 'support-snapshot-read-wrong-path' : 'runtime-context-not-injected'))),
  };
}

function resolvePrEvidenceNumber(executionMetadata = {}, runtimeStatus = {}, prFallback = { source: 'none', parseInput: '', prNumber: '' }) {
  const candidates = [
    { source: 'explicit-provider', value: executionMetadata?.github_pr_evidence_number },
    { source: 'explicit-parsed-pr-number', value: executionMetadata?.pr_evidence_parsed_pr_number },
    { source: 'explicit-pr-evidence-number', value: executionMetadata?.pr_evidence_number },
    { source: 'command_envelope_pr_number', value: executionMetadata?.command_envelope_pr_number },
    { source: 'final-metadata-number', value: executionMetadata?.command_envelope_pr_evidence_parsed_pr_number },
    { source: 'final-metadata-number', value: runtimeStatus?.prEvidenceParsedPrNumber },
    { source: 'final-metadata-number', value: runtimeStatus?.prEvidenceNumber },
    { source: 'chat_context_match_input', value: prFallback?.source === 'chat_context_match_input' ? prFallback?.prNumber : '' },
    { source: 'retrieval_query', value: prFallback?.source === 'retrieval_query' ? prFallback?.prNumber : '' },
    { source: 'chat_context_raw_operator_message_seen', value: prFallback?.source === 'chat_context_raw_operator_message_seen' ? prFallback?.prNumber : '' },
    { source: 'chat_context_normalized_operator_message', value: prFallback?.source === 'chat_context_normalized_operator_message' ? prFallback?.prNumber : '' },
    { source: 'chat_context_match_input', value: prFallback?.source === 'runtimeStatus.chatContextMatchInput' ? prFallback?.prNumber : '' },
    { source: 'retrieval_query', value: prFallback?.source === 'runtimeStatus.retrievalQuery' ? prFallback?.prNumber : '' },
    { source: 'chat_context_raw_operator_message_seen', value: prFallback?.source === 'runtimeStatus.chatContextRawOperatorMessageSeen' ? prFallback?.prNumber : '' },
    { source: 'chat_context_normalized_operator_message', value: prFallback?.source === 'runtimeStatus.chatContextNormalizedOperatorMessage' ? prFallback?.prNumber : '' },
  ];

  for (const candidate of candidates) {
    if (!isUnknownValue(candidate.value)) {
      return { prNumber: String(candidate.value).trim(), source: candidate.source };
    }
  }
  return { prNumber: 'unknown', source: 'unknown' };
}

function derivePrFallbackFromOperatorText(executionMetadata = {}, runtimeStatus = {}) {
  const candidates = [
    { source: 'chat_context_match_input', value: executionMetadata?.chat_context_match_input },
    { source: 'retrieval_query', value: executionMetadata?.retrieval_query },
    { source: 'chat_context_raw_operator_message_seen', value: executionMetadata?.chat_context_raw_operator_message_seen },
    { source: 'chat_context_normalized_operator_message', value: executionMetadata?.chat_context_normalized_operator_message },
    { source: 'runtimeStatus.chatContextMatchInput', value: runtimeStatus?.chatContextMatchInput },
    { source: 'runtimeStatus.retrievalQuery', value: runtimeStatus?.retrievalQuery },
    { source: 'runtimeStatus.chatContextRawOperatorMessageSeen', value: runtimeStatus?.chatContextRawOperatorMessageSeen },
    { source: 'runtimeStatus.chatContextNormalizedOperatorMessage', value: runtimeStatus?.chatContextNormalizedOperatorMessage },
  ];
  for (const candidate of candidates) {
    const text = String(candidate.value ?? '').trim();
    if (!text) continue;
    const parsed = parsePrReferenceFromPrompt(text);
    if (parsed?.prNumber) {
      return {
        source: candidate.source,
        parseInput: text,
        prNumber: String(parsed.prNumber),
      };
    }
  }
  return { source: 'none', parseInput: '', prNumber: '' };
}

function deriveExecutionTruthInvariantWarnings(runtimeStatus = {}) {
  const warnings = [];
  const selectedProvider = normalizeTruthText(runtimeStatus?.lastSelectedProvider);
  const routerSelectedProvider = normalizeTruthText(runtimeStatus?.lastRouterSelectedProvider);
  const requestedProviderForRequest = normalizeTruthText(runtimeStatus?.lastRequestedProviderForRequest);
  const actualProvider = normalizeTruthText(runtimeStatus?.lastActualProviderUsed);
  const actualModel = normalizeTruthText(runtimeStatus?.lastActualModelUsed || runtimeStatus?.lastModelUsed);
  const timeoutProvider = normalizeTruthText(runtimeStatus?.lastTimeoutEffectiveProvider);
  const overrideReason = normalizeTruthText(runtimeStatus?.lastProviderOverrideReason);
  const fallbackProvider = normalizeTruthText(runtimeStatus?.lastFallbackProviderUsed);
  const loadMode = normalizeTruthText(runtimeStatus?.lastOllamaLoadMode);
  const loadBefore = normalizeTruthText(runtimeStatus?.lastOllamaModelBeforeLoadPolicy);
  const loadAfter = normalizeTruthText(runtimeStatus?.lastOllamaModelAfterLoadPolicy);
  const executionCancelled = String(runtimeStatus?.lastExecutionCancelled || '').trim().toLowerCase() === 'true';
  const providerCancelled = String(runtimeStatus?.lastProviderCancelled || '').trim().toLowerCase() === 'true';
  const ollamaAbortSent = String(runtimeStatus?.lastOllamaAbortSent || '').trim().toLowerCase() === 'true';
  const executionStatus = normalizeTruthText(runtimeStatus?.lastExecutionStatus || runtimeStatus?.status);
  const finalExecutionOutcome = normalizeTruthText(runtimeStatus?.lastSelectedProviderFinalExecutionOutcome);
  const executionTruth = normalizeTruthText(runtimeStatus?.lastExecutionTruth);
  const successOutcome = finalExecutionOutcome === 'success'
    || executionStatus.startsWith('ok')
    || executionTruth.includes('answered')
    || normalizeTruthText(runtimeStatus?.lastResponseTruth) === 'ok';
  if (actualProvider === 'ollama' && actualModel.includes('gemini')) {
    warnings.push('Invariant warning: actual_provider_used=ollama with model containing "gemini".');
  }
  if (actualProvider === 'gemini' && /(qwen|llama|gpt-oss)/.test(actualModel)) {
    warnings.push('Invariant warning: actual_provider_used=gemini with model containing "qwen", "llama", or "gpt-oss".');
  }
  if (timeoutProvider && actualProvider && timeoutProvider !== actualProvider && !overrideReason) {
    warnings.push('Invariant warning: timeout effective provider differs from actual provider without explicit override reason.');
  }
  const providersMismatch = selectedProvider && requestedProviderForRequest && actualProvider
    && (selectedProvider !== requestedProviderForRequest || selectedProvider !== actualProvider);
  const fallbackOrOverrideDocumented = Boolean(overrideReason || (fallbackProvider && fallbackProvider !== 'n/a' && fallbackProvider !== 'none'));
  if (providersMismatch && !fallbackOrOverrideDocumented) {
    warnings.push('Invariant warning: selected/requested/actual provider mismatch without fallback/override reason.');
  }
  if (routerSelectedProvider && actualProvider && routerSelectedProvider !== actualProvider && !fallbackOrOverrideDocumented) {
    warnings.push('Invariant warning: router selected provider differs from actual provider without fallback/override reason.');
  }
  if ((executionCancelled || providerCancelled || ollamaAbortSent) && successOutcome) {
    warnings.push('Invariant warning: cancellation truth is true while execution outcome reports success.');
  }
  if ((selectedProvider === 'ollama' || actualProvider === 'ollama')
    && (!loadMode || loadMode === 'n/a' || !loadBefore || loadBefore === 'n/a' || !loadAfter || loadAfter === 'n/a')) {
    warnings.push('Invariant warning: Ollama selected/actual but load governor fields are n/a.');
  }
  return warnings;
}

function summarizeRouteDiagnostics(routeDiagnostics, {
  selectedRouteKind = '',
  routeCandidates = [],
} = {}) {
  if (!routeDiagnostics || typeof routeDiagnostics !== 'object') {
    return ['- n/a'];
  }

  const localDesktopCandidate = findLocalDesktopRouteCandidate(routeCandidates);
  const localDesktopCandidateState = deriveRouteCandidateState(localDesktopCandidate);
  const localDesktopCandidateUnavailable = ['configured-unreachable', 'not-configured', 'unavailable'].includes(localDesktopCandidateState);

  const selectedKey = String(selectedRouteKind || '').trim();
  const orderedEntries = Object.entries(routeDiagnostics).sort(([left], [right]) => {
    if (left === selectedKey) return -1;
    if (right === selectedKey) return 1;
    return 0;
  });
  const entries = orderedEntries.slice(0, 4).map(([key, details]) => {
    if (!details || typeof details !== 'object') {
      return `- ${key}: n/a`;
    }
    let state = details.usable === true
      ? 'usable'
      : details.usable === false
        ? 'blocked'
        : details.available === true
          ? 'available'
          : details.available === false
            ? 'unavailable'
            : 'unknown';
    let reason = asText(details.reason || details.blockedReason || details.operatorReason, 'n/a');
    if (key === 'local-desktop' && localDesktopCandidateUnavailable) {
      const staleSummary = state === 'available' || state === 'usable';
      if (staleSummary) {
        state = 'unavailable';
        reason = `local-desktop-candidate-summary-mismatch: structured candidate state=${localDesktopCandidateState}`;
      } else if (reason === 'n/a') {
        reason = `structured candidate state=${localDesktopCandidateState}`;
      }
    }
    const routeLabel = key === selectedKey
      ? `${key} [selected]`
      : selectedKey
        ? `${key} [candidate]`
        : key;
    return `- ${routeLabel}: ${state} (${reason})`;
  });

  return entries.length > 0 ? entries : ['- n/a'];
}

function findLocalDesktopRouteCandidate(routeCandidates = []) {
  if (!Array.isArray(routeCandidates)) {
    return null;
  }

  return routeCandidates.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    const routeKind = String(candidate.routeKind || '').trim().toLowerCase();
    const candidateKey = String(candidate.candidateKey || '').trim().toLowerCase();
    return routeKind === 'local-desktop' || candidateKey === 'local-desktop';
  }) || null;
}

function deriveRouteCandidateState(candidate = null) {
  if (!candidate || typeof candidate !== 'object') {
    return '';
  }
  const explicitState = String(candidate.state || '').trim().toLowerCase();
  if (explicitState) {
    return explicitState;
  }
  if (candidate.active === true) return 'active';
  if (candidate.usable === true) return 'usable';
  if (candidate.reachable === true) return 'reachable-not-usable';
  if (candidate.configured === true) return 'configured-unreachable';
  return 'not-configured';
}

function isFreshBackendHealthProbe(probeTruth = {}, now = Date.now()) {
  const lastProbeAt = String(probeTruth?.lastBackendHealthProbeAt || '').trim();
  const parsedAt = lastProbeAt ? Date.parse(lastProbeAt) : NaN;
  if (!Number.isFinite(parsedAt)) return false;
  return (now - parsedAt) <= BACKEND_HEALTH_FRESHNESS_MS;
}

function synthesizeFreshLocalDesktopCandidate(candidate = null) {
  const base = candidate && typeof candidate === 'object' ? candidate : {};
  return {
    ...base,
    candidateKey: 'local-desktop',
    routeKind: 'local-desktop',
    transportKind: base.transportKind || 'direct',
    configured: true,
    reachable: true,
    usable: true,
    state: 'usable',
    blockedReason: '',
    reason: 'fresh backend health probe confirmed local-desktop backend reachability',
  };
}


function hasMeaningfulDiagnostics(lines = []) {
  return Array.isArray(lines) && lines.some((line) => line !== '- n/a');
}

function isNoOperatorActionGuidance(value = '') {
  return String(value || '').trim().toLowerCase() === 'no operator action required.';
}

function isLiveCloudProvider(providerKey = '') {
  const provider = String(providerKey || '').trim().toLowerCase();
  if (!provider) return false;
  return !['none', 'n/a', 'unknown', 'mock', 'ollama'].includes(provider);
}

function isHostedCloudCanonicalReady({
  sessionKind,
  selectedRouteKind,
  selectedRouteReachableState,
  routeUsableState,
  backendReachableState,
  cloudAvailable,
  fallbackActive,
  executableProvider,
  launchState,
} = {}) {
  return sessionKind === 'hosted-web'
    && selectedRouteKind === 'cloud'
    && String(selectedRouteReachableState || '').trim().toLowerCase() === 'yes'
    && String(routeUsableState || '').trim().toLowerCase() === 'yes'
    && String(backendReachableState || '').trim().toLowerCase() === 'yes'
    && cloudAvailable === true
    && fallbackActive !== true
    && String(launchState || '').trim().toLowerCase() === 'ready'
    && isLiveCloudProvider(executableProvider);
}

function isTileReadinessContradictionWarning(message = '') {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized.includes('runtime reports ready while tile execution readiness is false');
}

function formatParityState(value) {
  if (value === true) return 'in-sync';
  if (value === false) return 'stale';
  return 'unknown';
}

function summarizeBackendTargetCandidates(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return ['- n/a'];
  }

  return candidates.slice(0, 5).map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return '- unknown candidate';
    }

    const source = asText(candidate.source, 'unknown-source');
    const url = asText(candidate.url, 'n/a');
    const verdict = candidate.accepted === true
      ? 'accepted'
      : `rejected (${asText(candidate.reason, 'unknown reason')})`;
    return `- ${source}: ${url} -> ${verdict}`;
  });
}

function summarizeRouteCandidates(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return ['- n/a'];
  }
  return candidates.slice(0, 8).map((candidate) => {
    if (!candidate || typeof candidate !== 'object') return '- n/a';
    const state = candidate.active === true
      ? 'active'
      : candidate.usable === true
        ? 'usable'
        : candidate.reachable === true
          ? 'reachable-not-usable'
          : candidate.configured === true
            ? 'configured-unreachable'
            : 'not-configured';
    const score = Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 'n/a';
    const rank = Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : 'n/a';
    const blocked = asText(candidate.blockedReason || candidate.reason, 'n/a');
    return `- ${asText(candidate.candidateKey)} [${asText(candidate.routeKind)}/${asText(candidate.transportKind)}] rank=${rank} score=${score} state=${state} (${blocked})`;
  });
}

function deriveStreamingCompletionState(runtimeStatus = {}) {
  const streamingUsed = String(runtimeStatus?.lastStreamingUsed || '').trim().toLowerCase() === 'true';
  const streamingFinalized = String(runtimeStatus?.lastStreamingFinalized || '').trim().toLowerCase() === 'true';
  const finalMetadataMissing = String(runtimeStatus?.lastFinalMetadataMissing || '').trim().toLowerCase() === 'true';
  const executionCancelled = String(runtimeStatus?.lastExecutionCancelled || '').trim().toLowerCase() === 'true';
  const fallbackReason = String(runtimeStatus?.lastStreamingFallbackReason || '').trim().toLowerCase();
  const completionQuality = String(runtimeStatus?.lastStreamingCompletionQuality || '').trim().toLowerCase();

  if (!streamingUsed) return 'not-used';
  if (executionCancelled || completionQuality === 'cancelled') return 'cancelled';
  if (completionQuality === 'fully-finalized') return 'fully-finalized';
  if (completionQuality === 'partial-success' || finalMetadataMissing) return 'partial-success';
  if (streamingFinalized) return 'fully-finalized';
  if (fallbackReason && fallbackReason !== 'n/a' && fallbackReason !== 'none') return 'failed';
  return 'stream-ended';
}

function buildOperatorBoundaryDiagnostics({
  routeTruthView = {},
  runtimeStatus = {},
  runtimeProviderTruth = {},
  sourceDistAlignment = {},
  runtimeContext = {},
} = {}) {
  const sessionKind = String(runtimeStatus?.canonicalRouteRuntimeTruth?.sessionKind || runtimeStatus?.sessionKind || '').trim();
  const selectedRouteReachable = String(routeTruthView?.selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const routeUsable = String(routeTruthView?.routeUsableState || '').trim().toLowerCase() === 'yes';
  const backendReachable = String(routeTruthView?.backendReachableState || '').trim().toLowerCase() === 'yes';
  const routeHealthy = selectedRouteReachable && routeUsable && backendReachable;
  const requestedProvider = String(routeTruthView?.requestedProvider || '').trim().toLowerCase();
  const selectedProvider = String(routeTruthView?.selectedProvider || '').trim().toLowerCase();
  const executableProvider = String(routeTruthView?.executedProvider || runtimeProviderTruth?.executableProvider || '').trim().toLowerCase();
  const providerRequested = requestedProvider && !['unknown', 'n/a'].includes(requestedProvider);
  const providerSelected = selectedProvider && !['unknown', 'n/a'].includes(selectedProvider);
  const providerExecutable = executableProvider && !['unknown', 'none', 'n/a'].includes(executableProvider);
  const executionBlocked = routeHealthy && (providerRequested || providerSelected) && !providerExecutable;
  const hostedRoute = sessionKind === 'hosted-web';
  const sourceStatus = String(sourceDistAlignment?.buildTruthStatus || 'indeterminate').trim().toLowerCase();
  const hostedSurfaceBuildCertainty = sourceStatus === 'aligned' ? 'high' : sourceStatus === 'mismatch' ? 'low' : 'unavailable';
  const backendBuildCertainty = hostedRoute ? 'unavailable-from-hosted-surface' : hostedSurfaceBuildCertainty;
  const staleIndicators = [];
  if (executionBlocked) staleIndicators.push('provider-non-executable-while-route-healthy');
  if (String(runtimeStatus?.executionTruth || '').trim().toLowerCase() === 'error') staleIndicators.push('execution-truth-error');
  if (!providerExecutable) staleIndicators.push('executable-provider-none');
  if (String(runtimeStatus?.lastActualProviderUsed || '').trim().toLowerCase() === 'unknown') staleIndicators.push('last-actual-provider-unknown');
  if (String(sourceDistAlignment?.buildTruthStatus || '').trim().toLowerCase() === 'indeterminate') staleIndicators.push('build-truth-indeterminate');

  return {
    routeLayerStatus: routeHealthy ? 'healthy' : (backendReachable || selectedRouteReachable ? 'degraded' : 'route-failure'),
    backendExecutionContractStatus: executionBlocked ? 'stale-or-incomplete' : (providerExecutable ? 'validated' : 'unknown'),
    backendBuildAlignmentStatus: asText(sourceDistAlignment?.buildAlignmentState, 'unknown'),
    providerExecutionGateStatus: executionBlocked ? 'blocked-by-backend-contract' : (providerExecutable ? 'open' : 'unknown'),
    likelyOperatorBoundary: executionBlocked ? 'backend-execution-contract' : (routeHealthy ? 'provider-execution' : 'route-reachability'),
    likelyNeedsBattleBridgeRebuild: executionBlocked ? 'yes' : 'no',
    likelyNeedsBackendRestart: executionBlocked ? 'yes' : 'unknown',
    routeHealthyButBackendContractStale: executionBlocked ? 'yes' : 'no',
    requestSelectionSucceededButExecutionBlocked: executionBlocked && (providerRequested || providerSelected) ? 'yes' : 'no',
    selectedProviderRequestedButNotExecutable: executionBlocked && providerRequested ? 'yes' : 'no',
    staleBattleBridgeIndicators: staleIndicators.length > 0 ? staleIndicators.join('|') : 'none',
    hostedSurfaceBuildCertainty,
    backendBuildCertainty,
    servedPublishedBuildTruthAvailable: sourceDistAlignment?.buildTruthEvidence?.served ? 'yes' : 'no',
    backendRuntimeContractVersion: asText(runtimeContext?.backendRuntimeContractVersion || runtimeStatus?.backendRuntimeContractVersion, 'unknown'),
    operatorNextClassification: !routeHealthy
      ? 'route issue unresolved'
      : executionBlocked
        ? 'rebuild Battle Bridge required before further provider testing'
        : 'safe to continue testing remotely',
  };
}

function buildHostedBackendTargetGuidance({
  canonicalHostedRouteTruth,
  sessionKind,
  selectedRouteKind,
  selectedRouteReachableState,
  routeUsableState,
  backendReachableState,
  cloudAvailable,
  executableProvider,
  backendTargetInvalidReason,
  backendTargetResolvedUrl,
  backendTargetResolutionSource,
  backendTargetFallbackUsed,
} = {}) {
  const hostedTruth = canonicalHostedRouteTruth && typeof canonicalHostedRouteTruth === 'object'
    ? canonicalHostedRouteTruth
    : null;
  const hostedSession = sessionKind === 'hosted-web';
  const routeUnavailable = selectedRouteKind === 'unavailable';
  const unresolved = hostedTruth
    ? hostedTruth.backendTargetValidity === 'unresolved'
    : (!backendTargetResolvedUrl || backendTargetResolvedUrl === 'n/a');
  const routeReachable = String(selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const routeUsable = String(routeUsableState || '').trim().toLowerCase() === 'yes';
  const backendReachable = String(backendReachableState || '').trim().toLowerCase() === 'yes';
  const cloudRouteAvailable = cloudAvailable === true;
  const cloudProviderOperational = isLiveCloudProvider(executableProvider);
  const cloudExecutionOperational = selectedRouteKind === 'cloud'
    && routeReachable
    && routeUsable
    && backendReachable
    && cloudRouteAvailable
    && cloudProviderOperational;
  if (!hostedSession || (!routeUnavailable && !backendTargetInvalidReason && !unresolved && !hostedTruth?.blockingIssues?.length)) {
    return null;
  }

  const reason = asText(
    backendTargetInvalidReason,
    unresolved
      ? 'Hosted runtime could not resolve a non-loopback backend target.'
      : 'Hosted backend target is unresolved.',
  );
  const blocked = hostedTruth
    ? hostedTruth.selectedRouteKind === 'unavailable'
      || hostedTruth.selectedRouteUsable === false
      || (Array.isArray(hostedTruth.blockingIssues) && hostedTruth.blockingIssues.length > 0)
    : (routeUnavailable || !routeUsable || !routeReachable);
  const statusLabel = blocked ? 'blocked' : 'informational';
  const executionLabel = cloudExecutionOperational
    ? asText(executableProvider, 'cloud provider')
    : 'none';

  return {
    reason,
    summary: [
      `- backend-target: ${statusLabel} (${reason})`,
      `- resolution-source: ${asText(backendTargetResolutionSource, 'unresolved')}`,
      `- fallback-used: ${backendTargetFallbackUsed ? 'yes' : 'no'}`,
      `- cloud-execution: ${cloudExecutionOperational ? `operational (${executionLabel})` : 'not confirmed'}`,
    ],
    blockingIssue: blocked
      ? (hostedTruth?.blockingIssues?.[0]?.message
        || `Backend target unresolved: ${reason}`)
      : '',
    operatorGuidance: blocked
      ? (hostedTruth?.blockingIssues?.[0]?.code === 'hosted-backend-execution-incompatible'
        ? 'Hosted HTTPS surface cannot execute HTTP bridge fetches. Publish an HTTPS Home Bridge endpoint (or HTTPS reverse proxy) and keep operator transport truth separate.'
        : 'Resolve a reachable non-loopback backend target for hosted-web (cloud or home-node) and republish route diagnostics before relaunch.')
      : '',
  };
}


export function buildSupportSnapshot({
  runtimeStatus,
  routeTruthView,
  runtimeSessionTruth,
  runtimeRouteTruth,
  runtimeReachabilityTruth,
  runtimeProviderTruth,
  runtimeDiagnosticsTruth,
  runtimeContext,
  safeApiStatus,
  statusSummary,
  now = new Date(),
  origin,
  href,
  orchestrationTruth = null,
  finalAgentView = null,
  missionBridgeTruth = null,
  uiReality = null,
  uiRealitySampledAt = 'n/a',
  uiRealitySampleSource = 'cached',
  uiRealitySnapshotAgeMs = 'n/a',
  uiRealityFreshAtCopy = 'no',
  uiRealityStartupStatus = null,
}) {
  const canonicalTruth = runtimeStatus?.canonicalRouteRuntimeTruth || {};
  const sourceDistAlignment = orchestrationTruth?.canonicalSourceDistAlignment || {};
  const canonicalHostedRouteTruth = runtimeContext?.canonicalHostedRouteTruth || canonicalTruth?.hostedRouteTruth || null;
  const resolvedOrigin = asText(origin || runtimeContext?.frontendOrigin || safeApiStatus?.frontendOrigin || '', 'n/a');
  const resolvedUrl = asText(href || runtimeContext?.frontendUrl || '', 'n/a');
  const backendTargetResolutionSource = asText(runtimeContext?.backendTargetResolutionSource, 'n/a');
  const backendTargetResolvedUrl = asText(runtimeContext?.backendTargetResolvedUrl, 'n/a');
  const backendTargetFallbackUsed = runtimeContext?.backendTargetFallbackUsed === true;
  const backendTargetInvalidReason = asText(runtimeContext?.backendTargetInvalidReason, 'n/a');
  const runtimeContextRouteCandidates = Array.isArray(runtimeContext?.routeCandidates) ? runtimeContext.routeCandidates : [];
  const runtimeTruthRouteCandidates = Array.isArray(runtimeStatus?.runtimeTruth?.routeCandidates) ? runtimeStatus.runtimeTruth.routeCandidates : [];

  const liveRuntimeContext = safeApiStatus?.runtimeContext && typeof safeApiStatus.runtimeContext === 'object'
    ? safeApiStatus.runtimeContext
    : runtimeContext;
  const liveHealthProbeTruth = liveRuntimeContext?.healthProbeTruth && typeof liveRuntimeContext.healthProbeTruth === 'object'
    ? liveRuntimeContext.healthProbeTruth
    : {};
  const healthProbeReportsOk = String(liveHealthProbeTruth?.lastBackendHealthProbeResult || '').trim().toLowerCase() === 'ok:true';
  const healthProbeFresh = isFreshBackendHealthProbe(liveHealthProbeTruth, now instanceof Date ? now.getTime() : Date.now());
  const healthProbeFreshAndOk = healthProbeReportsOk && healthProbeFresh;
  const selectedRouteKind = asText(routeTruthView?.routeKind, 'n/a');
  const sessionKind = canonicalTruth.sessionKind || runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind;
  const localDesktopSession = String(sessionKind || '').trim() === 'local-desktop'
    || String(runtimeContext?.deviceContext || '').trim() === 'pc-local-browser';
  const canonicalRouteCandidates = runtimeTruthRouteCandidates.length > 0
    ? runtimeTruthRouteCandidates
    : runtimeContextRouteCandidates;
  const mergedRouteCandidates = healthProbeFreshAndOk && localDesktopSession
    ? [
      synthesizeFreshLocalDesktopCandidate(findLocalDesktopRouteCandidate(canonicalRouteCandidates)),
      ...canonicalRouteCandidates.filter((candidate) => {
        if (!candidate || typeof candidate !== 'object') return false;
        const routeKind = String(candidate.routeKind || '').trim().toLowerCase();
        const candidateKey = String(candidate.candidateKey || '').trim().toLowerCase();
        return routeKind !== 'local-desktop' && candidateKey !== 'local-desktop';
      }),
    ]
    : canonicalRouteCandidates;
  const backendTargetCandidatesSummary = summarizeBackendTargetCandidates(runtimeContext?.backendTargetCandidates);
  const routeCandidateSummary = summarizeRouteCandidates(mergedRouteCandidates);
  const currentRouteLayerHealthy = String(routeTruthView?.routeLayerStatus || '').trim().toLowerCase() === 'healthy';
  const currentSelectedRouteReachable = String(routeTruthView?.selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const currentSelectedRouteUsable = String(routeTruthView?.routeUsableState || '').trim().toLowerCase() === 'yes';
  const routeTruthHealthy = currentRouteLayerHealthy || (currentSelectedRouteReachable && currentSelectedRouteUsable);
  const backendReachableState = routeTruthHealthy
    ? 'yes'
    : safeApiStatus?.backendReachable === true
    ? 'yes'
    : safeApiStatus?.backendReachable === false && !healthProbeFreshAndOk
      ? 'no'
      : routeTruthView?.backendReachableState;

  const bridgeTransportTruth = runtimeContext?.bridgeTransportTruth && typeof runtimeContext.bridgeTransportTruth === 'object'
    ? runtimeContext.bridgeTransportTruth
    : {};
  const persistenceTruth = routeTruthView?.persistence
    || runtimeStatus?.finalRouteTruth?.persistence
    || bridgeTransportTruth?.persistence
    || {};
  const surfaceAwareness = runtimeContext?.surfaceAwareness && typeof runtimeContext.surfaceAwareness === 'object'
    ? runtimeContext.surfaceAwareness
    : {};
  const surfaceIdentity = surfaceAwareness.surfaceIdentity || {};
  const surfaceCapabilities = surfaceAwareness.surfaceCapabilities || {};
  const sessionSurfaceHints = surfaceAwareness.sessionContextSurfaceHints || {};
  const effectiveSurfaceExperience = surfaceAwareness.effectiveSurfaceExperience || {};
  const recentFrictionEvents = Array.isArray(surfaceAwareness.recentFrictionEvents)
    ? surfaceAwareness.recentFrictionEvents
    : [];
  const detectedFrictionPatterns = Array.isArray(surfaceAwareness.frictionPatterns)
    ? surfaceAwareness.frictionPatterns
    : [];
  const surfaceProtocolRecommendations = Array.isArray(surfaceAwareness.surfaceProtocolRecommendations)
    ? surfaceAwareness.surfaceProtocolRecommendations
    : [];
  const acceptedSurfaceRules = Array.isArray(surfaceAwareness.acceptedSurfaceRules)
    ? surfaceAwareness.acceptedSurfaceRules
    : [];
  const latestFriction = recentFrictionEvents[recentFrictionEvents.length - 1] || null;
  const latestPattern = detectedFrictionPatterns[detectedFrictionPatterns.length - 1] || null;

  const executableProvider = canonicalTruth.executedProvider || runtimeProviderTruth?.executableProvider || routeTruthView?.executedProvider;
  const hostedCloudCanonicalReady = isHostedCloudCanonicalReady({
    sessionKind,
    selectedRouteKind,
    selectedRouteReachableState: routeTruthView?.selectedRouteReachableState,
    routeUsableState: routeTruthView?.routeUsableState,
    backendReachableState: routeTruthView?.backendReachableState,
    cloudAvailable: runtimeStatus?.cloudAvailable,
    fallbackActive: routeTruthView?.fallbackActive,
    executableProvider,
    launchState: runtimeStatus?.appLaunchState,
  });

  const executionMetadata = runtimeStatus?.lastExecutionMetadata && typeof runtimeStatus.lastExecutionMetadata === 'object'
    ? runtimeStatus.lastExecutionMetadata
    : {};
  const builderWorkbenchSupportMetadata = resolveBuilderWorkbenchSupportMetadata(executionMetadata, runtimeStatus);
  const missionConsoleDiagnostics = normalizeMissionConsoleDiagnostics(runtimeStatus, executionMetadata);
  const commandDeckMetadataAcceptedProofItems = String(executionMetadata?.command_deck_universal_intake_accepted_proof_items || '').split('|').map((item) => asText(item)).filter((item) => item && item !== 'none');
  const commandDeckMetadataRejectedProofItems = String(executionMetadata?.command_deck_universal_intake_rejected_proof_items || '').split('|').map((item) => asText(item)).filter((item) => item && item !== 'none');
  const commandDeckCumulativeAcceptedProofItems = String(executionMetadata?.command_deck_cumulative_accepted_proof_items || executionMetadata?.command_deck_proof_session_accepted_items || '').split('|').map((item) => asText(item)).filter((item) => item && item !== 'none');
  const commandDeckCumulativeRejectedProofItems = String(executionMetadata?.command_deck_cumulative_rejected_proof_items || executionMetadata?.command_deck_proof_session_rejected_items || '').split('|').map((item) => asText(item)).filter((item) => item && item !== 'none');
  const commandDeckMetadataRoutedToEvidence = String(executionMetadata?.command_deck_universal_intake_routed_to || '').includes('evidence-return-intake');
  const commandDeckMetadataProofProjection = commandDeckMetadataRoutedToEvidence
    ? { acceptedProofItems: commandDeckMetadataAcceptedProofItems, rejectedProofItems: commandDeckMetadataRejectedProofItems, cumulativeAcceptedProofItems: commandDeckCumulativeAcceptedProofItems, cumulativeRejectedProofItems: commandDeckCumulativeRejectedProofItems }
    : {};
  let missionProofReconciliation = buildMissionProofReconciliation({
    missionConsoleDiagnostics,
    supportSnapshot: runtimeStatus || {},
    missionVerification: runtimeStatus?.missionVerification || {},
    prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {},
    uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' },
    openClawSourcePackRunner: resolveLiveBuilderWorkbenchProjection(runtimeStatus).projection?.openClawSourcePackRunner || {},
    evidenceReturnIntakeProjection: commandDeckMetadataProofProjection,
  });
  const livePacketBayProjection = runtimeStatus?.operatorReliefProjection?.packetBayProjection
    || runtimeStatus?.runtimeContext?.operatorReliefProjection?.packetBayProjection
    || runtimeStatus?.missionState?.operatorReliefProjection?.packetBayProjection
    || runtimeStatus?.inputMissionState?.operatorReliefProjection?.packetBayProjection
    || null;
  let packetBayProjection = livePacketBayProjection && typeof livePacketBayProjection === 'object'
    ? livePacketBayProjection
    : derivePacketBayProjection({ builderMeshProjection: resolveLiveBuilderMeshProjection(runtimeStatus).projection, missionProofReconciliation });
  let packetBayFields = {
    ...(packetBayProjection.supportSnapshotFields || {}),
    packet_missing_proof_summary: reconciledMissionMissingProof(packetBayProjection.rawLegacyMissingProofSummary || packetBayProjection.missingProofSummary || packetBayProjection.supportSnapshotFields?.packet_missing_proof_summary || [], missionProofReconciliation).join(' | ') || 'none',
    packet_raw_legacy_missing_proof_summary: packetBayProjection.rawLegacyMissingProofSummary || packetBayProjection.missingProofSummary || packetBayProjection.supportSnapshotFields?.packet_missing_proof_summary || 'none',
  };
  const liveAgentRealityLoopProjection = runtimeStatus?.operatorReliefProjection?.agentRealityLoopProjection
    || runtimeStatus?.runtimeContext?.operatorReliefProjection?.agentRealityLoopProjection
    || runtimeStatus?.missionState?.operatorReliefProjection?.agentRealityLoopProjection
    || runtimeStatus?.inputMissionState?.operatorReliefProjection?.agentRealityLoopProjection
    || null;
  let agentRealityLoopFields = liveAgentRealityLoopProjection && typeof liveAgentRealityLoopProjection === 'object'
    ? (liveAgentRealityLoopProjection.supportSnapshotFields || {
      agent_reality_loop_status: liveAgentRealityLoopProjection.status,
      agent_reality_loop_phase: liveAgentRealityLoopProjection.phase,
      agent_reality_loop_projection_available: liveAgentRealityLoopProjection.projectionSource && liveAgentRealityLoopProjection.projectionSource !== 'none' ? 'yes' : 'no',
      agent_reality_loop_recommended_lead: liveAgentRealityLoopProjection.recommendedLead,
      agent_reality_loop_recommended_lead_reason: liveAgentRealityLoopProjection.recommendedLeadReason,
      agent_reality_loop_next_action: liveAgentRealityLoopProjection.nextAction || liveAgentRealityLoopProjection.nextBestAction,
      agent_reality_loop_next_packet_id: liveAgentRealityLoopProjection.nextPacketId,
      agent_reality_loop_next_packet_target: liveAgentRealityLoopProjection.nextPacketTarget,
      agent_reality_loop_next_packet_kind: liveAgentRealityLoopProjection.nextPacketKind,
      agent_reality_loop_copy_packets_available: liveAgentRealityLoopProjection.copyPacketsAvailable ? 'yes' : 'no',
      agent_reality_loop_awaiting_result_from: liveAgentRealityLoopProjection.awaitingResultFrom,
      agent_reality_loop_expected_result_kind: liveAgentRealityLoopProjection.expectedResultKind,
      agent_reality_loop_missing_proof_summary: reconciledMissionMissingProof(liveAgentRealityLoopProjection.missingProof || [], missionProofReconciliation).join(' | ') || 'none',
      agent_reality_loop_blocker_count: String((liveAgentRealityLoopProjection.blockers || []).length),
      agent_reality_loop_warning_count: String((liveAgentRealityLoopProjection.warnings || []).length),
      agent_reality_loop_operator_decision_required: liveAgentRealityLoopProjection.operatorDecisionRequired ? 'yes' : 'no',
      agent_reality_loop_mutation_allowed: liveAgentRealityLoopProjection.mutationAllowed ? 'yes' : 'no',
      agent_reality_loop_openclaw_mutation_locked: liveAgentRealityLoopProjection.openClawMutationLocked === false ? 'no' : 'yes',
      agent_reality_loop_codex_auto_dispatch_allowed: liveAgentRealityLoopProjection.codexAutoDispatchAllowed ? 'yes' : 'no',
      agent_reality_loop_projection_source: liveAgentRealityLoopProjection.projectionSource,
      agent_reality_loop_confidence: liveAgentRealityLoopProjection.confidence,
    })
    : {};
  const agentRealityLoopRawLegacyMissingProofSummary = agentRealityLoopFields.agent_reality_loop_raw_legacy_missing_proof_summary
    || agentRealityLoopFields.agent_reality_loop_missing_proof_summary
    || liveAgentRealityLoopProjection?.rawLegacyMissingProofSummary
    || liveAgentRealityLoopProjection?.missingProofSummary
    || liveAgentRealityLoopProjection?.missingProof
    || 'none';
  agentRealityLoopFields = {
    ...agentRealityLoopFields,
    agent_reality_loop_missing_proof_summary: reconciledMissionMissingProof(agentRealityLoopRawLegacyMissingProofSummary, missionProofReconciliation).join(' | ') || 'none',
    agent_reality_loop_raw_legacy_missing_proof_summary: Array.isArray(agentRealityLoopRawLegacyMissingProofSummary)
      ? agentRealityLoopRawLegacyMissingProofSummary.join(' | ') || 'none'
      : asText(agentRealityLoopRawLegacyMissingProofSummary, 'none'),
  };
  const liveProjectAwarenessProjection = runtimeStatus?.operatorReliefProjection?.projectAwarenessProjection
    || runtimeStatus?.runtimeContext?.operatorReliefProjection?.projectAwarenessProjection
    || runtimeStatus?.missionState?.operatorReliefProjection?.projectAwarenessProjection
    || runtimeStatus?.inputMissionState?.operatorReliefProjection?.projectAwarenessProjection
    || null;
  const projectAwarenessRuntimeProjection = liveProjectAwarenessProjection && typeof liveProjectAwarenessProjection === 'object'
    ? liveProjectAwarenessProjection
    : buildProjectAwarenessProjection({
      activeMission: runtimeStatus?.activeMission || runtimeStatus?.missionState?.activeMission || {},
      builderMeshProjection: resolveLiveBuilderMeshProjection(runtimeStatus).projection,
      packetBayProjection,
      agentRealityLoopProjection: liveAgentRealityLoopProjection || {},
      missionVerification: runtimeStatus?.missionVerification || {},
      uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' },
      supportSnapshot: runtimeStatus || {},
      missionProofReconciliation,
    });
  const projectAwarenessFields = projectAwarenessSupportSnapshotFields(
    {
      ...projectAwarenessRuntimeProjection,
      rawLegacyMissingProof: projectAwarenessRuntimeProjection.rawLegacyMissingProof || projectAwarenessRuntimeProjection.missingProof,
      missingProof: reconciledMissionMissingProof(projectAwarenessRuntimeProjection.missingProof || [], missionProofReconciliation),
      nextBestAction: missionProofReconciliation?.evidenceIntakeAcceptedProof === true && missionProofReconciliation?.remainingMissingItems?.length
        ? missionProofReconciliation.nextBestAction
        : projectAwarenessRuntimeProjection.nextBestAction,
    },
    executionMetadata?.project_awareness_prompt_injected || 'no',
  );
  const liveMissionEvidenceLedgerProjection = runtimeStatus?.operatorReliefProjection?.missionEvidenceLedgerProjection
    || runtimeStatus?.runtimeContext?.operatorReliefProjection?.missionEvidenceLedgerProjection
    || runtimeStatus?.missionState?.operatorReliefProjection?.missionEvidenceLedgerProjection
    || runtimeStatus?.inputMissionState?.operatorReliefProjection?.missionEvidenceLedgerProjection
    || missionEvidenceLedgerProjectionFromRuntimeFields(runtimeStatus)
    || null;
  const hasLiveMissionEvidenceLedgerProjection = Boolean(liveMissionEvidenceLedgerProjection && typeof liveMissionEvidenceLedgerProjection === 'object');
  const missionEvidenceLedgerProjection = liveMissionEvidenceLedgerProjection && typeof liveMissionEvidenceLedgerProjection === 'object'
    ? liveMissionEvidenceLedgerProjection
    : deriveMissionEvidenceLedgerProjection({
      projectAwarenessProjection: projectAwarenessRuntimeProjection,
      agentRealityLoopProjection: liveAgentRealityLoopProjection || {},
      packetBayProjection,
      builderMeshProjection: resolveLiveBuilderMeshProjection(runtimeStatus).projection,
      builderWorkbenchProjection: resolveLiveBuilderWorkbenchProjection(runtimeStatus).projection,
      openClawSourcePackRunner: resolveLiveBuilderWorkbenchProjection(runtimeStatus).projection?.openClawSourcePackRunner || {},
      openClawWorkspaceHygiene: resolveLiveBuilderWorkbenchProjection(runtimeStatus).projection?.openClawWorkspaceHygiene || {},
      missionVerification: runtimeStatus?.missionVerification || {},
      prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {},
      uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' },
      missionProofReconciliation,
    });
  const missionEvidenceContextSummary = deriveMissionEvidenceContextSummary(missionEvidenceLedgerProjection);
  const missionEvidenceLedgerFields = missionEvidenceLedgerSupportSnapshotFields({
    ...missionEvidenceLedgerProjection,
    rawLegacyMissingProof: missionEvidenceLedgerProjection.rawLegacyMissingProof || missionEvidenceLedgerProjection.missingProofSummary,
    missingProofSummary: reconciledMissionMissingProof(missionEvidenceLedgerProjection.rawLegacyMissingProof || missionEvidenceLedgerProjection.missingProofSummary || [], missionProofReconciliation).join(' | ') || 'none',
    nextRequiredEvidence: (missionProofReconciliation?.evidenceIntakeAcceptedProof === true || (missionProofReconciliation?.missionConsoleBridgeProofAccepted === true && missionEvidenceLedgerProjection.nextRequiredEvidence !== 'local-ai-route-proof-needed'))
      ? (missionProofReconciliation?.remainingMissingItems?.[0] || missionEvidenceLedgerProjection.nextRequiredEvidence)
      : missionEvidenceLedgerProjection.nextRequiredEvidence,
    nextAction: (missionProofReconciliation?.evidenceIntakeAcceptedProof === true || (missionProofReconciliation?.missionConsoleBridgeProofAccepted === true && missionEvidenceLedgerProjection.nextRequiredEvidence !== 'local-ai-route-proof-needed')) && missionProofReconciliation?.remainingMissingItems?.length
      ? missionProofReconciliation.nextBestAction
      : missionEvidenceLedgerProjection.nextAction,
  });
  const liveEvidenceReturnIntakeProjection = runtimeStatus?.operatorReliefProjection?.evidenceReturnIntakeProjection || runtimeStatus?.runtimeContext?.operatorReliefProjection?.evidenceReturnIntakeProjection || runtimeStatus?.missionState?.operatorReliefProjection?.evidenceReturnIntakeProjection || null;
  const commandDeckUniversalIntakeText = executionMetadata?.command_deck_universal_intake_echo && executionMetadata.command_deck_universal_intake_echo !== 'none' ? executionMetadata.command_deck_universal_intake_echo : '';
  const derivedEvidenceReturnIntakeProjection = liveEvidenceReturnIntakeProjection && typeof liveEvidenceReturnIntakeProjection === 'object' ? liveEvidenceReturnIntakeProjection : deriveEvidenceReturnIntakeProjection({ missionEvidenceLedgerProjection, missionEvidenceContextSummary, packetBayProjection, missionProofReconciliation, operatorPastedIntakeText: commandDeckUniversalIntakeText, builderWorkbenchInput: runtimeStatus?.builderWorkbenchInput || runtimeStatus?.operatorReliefProjection?.builderMeshProjection?.builderWorkbenchProjection?.builderWorkbenchInput || {} });
  const evidenceReturnIntakeProjection = commandDeckMetadataRoutedToEvidence && commandDeckMetadataAcceptedProofItems.length > 0
    ? {
      ...derivedEvidenceReturnIntakeProjection,
      acceptedProofItems: Array.from(new Set([...(derivedEvidenceReturnIntakeProjection.acceptedProofItems || []), ...commandDeckMetadataAcceptedProofItems])),
      rejectedProofItems: Array.from(new Set([...(derivedEvidenceReturnIntakeProjection.rejectedProofItems || []), ...commandDeckMetadataRejectedProofItems])),
      cumulativeAcceptedProofItems: commandDeckCumulativeAcceptedProofItems,
      cumulativeRejectedProofItems: commandDeckCumulativeRejectedProofItems,
    }
    : derivedEvidenceReturnIntakeProjection;
  missionProofReconciliation = buildMissionProofReconciliation({
    missionConsoleDiagnostics,
    supportSnapshot: runtimeStatus || {},
    missionVerification: runtimeStatus?.missionVerification || {},
    prEvidence: runtimeStatus?.prEvidence || runtimeStatus?.prEvidenceModel || {},
    uiRealityTruth: { status: runtimeStatus?.uiRealityStatus || runtimeStatus?.chatContextUiRealityStatus || '' },
    openClawSourcePackRunner: resolveLiveBuilderWorkbenchProjection(runtimeStatus).projection?.openClawSourcePackRunner || {},
    evidenceReturnIntakeProjection,
  });
  packetBayFields = {
    ...packetBayFields,
    packet_missing_proof_summary: reconciledMissionMissingProof(packetBayFields.packet_raw_legacy_missing_proof_summary || packetBayProjection.rawLegacyMissingProofSummary || packetBayProjection.missingProofSummary || packetBayProjection.supportSnapshotFields?.packet_missing_proof_summary || [], missionProofReconciliation).join(' | ') || 'none',
  };
  agentRealityLoopFields = {
    ...agentRealityLoopFields,
    agent_reality_loop_missing_proof_summary: reconciledMissionMissingProof(agentRealityLoopFields.agent_reality_loop_raw_legacy_missing_proof_summary || agentRealityLoopFields.agent_reality_loop_missing_proof_summary || [], missionProofReconciliation).join(' | ') || 'none',
  };
  const reconciledProjectAwarenessFields = projectAwarenessSupportSnapshotFields(
    {
      ...projectAwarenessRuntimeProjection,
      rawLegacyMissingProof: projectAwarenessRuntimeProjection.rawLegacyMissingProof || projectAwarenessRuntimeProjection.missingProof,
      missingProof: reconciledMissionMissingProof(projectAwarenessRuntimeProjection.rawLegacyMissingProof || projectAwarenessRuntimeProjection.missingProof || [], missionProofReconciliation),
      nextBestAction: missionProofReconciliation?.remainingMissingItems?.length ? missionProofReconciliation.nextBestAction : projectAwarenessRuntimeProjection.nextBestAction,
    },
    executionMetadata?.project_awareness_prompt_injected || 'no',
  );
  Object.assign(projectAwarenessFields, reconciledProjectAwarenessFields);
  const missionProofReconciliationFields = missionProofReconciliationSupportSnapshotFields(missionProofReconciliation);
  const evidenceReturnIntakeFields = evidenceReturnIntakeSupportSnapshotFields(liveEvidenceReturnIntakeProjection && typeof liveEvidenceReturnIntakeProjection === 'object' ? evidenceReturnIntakeProjection : {
    ...evidenceReturnIntakeProjection,
    remainingMissingProofItems: missionProofReconciliation.remainingMissingItems || evidenceReturnIntakeProjection.remainingMissingProofItems,
    remainingMissingProofSummary: (missionProofReconciliation.remainingMissingItems || []).join(' | ') || evidenceReturnIntakeProjection.remainingMissingProofSummary || 'none',
    recommendedNextAction: missionProofReconciliation.nextBestAction || evidenceReturnIntakeProjection.recommendedNextAction,
  });
  if (hasLiveMissionEvidenceLedgerProjection && missionEvidenceContextSummary.available && Number(packetBayProjection.evidencePacketCount || 0) === 0) {
    packetBayProjection = derivePacketBayProjection({
      builderMeshProjection: resolveLiveBuilderMeshProjection(runtimeStatus).projection,
      missionEvidenceLedgerProjection,
      missionEvidenceContextSummary,
      missionProofReconciliation,
    });
    packetBayFields = {
      ...(packetBayProjection.supportSnapshotFields || {}),
      packet_missing_proof_summary: reconciledMissionMissingProof(packetBayProjection.rawLegacyMissingProofSummary || packetBayProjection.missingProofSummary || packetBayProjection.supportSnapshotFields?.packet_missing_proof_summary || [], missionProofReconciliation).join(' | ') || 'none',
      packet_raw_legacy_missing_proof_summary: packetBayProjection.rawLegacyMissingProofSummary || packetBayProjection.missingProofSummary || packetBayProjection.supportSnapshotFields?.packet_missing_proof_summary || 'none',
    };
  }
  const operatorCockpitProjection = buildCockpitProjection({
    runtimeStatusModel: {
      ...(runtimeStatus || {}),
      operatorReliefProjection: {
        ...(runtimeStatus?.operatorReliefProjection || {}),
        missionProofReconciliation,
        missionEvidenceLedgerProjection,
        packetBayProjection,
        projectAwarenessProjection: projectAwarenessRuntimeProjection,
        agentRealityLoopProjection: liveAgentRealityLoopProjection || {},
        evidenceReturnIntakeProjection,
      },
      missionProofReconciliation,
      missionEvidenceLedgerProjection,
      packetBayProjection,
      projectAwarenessProjection: projectAwarenessRuntimeProjection,
      agentRealityLoopProjection: liveAgentRealityLoopProjection || {},
      evidenceReturnIntakeProjection,
    },
  });
  const operatorCockpitProjectionSourceDisplay = 'canonical cockpit projection';
  const cockpitActionModel = deriveCockpitActionModel(operatorCockpitProjection);
  const lastCockpitAction = globalThis.window?.__STEPHANOS_COCKPIT_LAST_ACTION__ || {};
  const operatorCockpitRenderSignature = cockpitRenderSignature(operatorCockpitProjection);
  const cockpitDomProof = deriveCockpitDomProof(operatorCockpitProjection);
  const openClawControlBridge = buildOpenClawControlBridgeProjection(runtimeStatus?.openClawControlBridge || runtimeStatus?.agentTaskProjection?.operatorSurface?.openClawControlBridge || {});
  const aiConsoleAnswerScroll = runtimeStatus?.uiDiagnostics?.aiConsoleAnswerScroll && typeof runtimeStatus.uiDiagnostics.aiConsoleAnswerScroll === 'object'
    ? runtimeStatus.uiDiagnostics.aiConsoleAnswerScroll
    : {};
  const commandDeckLocalReveal = globalThis.window?.__STEPHANOS_COMMAND_DECK_LOCAL_REVEAL__ && typeof globalThis.window.__STEPHANOS_COMMAND_DECK_LOCAL_REVEAL__ === 'object'
    ? globalThis.window.__STEPHANOS_COMMAND_DECK_LOCAL_REVEAL__
    : null;
  const commandDeckProof = deriveCommandDeckProof({ aiConsoleAnswerScroll, commandDeckLocalReveal, executionMetadata });
  const commandDeckLiveDiagnostics = commandDeckProof.live?.source === 'live-dom' ? commandDeckProof.live : {};
  const commandDeckDiagnostics = { ...aiConsoleAnswerScroll, ...commandDeckLiveDiagnostics };
  const commandDeckFallbackRoot = commandDeckProof.live?.root || null;
  const commandDeckFallbackAnswers = commandDeckFallbackRoot ? Array.from(commandDeckFallbackRoot.querySelectorAll('[data-answer-role="assistant"][data-answer-final="true"]')) : [];
  const commandDeckFallbackLatestAnswer = commandDeckProof.live?.latestAnswerFound === 'yes' ? { getAttribute: (name) => (name === 'data-assistant-answer-id' ? commandDeckProof.live.latestAnswerId : '') } : null;
  const providerExecutionGateStatus = String(executionMetadata?.provider_execution_gate_status || '').trim().toLowerCase();
  const commandPipelineFailureReason = String(executionMetadata?.command_pipeline_last_failure_reason || '').trim().toLowerCase();
  const executionTruthState = String(runtimeStatus?.executionTruth || '').trim().toLowerCase();
  const routeUnavailableFailurePresent = commandPipelineFailureReason === 'backend-route-unavailable'
    || commandPipelineFailureReason === 'route_unavailable';
  const routeFailureIsHistorical = routeTruthHealthy && routeUnavailableFailurePresent;
  const suppressStaleExecutionMetadata = routeFailureIsHistorical;
  const routeBlockedBeforeProvider = !routeFailureIsHistorical && (executionMetadata?.provider_fallback_blocked_by_route === true
    || providerExecutionGateStatus === 'blocked-by-route'
    || providerExecutionGateStatus === 'route-blocked'
    || executionTruthState === 'blocked-before-provider'
    || executionTruthState === 'no-provider-executed'
    || executionTruthState === 'blocked-before-provider / no-provider-executed'
    || routeUnavailableFailurePresent);
  const providerExecutionIsSuppressed = routeBlockedBeforeProvider || suppressStaleExecutionMetadata;
  const visibleActiveProvider = providerExecutionIsSuppressed ? 'none' : asText(routeTruthView?.executedProvider);
  const visibleFallbackActive = providerExecutionIsSuppressed ? 'no' : (routeTruthView?.fallbackActive ? 'yes' : 'no');
  const visibleLastExecutableProvider = providerExecutionIsSuppressed ? 'none' : asText(runtimeStatus?.lastExecutableProvider);
  const visibleLastActualProviderUsed = routeBlockedBeforeProvider
    ? 'none'
    : (suppressStaleExecutionMetadata ? 'none' : asText(runtimeStatus?.lastActualProviderUsed || routeTruthView?.executedProvider));
  const visibleExecutionTruth = routeBlockedBeforeProvider
    ? 'blocked-before-provider / no-provider-executed'
    : (suppressStaleExecutionMetadata
      ? 'none / idle / not-executed'
      : asText(runtimeStatus?.executionTruth));
  const visibleLastActualModelUsed = providerExecutionIsSuppressed
    ? 'n/a'
    : asText(runtimeStatus?.lastActualModelUsed || runtimeStatus?.lastModelUsed);
  const visibleLastModelUsed = providerExecutionIsSuppressed ? 'n/a' : asText(runtimeStatus?.lastModelUsed);
  const visibleLastTimeoutEffectiveProvider = providerExecutionIsSuppressed ? 'none' : asText(runtimeStatus?.lastTimeoutEffectiveProvider);
  const visibleLastTimeoutEffectiveModel = providerExecutionIsSuppressed ? 'n/a' : asText(runtimeStatus?.lastTimeoutEffectiveModel);
  const providerDriftDiagnostics = diagnoseProviderDrift({
    uiSelectedProvider: routeTruthView?.selectedProvider,
    uiDefaultProvider: runtimeStatus?.lastUiDefaultProvider,
    requestedProviderIntent: runtimeStatus?.lastRequestedProviderIntent,
    freshnessCandidateProvider: runtimeStatus?.lastFreshnessCandidateProvider,
    executionRequestedProvider: runtimeStatus?.lastExecutionRequestedProvider || executionMetadata?.execution_requested_provider,
    routerSelectedProvider: runtimeStatus?.lastRouterSelectedProvider,
    executableProvider: runtimeStatus?.lastExecutableProvider,
    actualProviderUsed: runtimeStatus?.lastActualProviderUsed,
    freshnessRequiredForTruth: runtimeStatus?.freshnessRequiredForTruth || executionMetadata?.freshness_required_for_truth,
    freshAnswerRequired: runtimeStatus?.freshAnswerRequired || executionMetadata?.fresh_answer_required,
    freshnessNeed: runtimeStatus?.lastFreshnessNeed || executionMetadata?.freshness_need,
    fallbackPermitted: runtimeStatus?.fallbackEnabled || executionMetadata?.fallback_permitted,
    explicitProviderOverrideForRequest: runtimeStatus?.lastExplicitProviderOverrideForRequest || executionMetadata?.explicit_provider_override_for_request,
    providerOverrideReason: runtimeStatus?.lastProviderOverrideReason || executionMetadata?.provider_override_reason,
    fallbackUsed: runtimeStatus?.lastFallbackUsed || executionMetadata?.fallback_used,
    policySource: executionMetadata?.execution_provider_policy_source || executionMetadata?.ai_policy_mode,
  });
  const executeActualTargetUsed = asText(executionMetadata?.execute_actual_target_used, 'n/a');
  const visibleActualTargetUsed = routeBlockedBeforeProvider
    ? executeActualTargetUsed
    : asText(routeTruthView?.actualTarget, 'n/a');
  const visibleBackendTargetResolvedUrl = routeBlockedBeforeProvider
    ? asText(executionMetadata?.execute_actual_target_used, 'n/a')
    : backendTargetResolvedUrl;
  const canonicalPrEvidence = projectCanonicalPrEvidence({
    prEvidence: {
      status: runtimeStatus?.prEvidenceStatus,
      prEvidenceStatus: runtimeStatus?.prEvidenceStatus,
      checksStatus: runtimeStatus?.prEvidenceChecksStatus,
      buildStatus: runtimeStatus?.prEvidenceBuildStatus,
      verifyStatus: runtimeStatus?.prEvidenceVerifyStatus,
      changedFileCount: runtimeStatus?.prEvidenceChangedFileCount,
      merged: String(runtimeStatus?.prEvidenceMerged || '').toLowerCase() === 'yes',
      mergeReadiness: runtimeStatus?.prEvidenceMergeReadiness,
      missingProof: String(runtimeStatus?.prEvidenceMissingProof || '').split('|').map((item) => item.trim()).filter(Boolean),
      recommendedNextAction: runtimeStatus?.prEvidenceRecommendedNextAction,
      prNumber: runtimeStatus?.prEvidenceParsedPrNumber || runtimeStatus?.prEvidenceNumber,
    },
    githubPrEvidence: {
      status: runtimeStatus?.githubPrEvidenceProviderStatus,
      checksStatus: runtimeStatus?.githubPrEvidenceChecksStatus,
      buildStatus: runtimeStatus?.githubPrEvidenceBuildStatus,
      verifyStatus: runtimeStatus?.githubPrEvidenceVerifyStatus,
      changedFileCount: runtimeStatus?.githubPrEvidenceChangedFileCount,
      merged: String(runtimeStatus?.githubPrEvidenceMerged || '').toLowerCase() === 'yes',
      mergeReadiness: runtimeStatus?.githubPrEvidenceMergeReadiness,
      missingProof: String(runtimeStatus?.githubPrEvidenceMissingProof || '').split('|').map((item) => item.trim()).filter(Boolean),
      recommendedNextAction: runtimeStatus?.githubPrEvidenceNextAction,
      prNumber: runtimeStatus?.githubPrEvidenceNumber || runtimeStatus?.prEvidenceParsedPrNumber || runtimeStatus?.prEvidenceNumber,
      parsedPrNumber: runtimeStatus?.githubPrEvidenceNumber || runtimeStatus?.prEvidenceParsedPrNumber || runtimeStatus?.prEvidenceNumber,
      repo: runtimeStatus?.githubPrEvidenceRepo,
      prState: runtimeStatus?.githubPrEvidenceState,
      prTitle: runtimeStatus?.githubPrEvidenceTitle,
      source: runtimeStatus?.githubPrEvidenceSource,
    },
  });
  const chatContextFields = [
    'chat_context_pack_status',
    'chat_context_response_mode',
    'chat_context_relevant_canon_count',
    'chat_context_next_action',
    'chat_context_raw_operator_message_seen',
    'chat_context_match_input',
    'chat_context_intent_classifier_matched_rule',
  ];
  const executionHasChatContext = chatContextFields
    .some((field) => executionMetadata[field] !== undefined && executionMetadata[field] !== null && executionMetadata[field] !== '');
  const runtimeHasChatContext = Boolean(runtimeStatus?.chatContextPackStatus && runtimeStatus.chatContextPackStatus !== 'unavailable')
    || Boolean(runtimeStatus?.chatContextResponseMode && runtimeStatus.chatContextResponseMode !== 'direct-answer');
  const commandExecutedWithoutContext = !executionHasChatContext
    && Object.keys(executionMetadata).length > 0
    && (executionMetadata.execution_status || executionMetadata.retrieval_query || executionMetadata.request_execution_id || executionMetadata.actual_provider_used);

  const normalizedClassifierRule = String(executionMetadata?.chat_context_intent_classifier_matched_rule || '').trim().toLowerCase();
  const normalizedMergeRuleResult = String(executionMetadata?.chat_context_merge_rule_test_result || '').trim().toLowerCase();
  const normalizedDefaultPackUsed = String(executionMetadata?.chat_context_default_pack_used || '').trim().toLowerCase();
  const hasMergeDecisionProof = executionHasChatContext
    && normalizedClassifierRule === 'merge-decision'
    && ['yes', 'true', '1'].includes(normalizedMergeRuleResult)
    && ['no', 'false', '0'].includes(normalizedDefaultPackUsed);
  const derivedMergeCanonCount = (() => {
    const explicitCount = Number(executionMetadata?.chat_context_relevant_canon_count);
    if (Number.isFinite(explicitCount) && explicitCount > 0) return explicitCount;
    const ruleResults = String(executionMetadata?.chat_context_evaluated_rule_results || '');
    const mergeMatch = ruleResults.match(/merge-decision:(\d+)/i);
    if (mergeMatch) return Math.max(Number(mergeMatch[1]) || 0, 1);
    const sources = String(executionMetadata?.chat_context_sources_used || '');
    if (sources && sources !== 'none') return sources.split('|').filter(Boolean).length;
    return 1;
  })();
  const derivedMergeAffectedSubsystems = executionMetadata?.chat_context_affected_subsystems && executionMetadata.chat_context_affected_subsystems !== 'none'
    ? executionMetadata.chat_context_affected_subsystems
    : 'merge|pr|codex|proof|source-truth';
  const derivedMergeSourcesUsed = executionMetadata?.chat_context_sources_used && executionMetadata.chat_context_sources_used !== 'none'
    ? executionMetadata.chat_context_sources_used
    : (executionMetadata?.chat_context_classifier_proof_source || 'rebuilt-from-final-message');
  const derivedMergeUiRealityStatus = executionMetadata?.chat_context_ui_reality_status && executionMetadata.chat_context_ui_reality_status !== 'UNKNOWN'
    ? executionMetadata.chat_context_ui_reality_status
    : (runtimeStatus?.chatContextUiRealityStatus || runtimeStatus?.uiRealityStatus || 'UNKNOWN');
  const derivedMergeNextAction = executionMetadata?.chat_context_next_action && executionMetadata.chat_context_next_action !== 'Answer directly with bounded confidence.'
    ? executionMetadata.chat_context_next_action
    : 'Collect merge/proof evidence and decide merge readiness.';

  const chatContextMetadataSource = executionHasChatContext
    ? 'final-execution-metadata'
    : (runtimeHasChatContext ? 'runtime-status-model' : 'none');
  const rawChatContextStatus = suppressStaleExecutionMetadata
    ? (runtimeStatus?.chatContextPackStatus || 'active')
    : (hasMergeDecisionProof
      ? 'active'
      : (executionHasChatContext
        ? (executionMetadata.chat_context_pack_status || 'active')
        : (runtimeHasChatContext
          ? runtimeStatus.chatContextPackStatus
          : (commandExecutedWithoutContext ? 'warning' : 'unavailable'))));
  const chatContextVersion = executionHasChatContext ? (executionMetadata.chat_context_version || runtimeStatus?.chatContextVersion || 'v1') : (runtimeStatus?.chatContextVersion || (commandExecutedWithoutContext ? 'v1' : 'n/a'));
  const rawChatContextResponseMode = hasMergeDecisionProof
    ? 'merge-decision'
    : (executionHasChatContext
      ? (executionMetadata.chat_context_response_mode || runtimeStatus?.chatContextResponseMode || 'direct-answer')
      : (runtimeStatus?.chatContextResponseMode || 'direct-answer'));
  const plannerOrEnvelopeMode = executionMetadata?.response_planner_response_mode || executionMetadata?.command_envelope_response_mode || '';
  const chatContextResponseMode = rawChatContextResponseMode === 'direct-answer' && ['mission-planning', 'work-routing', 'builder-mesh-routing', 'workbench-routing'].includes(plannerOrEnvelopeMode)
    ? plannerOrEnvelopeMode
    : rawChatContextResponseMode;
  const chatContextRelevantCanonCount = hasMergeDecisionProof ? derivedMergeCanonCount : (executionHasChatContext ? (executionMetadata.chat_context_relevant_canon_count ?? runtimeStatus?.chatContextRelevantCanonCount ?? 0) : (runtimeStatus?.chatContextRelevantCanonCount ?? 0));
  const chatContextAffectedSubsystems = hasMergeDecisionProof ? derivedMergeAffectedSubsystems : (executionHasChatContext ? (executionMetadata.chat_context_affected_subsystems || runtimeStatus?.chatContextAffectedSubsystems || 'none') : (runtimeStatus?.chatContextAffectedSubsystems || 'none'));
  const rawChatContextSourcesUsed = hasMergeDecisionProof ? derivedMergeSourcesUsed : (executionHasChatContext ? (executionMetadata.chat_context_sources_used || runtimeStatus?.chatContextSourcesUsed || 'none') : (runtimeStatus?.chatContextSourcesUsed || 'none'));
  const chatContextUiRealityStatus = hasMergeDecisionProof ? derivedMergeUiRealityStatus : (executionHasChatContext ? (executionMetadata.chat_context_ui_reality_status || runtimeStatus?.chatContextUiRealityStatus || 'UNKNOWN') : (runtimeStatus?.chatContextUiRealityStatus || 'UNKNOWN'));
  const rawChatContextMissionState = executionHasChatContext ? (executionMetadata.chat_context_mission_state || runtimeStatus?.chatContextMissionState || 'unknown') : (runtimeStatus?.chatContextMissionState || 'unknown');
  const chatContextNextAction = hasMergeDecisionProof
    ? derivedMergeNextAction
    : (executionHasChatContext
      ? (executionMetadata.chat_context_next_action || runtimeStatus?.chatContextNextAction || 'Answer directly with bounded confidence.')
      : ((runtimeStatus?.chatContextNextAction)
        || (commandExecutedWithoutContext
          ? 'Command executed without chat context metadata; regenerate context pack on next submission.'
          : (rawChatContextStatus === 'unavailable' ? 'Submit an operator command to generate context pack.' : 'Answer directly with bounded confidence.'))));
  const chatContextWarningCount = executionHasChatContext ? (executionMetadata.chat_context_warning_count ?? runtimeStatus?.chatContextWarningCount ?? 0) : (runtimeStatus?.chatContextWarningCount ?? (commandExecutedWithoutContext ? 1 : 0));
  const chatContextWarnings = executionHasChatContext ? (executionMetadata.chat_context_warnings || runtimeStatus?.chatContextWarnings || 'none') : (runtimeStatus?.chatContextWarnings || (commandExecutedWithoutContext ? 'command executed without chat context metadata' : 'none'));

  const chatContextRequestMetadataPresent = executionMetadata?.request_payload_chat_context_present === true ? 'yes' : 'no';
  const chatContextFinalExecutionMetadataPresent = executionHasChatContext ? 'yes' : 'no';
  const chatContextDroppedBeforeSnapshot = commandExecutedWithoutContext ? 'yes' : 'no';
  const chatContextMetadataFoundIn = executionHasChatContext ? 'lastExecutionMetadata' : (runtimeHasChatContext ? 'runtimeStatusModel' : 'none');
  const chatContextDebugKeysPresent = chatContextFields.filter((field) => executionMetadata[field] !== undefined).join('|') || 'none';
  const chatContextAttachmentProbe = executionMetadata?.chat_context_attachment_probe || 'none';
  const chatContextAttachmentProbeResponseMode = executionMetadata?.chat_context_attachment_probe_response_mode || 'n/a';
  const chatContextAttachmentProbePresent = chatContextAttachmentProbe === 'attached-at-final-execution-metadata' ? 'yes' : 'no';
  const chatContextRawOperatorMessageSeen = executionMetadata?.chat_context_raw_operator_message_seen || 'n/a';
  const chatContextNormalizedOperatorMessage = executionMetadata?.chat_context_normalized_operator_message || 'n/a';
  const chatContextIntentClassifierMatchedRule = executionMetadata?.chat_context_intent_classifier_matched_rule || 'n/a';
  const chatContextMatchInput = executionMetadata?.chat_context_match_input || 'n/a';
  const chatContextMergeRulePattern = executionMetadata?.chat_context_merge_rule_pattern || 'none';
  const chatContextMergeRuleTestResult = executionMetadata?.chat_context_merge_rule_test_result || 'no';
  const chatContextFirstMatchingRule = executionMetadata?.chat_context_first_matching_rule || 'n/a';
  const chatContextEvaluatedRuleResults = executionMetadata?.chat_context_evaluated_rule_results || 'n/a';
  const chatContextBuildSource = executionMetadata?.chat_context_build_source || 'n/a';
  const chatContextDefaultPackUsed = executionMetadata?.chat_context_default_pack_used || 'n/a';
  const chatContextWasOverwritten = executionMetadata?.chat_context_was_overwritten || 'no';
  const chatContextRebuiltAtFinalAttachment = executionMetadata?.chat_context_rebuilt_at_final_attachment || 'no';
  const chatContextRebuildSourceField = executionMetadata?.chat_context_rebuild_source_field || 'none';
  const chatContextClassifierProofSource = executionMetadata?.chat_context_classifier_proof_source || 'missing';
  const retrievalQueryTextForRouting = String(executionMetadata?.retrieval_query || executionMetadata?.prompt || '').trim();
  const hasWorkRoutingPromptMarker = retrievalQueryTextForRouting.includes('[Work Routing Context: bounded truth for Codex/OpenClaw task assignment only]');
  const rawProviderIdsUsed = executionMetadata?.chat_context_provider_ids_used || 'none';
  const providerIdsUsedList = String(rawProviderIdsUsed).split('|').map((item) => item.trim()).filter(Boolean);
  const projectAwarenessProjection = normalizeProjectAwarenessProjection({
    responseMode: chatContextResponseMode,
    metadata: {
      ...executionMetadata,
      chat_context_pack_status: rawChatContextStatus,
      chat_context_sources_used: rawChatContextSourcesUsed,
      chat_context_mission_state: rawChatContextMissionState,
    },
    providerIdsUsed: providerIdsUsedList,
  });
  const chatContextStatus = projectAwarenessProjection.chatContextPackStatus || rawChatContextStatus;
  const chatContextSourcesUsed = projectAwarenessProjection.chatContextSourcesUsed || rawChatContextSourcesUsed;
  let chatContextCoBuilderContextIncluded = /\bcoBuilderLoop\b/i.test(chatContextSourcesUsed) ? 'yes' : 'no';
  const chatContextBuilderMeshContextIncluded = /\bbuilderMesh\b/i.test(chatContextSourcesUsed) || String(executionMetadata?.builder_mesh_context_recognized || '').trim().toLowerCase() === 'yes' ? 'yes' : 'no';
  let chatContextAgentWorkRoutingContextIncluded = /\bagentWorkRouting\b/i.test(chatContextSourcesUsed) ? 'yes' : 'no';
  let normalizedChatContextSourcesUsed = chatContextSourcesUsed;
  let normalizedChatContextStatus = chatContextStatus;
  const arlProjectionAvailable = String(agentRealityLoopFields.agent_reality_loop_projection_available || executionMetadata?.agent_reality_loop_projection_available || '').trim().toLowerCase() === 'yes';
  const arlContextRecognized = String(executionMetadata?.agent_reality_loop_context_recognized || '').trim().toLowerCase() === 'yes';
  const arlProjectionSource = firstKnownValue([
    agentRealityLoopFields.agent_reality_loop_projection_source,
    executionMetadata?.agent_reality_loop_projection_source_seen,
    String(executionMetadata?.operator_relief_bridge_agent_reality_loop_seen || '').trim().toLowerCase() === 'yes' ? 'operator-relief-bridge' : '',
    String(executionMetadata?.operator_relief_bridge_published || '').trim().toLowerCase() === 'yes' ? 'operator-relief-bridge' : '',
    arlProjectionAvailable ? 'command-deck-projection-bridge' : '',
  ], 'none');
  const arlContextInjected = arlContextRecognized && arlProjectionAvailable && arlProjectionSource !== 'none'
    ? 'yes'
    : firstKnownValue([executionMetadata?.agent_reality_loop_context_injected], 'no');
  const arlContextInjectionBlocker = arlContextInjected === 'yes'
    ? 'none'
    : (arlContextRecognized && arlProjectionAvailable ? 'projection-available-but-chat-context-injection-proof-missing' : 'none');
  if (String(agentRealityLoopFields.agent_reality_loop_projection_available || executionMetadata?.agent_reality_loop_projection_available || '').trim().toLowerCase() === 'yes'
    && normalizedChatContextStatus === 'unavailable') {
    normalizedChatContextStatus = 'degraded-with-arl';
  }
  if (arlContextInjected === 'yes') {
    const sourceSet = new Set(String(normalizedChatContextSourcesUsed || 'none').split('|').map((item) => item.trim()).filter(Boolean).filter((item) => item !== 'none'));
    if (arlProjectionSource && arlProjectionSource !== 'none') sourceSet.add(arlProjectionSource);
    normalizedChatContextSourcesUsed = sourceSet.size ? Array.from(sourceSet).join('|') : normalizedChatContextSourcesUsed;
  }
  if (hasWorkRoutingPromptMarker) {
    chatContextCoBuilderContextIncluded = 'yes';
    chatContextAgentWorkRoutingContextIncluded = 'yes';
    const sourceSet = new Set(String(chatContextSourcesUsed || 'none').split('|').map((item) => item.trim()).filter(Boolean).filter((item) => item !== 'none'));
    sourceSet.add('agentWorkRouting');
    sourceSet.add('coBuilderLoop');
    normalizedChatContextSourcesUsed = sourceSet.size ? Array.from(sourceSet).join('|') : 'agentWorkRouting|coBuilderLoop';
    if (normalizedChatContextStatus === 'unavailable') normalizedChatContextStatus = 'degraded';
  }
  const chatContextMissionState = projectAwarenessProjection.chatContextMissionState || rawChatContextMissionState;
  const contextProviderRegistryStatus = executionMetadata?.chat_context_provider_registry_status || (chatContextStatus === 'active' ? 'active' : 'unavailable');
  const contextProvidersRegistered = executionMetadata?.chat_context_provider_ids_registered || 'none';
  const contextProvidersUsed = rawProviderIdsUsed;
  const contextProviderWarningCount = executionMetadata?.chat_context_provider_warning_count ?? 0;
  const contextProviderProofState = executionMetadata?.chat_context_provider_proof_state || 'unknown';
  const contextProviderNextActions = executionMetadata?.chat_context_provider_next_actions || 'none';
  const contextProviderCanonLinksCount = executionMetadata?.chat_context_provider_canon_links_count || 0;


  const operatorNameKnown = executionMetadata?.chat_context_operator_name_known || executionMetadata?.command_envelope_operator_name_known || 'no';
  const operatorName = executionMetadata?.chat_context_operator_name || executionMetadata?.command_envelope_operator_name || 'unknown';
  const operatorIdentitySource = executionMetadata?.chat_context_operator_identity_source || executionMetadata?.command_envelope_operator_identity_source || 'none';
  const operatorIdentityConfidence = executionMetadata?.chat_context_operator_identity_confidence || executionMetadata?.command_envelope_operator_identity_confidence || 'unknown';
  const operatorIdentityUpdatedAt = executionMetadata?.chat_context_operator_identity_updated_at || 'unknown';
  const operatorIdentityNextAction = executionMetadata?.chat_context_operator_identity_next_action || 'Ask operator for preferred name when relevant.';
  const operatorProfileRehydrated = executionMetadata?.chat_context_operator_profile_rehydrated || 'no';
  const operatorProfileStorageKey = executionMetadata?.chat_context_operator_profile_storage_key || 'stephanos.operator.profile.v1';
  const operatorProfileStorageReadStatus = executionMetadata?.chat_context_operator_profile_storage_read_status || 'missing';
  const operatorProfileLastReadAt = executionMetadata?.chat_context_operator_profile_last_read_at || 'unknown';
  const operatorProfileLastWriteAt = executionMetadata?.chat_context_operator_profile_last_write_at || 'unknown';
  const chatContextOperatorProfileUsed = (executionMetadata?.chat_context_provider_ids_used || '').includes('operatorProfile') ? 'yes' : 'no';
  const chatContextOperatorNameAvailable = operatorNameKnown === 'yes' ? 'yes' : 'no';

  const responsePlannerStatus = suppressStaleExecutionMetadata ? 'active' : (executionMetadata?.response_planner_status || 'unavailable');
  const responsePlannerVersion = executionMetadata?.response_planner_version || 'n/a';
  const responsePlannerResponseMode = executionMetadata?.response_planner_response_mode || chatContextResponseMode || 'direct-answer';
  const responsePlannerAnswerShape = executionMetadata?.response_planner_answer_shape || 'direct-answer';
  const responsePlannerRequiredSections = executionMetadata?.response_planner_required_sections || 'none';
  const responsePlannerRiskLevel = executionMetadata?.response_planner_risk_level || 'low';
  const responsePlannerProofRequired = executionMetadata?.response_planner_proof_required || 'no';
  const responsePlannerMergeDecision = executionMetadata?.response_planner_merge_decision || 'unknown';
  const responsePlannerCodexPromptRequired = executionMetadata?.response_planner_codex_prompt_required || 'no';
  const responsePlannerNextAction = executionMetadata?.response_planner_next_action || 'answer directly with bounded confidence';
  const responsePlannerWarningCount = executionMetadata?.response_planner_warning_count ?? 0;
  const responsePlannerWarnings = executionMetadata?.response_planner_warnings || 'none';
  const responsePlannerCanonApplied = executionMetadata?.response_planner_canon_applied || 'none';
  const responsePlannerIdentityRecallMetadata = String(executionMetadata?.response_planner_identity_recall || '').trim().toLowerCase();
  const responsePlannerOperatorNameUsedMetadata = String(executionMetadata?.response_planner_operator_name_used || '').trim().toLowerCase();
  const responsePlannerIdentityMode = responsePlannerResponseMode === 'identity-recall' || responsePlannerAnswerShape === 'identity-recall';
  const responsePlannerIdentityRecall = responsePlannerIdentityRecallMetadata
    ? (responsePlannerIdentityRecallMetadata === 'yes' ? 'yes' : 'no')
    : (responsePlannerIdentityMode ? 'yes' : 'no');
  const responsePlannerOperatorNameUsed = responsePlannerOperatorNameUsedMetadata
    ? (responsePlannerOperatorNameUsedMetadata === 'yes' ? 'yes' : 'no')
    : (responsePlannerIdentityMode && operatorNameKnown === 'yes' ? 'yes' : 'no');
  const responsePlannerIdentityPromptInjected = executionMetadata?.response_planner_identity_prompt_injected || 'no';
  const operatorProfilePromptLinePresent = executionMetadata?.operator_profile_prompt_line_present || 'no';
  const finalAnswerUsedOperatorProfile = executionMetadata?.final_answer_used_operator_profile || 'no';
  const identityRecallDeterministicAnswerUsed = executionMetadata?.identity_recall_deterministic_answer_used || 'no';
  const commandPipelineLastSubmitAccepted = executionMetadata?.command_pipeline_last_submit_accepted || 'no';
  const commandPipelineLastUserMessageRecorded = executionMetadata?.command_pipeline_last_user_message_recorded || 'no';
  const commandPipelineLastAssistantAnswerGenerated = executionMetadata?.command_pipeline_last_assistant_answer_generated || 'no';
  const commandPipelineLastAnswerPaneRendered = executionMetadata?.command_pipeline_last_answer_pane_rendered || 'no';
  const commandPipelineLastFailureReason = suppressStaleExecutionMetadata ? 'none' : (executionMetadata?.command_pipeline_last_failure_reason || 'none');
  const historicalCommandFailureReason = suppressStaleExecutionMetadata
    ? (executionMetadata?.command_pipeline_last_failure_reason || 'none')
    : 'none';
  const currentCommandPipelineState = routeBlockedBeforeProvider
    ? 'route-blocked'
    : (suppressStaleExecutionMetadata ? 'idle / no-current-failure' : 'ready');
  const currentProviderExecutionTruth = routeBlockedBeforeProvider
    ? 'blocked-before-provider / no-provider-executed'
    : (suppressStaleExecutionMetadata ? 'none / idle / not-executed' : 'executed-or-pending');
  const commandPipelineLastFinalizationPath = executionMetadata?.command_pipeline_last_finalization_path || 'unknown';
  const commandPipelineLastInputCleared = executionMetadata?.command_pipeline_last_input_cleared || 'no';
  const commandPipelineLastInputRestoreAvailable = executionMetadata?.command_pipeline_last_input_restore_available || 'yes';


  const activeMissionStatus = executionMetadata?.chat_context_active_mission_status || (projectAwarenessRuntimeProjection.status !== 'unavailable' ? projectAwarenessRuntimeProjection.status : 'unknown');
  const activeMissionId = executionMetadata?.chat_context_active_mission_id || projectAwarenessRuntimeProjection.missionId || 'unknown';
  const activeMissionTitle = executionMetadata?.chat_context_active_mission_title || projectAwarenessRuntimeProjection.title || 'unknown';
  const activeMissionPhase = executionMetadata?.chat_context_active_mission_phase || projectAwarenessRuntimeProjection.phase || 'unknown';
  const activeMissionCurrentFocus = executionMetadata?.chat_context_active_mission_current_focus || projectAwarenessRuntimeProjection.currentFocus || 'unknown';
  const activeMissionNextStep = executionMetadata?.chat_context_active_mission_next_step || projectAwarenessRuntimeProjection.nextBestAction || 'unknown';
  const activeMissionProofState = executionMetadata?.chat_context_active_mission_proof_state || (projectAwarenessRuntimeProjection.missingProof?.length ? 'proof-missing' : 'unknown');
  const activeMissionRelatedSystems = executionMetadata?.chat_context_active_mission_related_systems || (projectAwarenessRuntimeProjection.affectedSubsystems || []).join('|') || 'none';
  const activeMissionRehydrated = executionMetadata?.chat_context_active_mission_rehydrated || (projectAwarenessRuntimeProjection.rehydrated ? 'yes' : 'no');
  const activeMissionStorageKey = executionMetadata?.chat_context_active_mission_storage_key || 'stephanos.active.mission.v1';
  const activeMissionRawTranscriptStored = executionMetadata?.chat_context_active_mission_raw_transcript_stored || 'no';
  const rawProjectAwarenessPackStatus = executionMetadata?.project_awareness_pack_status || '';
  const projectAwarenessPackStatus = rawProjectAwarenessPackStatus === 'unavailable' && projectAwarenessProjection.projectAwarenessStatus && projectAwarenessProjection.projectAwarenessStatus !== 'unavailable'
    ? projectAwarenessProjection.projectAwarenessStatus
    : (rawProjectAwarenessPackStatus || projectAwarenessFields.project_awareness_pack_status || projectAwarenessProjection.projectAwarenessStatus || 'unavailable');
  const projectAwarenessSourcesUsed = executionMetadata?.project_awareness_sources_used || projectAwarenessFields.project_awareness_sources_used || 'none';
  const projectAwarenessCurrentMission = executionMetadata?.project_awareness_current_mission || projectAwarenessFields.project_awareness_current_mission || 'unknown';
  const projectAwarenessNextBestAction = executionMetadata?.project_awareness_next_best_action || projectAwarenessFields.project_awareness_next_best_action || 'unknown';
  const projectAwarenessOperatorWorkflowPreference = executionMetadata?.project_awareness_operator_workflow_preference || 'unknown';
  const projectAwarenessCodexRole = executionMetadata?.project_awareness_codex_role || 'unknown';
  const projectAwarenessOpenClawRole = executionMetadata?.project_awareness_openclaw_role || 'unknown';
  const projectAwarenessWarningCount = executionMetadata?.project_awareness_warning_count ?? projectAwarenessFields.project_awareness_warning_count ?? 0;
  const retrievalQueryText = String(executionMetadata?.retrieval_query || executionMetadata?.prompt || '').trim();
  const promptInjectionMarker = '[Project Awareness Context: bounded truth for mission-planning only]';
  const hasPromptInjectionMarker = retrievalQueryText.includes(promptInjectionMarker);
  const workRoutingPromptMarker = '[Work Routing Context: bounded truth for Codex/OpenClaw task assignment only]';
  const inferredPromptSources = executionMetadata?.project_awareness_sources_used || projectAwarenessProjection.projectAwarenessSourcesUsed || 'none';
  const missionPlanningModeActive = (chatContextResponseMode === 'mission-planning')
    || (responsePlannerResponseMode === 'mission-planning');
  const rawProjectAwarenessPromptInjected = asText(executionMetadata?.project_awareness_prompt_injected, 'no');
  const rawProjectAwarenessPromptBlockLength = Number(executionMetadata?.project_awareness_prompt_block_length ?? 0) > 0
    ? Number(executionMetadata?.project_awareness_prompt_block_length ?? 0)
    : 0;
  const promptMarkerAndBlockDetected = hasPromptInjectionMarker && rawProjectAwarenessPromptBlockLength > 0;
  const projectAwarenessPromptInjected = promptMarkerAndBlockDetected
    ? 'yes'
    : (rawProjectAwarenessPromptInjected === 'yes' ? 'yes' : (hasPromptInjectionMarker ? 'yes' : 'no'));
  const projectAwarenessPromptBlockLength = rawProjectAwarenessPromptBlockLength > 0
    ? rawProjectAwarenessPromptBlockLength
    : (hasPromptInjectionMarker ? promptInjectionMarker.length : 0);
  const projectAwarenessPromptSources = promptMarkerAndBlockDetected
    ? (asText(executionMetadata?.project_awareness_prompt_sources, '') || asText(inferredPromptSources, 'projectAwareness'))
    : (executionMetadata?.project_awareness_prompt_sources || (hasPromptInjectionMarker ? inferredPromptSources : 'none'));
  const missionPlanningPromptContextUsed = promptMarkerAndBlockDetected
    ? 'yes'
    : (executionMetadata?.mission_planning_prompt_context_used || ((hasPromptInjectionMarker && missionPlanningModeActive) ? 'yes' : 'no'));
  const rawWorkRoutingPromptInjected = asText(executionMetadata?.work_routing_prompt_injected, 'no');
  const rawWorkRoutingPromptBlockLength = Number(executionMetadata?.work_routing_prompt_block_length ?? 0) > 0
    ? Number(executionMetadata?.work_routing_prompt_block_length ?? 0)
    : 0;
  const workRoutingPromptInjected = rawWorkRoutingPromptInjected === 'yes' || hasWorkRoutingPromptMarker ? 'yes' : 'no';
  const workRoutingPromptBlockLength = rawWorkRoutingPromptBlockLength > 0
    ? rawWorkRoutingPromptBlockLength
    : (hasWorkRoutingPromptMarker ? workRoutingPromptMarker.length : 0);
  const workRoutingPromptSources = executionMetadata?.work_routing_prompt_sources
    || (hasWorkRoutingPromptMarker ? 'agentWorkRouting|coBuilderLoop' : 'none');

  const commandEnvelopeStatus = executionMetadata?.command_envelope_status || 'unavailable';
  const commandEnvelopeVersion = executionMetadata?.command_envelope_version || 'n/a';
  const commandEnvelopeId = executionMetadata?.command_envelope_id || 'n/a';
  const commandEnvelopeSubmissionSource = executionMetadata?.command_envelope_submission_source || 'unknown';
  const commandEnvelopeSubmissionRoute = executionMetadata?.command_envelope_submission_route || 'unknown';
  const commandEnvelopeResponseMode = executionMetadata?.command_envelope_response_mode || chatContextResponseMode || 'direct-answer';
  const commandEnvelopeContextProvidersUsed = executionMetadata?.command_envelope_context_providers_used || contextProvidersUsed || 'none';
  const commandEnvelopeExecutionStatus = executionMetadata?.command_envelope_execution_status || executionMetadata?.execution_status || 'unknown';
  const commandEnvelopeActualProvider = routeBlockedBeforeProvider
    ? 'none'
    : (suppressStaleExecutionMetadata ? 'none' : (executionMetadata?.command_envelope_actual_provider || executionMetadata?.actual_provider_used || 'unknown'));
  const commandEnvelopeActualModel = routeBlockedBeforeProvider
    ? 'n/a'
    : (suppressStaleExecutionMetadata ? 'n/a' : (executionMetadata?.command_envelope_actual_model || executionMetadata?.model_used || 'unknown'));
  const commandEnvelopeProofStatus = executionMetadata?.command_envelope_proof_status || 'unknown';
  const commandEnvelopeUiRealityStatus = executionMetadata?.command_envelope_ui_reality_status || chatContextUiRealityStatus || 'UNKNOWN';
  const commandEnvelopeWarnings = executionMetadata?.command_envelope_warnings || (commandEnvelopeStatus === 'unavailable' ? 'command-envelope-missing' : 'none');

  const hostedBackendTargetGuidance = buildHostedBackendTargetGuidance({
    canonicalHostedRouteTruth,
    sessionKind,
    selectedRouteKind,
    selectedRouteReachableState: routeTruthView?.selectedRouteReachableState,
    routeUsableState: routeTruthView?.routeUsableState,
    backendReachableState: routeTruthView?.backendReachableState,
    cloudAvailable: runtimeStatus?.cloudAvailable,
    executableProvider,
    backendTargetInvalidReason: runtimeContext?.backendTargetInvalidReason,
    backendTargetResolvedUrl: runtimeContext?.backendTargetResolvedUrl,
    backendTargetResolutionSource: runtimeContext?.backendTargetResolutionSource,
    backendTargetFallbackUsed,
  });
  const routeDiagnosticsSummary = summarizeRouteDiagnostics(runtimeContext?.routeDiagnostics, {
    selectedRouteKind,
    routeCandidates: mergedRouteCandidates,
  });
  const localDesktopRuntimeDiagnostics = runtimeContext?.routeDiagnostics?.['local-desktop'];
  const localDesktopSummaryLine = Array.isArray(routeDiagnosticsSummary)
    ? routeDiagnosticsSummary.find((line) => line.startsWith('- local-desktop '))
    : '';
  const localDesktopCandidateForSummary = findLocalDesktopRouteCandidate(mergedRouteCandidates);
  const localDesktopCandidateStateUsedForSummary = asText(deriveRouteCandidateState(localDesktopCandidateForSummary), 'n/a');
  const localDesktopCandidateSource = healthProbeFreshAndOk && localDesktopSession
    ? 'health-probe-fresh'
    : (runtimeContextRouteCandidates.length > 0 ? 'stale-route-candidate' : 'none');
  const localDesktopCandidateHealthProbeApplied = healthProbeFreshAndOk && localDesktopSession ? 'yes' : 'no';
  const effectiveBackendAvailableSource = healthProbeFreshAndOk
    ? 'health-probe-fresh'
    : (safeApiStatus?.backendReachable === true ? 'safeApiStatus.backendReachable' : 'route-truth-view');
  const routeDiagnosticsCandidateReconciled = String(localDesktopSummaryLine || '').includes('local-desktop-candidate-summary-mismatch')
    ? 'yes'
    : 'no';
  const routeDiagnosticsSummarySource = healthProbeFreshAndOk && localDesktopSession
    ? 'health-probe-fresh/local-desktop-override'
    : runtimeTruthRouteCandidates.length > 0
      ? 'runtimeStatus.runtimeTruth.routeCandidates'
    : runtimeContextRouteCandidates.length > 0
      ? 'runtimeContext.routeCandidates'
      : 'routeDiagnostics-only';
  const effectiveRouteDiagnosticsSummary = hasMeaningfulDiagnostics(routeDiagnosticsSummary)
    ? routeDiagnosticsSummary
    : (hostedBackendTargetGuidance?.summary || routeDiagnosticsSummary);

  const cognitiveAdjudication = runtimeStatus?.cognitiveAdjudication && typeof runtimeStatus.cognitiveAdjudication === 'object'
    ? runtimeStatus.cognitiveAdjudication
    : {};
  const watcherSummary = cognitiveAdjudication.diagnosisSummary || {};
  const watcherTopPattern = Array.isArray(cognitiveAdjudication.patternMatches)
    ? cognitiveAdjudication.patternMatches[0]
    : null;

  const operatorGuidance = buildOperatorGuidanceProjection({
    finalRouteTruth: routeTruthView,
    orchestrationTruth,
    latestResponseEnvelope: orchestrationTruth?.latestResponseEnvelope || null,
  });
  const agentView = finalAgentView && typeof finalAgentView === 'object' ? finalAgentView : {};
  const selectedAgentId = asText(agentView?.selectedAgentId, 'none');
  const selectedAgent = Array.isArray(agentView.visibleAgents)
    ? agentView.visibleAgents.find((entry) => entry.agentId === selectedAgentId) || null
    : null;
  const selectedAgentGates = selectedAgent?.adjudicationGates && typeof selectedAgent.adjudicationGates === 'object'
    ? selectedAgent.adjudicationGates
    : {};
  const selectedAgentGateSummary = [
    `surface:${selectedAgentGates.surfaceGate?.passed === true ? 'pass' : selectedAgentGates.surfaceGate?.passed === false ? 'block' : 'unknown'}`,
    `session:${selectedAgentGates.sessionGate?.passed === true ? 'pass' : selectedAgentGates.sessionGate?.passed === false ? 'block' : 'unknown'}`,
    `dependency:${selectedAgentGates.dependencyGate?.passed === true ? 'pass' : selectedAgentGates.dependencyGate?.passed === false ? 'block' : 'unknown'}`,
    `autonomy:${selectedAgentGates.autonomyGate?.passed === true ? 'pass' : selectedAgentGates.autonomyGate?.passed === false ? 'block' : 'unknown'}`,
    `operator-enable:${selectedAgentGates.operatorEnableGate?.passed === true ? 'pass' : selectedAgentGates.operatorEnableGate?.passed === false ? 'block' : 'unknown'}`,
    `master-toggle:${selectedAgentGates.masterToggleGate?.passed === true ? 'pass' : selectedAgentGates.masterToggleGate?.passed === false ? 'block' : 'unknown'}`,
    `safe-mode:${selectedAgentGates.safeModeGate?.passed === true ? 'pass' : selectedAgentGates.safeModeGate?.passed === false ? 'block' : 'unknown'}`,
    `task-intent:${selectedAgentGates.taskIntentGate?.passed === true ? 'pass' : selectedAgentGates.taskIntentGate?.passed === false ? 'block' : 'unknown'}`,
    `provider-route:${selectedAgentGates.providerRouteGate?.passed === true ? 'pass' : selectedAgentGates.providerRouteGate?.passed === false ? 'block' : 'unknown'}`,
  ].join(' | ');
  const missionBridge = missionBridgeTruth && typeof missionBridgeTruth === 'object' ? missionBridgeTruth : {};
  const missionBridgeLastEvent = Array.isArray(missionBridge.events) && missionBridge.events.length > 0
    ? missionBridge.events[missionBridge.events.length - 1]
    : null;
  const uiRealityStatus = deriveUiRealityStatus({
    reality: uiReality,
    startupStatus: uiRealityStartupStatus || runtimeStatus?.appLaunchState || 'unknown',
  });
  const uiRealityReason = uiRealityStatus.failReasons[0] || uiRealityStatus.warnReasons[0] || 'healthy';
  const uiRealityDiagnosticsAvailable = uiReality && typeof uiReality === 'object' ? 'yes' : 'no';
  const uiRealityNextAction = uiRealityStatus.severity === 'FAIL'
    ? 'Fix UI reality failures before trusting pane controls.'
    : uiRealityStatus.severity === 'WARN'
      ? 'Capture/refresh UI diagnostics and re-copy snapshot.'
      : 'No operator action required.';

  const blockingIssues = (runtimeDiagnosticsTruth?.blockingIssues || []).map((issue) => issue?.detail || issue?.message || issue?.code || issue?.id || 'unknown');
  if (hostedBackendTargetGuidance?.blockingIssue) {
    const canonicalHostedMessages = Array.isArray(canonicalHostedRouteTruth?.blockingIssues)
      ? canonicalHostedRouteTruth.blockingIssues.map((issue) => issue?.message).filter(Boolean)
      : [];
    if (canonicalHostedMessages.length > 0) {
      blockingIssues.push(...canonicalHostedMessages);
    } else {
      blockingIssues.push(hostedBackendTargetGuidance.blockingIssue);
    }
  }
  const invariantWarnings = (runtimeDiagnosticsTruth?.invariantWarnings || [])
    .map((warning) => warning?.detail || warning?.message || warning?.code || warning?.id || 'unknown')
    .filter((warning) => !(hostedCloudCanonicalReady && isTileReadinessContradictionWarning(warning)));
  invariantWarnings.push(...deriveExecutionTruthInvariantWarnings(runtimeStatus));

  const guidanceItems = [];
  const operatorBoundary = buildOperatorBoundaryDiagnostics({
    routeTruthView,
    runtimeStatus,
    runtimeProviderTruth,
    sourceDistAlignment,
    runtimeContext,
  });
  if (routeTruthView?.operatorReason && routeTruthView.operatorReason !== 'n/a') {
    guidanceItems.push(routeTruthView.operatorReason);
  }
  if (runtimeContext?.restoreDecision && !hostedCloudCanonicalReady) {
    guidanceItems.push(runtimeContext.restoreDecision);
  }
  if (operatorBoundary.routeHealthyButBackendContractStale === 'yes') {
    guidanceItems.push('Route healthy; backend execution contract appears stale.');
    guidanceItems.push('Hosted route is up; backend handshake is the likely failing boundary.');
    guidanceItems.push('Rebuild/restart Battle Bridge before trusting provider execution.');
    if (operatorBoundary.selectedProviderRequestedButNotExecutable === 'yes') {
      guidanceItems.push('Route is healthy, but selected provider is not executable under current backend contract.');
    }
  }
  if (hostedBackendTargetGuidance?.operatorGuidance) {
    guidanceItems.push(hostedBackendTargetGuidance.operatorGuidance);
  }
  if (bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-revalidated') {
    if (bridgeTransportTruth?.bridgeMemoryReconciliationProvenance === 'remembered-tailscale-revalidated-as-tailscale') {
      guidanceItems.push('Remembered Tailscale bridge revalidated successfully; hosted route is using the remembered Tailscale home-node bridge.');
    } else {
      guidanceItems.push('Remembered Home Bridge revalidated successfully on this hosted surface.');
    }
    if (bridgeTransportTruth?.bridgeMemoryPromotedToRouteCandidate === true) {
      guidanceItems.push('Remembered bridge promoted into route candidates after successful current-surface validation.');
    }
  } else if (bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-unreachable') {
    guidanceItems.push('Remembered Home Bridge exists but is unreachable from this surface.');
    guidanceItems.push('Remembered bridge retained but not promoted while reachability fails on this surface.');
  } else if (bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-execution-incompatible') {
    guidanceItems.push('Remembered Home Bridge exists and may be directly reachable, but hosted execution is blocked by browser security policy (HTTPS frontend to HTTP bridge).');
    guidanceItems.push('Remembered bridge blocked by hosted/browser constraints and therefore not promoted.');
  } else if (bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-validation-failed') {
    guidanceItems.push('Remembered Home Bridge exists but failed validation and needs operator review.');
  } else if (bridgeTransportTruth?.bridgeMemoryReconciliationState === 'remembered-awaiting-validation') {
    if (bridgeTransportTruth?.bridgeMemoryTransport === 'tailscale'
      && bridgeTransportTruth?.bridgeAutoRevalidationState === 'probing') {
      if (bridgeTransportTruth?.bridgeMemoryReconciliationProvenance === 'remembered-tailscale-pending-transport-config') {
        guidanceItems.push('Remembered Tailscale bridge is loaded, but hosted transport configuration is not yet canonical/accepted; route remains non-usable until transport truth converges.');
      } else if (bridgeTransportTruth?.bridgeMemoryReconciliationProvenance === 'remembered-candidate-not-yet-accepted') {
        guidanceItems.push('Remembered Tailscale bridge candidate exists, but backend target candidate is not yet accepted on this hosted surface.');
      } else if (bridgeTransportTruth?.bridgeMemoryReconciliationProvenance === 'remembered-route-not-yet-usable') {
        guidanceItems.push('Remembered Tailscale backend target is accepted, but hosted final route is not yet using that target.');
      } else {
        guidanceItems.push('Remembered Tailscale bridge pending probe on this hosted surface; using remembered candidate until probe evidence resolves reachability.');
      }
    } else {
      guidanceItems.push('Remembered Home Bridge exists and is awaiting validation on this surface.');
    }
    if (bridgeTransportTruth?.bridgeAutoRevalidationState === 'backoff') {
      guidanceItems.push('Remembered bridge auto-validation entered bounded backoff after retry exhaustion; route remains blocked until operator retries revalidation or updates bridge transport target.');
    }
  }
  const hasBlockingIssues = blockingIssues.length > 0;
  const selectedRouteReachable = String(routeTruthView?.selectedRouteReachableState || '').trim().toLowerCase() === 'yes';
  const routeUsable = String(routeTruthView?.routeUsableState || '').trim().toLowerCase() === 'yes';
  const backendReachable = String(routeTruthView?.backendReachableState || '').trim().toLowerCase() === 'yes';
  const providerHealthy = ['READY', 'CONNECTED'].includes(String(routeTruthView?.providerState || '').trim().toUpperCase());
  const timeoutSource = String(runtimeStatus?.lastTimeoutPolicySource || '').trim();
  const timeoutTruthDegradedByRouteUsability = timeoutSource === 'frontend:api-runtime'
    && selectedRouteReachable
    && !routeUsable
    && backendReachable
    && providerHealthy;
  const timeoutTruthDegradationReason = timeoutTruthDegradedByRouteUsability
    ? 'frontend-timeout-fallback-persisted-while-route-usability-false'
    : 'n/a';
  if (hasBlockingIssues) {
    for (let i = guidanceItems.length - 1; i >= 0; i -= 1) {
      if (isNoOperatorActionGuidance(guidanceItems[i])) {
        guidanceItems.splice(i, 1);
      }
    }
  }
  if (blockingIssues.length === 0 && invariantWarnings.length === 0 && !hostedBackendTargetGuidance) {
    guidanceItems.push('No blocking route invariants detected.');
  }

  const asYesNoUnknown = (value) => {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    return 'unknown';
  };

  const mindRegistry = runtimeStatus?.aiMindRegistry || {};
  const mindSupport = mindRegistry?.supportSnapshot || {};


  const missionRepairLoop = buildMissionRepairLoopModel({
    missionId: runtimeStatus?.latestMissionId || executionMetadata?.mission_id,
    title: runtimeStatus?.missionTitle || 'Mission Repair Loop',
    objective: runtimeStatus?.missionObjective || 'Repair mission until acceptance criteria are proven.',
    currentAttempt: runtimeStatus?.missionRepairCurrentAttempt || executionMetadata?.mission_repair_current_attempt,
    maxAttempts: runtimeStatus?.missionRepairMaxAttempts || executionMetadata?.mission_repair_max_attempts || 3,
    acceptanceCriteria: runtimeStatus?.missionAcceptanceCriteria || [],
    forbiddenActions: runtimeStatus?.missionForbiddenActions || [],
    requiredProof: runtimeStatus?.missionRequiredProof || [],
    latestCodexSummary: runtimeStatus?.missionLatestCodexSummary || executionMetadata?.codex_handoff_summary,
    latestTestResults: runtimeStatus?.missionLatestTestResults || (runtimeStatus?.missionVerificationRequiredTestsRun === 'yes' ? 'pass' : 'fail'),
    latestBuildVerifyStatus: runtimeStatus?.missionLatestBuildVerifyStatus || (runtimeStatus?.missionVerificationProofStatus === 'passed' ? 'pass' : (runtimeStatus?.missionVerificationProofStatus === 'pending' ? 'fail' : runtimeStatus?.missionVerificationProofStatus)),
    missionVerificationReadinessLevel: runtimeStatus?.missionVerificationReadinessLevel,
    missionVerificationProofStatus: runtimeStatus?.missionVerificationProofStatus,
    latestSupportSnapshotStatus: {
      uiRealityStatus: uiRealityStatus.severity,
      acceptanceFieldsMatch: (runtimeStatus?.missionVerificationBlockerCount ?? 0) === 0,
      browserProofRequired: chatContextResponseMode === 'merge-decision' || responsePlannerProofRequired === 'yes',
      browserProofAvailable: uiRealityStatus.browserProof === 'available',
    },
    failingAcceptanceFields: String(runtimeStatus?.missionVerificationBlockingIssues || '').split('|').map((item) => item.trim()).filter(Boolean),
    sourceTruthsUsed: [
      'uiRealityStatus',
      'missionVerificationReadinessLevel',
      'missionVerificationProofStatus',
      'missionVerificationBlockerCount',
      'responsePlannerProofRequired',
      'chatContextResponseMode',
      'commandEnvelopeStatus',
      'prEvidenceProofStatus',
    ],
  });

  const prEvidenceParseInput = asText(
    executionMetadata?.pr_evidence_parse_input
      || executionMetadata?.command_envelope_pr_evidence_parse_input
      || runtimeStatus?.prEvidenceParseInput,
    'n/a',
  );
  const prEvidenceParsedNumberSource = asText(
    executionMetadata?.pr_evidence_parsed_number_source
      || executionMetadata?.command_envelope_pr_evidence_parsed_number_source
      || runtimeStatus?.prEvidenceParsedNumberSource,
    'none',
  );
  const prEvidenceProviderOutputNumber = asText(
    executionMetadata?.pr_evidence_provider_output_number
      || executionMetadata?.command_envelope_pr_evidence_provider_output_number
      || executionMetadata?.command_envelope_pr_evidence_parsed_pr_number
      || runtimeStatus?.prEvidenceProviderOutputNumber
      || runtimeStatus?.prEvidenceParsedPrNumber
      || runtimeStatus?.prEvidenceNumber,
    'n/a',
  );
  const prEvidenceFinalMetadataNumber = asText(
    executionMetadata?.github_pr_evidence_number
      || executionMetadata?.pr_evidence_parsed_pr_number
      || executionMetadata?.pr_evidence_number
      || executionMetadata?.command_envelope_pr_number
      || executionMetadata?.command_envelope_pr_evidence_parsed_pr_number
      || runtimeStatus?.prEvidenceParsedPrNumber
      || runtimeStatus?.prEvidenceNumber,
    'n/a',
  );
  const prFallback = derivePrFallbackFromOperatorText(executionMetadata, runtimeStatus);
  const providerNumberKnown = !isUnknownValue(prEvidenceProviderOutputNumber);
  const metadataNumberKnown = !isUnknownValue(prEvidenceFinalMetadataNumber);
  const resolvedPrEvidence = resolvePrEvidenceNumber(executionMetadata, runtimeStatus, prFallback);
  const resolvedPrEvidenceParseInput = !isUnknownValue(prEvidenceParseInput) ? prEvidenceParseInput : asText(prFallback.parseInput, 'n/a');
  const resolvedPrEvidenceParsedNumberSource = !isUnknownValue(prEvidenceParsedNumberSource) ? prEvidenceParsedNumberSource : asText(prFallback.source, 'none');
  const resolvedPrEvidenceFinalMetadataNumber = metadataNumberKnown ? prEvidenceFinalMetadataNumber : resolvedPrEvidence.prNumber;
  const githubPrEvidenceProjectionSource = asText(
    executionMetadata?.github_pr_evidence_projection_source
      || runtimeStatus?.githubPrEvidenceProjectionSource
      || (executionMetadata?.github_pr_evidence_number ? 'execution-metadata.github_pr_evidence_number' : '')
      || (executionMetadata?.command_envelope_pr_number ? 'execution-metadata.command_envelope_pr_number' : '')
      || (executionMetadata?.pr_evidence_parsed_pr_number ? 'execution-metadata.pr_evidence_parsed_pr_number' : '')
      || (!isUnknownValue(prFallback.prNumber) ? `execution-metadata.${prFallback.source}` : '')
      || (runtimeStatus?.githubPrEvidenceNumber ? 'runtimeStatus.githubPrEvidenceNumber' : '')
      || (runtimeStatus?.prEvidenceParsedPrNumber ? 'runtimeStatus.prEvidenceParsedPrNumber' : '')
      || 'none',
    'none',
  );
  const prEvidenceParsedPrNumberDisplay = resolvedPrEvidence.prNumber;
  const githubPrEvidenceNumberDisplay = resolvedPrEvidence.prNumber;
  const githubPrEvidenceProviderStatusDisplay = asText(
    runtimeStatus?.githubPrEvidenceProviderStatus
      || executionMetadata?.github_pr_evidence_provider_status
      || executionMetadata?.command_envelope_pr_evidence_status,
    'unavailable',
  );

  const githubTokenConfiguredDisplay = asText(
    runtimeStatus?.githubTokenConfigured
      || executionMetadata?.github_token_configured
      || executionMetadata?.command_envelope_github_token_configured,
    'no',
  );
  const githubTokenAuthorityDisplay = asText(
    runtimeStatus?.githubTokenAuthority
      || executionMetadata?.github_token_authority
      || executionMetadata?.command_envelope_github_token_authority,
    'none',
  );
  const githubTokenMaskedDisplay = asText(
    runtimeStatus?.githubTokenMasked
      || executionMetadata?.github_token_masked
      || executionMetadata?.command_envelope_github_token_masked,
    'n/a',
  );
  const githubTokenUpdatedAtDisplay = asText(
    runtimeStatus?.githubTokenUpdatedAt
      || executionMetadata?.github_token_updated_at
      || executionMetadata?.command_envelope_github_token_updated_at,
    'n/a',
  );



  const githubProjectionIntegrity = asText(runtimeStatus?.githubPrEvidenceProjectionIntegrity || executionMetadata?.github_pr_evidence_projection_integrity, 'complete');
  const githubEvidenceNextAction = githubProjectionIntegrity === 'incomplete'
    ? 'repair fetched evidence projection'
    : asText(runtimeStatus?.githubPrEvidenceNextAction, 'collect PR evidence');
  const githubEvidenceSourceDisplay = asText(runtimeStatus?.githubPrEvidenceSource || executionMetadata?.github_pr_evidence_source, 'none');
  const githubEvidenceRepoDisplay = asText(runtimeStatus?.githubPrEvidenceRepo || executionMetadata?.command_envelope_pr_repo, 'unknown');
  const githubEvidenceUrlDisplay = asText(runtimeStatus?.githubPrEvidenceUrl || executionMetadata?.command_envelope_pr_url, 'n/a');
  const githubEvidenceTitleDisplay = asText(runtimeStatus?.githubPrEvidenceTitle || executionMetadata?.github_pr_evidence_title, 'n/a');
  const githubEvidenceStateDisplay = asText(runtimeStatus?.githubPrEvidenceState || executionMetadata?.github_pr_evidence_state, 'unknown');
  const githubEvidenceMergedDisplay = asText(runtimeStatus?.githubPrEvidenceMerged || executionMetadata?.github_pr_evidence_merged, 'no');
  const githubEvidenceHeadShaDisplay = asText(runtimeStatus?.githubPrEvidenceHeadSha || executionMetadata?.command_envelope_pr_head_sha, 'n/a');
  const githubEvidenceChangedFileCountDisplay = asText(runtimeStatus?.githubPrEvidenceChangedFileCount || executionMetadata?.command_envelope_pr_changed_file_count, '0');
  const githubEvidenceChecksStatusDisplay = asText(runtimeStatus?.githubPrEvidenceChecksStatus || executionMetadata?.github_pr_evidence_checks_status, 'unknown');
  const githubEvidenceBuildStatusDisplay = asText(runtimeStatus?.githubPrEvidenceBuildStatus || executionMetadata?.github_pr_evidence_build_status, 'unknown');
  const githubEvidenceVerifyStatusDisplay = asText(runtimeStatus?.githubPrEvidenceVerifyStatus || executionMetadata?.github_pr_evidence_verify_status, 'unknown');
  const githubEvidenceRetrievedAtDisplay = asText(runtimeStatus?.githubPrEvidenceRetrievedAt || executionMetadata?.github_pr_evidence_retrieved_at, 'n/a');
  const lines = [
    'Stephanos Support Snapshot',
    `Timestamp: ${asText(now?.toISOString?.(), 'n/a')}`,
    `Origin: ${resolvedOrigin}`,
    `URL: ${resolvedUrl}`,
    `Launch State: ${asText(runtimeStatus?.appLaunchState)}`,
    `Route Mode: ${asText(runtimeStatus?.effectiveRouteMode)}`,
    `Requested Route Mode: ${asText(runtimeStatus?.requestedRouteMode)}`,
    `Session Kind: ${asText(canonicalTruth.sessionKind || runtimeSessionTruth?.sessionKind || runtimeStatus?.sessionKind)}`,
    `Device Context: ${asText(canonicalTruth.deviceContext || runtimeSessionTruth?.deviceContext || runtimeStatus?.deviceContext)}`,
    `Surface Device Class: ${asText(surfaceIdentity.deviceClass, 'unknown')}`,
    `Surface OS/Browser: ${asText(surfaceIdentity.osFamily, 'unknown')} / ${asText(surfaceIdentity.browserFamily, 'unknown')}`,
    `Surface Session Kind: ${asText(sessionSurfaceHints.sessionKind, 'unknown')}`,
    `Surface Embodiment Profile: ${asText(effectiveSurfaceExperience.selectedProfileId, 'generic-surface')}`,
    `Surface Selection Reasons: ${asText(Array.isArray(effectiveSurfaceExperience.selectionReasons) ? effectiveSurfaceExperience.selectionReasons.join(' | ') : 'n/a')}`,
    `Surface Active Protocols: ${asText(Array.isArray(effectiveSurfaceExperience.activeProtocolIds) ? effectiveSurfaceExperience.activeProtocolIds.join(', ') : 'n/a')}`,
    `Surface Protocol Reasons: ${asText(Array.isArray(effectiveSurfaceExperience.protocolSelectionReasons) ? effectiveSurfaceExperience.protocolSelectionReasons.join(' | ') : 'n/a')}`,
    `Surface Override Mode: ${asText(surfaceAwareness.operatorSurfaceOverrides?.mode, 'auto')}`,
    `Surface Input/Panel Bias: ${asText(effectiveSurfaceExperience.resolvedInputMode, 'hybrid')} / ${asText(effectiveSurfaceExperience.resolvedPanelMode || effectiveSurfaceExperience.resolvedPanelStrategy, 'stacked-docked')}`,
    `Surface Policy Density/Animation: ${asText(effectiveSurfaceExperience.resolvedUiDensity, 'comfortable')} / ${asText(effectiveSurfaceExperience.resolvedAnimationBudget, 'medium')}`,
    `Surface Policy Debug/Telemetry: ${asText(effectiveSurfaceExperience.resolvedDebugVisibility, 'balanced')} / ${asText(effectiveSurfaceExperience.resolvedTelemetryDensity, 'medium')}`,
    `Surface Routing Bias Hint: ${asText(effectiveSurfaceExperience.resolvedRoutingBiasHint, 'auto')}`,
    `Surface Capability Hints: touchPrimary=${asText(surfaceCapabilities.touchPrimary)} hoverReliable=${asText(surfaceCapabilities.hoverReliable)} finePointer=${asText(surfaceCapabilities.finePointer)} webxr=${asText(surfaceCapabilities.webxrAvailable)}`,
    `Surface Friction Recent Count: ${String(recentFrictionEvents.length)}`,
    `Surface Friction Latest: ${latestFriction ? `${asText(latestFriction.frictionType)} (${asText(latestFriction.subsystem)}) confidence=${asText(latestFriction.confidence)}` : 'n/a'}`,
    `Surface Friction Pattern Count: ${String(detectedFrictionPatterns.length)}`,
    `Surface Friction Pattern Latest: ${latestPattern ? `${asText(latestPattern.frictionType)} strength=${asText(latestPattern.patternStrength)} recurrence=${asText(latestPattern.recurrenceCount)}` : 'n/a'}`,
    `Surface Active Recommendations: ${String(surfaceProtocolRecommendations.filter((entry) => entry.status !== 'rejected').length)}`,
    `Surface Accepted Rules: ${String(acceptedSurfaceRules.length)}`,
    `System Watcher Status: ${asText(watcherSummary.status, 'stable')}`,
    `System Watcher Headline: ${asText(watcherSummary.headline, 'No high-confidence contradiction pattern detected.')}`,
    `System Watcher Failing Layer: ${asText(watcherSummary.likelyFailingLayer, 'none-detected')}`,
    `System Watcher Contradictions: ${asText(watcherSummary.contradictionCount, '0')}`,
    `System Watcher Top Pattern: ${asText(watcherTopPattern?.patternId, 'none')}`,
    `System Watcher Persistence: ${asText(watcherSummary.persistenceClassification || cognitiveAdjudication.temporalSignal?.persistenceClassification, 'insufficient-evidence')}`,
    `System Watcher Temporal Confidence: ${asText(watcherSummary.temporalConfidence || cognitiveAdjudication.temporalSignal?.temporalConfidence, 'limited')}`,
    `System Watcher Recurring Families: ${asText(Array.isArray(cognitiveAdjudication.temporalSignal?.transitionBackedEvidence?.recurringFamilies) ? cognitiveAdjudication.temporalSignal.transitionBackedEvidence.recurringFamilies.map((entry) => `${asText(entry.family)}x${asText(entry.recurrences, '1')}`).join(', ') : '', 'none')}`,
    `System Watcher Timeout Hypothesis: ${asText(cognitiveAdjudication.contradictions?.find((entry) => entry.family === 'timeout-derivation-drift')?.interpretation, 'none-detected')}`,
    `System Watcher Projection Mismatch: ${asText(cognitiveAdjudication.contradictions?.find((entry) => entry.family === 'ui-truth-projection-mismatch')?.title, 'none-detected')}`,
    `System Watcher Likely Repair Boundary: ${asText(cognitiveAdjudication.rootCauseCandidates?.[0]?.likelyRepairBoundary?.subsystem, 'none-detected')}`,
    `UI Reality Status: ${asText(uiRealityStatus.severity, 'UNKNOWN')}`,
    `Mission Repair Loop Status: ${asText(missionRepairLoop.status, 'idle')}`,
    `Mission Repair Loop Current Attempt: ${asText(missionRepairLoop.currentAttempt, '0')}`,
    `Mission Repair Loop Max Attempts: ${asText(missionRepairLoop.maxAttempts, '0')}`,
    `Mission Repair Loop Failing Acceptance Fields: ${asText(missionRepairLoop.failingAcceptanceFields.join(' | ') || 'none')}`,
    `Mission Repair Loop Latest Proof State: ${asText(missionRepairLoop.latestBuildVerifyStatus, 'unknown')}/${asText(missionRepairLoop.latestTestResults, 'unknown')}/${asText(missionRepairLoop.latestSupportSnapshotStatus?.uiRealityStatus, 'UNKNOWN')}`,
    `Mission Repair Loop Merge Recommendation: ${asText(missionRepairLoop.mergeRecommendation, 'hold')}`,
    `Mission Repair Loop Next Action: ${asText(missionRepairLoop.nextPrompt, 'collect proof')}`,
    `Mission Repair Loop Operator Decision Required: ${missionRepairLoop.operatorDecisionRequired ? 'yes' : 'no'}`,
    `Mission Repair Loop Codex Prompt Available: ${missionRepairLoop.codexPromptAvailable ? 'yes' : 'no'}`,
    `Mission Repair Loop Codex Prompt Summary: ${asText(missionRepairLoop.codexPromptSummary, 'n/a')}`,
    `Mission Repair Loop Repair Boundary: ${asText(missionRepairLoop.repairBoundary, 'n/a')}`,
    `Mission Repair Loop Required Tests: ${asText(missionRepairLoop.requiredProof.join(' | ') || 'none')}`,
    `Mission Repair Loop Forbidden Actions: ${asText(missionRepairLoop.forbiddenActions.join(' | ') || 'none')}`,
    `Operator Cockpit Projection Status: ${operatorCockpitProjection?.projectionId ? 'available' : 'unavailable'}`,
    `Operator Cockpit Projection Source: ${operatorCockpitProjectionSourceDisplay}`,
    `Operator Cockpit Current Mission: ${asText(operatorCockpitProjection.currentMission, 'Current Stephanos mission')}`,
    `Operator Cockpit Current Status: ${asText(operatorCockpitProjection.currentStatus, 'unknown')}`,
    `Operator Cockpit Accepted Proof: ${asText((operatorCockpitProjection.acceptedProof || []).join('|') || 'none')}`,
    `Operator Cockpit Missing Proof: ${asText((operatorCockpitProjection.missingProof || []).join('|') || 'none')}`,
    `Operator Cockpit Missing Proof Count: ${String(operatorCockpitProjection.missingProofCount ?? 0)}`,
    `Operator Cockpit Next Best Action: ${asText(operatorCockpitProjection.nextBestAction, 'Collect runtime proof.')}`,
    `Operator Cockpit Merge Safety: ${asText(operatorCockpitProjection.mergeSafety, 'no / hold')}`,
    `Operator Cockpit OpenClaw Mutation Locked: ${operatorCockpitProjection.openClawMutationLockState === 'locked' ? 'yes' : 'no'}`,
    `Operator Cockpit Codex Auto Dispatch Allowed: ${operatorCockpitProjection.codexMutationLockState === 'dispatch-allowed' ? 'yes' : 'no'}`,
    `Operator Cockpit Last Intake Status: ${asText(operatorCockpitProjection.evidenceIntakeState || operatorCockpitProjection.lastCommandDeckIntakeResult, 'unavailable')}`,
    `Operator Cockpit Recommended Surface: ${asText(operatorCockpitProjection.recommendedSurface, 'Command Deck')}`,
    `Operator Cockpit Recommended Packet: ${asText(operatorCockpitProjection.recommendedPacket, 'proof-collection-packet')}`,
    `Cockpit Action Routing Status: ${cockpitActionModel.cockpitActionStatus}`,
    `Cockpit Primary Action Label: ${asText(cockpitActionModel.cockpitPrimaryActionLabel, 'unavailable')}`,
    `Cockpit Primary Action Kind: ${asText(cockpitActionModel.cockpitPrimaryActionKind, 'unavailable')}`,
    `Cockpit Primary Action Target Surface: ${asText(cockpitActionModel.cockpitPrimaryActionTargetSurface, 'unavailable')}`,
    `Cockpit Primary Action Target Pane ID: ${asText(cockpitActionModel.cockpitPrimaryActionTargetPaneId, 'unavailable')}`,
    `Cockpit Primary Action Target Packet ID: ${asText(cockpitActionModel.cockpitPrimaryActionTargetPacketId, 'unavailable')}`,
    `Cockpit Primary Action Source: ${cockpitActionModel.cockpitActionSource}`,
    `Cockpit Primary Action Mutation Allowed: ${cockpitActionModel.cockpitActionMutationAllowed}`,
    `Cockpit Primary Action Operator Approval Required: ${cockpitActionModel.cockpitActionRequiresOperatorApproval}`,
    `Cockpit Last Action Clicked: ${asText(lastCockpitAction.clicked, 'no')}`,
    `Cockpit Last Action Clicked At: ${asText(lastCockpitAction.clickedAt, 'never')}`,
    `Cockpit Last Action Source Button: ${asText(lastCockpitAction.sourceButton, 'none')}`,
    `Cockpit Last Action Handler Invoked: ${asText(lastCockpitAction.handlerInvoked, 'no')}`,
    `Cockpit Last Action Handler Owner: ${asText(lastCockpitAction.handlerOwner, 'none')}`,
    `Cockpit Last Action Target Resolved: ${asText(lastCockpitAction.targetResolved, 'no')}`,
    `Cockpit Last Action Target Pane ID: ${asText(lastCockpitAction.targetPaneId, 'unavailable')}`,
    `Cockpit Last Action Target Selector: ${asText(lastCockpitAction.targetSelector, 'unavailable')}`,
    `Cockpit Last Action Target Found: ${asText(lastCockpitAction.targetFound, 'no')}`,
    `Cockpit Last Action Focus Applied: ${asText(lastCockpitAction.focusApplied, 'no')}`,
    `Cockpit Last Action Scroll Applied: ${asText(lastCockpitAction.scrollApplied, 'no')}`,
    `Cockpit Last Action Highlight Applied: ${asText(lastCockpitAction.highlightApplied, 'no')}`,
    `Cockpit Last Action Mutation Attempted: ${asText(lastCockpitAction.mutationAttempted, 'no')}`,
    `Cockpit Last Action Result: ${asText(lastCockpitAction.result, 'not-clicked')}`,
    `Cockpit Last Action Failure Reason: ${asText(lastCockpitAction.failureReason, 'none')}`,
    `Cockpit Action Uses Canonical Projection: yes`,
    `Cockpit Action Rendered Text Used For Routing: no`,
    `Landing Cockpit Tile Present: ${cockpitDomProof.landingPresent}`,
    `Landing Cockpit Tile Expected In Current Surface: ${cockpitDomProof.landingExpected}`,
    `Landing Cockpit Tile Mount Status: ${cockpitDomProof.landingMountStatus}`,
    `Landing Cockpit Tile Projection Source: ${cockpitDomProof.landingPresent === 'yes' ? cockpitDomProof.landingProjectionSource : operatorCockpitProjectionSourceDisplay}`,
    `Landing Cockpit Tile Render Signature: ${cockpitDomProof.landingPresent === 'yes' ? cockpitDomProof.landingRenderSignature : operatorCockpitRenderSignature}`,
    `Landing Cockpit Tile Text Density: ${cockpitDomProof.landingTileTextDensity}`,
    `Landing Cockpit Tile Text Bloat Detected: ${cockpitDomProof.landingTileTextBloatDetected}`,
    `Landing Cockpit Tile Visible Detail Field Count: ${cockpitDomProof.landingTileVisibleDetailFieldCount}`,
    `Landing Cockpit Tile Shortcut Role Preserved: ${cockpitDomProof.landingTileShortcutRolePreserved}`,
    `Landing Cockpit First Content Block Kind: ${cockpitDomProof.landingFirstContentBlockKind}`,
    `Landing Cockpit Primary Visual Position: ${cockpitDomProof.landingPrimaryVisualPosition}`,
    `Expanded Cockpit Pane Present: ${cockpitDomProof.expandedPresent}`,
    `Expanded Cockpit Pane Expected In Current Surface: ${cockpitDomProof.expandedExpected}`,
    `Expanded Cockpit Pane Mount Status: ${cockpitDomProof.expandedMountStatus}`,
    `Expanded Cockpit Pane Projection Source: ${cockpitDomProof.expandedPresent === 'yes' ? cockpitDomProof.expandedProjectionSource : operatorCockpitProjectionSourceDisplay}`,
    `Expanded Cockpit Pane Render Signature: ${cockpitDomProof.expandedPresent === 'yes' ? cockpitDomProof.expandedRenderSignature : operatorCockpitRenderSignature}`,
    `Cockpit Surface Drift Detected: ${cockpitDomProof.surfaceDriftDetected === 'unknown' ? 'no' : cockpitDomProof.surfaceDriftDetected}`,
    `Cockpit Surface Drift Reason: ${cockpitDomProof.surfaceDriftDetected === 'unknown' ? 'live-dom-unavailable; canonical projection signature=' + operatorCockpitRenderSignature : cockpitDomProof.surfaceDriftReason}`,
    `Operator Cockpit Visual Present: ${cockpitDomProof.operatorVisualPresent === 'no' ? 'yes' : cockpitDomProof.operatorVisualPresent}`,
    `Operator Cockpit Primary Visual Present: ${cockpitDomProof.operatorVisualPresent === 'no' ? 'yes' : cockpitDomProof.operatorVisualPresent}`,
    `Operator Cockpit Primary Dashboard Present: ${cockpitDomProof.operatorPrimaryDashboardPresent}`,
    `Operator Cockpit Primary Dashboard Position: ${cockpitDomProof.operatorPrimaryDashboardPosition}`,
    `Operator Cockpit Primary Visual Label: ${cockpitDomProof.operatorPrimaryVisualLabel}`,
    `Operator Cockpit First Content Block Kind: ${cockpitDomProof.operatorFirstContentBlockKind}`,
    `Operator Cockpit First Substantial Block Kind: ${cockpitDomProof.operatorFirstContentBlockKind}`,
    `Operator Cockpit First Content Block Label: ${cockpitDomProof.operatorFirstContentBlockLabel}`,
    `Operator Cockpit First Substantial Block Label: ${cockpitDomProof.operatorFirstContentBlockLabel}`,
    `Expanded Cockpit First Content Block Kind: ${cockpitDomProof.expandedFirstContentBlockKind}`,
    `Expanded Cockpit First Substantial Block Kind: ${cockpitDomProof.expandedFirstContentBlockKind}`,
    `Expanded Cockpit Primary Visual Position: ${cockpitDomProof.expandedPrimaryVisualPosition}`,
    `Expanded Cockpit Primary Dashboard Position: ${cockpitDomProof.expandedPrimaryVisualPosition}`,
    `Expanded Cockpit Summary Readout Position: ${cockpitDomProof.expandedSummaryReadoutPosition}`,
    `Expanded Cockpit Detail Text Position: ${cockpitDomProof.expandedDetailTextPosition}`,
    `Expanded Cockpit Route Topology Position: ${cockpitDomProof.expandedRouteTopologyPosition}`,
    `Cockpit Visual Layout Verdict: ${cockpitDomProof.cockpitVisualLayoutVerdict}`,
    `Cockpit Visual Layout Failure Reason: ${cockpitDomProof.cockpitVisualLayoutFailureReason}`,
    `Cockpit Visual Hierarchy Verdict: ${cockpitDomProof.cockpitVisualHierarchyVerdict}`,
    `Cockpit Visual Hierarchy Failure Reason: ${cockpitDomProof.cockpitVisualHierarchyFailureReason}`,
    `Operator Cockpit Layout Density: ${cockpitDomProof.operatorCockpitLayoutDensity}`,
    `Operator Cockpit Empty Space Warning: ${cockpitDomProof.operatorCockpitEmptySpaceWarning}`,
    `Expanded Cockpit Detail Grid Present: ${cockpitDomProof.expandedDetailGridPresent}`,
    `Expanded Cockpit Detail Card Count: ${cockpitDomProof.expandedDetailCardCount}`,
    `Expanded Cockpit Proof Chips Present: ${cockpitDomProof.expandedProofChipsPresent}`,
    `Expanded Cockpit Collapsed Empty Fields Count: ${cockpitDomProof.expandedCollapsedEmptyFieldsCount}`,
    `Expanded Cockpit Debug Collapsed By Default: ${cockpitDomProof.expandedDebugCollapsedByDefault}`,
    `Expanded Cockpit Layout Density Verdict: ${cockpitDomProof.expandedLayoutDensityVerdict}`,
    `Expanded Cockpit Layout Density Failure Reason: ${cockpitDomProof.expandedLayoutDensityFailureReason}`,
    `Operator Cockpit Visual Position: ${cockpitDomProof.operatorVisualPosition === 'unknown' ? 'before-text' : cockpitDomProof.operatorVisualPosition}`,
    `Landing Cockpit Visual Present: ${cockpitDomProof.landingVisualPresent === 'no' ? 'yes' : cockpitDomProof.landingVisualPresent}`,
    `Landing Cockpit Visual Position: ${cockpitDomProof.landingVisualPosition === 'unknown' ? 'before-text' : cockpitDomProof.landingVisualPosition}`,
    `Expanded Cockpit Visual Present: ${cockpitDomProof.expandedVisualPresent === 'no' ? 'yes' : cockpitDomProof.expandedVisualPresent}`,
    `Expanded Cockpit Visual Position: ${cockpitDomProof.expandedVisualPosition === 'unknown' ? 'before-text' : cockpitDomProof.expandedVisualPosition}`,
    `Cockpit Visual Projection Source: ${cockpitDomProof.visualProjectionSource}`,
    `Cockpit Visual/Text Drift Detected: ${cockpitDomProof.visualTextDriftDetected === 'unknown' ? 'no' : cockpitDomProof.visualTextDriftDetected}`,
    `Cockpit Visual/Text Drift Reason: ${cockpitDomProof.visualTextDriftDetected === 'unknown' ? 'live-dom-unavailable; canonical projection signature=' + operatorCockpitRenderSignature : cockpitDomProof.visualTextDriftReason}`,
    `Operator Cockpit Animation Enabled: ${cockpitDomProof.animationEnabled}`,
    `Operator Cockpit Animation Mode: ${cockpitDomProof.animationMode}`,
    `Operator Cockpit Animated Elements: ${cockpitDomProof.animatedElements}`,
    `Operator Cockpit Animation Truth Impact: ${cockpitDomProof.animationTruthImpact}`,
    `Operator Cockpit Reduced Motion Respected: ${cockpitDomProof.reducedMotionRespected}`,
    `Mission Repair Loop Proof Fields Required: ${asText(missionRepairLoop.proofFieldsRequired.join(' | ') || 'none')}`,
    `Mission Repair Loop Operator Approval Required: ${missionRepairLoop.codexPromptAvailable ? 'yes' : 'no'}`,
    `Mission Repair Loop Source Truths Used: ${asText(missionRepairLoop.sourceTruthsUsed.join(' | ') || 'unknown')}`,
    `Mission Repair Codex Bridge Status: ${asText(runtimeStatus?.missionRepairCodexBridgeStatus, 'not-required')}`,
    `Mission Repair Codex Bridge Packet Created: ${asText(runtimeStatus?.missionRepairCodexBridgePacketCreated, 'no')}`,
    `Mission Repair Codex Bridge Packet ID: ${asText(runtimeStatus?.missionRepairCodexBridgePacketId, 'none')}`,
    `Mission Repair Codex Bridge Reason: ${asText(runtimeStatus?.missionRepairCodexBridgeReason, 'n/a')}`,
    `Mission Repair Codex Bridge Failing Fields: ${asText(runtimeStatus?.missionRepairCodexBridgeFailingFields, 'none')}`,
    `Mission Repair Codex Bridge Next Action: ${asText(runtimeStatus?.missionRepairCodexBridgeNextAction, 'Await operator approval before Codex handoff')}`,
    `Codex Dispatch Packet Status: ${asText(runtimeStatus?.codexDispatchPacketStatus || executionMetadata?.command_envelope_codex_dispatch_status, 'not-ready')}`,
    `Codex Dispatch Packet ID: ${asText(runtimeStatus?.codexDispatchPacketId || executionMetadata?.command_envelope_codex_dispatch_packet_id, 'none')}`,
    `Codex Dispatch Mission Title: ${asText(runtimeStatus?.codexDispatchMissionTitle, 'n/a')}`,
    `Codex Dispatch Target Subsystems: ${asText(runtimeStatus?.codexDispatchTargetSubsystems || executionMetadata?.command_envelope_codex_dispatch_target_subsystems, 'none')}`,
    `Codex Dispatch Approval Required: ${asText(runtimeStatus?.codexDispatchApprovalRequired || executionMetadata?.command_envelope_codex_dispatch_approval_required, 'yes')}`,
    `Codex Dispatch Approval State: ${asText(runtimeStatus?.codexDispatchApprovalState, 'pending-operator-approval')}`,
    `Codex Dispatch Blocker Count: ${asText(runtimeStatus?.codexDispatchBlockerCount, '0')}`,
    `Codex Dispatch Warning Count: ${asText(runtimeStatus?.codexDispatchWarningCount, '0')}`,
    `Codex Dispatch Prompt Available: ${asText(runtimeStatus?.codexDispatchPromptAvailable, 'no')}`,
    `Codex Dispatch Next Action: ${asText(runtimeStatus?.codexDispatchNextAction, 'Await operator approval before any Codex handoff.')}`,
    `Mission Repair Loop Duplicate Authority Detected: ${asText(missionRepairLoop.duplicateAuthorityDetected, 'yes')}`,
    `UI Reality Reason: ${asText(uiRealityReason, 'unknown')}`,
    `UI Reality Browser Proof State: ${asText(uiRealityStatus.browserProof, 'unknown')}`,
    `UI Reality Pane Shell Count: ${asText(uiRealityStatus.paneShells, 'unknown')}`,
    `UI Reality Missing Collapse Controls: ${asText(uiRealityStatus.missingCollapseControls, 'unknown')}`,
    `UI Reality Missing Collapse Control IDs: ${asText(Array.isArray(uiRealityStatus.missingCollapseControlIds) && uiRealityStatus.missingCollapseControlIds.length > 0 ? uiRealityStatus.missingCollapseControlIds.join(', ') : 'none')}`,
    `UI Reality Missing Collapse Control Titles: ${asText(Array.isArray(uiRealityStatus.missingCollapseControlTitles) && uiRealityStatus.missingCollapseControlTitles.length > 0 ? uiRealityStatus.missingCollapseControlTitles.join(' | ') : 'none')}`,
    `UI Reality Move Control Status: ${asText(uiRealityStatus.moveControlStatus, 'unknown')}`,
    `UI Reality Arrange Mode: ${asText(uiRealityStatus.arrangeMode, 'unknown')}`,
    `UI Reality Move Control Detail State: ${asText(uiRealityStatus.moveControlDetailState, 'unknown')}`,
    `UI Reality Move Controls Visible: ${asText(uiRealityStatus.totalMoveControlsVisible, 'unknown')}`,
    `UI Reality Move Control Next Action: ${uiRealityStatus.moveControlStatus === 'intentionally-hidden' ? 'Enable Arrange Mode to reorder panes.' : uiRealityStatus.moveControlStatus === 'visible' ? 'No operator action required.' : 'Capture/refresh UI diagnostics and verify in-pane move controls.'}`,
    `UI Reality Panes Missing Move Controls: ${asText(Array.isArray(uiRealityStatus.panesMissingMoveControls) && uiRealityStatus.panesMissingMoveControls.length > 0 ? uiRealityStatus.panesMissingMoveControls.join(', ') : 'none')}`,
    `UI Reality Orphan Move Control Count: ${asText(uiRealityStatus.orphanMoveControls, 'unknown')}`,
    `UI Reality Duplicate Move Control Count: ${asText(uiRealityStatus.duplicateMoveControls, 'unknown')}`,
    `UI Reality Source/Dist Alignment: ${asText(uiRealityStatus.sourceDist, 'unknown')}`,
    `UI Reality Pane Layout Status: ${asText(uiRealityStatus.layoutStatus, 'unknown')}`,
    `UI Reality Copy Button Status: ${asText(uiRealityStatus.copyButtonStatus, 'unknown')}`,
    `UI Reality Copy Feedback Status: ${asText(uiRealityStatus.copyFeedbackStatus, 'UNKNOWN')}`,
    `UI Reality Copy Success Count: ${asText(uiRealityStatus.copySuccessCount, '0')}`,
    `UI Reality Copy Failure Count: ${asText(uiRealityStatus.copyFailureCount, '0')}`,
    `UI Reality Last Copy Result: ${asText(uiRealityStatus.lastCopyResult, 'none')}`,
    `UI Reality Last Copy Source: ${asText(uiRealityStatus.lastCopySource, 'none')}`,
    `UI Reality Green Success Confirmed Count: ${asText(uiRealityStatus.greenSuccessConfirmedCount, '0')}`,
    `UI Reality Copy Buttons Detected: ${asText(uiRealityStatus.copyButtonsDetected, 'unknown')}`,
    `UI Reality Canonical Copy Buttons: ${asText(uiRealityStatus.canonicalCopyButtons, '0')}`,
    `UI Reality Non-Canonical Copy Buttons: ${asText(uiRealityStatus.nonCanonicalCopyButtons, '0')}`,
    `UI Reality Copy Feedback Next Action: ${asText(uiRealityStatus.copyFeedbackNextAction, 'Capture copy diagnostics.')}`,
    `UI Reality Agent Mission Console Outer Collapse Status: ${asText(uiRealityStatus.agentMissionConsoleOuterCollapse, 'unknown')}`,
    `UI Reality AI Core Mission Console Configured: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleConfigured, 'no')}`,
    `UI Reality AI Core Mission Console Panel ID: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsolePanelId, 'unknown')}`,
    `UI Reality AI Core Mission Console Rendered: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleRendered, 'no')}`,
    `UI Reality AI Core Mission Console Visible: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleVisible, 'no')}`,
    `UI Reality AI Core Mission Console Render Reason: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleRenderReason, 'unknown')}`,
    `UI Reality AI Core Mission Console Visibility Reason: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleVisibilityReason, 'unknown')}`,
    `UI Reality AI Core Mission Console DOM Parent Pane ID: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleDomParentPaneId, 'unknown')}`,
    `UI Reality AI Core Mission Console DOM Parent Pane Title: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleDomParentPaneTitle, 'unknown')}`,
    `UI Reality AI Core Mission Console Inside Agent Mission Console: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleInsideAgentMissionConsole, 'unknown')}`,
    `UI Reality AI Core Mission Console DOM Ancestry Path: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleDomAncestryPath, 'unknown')}`,
    `UI Reality AI Core Mission Console Placement Reason: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsolePlacementReason, 'unknown')}`,
    `UI Reality AI Core Active Path: ${asText(uiRealityStatus.uiRealityAiCoreActivePath, 'unknown')}`,
    `UI Reality AI Core Rendered Pane Order Contains AI Console: ${asText(uiRealityStatus.uiRealityAiCoreRenderedPaneOrderContainsAiConsole, 'unknown')}`,
    `UI Reality AI Chat Command Deck Present: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckPresent, 'no')}`,
    `UI Reality AI Chat Command Deck Pane ID: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckPaneId, 'missing')}`,
    `UI Reality AI Chat Command Deck Pane Title: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckPaneTitle, 'missing')}`,
    `UI Reality AI Chat Command Deck Order Key: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckOrderKey, 'commandDeck')}`,
    `UI Reality AI Chat Command Deck In Pane Order: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckInPaneOrder, 'no')}`,
    `UI Reality Rendered Pane Order: ${asText(Array.isArray(uiRealityStatus.uiRealityRenderedPaneOrder) && uiRealityStatus.uiRealityRenderedPaneOrder.length > 0 ? uiRealityStatus.uiRealityRenderedPaneOrder.join(', ') : 'none')}`,
    `UI Reality Canonical Pane Order Source: ${asText(uiRealityStatus.uiRealityCanonicalPaneOrderSource, 'unknown')}`,
    `UI Reality Command Deck Order Detection Source: ${asText(uiRealityStatus.uiRealityCommandDeckOrderDetectionSource, 'unknown')}`,
    `UI Reality AI Chat Command Deck Found In DOM Order: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckFoundInDomOrder, 'no')}`,
    `UI Reality AI Chat Command Deck Found In State Order: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckFoundInStateOrder, 'no')}`,
    `UI Reality AI Chat Command Deck Visible: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckVisible, 'no')}`,
    `UI Reality AI Chat Command Deck Move Controls Visible: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckMoveControlsVisible, 'no')}`,
    `UI Reality AI Chat Command Deck Can Move Up: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckCanMoveUp, 'no')}`,
    `UI Reality AI Chat Command Deck Can Move Down: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckCanMoveDown, 'no')}`,
    `UI Reality AI Chat Command Deck Last Move Result: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckLastMoveResult, 'unknown')}`,
    `UI Reality AI Chat Command Deck Move Status: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckMoveStatus, 'UNKNOWN')}`,
    `UI Reality AI Chat Command Deck Placement Status: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckPlacementStatus, 'WARN')}`,
    `UI Reality AI Chat Command Deck Next Action: ${asText(uiRealityStatus.uiRealityAiChatCommandDeckNextAction, 'Capture UI reality diagnostics to validate command deck pane placement.')}`,
    `UI Reality Dedicated Mission Console Rendered: ${asText(uiRealityStatus.uiRealityDedicatedMissionConsoleRendered, 'no')}`,
    `UI Reality Dedicated Mission Console Visible: ${asText(uiRealityStatus.uiRealityDedicatedMissionConsoleVisible, 'no')}`,
    `UI Reality Dedicated Mission Console Visibility Reason: ${asText(uiRealityStatus.uiRealityDedicatedMissionConsoleVisibilityReason, 'unknown')}`,
    `UI Reality Mission Console Multi-Surface Status: ${asText(uiRealityStatus.uiRealityMissionConsoleMultiSurfaceStatus, 'WARN')}`,
    `UI Reality Mission Console Next Action: ${asText(uiRealityStatus.uiRealityMissionConsoleNextAction, 'Capture UI reality diagnostics to validate Mission Console multi-surface mount.')}`,
    `UI Reality Mission Console Pane IDs: ${asText(Array.isArray(uiRealityStatus.uiRealityMissionConsolePaneIds) && uiRealityStatus.uiRealityMissionConsolePaneIds.length > 0 ? uiRealityStatus.uiRealityMissionConsolePaneIds.join(', ') : 'none')}`,
    `UI Reality Mission Console Pane Titles: ${asText(Array.isArray(uiRealityStatus.uiRealityMissionConsolePaneTitles) && uiRealityStatus.uiRealityMissionConsolePaneTitles.length > 0 ? uiRealityStatus.uiRealityMissionConsolePaneTitles.join(' | ') : 'none')}`,
    `UI Reality Duplicate Pane Titles: ${asText(Array.isArray(uiRealityStatus.uiRealityDuplicatePaneTitles) && uiRealityStatus.uiRealityDuplicatePaneTitles.length > 0 ? uiRealityStatus.uiRealityDuplicatePaneTitles.join(' | ') : 'none')}`,
    `UI Reality Mission Console Identity Status: ${asText(uiRealityStatus.uiRealityMissionConsoleIdentityStatus, 'WARN')}`,
    `UI Reality Mission Console Identity Next Action: ${asText(uiRealityStatus.uiRealityMissionConsoleIdentityNextAction, 'Capture UI reality diagnostics to validate mission console pane identity.')}`,
    `UI Reality Operational Pane Placement Status: ${asText(uiRealityStatus.uiRealityOperationalPanePlacementStatus, 'WARN')}`,
    `UI Reality Agent Mission Console Nested Operational Pane Count: ${asText(uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneCount, '0')}`,
    `UI Reality Agent Mission Console Nested Operational Pane IDs: ${asText(Array.isArray(uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneIds) && uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneIds.length > 0 ? uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneIds.join(', ') : 'none')}`,
    `UI Reality Agent Mission Console Nested Operational Pane Titles: ${asText(Array.isArray(uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneTitles) && uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneTitles.length > 0 ? uiRealityStatus.uiRealityAgentMissionConsoleNestedOperationalPaneTitles.join(' | ') : 'none')}`,
    `UI Reality Deferred Extraction Pane IDs: ${asText(Array.isArray(uiRealityStatus.uiRealityDeferredExtractionPaneIds) && uiRealityStatus.uiRealityDeferredExtractionPaneIds.length > 0 ? uiRealityStatus.uiRealityDeferredExtractionPaneIds.join(', ') : 'none')}`,
    `UI Reality Deferred Extraction Pane Titles: ${asText(Array.isArray(uiRealityStatus.uiRealityDeferredExtractionPaneTitles) && uiRealityStatus.uiRealityDeferredExtractionPaneTitles.length > 0 ? uiRealityStatus.uiRealityDeferredExtractionPaneTitles.join(' | ') : 'none')}`,
    `UI Reality Deferred Extraction Next Action: ${asText(uiRealityStatus.uiRealityDeferredExtractionNextAction, 'No deferred extraction panes pending.')}`,
    `UI Reality Agent Mission Console Body Collapses: ${asText(uiRealityStatus.uiRealityAgentMissionConsoleBodyCollapses, 'unknown')}`,
    `UI Reality Agent Mission Console Collapse Status: ${asText(uiRealityStatus.uiRealityAgentMissionConsoleCollapseStatus, 'OK')}`,
    `UI Reality AI Core Mission Console Nesting: ${asText(uiRealityStatus.uiRealityAiCoreMissionConsoleNesting, 'unknown')}`,
    `UI Reality Operational Pane Placement Next Action: ${asText(uiRealityStatus.uiRealityOperationalPanePlacementNextAction, 'Capture UI reality diagnostics to validate operational pane placement.')}`,
    `UI Reality Suggested Extraction Plan: ${asText(uiRealityStatus.uiRealitySuggestedExtractionPlan, 'No extraction required.')}`,
    `UI Reality Startup Status: ${asText(uiRealityStatus.startup, 'unknown')}`,
    `UI Reality Sampled At: ${asText(uiRealitySampledAt, 'n/a')}`,
    `UI Reality Sample Source: ${asText(uiRealitySampleSource, 'cached')}`,
    `UI Reality Snapshot Age Ms: ${asText(uiRealitySnapshotAgeMs, 'n/a')}`,
    `UI Reality Fresh At Copy: ${asText(uiRealityFreshAtCopy, 'no')}`,
    `UI Reality State/DOM Mismatch: ${asText(uiRealityStatus.uiRealityStateDomMismatch, 'no')}`,
    `UI Reality Mismatch Reason: ${asText(uiRealityStatus.uiRealityMismatchReason, 'none')}`,
    `UI Reality Diagnostics Available: ${uiRealityDiagnosticsAvailable}`,
    `UI Reality Next Action: ${uiRealityNextAction}`,
    `Selected Provider: ${asText(routeTruthView?.selectedProvider)}`,
    `Active Provider: ${visibleActiveProvider}`,
    `Fallback Active: ${visibleFallbackActive}`,
    `Backend Reachable: ${asText(backendReachableState)}`,
    `Last Backend Health Probe At: ${asText(liveHealthProbeTruth?.lastBackendHealthProbeAt, 'n/a')}`,
    `Last Backend Health Probe Result: ${asText(liveHealthProbeTruth?.lastBackendHealthProbeResult, 'unknown')}`,
    `Route Health Revalidated After Failure: ${asText(liveHealthProbeTruth?.routeHealthRevalidatedAfterFailure, 'no')}`,
    `Stale Route Failure Present: ${asText(routeTruthView?.staleRouteFailurePresent === true ? 'yes' : 'no')}`,
    `Last Route Failure Is Historical: ${asText(routeFailureIsHistorical ? 'yes' : 'no')}`,
    `Current Backend Health Source: ${asText(liveHealthProbeTruth?.currentBackendHealthSource, 'unknown')}`,
    `Network Reachability Truth: ${asText(routeTruthView?.networkReachabilityState, 'unknown')}`,
    `Browser Direct Access: ${asText(routeTruthView?.browserDirectAccessState, 'unknown')}`,
    `Transport Compatibility Layer: ${asText(routeTruthView?.transportCompatibilityLayer, 'not-required')}`,
    `Local Available: ${asYesNoUnknown(runtimeStatus?.localAvailable)}`,
    `Cloud Available: ${asYesNoUnknown(runtimeStatus?.cloudAvailable)}`,
    `AI Mind Registry Discovered Minds: ${asText(mindSupport?.discoveredMindCount, '0')}`,
    `AI Mind Registry Approved Minds: ${asText(mindSupport?.approvedMindCount, '0')}`,
    `AI Mind Registry Sandboxed Minds: ${asText(mindSupport?.sandboxedMindCount, '0')}`,
    `AI Mind Registry Blocked Minds: ${asText(mindSupport?.blockedMindCount, '0')}`,
    `AI Mind Registry Next Action: ${asText(mindRegistry?.recommendedNextMindAction, 'n/a')}`,
    `External Mind Sources: ${asText(mindSupport?.externalMindSourceCount, '0')}`,
    `External Mind Sources Connected: ${asText(mindSupport?.connectedExternalMindSourceCount, '0')}`,
    `External Mind Sources Sandboxed: ${asText(mindSupport?.sandboxedExternalMindSourceCount, '0')}`,
    `External Mind Sources Approved: ${asText(mindSupport?.approvedExternalMindSourceCount, '0')}`,
    `External Mind Sources Blocked: ${asText(mindSupport?.blockedExternalMindSourceCount, '0')}`,
    `External Mind Sources Pending Operator Approval: ${asText(mindSupport?.pendingOperatorApprovalCount, '0')}`,
    `External Mind Sources Next Action: ${asText(mindSupport?.recommendedNextMindSourceAction, 'n/a')}`,
    `External Mind Source Risk Summary: ${asText(mindSupport?.externalMindSourceRiskSummary, 'none')}`,
    `External Mind Secret References Configured: ${asText(mindSupport?.configuredSecretReferenceCount, '0')}`,
    `External Mind Secret References Missing: ${asText(mindSupport?.missingSecretReferenceCount, '0')}`,
    `AI Mind Registry Mission Recommended Minds: ${asText(Array.isArray(mindRegistry?.currentMissionRecommendedMinds) ? mindRegistry.currentMissionRecommendedMinds.join(', ') : 'n/a')}`,
    `Dependency Summary: ${asText(runtimeStatus?.dependencySummary)}`,
    `Backend Default Provider: ${asText(safeApiStatus?.backendDefaultProvider)}`,
    `Selected Provider Health: ${asText(statusSummary?.healthBadge || statusSummary?.healthState)}`,
    `Selected Provider State: ${asText(statusSummary?.healthState)}`,
    `Selected Provider Detail: ${asText(statusSummary?.healthDetail)}`,
    `Selected Provider Reason: ${asText(statusSummary?.healthReason || statusSummary?.healthDetail, 'n/a')}`,
    `Selected Provider Supports Fresh Web: ${asText(statusSummary?.providerCapability?.supportsFreshWeb)}`,
    `Selected Provider Supports Current Answers: ${asText(statusSummary?.providerCapability?.supportsCurrentAnswers)}`,
    `Selected Provider Configured Model: ${asText(statusSummary?.providerCapability?.configuredModel || statusSummary?.model)}`,
    `Selected Provider Configured Model Supports Fresh Web: ${asText(statusSummary?.providerCapability?.configuredModelSupportsFreshWeb)}`,
    `Selected Provider Fresh Candidate Available: ${asText(statusSummary?.providerCapability?.candidateFreshRouteAvailable)}`,
    `Selected Provider Fresh Candidate Model: ${asText(statusSummary?.providerCapability?.candidateFreshWebModel, 'n/a')}`,
    `Selected Provider Fresh Web Path: ${asText(statusSummary?.providerCapability?.freshWebPath, 'n/a')}`,
    `Selected Provider Capability Reason: ${asText(statusSummary?.providerCapability?.capabilityReason, 'n/a')}`,
    `Zero Cost Policy: ${asText(statusSummary?.providerCapability?.zeroCostPolicy)}`,
    `Paid Fresh Routes Enabled: ${asText(statusSummary?.providerCapability?.paidFreshRoutesEnabled)}`,
    `Fresh Capability Mode: ${asText(statusSummary?.providerCapability?.freshCapabilityMode, 'zero-cost-only')}`,
    `Provider Selection Source: ${asText(runtimeStatus?.providerSelectionSource || runtimeContext?.providerSelectionSource)}`,
    `Active Provider Config Source: ${asText(runtimeStatus?.activeProviderConfigSource || runtimeContext?.activeProviderConfigSource)}`,
    `Dev Mode: ${runtimeStatus?.devMode ? 'on' : 'off'}`,
    `Fallback Enabled: ${runtimeStatus?.fallbackEnabled ? 'yes' : 'no'}`,
    `Provider Endpoint: ${asText(runtimeStatus?.providerEndpoint)}`,
    `Provider Model: ${asText(runtimeStatus?.providerModel || statusSummary?.model)}`,
    `Last UI Requested Provider: ${asText(runtimeStatus?.lastUiRequestedProvider)}`,
    `Last UI Default Provider: ${asText(runtimeStatus?.lastUiDefaultProvider)}`,
    `Last Requested Provider Intent: ${asText(runtimeStatus?.lastRequestedProviderIntent)}`,
    `Explicit Provider Override For Request: ${asText(runtimeStatus?.lastExplicitProviderOverrideForRequest || executionMetadata?.explicit_provider_override_for_request, 'no')}`,
    `Last Freshness Candidate Provider: ${asText(runtimeStatus?.lastFreshnessCandidateProvider)}`,
    `Last Execution Requested Provider: ${asText(runtimeStatus?.lastExecutionRequestedProvider || executionMetadata?.execution_requested_provider)}`,
    `Last Requested Provider For Request: ${asText(runtimeStatus?.lastRequestedProviderForRequest)}`,
    `Last Fallback Provider Used: ${asText(runtimeStatus?.lastFallbackProviderUsed)}`,
    `Last Backend Default Provider: ${asText(runtimeStatus?.lastBackendDefaultProvider || safeApiStatus?.backendDefaultProvider)}`,
    `Last Requested Provider: ${asText(runtimeStatus?.lastRequestedProvider || routeTruthView?.requestedProvider)}`,
    `Last Request-Side Selected Provider: ${asText(runtimeStatus?.lastRequestSelectedProvider)}`,
    `Last Router Selected Provider: ${asText(runtimeStatus?.lastRouterSelectedProvider)}`,
    `Last Selected Provider: ${asText(runtimeStatus?.lastSelectedProvider || routeTruthView?.executedProvider || routeTruthView?.selectedProvider)}`,
    `Last Executable Provider: ${visibleLastExecutableProvider}`,
    `Last Actual Provider Used: ${visibleLastActualProviderUsed}`,
    `Last Actual Model Used: ${visibleLastActualModelUsed}`,
    `Last Model Used: ${visibleLastModelUsed}`,
    `Last Provider Override Reason: ${asText(runtimeStatus?.lastProviderOverrideReason)}`,
    `Last Ollama Default Model: ${asText(runtimeStatus?.lastOllamaModelDefault)}`,
    `Last Ollama Preferred Model: ${asText(runtimeStatus?.lastOllamaModelPreferred)}`,
    `Last Ollama Requested Model: ${asText(runtimeStatus?.lastOllamaModelRequested)}`,
    `Last Ollama Selected Model: ${asText(runtimeStatus?.lastOllamaModelSelected)}`,
    `Last Ollama Load Mode: ${asText(runtimeStatus?.lastOllamaLoadMode)}`,
    `Last Ollama Load Policy Applied: ${asText(runtimeStatus?.lastOllamaLoadPolicyApplied)}`,
    `Last Ollama Load Policy Reason: ${asText(runtimeStatus?.lastOllamaLoadPolicyReason)}`,
    `Last Ollama Heavy Model Requested: ${asText(runtimeStatus?.lastOllamaHeavyModelRequested)}`,
    `Last Ollama Heavy Model Allowed: ${asText(runtimeStatus?.lastOllamaHeavyModelAllowed)}`,
    `Last Ollama Model Before Load Policy: ${asText(runtimeStatus?.lastOllamaModelBeforeLoadPolicy)}`,
    `Last Ollama Model After Load Policy: ${asText(runtimeStatus?.lastOllamaModelAfterLoadPolicy)}`,
    `Last Ollama Reasoning Mode: ${asText(runtimeStatus?.lastOllamaReasoningMode)}`,
    `Last Ollama Escalation Active: ${asText(runtimeStatus?.lastOllamaEscalationActive)}`,
    `Last Ollama Escalation Reason: ${asText(runtimeStatus?.lastOllamaEscalationReason)}`,
    `Last Ollama Fallback Model: ${asText(runtimeStatus?.lastOllamaFallbackModel)}`,
    `Last Ollama Fallback Model Used: ${asText(runtimeStatus?.lastOllamaFallbackModelUsed)}`,
    `Last Ollama Fallback Reason: ${asText(runtimeStatus?.lastOllamaFallbackReason)}`,
    `Last Ollama Timeout (ms): ${asText(runtimeStatus?.lastOllamaTimeoutMs)}`,
    `Last Ollama Timeout Source: ${asText(runtimeStatus?.lastOllamaTimeoutSource)}`,
    `Last Ollama Timeout Model: ${asText(runtimeStatus?.lastOllamaTimeoutModel)}`,
    `Last UI Request Timeout (ms): ${asText(runtimeStatus?.lastUiRequestTimeoutMs)}`,
    `Last Backend Route Timeout (ms): ${asText(runtimeStatus?.lastBackendRouteTimeoutMs)}`,
    `Last Provider Timeout (ms): ${asText(runtimeStatus?.lastProviderTimeoutMs)}`,
    `Last Model Timeout (ms): ${asText(runtimeStatus?.lastModelTimeoutMs)}`,
    `Last Timeout Policy Source: ${asText(runtimeStatus?.lastTimeoutPolicySource)}`,
    `Last Timeout Effective Provider: ${visibleLastTimeoutEffectiveProvider}`,
    `Last Timeout Effective Model: ${visibleLastTimeoutEffectiveModel}`,
    `Timeout Truth Degraded By Route Usability: ${timeoutTruthDegradedByRouteUsability ? 'yes' : 'no'}`,
    `Timeout Truth Degradation Reason: ${timeoutTruthDegradationReason}`,
    `Last Timeout Override Applied: ${asText(runtimeStatus?.lastTimeoutOverrideApplied)}`,
    `Last Timeout Failure Layer: ${asText(runtimeStatus?.lastTimeoutFailureLayer)}`,
    `Last Timeout Failure Label: ${asText(runtimeStatus?.lastTimeoutFailureLabel)}`,
    `Last Groq Endpoint Used: ${asText(runtimeStatus?.lastGroqEndpointUsed)}`,
    `Last Groq Model Used: ${asText(runtimeStatus?.lastGroqModelUsed)}`,
    `Last Groq Fresh Web Active: ${asText(runtimeStatus?.lastGroqFreshWebActive)}`,
    `Last Groq Fresh Candidate Available: ${asText(runtimeStatus?.lastGroqFreshCandidateAvailable)}`,
    `Last Groq Fresh Candidate Model: ${asText(runtimeStatus?.lastGroqFreshCandidateModel)}`,
    `Last Groq Fresh Web Path: ${asText(runtimeStatus?.lastGroqFreshWebPath)}`,
    `Last Groq Capability Reason: ${asText(runtimeStatus?.lastGroqCapabilityReason, 'n/a')}`,
    `Last Zero Cost Policy: ${asText(runtimeStatus?.lastZeroCostPolicy)}`,
    `Last Paid Fresh Routes Enabled: ${asText(runtimeStatus?.lastPaidFreshRoutesEnabled)}`,
    `Last Fresh Capability Mode: ${asText(runtimeStatus?.lastFreshCapabilityMode, 'zero-cost-only')}`,
    `Last Response Truth: ${asText(runtimeStatus?.lastResponseTruth)}`,
    `Last Fallback Used: ${asText(runtimeStatus?.lastFallbackUsed)}`,
    `Last Fallback Reason: ${asText(runtimeStatus?.lastFallbackReason)}`,
    `Last Selected Provider Health OK: ${asText(runtimeStatus?.lastSelectedProviderHealthOk)}`,
    `Last Selected Provider Health State: ${asText(runtimeStatus?.lastSelectedProviderHealthState)}`,
    `Last Selected Provider Execution Viability: ${asText(runtimeStatus?.lastSelectedProviderExecutionViability)}`,
    `Last Selected Provider Failure Layer: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailureLayer)}`,
    `Last Selected Provider Failure Label: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailureLabel)}`,
    `Last Selected Provider Failure Phase: ${asText(runtimeStatus?.lastSelectedProviderExecutionFailurePhase)}`,
    `Last Selected Provider Timeout Category: ${asText(runtimeStatus?.lastSelectedProviderTimeoutCategory)}`,
    `Last Selected Provider Model Warmup Likely: ${asText(runtimeStatus?.lastSelectedProviderModelWarmupLikely)}`,
    `Last Selected Provider Warmup Retry Eligible: ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryEligible)}`,
    `Last Selected Provider Warmup Retry Applied: ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryApplied)}`,
    `Last Selected Provider Warmup Retry Reason: ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryReason)}`,
    `Last Selected Provider Warmup Retry Timeout (ms): ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryTimeoutMs)}`,
    `Last Selected Provider Warmup Retry Attempt Count: ${asText(runtimeStatus?.lastSelectedProviderWarmupRetryAttemptCount)}`,
    `Last Selected Provider First Attempt Elapsed (ms): ${asText(runtimeStatus?.lastSelectedProviderFirstAttemptElapsedMs)}`,
    `Last Selected Provider Final Attempt Elapsed (ms): ${asText(runtimeStatus?.lastSelectedProviderFinalAttemptElapsedMs)}`,
    `Last Selected Provider Initial Failure Layer: ${asText(runtimeStatus?.lastSelectedProviderInitialFailureLayer)}`,
    `Last Selected Provider Initial Failure Label: ${asText(runtimeStatus?.lastSelectedProviderInitialFailureLabel)}`,
    `Last Selected Provider Initial Failure Phase: ${asText(runtimeStatus?.lastSelectedProviderInitialFailurePhase)}`,
    `Last Selected Provider Initial Timeout Category: ${asText(runtimeStatus?.lastSelectedProviderInitialTimeoutCategory)}`,
    `Last Selected Provider Final Execution Outcome: ${asText(runtimeStatus?.lastSelectedProviderFinalExecutionOutcome)}`,
    `Last Selected Provider Fallback After Warmup Retry: ${asText(runtimeStatus?.lastSelectedProviderFallbackAfterWarmupRetry)}`,
    `Last Selected Provider Attempt Elapsed (ms): ${asText(runtimeStatus?.lastSelectedProviderElapsedMs)}`,
    `Explicit Provider Fallback Policy Triggered: ${asText(runtimeStatus?.lastExplicitProviderFallbackPolicyTriggered)}`,
    `Last Effective Answer Mode: ${asText(runtimeStatus?.lastEffectiveAnswerMode)}`,
    `Freshness Required For Truth: ${asText(runtimeStatus?.lastFreshnessRequiredForTruth)}`,
    `Fresh Answer Required: ${asText(runtimeStatus?.lastFreshAnswerRequired)}`,
    `Fresh Provider Available For Request: ${asText(runtimeStatus?.lastFreshProviderAvailableForRequest)}`,
    `Last Fresh Provider Attempted: ${asText(runtimeStatus?.lastFreshProviderAttempted)}`,
    `Last Fresh Provider Succeeded: ${asText(runtimeStatus?.lastFreshProviderSucceeded)}`,
    `Last Fresh Provider Failure Reason: ${asText(runtimeStatus?.lastFreshProviderFailureReason)}`,
    `Last Grounding Enabled: ${asText(runtimeStatus?.lastGroundingEnabled)}`,
    `Last Grounding Active For Request: ${asText(runtimeStatus?.lastGroundingActiveForRequest)}`,
    `Last Stale Fallback Permitted: ${asText(runtimeStatus?.lastStaleFallbackPermitted)}`,
    `Last Stale Fallback Attempted: ${asText(runtimeStatus?.lastStaleFallbackAttempted)}`,
    `Last Stale Fallback Used: ${asText(runtimeStatus?.lastStaleFallbackUsed)}`,
    `Last Stale Answer Warning: ${asText(runtimeStatus?.lastStaleAnswerWarning)}`,
    `Last Freshness Need: ${asText(runtimeStatus?.lastFreshnessNeed)}`,
    `Last Answer Truth Mode: ${asText(runtimeStatus?.lastAnswerTruthMode)}`,
    `Freshness Integrity Preserved: ${asText(runtimeStatus?.lastFreshnessIntegrityPreserved)}`,
    `Freshness Integrity Failure Reason: ${asText(runtimeStatus?.lastFreshnessIntegrityFailureReason)}`,
    `Freshness Truth Reason: ${asText(runtimeStatus?.lastFreshnessTruthReason)}`,
    `Freshness Next Actions: ${asText(runtimeStatus?.lastFreshnessNextActions)}`,
    `Last Answer Mode: ${asText(runtimeStatus?.lastAnswerMode)}`,
    `Answer Pane Text Selection Enabled: ${asText(runtimeStatus?.answerPaneTextSelectionEnabled, 'yes')}`,
    `Last Copy Mode: ${asText(runtimeStatus?.lastCopyMode)}`,
    `Last Copied Payload Kind: ${asText(runtimeStatus?.lastCopiedPayloadKind)}`,
    `Last Copied Payload Size: ${asText(runtimeStatus?.lastCopiedPayloadSize)}`,
    `Streaming Requested: ${asText(runtimeStatus?.lastStreamingRequested, 'false')}`,
    `Streaming Mode Preference: ${asText(runtimeStatus?.lastStreamingModePreference, 'auto')}`,
    `Streaming Preference Rehydrated: ${asText(runtimeStatus?.lastStreamingPreferenceRehydrated, 'no')}`,
    `Streaming Persistence Source: ${asText(runtimeStatus?.lastStreamingPersistenceSource, 'default/auto')}`,
    `Streaming Persistence Updated At: ${asText(runtimeStatus?.lastStreamingPersistenceUpdatedAt)}`,
    `Streaming Request Source: ${asText(runtimeStatus?.lastStreamingRequestSource, 'auto-default-off')}`,
    `Streaming Policy Decision: ${asText(runtimeStatus?.lastStreamingPolicyDecision)}`,
    `Streaming Policy Reason: ${asText(runtimeStatus?.lastStreamingPolicyReason)}`,
    `Streaming Supported: ${asText(runtimeStatus?.lastStreamingSupported, 'false')}`,
    `Streaming Used: ${asText(runtimeStatus?.lastStreamingUsed, 'false')}`,
    `Streaming Provider: ${asText(runtimeStatus?.lastStreamingProvider)}`,
    `Streaming Model: ${asText(runtimeStatus?.lastStreamingModel)}`,
    `Streaming Finalized: ${asText(runtimeStatus?.lastStreamingFinalized, 'false')}`,
    `Streaming Completion Quality: ${asText(runtimeStatus?.lastStreamingCompletionQuality, 'n/a')}`,
    `Final Metadata Missing: ${asText(runtimeStatus?.lastFinalMetadataMissing, 'false')}`,
    `Streaming Completion State: ${deriveStreamingCompletionState(runtimeStatus)}`,
    `Streaming Fallback Reason: ${asText(runtimeStatus?.lastStreamingFallbackReason)}`,
    `Last Execution Cancelled: ${asText(runtimeStatus?.lastExecutionCancelled, 'false')}`,
    `Last Cancellation Source: ${asText(runtimeStatus?.lastCancellationSource)}`,
    `Provider Cancelled: ${asText(runtimeStatus?.lastProviderCancelled, 'false')}`,
    `Provider Cancel Reason: ${asText(runtimeStatus?.lastProviderCancelReason)}`,
    `Ollama Abort Sent: ${asText(runtimeStatus?.lastOllamaAbortSent, 'false')}`,
    `Fast Response Lane Eligible: ${asText(routeTruthView?.fastResponseLaneEligible ?? runtimeStatus?.lastFastResponseLaneEligible, 'false')}`,
    `Fast Response Lane Active: ${asText(routeTruthView?.fastResponseLaneActive ?? runtimeStatus?.lastFastResponseLaneActive, 'false')}`,
    `Fast Response Lane Reason: ${asText(routeTruthView?.fastResponseLaneReason || runtimeStatus?.lastFastResponseLaneReason)}`,
    `Fast Response Model: ${asText(routeTruthView?.fastResponseModel || runtimeStatus?.lastFastResponseModel)}`,
    `Escalation Model: ${asText(routeTruthView?.escalationModel || runtimeStatus?.lastEscalationModel)}`,
    `Escalation Reason: ${asText(routeTruthView?.escalationReason || runtimeStatus?.lastEscalationReason)}`,
    `Last Stale Risk: ${asText(runtimeStatus?.lastStaleRisk)}`,
    `Last Freshness Reason: ${asText(runtimeStatus?.lastFreshnessReason)}`,
    `Last Override Denial Reason: ${asText(runtimeStatus?.lastOverrideDenialReason)}`,
    `Last Freshness Warning: ${asText(runtimeStatus?.lastFreshnessWarning)}`,
    `Retrieval Mode: ${asText(runtimeStatus?.lastRetrievalMode, 'none')}`,
    `Retrieval Eligible: ${asText(runtimeStatus?.lastRetrievalEligible)}`,
    `Retrieval Used: ${asText(runtimeStatus?.lastRetrievalUsed)}`,
    `Retrieval Reason: ${asText(runtimeStatus?.lastRetrievalReason)}`,
    `Retrieved Chunk Count: ${asText(runtimeStatus?.lastRetrievedChunkCount, '0')}`,
    `Retrieved Sources: ${asText(Array.isArray(runtimeStatus?.lastRetrievedSources) ? runtimeStatus.lastRetrievedSources.join(' | ') : 'n/a')}`,
    `Retrieval Query: ${asText(runtimeStatus?.lastRetrievalQuery)}`,
    `Retrieval Index Status: ${asText(runtimeStatus?.lastRetrievalIndexStatus, 'missing')}`,
    `Memory Eligible: ${asText(runtimeStatus?.lastMemoryEligible)}`,
    `Memory Promoted: ${asText(runtimeStatus?.lastMemoryPromoted)}`,
    `Memory Reason: ${asText(runtimeStatus?.lastMemoryReason)}`,
    `Memory Source Type: ${asText(runtimeStatus?.lastMemorySourceType)}`,
    `Memory Source Ref: ${asText(runtimeStatus?.lastMemorySourceRef)}`,
    `Memory Confidence: ${asText(runtimeStatus?.lastMemoryConfidence)}`,
    `Memory Class: ${asText(runtimeStatus?.lastMemoryClass, 'durable')}`,
    `Memory Elevation Active: ${asText(runtimeStatus?.lastMemoryElevationActive, 'false')}`,
    `Memory Elevation Mode: ${asText(runtimeStatus?.lastMemoryElevationMode, 'bounded')}`,
    `Memory Truth Preserved: ${asText(runtimeStatus?.lastMemoryTruthPreserved, 'true')}`,
    `Memory Candidates Considered: ${asText(runtimeStatus?.lastMemoryCandidatesConsidered, '0')}`,
    `Memory Candidate Status: ${asText(runtimeStatus?.lastMemoryCandidateStatus, 'pending')}`,
    `Memory Candidate Promotion State: ${asText(runtimeStatus?.lastMemoryCandidatePromotionState, 'pending')}`,
    `Elevated Memory Count: ${asText(runtimeStatus?.lastElevatedMemoryCount, '0')}`,
    `Graph Linked Memory Count: ${asText(runtimeStatus?.lastGraphLinkedMemoryCount, '0')}`,
    `Deferred Graph Link Count: ${asText(runtimeStatus?.lastDeferredGraphLinkCount, '0')}`,
    `Build Relevant Memory Count: ${asText(runtimeStatus?.lastBuildRelevantMemoryCount, '0')}`,
    `Mission Critical Memory Count: ${asText(runtimeStatus?.lastMissionCriticalMemoryCount, '0')}`,
    `Continuity Confidence: ${asText(runtimeStatus?.lastContinuityConfidence, 'low')}`,
    `Continuity Reason: ${asText(runtimeStatus?.lastContinuityReason)}`,
    `Graph Link Truth Preserved: ${asText(runtimeStatus?.lastGraphLinkTruthPreserved, 'true')}`,
    `Graph Link Reason: ${asText(runtimeStatus?.lastGraphLinkReason)}`,
    `Recurrence Signals: ${asText(runtimeStatus?.lastRecurrenceSignals)}`,
    `Memory Elevation Warnings: ${asText(runtimeStatus?.lastMemoryElevationWarnings)}`,
    `Source Provenance Summary: ${asText(runtimeStatus?.lastSourceProvenanceSummary)}`,
    `Top Memory Influencers: ${asText(runtimeStatus?.lastTopMemoryInfluencers)}`,
    `Memory Informed Recommendation: ${asText(runtimeStatus?.lastMemoryInformedRecommendation)}`,
    `Mission Memory Context Count: ${asText(runtimeStatus?.missionMemoryContextCount, '0')}`,
    `Mission Memory Influence Levels: ${asText(runtimeStatus?.missionMemoryInfluenceLevels, 'none')}`,
    `Mission Memory Conflict Count: ${asText(runtimeStatus?.missionMemoryConflictCount, '0')}`,
    `Mission Memory Lesson Candidate Pending: ${asText(runtimeStatus?.missionMemoryLessonCandidatePending, 'no')}`,
    `Mission Memory Capability Gap Pending: ${asText(runtimeStatus?.missionMemoryCapabilityGapPending, 'no')}`,
    `Memory Capability State: ${asText(runtimeStatus?.memoryCapabilityState, 'unavailable')}`,
    `Memory Capability Ready: ${asText(runtimeStatus?.memoryCapabilityReady, 'no')}`,
    `Memory Capability Canonical: ${asText(runtimeStatus?.memoryCapabilityCanonical, 'no')}`,
    `Memory Capability Reason: ${asText(runtimeStatus?.memoryCapabilityReason, 'Memory capability state unavailable.')}`,

    `Context Assembly Used: ${asText(runtimeStatus?.lastContextAssemblyUsed)}`,
    `Context Assembly Mode: ${asText(runtimeStatus?.lastContextAssemblyMode)}`,
    `Context Sources Used: ${asText(runtimeStatus?.lastContextSourcesUsed)}`,
    `Self-Build Prompt Detected: ${asText(runtimeStatus?.lastSelfBuildPromptDetected)}`,
    `Self-Build Reason: ${asText(runtimeStatus?.lastSelfBuildReason)}`,
    `System Awareness Level: ${asText(runtimeStatus?.lastSystemAwarenessLevel, 'baseline')}`,
    `Augmented Prompt Used: ${asText(runtimeStatus?.lastAugmentedPromptUsed)}`,
    `Augmented Prompt Length: ${asText(runtimeStatus?.lastAugmentedPromptLength, '0')}`,
    `Context Integrity Preserved: ${asText(runtimeStatus?.lastContextIntegrityPreserved)}`,
    `Context Assembly Warnings: ${asText(runtimeStatus?.lastContextAssemblyWarnings)}`,
    `Planning Active: ${asText(runtimeStatus?.lastPlanningActive, 'false')}`,
    `Planning Mode: ${asText(runtimeStatus?.lastPlanningMode, 'inactive')}`,
    `Planning Confidence: ${asText(runtimeStatus?.lastPlanningConfidence, 'low')}`,
    `Current System Maturity Estimate: ${asText(runtimeStatus?.lastPlanningMaturityEstimate, 'unknown')}`,
    `Recommended Next Move: ${asText(runtimeStatus?.lastRecommendedNextMove)}`,
    `Recommendation Reason: ${asText(runtimeStatus?.lastRecommendationReason)}`,
    `Candidate Move Count: ${asText(runtimeStatus?.lastPlanningCandidateMoveCount, '0')}`,
    `Planning Evidence Sources: ${asText(runtimeStatus?.lastPlanningEvidenceSources)}`,
    `Planning Truth Warnings: ${asText(runtimeStatus?.lastPlanningTruthWarnings)}`,
    `Proposal Eligible: ${asText(runtimeStatus?.lastProposalEligible, 'false')}`,
    `Codex Handoff Eligible: ${asText(runtimeStatus?.lastCodexHandoffEligible, 'false')}`,
    `Proposal Packet Active: ${asText(runtimeStatus?.lastProposalPacketActive, 'false')}`,
    `Proposal Packet Mode: ${asText(runtimeStatus?.lastProposalPacketMode, 'inactive')}`,
    `Proposal Packet Confidence: ${asText(runtimeStatus?.lastProposalPacketConfidence, 'low')}`,
    `Proposal Packet Truth Preserved: ${asText(runtimeStatus?.lastProposalPacketTruthPreserved, 'true')}`,
    `Proposed Move ID: ${asText(runtimeStatus?.lastProposedMoveId)}`,
    `Proposed Move Title: ${asText(runtimeStatus?.lastProposedMoveTitle)}`,
    `Proposed Move Rationale: ${asText(runtimeStatus?.lastProposedMoveRationale)}`,
    `Proposal Packet Warnings: ${asText(runtimeStatus?.lastProposalPacketWarnings)}`,
    `Codex Handoff Available: ${asText(runtimeStatus?.lastCodexHandoffAvailable, 'false')}`,
    `Codex Prompt Summary: ${asText(runtimeStatus?.lastCodexPromptSummary)}`,
    `Codex Constraints: ${asText(runtimeStatus?.lastCodexConstraints)}`,
    `Codex Success Criteria: ${asText(runtimeStatus?.lastCodexSuccessCriteria)}`,
    `Operator Actions: ${asText(runtimeStatus?.lastProposalOperatorActions)}`,
    `Approval Required: ${asText(runtimeStatus?.lastOperatorApprovalRequired, 'true')}`,
    `Execution Eligible: ${asText(runtimeStatus?.lastExecutionEligible, 'false')}`,
    `Mission Packet Decision: ${asText(runtimeStatus?.missionPacketDecision, 'pending-review')}`,
    `Mission Packet Decision Timestamp: ${asText(runtimeStatus?.missionPacketDecisionAt, 'n/a')}`,
    `Mission Packet Proposal Queue Depth: ${asText(runtimeStatus?.missionPacketProposalQueueLength, '0')}`,
    `Mission Packet Roadmap Queue Depth: ${asText(runtimeStatus?.missionPacketRoadmapQueueLength, '0')}`,
    `Intent-to-Build Latest Mission ID: ${asText(runtimeStatus?.latestMissionId, 'n/a')}`,
    `Intent-to-Build Mission Status: ${asText(runtimeStatus?.missionStatus, 'draft')}`,
    `Intent-to-Build Approval Required: ${asText(runtimeStatus?.approvalRequired, 'no')}`,
    `Intent-to-Build Generated Prompt Available: ${asText(runtimeStatus?.generatedPromptAvailable, 'no')}`,
    `Intent-to-Build Verification Status: ${asText(runtimeStatus?.verificationStatus, 'pending')}`,
    `Repo Architecture Affected Subsystem Count: ${asText(runtimeStatus?.repoArchitectureAffectedSubsystemCount, '0')}`,
    `Repo Architecture Affected Subsystems: ${asText(runtimeStatus?.repoArchitectureAffectedSubsystems, 'none')}`,
    `Repo Architecture Likely Test Count: ${asText(runtimeStatus?.repoArchitectureLikelyTestCount, '0')}`,
    `Repo Architecture Generated Output Touched: ${asText(runtimeStatus?.repoArchitectureGeneratedOutputTouched, 'no')}`,
    `Repo Architecture Source Truth Warning: ${asText(runtimeStatus?.repoArchitectureSourceTruthWarning, 'none')}`,
    `Repo Architecture Risk Level: ${asText(runtimeStatus?.repoArchitectureRiskLevel, 'none')}`,
    `Mission Verification Judgment: ${asText(runtimeStatus?.missionVerificationJudgment, 'no_return')}`,
    `Mission Verification Readiness Level: ${asText(runtimeStatus?.missionVerificationReadinessLevel, 'not_ready')}`,
    `Mission Verification Merge-ready Candidate: ${asText(runtimeStatus?.missionVerificationMergeReadyCandidate, 'no')}`,
    `Mission Verification Blocker Count: ${asText(runtimeStatus?.missionVerificationBlockerCount, '0')}`,
    `Mission Verification Warning Count: ${asText(runtimeStatus?.missionVerificationWarningCount, '0')}`,
    `Mission Verification Proof Status: ${asText(runtimeStatus?.missionVerificationProofStatus, 'pending')}`,
    `Mission Verification Changed Files In Scope: ${asText(runtimeStatus?.missionVerificationChangedFilesInScope, 'no')}`,
    `Mission Verification Required Tests Run: ${asText(runtimeStatus?.missionVerificationRequiredTestsRun, 'no')}`,
    `PR Evidence Status: ${asText(canonicalPrEvidence.status || canonicalPrEvidence.prEvidenceStatus, 'no_pr_evidence')}`,
    `PR Evidence Number: ${resolvedPrEvidence.prNumber}`,
    `PR Evidence Checks Status: ${asText(canonicalPrEvidence.checksStatus, 'unknown')}`,
    `PR Evidence Merged: ${canonicalPrEvidence.merged === true ? 'yes' : asText(runtimeStatus?.prEvidenceMerged, 'no')}`,
    `PR Evidence Merged By: ${asText(runtimeStatus?.prEvidenceMergedBy, 'unknown')}`,
    `PR Evidence Auto-Merge State: ${asText(runtimeStatus?.prEvidenceAutoMergeState, 'unknown')}`,
    `PR Evidence Changed File Count: ${asText(canonicalPrEvidence.changedFileCount, '0')}`,
    `PR Evidence Warning Count: ${asText(runtimeStatus?.prEvidenceWarningCount, '0')}`,
    `PR Evidence Codex Task Present: ${asText(runtimeStatus?.prEvidenceCodexTaskPresent, 'no')}`,
    `PR Evidence Input Detected: ${asText(runtimeStatus?.prEvidenceInputDetected, 'no')}`,
    `PR Evidence Parse Confidence: ${asText(runtimeStatus?.prEvidenceParseConfidence, 'none')}`,
    `PR Evidence Parse Input: ${resolvedPrEvidenceParseInput}`,
    `PR Evidence Parsed Number Source: ${resolvedPrEvidenceParsedNumberSource}`,
    `PR Evidence Resolved Number Source: ${resolvedPrEvidence.source}`,
    `PR Evidence Provider Output Number: ${prEvidenceProviderOutputNumber}`,
    `PR Evidence Final Metadata Number: ${resolvedPrEvidenceFinalMetadataNumber}`,
    `PR Evidence Parsed PR Number: ${prEvidenceParsedPrNumberDisplay}`,
    `PR Evidence Parsed Repo: ${asText(runtimeStatus?.prEvidenceParsedRepo, 'unknown')}`,
    `PR Evidence Parse Warning Count: ${asText(runtimeStatus?.prEvidenceParseWarningCount, '0')}`,
    `PR Evidence Connector Source: ${asText(runtimeStatus?.prEvidenceConnectorSource, 'none')}`,
    `PR Evidence Status: ${asText(canonicalPrEvidence.status || canonicalPrEvidence.prEvidenceStatus, 'none')}`,
    `PR Evidence Parsed PR Number: ${prEvidenceParsedPrNumberDisplay}`,
    `PR Evidence Changed File Count: ${asText(canonicalPrEvidence.changedFileCount, '0')}`,
    `PR Evidence Tests Status: ${asText(runtimeStatus?.prEvidenceTestsStatus, 'unknown')}`,
    `PR Evidence Build Status: ${asText(canonicalPrEvidence.buildStatus, 'unknown')}`,
    `PR Evidence Verify Status: ${asText(canonicalPrEvidence.verifyStatus, 'unknown')}`,
    `PR Evidence Browser Proof Status: ${asText(runtimeStatus?.prEvidenceBrowserProofStatus, 'unknown')}`,
    `PR Evidence Missing Proof: ${asText((canonicalPrEvidence.missingProof || []).join('|'), 'none')}`,
    `PR Evidence Merge Readiness: ${asText(canonicalPrEvidence.mergeReadiness, 'hold')}`,
    `PR Evidence Already Merged: ${canonicalPrEvidence.merged === true ? 'yes' : (canonicalPrEvidence.merged === false ? 'no' : 'unknown')}`,
    `PR Evidence Verification Source: ${asText(canonicalPrEvidence.verificationSource, (asText(canonicalPrEvidence.source, 'none') === 'none' ? 'parsed-only' : canonicalPrEvidence.source))}`,
    `PR Evidence Recommended Next Action: ${asText(canonicalPrEvidence.recommendedNextAction, 'collect PR evidence')}`,
    `Mission Repair Loop PR Evidence Linked: ${['fetched', 'available', 'parsed', 'received', 'merge_ready_candidate', 'merged'].includes(String(canonicalPrEvidence.status || canonicalPrEvidence.prEvidenceStatus || '').toLowerCase()) ? 'yes' : asText(runtimeStatus?.missionRepairLoopPrEvidenceLinked, 'no')}`,
    `GitHub PR Evidence Provider Status: ${githubPrEvidenceProviderStatusDisplay}`,
    `GitHub Token Configured: ${githubTokenConfiguredDisplay}`,
    `GitHub Token Authority: ${githubTokenAuthorityDisplay}`,
    `GitHub Token Masked: ${githubTokenMaskedDisplay}`,
    `GitHub Token Updated At: ${githubTokenUpdatedAtDisplay}`,
    `GitHub PR Evidence Projection Source: ${githubPrEvidenceProjectionSource}`,
    `GitHub PR Evidence Source: ${githubEvidenceSourceDisplay}`,
    `GitHub PR Evidence Repo: ${githubEvidenceRepoDisplay}`,
    `GitHub PR Evidence Number: ${githubPrEvidenceNumberDisplay}`,
    `GitHub PR Evidence URL: ${githubEvidenceUrlDisplay}`,
    `GitHub PR Evidence Title: ${githubEvidenceTitleDisplay}`,
    `GitHub PR Evidence State: ${githubEvidenceStateDisplay}`,
    `GitHub PR Evidence Merged: ${githubEvidenceMergedDisplay}`,
    `GitHub PR Evidence Head SHA: ${githubEvidenceHeadShaDisplay}`,
    `GitHub PR Evidence Changed File Count: ${githubEvidenceChangedFileCountDisplay}`,
    `GitHub PR Evidence Checks Status: ${githubEvidenceChecksStatusDisplay}`,
    `GitHub PR Evidence Failing Checks: ${asText(runtimeStatus?.githubPrEvidenceFailingChecks, 'none')}`,
    `GitHub PR Evidence Build Status: ${githubEvidenceBuildStatusDisplay}`,
    `GitHub PR Evidence Verify Status: ${githubEvidenceVerifyStatusDisplay}`,
    `GitHub PR Evidence Browser Proof Status: ${asText(runtimeStatus?.githubPrEvidenceBrowserProofStatus, 'unknown')}`,
    `GitHub PR Evidence Codex Task Present: ${asText(runtimeStatus?.githubPrEvidenceCodexTaskPresent, 'no')}`,
    `GitHub PR Evidence Missing Proof: ${asText(runtimeStatus?.githubPrEvidenceMissingProof, 'none')}`,
    `GitHub PR Evidence Merge Readiness: ${asText(runtimeStatus?.githubPrEvidenceMergeReadiness, 'hold')}`,
    `GitHub PR Evidence Projection Integrity: ${githubProjectionIntegrity === 'incomplete' ? 'incomplete-fetched-payload' : githubProjectionIntegrity}` ,
    `GitHub PR Evidence Next Action: ${githubEvidenceNextAction}`,
    `GitHub PR Evidence Fetch Attempted: ${asText(executionMetadata?.github_pr_evidence_fetch_attempted, 'no')}`,
    `GitHub PR Evidence Fetch Disabled: ${asText(executionMetadata?.github_pr_evidence_fetch_disabled, 'yes')}`,
    `GitHub PR Evidence Fetch Disabled Reason: ${asText(executionMetadata?.github_pr_evidence_fetch_disabled_reason, 'live-fetch-disabled-by-default')}`,
    `GitHub PR Evidence Availability: ${asText(
      (asText(executionMetadata?.github_pr_evidence_fetch_disabled, 'yes') === 'yes')
        ? 'disabled'
        : (githubEvidenceSourceDisplay.includes('operator') ? 'manual' : (githubEvidenceSourceDisplay === 'none' ? 'unavailable' : 'live')),
      'unavailable',
    )}`,
    `GitHub PR Evidence Truth Status: ${asText(canonicalPrEvidence.evidenceTruthStatus, (asText(executionMetadata?.github_pr_evidence_fetch_disabled, 'yes') === 'yes' ? 'unknown-disabled' : 'unknown'))}`,
    `PR Evidence Disabled Explanation: ${asText(executionMetadata?.github_pr_evidence_fetch_disabled_reason, 'live-fetch-disabled-by-default')}`,
    `PR Evidence Operator Action: ${canonicalPrEvidence.mergeReadiness === 'already-merged' ? 'no merge required' : ((asText(executionMetadata?.github_pr_evidence_fetch_disabled, 'yes') === 'yes') ? 'enable read-only fetch / paste PR evidence' : 'paste PR evidence')}`,
    `GitHub PR Evidence Fetch URL/Mode: ${asText(executionMetadata?.github_pr_evidence_fetch_url_or_mode, 'none')}`,
    `GitHub PR Evidence Backend Status: ${asText(executionMetadata?.github_pr_evidence_backend_status, 'unknown')}`,
    `GitHub PR Evidence Backend Source: ${asText(executionMetadata?.github_pr_evidence_backend_source, 'none')}`,
    `GitHub PR Evidence Backend Repo: ${asText(executionMetadata?.github_pr_evidence_backend_repo, 'unknown')}`,
    `GitHub PR Evidence Backend Title Present: ${asText(executionMetadata?.github_pr_evidence_backend_title_present, 'no')}`,
    `GitHub PR Evidence Backend Token Configured: ${asText(executionMetadata?.github_pr_evidence_backend_token_configured, 'no')}`,
    `GitHub PR Evidence Backend Payload Keys: ${asText(executionMetadata?.github_pr_evidence_backend_payload_keys, 'none')}`,
    `GitHub PR Evidence Retrieved At: ${githubEvidenceRetrievedAtDisplay}`,
    `GitHub PR Evidence Warning Count: ${asText(runtimeStatus?.githubPrEvidenceWarningCount, '0')}`,
    `GitHub PR Evidence Warnings: ${asText(runtimeStatus?.githubPrEvidenceWarnings, 'none')}`,
    `Memory Librarian Pending Count: ${asText(runtimeStatus?.memoryLibrarianPendingCount, '0')}`,
    `Memory Librarian Approval Required Count: ${asText(runtimeStatus?.memoryLibrarianApprovalRequiredCount, '0')}`,
    `Memory Librarian Canon Candidate Count: ${asText(runtimeStatus?.memoryLibrarianCanonCandidateCount, '0')}`,
    `Memory Librarian Project Lesson Count: ${asText(runtimeStatus?.memoryLibrarianProjectLessonCount, '0')}`,
    `Memory Librarian Capability Gap Count: ${asText(runtimeStatus?.memoryLibrarianCapabilityGapCount, '0')}`,
    `Memory Librarian Duplicate Count: ${asText(runtimeStatus?.memoryLibrarianDuplicateCount, '0')}`,
    `Memory Librarian Conflict Count: ${asText(runtimeStatus?.memoryLibrarianConflictCount, '0')}`,
    `Memory Librarian Saved Count: ${asText(runtimeStatus?.memoryLibrarianSavedCount, '0')}`,
    `Memory Librarian Rejected Count: ${asText(runtimeStatus?.memoryLibrarianRejectedCount, '0')}`,
    `Mission Evidence Ledger Status: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerStatus, 'unavailable')}`,
    `Mission Evidence Ledger Mission ID: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerMissionId, 'mission-unknown')}`,
    `Mission Evidence Ledger Mission Title: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerMissionTitle, 'unknown')}`,
    `Mission Evidence Ledger Mission Phase: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerMissionPhase, 'unknown')}`,
    `Mission Evidence Ledger Completeness: ${asText(missionEvidenceLedgerFields.missionEvidenceCompleteness, 'low')}`,
    `Mission Evidence Ledger Entry Count: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerEntryCount, '0')}`,
    `Mission Evidence Ledger Proof Entry Count: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerProofEntryCount, '0')}`,
    `Mission Evidence Ledger Warning Count: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerWarningCount, '0')}`,
    `Mission Evidence Ledger Blocker Count: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerBlockerCount, '0')}`,
    `Mission Evidence Ledger Pending Review Count: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerPendingReviewCount, '0')}`,
    `Mission Evidence Ledger Latest Event: ${asText(missionEvidenceLedgerFields.missionEvidenceLatestEvent, 'none')}`,
    `Mission Evidence Ledger Next Required: ${asText(missionEvidenceLedgerFields.missionEvidenceNextRequired, 'none')}`,
    `Mission Evidence Ledger Next Action: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerNextAction, 'not reported')}`,
    `Mission Evidence Ledger Projection Source: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerProjectionSource, 'none')}`,
    `Mission Evidence Ledger Confidence: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerConfidence, 'low')}`,
    `Mission Evidence Ledger Durable Write Allowed: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerDurableWriteAllowed, 'no')}`,
    `Mission Evidence Ledger Operator Approval Required For Write: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerOperatorApprovalRequiredForWrite, 'yes')}`,
    `Mission Evidence Ledger Mutation Allowed: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerMutationAllowed, 'no')}`,
    `Mission Evidence Ledger OpenClaw Mutation Locked: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerOpenClawMutationLocked, 'yes')}`,
    `Mission Evidence Ledger Codex Auto Dispatch Allowed: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerCodexAutoDispatchAllowed, 'no')}`,
    `Mission Evidence Ledger Top Entry Summary: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerTopEntrySummary, 'none')}`,
    `Mission Evidence Ledger Missing Proof Summary: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerMissingProofSummary, 'none')}`,
    `Mission Evidence Ledger Trusted For Merge: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerTrustedForMerge, 'no')}`,
    `Mission Evidence Ledger Trusted For Canon: ${asText(missionEvidenceLedgerFields.missionEvidenceLedgerTrustedForCanon, 'no')}`,
    `Evidence Intake Automation Status: ${asText(evidenceReturnIntakeFields.evidenceIntakeAutomationStatus, 'idle')}`,
    `Evidence Intake Classified Proof Count: ${asText(evidenceReturnIntakeFields.evidenceIntakeClassifiedProofCount, '0')}`,
    `Evidence Intake Accepted Proof Items: ${asText(evidenceReturnIntakeFields.evidenceIntakeAcceptedProofItems, 'none')}`,
    `Evidence Intake Rejected Proof Items: ${asText(evidenceReturnIntakeFields.evidenceIntakeRejectedProofItems, 'none')}`,
    `Evidence Intake Classification Confidence: ${asText(evidenceReturnIntakeFields.evidenceIntakeClassificationConfidence, 'low')}`,
    `Evidence Intake Last Classified Source: ${asText(evidenceReturnIntakeFields.evidenceIntakeLastClassifiedSource, 'none')}`,
    `Evidence Intake Remaining Missing Items: ${asText(evidenceReturnIntakeFields.evidenceIntakeRemainingMissingItems, 'none')}`,
    `Command Deck Universal Intake Status: ${asText(executionMetadata?.command_deck_universal_intake_status, 'idle')}`,
    `Command Deck Universal Intake Last Kind: ${asText(executionMetadata?.command_deck_universal_intake_last_kind, 'none')}`,
    `Command Deck Universal Intake Last Kinds: ${asText(executionMetadata?.command_deck_universal_intake_last_kinds, 'none')}`,
    `Command Deck Universal Intake Routed To: ${asText(executionMetadata?.command_deck_universal_intake_routed_to, 'none')}`,
    `Command Deck Universal Intake Accepted Proof Items: ${asText(executionMetadata?.command_deck_universal_intake_accepted_proof_items || evidenceReturnIntakeFields.evidenceIntakeAcceptedProofItems, 'none')}`,
    `Command Deck Universal Intake Rejected Proof Items: ${asText(executionMetadata?.command_deck_universal_intake_rejected_proof_items || evidenceReturnIntakeFields.evidenceIntakeRejectedProofItems, 'none')}`,
    `Command Deck Universal Intake Echo Present: ${asText(executionMetadata?.command_deck_universal_intake_echo_present, 'no')}`,
    `Command Deck Universal Intake Echo Length: ${asText(executionMetadata?.command_deck_universal_intake_echo_length, '0')}`,
    `Command Deck Universal Intake Confidence: ${asText(executionMetadata?.command_deck_universal_intake_confidence, 'low')}`,
    `Command Deck Universal Intake Next Action: ${asText(executionMetadata?.command_deck_universal_intake_next_action || evidenceReturnIntakeFields.evidenceIntakeNextBestAction, 'Answer operator normally.')}`,
    `Command Deck Proof Session ID: ${asText(executionMetadata?.command_deck_proof_session_id, 'runtime-proof-session')}`,
    `Command Deck Cumulative Accepted Proof Items: ${asText(executionMetadata?.command_deck_cumulative_accepted_proof_items, (evidenceReturnIntakeProjection.cumulativeAcceptedProofItems || []).join('|') || 'none')}`,
    `Command Deck Cumulative Rejected Proof Items: ${asText(executionMetadata?.command_deck_cumulative_rejected_proof_items, (evidenceReturnIntakeProjection.cumulativeRejectedProofItems || []).join('|') || 'none')}`,
    `Command Deck Latest Accepted Proof Items: ${asText(executionMetadata?.command_deck_latest_accepted_proof_items || executionMetadata?.command_deck_universal_intake_accepted_proof_items, 'none')}`,
    `Command Deck Latest Rejected Proof Items: ${asText(executionMetadata?.command_deck_latest_rejected_proof_items || executionMetadata?.command_deck_universal_intake_rejected_proof_items, 'none')}`,
    `Command Deck Proof Accumulation Source: ${asText(executionMetadata?.command_deck_proof_accumulation_source, 'last-execution-metadata')}`,
    `Command Deck Proof Accumulation Status: ${asText(executionMetadata?.command_deck_proof_accumulation_status, 'cumulative-union')}`,
    `Command Deck Input Value Length After Submit: ${asText(executionMetadata?.command_deck_input_value_length_after_submit, 'unknown')}`,
    `Command Deck Input Visible Value Empty After Submit: ${asText(executionMetadata?.command_deck_input_visible_value_empty_after_submit, 'unknown')}`,
    `Command Deck Last Cleared Submit Kind: ${asText(executionMetadata?.command_deck_last_cleared_submit_kind, 'none')}`,
    `Command Deck Last Cleared At: ${asText(executionMetadata?.command_deck_last_cleared_at, 'none')}`,
    `Command Deck Last Clear Reason: ${asText(executionMetadata?.command_deck_last_clear_reason, 'none')}`,
    `Evidence Intake Echo Present: ${asText(executionMetadata?.evidence_intake_echo_present || evidenceReturnIntakeFields.evidenceIntakeEchoPresent, 'no')}`,
    `Evidence Intake Echo Source: ${asText(executionMetadata?.evidence_intake_echo_source || evidenceReturnIntakeFields.evidenceIntakeEchoSource, 'none')}`,
    `Evidence Intake Echo Classified Items: ${asText(executionMetadata?.evidence_intake_echo_classified_items || evidenceReturnIntakeFields.evidenceIntakeEchoClassifiedItems, 'none')}`,
    `Browser Proof Intake Status: ${asText(executionMetadata?.browser_proof_intake_status || evidenceReturnIntakeFields.browserProofIntakeStatus, 'unavailable')}`,
    `Browser Proof Known Caveat Present: ${asText(executionMetadata?.browser_proof_known_caveat_present || evidenceReturnIntakeFields.browserProofKnownCaveatPresent, 'no')}`,
    `Browser Proof Caveat Blocking: ${asText(executionMetadata?.browser_proof_caveat_blocking || evidenceReturnIntakeFields.browserProofCaveatBlocking, 'no')}`,
    `Browser Proof Rejection Reason: ${asText(executionMetadata?.browser_proof_rejection_reason || evidenceReturnIntakeFields.browserProofRejectionReason, 'none')}`,
    `Browser Proof Accepted With Caveat: ${asText(executionMetadata?.browser_proof_accepted_with_caveat || evidenceReturnIntakeFields.browserProofAcceptedWithCaveat, 'no')}`,
    `Mission Intent Echo Present: ${asText(executionMetadata?.mission_intent_echo_present, 'no')}`,
    `Mission Intent Echo Source: ${asText(executionMetadata?.mission_intent_echo_source, 'none')}`,
    `Source Pack / Packet Bay Echo: ${asText(executionMetadata?.source_pack_packet_bay_echo_present, 'no')}`,
    `Evidence Intake Next Best Action: ${asText(evidenceReturnIntakeFields.evidenceIntakeNextBestAction, 'Paste returned proof into Evidence Return Intake.')}`,
    `Evidence Return Intake Status: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeStatus, 'unavailable')}`,
    `Evidence Return Intake Available: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeAvailable, 'no')}`,
    `Evidence Return Intake Source: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeSource, 'none')}`,
    `Evidence Return Intake Related Packet ID: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeRelatedPacketId, 'none')}`,
    `Evidence Return Intake Related Mission ID: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeRelatedMissionId, 'mission-unknown')}`,
    `Evidence Return Intake Related Evidence Type: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeRelatedEvidenceType, 'none')}`,
    `Evidence Return Intake Parsed Result Present: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeParsedResultPresent, 'no')}`,
    `Evidence Return Intake Parsed Result Status: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeParsedResultStatus, 'unknown')}`,
    `Evidence Return Intake Proof Observed Count: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeProofObservedCount, '0')}`,
    `Evidence Return Intake Proof Failed Count: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeProofFailedCount, '0')}`,
    `Evidence Return Intake Proof Pending Review Count: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeProofPendingReviewCount, '0')}`,
    `Evidence Return Intake Proof Blocked Count: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeProofBlockedCount, '0')}`,
    `Evidence Return Intake Missing Proof Resolved: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeMissingProofResolved, 'no')}`,
    `Evidence Return Intake Remaining Missing Proof Summary: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeRemainingMissingProofSummary, 'none')}`,
    `Evidence Return Intake Trusted For Merge: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeTrustedForMerge, 'no')}`,
    `Evidence Return Intake Trusted For Canon: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeTrustedForCanon, 'no')}`,
    `Evidence Return Intake Recommended Next Action: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeRecommendedNextAction, 'Paste returned proof and classify/review.')}`,
    `Evidence Return Intake Mutation Allowed: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeMutationAllowed, 'no')}`,
    `Evidence Return Intake Durable Write Allowed: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeDurableWriteAllowed, 'no')}`,
    `Evidence Return Intake Operator Approval Required For Write: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeOperatorApprovalRequiredForWrite, 'yes')}`,
    `Evidence Return Intake OpenClaw Mutation Locked: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeOpenClawMutationLocked, 'yes')}`,
    `Evidence Return Intake Codex Auto Dispatch Allowed: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeCodexAutoDispatchAllowed, 'no')}`,
    `Evidence Return Intake Confidence: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeConfidence, 'low')}`,
    `Evidence Return Intake Warning Count: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeWarningCount, '0')}`,
    `Evidence Return Intake Summary: ${asText(evidenceReturnIntakeFields.evidenceReturnIntakeSummary, 'Evidence Return Intake unavailable.')}`,
    `Mission Evidence Context Available: ${missionEvidenceContextSummary.available ? 'yes' : 'no'}`,
    `Mission Evidence Context Source: ${asText(missionEvidenceContextSummary.source, 'none')}`,
    `Mission Evidence Context Injected: ${asText(executionMetadata?.mission_evidence_context_injected, 'no')}`,
    `Mission Evidence Context Prompt Block Length: ${String(missionEvidenceContextSummary.promptBlockLength || 0)}`,
    `Mission Evidence Context Next Required: ${asText(missionEvidenceContextSummary.nextRequiredEvidence, 'none')}`,
    `Mission Evidence Context Missing Proof Summary: ${asText(missionEvidenceContextSummary.missingProofSummary, 'none')}`,
    `Mission Evidence Context Trusted For Merge: ${missionEvidenceContextSummary.trustedForMerge ? 'yes' : 'no'}`,
    `Mission Evidence Context Trusted For Canon: ${missionEvidenceContextSummary.trustedForCanon ? 'yes' : 'no'}`,
    `Mission Command Packet Version: ${asText(runtimeStatus?.missionCommandPacketVersion, 'v1')}`,
    `Mission Command Packet Created: ${asText(runtimeStatus?.missionCommandPacketCreated, 'n/a')}`,
    `Mission Command Packet Included Systems: ${asText(runtimeStatus?.missionCommandPacketIncludedSystems, 'none')}`,
    `Mission Command Packet Warning Count: ${asText(runtimeStatus?.missionCommandPacketWarningCount, '0')}`,
    `Mission Command Packet Next Action: ${asText(runtimeStatus?.missionCommandPacketNextAction, 'not reported')}`,
    `Mission Command Packet Ready: ${asText(runtimeStatus?.missionCommandPacketReady, 'no')}`,
    `Agent Assignment Count: ${asText(runtimeStatus?.agentAssignmentCount, '0')}`,
    `Agent Assignment Active Roles: ${asText(runtimeStatus?.agentAssignmentActiveRoles, '0')}`,
    `Agent Assignment Lead Role: ${asText(runtimeStatus?.agentAssignmentLeadRole, 'operator')}`,
    `Agent Assignment OpenClaw Assigned: ${asText(runtimeStatus?.agentAssignmentOpenClawAssigned, 'no')}`,
    `Agent Assignment Codex Assigned: ${asText(runtimeStatus?.agentAssignmentCodexAssigned, 'yes')}`,
    `Agent Assignment Operator Approval Required: ${asText(runtimeStatus?.agentAssignmentOperatorApprovalRequired, 'yes')}`,
    `Agent Assignment High Risk Count: ${asText(runtimeStatus?.agentAssignmentHighRiskCount, '0')}`,
    `Agent Assignment Blocked Count: ${asText(runtimeStatus?.agentAssignmentBlockedCount, '0')}`,
    `Mission Routing Status: ${asText(runtimeStatus?.missionRoutingStatus, 'draft')}`,
    `Mission Routing Recommended Route: ${asText(runtimeStatus?.missionRoutingRecommendedRoute, 'operator_decision')}`,
    `Mission Routing Readiness Level: ${asText(runtimeStatus?.missionRoutingReadinessLevel, 'not_ready')}`,
    `Mission Routing Lead Role: ${asText(runtimeStatus?.missionRoutingLeadRole, 'operator')}`,
    `Mission Routing Codex Ready: ${asText(runtimeStatus?.missionRoutingCodexReady, 'no')}`,
    `Mission Routing OpenClaw Research Ready: ${asText(runtimeStatus?.missionRoutingOpenClawResearchReady, 'no')}`,
    `Mission Routing Operator Decision Required: ${asText(runtimeStatus?.missionRoutingOperatorDecisionRequired, 'yes')}`,
    `Mission Routing Blocker Count: ${asText(runtimeStatus?.missionRoutingBlockerCount, '0')}`,
    `Mission Routing Warning Count: ${asText(runtimeStatus?.missionRoutingWarningCount, '0')}`,
    `Mission Routing Next Action: ${asText(runtimeStatus?.missionRoutingNextAction, 'Await operator decision.')}`,
    `Task Finisher Plan Status: ${asText(runtimeStatus?.taskFinisherPlanStatus, 'unknown')}`,
    `Task Finisher Safe To Continue: ${asText(runtimeStatus?.taskFinisherSafeToContinue, 'no')}`,
    `Task Finisher Routine Task Count: ${asText(runtimeStatus?.taskFinisherRoutineTaskCount, '0')}`,
    `Task Finisher Blocked Task Count: ${asText(runtimeStatus?.taskFinisherBlockedTaskCount, '0')}`,
    `Task Finisher Codex Repair Needed: ${asText(runtimeStatus?.taskFinisherCodexRepairNeeded, 'no')}`,
    `Task Finisher Rebuild Dist Needed: ${asText(runtimeStatus?.taskFinisherRebuildDistNeeded, 'no')}`,
    `Task Finisher Memory Review Needed: ${asText(runtimeStatus?.taskFinisherMemoryReviewNeeded, 'no')}`,
    `Task Finisher Merge Operator Controlled: ${asText(runtimeStatus?.taskFinisherMergeOperatorControlled, 'yes')}`,
    `Task Finisher Warning Level: ${asText(runtimeStatus?.taskFinisherWarningLevel, 'none')}`,
    `Task Finisher Next Action: ${asText(runtimeStatus?.taskFinisherNextAction, 'not reported')}`,
    `Chat Context Pack Status: ${asText(normalizedChatContextStatus, 'unavailable')}`,
    `Chat Context Version: ${asText(chatContextVersion, 'n/a')}`,
    `Chat Context Response Mode: ${asText(chatContextResponseMode, 'direct-answer')}`,
    `Chat Context Relevant Canon Count: ${asText(chatContextRelevantCanonCount, '0')}`,
    `Chat Context Affected Subsystems: ${asText(chatContextAffectedSubsystems, 'none')}`,
    `Chat Context Sources Used: ${asText(normalizedChatContextSourcesUsed, 'none')}`,
    `Chat Context Co-Builder Context Included: ${asText(chatContextCoBuilderContextIncluded, 'no')}`,
    `Chat Context Agent Work Routing Context Included: ${asText(chatContextAgentWorkRoutingContextIncluded, 'no')}`,
    `Builder Mesh Context Included: ${asText(chatContextBuilderMeshContextIncluded, 'no')}`,
    `Builder Mesh Projection Available: ${asText(executionMetadata?.builder_mesh_projection_available, 'no')}`,
    `Builder Mesh Status: ${asText(executionMetadata?.builder_mesh_status, 'unavailable')}`,
    `Builder Mesh Recommended Builder: ${asText(executionMetadata?.builder_mesh_recommended_builder, 'hold')}`,
    `Builder Mesh Zero-Cost Route Available: ${asText(executionMetadata?.builder_mesh_zero_cost_route_available, 'no')}`,
    `Builder Mesh Codex Required: ${asText(executionMetadata?.builder_mesh_codex_required, 'no')}`,
    `Builder Mesh Codex Reason: ${asText(executionMetadata?.builder_mesh_codex_reason, 'Codex is fallback only unless justified.')}`,
    `Builder Mesh Local AI Can Help: ${asText(executionMetadata?.builder_mesh_local_ai_can_help, 'unknown')}`,
    `Builder Mesh OpenClaw Can Help: ${asText(executionMetadata?.builder_mesh_openclaw_can_help, 'unknown')}`,
    `Builder Mesh GitHub Can Help: ${asText(executionMetadata?.builder_mesh_github_can_help, 'unknown')}`,
    `Builder Mesh Next Best Action: ${asText(executionMetadata?.builder_mesh_next_best_action, 'Review Builder Mesh truth.')}`,
    `Builder Mesh Projection Source: ${asText(executionMetadata?.builder_mesh_projection_source, 'none')}`,
    `Builder Mesh Metadata Source: ${asText(executionMetadata?.builder_mesh_metadata_source, 'none')}`,
    `Builder Mesh Deterministic Answer Used: ${asText(executionMetadata?.builder_mesh_deterministic_answer_used || executionMetadata?.builder_mesh_answer_used_live_projection, 'no')}`,
    `Builder Mesh Projection Drop Boundary: ${asText(executionMetadata?.builder_mesh_projection_drop_boundary, 'none')}`,
    `Packet Bay Status: ${asText(packetBayFields.packet_bay_status, 'empty-clean')}`,
    `Packet Inbox Count: ${asText(packetBayFields.packet_inbox_count, '0')}`,
    `Packet Outbox Count: ${asText(packetBayFields.packet_outbox_count, '0')}`,
    `Packet Ready To Copy Count: ${asText(packetBayFields.packet_ready_to_copy_count, '0')}`,
    `Packet Awaiting Result Count: ${asText(packetBayFields.packet_awaiting_result_count, '0')}`,
    `Packet Blocked Count: ${asText(packetBayFields.packet_blocked_count, '0')}`,
    `Packet Recommended Next Action: ${asText(packetBayFields.packet_recommended_next_action, 'No packets waiting.')}`,
    `Packet Projection Source: ${asText(packetBayFields.packet_projection_source, 'none')}`,
    `Packet Mutation Allowed: ${asText(packetBayFields.packet_mutation_allowed, 'no')}`,
    `Packet OpenClaw Mutation Locked: ${asText(packetBayFields.packet_openclaw_mutation_locked, 'yes')}`,
    `Packet Codex Auto Dispatch Allowed: ${asText(packetBayFields.packet_codex_auto_dispatch_allowed, 'no')}`,
    `Packet Latest Ready Target: ${asText(packetBayFields.packet_latest_ready_target, 'none')}`,
    `Packet Latest Ready Kind: ${asText(packetBayFields.packet_latest_ready_kind, 'none')}`,
    `Packet Latest Ready ID: ${asText(packetBayFields.packet_latest_ready_id, 'none')}`,
    `Packet Missing Proof Summary: ${asText(packetBayFields.packet_missing_proof_summary, 'none')}`,
    `Packet Bay Evidence Packet Count: ${asText(packetBayFields.packet_bay_evidence_packet_count, packetBayProjection.evidencePacketCount ?? '0')}`,
    `Packet Bay Evidence Review Packet Ready: ${asText(packetBayFields.packet_bay_evidence_review_packet_ready, packetBayProjection.evidenceReviewPacketReady ? 'yes' : 'no')}`,
    `Packet Bay Browser Proof Packet Ready: ${asText(packetBayFields.packet_bay_browser_proof_packet_ready, packetBayProjection.browserProofPacketReady ? 'yes' : 'no')}`,
    `Packet Bay PR Evidence Packet Ready: ${asText(packetBayFields.packet_bay_pr_evidence_packet_ready, packetBayProjection.prEvidencePacketReady ? 'yes' : 'no')}`,
    `OpenClaw Control Bridge Status: ${asText(openClawControlBridge.bridgeStatus, 'manual-control-readonly')}`,
    `OpenClaw Gateway Target: ${asText(openClawControlBridge.gatewayTarget, 'ws://127.0.0.1:18789')}`,
    `OpenClaw Dashboard URL: ${asText(openClawControlBridge.dashboardUrl, 'http://127.0.0.1:18789/')}`,
    `OpenClaw Local Scout Expected Model: ${asText(openClawControlBridge.expectedLocalModels?.[0], 'ollama/llama3.2:3b')}`,
    `OpenClaw Local Scout Proof Status: ${asText(openClawControlBridge.localScoutProofStatus, 'unknown')}`,
    `OpenClaw Mutation Locked: ${openClawControlBridge.mutationAuthority === 'locked' ? 'yes' : 'no'}`,
    `OpenClaw Auto-Start Forbidden: ${openClawControlBridge.autoStart === 'forbidden' ? 'yes' : 'no'}`,
    `OpenClaw Operator Approval Required: ${asText(openClawControlBridge.operatorApprovalRequired, 'yes')}`,
    `OpenClaw Last Proof Command Present: ${openClawControlBridge.lastProofCommand ? 'yes' : 'no'}`,
    `OpenClaw Dashboard Temporary Cockpit: ${asText(openClawControlBridge.dashboardTemporaryCockpit, 'yes')}`,
    `Builder Workbench Status: ${asText(builderWorkbenchSupportMetadata.builder_workbench_status, 'unavailable')}`,
    `Local AI Runner Status: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_status, 'idle')}`,
    `Local AI Runner Selected Model: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_selected_model, 'none')}`,
    `Local AI Runner Last Run Result: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_last_run_result, 'none')}`,
    `Local AI Runner Last Run Blocked Reason: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_last_run_blocked_reason, 'none')}`,
    `Local AI Runner Blocked Reason: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_last_run_blocked_reason, 'none')}`,
    `Local AI Runner Error Message: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_error_message, 'none')}`,
    `Local AI Runner Dispatch Attempted: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_dispatch_attempted, 'no')}`,
    `Local AI Runner Request Sent: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_request_sent, 'no')}`,
    `Local AI Runner Parsed Result Present: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_parsed_result_present, 'no')}`,
    `Workbench Answer Context Used: ${asText(builderWorkbenchSupportMetadata.workbench_answer_context_used, 'no')}`,
    `Workbench Answer Source: ${asText(builderWorkbenchSupportMetadata.workbench_answer_source, 'none')}`,
    `Workbench Parsed Result Source: ${asText(builderWorkbenchSupportMetadata.workbench_parsed_result_source, 'none')}`,
    `Local AI Runner Response Retained: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_response_retained, 'no')}`,
    `Local AI Runner Parse Attempted: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_parse_attempted, 'no')}`,
    `Local AI Runner Parse Input Length: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_parse_input_length, '0')}`,
    `Local AI Runner Parse Result Status: ${asText(builderWorkbenchSupportMetadata.local_ai_runner_parse_result_status, 'empty')}`,
    `Workbench Output Viewport Status: ${asText(builderWorkbenchSupportMetadata.workbench_output_viewport_status, 'unknown')}`, 
    `Local AI Review Result Present: ${asText(builderWorkbenchSupportMetadata.builder_workbench_local_ai_review_result_present, 'no')}`,
    `OpenClaw Research Result Present: ${asText(builderWorkbenchSupportMetadata.builder_workbench_openclaw_research_result_present, 'no')}`,
    `OpenClaw Web Research Intake Status: ${asText(builderWorkbenchSupportMetadata.openclaw_web_research_intake_status, 'idle')}`,
    `OpenClaw Web Access Status: ${asText(builderWorkbenchSupportMetadata.openclaw_web_access_status, 'unknown')}`,
    `OpenClaw Research Source Count: ${asText(builderWorkbenchSupportMetadata.openclaw_research_source_count, '0')}`,
    `OpenClaw Research Valid URL Count: ${asText(builderWorkbenchSupportMetadata.openclaw_research_valid_url_count, '0')}`,
    `OpenClaw Research Placeholder Leakage Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_research_placeholder_leakage_detected, 'no')}`,
    `OpenClaw Research Forbidden Leakage Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_research_forbidden_leakage_detected, 'no')}`,
    `OpenClaw Research Task Frame Adherence: ${asText(builderWorkbenchSupportMetadata.openclaw_research_task_frame_adherence, 'unknown')}`,
    `OpenClaw Research Trusted For Canon: ${asText(builderWorkbenchSupportMetadata.openclaw_research_trusted_for_canon, 'no')}`,
    `OpenClaw Research Next Operator Action: ${asText(builderWorkbenchSupportMetadata.openclaw_research_next_operator_action, 'Copy the bounded prompt, run OpenClaw externally/manually, then paste source-cited results for deterministic intake.')}`,
    `Patch Plan Present: ${asText(builderWorkbenchSupportMetadata.builder_workbench_patch_plan_present, 'no')}`,
    `Patch Plan Risk: ${asText(builderWorkbenchSupportMetadata.builder_workbench_patch_plan_risk, 'unknown')}`,
    `Approval Required Before Patch: ${asText(builderWorkbenchSupportMetadata.builder_workbench_approval_required_before_patch, 'yes')}`,
    `Codex Fallback Still Needed: ${asText(builderWorkbenchSupportMetadata.builder_workbench_codex_fallback_still_needed, 'no')}`,
    `Codex Fallback Reason: ${asText(builderWorkbenchSupportMetadata.builder_workbench_codex_fallback_reason, 'none')}`,
    `Builder Workbench Next Best Action: ${asText(builderWorkbenchSupportMetadata.builder_workbench_next_best_action, 'Copy Local AI/OpenClaw packets and paste bounded read-only results.')}`,
    `OpenClaw Route ID: ${asText(builderWorkbenchSupportMetadata.openclaw_route_id, 'unknown')}`,
    `OpenClaw Route Label: ${asText(builderWorkbenchSupportMetadata.openclaw_route_label, 'unknown')}`,
    `OpenClaw Route Trust Status: ${asText(builderWorkbenchSupportMetadata.openclaw_route_trust_status, 'untrusted')}`,
    `OpenClaw Route Sanity Status: ${asText(builderWorkbenchSupportMetadata.openclaw_route_sanity_status, 'unknown')}`,
    `OpenClaw Route Task Frame Status: ${asText(builderWorkbenchSupportMetadata.openclaw_route_task_frame_status, 'unknown')}`,
    `OpenClaw Route Session ID: ${asText(builderWorkbenchSupportMetadata.openclaw_route_session_id, 'unknown')}`,
    `OpenClaw Active Session Count: ${asText(builderWorkbenchSupportMetadata.openclaw_active_session_count, '0')}`,
    `OpenClaw Active Session Contamination Risk: ${asText(builderWorkbenchSupportMetadata.openclaw_active_session_contamination_risk, 'no')}`,
    `OpenClaw Route Model Pinned: ${asText(builderWorkbenchSupportMetadata.openclaw_route_model_pinned, 'unknown')}`,
    `OpenClaw Route Model Configured Primary: ${asText(builderWorkbenchSupportMetadata.openclaw_route_model_configured_primary, 'unknown')}`,
    `OpenClaw Route Model Mismatch Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_route_model_mismatch_detected, 'no')}`,
    `OpenClaw Model Pin Mismatch Warnings: ${asText(builderWorkbenchSupportMetadata.openclaw_model_pin_mismatch_warnings, 'none')}`,
    `OpenClaw Plaintext Token Security Warning: ${asText(builderWorkbenchSupportMetadata.openclaw_plaintext_token_security_warning, 'no')}`,
    `OpenClaw Doctor Non-Blocking Findings: ${asText(builderWorkbenchSupportMetadata.openclaw_doctor_non_blocking_findings, 'none')}`,
    `OpenClaw Dashboard Failure Examples: ${asText(builderWorkbenchSupportMetadata.openclaw_dashboard_failure_examples, 'none')}`,
    `OpenClaw Minimum Viable Route Recommendation: ${asText(builderWorkbenchSupportMetadata.openclaw_minimum_viable_route_recommendation, 'Use stephanos-scout / llama3.2 CLI for bounded source-pack processing only; OpenClaw cannot mutate files.')}`,
    `OpenClaw Sanity Status: ${asText(builderWorkbenchSupportMetadata.openclaw_sanity_status, 'idle')}`,
    `OpenClaw Sanity Failure Reason: ${asText(builderWorkbenchSupportMetadata.openclaw_sanity_failure_reason, 'none')}`,
    `OpenClaw Exact Response Status: ${asText(builderWorkbenchSupportMetadata.openclaw_exact_response_status, 'unknown')}`,
    `OpenClaw Exact Response Payload: ${asText(builderWorkbenchSupportMetadata.openclaw_exact_response_payload, 'none')}`,
    `OpenClaw CLI Banner Ignored: ${asText(builderWorkbenchSupportMetadata.openclaw_cli_banner_ignored, 'no')}`,
    `OpenClaw Template Leakage Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_template_leakage_detected, 'no')}`,
    `OpenClaw Wrong Repo Path Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_wrong_repo_path_detected, 'no')}`,
    `OpenClaw Trusted For Builder Routing: ${asText(builderWorkbenchSupportMetadata.openclaw_trusted_for_builder_routing, 'no')}`,
    `OpenClaw Sanity Next Operator Action: ${asText(builderWorkbenchSupportMetadata.openclaw_sanity_next_operator_action, 'Paste an OpenClaw result to run the sanity gate before Builder Mesh routing.')}`,
    `OpenClaw Workspace Hygiene Status: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_hygiene_status, 'clean')}`,
    `OpenClaw Workspace Dirt Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_dirt_detected, 'no')}`,
    `OpenClaw Workspace Dirt Paths: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_dirt_paths, 'none')}`,
    `OpenClaw Workspace Dirt Count: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_dirt_count, '0')}`,
    `OpenClaw Workspace Blocks Ignition: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_blocks_ignition, 'no')}`,
    `OpenClaw Workspace Recommended Cleanup: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_recommended_cleanup, 'No cleanup needed.')}`,
    `OpenClaw Workspace Safe Runtime Directory: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_safe_runtime_directory, 'unknown')}`,
    `OpenClaw Workspace Mutation Authority: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_mutation_authority, 'locked')}`,
    `OpenClaw Workspace Next Operator Action: ${asText(builderWorkbenchSupportMetadata.openclaw_workspace_next_operator_action, 'No OpenClaw workspace dirt detected.')}`,
    `OpenClaw Patch Planner Status: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_status, 'idle')}`,
    `OpenClaw Patch Planner Risk Level: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_risk_level, 'unknown')}`,
    `OpenClaw Patch Planner Likely File Count: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_likely_file_count, '0')}`,
    `OpenClaw Patch Planner Required Test Count: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_required_test_count, '0')}`,
    `OpenClaw Patch Planner Browser Proof Required: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_browser_proof_required, 'unknown')}`,
    `OpenClaw Patch Planner Forbidden Action Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_forbidden_action_detected, 'no')}`,
    `OpenClaw Patch Planner Placeholder Leakage Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_placeholder_leakage_detected, 'no')}`,
    `OpenClaw Patch Planner Codex Fallback Needed: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_codex_fallback_needed, 'unknown')}`,
    `OpenClaw Patch Planner Trusted For Patch: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_trusted_for_patch, 'no')}`,
    `OpenClaw Patch Planner Next Operator Action: ${asText(builderWorkbenchSupportMetadata.openclaw_patch_planner_next_operator_action, 'Copy the OpenClaw Patch Planner Prompt and run it externally/read-only.')}`,
    `Builder Mesh Status: ${asText(builderWorkbenchSupportMetadata.builder_mesh_status, 'unavailable')}`,
    `Builder Mesh Recommended Builder: ${asText(builderWorkbenchSupportMetadata.builder_mesh_recommended_builder, 'hold')}`,
    `Builder Mesh Reason: ${asText(builderWorkbenchSupportMetadata.builder_mesh_reason, 'Operator clarification is required before routing.')}`,
    `Builder Mesh Task Kind: ${asText(builderWorkbenchSupportMetadata.builder_mesh_task_kind, 'unknown')}`,
    `Builder Mesh OpenClaw Eligible: ${asText(builderWorkbenchSupportMetadata.builder_mesh_openclaw_eligible, 'no')}`,
    `Builder Mesh Local AI Eligible: ${asText(builderWorkbenchSupportMetadata.builder_mesh_local_ai_eligible, 'no')}`,
    `Builder Mesh Codex Eligible: ${asText(builderWorkbenchSupportMetadata.builder_mesh_codex_eligible, 'no')}`,
    `Builder Mesh Required Proof: ${asText(builderWorkbenchSupportMetadata.builder_mesh_required_proof, 'none')}`,
    `Builder Mesh Missing Proof: ${asText(builderWorkbenchSupportMetadata.builder_mesh_missing_proof, 'none')}`,
    `Builder Mesh Next Best Action: ${asText(builderWorkbenchSupportMetadata.builder_mesh_next_best_action, 'Hold for operator clarification.')}`,
    `Builder Mesh Projection Source: ${asText(builderWorkbenchSupportMetadata.builder_mesh_projection_source, 'none')}`,
    `OpenClaw Source Pack Runner Status: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_runner_status, 'idle')}`,
    `OpenClaw Source Pack Route: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_route, 'stephanos-scout / llama3.2 CLI')}`,
    `OpenClaw Source Pack Model: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_model, 'ollama/llama3.2:3b')}`,
    `OpenClaw Source Pack Result Present: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_result_present, 'no')}`,
    `OpenClaw Source Pack Source-Bounded: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_source_bounded, 'unknown')}`,
    `OpenClaw Source Pack Hallucinated Sources Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_hallucinated_sources_detected, 'no')}`,
    `OpenClaw Source Pack Template Leakage Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_template_leakage_detected, 'no')}`,
    `OpenClaw Source Pack Asks For Next Detected: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_asks_for_next_detected, 'no')}`,
    `OpenClaw Source Pack Useful Fact Count: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_useful_fact_count, '0')}`,
    `OpenClaw Source Pack Unknown Count: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_unknown_count, '0')}`,
    `OpenClaw Source Pack Risk Count: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_risk_count, '0')}`,
    `OpenClaw Source Pack Next Question Count: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_next_question_count, '0')}`,
    `OpenClaw Source Pack Handoff Present: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_handoff_present, 'no')}`,
    `OpenClaw Source Pack Trusted For Canon: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_trusted_for_canon, 'no')}`,
    `OpenClaw Source Pack Trusted For Research: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_trusted_for_research, 'no')}`,
    `OpenClaw Source Pack Judgment Stale: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_judgment_stale, 'no')}`,
    `OpenClaw Source Pack Last Judged Text Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_last_judged_text_length, '0')}`,
    `OpenClaw Source Pack Current Text Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_current_text_length, '0')}`,
    `OpenClaw Source Pack Last Judged Output Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_last_judged_output_length, '0')}`,
    `OpenClaw Source Pack Current Output Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_current_output_length, '0')}`,
    `OpenClaw Source Pack Text Textarea Mounted: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_text_textarea_mounted, 'unknown')}`,
    `OpenClaw Source Pack Output Textarea Mounted: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_output_textarea_mounted, 'unknown')}`,
    `OpenClaw Source Pack Text DOM Value Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_text_dom_value_length, '0')}`,
    `OpenClaw Source Pack Output DOM Value Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_output_dom_value_length, '0')}`,
    `OpenClaw Source Pack Output OnChange Fired: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_output_onchange_fired, 'no')}`,
    `OpenClaw Source Pack Output State Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_output_state_length, '0')}`,
    `OpenClaw Source Pack Judgment Button Clicked: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_judgment_button_clicked, 'no')}`,
    `OpenClaw Source Pack Judgment Read Output Length: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_judgment_read_output_length, '0')}`,
    `OpenClaw Source Pack Judgment Read Source: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_judgment_read_source, 'not-run')}`,
    `OpenClaw Source Pack Active Surface: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_active_surface, 'unknown')}`,
    `OpenClaw Source Pack Runner Render Gate: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_runner_render_gate, 'unknown')}`,
    `OpenClaw Source Pack Runner Render Blocker: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_runner_render_blocker, 'unknown')}`,
    `OpenClaw Source Pack Parent Panel ID: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_parent_panel_id, 'unknown')}`,
    `OpenClaw Source Pack Controls Mounted Count: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_controls_mounted_count, '0')}`,
    `OpenClaw Source Pack Projection Written: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_projection_written, 'no')}`,
    `OpenClaw Source Pack Projection Source: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_projection_source, 'source-pack-runner-idle')}`,
    `OpenClaw Source Pack Codex Fallback Needed: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_codex_fallback_needed, 'unknown')}`,
    `OpenClaw Source Pack Next Operator Action: ${asText(builderWorkbenchSupportMetadata.openclaw_source_pack_next_operator_action, 'Copy the Source Pack CLI Prompt and paste a bounded source-pack result.')}`,
    `Builder Workbench Projection Source: ${asText(builderWorkbenchSupportMetadata.builder_workbench_projection_source, 'none')}`,
    `Builder Workbench Metadata Source: ${asText(builderWorkbenchSupportMetadata.builder_workbench_metadata_source, 'none')}`,
    `Builder Workbench Deterministic Answer Used: ${asText(builderWorkbenchSupportMetadata.builder_workbench_deterministic_answer_used, 'no')}`,
    `Builder Workbench Projection Drop Boundary: ${asText(builderWorkbenchSupportMetadata.builder_workbench_projection_drop_boundary, 'none')}`,
    `Chat Context UI Reality Status: ${asText(chatContextUiRealityStatus, 'UNKNOWN')}`,
    `Chat Context Mission State: ${asText(chatContextMissionState, 'unknown')}`,
    `Chat Context Next Action: ${asText(chatContextNextAction, 'Submit a Command Deck message to generate context pack.')}`,
    `Chat Context Warning Count: ${asText(chatContextWarningCount, '0')}`,
    `Chat Context Warnings: ${asText(chatContextWarnings, 'none')}`,
    `Chat Context Metadata Source: ${asText(chatContextMetadataSource, 'none')}`,
    `Chat Context Metadata Found In: ${asText(chatContextMetadataFoundIn, 'none')}`,
    `Chat Context Request Metadata Present: ${asText(chatContextRequestMetadataPresent, 'no')}`,
    `Chat Context Final Execution Metadata Present: ${asText(chatContextFinalExecutionMetadataPresent, 'no')}`,
    `Chat Context Dropped Before Snapshot: ${asText(chatContextDroppedBeforeSnapshot, 'no')}`,
    `Chat Context Debug Keys Present: ${asText(chatContextDebugKeysPresent, 'none')}`,
    `Chat Context Attachment Probe: ${asText(chatContextAttachmentProbe, 'none')}`,
    `Chat Context Attachment Probe Response Mode: ${asText(chatContextAttachmentProbeResponseMode, 'n/a')}`,
    `Chat Context Attachment Probe Present: ${asText(chatContextAttachmentProbePresent, 'no')}`,
    `Chat Context Raw Operator Message Seen: ${asText(chatContextRawOperatorMessageSeen, 'n/a')}`,
    `Chat Context Normalized Operator Message: ${asText(chatContextNormalizedOperatorMessage, 'n/a')}`,
    `Chat Context Intent Classifier Matched Rule: ${asText(chatContextIntentClassifierMatchedRule, 'n/a')}`,
    `Chat Context Match Input: ${asText(chatContextMatchInput, 'n/a')}`,
    `Chat Context Merge Rule Pattern: ${asText(chatContextMergeRulePattern, 'none')}`,
    `Chat Context Merge Rule Test Result: ${asText(chatContextMergeRuleTestResult, 'no')}`,
    `Chat Context First Matching Rule: ${asText(chatContextFirstMatchingRule, 'n/a')}`,
    `Chat Context Evaluated Rule Results: ${asText(chatContextEvaluatedRuleResults, 'n/a')}`,
    `Chat Context Build Source: ${asText(chatContextBuildSource, 'n/a')}`,
    `Chat Context Default Pack Used: ${asText(chatContextDefaultPackUsed, 'n/a')}`,
    `Chat Context Was Overwritten: ${asText(chatContextWasOverwritten, 'no')}`,
    `Chat Context Rebuilt At Final Attachment: ${asText(chatContextRebuiltAtFinalAttachment, 'no')}`,
    `Chat Context Rebuild Source Field: ${asText(chatContextRebuildSourceField, 'none')}`,
    `Chat Context Classifier Proof Source: ${asText(chatContextClassifierProofSource, 'missing')}`,
    `Context Provider Registry Status: ${asText(contextProviderRegistryStatus, 'unavailable')}`,
    `Context Providers Registered: ${asText(contextProvidersRegistered, 'none')}`,
    `Context Providers Used: ${asText(contextProvidersUsed, 'none')}`,
    `Context Provider Warning Count: ${asText(contextProviderWarningCount, '0')}`,
    `Context Provider Proof State: ${asText(contextProviderProofState, 'unknown')}`,
    `Context Provider Next Actions: ${asText(contextProviderNextActions, 'none')}`,
    `Context Provider Canon Links Count: ${asText(contextProviderCanonLinksCount, '0')}`,
    `Operator Profile Status: ${asText(operatorNameKnown === 'yes' ? 'known' : 'unknown', 'unknown')}`,
    `Operator Name Known: ${asText(operatorNameKnown, 'no')}`,
    `Operator Name: ${asText(operatorName, 'unknown')}`,
    `Operator Identity Source: ${asText(operatorIdentitySource, 'none')}`,
    `Operator Identity Confidence: ${asText(operatorIdentityConfidence, 'unknown')}`,
    `Chat Context Operator Profile Used: ${asText(chatContextOperatorProfileUsed, 'no')}`,
    `Chat Context Operator Name Available: ${asText(chatContextOperatorNameAvailable, 'no')}`,
    `Operator Identity Updated At: ${asText(operatorIdentityUpdatedAt, 'unknown')}`,
    `Operator Identity Next Action: ${asText(operatorIdentityNextAction, 'Ask operator for preferred name when relevant.')}`,
    `Operator Profile Rehydrated: ${asText(operatorProfileRehydrated, 'no')}`,
    `Operator Profile Storage Key: ${asText(operatorProfileStorageKey, 'stephanos.operator.profile.v1')}`,
    `Operator Profile Storage Read Status: ${asText(operatorProfileStorageReadStatus, 'missing')}`,
    `Operator Profile Last Read At: ${asText(operatorProfileLastReadAt, 'unknown')}`,
    `Operator Profile Last Write At: ${asText(operatorProfileLastWriteAt, 'unknown')}`,
    `Active Mission Status: ${asText(activeMissionStatus, 'unknown')}`,
    `Active Mission ID: ${asText(activeMissionId, 'unknown')}`,
    `Active Mission Title: ${asText(activeMissionTitle, 'unknown')}`,
    `Active Mission Phase: ${asText(activeMissionPhase, 'unknown')}`,
    `Active Mission Current Focus: ${asText(activeMissionCurrentFocus, 'unknown')}`,
    `Active Mission Next Recommended Step: ${asText(activeMissionNextStep, 'unknown')}`,
    `Active Mission Proof State: ${asText(activeMissionProofState, 'unknown')}`,
    `Active Mission Related Systems: ${asText(activeMissionRelatedSystems, 'none')}`,
    `Active Mission Rehydrated: ${asText(activeMissionRehydrated, 'no')}`,
    `Active Mission Storage Key: ${asText(activeMissionStorageKey, 'stephanos.active.mission.v1')}`,
    `Active Mission Raw Transcript Stored: ${asText(activeMissionRawTranscriptStored, 'no')}`,
    `Project Awareness Pack Status: ${asText(projectAwarenessPackStatus, 'unavailable')}`,
    `Project Awareness Projection Source: ${asText(projectAwarenessFields.project_awareness_projection_source, 'none')}`,
    `Project Awareness Sources Used: ${asText(projectAwarenessSourcesUsed, 'none')}`,
    `Project Awareness Mission ID: ${asText(projectAwarenessFields.project_awareness_mission_id, 'unknown')}`,
    `Project Awareness Mission Phase: ${asText(projectAwarenessFields.project_awareness_mission_phase, 'unknown')}`,
    `Project Awareness Current Focus: ${asText(projectAwarenessFields.project_awareness_current_focus, 'unknown')}`,
    `Project Awareness Recommended Route: ${asText(projectAwarenessFields.project_awareness_recommended_route, 'hold')}`,
    `Project Awareness Recommended Route Reason: ${asText(projectAwarenessFields.project_awareness_recommended_route_reason, 'unknown')}`,
    `Project Awareness Confidence: ${asText(projectAwarenessFields.project_awareness_confidence, 'low')}`,
    `Project Awareness Rehydrated: ${asText(projectAwarenessFields.project_awareness_rehydrated, 'no')}`,
    `Project Awareness Rehydration Source: ${asText(projectAwarenessFields.project_awareness_rehydration_source, 'none')}`,
    `Project Awareness Prompt Injectable: ${asText(projectAwarenessFields.project_awareness_prompt_injectable, 'no')}`,
    `Project Awareness Proved Systems: ${asText(projectAwarenessFields.project_awareness_proved_systems, 'none')}`,
    `Project Awareness Affected Subsystems: ${asText(projectAwarenessFields.project_awareness_affected_subsystems, 'none')}`,
    `Project Awareness Missing Proof Summary: ${asText(projectAwarenessFields.project_awareness_missing_proof_summary, 'none')}`,
    `Project Awareness Blocker Count: ${asText(projectAwarenessFields.project_awareness_blocker_count, '0')}`,
    `Project Awareness Operator Decision Required: ${asText(projectAwarenessFields.project_awareness_operator_decision_required, 'no')}`,
    `Project Awareness Evidence Completeness: ${asText(projectAwarenessFields.project_awareness_evidence_completeness, 'unavailable')}`,
    `Project Awareness Evidence Next Required: ${asText(projectAwarenessFields.project_awareness_evidence_next_required, 'none')}`,
    `Project Awareness Evidence Missing Proof Summary: ${asText(projectAwarenessFields.project_awareness_evidence_missing_proof_summary, 'none')}`,
    `Project Awareness Evidence Context Source: ${asText(projectAwarenessFields.project_awareness_evidence_context_source, 'none')}`,
    `Project Awareness Current Mission: ${asText(projectAwarenessCurrentMission, 'unknown')}`,
    `Project Awareness Next Best Action: ${asText(projectAwarenessNextBestAction, 'unknown')}`,
    `Project Awareness Operator Workflow Preference: ${asText(projectAwarenessOperatorWorkflowPreference, 'unknown')}`,
    `Project Awareness Codex Role: ${asText(projectAwarenessCodexRole, 'unknown')}`,
    `Project Awareness OpenClaw Role: ${asText(projectAwarenessOpenClawRole, 'unknown')}`,
    `Project Awareness Warning Count: ${asText(projectAwarenessWarningCount, '0')}`,
    `Project Awareness Prompt Injected: ${asText(projectAwarenessPromptInjected, 'no')}`,
    `Project Awareness Prompt Block Length: ${asText(projectAwarenessPromptBlockLength, '0')}`,
    `Project Awareness Prompt Sources: ${asText(projectAwarenessPromptSources, 'none')}`,
    `Mission Planning Prompt Context Used: ${asText(missionPlanningPromptContextUsed, 'no')}`,
    `Work Routing Prompt Injected: ${asText(workRoutingPromptInjected, 'no')}`,
    `Work Routing Prompt Block Length: ${asText(workRoutingPromptBlockLength, '0')}`,
    `Work Routing Prompt Sources: ${asText(workRoutingPromptSources, 'none')}`,
    `Agent Reality Loop Context Recognized: ${asText(executionMetadata?.agent_reality_loop_context_recognized, 'no')}`,
    `Agent Reality Loop Context Source: ${asText(agentRealityLoopFields.agent_reality_loop_context_source || executionMetadata?.agent_reality_loop_context_source, 'none')}`,
    `Agent Reality Loop Context Injected: ${asText(agentRealityLoopFields.agent_reality_loop_context_injected || arlContextInjected, 'no')}`,
    `Agent Reality Loop Context Injection Blocker: ${asText(arlContextInjectionBlocker, 'none')}`,
    `ARL Projection Source: ${asText(arlProjectionSource, 'none')}`,
    `Agent Reality Loop Status: ${asText(agentRealityLoopFields.agent_reality_loop_status, 'unavailable')}`,
    `Agent Reality Loop Phase: ${asText(agentRealityLoopFields.agent_reality_loop_phase, 'observe')}`,
    `Agent Reality Loop Projection Available: ${asText(agentRealityLoopFields.agent_reality_loop_projection_available || executionMetadata?.agent_reality_loop_projection_available, 'no')}`,
    `Agent Reality Loop Recommended Lead: ${asText(agentRealityLoopFields.agent_reality_loop_recommended_lead || executionMetadata?.agent_reality_loop_recommended_lead, 'hold')}`,
    `Agent Reality Loop Recommended Lead Reason: ${asText(agentRealityLoopFields.agent_reality_loop_recommended_lead_reason, 'No Agent Reality Loop projection reason reported.')}`,
    `Agent Reality Loop Next Action: ${asText(agentRealityLoopFields.agent_reality_loop_next_action, 'Hold for current runtime truth.')}`,
    `Agent Reality Loop Next Packet ID: ${asText(agentRealityLoopFields.agent_reality_loop_next_packet_id, 'none')}`,
    `Agent Reality Loop Next Packet Target: ${asText(agentRealityLoopFields.agent_reality_loop_next_packet_target, 'none')}`,
    `Agent Reality Loop Next Packet Kind: ${asText(agentRealityLoopFields.agent_reality_loop_next_packet_kind, 'none')}`,
    `Agent Reality Loop Merge Recommendation: ${asText(executionMetadata?.agent_reality_loop_merge_recommendation, 'hold')}`,
    `Agent Reality Loop Copy Packets Available: ${asText(agentRealityLoopFields.agent_reality_loop_copy_packets_available || executionMetadata?.agent_reality_loop_copy_packets_available, 'no')}`,
    `Agent Reality Loop Awaiting Result From: ${asText(agentRealityLoopFields.agent_reality_loop_awaiting_result_from, 'none')}`,
    `Agent Reality Loop Expected Result Kind: ${asText(agentRealityLoopFields.agent_reality_loop_expected_result_kind, 'none')}`,
    `Agent Reality Loop Missing Proof Summary: ${asText(agentRealityLoopFields.agent_reality_loop_missing_proof_summary, 'none')}`,
    `Agent Reality Loop Raw Legacy Missing Proof Summary: ${asText(agentRealityLoopFields.agent_reality_loop_raw_legacy_missing_proof_summary, 'none')}`,
    `Agent Reality Loop Blocker Count: ${asText(agentRealityLoopFields.agent_reality_loop_blocker_count, '0')}`,
    `Agent Reality Loop Warning Count: ${asText(agentRealityLoopFields.agent_reality_loop_warning_count, '0')}`,
    `Agent Reality Loop Operator Decision Required: ${asText(agentRealityLoopFields.agent_reality_loop_operator_decision_required, 'no')}`,
    `Agent Reality Loop Mutation Allowed: ${asText(agentRealityLoopFields.agent_reality_loop_mutation_allowed, 'no')}`,
    `Agent Reality Loop OpenClaw Mutation Locked: ${asText(agentRealityLoopFields.agent_reality_loop_openclaw_mutation_locked, 'yes')}`,
    `Agent Reality Loop Codex Auto Dispatch Allowed: ${asText(agentRealityLoopFields.agent_reality_loop_codex_auto_dispatch_allowed, 'no')}`,
    `Agent Reality Loop Projection Source: ${asText(agentRealityLoopFields.agent_reality_loop_projection_source || arlProjectionSource, 'none')}`,
    `Agent Reality Loop Confidence: ${asText(agentRealityLoopFields.agent_reality_loop_confidence, 'low')}`,
    `Agent Reality Loop Evidence Context Source: ${asText(agentRealityLoopFields.agent_reality_loop_evidence_context_source, 'none')}`,
    `Agent Reality Loop Evidence Next Required: ${asText(agentRealityLoopFields.agent_reality_loop_evidence_next_required, 'none')}`,
    `Agent Reality Loop Evidence Missing Proof Summary: ${asText(agentRealityLoopFields.agent_reality_loop_evidence_missing_proof_summary, 'none')}`,
    `Agent Reality Loop Evidence Trusted For Merge: ${asText(agentRealityLoopFields.agent_reality_loop_evidence_trusted_for_merge, 'no')}`,
    `Agent Reality Loop Evidence Trusted For Canon: ${asText(agentRealityLoopFields.agent_reality_loop_evidence_trusted_for_canon, 'no')}`,
    `Agent Reality Loop Availability Blocker: ${asText(
      executionMetadata?.agent_reality_loop_availability_blocker,
      String(agentRealityLoopFields.agent_reality_loop_projection_available || executionMetadata?.agent_reality_loop_projection_available || '').trim().toLowerCase() === 'yes'
        ? 'none'
        : 'projection-missing-from-command-deck-path',
    )}`,
    `Mission Proof Reconciliation Status: ${asText(missionProofReconciliationFields.mission_proof_reconciliation_status, 'unavailable')}`,
    `Mission Proof Accepted Count: ${asText(missionProofReconciliationFields.mission_proof_accepted_count, '0')}`,
    `Mission Proof Accepted Items: ${asText(missionProofReconciliationFields.mission_proof_accepted_items, 'none')}`,
    `Mission Proof Remaining Missing Count: ${asText(missionProofReconciliationFields.mission_proof_remaining_missing_count, '0')}`,
    `Mission Proof Remaining Missing Items: ${asText(missionProofReconciliationFields.mission_proof_remaining_missing_items, 'none')}`,
    `Mission Proof Next Best Action: ${asText(missionProofReconciliationFields.mission_proof_next_best_action, 'Collect runtime proof.')}`,
    `Mission Console Bridge Proof Accepted: ${asText(missionProofReconciliationFields.mission_console_bridge_proof_accepted, 'no')}`,
    `Mission Console Bridge Proof Source: ${asText(missionProofReconciliationFields.mission_console_bridge_proof_source, 'none')}`,
    `Mission Console Diagnostics Source: ${asText(missionConsoleDiagnostics?.source, 'missing')}`,
    `Mission Console Registration Diagnostics Source: ${asText(missionConsoleDiagnostics?.registrationDiagnosticsSource, 'missing')}`,
    `Mission Console Registration Diagnostics Stamp: ${asText(missionConsoleDiagnostics?.registrationDiagnosticsStamp, '0')}`,
    `Mission Console Registration Diagnostics Owner ID: ${asText(missionConsoleDiagnostics?.registrationDiagnosticsOwnerId, 'unknown')}`,
    `Support Snapshot Diagnostics Source ID: ${asText(missionConsoleDiagnostics?.supportSnapshotDiagnosticsSourceId, 'missing')}`,
    `Mission Console Store Bridge Diagnostics Present: ${asText(missionConsoleDiagnostics?.storeBridgeDiagnosticsPresent, 'no')}`,
    `Mission Console Store Bridge Diagnostics Keys: ${asText(missionConsoleDiagnostics?.storeBridgeDiagnosticsKeys, 'none')}`,
    `Mission Console Store Bridge Diagnostics Stamp: ${asText(missionConsoleDiagnostics?.storeBridgeDiagnosticsStamp, '0')}`,
    `Mission Console Runtime Context Bridge Alias Present: ${asText(missionConsoleDiagnostics?.runtimeContextBridgeAliasPresent, 'no')}`,
    `Mission Console Runtime Context Bridge Alias Keys: ${asText(missionConsoleDiagnostics?.runtimeContextBridgeAliasKeys, 'none')}`,
    `Mission Console Runtime Status Bridge Alias Present: ${asText(missionConsoleDiagnostics?.runtimeStatusBridgeAliasPresent, 'no')}`,
    `Mission Console Runtime Status Bridge Alias Keys: ${asText(missionConsoleDiagnostics?.runtimeStatusBridgeAliasKeys, 'none')}`,
    `Mission Console Runtime Diagnostics Drop Boundary: ${asText(missionConsoleDiagnostics?.runtimeDiagnosticsDropBoundary, 'none')}`,
    `Mission Console Runtime Diagnostics Present: ${asText(missionConsoleDiagnostics?.runtimeDiagnosticsPresent, 'no')}`,
    `Mission Console Runtime Diagnostics Keys: ${asText(missionConsoleDiagnostics?.runtimeDiagnosticsKeys, 'none')}`,
    `Mission Console Runtime Publisher Registry Count: ${asText(missionConsoleDiagnostics?.runtimePublisherRegistryCount, '0')}`,
    `Mission Console Runtime Diagnostics Stamp: ${asText(missionConsoleDiagnostics?.runtimeDiagnosticsStamp, '0')}`,
    `Mission Console Runtime Diagnostics Source ID: ${asText(missionConsoleDiagnostics?.runtimeDiagnosticsSourceId, 'missing')}`,
    `App Bridge Handler Owner ID: ${asText(missionConsoleDiagnostics?.appBridgeHandlerOwnerId, 'unknown')}`,
    `Mission Console Bridge Instances Ref Owner ID: ${asText(missionConsoleDiagnostics?.missionConsoleBridgeInstancesRefOwnerId, 'unknown')}`,
    `Publish Operator Relief Projection Bridge Owner ID: ${asText(missionConsoleDiagnostics?.publishOperatorReliefProjectionBridgeOwnerId, 'unknown')}`,
    `Operator Relief Bridge Diagnostics Store Owner ID: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeDiagnosticsStoreOwnerId, 'unknown')}`,
    `Operator Relief Bridge Diagnostics Store Source ID: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeDiagnosticsStoreSourceId, 'unknown')}`,
    `Mission Console Publisher Registry Owner ID: ${asText(missionConsoleDiagnostics?.publisherRegistryOwnerId, 'unknown')}`,
    `Mission Console Publisher Registry Instance Count: ${asText(missionConsoleDiagnostics?.publisherRegistryInstanceCount, '0')}`,
    `Mission Console Publisher Registry Instance IDs: ${asText(missionConsoleDiagnostics?.publisherRegistryInstanceIds, 'none')}`,
    `Mission Console Publisher Source: ${asText(missionConsoleDiagnostics?.publisherSource, 'unknown')}`,
    `Mission Console Component Trace Source: ${asText(missionConsoleDiagnostics?.componentTraceSource, 'missing')}`,
    `Mission Console Component Trace Selector Checked: ${asText(missionConsoleDiagnostics?.componentTraceSelectorChecked, 'n/a')}`,
    `Mission Console AI Core Wrapper Count: ${asText(missionConsoleDiagnostics?.aiCoreWrapperCount, 'unknown')}`,
    `Mission Console AI Core Visible Wrapper Count: ${asText(missionConsoleDiagnostics?.aiCoreVisibleWrapperCount, 'unknown')}`,
    `Mission Console Marker Count By Wrapper: ${asText(missionConsoleDiagnostics?.markerCountByWrapper, 'none')}`,
    `Mission Console Selected Wrapper Index: ${asText(missionConsoleDiagnostics?.selectedWrapperIndex, 'none')}`,
    `Mission Console Selected Wrapper Reason: ${asText(missionConsoleDiagnostics?.selectedWrapperReason, 'none')}`,
    `Mission Console Selected Marker Panel ID: ${asText(missionConsoleDiagnostics?.selectedMarkerPanelId, 'unknown')}`,
    `Mission Console Selected Marker Callback Present: ${asText(missionConsoleDiagnostics?.selectedMarkerCallbackPresent, 'no')}`,
    `Mission Console Selector Miss Reason: ${asText(missionConsoleDiagnostics?.selectorMissReason, 'none')}`,
    `Mission Console Visible Component Is MissionConsoleTile: ${asText(missionConsoleDiagnostics?.visibleComponentIsMissionConsoleTile, 'no')}`,
    `Mission Console Visible Component Panel ID: ${asText(missionConsoleDiagnostics?.visibleComponentPanelId, 'unknown')}`,
    `Mission Console Component Effect Seen: ${asText(missionConsoleDiagnostics?.componentEffectSeen, 'no')}`,
    `Mission Console Component Callback Prop Present: ${asText(missionConsoleDiagnostics?.componentCallbackPropPresent, 'no')}`,
    `Mission Console Component Callback Invoked: ${asText(missionConsoleDiagnostics?.componentCallbackInvoked, 'no')}`,
    `Mission Console Component Callback Call Attempted: ${asText(missionConsoleDiagnostics?.componentCallbackCallAttempted, 'no')}`,
    `Mission Console Component Callback Returned: ${asText(missionConsoleDiagnostics?.componentCallbackReturned, 'no')}`,
    `Mission Console Component Callback Return Type: ${asText(missionConsoleDiagnostics?.componentCallbackReturnType, 'unknown')}`,
    `Mission Console Component Callback Return Handled: ${asText(missionConsoleDiagnostics?.componentCallbackReturnHandled, 'no')}`,
    `Mission Console Component Callback Return Handler: ${asText(missionConsoleDiagnostics?.componentCallbackReturnHandler, 'unknown')}`,
    `Mission Console Component Callback Return Panel ID: ${asText(missionConsoleDiagnostics?.componentCallbackReturnPanelId, 'unknown')}`,
    `Mission Console Component Callback Return Source Surface: ${asText(missionConsoleDiagnostics?.componentCallbackReturnSourceSurface, 'unknown')}`,
    `Mission Console Component Callback Return Instance ID: ${asText(missionConsoleDiagnostics?.componentCallbackReturnInstanceId, 'unknown')}`,
    `Mission Console Component Callback Return Identity: ${asText(missionConsoleDiagnostics?.componentCallbackReturnIdentity, 'unknown')}`,
    `Mission Console Component Callback Return Side Effect Status: ${asText(missionConsoleDiagnostics?.componentCallbackReturnSideEffectStatus, 'unknown')}`,
    `Mission Console Component Callback Return Registered Instance Seen: ${asText(missionConsoleDiagnostics?.componentCallbackReturnRegisteredInstanceSeen, 'no')}`,
    `Mission Console Component Callback Return Registered Instance Count: ${asText(missionConsoleDiagnostics?.componentCallbackReturnRegisteredInstanceCount, '0')}`,
    `Mission Console Component Callback Return Diagnostics Stamp: ${asText(missionConsoleDiagnostics?.componentCallbackReturnDiagnosticsStamp, '0')}`,
    `Mission Console Component Callback Return Registry Owner ID: ${asText(missionConsoleDiagnostics?.componentCallbackReturnRegistryOwnerId, 'unknown')}`,
    `Mission Console Component Callback Error: ${asText(missionConsoleDiagnostics?.componentCallbackError, 'none')}`,
    `Mission Console Registration Callback Seen: ${asText(missionConsoleDiagnostics?.callbackSeen, 'no')}`,
    `Mission Console Registration Effect Seen: ${asText(missionConsoleDiagnostics?.registrationEffectSeen, 'no')}`,
    `Mission Console Registration Effect Panel ID: ${asText(missionConsoleDiagnostics?.registrationEffectPanelId, 'unknown')}`,
    `Mission Console Registration Callback Prop Present: ${asText(missionConsoleDiagnostics?.registrationCallbackPropPresent, 'no')}`,
    `Mission Console Registration Callback Invoked: ${asText(missionConsoleDiagnostics?.registrationCallbackInvoked, 'no')}`,
    `Mission Console Registration App Handler Seen: ${asText(missionConsoleDiagnostics?.registrationAppHandlerSeen, 'no')}`,
    `Mission Console Registration App Handler Entered: ${asText(missionConsoleDiagnostics?.appHandlerEntered, 'no')}`,
    `Mission Console Registration App Handler Entered At: ${asText(missionConsoleDiagnostics?.appHandlerEnteredAt, 'unknown')}`,
    `Mission Console Registration Received Callback Identity: ${asText(missionConsoleDiagnostics?.receivedCallbackIdentity, 'unknown')}`,
    `Mission Console Registration Store Write Attempted: ${asText(missionConsoleDiagnostics?.registrationStoreWriteAttempted, 'no')}`,
    `Mission Console Registration Store Write Accepted: ${asText(missionConsoleDiagnostics?.registrationStoreWriteAccepted, 'no')}`,
    `Mission Console Registration Received Panel ID: ${asText(missionConsoleDiagnostics?.registrationReceivedPanelId, 'unknown')}`,
    `Mission Console Registration Received Source Surface: ${asText(missionConsoleDiagnostics?.registrationReceivedSourceSurface, 'unknown')}`,
    `Mission Console Registration Received Instance ID: ${asText(missionConsoleDiagnostics?.registrationReceivedInstanceId, 'unknown')}`,
    `Mission Console Registration Callback Source: ${asText(missionConsoleDiagnostics?.registrationCallbackSource, 'unknown')}`,
    `Mission Console Registration Callback Panel ID: ${asText(missionConsoleDiagnostics?.registrationCallbackPanelId, 'unknown')}`,
    `Mission Console Registration Callback Identity: ${asText(missionConsoleDiagnostics?.registrationCallbackIdentity, 'unknown')}`,
    `Mission Console Registration Store Updated: ${asText(missionConsoleDiagnostics?.storeUpdated, 'no')}`,
    `Mission Console Registration RuntimeContext Seen: ${asText(missionConsoleDiagnostics?.runtimeContextSeen, 'no')}`,
    `Operator Relief Bridge Published: ${asText(missionConsoleDiagnostics?.operatorReliefBridgePublished, 'no')}`,
    `Operator Relief Bridge Source Surface: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeSourceSurface, 'unknown')}`,
    `Operator Relief Bridge Projection Keys Seen: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeProjectionKeysSeen, 'none')}`,
    `Operator Relief Bridge Agent Reality Loop Seen: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeAgentRealityLoopSeen, 'no')}`,
    `Operator Relief Bridge Store Updated: ${asText(missionConsoleDiagnostics?.storeUpdated, 'no')}`,
    `Operator Relief Bridge RuntimeContext Seen: ${asText(missionConsoleDiagnostics?.runtimeContextSeen, 'no')}`,
    `Operator Relief Bridge RequestRuntimeStatus Seen: ${asText(executionMetadata?.operator_relief_bridge_request_runtime_status_seen, 'no')}`,
    `Operator Relief Bridge Last Updated At: ${asText(missionConsoleDiagnostics?.operatorReliefBridgeLastUpdatedAt, 'unknown')}`,
    `Mission Console Registration Drop Boundary: ${asText(missionConsoleDiagnostics?.registrationDropBoundary, 'runtime-context-not-injected')}`,
    `Operator Relief Bridge Drop Boundary: ${asText(missionConsoleDiagnostics?.registrationDropBoundary, 'runtime-context-not-injected')}`,
    `Mission Console Instance Count: ${asText(missionConsoleDiagnostics?.missionConsoleInstanceCount, '0')}`,
    `Mission Console Instance IDs: ${asText(missionConsoleDiagnostics?.missionConsoleInstanceIds, 'none')}`,
    `Mission Console Visible Instance ID: ${asText(missionConsoleDiagnostics?.missionConsoleVisibleInstanceId, 'unknown')}`,
    `Mission Console Bridge-Capable Instance IDs: ${asText(missionConsoleDiagnostics?.missionConsoleBridgeCapableInstanceIds, 'none')}`,
    `Mission Console Instances Missing Bridge Callback: ${asText(missionConsoleDiagnostics?.missionConsoleInstancesMissingBridgeCallback, 'none')}`,
    `Mission Console Last Publishing Instance ID: ${asText(missionConsoleDiagnostics?.missionConsoleLastPublishingInstanceId, 'unknown')}`,
    `Mission Console Last Publishing Source Surface: ${asText(missionConsoleDiagnostics?.missionConsoleLastPublishingSourceSurface, 'unknown')}`,
    `Mission Console Visible Instance Published: ${asText(missionConsoleDiagnostics?.missionConsoleVisibleInstancePublished, 'no')}`,
    `Mission Console Bridge Parity Status: ${asText(missionConsoleDiagnostics?.missionConsoleBridgeParityStatus, 'WARN')}`,
    `Mission Console Bridge Parity Blocker: ${deriveMissionConsoleBridgeParityBlocker({
      ...executionMetadata,
      mission_console_instance_count: missionConsoleDiagnostics?.missionConsoleInstanceCount,
      mission_console_visible_instance_published: missionConsoleDiagnostics?.missionConsoleVisibleInstancePublished,
      operator_relief_bridge_published: missionConsoleDiagnostics?.operatorReliefBridgePublished,
      mission_console_bridge_parity_blocker: missionConsoleDiagnostics?.missionConsoleBridgeParityBlocker,
    })}`,
    `Operator Approved Repair Loop Status: ${asText(executionMetadata?.operator_approved_repair_loop_status, 'inactive')}`,
    `Operator Approved Repair Loop Mission: ${asText(executionMetadata?.operator_approved_repair_loop_mission, 'none')}`,
    `Operator Approved Repair Loop Approval Still Valid: ${asText(executionMetadata?.operator_approved_repair_loop_approval_still_valid, 'no')}`,
    `Operator Approved Repair Loop Approval Invalid Reason: ${asText(executionMetadata?.operator_approved_repair_loop_approval_invalid_reason, 'none')}`,
    `Operator Approved Repair Loop Failure Class: ${asText(executionMetadata?.operator_approved_repair_loop_failure_class, 'unknown')}`,
    `Operator Approved Repair Loop Recommended Lead: ${asText(executionMetadata?.operator_approved_repair_loop_recommended_lead, 'hold')}`,
    `Operator Approved Repair Loop Current Blocker: ${asText(executionMetadata?.operator_approved_repair_loop_current_blocker, 'none')}`,
    `Operator Approved Repair Loop Retry Count: ${asText(executionMetadata?.operator_approved_repair_loop_retry_count, '0')}`,
    `Operator Approved Repair Loop Scope Change Required: ${asText(executionMetadata?.operator_approved_repair_loop_scope_change_required, 'no')}`,
    `Operator Approved Repair Loop Protected Canon At Risk: ${asText(executionMetadata?.operator_approved_repair_loop_protected_canon_at_risk, 'no')}`,
    `Operator Approved Repair Loop Live Proof Required: ${asText(executionMetadata?.operator_approved_repair_loop_live_proof_required, 'yes')}`,
    `Operator Approved Repair Loop Missing Proof: ${asText(executionMetadata?.operator_approved_repair_loop_missing_proof, 'none')}`,
    `Operator Approved Repair Loop Next Action: ${asText(executionMetadata?.operator_approved_repair_loop_next_action, 'review mission evidence')}`,
    `Operator Approved Repair Loop OpenClaw Packet Available: ${asText(executionMetadata?.operator_approved_repair_loop_openclaw_packet_available, 'no')}`,
    `Operator Approved Repair Loop Codex Packet Available: ${asText(executionMetadata?.operator_approved_repair_loop_codex_packet_available, 'no')}`,
    `Operator Approved Repair Loop Operator Proof Checklist Available: ${asText(executionMetadata?.operator_approved_repair_loop_operator_checklist_available, 'no')}`,
    `Command Envelope Status: ${asText(commandEnvelopeStatus, 'unavailable')}`,
    `Command Envelope Version: ${asText(commandEnvelopeVersion, 'n/a')}`,
    `Command Envelope ID: ${asText(commandEnvelopeId, 'n/a')}`,
    `Command Envelope Submission Source: ${asText(commandEnvelopeSubmissionSource, 'unknown')}`,
    `Command Envelope Submission Route: ${asText(commandEnvelopeSubmissionRoute, 'unknown')}`,
    `Command Envelope Response Mode: ${asText(commandEnvelopeResponseMode, 'direct-answer')}`,
    `Command Envelope Context Providers Used: ${asText(commandEnvelopeContextProvidersUsed, 'none')}`,
    `Command Envelope Execution Status: ${asText(commandEnvelopeExecutionStatus, 'unknown')}`,
    `Command Envelope Actual Provider: ${asText(commandEnvelopeActualProvider, 'unknown')}`,
    `Command Envelope Actual Model: ${asText(commandEnvelopeActualModel, 'unknown')}`,
    `Command Envelope Proof Status: ${asText(commandEnvelopeProofStatus, 'unknown')}`,
    `Command Envelope UI Reality Status: ${asText(commandEnvelopeUiRealityStatus, 'UNKNOWN')}`,
    `Command Envelope Operator Name: ${asText(executionMetadata?.command_envelope_operator_name || 'unknown', 'unknown')}`,
    `Command Envelope Operator Profile Used: ${asText(executionMetadata?.command_envelope_operator_profile_used || 'no', 'no')}`,
    `Command Envelope Warnings: ${asText(commandEnvelopeWarnings, 'none')}`,
    `Response Planner Status: ${asText(responsePlannerStatus, 'unavailable')}`,
    `Response Planner Version: ${asText(responsePlannerVersion, 'n/a')}`,
    `Response Planner Response Mode: ${asText(responsePlannerResponseMode, 'direct-answer')}`,
    `Response Planner Answer Shape: ${asText(responsePlannerAnswerShape, 'direct-answer')}`,
    `Response Planner Required Sections: ${asText(responsePlannerRequiredSections, 'none')}`,
    `Response Planner Risk Level: ${asText(responsePlannerRiskLevel, 'low')}`,
    `Response Planner Proof Required: ${asText(responsePlannerProofRequired, 'no')}`,
    `Response Planner Merge Decision: ${asText(responsePlannerMergeDecision, 'unknown')}`,
    `Response Planner Codex Prompt Required: ${asText(responsePlannerCodexPromptRequired, 'no')}`,
    `Response Planner Next Action: ${asText(responsePlannerNextAction, 'answer directly with bounded confidence')}`,
    `Response Planner Warning Count: ${asText(responsePlannerWarningCount, '0')}`,
    `Response Planner Warnings: ${asText(responsePlannerWarnings, 'none')}`,
    `Response Planner Canon Applied: ${asText(responsePlannerCanonApplied, 'none')}`,
    `Response Planner Identity Recall: ${asText(responsePlannerIdentityRecall, 'no')}`,
    `Response Planner Operator Name Used: ${asText(responsePlannerOperatorNameUsed, 'no')}`,
    `Response Planner Identity Prompt Injected: ${asText(responsePlannerIdentityPromptInjected, 'no')}`,
    `Operator Profile Prompt Line Present: ${asText(operatorProfilePromptLinePresent, 'no')}`,
    `Final Answer Used Operator Profile: ${asText(finalAnswerUsedOperatorProfile, 'no')}`,
    `Identity Recall Deterministic Answer Used: ${asText(identityRecallDeterministicAnswerUsed, 'no')}`,
    `Command Pipeline Last Submit Accepted: ${asText(commandPipelineLastSubmitAccepted, 'no')}`,
    `Command Pipeline Last Submit Attempted: ${asText(executionMetadata?.command_pipeline_last_submit_attempted, 'no')}`,
    `Command Pipeline Submit Block Reason: ${asText(executionMetadata?.command_pipeline_submit_block_reason, 'none')}`,
    `Command Pipeline Last User Message Recorded: ${asText(commandPipelineLastUserMessageRecorded, 'no')}`,
    `Command Pipeline Last Assistant Answer Generated: ${asText(commandPipelineLastAssistantAnswerGenerated, 'no')}`,
    `Command Pipeline Last Answer Pane Rendered: ${asText(commandPipelineLastAnswerPaneRendered, 'no')}`,
    `Command Pipeline Last Failure Reason: ${asText(commandPipelineLastFailureReason, 'none')}`,
    `Historical Command Failure Reason: ${asText(historicalCommandFailureReason, 'none')}`,
    `Current Command Pipeline State: ${asText(currentCommandPipelineState, 'ready')}`,
    `Current Provider Execution Truth: ${asText(currentProviderExecutionTruth, 'none / idle / not-executed')}`,
    `Command Pipeline Last Finalization Path: ${asText(commandPipelineLastFinalizationPath, 'unknown')}`,
    `Command Pipeline Last Input Cleared: ${asText(commandPipelineLastInputCleared, 'no')}`,
    `Command Pipeline Last Input Restore Available: ${asText(commandPipelineLastInputRestoreAvailable, 'yes')}`,
    `Explanation Intent Detected: ${asText(executionMetadata?.chat_context_operator_explanation_intent_detected, 'no')}`,
    `Explanation Intent Source: ${asText(executionMetadata?.chat_context_intent_classifier_source, 'unknown')}`,
    `Explanation Mode: ${asText(executionMetadata?.operator_explanation_mode || executionMetadata?.chat_context_operator_explanation_mode, 'compact')}`,
    `Explanation Projection Used: ${asText(executionMetadata?.operator_explanation_projection_used, 'no')}`,
    `Explanation Formatter Mode: ${asText(executionMetadata?.operator_explanation_mode, 'compact')}`,
    `Explanation Answer Generated: ${asText(executionMetadata?.operator_explanation_triggered, 'no')}`,
    `Answer Delivery Status: ${asText(executionMetadata?.answer_delivery_status, 'unknown')}`,
    `Answer Delivery Generated: ${asText(executionMetadata?.answer_delivery_generated, 'no')}`,
    `Answer Delivery Rendered: ${asText(executionMetadata?.answer_delivery_rendered, 'no')}`,
    `Final Assistant Message Present: ${asText(executionMetadata?.final_assistant_message_present, 'no')}`,
    `Final Assistant Message ID: ${asText(executionMetadata?.final_assistant_message_id, 'none')}`,
    `Final Assistant Text Length: ${asText(executionMetadata?.final_assistant_text_length, '0')}`,
    `Final Assistant Payload Present: ${asText(executionMetadata?.final_assistant_payload_present, 'no')}`,
    `Answer Delivery Failure Reason: ${asText(executionMetadata?.answer_delivery_failure_reason, 'none')}`,
    `Answer Delivery Contradiction Detected: ${asText(executionMetadata?.answer_delivery_contradiction_detected, 'no')}`,
    `Answer Delivery Next Action: ${asText(executionMetadata?.answer_delivery_next_action, 'none')}`,
    `Command Deck Render Proof Source: ${asText(commandDeckProof.renderProofSource, 'missing')}`,
    `Latest Assistant DOM Proof Source: ${asText(commandDeckProof.latestAssistantDomProofSource, 'missing')}`,
    `Answer Delivery Rendered Zero Pane Explanation: ${asText(commandDeckProof.renderedWithZeroPaneExplanation, 'none')}`,
    `Explanation Normal Chat Bypass: ${asText(executionMetadata?.operator_explanation_triggered === 'yes' ? 'yes' : 'no', 'no')}`,
    `Answer Scroll Requested: ${asText(aiConsoleAnswerScroll?.requested, 'no')}`,
    `Visible Deck Instance Mounted: ${asText(aiConsoleAnswerScroll?.visibleDeckInstanceMounted, 'no')}`,
    `Visible Deck Root Found: ${asText(commandDeckProof.visibleDeckRootFound, 'no')}`,
    `History Container Found: ${asText(commandDeckProof.historyContainerFound, 'no')}`,
    `Composer Found: ${asText(commandDeckProof.composerFound, 'no')}`,
    `Input Found: ${asText(commandDeckProof.inputFound, 'no')}`,
    `Execute Found: ${asText(commandDeckProof.executeFound, 'no')}`,
    `Latest Final Assistant Card Found: ${asText(commandDeckProof.latestFinalAssistantCardFound, 'no')}`,
    `Answer Scroll Source: ${asText(aiConsoleAnswerScroll?.source, 'unknown')}`,
    `Answer Scroll Reveal Owner Instance ID: ${asText(aiConsoleAnswerScroll?.revealOwnerInstanceId, 'none')}`,
    `Answer Scroll Delivery Owner Instance ID: ${asText(aiConsoleAnswerScroll?.deliveryOwnerInstanceId, 'none')}`,
    `Answer Scroll Owner Mismatch: ${asText(aiConsoleAnswerScroll?.ownerMismatch, 'no')}`,
    `Answer Scroll Request Reason: ${asText(aiConsoleAnswerScroll?.requestReason, 'none')}`,
    `Answer Scroll Target Kind: ${asText(aiConsoleAnswerScroll?.targetKind, 'none')}`,
    `Answer Scroll Target ID: ${asText(aiConsoleAnswerScroll?.targetId, 'none')}`,
    `Answer Scroll Target Found: ${asText(aiConsoleAnswerScroll?.targetFound, 'no')}`,
    `Answer Scroll Container Kind: ${asText(aiConsoleAnswerScroll?.containerKind, 'none')}`,
    `Answer Scroll Container Found: ${asText(aiConsoleAnswerScroll?.containerFound, 'no')}`,
    `Answer Scroll Container Scrollable: ${asText(aiConsoleAnswerScroll?.containerScrollable, 'no')}`,
    `Answer Scroll Method: ${asText(aiConsoleAnswerScroll?.method, 'none')}`,
    `Answer Scroll Previous Scroll Top: ${asText(aiConsoleAnswerScroll?.previousScrollTop, 'n/a')}`,
    `Answer Scroll Next Scroll Top: ${asText(aiConsoleAnswerScroll?.nextScrollTop, 'n/a')}`,
    `Answer Scroll Completed: ${asText(aiConsoleAnswerScroll?.completed, 'no')}`,
    `Answer Scroll Target Top Visible: ${asText(aiConsoleAnswerScroll?.topVisible, 'no')}`,
    `Answer Scroll Target Bottom Visible: ${asText(aiConsoleAnswerScroll?.bottomVisible, 'no')}`,
    `Answer Scroll Target Fully Visible: ${asText(aiConsoleAnswerScroll?.fullyVisible, 'no')}`,
    `Answer Scroll Occlusion Reason: ${asText(aiConsoleAnswerScroll?.occlusionReason, 'none')}`,
    `Answer Scroll Last Requested At: ${asText(aiConsoleAnswerScroll?.lastRequestedAt, 'none')}`,
    `Answer Scroll Last Completed At: ${asText(aiConsoleAnswerScroll?.lastCompletedAt, 'none')}`,
    `Answer Pane Count: ${asText(commandDeckProof.answerPaneCount, '0')}`,
    `Latest Assistant Answer ID: ${asText(commandDeckProof.latestAssistantAnswerId, 'none')}`,
    `Latest Assistant Answer Final: ${asText(commandDeckProof.latestAssistantAnswerFinal, 'no')}`,
    `Latest Assistant Answer Text Length: ${asText(commandDeckProof.latestAssistantAnswerTextLength, '0')}`,
    `Latest Assistant Answer DOM Found: ${asText(commandDeckProof.latestAssistantAnswerDomFound, 'no')}`,
    `Latest Assistant Answer Visible: ${asText(commandDeckProof.latestAssistantAnswerVisible, 'no')}`,
    `Latest Assistant Visual Proof: ${asText(commandDeckProof.latestAssistantVisualProof, 'missing')}`,
    `Latest Assistant Visibility Blocker: ${asText(commandDeckProof.latestAssistantVisibilityBlocker, 'unknown')}`,
    `Latest Assistant Text Length Drift: ${asText(commandDeckProof.latestAssistantTextLengthDrift, 'no')}`,
    `Latest Assistant Text Length Drift Reason: ${asText(commandDeckProof.latestAssistantTextLengthDriftReason, 'none')}`,
    `Answer Pane Client Height: ${asText(commandDeckProof.answerPaneClientHeight, '0')}`,
    `Answer Pane Scroll Height: ${asText(commandDeckProof.answerPaneScrollHeight, '0')}`,
    `Answer Container Client Height: ${asText(commandDeckProof.answerContainerClientHeight, '0')}`,
    `Answer Container Scroll Height: ${asText(commandDeckProof.answerContainerScrollHeight, '0')}`,
    `Answer Container OverflowY: ${asText(aiConsoleAnswerScroll?.answerContainerOverflowY, 'unknown')}`,
    `Answer Pane Clipped Reason: ${asText(aiConsoleAnswerScroll?.answerPaneClippedReason, 'none')}`,
    `Command Deck Composer Found: ${asText(aiConsoleAnswerScroll?.commandDeckComposerFound, 'unknown')}`,
    `Command Deck Composer Visible: ${asText(aiConsoleAnswerScroll?.commandDeckComposerVisible, 'unknown')}`,
    `Command Deck Composer Bottom Within View: ${asText(aiConsoleAnswerScroll?.commandDeckComposerBottomWithinView, 'unknown')}`,
    `Command Deck Input Found: ${asText(aiConsoleAnswerScroll?.commandDeckInputFound, 'unknown')}`,
    `Command Deck Input Visible: ${asText(aiConsoleAnswerScroll?.commandDeckInputVisible, 'unknown')}`,
    `Command Deck Input Auto Resize Enabled: ${asText(commandDeckDiagnostics?.commandDeckInputAutoResizeEnabled, 'unknown')}`,
    `Command Deck Input Scroll Height: ${asText(commandDeckDiagnostics?.commandDeckInputScrollHeight, '0')}`,
    `Command Deck Input Client Height: ${asText(commandDeckDiagnostics?.commandDeckInputClientHeight, '0')}`,
    `Command Deck Input Can Scroll: ${asText(commandDeckDiagnostics?.commandDeckInputCanScroll, 'unknown')}`,
    `Command Deck Execute Button Visible: ${asText(commandDeckDiagnostics?.commandDeckExecuteButtonVisible, 'unknown')}`,
    `Command Deck Execute Visible With Large Input: ${asText(commandDeckDiagnostics?.commandDeckExecuteVisibleWithLargeInput, 'unknown')}`,
    `Command Deck Large Paste Usability Status: ${asText(commandDeckDiagnostics?.commandDeckLargePasteUsabilityStatus, 'unknown')}`,
    `Command Deck Pane Client Height: ${asText(aiConsoleAnswerScroll?.commandDeckPaneClientHeight, '0')}`,
    `Command Deck Body Client Height: ${asText(aiConsoleAnswerScroll?.commandDeckBodyClientHeight, '0')}`,
    `Command Deck Body Scroll Height: ${asText(aiConsoleAnswerScroll?.commandDeckBodyScrollHeight, '0')}`,
    `Answer History Client Height: ${asText(aiConsoleAnswerScroll?.answerHistoryClientHeight, '0')}`,
    `Answer History Scroll Height: ${asText(aiConsoleAnswerScroll?.answerHistoryScrollHeight, '0')}`,
    `Answer History OverflowY: ${asText(aiConsoleAnswerScroll?.answerHistoryOverflowY, 'unknown')}`,
    `Latest Answer Card Client Height: ${asText(commandDeckProof.latestAnswerCardClientHeight, '0')}`,
    `Latest Answer Card Scroll Height: ${asText(commandDeckProof.latestAnswerCardScrollHeight, '0')}`,
    `Answer Viewport Client Height: ${asText(commandDeckProof.answerViewportClientHeight, '0')}`,
    `Answer Viewport Scroll Height: ${asText(commandDeckProof.answerViewportScrollHeight, '0')}`,
    `Answer Viewport Fits Latest Answer: ${asText(aiConsoleAnswerScroll?.answerViewportFitsLatestAnswer, 'no')}`,
    `Answer Viewport Fit Ratio: ${asText(aiConsoleAnswerScroll?.answerViewportFitRatio, '0')}`,
    `Answer Viewport Fit Verdict: ${asText(aiConsoleAnswerScroll?.answerViewportFitVerdict, 'unknown')}`,
    `Answer Viewport Too Small Reason: ${asText(aiConsoleAnswerScroll?.answerViewportTooSmallReason, 'none')}`,
    `Composer Client Height: ${asText(aiConsoleAnswerScroll?.composerClientHeight, '0')}`,
    `Composer Bottom: ${asText(aiConsoleAnswerScroll?.composerBottom, '0')}`,
    `Command Deck Layout Verdict: ${asText(aiConsoleAnswerScroll?.commandDeckLayoutVerdict, 'unknown')}`,
    `Command Deck Layout Blocker: ${asText(aiConsoleAnswerScroll?.commandDeckLayoutBlocker, 'none')}`,
    `Composer Visible: ${asText(aiConsoleAnswerScroll?.composerVisible, 'unknown')}`,
    `View Pane Height: ${asText(aiConsoleAnswerScroll?.viewPaneHeight, '0')}`,
    `View Pane Available Height: ${asText(aiConsoleAnswerScroll?.viewPaneAvailableHeight, '0')}`,
    `Answer Scroll Signature Previous: ${asText(aiConsoleAnswerScroll?.lastSeenSignature, 'none')}`,
    `Answer Scroll Signature Current: ${asText(aiConsoleAnswerScroll?.currentSignature, 'none')}`,
    `Answer Scroll Signature Changed: ${asText(aiConsoleAnswerScroll?.signatureChanged, 'no')}`,
    `Answer Scroll Effect Fired: ${asText(aiConsoleAnswerScroll?.effectFired, 'no')}`,
    `Command Deck Local Root Ref Present: ${asText(commandDeckLocalReveal?.rootRefPresent || aiConsoleAnswerScroll?.commandDeckLocalRootRefPresent, 'no')}`,
    `Command Deck Local History Ref Present: ${asText(commandDeckLocalReveal?.historyRefPresent || aiConsoleAnswerScroll?.commandDeckLocalHistoryRefPresent, 'no')}`,
    `Command Deck Local Latest Answer Ref Present: ${asText(commandDeckLocalReveal?.latestAnswerRefPresent || aiConsoleAnswerScroll?.commandDeckLocalLatestAnswerRefPresent, 'no')}`,
    `Command Deck Local Reveal Attempted: ${asText(commandDeckLocalReveal?.revealAttempted || aiConsoleAnswerScroll?.commandDeckLocalRevealAttempted, 'no')}`,
    `Command Deck Local Reveal Result: ${asText(commandDeckLocalReveal?.revealResult || aiConsoleAnswerScroll?.commandDeckLocalRevealResult, 'no')}`,
    `Command Deck Local Reveal Reason: ${asText(commandDeckLocalReveal?.revealReason || aiConsoleAnswerScroll?.commandDeckLocalRevealReason, 'none')}`,
    `Command Deck Local Reveal Assistant ID: ${asText(aiConsoleAnswerScroll?.commandDeckLocalRevealAssistantId, 'none')}`,
    `Command Deck Local Reveal Signature: ${asText(commandDeckLocalReveal?.revealSignature || aiConsoleAnswerScroll?.commandDeckLocalRevealSignature, 'none')}`,
    `Command Deck Local Last Revealed Assistant ID: ${asText(commandDeckLocalReveal?.lastRevealedAssistantId || aiConsoleAnswerScroll?.commandDeckLocalLastRevealedAssistantId, 'none')}`,
    `Command Deck Manual Scroll After Reveal: ${asText(commandDeckLocalReveal?.manualScrollAfterReveal || aiConsoleAnswerScroll?.commandDeckManualScrollAfterReveal, 'no')}`,
    `Command Deck Auto Reveal Suppressed Reason: ${asText(commandDeckLocalReveal?.autoRevealSuppressedReason || aiConsoleAnswerScroll?.commandDeckAutoRevealSuppressedReason, 'none')}`,
    `Command Deck Copy Buttons Reachability Checked: ${asText(aiConsoleAnswerScroll?.commandDeckCopyButtonsReachabilityChecked, 'no')}`,
    `Command Deck Copy Buttons Reachable: ${asText(aiConsoleAnswerScroll?.commandDeckCopyButtonsReachable, 'unknown')}`,
    `Command Deck Local History Scroll Previous: ${asText(aiConsoleAnswerScroll?.commandDeckLocalHistoryScrollPrevious, 'n/a')}`,
    `Command Deck Local History Scroll Next: ${asText(aiConsoleAnswerScroll?.commandDeckLocalHistoryScrollNext, 'n/a')}`,
    `Command Deck Local Latest Answer Visible: ${asText(aiConsoleAnswerScroll?.commandDeckLocalLatestAnswerVisible, 'no')}`,
    `Command Deck Submission Source: ${asText(commandDeckLocalReveal?.submissionSource || aiConsoleAnswerScroll?.commandDeckSubmissionSource, 'unknown')}`,
    `Command Deck Surface Owner Key: ${asText(commandDeckLocalReveal?.surfaceOwnerKey || aiConsoleAnswerScroll?.commandDeckSurfaceOwnerKey, 'unknown')}`,
    `Command Deck Ownership Instance Count: ${asText(aiConsoleAnswerScroll?.ownershipInstanceCount, '0')}`,
    `Visible Owner Instance ID: ${asText(aiConsoleAnswerScroll?.visibleOwnerInstanceId, 'none')}`,
    `Delivery Owner Instance ID: ${asText(aiConsoleAnswerScroll?.deliveryOwnerInstanceId, 'none')}`,
    `Reveal Owner Instance ID: ${asText(aiConsoleAnswerScroll?.revealOwnerInstanceId, 'none')}`,
    `Ownership Mismatch: ${asText(aiConsoleAnswerScroll?.ownershipMismatch, 'no')}`,
    `Visible Owner Source Marker: ${asText(aiConsoleAnswerScroll?.visibleOwnerSourceMarker, 'none')}`,
    `Delivery Owner Source Marker: ${asText(aiConsoleAnswerScroll?.deliveryOwnerSourceMarker, 'none')}`,
    `Reveal Owner Source Marker: ${asText(aiConsoleAnswerScroll?.revealOwnerSourceMarker, 'none')}`,
    `Visible Owner Has History: ${asText(aiConsoleAnswerScroll?.visibleOwnerHasHistory, 'no')}`,
    `Visible Owner Has Input: ${asText(aiConsoleAnswerScroll?.visibleOwnerHasInput, 'no')}`,
    `Visible Owner Has Latest Answer: ${asText(aiConsoleAnswerScroll?.visibleOwnerHasLatestAnswer, 'no')}`,

    `Command Deck DOM Fallback Root Found: ${asText(commandDeckFallbackRoot ? 'yes' : 'no', 'no')}`,
    `Command Deck DOM Fallback Owner Attr: ${asText(commandDeckFallbackRoot?.getAttribute?.('data-surface-owner-key'), 'unknown')}`,
    `Command Deck DOM Fallback Submission Source Attr: ${asText(commandDeckFallbackRoot?.getAttribute?.('data-submission-source'), 'unknown')}`,
    `Command Deck DOM Fallback Final Answer Count: ${asText(commandDeckFallbackAnswers.length, '0')}`,
    `Command Deck DOM Fallback Latest Answer Found: ${asText(commandDeckFallbackLatestAnswer ? 'yes' : 'no', 'no')}`,
    `Command Envelope Build Attempted: ${asText(executionMetadata?.command_envelope_build_attempted, 'no')}`,
    `Command Envelope Build Error: ${asText(executionMetadata?.command_envelope_build_error, 'none')}`,
    `Dispatch Gate Allowed: ${asText(executionMetadata?.dispatch_gate_allowed, 'unknown')}`,
    `Dispatch Gate Reason: ${asText(executionMetadata?.dispatch_gate_reason, 'none')}`,
    `Execute Input Present: ${asText(executionMetadata?.execute_input_present, 'no')}`,
    `Execute Input Length: ${asText(executionMetadata?.execute_input_length, '0')}`,
    `Execute Stage Last Reached: ${asText(executionMetadata?.execute_stage_last_reached, 'unknown')}`,
    `Execute Stage Failure Reason: ${asText(executionMetadata?.execute_stage_failure_reason, 'none')}`,
    `Execute Handler Early Return Reason: ${asText(executionMetadata?.execute_handler_early_return_reason, 'none')}`,
    `Pre Envelope Exception Name: ${asText(executionMetadata?.pre_envelope_exception_name, 'none')}`,
    `Pre Envelope Exception Message: ${asText(executionMetadata?.pre_envelope_exception_message, 'none')}`,
    `Envelope Build Skipped Reason: ${asText(executionMetadata?.envelope_build_skipped_reason, 'none')}`,
    `User Message Record Attempted: ${asText(executionMetadata?.user_message_record_attempted, 'no')}`,
    `User Message Record Error: ${asText(executionMetadata?.user_message_record_error, 'none')}`,
    `Direct Answer Submit Allowed: ${asText(executionMetadata?.direct_answer_submit_allowed, 'unknown')}`,
    `Canonical Intent: ${asText(orchestrationTruth?.canonicalCurrentIntent?.operatorIntent?.label, 'unknown')}`,
    `Canonical Intent Source: ${asText(orchestrationTruth?.canonicalCurrentIntent?.operatorIntent?.source, 'unknown')}`,
    `Canonical Execution State: ${asText(orchestrationTruth?.canonicalCurrentIntent?.executionState?.status, 'unknown')}`,
    `Canonical Memory Continuity: ${asText(orchestrationTruth?.canonicalMemoryContext?.activeMissionContinuity?.continuityLoopState, 'unknown')}`,
    `Canonical Memory Sparse: ${orchestrationTruth?.canonicalMemoryContext?.sparseData === true ? 'yes' : 'no'}`,
    `Canonical Mission Title: ${asText(orchestrationTruth?.canonicalMissionPacket?.missionTitle, 'not yet established')}`,
    `Canonical Mission Phase: ${asText(orchestrationTruth?.canonicalMissionPacket?.currentPhase, 'proposed')}`,
    `Canonical Mission Next Action: ${asText(orchestrationTruth?.canonicalMissionPacket?.recommendedNextAction, 'Await explicit operator approval')}`,
    `Orchestration Mission Phase: ${asText(operatorGuidance.missionLifecycleSummary?.missionPhase, 'unknown')}`,
    `Orchestration Mission Lifecycle: ${asText(operatorGuidance.missionLifecycleSummary?.lifecycleState, 'unknown')}`,
    `Orchestration Intent Source: ${asText(orchestrationTruth?.selectors?.currentMissionState?.intentSource, 'unknown')}`,
    `Orchestration Continuity Strength: ${asText(operatorGuidance.continuitySummary?.strength, 'unknown')}`,
    `Orchestration Continuity Caution: ${asText(operatorGuidance.continuitySummary?.caution, 'none')}`,
    `Orchestration Mission Blocked: ${operatorGuidance.missionLifecycleSummary?.blocked === true ? 'yes' : 'no'}`,
    `Orchestration Blockage Reason: ${asText(operatorGuidance.missionLifecycleSummary?.blockageReason, 'none')}`,
    `Orchestration Available Now: ${asText(operatorGuidance.availableNow?.map((entry) => entry.command).join(', '), 'none')}`,
    `Orchestration Blocked Because: ${asText(operatorGuidance.blockedSummary?.join(' | '), 'none')}`,
    `Orchestration Next Action: ${asText(operatorGuidance.nextStepSummary, 'Await explicit operator guidance')}`,
    `Build Assistance State: ${asText(operatorGuidance.buildAssistanceSummary?.state, 'unavailable')}`,
    `Build Assistance Summary: ${asText(operatorGuidance.buildAssistanceSummary?.explanation, 'none')}`,
    `Build Assistance Approval Required: ${operatorGuidance.buildAssistanceSummary?.approvalRequired === true ? 'yes' : 'no'}`,
    `Codex Handoff Readiness: ${asText(operatorGuidance.codexReadinessSummary?.state, 'unavailable')}`,
    `Codex Pipeline Status: ${asText(operatorGuidance.codexPipelineSummary?.status, 'not-generated')}`,
    `Codex Validation Status: ${asText(operatorGuidance.codexPipelineSummary?.validationStatus, 'not-run')}`,
    `Codex Last Operator Action: ${asText(operatorGuidance.codexPipelineSummary?.lastOperatorAction, 'none')}`,
    `Approval Readiness: ${asText(operatorGuidance.approvalSummary?.readiness, 'unknown')}`,
    `Approval Required Now: ${operatorGuidance.approvalSummary?.requiredNow === true ? 'yes' : 'no'}`,
    `Agent Orchestration Active Goals: ${asText(runtimeStatus?.agentActiveGoalCount, '0')}`,
    `Agent Orchestration Open Tasks: ${asText(runtimeStatus?.agentOpenTaskCount, '0')}`,
    `Agent Orchestration Pending Approvals: ${asText(runtimeStatus?.agentPendingApprovalCount, '0')}`,
    `Agent Orchestration Blocked Tasks: ${asText(runtimeStatus?.agentBlockedTaskCount, '0')}`,
    `Agent Orchestration Resumable Tasks: ${asText(runtimeStatus?.agentResumableTaskCount, '0')}`,
    `Agent Orchestration Acting Agent: ${asText(runtimeStatus?.agentActingAgentId, 'none')}`,
    `Mission Bridge State: ${asText(missionBridge.state, 'idle')}`,
    `Mission Bridge Last Event: ${asText(missionBridgeLastEvent?.type, 'none')}`,
    `Mission Bridge Last AI Router Request Source: ${asText(missionBridge.lastAiRouterRequestSource, 'none')}`,
    `Mission Bridge Latest Submission Console: ${asText(missionBridge.latestSubmissionConsole, 'none')}`,
    `Mission Bridge Latest Submission Route: ${asText(missionBridge.latestSubmissionRoute, 'mission-bridge')}`,
    `Latest Command Submission Console: ${asText(runtimeStatus?.lastCommandSubmissionConsole || aiConsoleAnswerScroll?.commandDeckSubmissionSource || commandDeckLocalReveal?.submissionSource, 'stephanos-mission-console')}`,
    `Latest Command Submission Route: ${asText(runtimeStatus?.lastCommandSubmissionRoute, 'assistant-router')}`,
    `Mission Bridge Last AI Response Routed To Mission Console: ${missionBridge.lastAiResponseRoutedToMissionConsole === true ? 'yes' : 'no'}`,
    `Mission Bridge Local Desktop Agent Gate Passed: ${missionBridge.localDesktopAgentGatePassed === true ? 'yes' : 'no'}`,
    `Mission Bridge Mission Packet From Operator Intent: ${missionBridge.missionPacketGeneratedFromOperatorIntent === true ? 'yes' : 'no'}`,
    `Selected Agent ID: ${selectedAgentId}`,
    `Selected Agent State: ${asText(selectedAgent?.state, 'not reported')}`,
    `Selected Agent State Reason: ${asText(selectedAgent?.stateReason, 'not reported')}`,
    `Selected Agent Blockers: ${asText(selectedAgent?.blockers?.join(' | '), 'not reported')}`,
    `Selected Agent Dependencies: ${asText(selectedAgent?.dependencies?.join(', '), 'not reported')}`,
    `Selected Agent Adjudication Gates: ${selectedAgentGateSummary}`,
    `Agent Active IDs: ${asText(agentView?.activeAgentIds?.join(', '), 'none')}`,
    `Agent Acting ID: ${asText(agentView?.actingAgentId, 'none')}`,
    `Agent Waiting IDs: ${asText(agentView?.waitingAgentIds?.join(', '), 'none')}`,
    `Agent Blocked IDs: ${asText(agentView?.blockedAgentIds?.join(', '), 'none')}`,
    `Operator Caution Inferred Intent: ${asText(operatorGuidance.operatorCautionSummary?.inferredIntentCaution, 'none')}`,
    `Operator Caution Sparse Continuity: ${asText(operatorGuidance.operatorCautionSummary?.sparseContinuityCaution, 'none')}`,
    `Operator Route Warnings: ${asText(operatorGuidance.operatorCautionSummary?.routeWarnings?.join(' | '), 'none')}`,
    `Latest Envelope Action Requested: ${asText(operatorGuidance.envelopeProjection?.actionRequested, 'n/a')}`,
    `Latest Envelope Allowed: ${operatorGuidance.envelopeProjection?.actionAllowed === true ? 'yes' : 'no'}`,
    `Latest Envelope Applied: ${operatorGuidance.envelopeProjection?.actionApplied === true ? 'yes' : 'no'}`,
    `Latest Envelope Lifecycle: ${asText(operatorGuidance.envelopeProjection?.lifecycleState, 'unknown')}`,
    `Latest Envelope Build Assistance: ${asText(operatorGuidance.envelopeProjection?.buildAssistanceState, 'unavailable')}`,
    `Latest Envelope Next Action: ${asText(operatorGuidance.envelopeProjection?.nextRecommendedAction, 'n/a')}`,
    `Intent Type: ${asText(runtimeStatus?.lastIntentType, 'unknown')}`,
    `Intent Confidence: ${asText(runtimeStatus?.lastIntentConfidence, '0')}`,
    `Intent Reason: ${asText(runtimeStatus?.lastIntentReason, 'n/a')}`,
    `Mission Packet State: ${asText(runtimeStatus?.lastMissionPacketState, 'inactive')}`,
    `Mission Title: ${asText(runtimeStatus?.lastMissionTitle, 'n/a')}`,
    `Mission Class: ${asText(runtimeStatus?.lastMissionClass, 'analysis')}`,
    `Mission Execution Mode: ${asText(runtimeStatus?.lastMissionExecutionMode, 'analysis-only')}`,
    `Mission Assigned Roles: ${asText(runtimeStatus?.lastMissionAssignedRoles, 'n/a')}`,
    `Mission Planned Tools: ${asText(runtimeStatus?.lastMissionPlannedTools, 'n/a')}`,
    `Mission Blockers: ${asText(runtimeStatus?.lastMissionBlockers, 'n/a')}`,
    `Mission Warnings: ${asText(runtimeStatus?.lastMissionWarnings, 'n/a')}`,
    `Roadmap Promotion Candidate: ${asText(runtimeStatus?.lastRoadmapPromotionCandidate, 'n/a')}`,
    `Mission Codex Handoff Eligible: ${asText(runtimeStatus?.lastCodexHandoffEligibleMission, 'n/a')}`,
    `Tile Action Type: ${asText(runtimeStatus?.lastTileActionType)}`,
    `Tile Source: ${asText(runtimeStatus?.lastTileSource)}`,
    `Memory Candidate Submitted: ${asText(runtimeStatus?.lastMemoryCandidateSubmitted)}`,
    `Tile Memory Promoted: ${asText(runtimeStatus?.lastTileMemoryPromoted)}`,
    `Tile Memory Reason: ${asText(runtimeStatus?.lastTileMemoryReason)}`,
    `Retrieval Contribution Submitted: ${asText(runtimeStatus?.lastRetrievalContributionSubmitted)}`,
    `Retrieval Ingested: ${asText(runtimeStatus?.lastRetrievalIngested)}`,
    `Retrieval Source Ref: ${asText(runtimeStatus?.lastRetrievalSourceRef)}`,
    `AI Policy Mode: ${asText(runtimeStatus?.lastAiPolicyMode, 'local-first-cloud-when-needed')}`,
    `AI Policy Reason: ${asText(runtimeStatus?.lastAiPolicyReason, 'Local-first policy applied.')}`,
    `Execution Truth: ${visibleExecutionTruth}`,
    `Execution Status: ${asText(runtimeStatus?.executionStatus)}`,
    `Route: ${asText(runtimeStatus?.route)}`,
    `Commands: ${asText(runtimeStatus?.commands)}`,
    `Latest Tool: ${asText(runtimeStatus?.latestTool, 'none')}`,
    `UI Marker: ${asText(runtimeStatus?.uiMarker)}`,
    `UI Version: ${asText(runtimeStatus?.uiVersion, 'unknown')}`,
    `UI Git Commit: ${asText(runtimeStatus?.uiGitCommit)}`,
    `UI Build Timestamp: ${asText(runtimeStatus?.uiBuildTimestamp, 'unknown')}`,
    `UI Runtime ID: ${asText(runtimeStatus?.uiRuntimeId)}`,
    `UI Runtime Marker: ${asText(runtimeStatus?.uiRuntimeMarker)}`,
    `Build Alignment State: ${asText(sourceDistAlignment?.buildAlignmentState, 'unknown')}`,
    `Build Truth Status: ${asText(sourceDistAlignment?.buildTruthStatus, 'indeterminate')}`,
    `Build Truth Verdict: ${asText(sourceDistAlignment?.buildTruthOperatorLabel, 'Build certainty unavailable')}`,
    `Build Truth Reason: ${asText(sourceDistAlignment?.buildTruthReason, 'Build certainty unavailable')}`,
    `Route Layer Status: ${asText(operatorBoundary.routeLayerStatus, 'unknown')}`,
    `Backend Execution Contract Status: ${asText(operatorBoundary.backendExecutionContractStatus, 'unknown')}`,
    `Backend Build Alignment Status: ${asText(operatorBoundary.backendBuildAlignmentStatus, 'unknown')}`,
    `Provider Execution Gate Status: ${asText(operatorBoundary.providerExecutionGateStatus, 'unknown')}`,
    `Likely Operator Boundary: ${asText(operatorBoundary.likelyOperatorBoundary, 'unknown')}`,
    `Likely Needs Battle Bridge Rebuild: ${asText(operatorBoundary.likelyNeedsBattleBridgeRebuild, 'unknown')}`,
    `Likely Needs Backend Restart: ${asText(operatorBoundary.likelyNeedsBackendRestart, 'unknown')}`,
    `Route Healthy But Backend Contract Stale: ${asText(operatorBoundary.routeHealthyButBackendContractStale, 'unknown')}`,
    `Request Selection Succeeded But Execution Blocked: ${asText(operatorBoundary.requestSelectionSucceededButExecutionBlocked, 'unknown')}`,
    `Selected Provider Requested But Not Executable: ${asText(operatorBoundary.selectedProviderRequestedButNotExecutable, 'unknown')}`,
    `Stale Battle Bridge Indicators: ${asText(operatorBoundary.staleBattleBridgeIndicators, 'none')}`,
    `Hosted Surface Build Certainty: ${asText(operatorBoundary.hostedSurfaceBuildCertainty, 'unknown')}`,
    `Backend Build Certainty: ${asText(operatorBoundary.backendBuildCertainty, 'unknown')}`,
    `Served Published Build Truth Available: ${asText(operatorBoundary.servedPublishedBuildTruthAvailable, 'unknown')}`,
    `Backend Runtime Contract Version: ${asText(operatorBoundary.backendRuntimeContractVersion, 'unknown')}`,
    `Operator Next Classification: ${asText(operatorBoundary.operatorNextClassification, 'unknown')}`,
    `Build Alignment Severity: ${asText(sourceDistAlignment?.blockingSeverity, 'caution')}`,
    `Build Alignment Reason: ${asText(sourceDistAlignment?.alignmentReason, 'Build alignment cannot be verified from this surface.')}`,
    `Build Alignment Action Required: ${sourceDistAlignment?.operatorActionRequired === true ? 'yes' : 'no'}`,
    `Build Alignment Action: ${asText(sourceDistAlignment?.operatorActionText, 'Run stephanos:build and stephanos:verify before trusting hosted runtime behavior.')}`,
    `Ignition Cleanliness Status: ${asText(runtimeStatus?.IgnitionCleanlinessVerdict || runtimeStatus?.ignitionCleanlinessVerdict, 'unknown')}`,
    `Ignition Auto-Cleaned Generated Count: ${asText(runtimeStatus?.cleanedGeneratedCount || runtimeStatus?.ignitionAutoCleaned || runtimeStatus?.ignitionAutoCleanedGeneratedCount, '0')}`,
    `Ignition Runtime Checkpoint Count: ${asText(runtimeStatus?.checkpointedRuntimeCount || runtimeStatus?.ignitionRuntimeCheckpointCount, '0')}`,
    `Ignition Source Dirt Count: ${asText(runtimeStatus?.sourceDirtCount || runtimeStatus?.ignitionSourceDirtCount, '0')}`,
    `Ignition Dependency Warning Count: ${asText(runtimeStatus?.dependencyWarningCount || runtimeStatus?.ignitionDependencyWarningCount, '0')}`,
    `Ignition Hard Block Count: ${asText(runtimeStatus?.hardBlockCount || runtimeStatus?.ignitionHardBlockCount, '0')}`,
    `Ignition PR Range Guard Status: ${asText(runtimeStatus?.PRGuardStatus || runtimeStatus?.ignitionPrRangeGuardStatus, 'unknown')}`,
    `Ignition Next Operator Action: ${asText(runtimeStatus?.ignitionNextOperatorAction || runtimeStatus?.nextOperatorAction, 'Continue ignition.')}`,
    `Dist Fingerprint (served): ${asText(sourceDistAlignment?.distFingerprint, 'unknown')}`,
    `Served Build Commit: ${asText(sourceDistAlignment?.buildTruthEvidence?.served?.gitCommit, 'unknown')}`,
    `Runtime Build Commit: ${asText(sourceDistAlignment?.buildTruthEvidence?.runtime?.gitCommit, 'unknown')}`,
    `Served Runtime Marker: ${asText(sourceDistAlignment?.buildTruthEvidence?.served?.runtimeMarker, 'unknown')}`,
    `Runtime Runtime Marker: ${asText(sourceDistAlignment?.buildTruthEvidence?.runtime?.runtimeMarker, 'unknown')}`,
    `Served Build Timestamp: ${asText(sourceDistAlignment?.buildTruthEvidence?.served?.buildTimestamp, 'unknown')}`,
    `Runtime Build Timestamp: ${asText(sourceDistAlignment?.buildTruthEvidence?.runtime?.buildTimestamp, 'unknown')}`,
    `Source/Dist Parity: ${formatParityState(runtimeStatus?.runtimeTruth?.sourceDistParityOk ?? runtimeStatus?.sourceDistParityOk ?? null)}`,
    `UI Build Target: ${asText(runtimeStatus?.uiBuildTarget)}`,
    `UI Build Target Identifier: ${asText(runtimeStatus?.uiBuildTargetIdentifier)}`,
    `UI Source: ${asText(runtimeStatus?.uiSource)}`,
    `UI Source Fingerprint: ${asText(runtimeStatus?.uiSourceFingerprint)}`,
    `Debug Console: ${asText(runtimeStatus?.debugConsole)}`,
    `Backend Target Resolution Source: ${backendTargetResolutionSource}`,
    `Backend Target Resolved URL: ${visibleBackendTargetResolvedUrl}`,
    `Backend Target Fallback Used: ${backendTargetFallbackUsed ? 'yes' : 'no'}`,
    `Backend Target Invalid Reason: ${backendTargetInvalidReason}`,
    `Route Winner Kind: ${asText(runtimeContext?.routeCandidateWinner?.routeKind || routeTruthView?.routeKind)}`,
    `Route Winner Transport Kind: ${asText(runtimeContext?.routeCandidateWinner?.transportKind || routeTruthView?.winningTransportKind, 'none')}`,
    `Route Auto Selection Source: ${asText(runtimeContext?.routeSelectionSource || routeTruthView?.routeSelectionSource, 'route-preference-order')}`,
    `Route Auto Switch Active: ${runtimeContext?.routeAutoSwitchActive === true || routeTruthView?.routeAutoSwitchActive === true ? 'yes' : 'no'}`,
    `Route Auto Switch Reason: ${asText(runtimeContext?.routeAutoSwitchReason || routeTruthView?.routeAutoSwitchReason, 'n/a')}`,

    `Home Bridge Transport Selected: ${asText(bridgeTransportTruth.selectedTransport)}`,
    `Home Bridge Transport Configured: ${asText(bridgeTransportTruth.configuredTransport, 'none')}`,
    `Home Bridge Transport Active: ${asText(bridgeTransportTruth.activeTransport, 'none')}`,
    `Home Bridge Transport State: ${asText(bridgeTransportTruth.state, 'unconfigured')}`,
    `Home Bridge Transport Detail: ${asText(bridgeTransportTruth.detail, 'n/a')}`,
    `Home Bridge Transport Reason: ${asText(bridgeTransportTruth.reason, 'n/a')}`,
    `Home Bridge Transport Reachability: ${asText(bridgeTransportTruth.reachability, 'unknown')}`,
    `Home Bridge Transport Usability: ${asText(bridgeTransportTruth.usability, 'no')}`,
    `Home Bridge Transport Source: ${asText(bridgeTransportTruth.source, 'n/a')}`,
    `Bridge Memory Present: ${bridgeTransportTruth.bridgeMemoryPresent === true ? 'yes' : 'no'}`,
    `Bridge Memory Transport: ${asText(bridgeTransportTruth.bridgeMemoryTransport, 'none')}`,
    `Bridge Memory URL: ${asText(bridgeTransportTruth.bridgeMemoryUrl, 'none')}`,
    `Bridge Memory Remembered At: ${asText(bridgeTransportTruth.bridgeMemoryRememberedAt, 'not yet')}`,
    `Bridge Memory Rehydrated: ${bridgeTransportTruth.bridgeMemoryRehydrated === true ? 'yes' : 'no'}`,
    `Bridge Memory Needs Validation: ${bridgeTransportTruth.bridgeMemoryNeedsValidation === true ? 'yes' : 'no'}`,
    `Bridge Memory Validation State: ${asText(bridgeTransportTruth.bridgeMemoryValidationState, 'absent')}`,
    `Bridge Memory Reason: ${asText(bridgeTransportTruth.bridgeMemoryReason, 'n/a')}`,
    `Bridge Memory Reconciliation State: ${asText(bridgeTransportTruth.bridgeMemoryReconciliationState, 'no-remembered-bridge')}`,
    `Bridge Memory Reconciliation Reason: ${asText(bridgeTransportTruth.bridgeMemoryReconciliationReason, 'n/a')}`,
    `Bridge Memory Reconciliation Provenance: ${asText(bridgeTransportTruth.bridgeMemoryReconciliationProvenance, 'n/a')}`,
    `Bridge Memory Auto Validation Attempted: ${bridgeTransportTruth.bridgeMemoryAutoValidationAttempted === true ? 'yes' : 'no'}`,
    `Bridge Memory Auto Validation State: ${asText(bridgeTransportTruth.bridgeMemoryAutoValidationState, 'idle')}`,
    `Bridge Memory Auto Validation Reason: ${asText(bridgeTransportTruth.bridgeMemoryAutoValidationReason, 'n/a')}`,
    `Bridge Memory Validated On This Surface: ${bridgeTransportTruth.bridgeMemoryValidatedOnThisSurface === true ? 'yes' : 'no'}`,
    `Bridge Memory Reachable On This Surface: ${bridgeTransportTruth.bridgeMemoryReachableOnThisSurface === true ? 'yes' : 'no'}`,
    `Bridge Memory Promoted To Route Candidate: ${bridgeTransportTruth.bridgeMemoryPromotedToRouteCandidate === true ? 'yes' : 'no'}`,
    `Bridge Memory Promotion Reason: ${asText(bridgeTransportTruth.bridgeMemoryPromotionReason, 'n/a')}`,
    `Bridge Memory Last Validated At: ${asText(bridgeTransportTruth.bridgeMemoryLastValidatedAt, 'not yet')}`,
    `Bridge Memory Persistence State: ${asText(bridgeTransportTruth.bridgeMemoryPersistenceState, 'idle')}`,
    `Bridge Memory Persistence Reason: ${asText(bridgeTransportTruth.bridgeMemoryPersistenceReason, 'n/a')}`,
    `Bridge Memory Persistence At: ${asText(bridgeTransportTruth.bridgeMemoryPersistenceAt, 'not yet')}`,
    `Persistence Attempted: ${persistenceTruth?.lastWrite?.attempted === true ? 'yes' : 'no'}`,
    `Persistence Succeeded: ${persistenceTruth?.lastWrite?.succeeded === true ? 'yes' : 'no'}`,
    `Last Persistence Time: ${asText(persistenceTruth?.lastWrite?.timestamp, 'not yet')}`,
    `Last Persistence Error: ${asText(persistenceTruth?.lastError || persistenceTruth?.lastWrite?.error?.message, 'null')}`,
    `Persistence Reconciled Across Surfaces: ${persistenceTruth?.reconciledAcrossSurfaces === true ? 'yes' : 'no'}`,
    `Bridge Memory Write Attempted: ${bridgeTransportTruth.bridgeMemoryWriteAttempted === true ? 'yes' : 'no'}`,
    `Bridge Memory Write Succeeded: ${bridgeTransportTruth.bridgeMemoryWriteSucceeded === true ? 'yes' : 'no'}`,
    `Bridge Memory Read Attempted: ${bridgeTransportTruth.bridgeMemoryReadAttempted === true ? 'yes' : 'no'}`,
    `Bridge Memory Read Source: ${asText(bridgeTransportTruth.bridgeMemoryReadSource, 'none')}`,
    `Bridge Memory Read Result: ${asText(bridgeTransportTruth.bridgeMemoryReadResult, 'none')}`,
    `Bridge Memory Cleared By: ${asText(bridgeTransportTruth.bridgeMemoryClearedBy, 'none')}`,
    `Bridge Memory Clobber Detected: ${bridgeTransportTruth.bridgeMemoryClobberDetected === true ? 'yes' : 'no'}`,
    `Bridge Memory Storage Key: ${asText(bridgeTransportTruth.bridgeMemoryStorageKey, 'stephanos.durable.memory.v2')}`,
    `Bridge Memory Storage Scope: ${asText(bridgeTransportTruth.bridgeMemoryStorageScope, 'shared-runtime-memory')}`,
    `Bridge Memory Last Raw Value Summary: ${asText(bridgeTransportTruth.bridgeMemoryLastRawValueSummary, 'none')}`,
    `Bridge Input Raw: ${asText(bridgeTransportTruth.bridgeInputRaw, 'none')}`,
    `Bridge Input Normalized: ${asText(bridgeTransportTruth.bridgeInputNormalized, 'none')}`,
    `Bridge Persisted Value: ${asText(bridgeTransportTruth.bridgePersistedValue, 'none')}`,
    `Bridge Rehydrated Value: ${asText(bridgeTransportTruth.bridgeRehydratedValue, 'none')}`,
    `Bridge Probe Target: ${asText(bridgeTransportTruth.bridgeProbeTarget, 'none')}`,
    `Bridge Operator Transport URL: ${asText(bridgeTransportTruth.bridgeOperatorTransportUrl, 'none')}`,
    `Bridge Hosted Execution URL: ${asText(bridgeTransportTruth.bridgeHostedExecutionBridgeUrl, 'none')}`,
    `Bridge Mode: ${asText(bridgeTransportTruth.bridgeMode, 'standard')}`,
    `Bridge Direct Reachability: ${asText(bridgeTransportTruth.bridgeDirectReachability, 'unknown')}`,
    `Bridge Hosted Execution Compatibility: ${asText(bridgeTransportTruth.bridgeHostedExecutionCompatibility, 'unknown')}`,
    `Bridge Hosted Execution Target: ${asText(bridgeTransportTruth.bridgeHostedExecutionTarget, 'none')}`,
    `Bridge Hosted Execution Requirement: ${asText(bridgeTransportTruth.bridgeHostedExecutionRequirement, 'none')}`,
    `Bridge Auto Revalidation State: ${asText(bridgeTransportTruth.bridgeAutoRevalidationState, 'idle')}`,
    `Bridge Auto Revalidation Reason: ${asText(bridgeTransportTruth.bridgeAutoRevalidationReason, 'n/a')}`,
    `Tailscale Device Name: ${asText(bridgeTransportTruth?.tailscale?.deviceName)}`,
    `Tailscale IP: ${asText(bridgeTransportTruth?.tailscale?.tailnetIp)}`,
    `Tailscale Backend URL: ${asText(bridgeTransportTruth?.tailscale?.backendUrl)}`,
    `Tailscale Bridge Accepted: ${asText(bridgeTransportTruth?.tailscale?.accepted)}`,
    `Tailscale Bridge Reachable: ${asText(bridgeTransportTruth?.tailscale?.reachable)}`,
    `Tailscale Bridge Usable: ${asText(bridgeTransportTruth?.tailscale?.usable)}`,
    `Tailscale Bridge Reason: ${asText(bridgeTransportTruth?.tailscale?.reason, 'n/a')}`,
    'Route Candidates:',
    ...routeCandidateSummary,
    'Backend Target Candidates:',
    ...backendTargetCandidatesSummary,
    `Selected Route Kind: ${selectedRouteKind}`,
    `Preferred Target: ${asText(routeTruthView?.preferredTarget, 'n/a')}`,
    `Actual Target Used: ${visibleActualTargetUsed}`,
    `Winning Reason: ${asText(runtimeRouteTruth?.winningReason || routeTruthView?.winnerReason, 'n/a')}`,
    `UI Reachable: ${asText(runtimeReachabilityTruth?.uiReachableState || routeTruthView?.uiReachableState)}`,
    `Selected Route Reachable: ${asText(routeTruthView?.selectedRouteReachableState)}`,
    `Selected Route Usable: ${asText(routeTruthView?.routeUsableState)}`,
    `Selected Route Usability Veto Reason: ${asText(routeTruthView?.routeUsabilityVetoReason, 'n/a')}`,
    `Route Reconciled: ${routeTruthView?.routeReconciled ? 'yes' : 'no'}`,
    `Route Reconciliation Reason: ${asText(routeTruthView?.routeReconciliationReason, 'n/a')}`,
    `Truth Inconsistent: ${routeTruthView?.truthInconsistent ? 'yes' : 'no'}`,
    `Route Usability Conflict: ${routeTruthView?.routeUsabilityConflict ? 'yes' : 'no'}`,
    `Provider Mismatch: ${providerExecutionIsSuppressed ? (routeBlockedBeforeProvider ? 'route-blocked/no-provider-executed' : 'historical-stale-provider-suppressed') : (routeTruthView?.providerMismatch ? 'yes' : providerDriftDiagnostics.providerMismatch)}`,
    `Provider Drift Boundary: ${providerExecutionIsSuppressed ? 'none' : providerDriftDiagnostics.providerDriftBoundary}`,
    `Provider Drift Reason: ${providerExecutionIsSuppressed ? 'none' : providerDriftDiagnostics.providerDriftReason}`,
    `Provider Drift Allowed: ${providerExecutionIsSuppressed ? 'n/a' : providerDriftDiagnostics.providerDriftAllowed}`,
    `Provider Drift Policy Source: ${providerExecutionIsSuppressed ? 'n/a' : providerDriftDiagnostics.providerDriftPolicySource}`,
    `Home Available: ${asYesNoUnknown(runtimeStatus?.homeNodeReachable)}`,
    `Executable Provider: ${providerExecutionIsSuppressed ? 'none' : asText(canonicalTruth.executedProvider || runtimeProviderTruth?.executableProvider, 'none')}`,
    '',
    'routeDiagnosticsSummary:',
    ...effectiveRouteDiagnosticsSummary,
    `Route Diagnostics Summary Source: ${routeDiagnosticsSummarySource}`,
    `Route Diagnostics Candidate Reconciled: ${routeDiagnosticsCandidateReconciled}`,
    `Local Desktop Candidate State Used For Summary: ${localDesktopCandidateStateUsedForSummary}`,
    `Local Desktop Candidate Source: ${localDesktopCandidateSource}`,
    `Local Desktop Candidate Health Probe Applied: ${localDesktopCandidateHealthProbeApplied}`,
    `Effective Backend Available Source: ${effectiveBackendAvailableSource}`,
    `Local Desktop Runtime Diagnostic State: ${asText(localDesktopRuntimeDiagnostics?.available === true ? 'available' : localDesktopRuntimeDiagnostics?.available === false ? 'unavailable' : localDesktopRuntimeDiagnostics?.usable === true ? 'usable' : localDesktopRuntimeDiagnostics?.usable === false ? 'blocked' : '', 'n/a')}`,
    '',
    'blockingIssues:',
    ...asList(blockingIssues),
    '',
    'invariantWarnings:',
    ...asList(invariantWarnings),
    '',
    'operatorGuidance:',
    ...asList(guidanceItems),
  ];

  return lines.join('\n');
}
