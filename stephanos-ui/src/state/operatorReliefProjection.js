function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}
function asList(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
export const HARNESS_AGENT_VERSION = 'v1.2';

const UI_BROWSER_CHECKLIST = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];
const AI_CONSOLE_AUTOSCROLL_PROOF_ID = 'aiconsole-answer-pane-autoscroll';
const MAX_GAP_REASON_LENGTH = 240;
const MAX_REPAIR_PROMPT_LENGTH = 4000;
const MAX_QUEUE_PAYLOAD_LENGTH = 2400;


const PROTECTED_CANON_CLAUSE_CATALOG = Object.freeze({
  COMMAND_DECK: [
    'Preserve Answer Delivery Contract.',
    'Preserve final_assistant_message_id → deliveryAnchoredAssistantAnswerId binding.',
    'Preserve data-assistant-answer-id, data-answer-role, data-answer-final, and data-delivery-anchored attributes.',
    'Preserve delivered-answer reveal/scroll diagnostics.',
    'Preserve inner answer-history scroll.',
    'Preserve no-jump nearest outer reveal behavior.',
    'Preserve tuned viewport clamp: min-height clamp(20rem, 46vh, 34rem) and max-height clamp(28rem, 66vh, 50rem).',
    'Preserve composer/input/execute visibility.',
    'Preserve canonical copy button behavior with green success state after successful clipboard write.',
  ],
  IGNITION: [
    'Preserve Windows desktop Ignite button path: Launch-Stephanos-Local.cmd → Launch-Stephanos-Local.ps1 → npm run stephanos:ignite.',
    'Preserve automatic Housekeeper preflight before normal ignition startup.',
    'Preserve safe generated/runtime cleanup only.',
    'Preserve source dirt, hard-block, secrets, unknown binaries blocking startup.',
    'Preserve build + verify in ignition path.',
    'Preserve compact default ignition output.',
    'Preserve filesystem debug crawl only behind --debug or STEPHANOS_DEBUG=1.',
    'Preserve vite-dev path behavior.',
  ],
  PR_HYGIENE: [
    'Preserve source-only PR rule.',
    'Forbid apps/stephanos/dist/**, runtime/**, node_modules/**, secrets/**, root data/** unless explicitly allowlisted.',
    'Never use git add .',
    'Require npm run stephanos:guard:pr-clean.',
    'Require generated dist/runtime dirt cleanup after build/verify.',
  ],
  PROVIDER_ROUTING: [
    'Preserve requested vs selected vs executable vs actual provider separation.',
    'Preserve route reachability vs usability vs browser compatibility separation.',
    'Preserve stale/fresh answer truth.',
    'Preserve zero-cost fresh capability rules.',
    'Preserve truthful degradation when fresh route is unavailable.',
  ],
  MEMORY_RETRIEVAL: [
    'Preserve memory write gates.',
    'Preserve provenance requirements for durable memory.',
    'Preserve retrieval as context augmentation only.',
    'Do not promote transient/freshness-sensitive facts into durable memory without approval.',
    'Preserve operator approval for important durable project-law changes.',
  ],
  MISSION_BRAIN: [
    'Preserve Harness Agent as read-only/adjudication only.',
    'Preserve Operator Relief / Mission Brain as the existing surface.',
    'Do not create duplicate panes or parallel authority.',
    'Preserve operator as final merge approver.',
    'Preserve merge recommendation as advisory, not automatic merge.',
  ],
});

function deriveProtectedSubsystems(changedFiles = []) {
  const files = asList(changedFiles).map((f) => String(f).toLowerCase());
  const subsystems = new Set();
  if (files.some((f) => /commanddeck|aiconsole|answerdelivery|useaiconsole|missioncommanddeck/.test(f))) subsystems.add('COMMAND_DECK');
  if (files.some((f) => /ignite-stephanos-local|windows-launcher|launch-stephanos-local|housekeep|vite-dev/.test(f))) subsystems.add('IGNITION');
  if (files.some((f) => /provider|backend|routing|route/.test(f))) subsystems.add('PROVIDER_ROUTING');
  if (files.some((f) => /memory|retrieval|session/.test(f))) subsystems.add('MEMORY_RETRIEVAL');
  if (files.some((f) => /operatorrelief|operator-relief|missionconsole|mission-console|harness/.test(f))) subsystems.add('MISSION_BRAIN');
  if (files.length > 0) subsystems.add('PR_HYGIENE');
  return Array.from(subsystems);
}

function deriveProtectedCanonClauses({ riskLevel = 'low', changedFiles = [] } = {}) {
  const subsystems = deriveProtectedSubsystems(changedFiles);
  const clauseKeys = new Set(subsystems);
  const hasUnknownSubsystem = clauseKeys.size === 0 || (clauseKeys.size === 1 && clauseKeys.has('PR_HYGIENE'));
  const unknownBuildOrchestrationContext = asList(changedFiles).length === 0;

  if (riskLevel === 'high' && hasUnknownSubsystem) {
    ['PR_HYGIENE', 'MISSION_BRAIN', 'COMMAND_DECK', 'IGNITION'].forEach((k) => clauseKeys.add(k));
    if (unknownBuildOrchestrationContext) ['PROVIDER_ROUTING', 'MEMORY_RETRIEVAL'].forEach((k) => clauseKeys.add(k));
  }

  const protectedCanonClauses = Array.from(clauseKeys).flatMap((k) => PROTECTED_CANON_CLAUSE_CATALOG[k] || []);
  const fallbackApplied = riskLevel === 'high' && hasUnknownSubsystem && protectedCanonClauses.length > 0;
  const protectedCanonWarning = fallbackApplied
    ? 'Affected subsystem unknown; conservative protected canon fallback applied.'
    : (protectedCanonClauses.length === 0 ? 'Protected canon clauses are empty; operator review required before high-risk execution.' : '');

  return { protectedCanonClauses, protectedSubsystems: Array.from(clauseKeys), protectedCanonWarning, fallbackApplied, hasUnknownSubsystem };
}

function truncateText(value, max = MAX_GAP_REASON_LENGTH) {
  const text = asText(value, '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}


export const MUSIC_FAILURE_SCENARIO_PACK = Object.freeze({
  spotify_resolver_not_configured: { evidenceType: 'runtime/provider_status', likelyBlocker: 'Spotify resolver missing or disconnected.', requiredProof: 'Provider configured + Spotify open link works.', nextAction: 'Configure Spotify resolver and rerun browser smoke.', mergeSafe: false, lessonCandidate: 'Spotify resolver must be configured before claiming music proof.' },
  ai_suggested_fake_track: { lessonCandidate:'AI-generated music candidates remain unverified until catalog validation.' },
  build_journey_froze: { requiredProof:'Build Journey completes in browser without freeze.' },
  wrong_spotify_url: { lessonCandidate:'Spotify search URLs must never become playable refs.' },
  false_canon_invention: { lessonCandidate:'Canon means extract from working surface first.' },
});

function buildEvidenceGaps({ testsRequired, testsPassed, parsed, browserRequired, browserMissing, runtimeEvidence, verification, operatorDecisions, repairPromptAvailable, codexChangedFiles }) {
  const gaps = [];
  if (testsRequired.length > 0 && testsPassed === 0) gaps.push({ id: 'targeted-tests-missing', severity: 'high', label: 'Targeted tests missing', reason: 'Mission marks targeted tests as required but no runs are recorded.', requiredAction: 'run-targeted-tests', source: 'intent_to_build/proof_of_done' });
  if (!parsed.buildRun) gaps.push({ id: 'build-missing', severity: 'high', label: 'Build evidence missing', reason: 'Build run evidence is missing.', requiredAction: 'run-build', source: 'proof_of_done.verificationJudge' });
  if (!parsed.verifyRun) gaps.push({ id: 'verify-missing', severity: 'high', label: 'Verify evidence missing', reason: 'Verify run evidence is missing.', requiredAction: 'run-verify', source: 'proof_of_done.verificationJudge' });
  if (browserRequired && browserMissing.length > 0) gaps.push({ id: 'browser-proof-missing', severity: 'high', label: 'Browser proof missing', reason: `Missing ${browserMissing.length} required browser proof checks.`, requiredAction: 'run-browser-proof', source: 'proof_of_done.browserChecksObserved' });
  if (runtimeEvidence.routeStatus === 'unknown' || runtimeEvidence.providerStatus === 'unknown') gaps.push({ id: 'runtime-status-unknown', severity: 'medium', label: 'Runtime/route truth incomplete', reason: 'Route/provider truth is unknown.', requiredAction: 'collect-runtime-snapshot', source: 'support_snapshot.runtimeStatus' });
  if (runtimeEvidence.consoleErrors.length > 0) gaps.push({ id: 'console-runtime-errors', severity: 'high', label: 'Console/runtime errors detected', reason: truncateText(runtimeEvidence.consoleErrors.join(' | ')), requiredAction: 'request-codex-repair', source: 'proof_of_done.consoleErrors' });
  if (verification.mergeReadyCandidate && operatorDecisions.length === 0) gaps.push({ id: 'operator-decision-missing', severity: 'medium', label: 'Operator decision missing', reason: 'Merge candidate still requires explicit operator decision.', requiredAction: 'approve-merge', source: 'operator_decision_queue' });
  if (gaps.some((g) => g.id.includes('missing') || g.id.includes('errors')) && !repairPromptAvailable) gaps.push({ id: 'repair-prompt-missing', severity: 'medium', label: 'Repair prompt missing', reason: 'Evidence indicates repair flow but no repair prompt is available.', requiredAction: 'review-repair-prompt', source: 'operator_relief' });
  if (codexChangedFiles.some((f) => /(?:memory|session|event).*\.(?:json|log)$/i.test(f))) gaps.push({ id: 'local-runtime-files-staged', severity: 'high', label: 'Local runtime files staged', reason: 'Staged files appear to include local runtime memory/event artifacts.', requiredAction: 'remove-local-runtime-files', source: 'pr_evidence.changedFiles' });
  return gaps;
}

function deriveAiConsoleAutoscrollProof(supportSnapshot = {}) {
  const scroll = supportSnapshot?.aiConsoleScrollDiagnostics || supportSnapshot?.supportSnapshot?.aiConsoleScrollDiagnostics || {};
  const checks = [
    ['one answer pane', Number(scroll.answerPaneCount) === 1],
    ['latest final assistant answer present', scroll.latestFinalAssistantAnswerPresent === true],
    ['autoscroll requested', scroll.requested === 'yes'],
    ['request reason final-assistant-answer-rendered', scroll.requestReason === 'final-assistant-answer-rendered'],
    ['target kind latest-assistant-answer-pane', scroll.targetKind === 'latest-assistant-answer-pane'],
    ['target found', scroll.targetFound === 'yes'],
    ['container found', scroll.containerFound === 'yes'],
    ['container scrollable', scroll.containerScrollable === 'yes'],
    ['scroll method container-scroll', scroll.scrollMethod === 'container-scroll'],
    ['scroll completed', scroll.scrollCompleted === 'yes'],
    ['skip reason none', scroll.skipReason === 'none'],
    ['no stale/pending/prompt-row targeting', scroll.targetHasPromptRow !== 'yes' && scroll.targetHasPendingRow !== 'yes' && scroll.targetHasStaleRow !== 'yes'],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { complete: missing.length === 0, missing, source: 'support_snapshot.aiConsoleScrollDiagnostics' };
}

function buildAgentWorkRoutingProjection({ missionBrainNextAction = {}, missionSpec = {}, supportSnapshot = {}, harnessAgentProjection = {} } = {}) {
  const nextAction = asText(missionBrainNextAction.nextBestAction, '').toLowerCase();
  const gaps = asList(missionBrainNextAction.openEvidenceGaps || []);
  const blockers = [];
  const warnings = [];
  const browserProofNeeded = /browser|proof|visual/.test(nextAction) || gaps.some((gap) => String(gap.id || '').includes('browser'));
  const routeUnknown = /unknown|n\/a/.test(asText(supportSnapshot?.routeStatus, 'unknown'));
  const hasHarnessClauses = asList(harnessAgentProjection.protectedCanonClauses).length > 0;
  const hasForbiddenFiles = asList(harnessAgentProjection.forbiddenFiles).length > 0;
  const openClawExecutionReady = false;

  if (!hasHarnessClauses) blockers.push('Harness Agent protected canon clauses missing.');
  if (routeUnknown) warnings.push('Runtime route/provider truth is partially unknown.');
  if (hasForbiddenFiles) warnings.push('Forbidden file scopes are present and must remain untouched.');

  let recommendedRoute = 'codex';
  let workRoutingStatus = 'ready';
  let recommendedRouteReason = 'Bounded source/test/projection work packet is available and approval-gated for Codex.';

  if (!hasHarnessClauses) {
    recommendedRoute = 'hold';
    workRoutingStatus = 'blocked';
    recommendedRouteReason = 'Hold until Harness Agent clauses and proof boundaries are present.';
  } else if (browserProofNeeded) {
    recommendedRoute = 'manual-operator';
    workRoutingStatus = 'degraded';
    recommendedRouteReason = 'Manual operator/browser proof is required before final merge claims.';
  } else if (/audit|discover|map|research/.test(nextAction)) {
    recommendedRoute = 'openclaw-research';
    workRoutingStatus = 'degraded';
    recommendedRouteReason = 'Task is reconnaissance/audit oriented and should remain read-only.';
  }

  const codexReady = recommendedRoute === 'codex' ? 'yes' : 'no';
  const openClawResearchReady = recommendedRoute === 'openclaw-research' ? 'yes' : 'no';
  if (!openClawExecutionReady) warnings.push('OpenClaw execution: not ready; research/audit only unless policy harness approves.');

  const missionSummary = asText(missionBrainNextAction.missionObjective, missionSpec.objective || 'Mission summary unavailable.');
  const smallestNextWorkPacket = asText(missionBrainNextAction.nextBestAction, 'Review mission evidence and prepare bounded patch packet.');
  const requiredProof = browserProofNeeded
    ? ['targeted tests', 'build', 'verify', 'browser proof checklist', 'pr-clean']
    : ['targeted tests', 'build', 'verify', 'pr-clean'];
  const protectedSubsystems = Array.from(new Set(asList(harnessAgentProjection.protectedSubsystems).concat(['MISSION_BRAIN', 'COMMAND_DECK', 'IGNITION'])));
  const allowedScopeSummary = 'Bounded source-only edits in mission/operator-relief projections, mission console surface, context wiring, and tests.';
  const forbiddenScopeSummary = 'No dist/runtime/root-data/node_modules/secrets; no provider/backend execution routing rewires; no new panes; no branch choreography burden.';
  const nextOperatorAction = recommendedRoute === 'hold'
    ? 'Hold and restore proof/canon boundaries first.'
    : 'Approve/copy the bounded Codex packet for the smallest integration step, or hold. Do not manually juggle branches.';

  const codexPacket = {
    missionSummary,
    smallestNextWorkPacket,
    allowedFiles: asList(harnessAgentProjection.allowedFileScopes),
    forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes),
    harnessAgentClauses: asList(harnessAgentProjection.protectedCanonClauses),
    requiredTests: asList(harnessAgentProjection.requiredTests).length ? asList(harnessAgentProjection.requiredTests) : ['node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
    requiredProof,
    definitionOfDone: asList(harnessAgentProjection.definitionOfDone),
    finalReportRequirements: asList(harnessAgentProjection.finalReportRequirements),
    operatorWorkflowPreference: 'main-first/main-only',
  };
  const openClawResearchPacket = {
    researchObjective: 'Read-only audit/recon for mission routing and proof state; no execution.',
    allowedReadOnlyScope: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'scripts/**'],
    forbiddenMutations: ['no writes', 'no branch/merge actions', 'no provider/backend execution changes'],
    proofToCollect: requiredProof,
    approvalGateReminder: 'Operator approval required before any execution-oriented handoff.',
    stopConditions: ['scope ambiguity', 'canon/proof contradiction', 'forbidden file touch detected'],
    killSwitchPolicyReminder: 'OpenClaw execution remains blocked until explicit policy/readiness true.',
  };

  return {
    workRoutingStatus,
    recommendedRoute,
    recommendedRouteReason,
    codexReady,
    openClawResearchReady,
    openClawExecutionReady: openClawExecutionReady ? 'yes' : 'no',
    operatorApprovalRequired: 'yes',
    approvalRequired: true,
    riskLevel: asText(missionBrainNextAction.riskLevel, 'medium'),
    protectedSubsystems,
    allowedScopeSummary,
    forbiddenScopeSummary,
    requiredProof,
    smallestNextWorkPacket,
    requiredTests: asList(harnessAgentProjection.requiredTests).length ? asList(harnessAgentProjection.requiredTests) : ['node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
    copyCodexPacketAvailable: 'yes',
    copyOpenClawPacketAvailable: 'yes',
    blockers,
    warnings,
    nextOperatorAction,
    copyCodexWorkPacket: codexPacket,
    copyOpenClawResearchPacket: openClawResearchPacket,
    sourceEvidence: asList(missionBrainNextAction.sourceEvidence),
  };
}


function buildCoBuilderLoopProjection({ missionIntelligenceSummary = {}, harnessAgentProjection = {}, agentWorkRoutingProjection = {}, verificationReturnIntake = {}, missionBrainNextAction = {}, supportSnapshot = {} } = {}) {
  const maxRounds = 3;
  const loopRound = Number(supportSnapshot?.coBuilderLoopRound || supportSnapshot?.loopRound || 1) || 1;
  const blockers = [];
  const warnings = [];
  if (!asList(harnessAgentProjection.protectedCanonClauses).length) blockers.push('Harness clauses missing.');
  if (!asList(agentWorkRoutingProjection.requiredProof).length) blockers.push('Proof requirements are unclear.');
  const exceededRounds = loopRound > maxRounds;
  if (exceededRounds) blockers.push('Max rounds exceeded; route to operator/hold.');
  const proofMissing = asList(verificationReturnIntake.missingEvidence);
  const repairNeeded = verificationReturnIntake.mergeRecommendation === 'needs-repair' || proofMissing.length > 0;
  const blocked = blockers.length > 0;
  const coBuilderStatus = blocked ? 'blocked' : (repairNeeded ? 'repair-needed' : (verificationReturnIntake.evidenceCompleteness === 'complete' ? 'ready' : 'awaiting-proof'));
  const recommendedLead = blocked ? 'hold' : (repairNeeded ? 'codex-repair' : (agentWorkRoutingProjection.recommendedRoute === 'openclaw-research' ? 'openclaw-research' : 'codex-implementation'));
  return {
    coBuilderStatus, loopRound, maxRounds,
    currentObjective: missionIntelligenceSummary.currentMissionSummary || missionBrainNextAction.missionObjective || 'unknown',
    recommendedLead,
    recommendedNextWorker: recommendedLead === 'hold' ? 'hold' : (recommendedLead.startsWith('openclaw') ? 'openclaw' : 'codex'),
    recommendedNextAction: blocked ? 'hold and restore canon/proof boundaries' : (repairNeeded ? 'copy repair packet and request bounded codex repair' : 'copy next packet and request approval-gated execution'),
    operatorApprovalRequired: 'yes',
    codexPacketAvailable: 'yes',
    openClawResearchPacketAvailable: 'yes',
    openClawExecutionPacketAvailable: agentWorkRoutingProjection.openClawExecutionReady === 'yes' ? 'yes' : 'no',
    verificationPacketAvailable: 'yes',
    repairPacketAvailable: repairNeeded ? 'yes' : 'no',
    requiredProof: asList(agentWorkRoutingProjection.requiredProof),
    acceptanceCriteria: asList(harnessAgentProjection.definitionOfDone),
    protectedCanonSummary: asList(harnessAgentProjection.protectedCanonClauses),
    allowedScopeSummary: agentWorkRoutingProjection.allowedScopeSummary || 'Bounded source-only scope.',
    forbiddenScopeSummary: agentWorkRoutingProjection.forbiddenScopeSummary || 'No generated/runtime artifacts or duplicate systems.',
    blockers, warnings,
    stopConditions: ['maxRounds exceeded', 'harness/proof contradictions', 'forbidden scope touched'],
    finalOperatorDecisionNeeded: 'approve | hold | copy packet',
    copyOpenClawResearchPacket: { objective: missionIntelligenceSummary.nextBestAction || missionBrainNextAction.nextBestAction || 'Read-only audit and proof collection.', readOnlyScope: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'scripts/**'], filesOrAreasToInspect: ['operatorReliefProjection', 'MissionConsoleTile', 'chatContextOrchestrator', 'supportSnapshot'], canonToPreserve: asList(harnessAgentProjection.protectedCanonClauses), proofToCollect: asList(agentWorkRoutingProjection.requiredProof), explicitForbiddenActions: ['No source mutation.', 'No branch/merge choreography.', 'No auto-dispatch.'], noMutationReminder: 'Read-only audit only.', outputFormatRequired: 'Findings + file map + proof checklist + blockers/warnings.', stopConditions: ['Harness/proof contradictions', 'forbidden file touch risk', 'scope ambiguity'], operatorApprovalReminder: 'Operator approval required before any execution handoff.' },
    copyCodexImplementationPacket: { objective: missionIntelligenceSummary.nextBestAction || missionBrainNextAction.nextBestAction || 'Bounded implementation packet.', auditFindingsToUse: asList(agentWorkRoutingProjection.sourceEvidence), allowedFiles: asList(harnessAgentProjection.allowedFileScopes), forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes).concat(asList(harnessAgentProjection.forbiddenFiles)), protectedCanonClauses: asList(harnessAgentProjection.protectedCanonClauses), smallestBoundedChange: agentWorkRoutingProjection.smallestNextWorkPacket || 'Fix the smallest correct thing.', requiredTests: asList(harnessAgentProjection.requiredTests), buildVerifyPrCleanRequirements: ['npm run stephanos:build', 'npm run stephanos:verify', 'npm run stephanos:guard:pr-clean'], noGeneratedRuntimeArtifacts: 'Do not stage dist/runtime/root data/node_modules/secrets.', finalReportRequirements: asList(harnessAgentProjection.finalReportRequirements), operatorWorkflowPreference: 'main-first/main-only' },
    copyVerificationPacket: { requiredChecks: asList(agentWorkRoutingProjection.requiredTests).concat(asList(agentWorkRoutingProjection.requiredProof)), snapshotBrowserProofRequirements: ['Support Snapshot projection fields', 'browser proof checklist for UI claims'], exactFieldsToConfirm: ['coBuilderStatus', 'recommendedLead', 'requiredProof', 'Mission Planning Prompt Context Used', 'Project Awareness Prompt Sources'], expectedPassFailOutcomes: ['pass when checks + proof complete and no forbidden files', 'fail when evidence gaps remain'], proofFailureAction: 'Generate repair packet preserving Harness contract.' },
    copyRepairPacket: repairNeeded ? { failingProof: proofMissing, likelyRepairBoundary: 'mission/operator-relief projection + related tests only', allowedFiles: asList(harnessAgentProjection.allowedFileScopes), forbiddenFiles: asList(harnessAgentProjection.forbiddenFileScopes).concat(asList(harnessAgentProjection.forbiddenFiles)), requiredTests: asList(harnessAgentProjection.requiredTests), rule: 'Fix smallest correct thing; do not broaden scope.' } : null,
  };
}
function buildVerificationReturnIntake({ prEvidenceModel = {}, parsed = {}, missionState = 'active', missionBrainNextAction = {} } = {}) {
  const changedFiles = asList(prEvidenceModel.changedFiles || prEvidenceModel.files);
  const forbiddenPattern = /(apps\/stephanos\/dist\/|node_modules\/|runtime\/|root data\/|secret|token)/i;
  const forbiddenArtifactRisk = changedFiles.some((file) => forbiddenPattern.test(file));
  const buildObserved = parsed.buildRun === true;
  const verifyObserved = parsed.verifyRun === true;
  const browserProofObserved = missionBrainNextAction?.openEvidenceGaps?.some((gap) => gap.id === 'browser-proof-missing') ? 'missing' : 'reported';
  const missingEvidence = [];
  if (!buildObserved) missingEvidence.push('build evidence missing');
  if (!verifyObserved) missingEvidence.push('verify evidence missing');
  if (browserProofObserved === 'missing') missingEvidence.push('browser proof missing for UI mission');
  const technicallyCleanButProofPending = buildObserved && verifyObserved && !forbiddenArtifactRisk && browserProofObserved === 'missing';
  const returnStatus = forbiddenArtifactRisk
    ? 'blocked-forbidden-artifacts'
    : technicallyCleanButProofPending
      ? 'technically-clean-but-proof-pending'
      : (missingEvidence.length === 0 ? 'merge-candidate-operator-approval-required' : missionState);
  const mergeRecommendation = forbiddenArtifactRisk
    ? 'blocked'
    : technicallyCleanButProofPending
      ? 'blocked-pending-browser-proof'
      : (missingEvidence.length === 0 ? 'review-required' : 'needs-repair');
  return {
    returnStatus,
    evidenceCompleteness: missingEvidence.length === 0 ? 'complete' : 'incomplete',
    changedFiles,
    testsObserved: asList(parsed.testsRun),
    buildObserved,
    verifyObserved,
    browserProofObserved,
    forbiddenArtifactRisk,
    mergeRecommendation,
    requiredOperatorAction: mergeRecommendation === 'needs-repair' ? 'request-repair' : 'operator-review-and-approve',
    missingEvidence,
    repairPromptCandidate: mergeRecommendation === 'needs-repair' ? `Repair required.\nMissing evidence: ${missingEvidence.join(' | ') || 'none'}\nEnsure source-only files, rerun tests/build/verify, and include browser proof checklist for UI changes.` : '',
    sourceEvidence: ['proof_of_done.verificationJudge', 'pr_evidence.changedFiles', 'operator_relief.missionBrainNextAction'],
  };
}

function buildMissionApprovalQueue({ missionBrainNextAction = {}, agentWorkRoutingProjection = {}, verificationReturnIntake = {}, repairPrompt = {}, missionState = 'active', browserProof = {}, missionHandoff = {}, tests = {} } = {}) {
  const queue = [];
  const blockedReason = verificationReturnIntake.mergeRecommendation === 'blocked-pending-browser-proof'
    ? 'Browser proof is required before merge approval.'
    : (verificationReturnIntake.mergeRecommendation === 'blocked' ? 'Forbidden artifacts or policy risk present.' : asText(missionBrainNextAction.blockedReason, ''));
  const requiredProofBeforeApproval = Array.from(new Set([...(missionBrainNextAction.proofRequiredBeforeMerge || []), ...(verificationReturnIntake.missingEvidence || [])]));
  const base = {
    riskLevel: asText(missionBrainNextAction.riskLevel, 'medium'),
    approvalRequired: true,
    requiredProofBeforeApproval,
    blockedReason,
    allowedOperatorChoices: ['approve', 'hold', 'needs-repair', 'copy-prompt', 'mark-proof-pending'],
  };
  if (missionState === 'needs-browser-proof' || verificationReturnIntake.mergeRecommendation === 'blocked-pending-browser-proof') queue.push({ ...base, id: 'mq-run-browser-proof', title: 'Run browser proof checklist before approval', actionType: 'run-browser-proof', recommendedDecision: 'mark-proof-pending', reason: 'UI proof checklist is incomplete and merge review is blocked pending browser proof.', sourceEvidence: ['mission_brain.next_action', 'verification_return_intake', 'proof_of_done.browserChecksObserved'], copyPayload: truncateText(JSON.stringify({ actionType: 'run-browser-proof', checklist: browserProof?.missingItems || [], requiredProofBeforeApproval }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if (verificationReturnIntake.forbiddenArtifactRisk) queue.push({ ...base, id: 'mq-hold-merge', title: 'Hold merge and request source-truth repair', actionType: 'hold-merge', recommendedDecision: 'needs-repair', riskLevel: 'high', reason: 'Verification intake detected forbidden artifact risk.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(JSON.stringify({ actionType: 'hold-merge', changedFiles: verificationReturnIntake.changedFiles || [], reason: 'Forbidden artifacts present in staged files.' }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if ((verificationReturnIntake.missingEvidence || []).length > 0) queue.push({ ...base, id: 'mq-request-repair', title: 'Request repair packet for missing evidence', actionType: 'request-repair', recommendedDecision: 'needs-repair', reason: 'Evidence gaps remain unresolved and repair packet is required before approval.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(verificationReturnIntake.repairPromptCandidate || repairPrompt?.prompt || '', MAX_QUEUE_PAYLOAD_LENGTH) });
  if (agentWorkRoutingProjection.recommendedRoute === 'codex') queue.push({ ...base, id: 'mq-approve-codex-packet', title: 'Approve Codex packet draft for manual handoff', actionType: 'approve-codex-packet', recommendedDecision: 'approve', reason: 'Work routing produced a bounded Codex packet candidate that remains operator-gated.', sourceEvidence: agentWorkRoutingProjection.sourceEvidence || [], copyPayload: truncateText(JSON.stringify(agentWorkRoutingProjection || {}, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  if (verificationReturnIntake.mergeRecommendation === 'review-required') queue.push({ ...base, id: 'mq-approve-merge-review', title: 'Approve merge-review step', actionType: 'approve-merge-review', recommendedDecision: 'approve', reason: 'Verification indicates merge candidate readiness, pending explicit operator decision only.', sourceEvidence: verificationReturnIntake.sourceEvidence || [], copyPayload: truncateText(JSON.stringify({ actionType: 'approve-merge-review', mergeRecommendation: verificationReturnIntake.mergeRecommendation, requiredOperatorAction: verificationReturnIntake.requiredOperatorAction }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH), blockedReason: '' });
  queue.push({ ...base, id: 'mq-update-handoff', title: 'Update mission handoff payload', actionType: 'update-handoff', recommendedDecision: 'copy-prompt', reason: 'Create bounded handoff/update payload for continuity and explicit operator actions.', sourceEvidence: ['mission_handoff', 'mission_brain.next_action', 'verification_return_intake'], copyPayload: truncateText(JSON.stringify({ currentLayer: missionBrainNextAction.currentPhase || 'unknown', completedSystems: ['Layer 3/4 Mission Brain', 'Layer 5 Work Routing Candidate', 'Layer 6 Verification Return Intake', 'Layer 7 Mission Approval Queue (read-only/operator-gated)'], pendingProof: requiredProofBeforeApproval, nextOperatorAction: queue[0]?.title || 'Review mission evidence', mergeRecommendation: verificationReturnIntake.mergeRecommendation || 'unknown', risks: [asText(missionBrainNextAction.riskLevel, 'medium'), blockedReason || 'none'], testsBuildVerifyStatus: { testsPassed: tests.passed || 0, buildPassed: tests.buildPassed === true, verifyPassed: tests.verifyPassed === true }, browserProofStatus: { required: browserProof.required === true, missingItems: browserProof.missingItems || [] } }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  queue.push({ ...base, id: 'mq-manual-ignition', title: 'Manual ignition checkpoint', actionType: 'manual-ignition', recommendedDecision: 'hold', reason: 'Execution remains manual-only and operator intent must be explicit.', sourceEvidence: ['mission_brain.next_action'], copyPayload: truncateText(JSON.stringify({ actionType: 'manual-ignition', status: 'operator-gated-no-execution', nextAction: missionBrainNextAction.nextBestAction || 'Review evidence' }, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
  return { queue, topRecommendation: queue[0] || null, approvalRequired: true };
}

function buildTopProblemsProjection({ missionBrainNextAction = {}, supportSnapshot = {}, verificationReturnIntake = {}, browserMissing = [] } = {}) {
  const problems = [];
  if (browserMissing.length > 0) {
    problems.push({
      id: 'browser-proof-pending',
      title: 'Command Deck browser proof still pending',
      severity: 'high',
      layer: 'ui-proof',
      whyItMatters: 'Protected cockpit canon cannot be merged without live browser proof.',
      evidence: [`missingBrowserChecks:${browserMissing.length}`, 'proof_of_done.browserChecksObserved'],
      nextBestAction: 'Run browser checklist and paste a fresh Support Snapshot.',
      recommendedAgent: 'manual-operator',
      proofRequired: 'browser-proof-checklist',
      blockedReason: 'Browser evidence missing.',
      professionalisationOpportunity: 'Replace telemetry-only claims with reality proof.',
      codexPromptCandidate: '',
      operatorDecisionRequired: true,
    });
  }
  if (asText(supportSnapshot?.runtimeStatus?.ignitionCleanlinessVerdict || supportSnapshot?.ignitionCleanlinessVerdict, 'unknown').toLowerCase() !== 'ready') {
    problems.push({
      id: 'ignition-cleanliness-not-ready',
      title: 'Ignition cleanliness requires operator attention',
      severity: 'high',
      layer: 'ignition',
      whyItMatters: 'Generated/runtime dirt repeatedly blocks safe startup and PR flow.',
      evidence: ['support_snapshot.runtimeStatus.ignitionCleanlinessVerdict', 'ignitionStatusModel'],
      nextBestAction: asText(supportSnapshot?.runtimeStatus?.ignitionNextOperatorAction || supportSnapshot?.ignitionNextOperatorAction, 'Review ignition cleanliness report and clear blockers.'),
      recommendedAgent: 'manual-operator',
      proofRequired: 'ignition-cleanliness-status',
      blockedReason: asText(supportSnapshot?.runtimeStatus?.ignitionBlockedReason || supportSnapshot?.ignitionBlockedReason, 'Ignition status not ready.'),
      professionalisationOpportunity: 'Keep ignition deterministic with autoclean/checkpoint guardrails.',
      codexPromptCandidate: '',
      operatorDecisionRequired: true,
    });
  }
  if ((verificationReturnIntake?.missingEvidence || []).length > 0) {
    problems.push({
      id: 'evidence-gaps-open',
      title: 'Verification evidence gaps remain open',
      severity: 'medium',
      layer: 'verification',
      whyItMatters: 'Missing proof creates repeated regressions and ambiguous merge readiness.',
      evidence: verificationReturnIntake?.missingEvidence || [],
      nextBestAction: 'Close missing build/verify/proof evidence before approval.',
      recommendedAgent: 'codex',
      proofRequired: 'build-verify-proof-complete',
      blockedReason: 'Verification return intake reports missing evidence.',
      professionalisationOpportunity: 'Promote compact, operator-readable proof summaries.',
      codexPromptCandidate: asText(missionBrainNextAction?.codexPromptCandidate, ''),
      operatorDecisionRequired: true,
    });
  }
  return problems.slice(0, 3);
}

function deriveHarnessRiskLevel(changedFiles = []) {
  const files = asList(changedFiles).map((file) => String(file).toLowerCase());
  if (files.length === 0) return 'high';
  const hasHigh = files.some((file) => /commanddeck|aiconsole|answerdelivery|answerdeliverytruth|useaiconsole|ignite-stephanos-local|guard-pr-clean|windows-launcher|provider|backend|routing|memory|session/.test(file));
  if (hasHigh) return 'high';
  const hasMedium = files.some((file) => /missionconsole|mission-console|stephanos-ui\/src\/components|scripts\/.*ignite|routing|metadata/.test(file));
  if (hasMedium) return 'medium';
  return 'low';
}

export function deriveOperatorReliefProjection(models = {}) {
  const { intentToBuildModel = {}, taskFinisherModel = {}, missionEvidenceLedgerModel = {}, prEvidenceModel = {}, proofOfDoneModel = {}, operatorDecisionQueue = {}, memoryLibrarianQueue = {}, supportSnapshot = {} } = models;
  const missionSpec = intentToBuildModel?.missionSpec || {};
  const verification = proofOfDoneModel?.verificationJudge || {};
  const parsed = verification.parsed || {};
  const testsRequired = asList(missionSpec?.repoArchitectureContext?.testsLikelyRequired);
  const testsPassed = asList(parsed.testsRun).length;
  const browserObserved = asList(proofOfDoneModel?.browserChecksObserved);
  const uiTouched = true;
  const browserRequired = uiTouched;
  const browserMissing = UI_BROWSER_CHECKLIST.filter((i) => !browserObserved.includes(i));
  const runtimeEvidence = { consoleErrors: asList(proofOfDoneModel?.consoleErrors), routeStatus: asText(supportSnapshot.routeStatus || supportSnapshot.runtimeStatus?.routeStatus, 'unknown'), providerStatus: asText(supportSnapshot.providerStatus || supportSnapshot.runtimeStatus?.providerStatus, 'unknown'), tileStatus: asText(supportSnapshot.tileStatus || supportSnapshot.runtimeStatus?.tileStatus, 'unknown'), warnings: [...asList(verification.warnings), ...asList(taskFinisherModel.warnings), ...asList(prEvidenceModel.evidenceWarnings)] };
  const operatorDecisionQueueV2 = asList(operatorDecisionQueue.decisions).map((entry, i) => ({ id: entry.id || `decision-${i + 1}`, decisionType: entry.decisionType || 'defer', label: entry.label || entry.title || 'Operator decision', reason: entry.reason || 'Operator approval gate.', choices: asList(entry.choices).length ? asList(entry.choices) : ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedChoice: entry.recommendedChoice || 'defer', destructiveOrHighRisk: entry.destructiveOrHighRisk === true, approvalRequired: true }));

  let missionState = 'active';
  if (parsed.hasFailure || runtimeEvidence.consoleErrors.length > 0) missionState = 'needs-repair';
  else if (!parsed.buildRun) missionState = 'needs-build';
  else if (!parsed.verifyRun) missionState = 'needs-verify';
  else if (testsRequired.length > 0 && testsPassed === 0) missionState = 'needs-tests';
  else if (browserRequired && browserMissing.length > 0) missionState = 'needs-browser-proof';
  else if (verification.mergeReadyCandidate) missionState = 'merge-candidate';
  if (verification.mergeReadyCandidate && operatorDecisionQueueV2.some((d) => d.decisionType === 'approve-merge')) missionState = 'ready-for-operator';

  const repairPromptAvailable = ['needs-repair', 'needs-tests', 'needs-build', 'needs-verify', 'needs-browser-proof'].includes(missionState);
  const evidenceGaps = buildEvidenceGaps({ testsRequired, testsPassed, parsed, browserRequired, browserMissing, runtimeEvidence, verification, operatorDecisions: operatorDecisionQueueV2, repairPromptAvailable, codexChangedFiles: asList(prEvidenceModel.changedFiles || prEvidenceModel.files) });
  const aiConsoleAutoscrollProof = deriveAiConsoleAutoscrollProof(supportSnapshot);
  if (!aiConsoleAutoscrollProof.complete) {
    evidenceGaps.push({ id: 'missing-live-proof', label: 'AIConsole autoscroll live proof missing', severity: 'high', reason: `Missing proof signals: ${aiConsoleAutoscrollProof.missing.join(', ')}.`, requiredAction: 'capture-support-snapshot-with-final-assistant-answer', source: aiConsoleAutoscrollProof.source });
  }

  const actions = [];
  if (missionState === 'needs-tests') actions.push({ id: 'run-targeted-tests', label: 'Run targeted tests', reason: 'Required tests are missing.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-build') actions.push({ id: 'run-build', label: 'Run stephanos build', reason: 'Build evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-verify') actions.push({ id: 'run-verify', label: 'Run stephanos verify', reason: 'Verify evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-browser-proof') actions.push({ id: 'run-browser-proof', label: 'Run browser proof checklist', reason: 'UI-facing evidence is missing.', actionType: 'manual-proof', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'needs-repair') actions.push({ id: 'request-codex-repair', label: 'Request Codex repair', reason: 'Failures or runtime errors detected.', actionType: 'repair', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'merge-candidate' || missionState === 'ready-for-operator') actions.push({ id: 'approve-merge', label: 'Approve merge candidate', reason: 'All required evidence present; operator approval still required.', actionType: 'approval', commandOrPromptAvailable: false, operatorApprovalRequired: true });

  const nextBestAction = actions[0] || { id: 'defer', label: 'Defer', reason: 'No immediate action derived.', actionType: 'decision', commandOrPromptAvailable: false, operatorApprovalRequired: true };
  const completedProofs = [];
  if (aiConsoleAutoscrollProof.complete) completedProofs.push({ id: AI_CONSOLE_AUTOSCROLL_PROOF_ID, label: 'AIConsole answer pane autoscroll live proof complete', source: aiConsoleAutoscrollProof.source });
  if (parsed.buildRun) completedProofs.push({ id: 'build-proof', label: 'stephanos build recorded', source: 'proof_of_done.verificationJudge' });
  if (parsed.verifyRun) completedProofs.push({ id: 'verify-proof', label: 'stephanos verify recorded', source: 'proof_of_done.verificationJudge' });
  const layerStatus = {
    0: 'complete',
    1: parsed.buildRun && parsed.verifyRun ? 'complete' : 'incomplete',
    2: aiConsoleAutoscrollProof.complete ? 'complete' : 'incomplete',
    3: 'in_progress',
    4: 'in_progress',
    5: 'pending',
    6: 'pending',
    7: 'pending',
  };
  const currentPhase = layerStatus[2] === 'complete' ? 'Layer 3 → Layer 4 climb' : 'Layer 2 proof collection';
  const missionObjective = asText(missionSpec.objective, missionSpec.rawIntent || 'Not provided');
  const codexPromptCandidate = truncateText([
    'Stephanos OS / Reality Forge — Mission Brain Layer 3 + Layer 4 follow-up.',
    `Mission objective: ${missionObjective}`,
    `Current phase: ${currentPhase}`,
    `Completed proofs: ${completedProofs.map((p) => p.label).join(' | ') || 'none'}`,
    `Evidence gaps: ${evidenceGaps.map((g) => `${g.id}:${g.label}`).join(' | ') || 'none'}`,
    'Inspect first: stephanos-ui/src/state/operatorReliefProjection.js, stephanos-ui/src/components/MissionConsoleTile.jsx, tests/operator-relief-projection.test.mjs, tests/mission-console-operator-relief-panel.test.mjs.',
    'Constraints: keep runtime truth canonical; no duplicate Mission Console surfaces; no autoscroll refactor unless failing test; read-only projection only; no dist hand edits.',
    'Tests required: node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs; npm run stephanos:build; npm run stephanos:verify.',
    'Definition of done: compact Mission Brain / Next Action summary present, evidence gaps classified, Layer 2 proof promoted when diagnostics support it, Layer 3/4 next action generated, copy payload bounded.',
    'Staging restrictions: do not stage runtime data/root data/node_modules/secrets/tokens/generated dist.',
  ].join('\n'), 3500);
  const missionBrainNextAction = {
    missionObjective,
    currentPhase,
    layerStatus,
    completedProofs,
    openEvidenceGaps: evidenceGaps,
    nextBestAction: nextBestAction.label,
    codexPromptCandidate,
    operatorActionCandidate: nextBestAction.label,
    mergeReadiness: evidenceGaps.length === 0 ? 'review-required' : 'blocked',
    riskLevel: evidenceGaps.some((g) => g.severity === 'high') ? 'high' : evidenceGaps.length > 0 ? 'medium' : 'medium',
    blockedReason: evidenceGaps[0]?.reason || 'Operator approval required.',
    proofRequiredBeforeMerge: evidenceGaps.map((gap) => gap.requiredAction),
    sourceEvidence: [...new Set([...completedProofs.map((p) => p.source), ...evidenceGaps.map((g) => g.source)])],
  };
  const agentWorkRoutingProjection = buildAgentWorkRoutingProjection({ missionBrainNextAction, missionSpec, supportSnapshot });
  const verificationReturnIntake = buildVerificationReturnIntake({ prEvidenceModel, parsed, missionState, missionBrainNextAction });
  const lessonCandidates = asList(memoryLibrarianQueue.queue).map((c, i) => ({ id: c.id || `lesson-${i + 1}`, title: c.title || c.summary || 'Lesson candidate', reason: c.reason || 'Derived from mission evidence.', source: c.source || 'memory_librarian', approvalRequired: true }));
  const repairPromptBodyRaw = repairPromptAvailable ? [`Mission objective: ${asText(missionSpec.objective, missionSpec.rawIntent || 'unknown')}`,`Current state: ${missionState}`,`Failing layer: ${evidenceGaps[0]?.label || 'unknown'}`,`Evidence gaps: ${evidenceGaps.map((g) => g.label).join(' | ') || 'none'}`, runtimeEvidence.consoleErrors.length ? `Observed runtime/browser errors: ${runtimeEvidence.consoleErrors.join(' | ')}` : null,'Constraint: Do not create new canon; audit existing working surface first.','Acceptance criteria: close all evidence gaps, keep operator approval required, no auto-merge.','Required tests: node --test ... operator relief + mission console suites.','Build/verify: npm run stephanos:build && npm run stephanos:verify',`Browser proof required: ${browserRequired ? 'yes' : 'no'}.`].join('\n') : '';
  const repairPromptBody = truncateText(repairPromptBodyRaw, MAX_REPAIR_PROMPT_LENGTH);

  const missionHandoff = { title: asText(missionSpec.title, 'Mission handoff'), objective: asText(missionSpec.objective, missionSpec.rawIntent || 'Not provided'), currentState: missionState, mergeSafety: verification.mergeReadyCandidate ? 'merge-candidate' : 'blocked', nextBestAction, evidenceSummary: { testsPassed, buildRun: parsed.buildRun === true, verifyRun: parsed.verifyRun === true, browserObserved: browserObserved.length }, evidenceGaps, repairPrompt: { available: repairPromptAvailable, title: 'Operator Relief V2 Repair Prompt', body: repairPromptBody, sourceEvidence: evidenceGaps.map((g) => g.source), copyLabel: 'Copy Repair Prompt' }, browserProofChecklist: { required: browserRequired, reason: browserRequired ? 'UI-facing mission requires browser proof before merge.' : 'Non-UI mission.', checklistItems: UI_BROWSER_CHECKLIST, observedItems: browserObserved, missingItems: browserMissing }, operatorDecisionQueue: operatorDecisionQueueV2, canonConstraints: ['No duplicate Mission Console shells/panes.', 'Merge is never automatic.', 'Operator remains final approver.'], requiredCommands: ['node --test tests/operator-relief-projection.test.mjs tests/operator-relief-merge-safety.test.mjs tests/operator-relief-repair-prompt.test.mjs tests/operator-relief-music-failure-pack.test.mjs tests/mission-console-operator-relief-panel.test.mjs','node --test stephanos-ui/src/components/MissionConsoleTile.render.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs stephanos-ui/src/components/AnswerPaneCopyButton.test.mjs stephanos-ui/src/components/MissionCommandDeck.render.test.mjs stephanos-ui/src/components/CollapsiblePanel.render.test.mjs stephanos-ui/src/components/stephanosPaneCanon.test.mjs','npm run stephanos:build','npm run stephanos:verify'] };
  const missionApprovalQueue = buildMissionApprovalQueue({ missionBrainNextAction, agentWorkRoutingProjection, verificationReturnIntake, repairPrompt: { prompt: repairPromptBody }, missionState, browserProof: missionHandoff.browserProofChecklist, missionHandoff, tests: { passed: testsPassed, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true } });
  const topProblemsProjection = buildTopProblemsProjection({ missionBrainNextAction, supportSnapshot, verificationReturnIntake, browserMissing });
  const changedFiles = asList(prEvidenceModel.changedFiles || prEvidenceModel.files);
  const harnessRiskLevel = deriveHarnessRiskLevel(changedFiles);
  const protectedCanonTouched = changedFiles.filter((file) => /commanddeck|aiconsole|answerdelivery|ignite-stephanos-local|guard-pr-clean|windows-launcher|provider|backend|routing|memory|operatorrelief|mission-console|harness/i.test(file));
  const { protectedCanonClauses, protectedSubsystems, protectedCanonWarning, fallbackApplied, hasUnknownSubsystem } = deriveProtectedCanonClauses({ riskLevel: harnessRiskLevel, changedFiles });
  const protectedCanonAtRisk = protectedSubsystems.map((k) => k.toLowerCase());
  const browserProofRequired = browserRequired && changedFiles.some((file) => file.startsWith('stephanos-ui/'));

  const missionIntelligenceSummary = {
    missionIntelligenceStatus: missionState,
    currentMissionSummary: `${missionHandoff.title}: ${missionObjective}`,
    currentBlockers: evidenceGaps.map((gap) => gap.label),
    nextBestAction: nextBestAction.label,
    operatorDecisionRequired: true,
    codexReady: agentWorkRoutingProjection.codexReady || (evidenceGaps.length === 0 ? 'yes' : 'no'),
    openClawReady: agentWorkRoutingProjection.openClawResearchReady || (evidenceGaps.length === 0 ? 'yes' : 'no'),
    harnessContractAvailable: true,
    protectedCanonSummary: protectedCanonClauses.join(' | ') || 'No additional protected canon clauses derived.',
    proofRequiredSummary: missionHandoff.browserProofChecklist.required ? 'browser-proof + targeted tests + build/verify + pr-clean' : 'targeted tests + build/verify + pr-clean',
    relevantPaneTarget: 'missionConsoleOperatorReliefPanel',
    commandDeckContextAvailable: true,
    aiContextWarnings: [
      ...(runtimeEvidence.warnings || []),
      ...(verificationReturnIntake.missingEvidence || []).slice(0, 2),
    ].filter(Boolean),
  };

  const harnessAgentProjection = {
    harnessVersion: HARNESS_AGENT_VERSION,
    harnessStatus: harnessRiskLevel === 'high' ? 'blocked-until-proof' : 'read-only-advisory',
    currentMissionSummary: `${missionObjective} (${currentPhase})`,
    protectedCanonTouched,
    protectedCanonAtRisk,
    allowedFileScopes: ['stephanos-ui/src/state/**', 'stephanos-ui/src/components/**', 'tests/**', 'docs/**', 'shared/**'],
    forbiddenFileScopes: ['apps/stephanos/dist/**', 'runtime/**', 'node_modules/**', 'secrets/**', '*.bin'],
    generatedArtifactRisk: verificationReturnIntake.forbiddenArtifactRisk,
    browserProofRequired,
    sourceOnlyRequired: true,
    requiredTests: Array.from(new Set([...(missionHandoff.requiredCommands || []).filter((command) => command.startsWith('node --test'))])),
    requiredBuildVerify: true,
    requiredPrClean: true,
    protectedCanonClauses,
    protectedSubsystems,
    protectedCanonWarning,
    forbiddenFiles: ['apps/stephanos/dist/**', 'runtime/**', 'node_modules/**', 'secrets/**', 'root data/**'],
    definitionOfDone: ['preserve-canon-truth-boundaries', 'tests-build-verify-pr-clean-pass', 'copy-contract-is-actionable'],
    finalReportRequirements: ['audit-findings', 'files-changed', 'clause-catalogue', 'risk-to-clause-rules', 'example-contract-payload', 'tests-and-check-results', 'browser-proof-status', 'next-operator-action'],
    mergeRecommendation: (harnessRiskLevel === 'high' && (hasUnknownSubsystem || protectedCanonClauses.length === 0 || verificationReturnIntake.missingEvidence.length > 0 || browserProofRequired))
      ? 'hold-for-operator-review'
      : ((protectedCanonWarning || harnessRiskLevel === 'high') ? 'hold-for-operator-review' : verificationReturnIntake.mergeRecommendation),
    repairPromptRequired: evidenceGaps.length > 0,
    repairPromptCandidate: repairPromptBody,
    nextOperatorAction: (harnessRiskLevel === 'high' && hasUnknownSubsystem)
      ? 'Review conservative canon fallback, provide/approve mission scope, then proceed.'
      : (protectedCanonWarning ? 'Protected canon clauses need review before merge recommendation.' : (missionApprovalQueue.topRecommendation?.title || 'Review harness contract.')),
  };
  const coBuilderLoopProjection = buildCoBuilderLoopProjection({ missionIntelligenceSummary, harnessAgentProjection, agentWorkRoutingProjection, verificationReturnIntake, missionBrainNextAction, supportSnapshot });

  return { status: missionState,
    harnessVersion: HARNESS_AGENT_VERSION, mission: { title: missionHandoff.title, objective: missionHandoff.objective, currentPhase: asText(taskFinisherModel.finishPlanStatus, 'draft') }, codex: { prTitle: asText(prEvidenceModel.prTitle, 'unknown'), branch: asText(prEvidenceModel.branch || prEvidenceModel.prBranch, 'unknown'), deltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.') }, tests: { required: testsRequired, passed: testsPassed, failed: parsed.hasFailure ? 1 : 0, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true }, browserProof: missionHandoff.browserProofChecklist, runtimeEvidence, mergeSafety: { verdict: missionState === 'needs-build' || missionState === 'needs-verify' ? 'needs-tests' : (missionState === 'needs-browser-proof' ? 'needs-browser-proof' : (verification.mergeReadyCandidate ? 'safe-to-merge' : 'not-safe')), requiredApprovals: ['Operator approval required for merge.'] }, evidenceGaps, nextBestAction, nextActions: actions, repairPrompt: { ...missionHandoff.repairPrompt, prompt: missionHandoff.repairPrompt.body }, operatorDecisionQueue: operatorDecisionQueueV2, operatorDecision: { required: true, options: ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedOption: missionState === 'merge-candidate' ? 'approve-merge' : 'request-repair' }, lessonCandidates, missionHandoff, missionTitle: missionHandoff.title, missionObjective: missionHandoff.objective, codexDeltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.'), missionBrainNextAction, agentWorkRoutingProjection, verificationReturnIntake, missionApprovalQueue, topProblemsProjection, harnessAgentProjection, missionIntelligenceSummary, coBuilderLoopProjection };
}
