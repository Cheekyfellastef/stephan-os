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
  return {
    ...base,
    status: asText(githubPrEvidence.status, asText(base.status, 'none')),
    prEvidenceStatus: asText(githubPrEvidence.status, asText(base.prEvidenceStatus, 'none')),
    checksStatus: asText(githubPrEvidence.checksStatus, asText(base.checksStatus, 'unknown')),
    buildStatus: asText(githubPrEvidence.buildStatus, asText(base.buildStatus, 'unknown')),
    verifyStatus: asText(githubPrEvidence.verifyStatus, asText(base.verifyStatus, 'unknown')),
    changedFileCount: Number(githubPrEvidence.changedFileCount ?? base.changedFileCount ?? 0) || 0,
    merged: githubPrEvidence.merged === true ? true : (base.merged === true),
    mergeReadiness: asText(githubPrEvidence.mergeReadiness, asText(base.mergeReadiness, 'wait')),
    missingProof: asList(githubPrEvidence.missingProof).length > 0 ? asList(githubPrEvidence.missingProof) : asList(base.missingProof),
    prNumber: githubPrEvidence.prNumber ?? base.prNumber ?? null,
    parsedPrNumber: githubPrEvidence.parsedPrNumber ?? base.parsedPrNumber ?? base.prNumber ?? null,
    repo: asText(githubPrEvidence.repo, asText(base.repo, '')),
    prState: asText(githubPrEvidence.prState, asText(base.prState, 'unknown')),
    prTitle: asText(githubPrEvidence.prTitle, asText(base.prTitle, '')),
    source: asText(githubPrEvidence.source, asText(base.source, 'none')),
    recommendedNextAction: asText(githubPrEvidence.recommendedNextAction, asText(base.recommendedNextAction, 'Collect PR evidence.')),
  };
}
