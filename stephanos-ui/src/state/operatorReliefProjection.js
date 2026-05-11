function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}
function asList(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
const UI_BROWSER_CHECKLIST = ['Mission Console opens from landing tile','Operator Relief panel visible','idle state renders','active/fixture state renders','merge safety verdict visible','browser proof gaps visible','repair prompt visible/copyable','no red console errors','no broken chevron/collapse','existing Mission Console controls still work'];

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
  if (runtimeEvidence.consoleErrors.length > 0) gaps.push({ id: 'console-runtime-errors', severity: 'high', label: 'Console/runtime errors detected', reason: runtimeEvidence.consoleErrors.join(' | '), requiredAction: 'request-codex-repair', source: 'proof_of_done.consoleErrors' });
  if (verification.mergeReadyCandidate && operatorDecisions.length === 0) gaps.push({ id: 'operator-decision-missing', severity: 'medium', label: 'Operator decision missing', reason: 'Merge candidate still requires explicit operator decision.', requiredAction: 'approve-merge', source: 'operator_decision_queue' });
  if (gaps.some((g) => g.id.includes('missing') || g.id.includes('errors')) && !repairPromptAvailable) gaps.push({ id: 'repair-prompt-missing', severity: 'medium', label: 'Repair prompt missing', reason: 'Evidence indicates repair flow but no repair prompt is available.', requiredAction: 'review-repair-prompt', source: 'operator_relief' });
  if (codexChangedFiles.some((f) => /(?:memory|session|event).*\.(?:json|log)$/i.test(f))) gaps.push({ id: 'local-runtime-files-staged', severity: 'high', label: 'Local runtime files staged', reason: 'Staged files appear to include local runtime memory/event artifacts.', requiredAction: 'remove-local-runtime-files', source: 'pr_evidence.changedFiles' });
  return gaps;
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

  const actions = [];
  if (missionState === 'needs-tests') actions.push({ id: 'run-targeted-tests', label: 'Run targeted tests', reason: 'Required tests are missing.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-build') actions.push({ id: 'run-build', label: 'Run stephanos build', reason: 'Build evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-verify') actions.push({ id: 'run-verify', label: 'Run stephanos verify', reason: 'Verify evidence is required.', actionType: 'command', commandOrPromptAvailable: true, operatorApprovalRequired: false });
  if (missionState === 'needs-browser-proof') actions.push({ id: 'run-browser-proof', label: 'Run browser proof checklist', reason: 'UI-facing evidence is missing.', actionType: 'manual-proof', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'needs-repair') actions.push({ id: 'request-codex-repair', label: 'Request Codex repair', reason: 'Failures or runtime errors detected.', actionType: 'repair', commandOrPromptAvailable: true, operatorApprovalRequired: true });
  if (missionState === 'merge-candidate' || missionState === 'ready-for-operator') actions.push({ id: 'approve-merge', label: 'Approve merge candidate', reason: 'All required evidence present; operator approval still required.', actionType: 'approval', commandOrPromptAvailable: false, operatorApprovalRequired: true });

  const nextBestAction = actions[0] || { id: 'defer', label: 'Defer', reason: 'No immediate action derived.', actionType: 'decision', commandOrPromptAvailable: false, operatorApprovalRequired: true };
  const lessonCandidates = asList(memoryLibrarianQueue.queue).map((c, i) => ({ id: c.id || `lesson-${i + 1}`, title: c.title || c.summary || 'Lesson candidate', reason: c.reason || 'Derived from mission evidence.', source: c.source || 'memory_librarian', approvalRequired: true }));
  const repairPromptBody = repairPromptAvailable ? [`Mission objective: ${asText(missionSpec.objective, missionSpec.rawIntent || 'unknown')}`,`Current state: ${missionState}`,`Failing layer: ${evidenceGaps[0]?.label || 'unknown'}`,`Evidence gaps: ${evidenceGaps.map((g) => g.label).join(' | ') || 'none'}`, runtimeEvidence.consoleErrors.length ? `Observed runtime/browser errors: ${runtimeEvidence.consoleErrors.join(' | ')}` : null,'Constraint: Do not create new canon; audit existing working surface first.','Acceptance criteria: close all evidence gaps, keep operator approval required, no auto-merge.','Required tests: node --test ... operator relief + mission console suites.','Build/verify: npm run stephanos:build && npm run stephanos:verify',`Browser proof required: ${browserRequired ? 'yes' : 'no'}.`].join('\n') : '';

  const missionHandoff = { title: asText(missionSpec.title, 'Mission handoff'), objective: asText(missionSpec.objective, missionSpec.rawIntent || 'Not provided'), currentState: missionState, mergeSafety: verification.mergeReadyCandidate ? 'merge-candidate' : 'blocked', nextBestAction, evidenceSummary: { testsPassed, buildRun: parsed.buildRun === true, verifyRun: parsed.verifyRun === true, browserObserved: browserObserved.length }, evidenceGaps, repairPrompt: { available: repairPromptAvailable, title: 'Operator Relief V2 Repair Prompt', body: repairPromptBody, sourceEvidence: evidenceGaps.map((g) => g.source), copyLabel: 'Copy Repair Prompt' }, browserProofChecklist: { required: browserRequired, reason: browserRequired ? 'UI-facing mission requires browser proof before merge.' : 'Non-UI mission.', checklistItems: UI_BROWSER_CHECKLIST, observedItems: browserObserved, missingItems: browserMissing }, operatorDecisionQueue: operatorDecisionQueueV2, canonConstraints: ['No duplicate Mission Console shells/panes.', 'Merge is never automatic.', 'Operator remains final approver.'], requiredCommands: ['node --test tests/operator-relief-projection.test.mjs tests/operator-relief-merge-safety.test.mjs tests/operator-relief-repair-prompt.test.mjs tests/operator-relief-music-failure-pack.test.mjs tests/mission-console-operator-relief-panel.test.mjs','node --test stephanos-ui/src/components/MissionConsoleTile.render.test.mjs stephanos-ui/src/components/AIConsole.render.test.mjs stephanos-ui/src/components/AnswerPaneCopyButton.test.mjs stephanos-ui/src/components/MissionCommandDeck.render.test.mjs stephanos-ui/src/components/CollapsiblePanel.render.test.mjs stephanos-ui/src/components/stephanosPaneCanon.test.mjs','npm run stephanos:build','npm run stephanos:verify'] };

  return { status: missionState, mission: { title: missionHandoff.title, objective: missionHandoff.objective, currentPhase: asText(taskFinisherModel.finishPlanStatus, 'draft') }, codex: { prTitle: asText(prEvidenceModel.prTitle, 'unknown'), branch: asText(prEvidenceModel.branch || prEvidenceModel.prBranch, 'unknown'), deltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.') }, tests: { required: testsRequired, passed: testsPassed, failed: parsed.hasFailure ? 1 : 0, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true }, browserProof: missionHandoff.browserProofChecklist, runtimeEvidence, mergeSafety: { verdict: missionState === 'needs-build' || missionState === 'needs-verify' ? 'needs-tests' : (missionState === 'needs-browser-proof' ? 'needs-browser-proof' : (verification.mergeReadyCandidate ? 'safe-to-merge' : 'not-safe')), requiredApprovals: ['Operator approval required for merge.'] }, evidenceGaps, nextBestAction, nextActions: actions, repairPrompt: { ...missionHandoff.repairPrompt, prompt: missionHandoff.repairPrompt.body }, operatorDecisionQueue: operatorDecisionQueueV2, operatorDecision: { required: true, options: ['approve-merge','request-repair','reject','defer','promote-lesson'], recommendedOption: missionState === 'merge-candidate' ? 'approve-merge' : 'request-repair' }, lessonCandidates, missionHandoff, missionTitle: missionHandoff.title, missionObjective: missionHandoff.objective, codexDeltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceLedgerModel?.summary?.missionReadyNarrative, 'Codex delta pending PR evidence.') };
}
