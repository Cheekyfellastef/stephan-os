function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.map((v) => asText(v)).filter(Boolean) : [];
}

export function parseFailedCheckRepairEvidence(input = '') {
  const text = asText(input);
  const lower = text.toLowerCase();
  const prUrl = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/(\d+)/i);
  const prNumber = Number(prUrl?.[1] || text.match(/\bpr\s*#?(\d+)\b/i)?.[1] || 0) || null;
  const branch = text.match(/(?:target|head|branch)\s*[:=]\s*([\w./-]+)/i)?.[1] || '';
  const previousHeadSha = text.match(/(?:previous|old)\s+head\s+sha\s*[:=]\s*([a-f0-9]{7,40})/i)?.[1] || '';
  const newHeadSha = text.match(/(?:new|claimed)\s+head\s+sha\s*[:=]\s*([a-f0-9]{7,40})/i)?.[1] || '';
  const workflow = text.match(/workflow\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || '';
  const failedCheck = text.match(/failed\s+check\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || '';
  const failedJob = text.match(/failed\s+job\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || '';
  const failedStep = text.match(/failed\s+step\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() || '';
  return {
    rawText: text,
    prNumber,
    prUrl: prUrl?.[0] || '',
    branch,
    previousHeadSha,
    newHeadSha,
    workflow,
    failedCheck,
    failedJob,
    failedStep,
    errorLine: text.match(/(?:ReferenceError|TypeError|SyntaxError|Error:)[^\n]*/)?.[0] || '',
    stackTraceSnippets: [...new Set((text.match(/\bat\s+[^\n]+/g) || []).slice(0, 5))],
    flags: {
      couldNotPush: /could not push|origin not configured|connect tunnel failed/i.test(lower),
      originNotConfigured: /origin not configured/i.test(lower),
      connectTunnelFailed: /connect tunnel failed/i.test(lower),
      distMetadataDrift: /dist metadata drift/i.test(lower),
      referenceError: /referenceerror/i.test(lower),
      testsPassedLocally: /tests passed locally/i.test(lower),
      checksGreen: /checks green|all checks passed/i.test(lower),
      merged: /\bmerged\b/i.test(lower),
      mergeable: /\bmergeable\b/i.test(lower),
      couldNotReproduce: /could not reproduce/i.test(lower),
      powershellEncodingWarning: /mojibake|\bbom\b|\bufffd|Ã.|â€”|â€™/i.test(text),
    },
  };
}

export function buildCodexPrRepairContract(input = {}) {
  const missionSpec = input.missionSpec || {};
  const parsedEvidence = parseFailedCheckRepairEvidence(input.codexReturnText || '');
  const targetPrEvidence = input.targetPrEvidence || {};
  const currentPrEvidence = input.currentPrEvidence || {};
  const prEvidence = input.prEvidenceIntake || missionSpec.prEvidenceIntake || {};

  const previousHeadSha = asText(targetPrEvidence.previousHeadSha || parsedEvidence.previousHeadSha || prEvidence.headSha);
  const claimedNewHeadSha = asText(targetPrEvidence.newHeadSha || parsedEvidence.newHeadSha);
  const livePrHeadSha = asText(currentPrEvidence.liveHeadSha || targetPrEvidence.liveHeadSha || claimedNewHeadSha || previousHeadSha);
  const livePrHeadChanged = previousHeadSha && livePrHeadSha ? previousHeadSha !== livePrHeadSha : null;
  const remoteChecksVerified = Boolean(currentPrEvidence.remoteChecksVerified || targetPrEvidence.remoteChecksVerified);
  const remoteChecksGreen = asText(currentPrEvidence.checksStatus || targetPrEvidence.checksStatus || '').toLowerCase() === 'green' || parsedEvidence.flags.checksGreen;
  const sourceFixRequired = parsedEvidence.flags.referenceError || /source|jsx|tsx|runtime/i.test(parsedEvidence.errorLine);
  const sourceFilesChanged = asList(targetPrEvidence.sourceFilesChanged);
  const distFilesChanged = asList(targetPrEvidence.distFilesChanged);
  const distOnlyChange = sourceFilesChanged.length === 0 && distFilesChanged.length > 0;

  const blockers = [];
  const warnings = [];
  let repairCompleteness = 'no_contract';

  if (!parsedEvidence.rawText && !targetPrEvidence.targetPrNumber && !prEvidence.prNumber) repairCompleteness = 'no_contract';
  else repairCompleteness = 'awaiting_failed_check_evidence';

  if (parsedEvidence.flags.couldNotPush) { repairCompleteness = 'blocked_codex_cannot_push'; blockers.push('blocked_codex_cannot_push'); }
  if (targetPrEvidence.fixedOnDifferentBranch === true) { repairCompleteness = 'blocked_wrong_branch'; blockers.push('blocked_wrong_branch'); }
  if (sourceFixRequired && distOnlyChange) { repairCompleteness = 'blocked_dist_only_mismatch'; blockers.push('blocked_dist_only_mismatch'); }
  if (repairCompleteness === 'awaiting_failed_check_evidence' && sourceFixRequired) repairCompleteness = 'awaiting_source_fix';
  if (claimedNewHeadSha && livePrHeadChanged === false) { repairCompleteness = 'awaiting_push_to_pr_branch'; blockers.push('live_pr_head_unchanged'); }
  if (remoteChecksVerified === false && !blockers.includes('blocked_codex_cannot_push')) repairCompleteness = 'awaiting_remote_check_rerun';
  if (remoteChecksVerified && !remoteChecksGreen) repairCompleteness = 'remote_checks_failed';
  if (remoteChecksVerified && remoteChecksGreen && livePrHeadChanged) repairCompleteness = 'repair_complete';

  if (parsedEvidence.flags.powershellEncodingWarning) warnings.push('encoding_warning');
  if (parsedEvidence.flags.testsPassedLocally && !remoteChecksVerified) warnings.push('local_success_not_remote_truth');
  if (parsedEvidence.flags.mergeable && !remoteChecksGreen) warnings.push('mergeable_not_checks_green');
  if (parsedEvidence.flags.couldNotReproduce && asText(prEvidence.normalizedStatus) === 'checks_failed') warnings.push('could_not_reproduce_requires_remote_root_cause');

  return {
    contractId: `codex-pr-repair-${asText(missionSpec.missionId, 'unknown')}-${asText(targetPrEvidence.targetPrNumber || parsedEvidence.prNumber || prEvidence.prNumber || 'na')}`,
    missionId: asText(missionSpec.missionId, 'unknown-mission'),
    targetPrNumber: targetPrEvidence.targetPrNumber || parsedEvidence.prNumber || prEvidence.prNumber || null,
    targetPrUrl: asText(targetPrEvidence.targetPrUrl || parsedEvidence.prUrl || prEvidence.prUrl),
    targetBranch: asText(targetPrEvidence.targetBranch || parsedEvidence.branch || prEvidence.branch),
    baseBranch: asText(targetPrEvidence.baseBranch || prEvidence.baseBranch),
    previousHeadSha, claimedNewHeadSha, livePrHeadSha, livePrHeadChanged,
    failedCheckNames: asList([parsedEvidence.failedCheck]), failedWorkflowNames: asList([parsedEvidence.workflow]), failedJobNames: asList([parsedEvidence.failedJob]), failedStepNames: asList([parsedEvidence.failedStep]),
    failureSummary: asText(parsedEvidence.errorLine || targetPrEvidence.failureSummary, 'No failure summary supplied.'),
    rootCauseClaimedByCodex: asText(targetPrEvidence.rootCause || parsedEvidence.errorLine || 'not reported'),
    rootCauseSupportedByEvidence: sourceFixRequired ? (sourceFilesChanged.length > 0 ? 'yes' : 'no') : 'unknown',
    repairType: asText(targetPrEvidence.repairType, 'unknown'),
    sourceFixRequired, distOnlyFixAllowed: targetPrEvidence.distOnlyFixAllowed === true, sourceFilesChanged, distFilesChanged,
    testsClaimedRun: asList(targetPrEvidence.testsClaimedRun), remoteChecksClaimed: parsedEvidence.flags.checksGreen, remoteChecksVerified,
    githubEvidenceStatus: remoteChecksVerified ? (remoteChecksGreen ? 'checks_green' : 'checks_failed') : 'unverified',
    codexEnvironmentCanPush: parsedEvidence.flags.couldNotPush ? 'no' : 'unknown',
    codexPushedToTargetBranch: livePrHeadChanged === true,
    repairCompleteness,
    operatorManualInterventionRequired: repairCompleteness === 'blocked_codex_cannot_push' ? 'decision_required' : 'no',
    warningLevel: blockers.length ? 'high' : warnings.length ? 'medium' : 'none',
    blockers, warnings,
    nextAction: repairCompleteness === 'repair_complete' ? 'repair complete; wait for operator merge decision' : repairCompleteness === 'blocked_codex_cannot_push' ? 'operator choose abandon/retry/new task/manual emergency intervention' : 'request codex pr repair contract evidence update',
  };
}
