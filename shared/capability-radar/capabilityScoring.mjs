const SCORE_STATUS = ['IGNORE', 'WATCH', 'REVIEW', 'PROMPT_READY', 'SANDBOX_TEST', 'INTEGRATION_CANDIDATE', 'BLOCKED_RISK'];

function scoreFlag(value, map, fallback = 0) { return map[String(value || '').toLowerCase()] ?? fallback; }

export function scoreCapabilityCandidate(candidate = {}) {
  const score = 50
    + scoreFlag(candidate.costPosture, { 'zero-cost': 14, mixed: -2, paid: -8 })
    + (candidate.localFirst ? 12 : -8)
    + scoreFlag(candidate.activitySignal, { active: 10, mixed: 3, stale: -8 })
    + scoreFlag(candidate.licenseClarity, { clear: 8, mixed: 2, 'review-needed': -5 })
    + scoreFlag(candidate.docsQuality, { good: 7, mixed: 2, poor: -6 })
    + scoreFlag(candidate.securityPosture, { good: 6, 'review-needed': -2, 'risk-flagged': -14 })
    + scoreFlag(candidate.dependencyWeight, { low: 6, medium: 1, 'medium-high': -2, high: -6 })
    + scoreFlag(candidate.integrationDifficulty, { low: 6, medium: 1, 'medium-high': -3, high: -7 })
    + scoreFlag(candidate.relevance, { critical: 15, high: 11, 'medium-high': 7, medium: 3, low: -3 })
    + ((candidate.strengthens || []).length >= 2 ? 8 : 3);
  const normalized = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: normalized,
    status: normalized >= 88 ? 'INTEGRATION_CANDIDATE'
      : normalized >= 78 ? 'SANDBOX_TEST'
        : normalized >= 68 ? 'PROMPT_READY'
          : normalized >= 58 ? 'REVIEW'
            : normalized >= 45 ? 'WATCH'
              : 'IGNORE',
    supportedStatuses: SCORE_STATUS,
  };
}

export function buildCapabilityHandoff(candidate = {}, scoreSummary = {}) {
  return [
    `Candidate: ${candidate.name || 'Unknown'}`,
    `Source: ${candidate.source || 'Unknown'} (${candidate.sourceUrl || 'n/a'})`,
    `Why it may help Stephanos: ${candidate.why || 'TBD'}`,
    `Proposed integration lane: ${candidate.category || 'TBD'}`,
    `Guardrails: Read-only discovery only. No installs/clones/execution/credentials/repo mutation/external actions.`,
    `Phase 1 safe test plan: review docs, map fit to canonical truth boundaries, design sandbox-only test notes, prepare operator approval packet.`,
    `Status: ${scoreSummary.status || candidate.suggestedNextAction || 'REVIEW'} | Stephanos Fit Score: ${scoreSummary.score ?? 'n/a'}`,
    `Do not install or execute without operator approval.`,
    `Preserve canonical runtime truth rules.`,
    `Keep dist generated only.`,
  ].join('\n');
}
