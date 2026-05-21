function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value)
    ? value
      .map((item) => asText(item))
      .filter(Boolean)
      .filter((item) => !['none', 'n/a', 'na', 'unknown'].includes(item.toLowerCase()))
    : [];
}

export function projectCanonicalPrEvidence({ prEvidence = {}, githubPrEvidence = {} } = {}) {
  const githubStatus = asText(githubPrEvidence.status, '').toLowerCase();
  const base = prEvidence && typeof prEvidence === 'object' ? { ...prEvidence } : {};
  const githubSource = asText(githubPrEvidence.source, '').toLowerCase();
  const hasGithubEvidence = ['fetched', 'available', 'received', 'manual', 'operator-supplied-readonly', 'github-live-readonly', 'github-api'].includes(githubStatus)
    || ['operator-supplied-readonly', 'github-live-readonly', 'github-api', 'manual'].includes(githubSource);
  if (!hasGithubEvidence) {
    if (githubStatus === 'needs-connector') {
      return {
        ...base,
        status: 'evidence-unavailable',
        prEvidenceStatus: 'evidence-unavailable',
        mergeReadiness: 'hold',
        merged: base.merged === true ? true : null,
        recommendedNextAction: 'Live GitHub evidence is disabled; supply operator read-only PR evidence or enable read-only fetch.',
        evidenceTruthStatus: 'unknown-disabled',
        verificationSource: 'parsed-only',
      };
    }
    return base;
  }
  const githubMerged = githubPrEvidence.merged === true;
  const mergedState = asText(githubPrEvidence.prState, '').toLowerCase() === 'closed' && githubMerged;
  const merged = githubMerged || mergedState || base.merged === true;
  const prState = asText(githubPrEvidence.prState, asText(base.prState, 'unknown')).toLowerCase();
  const mergedReadiness = merged ? 'already-merged' : (prState === 'closed' ? 'closed-unmerged' : '');
  const missingProof = asList(githubPrEvidence.missingProof).length > 0 ? asList(githubPrEvidence.missingProof) : asList(base.missingProof);
  const githubChecks = asText(githubPrEvidence.checksStatus, asText(base.checksStatus, 'unknown'));
  const githubBuild = asText(githubPrEvidence.buildStatus, asText(base.buildStatus, 'unknown'));
  const githubVerify = asText(githubPrEvidence.verifyStatus, asText(base.verifyStatus, 'unknown'));
  return {
    ...base,
    status: merged ? 'merged' : asText(githubPrEvidence.status, asText(base.status, 'none')),
    prEvidenceStatus: merged ? 'merged' : asText(githubPrEvidence.status, asText(base.prEvidenceStatus, 'none')),
    checksStatus: githubChecks,
    buildStatus: githubBuild,
    verifyStatus: githubVerify,
    changedFileCount: Number(githubPrEvidence.changedFileCount ?? base.changedFileCount ?? 0) || 0,
    merged,
    mergeReadiness: asText(githubPrEvidence.mergeReadiness, mergedReadiness || asText(base.mergeReadiness, 'wait')),
    missingProof,
    prNumber: githubPrEvidence.prNumber ?? base.prNumber ?? null,
    parsedPrNumber: githubPrEvidence.parsedPrNumber ?? base.parsedPrNumber ?? base.prNumber ?? null,
    repo: asText(githubPrEvidence.repo, asText(base.repo, '')),
    prState: asText(githubPrEvidence.prState, asText(base.prState, 'unknown')),
    prTitle: asText(githubPrEvidence.prTitle, asText(base.prTitle, '')),
    source: asText(githubPrEvidence.source, asText(base.source, 'none')),
    recommendedNextAction: asText(
      githubPrEvidence.recommendedNextAction,
      merged
        ? 'No merge action required; PR is already merged. Optional: verify local/main alignment.'
        : (prState === 'closed'
          ? 'PR is closed without merge; do not merge this PR.'
          : asText(base.recommendedNextAction, 'Collect PR evidence.')),
    ),
    evidenceTruthStatus: merged ? 'known-merged' : (prState === 'open' ? 'known-open' : (prState === 'closed' ? 'known-closed-unmerged' : 'known')),
    verificationSource: asText(githubPrEvidence.source, 'live-fetch'),
  };
}
