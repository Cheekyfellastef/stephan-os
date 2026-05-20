function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.map((item) => asText(item)).filter(Boolean) : [];
}

export function projectCanonicalPrEvidence({ prEvidence = {}, githubPrEvidence = {} } = {}) {
  const githubStatus = asText(githubPrEvidence.status, '').toLowerCase();
  const useGithubFetched = githubStatus === 'fetched';
  const base = prEvidence && typeof prEvidence === 'object' ? { ...prEvidence } : {};
  if (!useGithubFetched) return base;
  const githubMerged = githubPrEvidence.merged === true;
  const mergedState = asText(githubPrEvidence.prState, '').toLowerCase() === 'closed' && githubMerged;
  const merged = githubMerged || mergedState || base.merged === true;
  const mergedReadiness = merged ? 'already-merged' : '';
  const missingProof = asList(githubPrEvidence.missingProof).length > 0 ? asList(githubPrEvidence.missingProof) : asList(base.missingProof);
  const githubChecks = asText(githubPrEvidence.checksStatus, asText(base.checksStatus, 'unknown'));
  const githubBuild = asText(githubPrEvidence.buildStatus, asText(base.buildStatus, 'unknown'));
  const githubVerify = asText(githubPrEvidence.verifyStatus, asText(base.verifyStatus, 'unknown'));
  return {
    ...base,
    status: asText(githubPrEvidence.status, asText(base.status, 'none')),
    prEvidenceStatus: asText(githubPrEvidence.status, asText(base.prEvidenceStatus, 'none')),
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
    recommendedNextAction: asText(githubPrEvidence.recommendedNextAction, merged ? 'PR merged; run post-merge validation and monitor regressions.' : asText(base.recommendedNextAction, 'Collect PR evidence.')),
  };
}
