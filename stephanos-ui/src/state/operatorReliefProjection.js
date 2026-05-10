function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export const MUSIC_FAILURE_SCENARIO_PACK = Object.freeze({
  spotify_resolver_not_configured: { evidenceType: 'runtime/provider_status', likelyBlocker: 'Spotify resolver missing or disconnected.', requiredProof: 'Provider configured + Spotify open link works.', nextAction: 'Configure Spotify resolver and rerun browser smoke.', mergeSafe: false, lessonCandidate: 'Spotify resolver must be configured before claiming music proof.' },
  ai_suggested_fake_track: { evidenceType: 'catalog_validation', likelyBlocker: 'Candidate track lacks source validation.', requiredProof: 'Validated catalogue/source confirmation.', nextAction: 'Mark suggestion unverified and run source validation.', mergeSafe: false, lessonCandidate: 'AI-generated music candidates remain unverified until catalog validation.' },
  build_journey_froze: { evidenceType: 'browser_runtime', likelyBlocker: 'UI flow froze before completion.', requiredProof: 'Build Journey completes in browser without freeze.', nextAction: 'Collect console evidence and repair journey flow.', mergeSafe: false, lessonCandidate: 'Browser proof required for music flow completion.' },
  wrong_spotify_url: { evidenceType: 'url_contract', likelyBlocker: 'Search URL used as playable track reference.', requiredProof: 'Open in Spotify uses canonical playable URL contract.', nextAction: 'Repair Spotify URL contract and validate link behavior.', mergeSafe: false, lessonCandidate: 'Spotify search URLs must never become playable refs.' },
  tests_passed_ui_broken: { evidenceType: 'test_vs_runtime_gap', likelyBlocker: 'No browser proof for UI behavior.', requiredProof: 'Operator-visible browser smoke proof.', nextAction: 'Run UI smoke test before merge.', mergeSafe: false, lessonCandidate: 'Browser proof required when unit tests pass but UI is broken.' },
  false_canon_invention: { evidenceType: 'canon_boundary', likelyBlocker: 'New canon invented without auditing working surface.', requiredProof: 'Audit existing canonical surface and align fix.', nextAction: 'Re-scope to existing mission systems.', mergeSafe: false, lessonCandidate: 'Canon means extract from working surface first.' },
  discovery_pipeline_hidden: { evidenceType: 'ui_projection_gap', likelyBlocker: 'Existing discovery output not surfaced.', requiredProof: 'Pipeline evidence visible in operator panel.', nextAction: 'Project existing outputs into Mission Console.', mergeSafe: false, lessonCandidate: 'Prefer projection composition over rebuilding systems.' },
  y_do_i_real_artist_rejected: { evidenceType: 'input_normalization', likelyBlocker: 'Valid artist phrasing treated as malformed.', requiredProof: 'Artist query accepted + visible result.', nextAction: 'Patch normalization and validate artist lookup.', mergeSafe: false, lessonCandidate: 'Normalize real-artist phrasing before rejection.' },
  ai_action_stuck_contacting: { evidenceType: 'async_runtime', likelyBlocker: 'AI action spinner did not resolve.', requiredProof: 'AI action resolves and output appears in target panel.', nextAction: 'Capture console/runtime symptoms and fix async state.', mergeSafe: false, lessonCandidate: 'Long-running AI actions require timeout/error state proof.' },
  chevron_did_not_collapse: { evidenceType: 'interaction_ui', likelyBlocker: 'Toggle control did not update panel state.', requiredProof: 'Chevron collapse behavior verified in browser.', nextAction: 'Repair interaction state binding and recheck UI.', mergeSafe: false, lessonCandidate: 'Interactive controls need browser proof, not just unit pass.' },
});

export function deriveOperatorReliefProjection({
  intentToBuildModel = {},
  taskFinisherModel = {},
  missionEvidenceLedgerModel = {},
  prEvidenceModel = {},
  proofOfDoneModel = {},
  operatorDecisionQueue = {},
  memoryLibrarianQueue = {},
  supportSnapshot = {},
} = {}) {
  const missionSpec = intentToBuildModel?.missionSpec || {};
  const verification = proofOfDoneModel?.verificationJudge || {};
  const parsed = verification.parsed || {};
  const missionEvidenceSummary = missionEvidenceLedgerModel?.summary || {};
  const blockerList = [...asList(verification.blockers), ...asList(taskFinisherModel.requiredOperatorDecisions)];
  const warningList = [...asList(verification.warnings), ...asList(taskFinisherModel.warnings), ...asList(prEvidenceModel.evidenceWarnings)];
  const testsRequired = asList(missionSpec?.repoArchitectureContext?.testsLikelyRequired);
  const testsPassed = parsed.testsRun?.length || 0;
  const testsFailed = parsed.hasFailure ? 1 : 0;
  const browserRequired = ['tile opens', 'Build Journey works', 'no console red errors', 'expected panels visible', 'Spotify link behaviour verified', 'AI action does not spin forever', 'output is visible in correct panel'];
  const browserObserved = asList(proofOfDoneModel?.browserChecksObserved);
  const browserMissing = browserRequired.filter((item) => !browserObserved.includes(item));
  const consoleErrors = asList(proofOfDoneModel?.consoleErrors);
  const prStatus = asText(prEvidenceModel?.normalizedStatus || verification.prEvidenceStatus, 'no_pr_evidence');

  let verdict = 'unknown';
  if (testsFailed > 0 || parsed.hasFailure || prStatus === 'checks_failed') verdict = 'not-safe';
  else if (verification.buildVerifySatisfied === false || !parsed.buildRun || !parsed.verifyRun) verdict = 'needs-tests';
  else if (browserMissing.length > 0 || verification.proofOfDoneStatus === 'pending') verdict = 'needs-browser-proof';
  else if (prStatus === 'no_pr_evidence') verdict = 'operator-review-required';
  else if (consoleErrors.length > 0) verdict = 'needs-repair';
  else if (verification.mergeReadyCandidate === true) verdict = 'safe-to-merge';

  const repairAvailable = verdict === 'not-safe' || verdict === 'needs-tests' || verdict === 'needs-browser-proof' || verdict === 'needs-repair';
  const repairPromptText = [
    'Operator Relief v1 repair prompt',
    `Mission: ${asText(missionSpec.title, asText(missionSpec.rawIntent, 'unknown mission'))}`,
    testsFailed > 0 ? `Failed tests detected: ${testsFailed}` : null,
    testsRequired.length ? `Required tests: ${testsRequired.join(' | ')}` : null,
    !parsed.buildRun || !parsed.verifyRun ? 'Run required commands: npm run stephanos:build && npm run stephanos:verify' : null,
    browserMissing.length ? `Browser proof missing: ${browserMissing.join(' | ')}` : null,
    consoleErrors.length ? `Console/runtime symptoms: ${consoleErrors.join(' | ')}` : null,
    'Expected behavior: preserve Mission Console canon and target tile behavior.',
    'Constraint: Do not create new canon; audit existing working surface first.',
  ].filter(Boolean).join('\n');

  const lessonCandidates = asList(memoryLibrarianQueue.queue).slice(0, 5).map((candidate) => ({
    id: candidate.id,
    title: candidate.title || candidate.summary || 'Lesson candidate',
    reason: candidate.reason || candidate.summary || 'Candidate inferred from mission evidence.',
    source: candidate.source || 'memory_librarian',
    approvalRequired: true,
  }));

  if (verdict === 'needs-browser-proof') {
    lessonCandidates.push({ id: 'music-browser-proof-required', title: 'Browser proof required for Music Tile UI tasks', reason: 'Tests passed while UI remained broken in prior incidents.', source: 'music-failure-pack', approvalRequired: true });
  }

  const nextActions = [];
  if (verdict === 'needs-tests' || verdict === 'not-safe') nextActions.push({ id: 'rerun-tests', label: 'Run required tests/build/verify', type: 'test', priority: 'high', reason: 'Required test/build evidence missing or failing.' });
  if (verdict === 'needs-browser-proof') nextActions.push({ id: 'run-browser-smoke', label: 'Run browser smoke proof', type: 'browser-proof', priority: 'high', reason: 'Browser proof missing. Run UI smoke test before merge.' });
  if (verdict === 'needs-repair' || verdict === 'not-safe') nextActions.push({ id: 'request-codex-repair', label: 'Request Codex repair', type: 'codex-repair', priority: 'high', reason: 'Runtime or test evidence indicates repair is required.' });
  if (asList(operatorDecisionQueue.decisions).length > 0) nextActions.push({ id: 'resolve-operator-decision', label: 'Resolve operator decision queue', type: 'operator-decision', priority: 'medium', reason: 'Operator remains final approver.' });
  if (lessonCandidates.length > 0) nextActions.push({ id: 'review-lessons', label: 'Review lesson candidates', type: 'memory-review', priority: 'low', reason: 'Memory promotion remains operator-approved only.' });

  return {
    status: verdict === 'safe-to-merge' ? 'merge-candidate' : (blockerList.length > 0 ? 'blocked' : 'active'),
    missionTitle: asText(missionSpec.title, asText(missionSpec.rawIntent, 'Awaiting mission intent')),
    missionObjective: asText(missionSpec.objective, asText(missionSpec.rawIntent, 'Not provided')),
    currentPhase: asText(taskFinisherModel.finishPlanStatus, 'draft'),
    codexDeltaSummary: asText(prEvidenceModel.prTitle || missionEvidenceSummary.missionReadyNarrative, 'Codex delta pending PR evidence.'),
    tests: { required: testsRequired, passed: testsPassed, failed: testsFailed, unknown: testsRequired.length === 0 ? 1 : 0, buildPassed: parsed.buildRun === true, verifyPassed: parsed.verifyRun === true },
    browserProof: { required: browserRequired, observed: browserObserved, missing: browserMissing, blockers: browserMissing.length ? ['Browser proof missing. Run UI smoke test before merge.'] : [] },
    runtimeEvidence: { consoleErrors, routeStatus: asText(supportSnapshot.routeStatus || supportSnapshot.runtimeStatus?.routeStatus, 'unknown'), providerStatus: asText(supportSnapshot.providerStatus || supportSnapshot.runtimeStatus?.providerStatus, 'unknown'), tileStatus: asText(supportSnapshot.tileStatus || supportSnapshot.runtimeStatus?.tileStatus, 'unknown'), warnings: warningList },
    mergeSafety: { verdict, confidence: verdict === 'safe-to-merge' ? 'high' : 'medium', reasons: blockerList.length ? blockerList : ['Evidence synthesized from mission systems.'], blockers: blockerList, requiredApprovals: ['Operator approval required for merge.'] },
    nextActions,
    repairPrompt: { available: repairAvailable, title: repairAvailable ? 'Codex Repair Prompt' : 'No repair prompt required', prompt: repairAvailable ? repairPromptText : '', sourceEvidence: { verificationBlockers: verification.blockers || [], consoleErrors } },
    lessonCandidates,
    operatorDecision: { required: true, options: ['merge', 'defer', 'request-repair', 'reject', 'promote-lesson'], recommendedOption: verdict === 'safe-to-merge' ? 'merge' : 'request-repair', reason: verdict === 'safe-to-merge' ? 'Merge candidate — operator approval required.' : 'Evidence gaps remain; resolve before merge.' },
  };
}
