const SOURCES = new Set(['codex', 'chatgpt', 'operator', 'unknown']);
const STATUSES = new Set(['not_received', 'received', 'parsed', 'needs_more_evidence', 'rejected', 'ready_for_implementation_planning', 'blocked']);

const BLOCKED_PATTERNS = [/\bexecute\b/i, /\brun\s+command/i, /\bgit\s+(commit|push|checkout|merge|rebase)\b/i, /\bbrowser\s+control\b/i, /\bedit\s+files?\b/i, /\bautonom/i];

function asArray(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function asText(v) { return typeof v === 'string' ? v.trim() : ''; }

export function buildOpenClawCodexReviewResult(input = {}, { packetId = 'none' } = {}) {
  const rawText = asText(input?.rawText);
  const findings = asArray(input?.findings);
  const blockers = asArray(input?.blockers);
  const openQuestions = asArray(input?.openQuestions);
  const evidenceRequests = asArray(input?.evidenceRequests);
  const source = SOURCES.has(input?.source) ? input.source : 'unknown';
  const requestedStatus = STATUSES.has(input?.resultStatus) ? input.resultStatus : '';
  const blockedByText = BLOCKED_PATTERNS.some((p) => p.test(rawText));
  const blockedByEvidence = blockers.length > 0 || blockedByText;

  let resultStatus = requestedStatus || 'not_received';
  if (rawText || findings.length || asText(input?.reviewSummary)) resultStatus = resultStatus === 'not_received' ? 'received' : resultStatus;
  if (blockedByEvidence) resultStatus = 'blocked';
  else if (openQuestions.length > 0 || evidenceRequests.length > 0) resultStatus = 'needs_more_evidence';
  else if ((findings.length > 0 || asText(input?.reviewSummary)) && blockers.length === 0) resultStatus = 'ready_for_implementation_planning';

  return {
    resultId: input?.resultId || `openclaw-codex-review-${packetId}`,
    packetId: input?.packetId || packetId,
    source,
    resultStatus,
    reviewSummary: asText(input?.reviewSummary),
    findings,
    risks: asArray(input?.risks),
    recommendedChanges: asArray(input?.recommendedChanges),
    requiredTests: asArray(input?.requiredTests),
    requiredBuildCommands: asArray(input?.requiredBuildCommands),
    openQuestions,
    evidenceRequests,
    blockers: blockedByText ? [...blockers, 'Execution/autonomy request detected in pasted review text.'] : blockers,
    warnings: asArray(input?.warnings),
    receivedAt: input?.receivedAt || new Date().toISOString(),
    parsedAt: input?.parsedAt || (rawText ? new Date().toISOString() : ''),
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    nextAction: resultStatus === 'not_received' ? 'Ingest Codex review result.' : resultStatus === 'needs_more_evidence' ? 'Collect requested evidence and unresolved answers.' : resultStatus === 'ready_for_implementation_planning' ? 'Build implementation planning packet.' : resultStatus === 'blocked' ? 'Future-gate blocked requests and keep execution disabled.' : 'Review intake result.',
  };
}
