function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}
function asList(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
const UI_BROWSER_CHECKLIST = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];
const AI_CONSOLE_AUTOSCROLL_PROOF_ID = 'aiconsole-answer-pane-autoscroll';
const MAX_GAP_REASON_LENGTH = 240;
const MAX_REPAIR_PROMPT_LENGTH = 4000;
const MAX_QUEUE_PAYLOAD_LENGTH = 2400;

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

function buildAgentWorkRoutingProjection({ missionBrainNextAction = {}, missionSpec = {}, supportSnapshot = {} } = {}) {
  const nextAction = asText(missionBrainNextAction.nextBestAction, '').toLowerCase();
  const isManualTask = /browser|proof|merge|visual|ignition/.test(nextAction);
  const readiness = asText(supportSnapshot.openClawReadiness || supportSnapshot.openClawIntegrationMode, 'not-proven');
  const targetAgentType = isManualTask ? 'manual-operator' : 'codex';
  const promptPayload = truncateText([
    `Mission objective: ${asText(missionBrainNextAction.missionObjective, missionSpec.objective || 'not provided')}`,
    `Current phase: ${asText(missionBrainNextAction.currentPhase, 'unknown')}`,
    `Next best action: ${asText(missionBrainNextAction.nextBestAction, 'review evidence')}`,
    `Evidence gaps: ${asList(missionBrainNextAction.openEvidenceGaps).map((gap) => `${gap.id}:${gap.label}`).join(' | ') || 'none'}`,
    'Constraints: no autonomous execution, no auto-merge, operator approval required.',
  ].join('\n'), 2400);
  return {
    routingObjective: asText(missionBrainNextAction.nextBestAction, 'Review mission evidence and decide operator path.'),
    sourceMissionBrainPhase: asText(missionBrainNextAction.currentPhase, 'unknown'),
    targetAgentType: readiness.includes('ready') && !isManualTask ? 'openclaw-policy-only' : targetAgentType,
    recommendedAgent: targetAgentType === 'manual-operator' ? 'manual-operator' : 'codex',
    taskType: isManualTask ? 'proof-or-approval' : 'bounded-source-task',
    riskLevel: asText(missionBrainNextAction.riskLevel, 'medium'),
    approvalRequired: true,
    operatorDecisionRequired: true,
    promptPayload,
    filesToInspectFirst: [
      'stephanos-ui/src/state/operatorReliefProjection.js',
      'stephanos-ui/src/components/MissionConsoleTile.jsx',
      'tests/operator-relief-projection.test.mjs',
    ],
    filesToAvoidUnlessNeeded: ['apps/stephanos/dist/**', 'node_modules/**', 'runtime/**', 'root data/**'],
    requiredProof: ['browser-proof-checklist', 'copy-button-success-state', 'single-answer-pane-autoscroll'],
    requiredTests: ['node --test tests/operator-relief-projection.test.mjs tests/mission-console-operator-relief-panel.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs', 'npm run stephanos:build', 'npm run stephanos:verify'],
    mergeReadinessGate: 'operator-approval-required',
    rollbackOrAbortConditions: ['forbidden-artifacts-staged', 'build-or-verify-failure', 'missing-browser-proof-for-ui-change'],
    sourceEvidence: asList(missionBrainNextAction.sourceEvidence),
    blockedReason: asText(missionBrainNextAction.blockedReason, ''),
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
  if (agentWorkRoutingProjection.recommendedAgent === 'codex') queue.push({ ...base, id: 'mq-approve-codex-packet', title: 'Approve Codex packet draft for manual handoff', actionType: 'approve-codex-packet', recommendedDecision: 'approve', reason: 'Work routing produced a bounded Codex packet candidate that remains operator-gated.', sourceEvidence: agentWorkRoutingProjection.sourceEvidence || [], copyPayload: truncateText(JSON.stringify(agentWorkRoutingProjection || {}, null, 2), MAX_QUEUE_PAYLOAD_LENGTH) });
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

  return { status: missionState, mission: { title: missionHandoff.title, objective: missionHandoff.objective, currentPhase: asText(taskFinisherModel.finishPlanStatus, 'draft') }, codex: { prTitle: asText(prEvidenceModel.prTitle, 'unknown'), branch: asText(prEvidenceModel.branch || prEvidenceModel.prBranch, 'unknown'), deltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.') }, tests: { required: testsRequired, passed: testsPassed, failed: parsed.hasFailure ? 1 : 0, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true }, browserProof: missionHandoff.browserProofChecklist, runtimeEvidence, mergeSafety: { verdict: missionState === 'needs-build' || missionState === 'needs-verify' ? 'needs-tests' : (missionState === 'needs-browser-proof' ? 'needs-browser-proof' : (verification.mergeReadyCandidate ? 'safe-to-merge' : 'not-safe')), requiredApprovals: ['Operator approval required for merge.'] }, evidenceGaps, nextBestAction, nextActions: actions, repairPrompt: { ...missionHandoff.repairPrompt, prompt: missionHandoff.repairPrompt.body }, operatorDecisionQueue: operatorDecisionQueueV2, operatorDecision: { required: true, options: ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedOption: missionState === 'merge-candidate' ? 'approve-merge' : 'request-repair' }, lessonCandidates, missionHandoff, missionTitle: missionHandoff.title, missionObjective: missionHandoff.objective, codexDeltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.'), missionBrainNextAction, agentWorkRoutingProjection, verificationReturnIntake, missionApprovalQueue, topProblemsProjection };
}
