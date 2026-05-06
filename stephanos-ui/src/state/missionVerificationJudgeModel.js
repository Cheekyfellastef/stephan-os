function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : [];
}

export function parseVerificationReturnText(verificationReturnText = '') {
  const text = asText(verificationReturnText);
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/);
  const fileMatches = [...text.matchAll(/(?:^|\s)([\w./-]+\.(?:js|mjs|jsx|ts|tsx|json|md|css|html))/g)].map((match) => match[1]);
  const changedFiles = [...new Set(fileMatches)];
  const testsRun = lines.filter((line) => /(?:^|\s)(npm run|node --test|vitest|jest|pnpm test|yarn test)/i.test(line)).map((line) => line.trim());
  return {
    hasReturn: text.length > 0,
    changedFiles,
    testsRun,
    buildRun: /npm run stephanos:build|\bbuild\b.*(pass|ok|success|ran|run)/i.test(lower),
    verifyRun: /npm run stephanos:verify|\bverify\b.*(pass|ok|success|ran|run)/i.test(lower),
    hasFailure: /\bfail(?:ed|ure)?\b|\berror\b|\bexception\b/.test(lower),
    blockersMentioned: /\bblocker\b|\bblocked\b/.test(lower),
    mergeReadyClaim: /merge[-\s]?ready|ready to merge/.test(lower),
    mergedClaim: /\bmerged\b|auto[-\s]?merge|merge completed/.test(lower),
    proofClaim: /proof|manual verification|operator-visible|evidence/.test(lower),
    openClawExecutionClaim: /openclaw.*(executed|ran|mutated|push|merged|shell|secret|account)/.test(lower),
    githubWriteClaim: /github.*(write|merge|auto-merge|pushed|settings)/.test(lower),
    distTouched: /apps\/stephanos\/dist|\bdist\//.test(lower),
    distRebuiltClaim: /rebuild(?:ed)? dist|npm run stephanos:build/.test(lower),
    supportSnapshotUpdateClaim: /support snapshot.*(updated|changed)|missionverification/.test(lower),
  };
}

export function adjudicateMissionVerificationJudge({
  missionSpec = {}, verificationReturnText = '', changedFiles = null, testsRun = null,
} = {}) {
  const parsed = parseVerificationReturnText(verificationReturnText);
  const expectedFiles = asList(missionSpec?.repoArchitectureContext?.sourceFilesLikelyTouched);
  const expectedTests = asList(missionSpec?.repoArchitectureContext?.testsLikelyRequired);
  const generatedOutputs = asList(missionSpec?.repoArchitectureContext?.generatedOutputsLikelyTouched);
  const finishAuthority = missionSpec?.finishAuthority || {};
  const prEvidence = missionSpec?.prEvidenceIntake || {};
  const openClawDelegation = missionSpec?.openClawDelegation || {};
  const codexPrRepairContract = missionSpec?.codexPrRepairContract || {};

  const seenFiles = asList(changedFiles || parsed.changedFiles);
  const seenTests = asList(testsRun || parsed.testsRun);
  const blockers = [];
  const warnings = [];

  const changedFilesKnown = seenFiles.length > 0;
  const changedFilesInScope = !changedFilesKnown || expectedFiles.length === 0 || seenFiles.every((file) => expectedFiles.some((expected) => file.includes(expected) || expected.includes(file)) || /test|supportSnapshot|MissionConsoleTile|intentToBuildModel|missionVerificationJudgeModel/.test(file));
  if (changedFilesKnown && !changedFilesInScope) warnings.push('out_of_scope_change');

  const requiredTestsKnown = expectedTests.length > 0;
  const requiredTestsRun = !requiredTestsKnown || expectedTests.every((testName) => seenTests.join(' ').includes(testName));
  const buildVerifySatisfied = parsed.buildRun && parsed.verifyRun;
  const architectureScopeSatisfied = changedFilesInScope;
  const generatedDistHandledCorrectly = !parsed.distTouched || parsed.distRebuiltClaim;
  const supportSnapshotUpdatedIfNeeded = true;
  const proofOfDoneRequired = true;
  const proofOfDoneStatus = parsed.proofClaim ? 'reported' : 'pending';
  const finishAuthoritySatisfied = finishAuthority.mergeAuthorityIncluded === true && finishAuthority.operatorApprovalRecorded === true;
  const openClawBoundarySatisfied = !parsed.openClawExecutionClaim;
  if (!openClawBoundarySatisfied) blockers.push('openclaw_boundary_violation');

  if (!parsed.hasReturn) blockers.push('no_return');
  if (!requiredTestsRun) warnings.push('missing_test_evidence');
  if (!buildVerifySatisfied) warnings.push('build_verify_missing');
  if (!generatedDistHandledCorrectly) warnings.push('source_truth_warning');
  if (parsed.mergeReadyClaim && !requiredTestsRun) warnings.push('merge_ready_claim_without_required_tests');
  if (parsed.mergedClaim && !finishAuthoritySatisfied) warnings.push('merge_authority_gap');
  if (parsed.githubWriteClaim) warnings.push('github_write_claim_requires_operator_review');
  if (generatedOutputs.length > 0 && parsed.distTouched && !parsed.distRebuiltClaim) warnings.push('generated_dist_without_rebuild_evidence');
  if (prEvidence.normalizedStatus === 'checks_failed') warnings.push('pr_evidence_checks_failed');
  if (codexPrRepairContract.remoteChecksVerified === false) blockers.push('codex_pr_remote_checks_unverified');
  if (codexPrRepairContract.repairCompleteness && codexPrRepairContract.repairCompleteness !== 'repair_complete') blockers.push('codex_pr_repair_incomplete');
  if (codexPrRepairContract.livePrHeadChanged === false) blockers.push('codex_pr_head_unchanged');
  if (codexPrRepairContract.sourceFixRequired && codexPrRepairContract.sourceFilesChanged?.length === 0 && codexPrRepairContract.distFilesChanged?.length > 0) blockers.push('codex_pr_dist_only_mismatch');
  if (prEvidence.normalizedStatus === 'merged' && !(finishAuthority.mergeAuthorityIncluded && finishAuthority.operatorApprovalRecorded)) warnings.push('pr_merged_without_recorded_authority');

  let judgment = 'merge_ready_candidate';
  if (!parsed.hasReturn) judgment = 'no_return';
  else if (parsed.hasFailure || parsed.blockersMentioned) judgment = 'needs_fix';
  else if (!openClawBoundarySatisfied) judgment = 'blocked';
  else if (!requiredTestsRun || !buildVerifySatisfied) judgment = 'insufficient_evidence';
  else if (proofOfDoneStatus !== 'reported') judgment = 'proof_pending';

  const mergeReadyCandidate = judgment === 'merge_ready_candidate';
  const readinessLevel = mergeReadyCandidate ? 'candidate_ready' : (judgment === 'proof_pending' ? 'proof_pending' : 'not_ready');

  return {
    missionId: asText(missionSpec.missionId, 'unknown-mission'),
    verificationStatus: parsed.hasReturn ? 'received' : 'missing',
    judgment,
    readinessLevel,
    goalMatched: parsed.hasReturn ? 'unknown' : 'no',
    changedFilesKnown,
    changedFilesInScope,
    requiredTestsKnown,
    requiredTestsRun,
    buildVerifySatisfied,
    architectureScopeSatisfied,
    generatedDistHandledCorrectly,
    supportSnapshotUpdatedIfNeeded,
    proofOfDoneRequired,
    proofOfDoneStatus,
    finishAuthoritySatisfied,
    openClawBoundarySatisfied,
    memoryLessonCandidatePending: blockers.length > 0 || warnings.length > 0,
    blockers,
    warnings,
    nextAction: mergeReadyCandidate ? 'Operator review for finish authority decision.' : 'Request fix/evidence update before considering merge-ready candidate.',
    mergeReadyCandidate,
    parsed,
    prEvidenceStatus: asText(prEvidence.normalizedStatus, 'no_pr_evidence'),
  };
}
