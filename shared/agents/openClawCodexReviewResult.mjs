const SOURCES = new Set(['codex', 'chatgpt', 'operator', 'unknown']);
const STATUSES = new Set(['not_received', 'received', 'parsed', 'needs_more_evidence', 'rejected', 'ready_for_implementation_planning', 'blocked']);

const BLOCKED_PATTERNS = [/\bexecute\b/i, /\brun\s+command/i, /\bgit\s+(commit|push|checkout|merge|rebase|write)\b/i, /\bbrowser\s+control\b/i, /\bedit\s+files?\b/i, /\bautonom/i, /\bbypass\s+approval\b/i, /\bweaken\s+guardrail/i, /\benable\s+openclaw\s+execution\b/i];

function asArray(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function asText(v) { return typeof v === 'string' ? v.trim() : ''; }
function parseSections(rawText = '') {
  const lines = rawText.split(/\r?\n/);
  const sections = { summary: [], filesScope: [], risks: [], rollback: [], requiredChecks: [], safetyConfirmations: [], openQuestions: [] };
  let current = 'summary';
  for (const line of lines) {
    const t = line.trim();
    if (/^summary\b:?/i.test(t)) { current = 'summary'; continue; }
    if (/^(files\/scope|files|scope)\b:?/i.test(t)) { current = 'filesScope'; continue; }
    if (/^risks?\b:?/i.test(t)) { current = 'risks'; continue; }
    if (/^rollback\b:?/i.test(t)) { current = 'rollback'; continue; }
    if (/^required\s+checks\b:?/i.test(t)) { current = 'requiredChecks'; continue; }
    if (/^safety\s+confirmations?\b:?/i.test(t)) { current = 'safetyConfirmations'; continue; }
    if (/^open\s+questions?\b:?/i.test(t)) { current = 'openQuestions'; continue; }
    if (t) sections[current].push(t.replace(/^[-*]\s*/, ''));
  }
  return sections;
}

export function buildOpenClawCodexReviewResult(input = {}, { packetId = 'none' } = {}) {
  const rawText = asText(input?.rawText);
  const parsed = parseSections(rawText);
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
  else if ((findings.length > 0 || asText(input?.reviewSummary) || parsed.summary.length > 0) && blockers.length === 0) resultStatus = 'ready_for_implementation_planning';

  return {
    resultId: input?.resultId || `openclaw-codex-review-${packetId}`,
    packetId: input?.packetId || packetId,
    source,
    resultStatus,
    reviewSummary: asText(input?.reviewSummary) || parsed.summary.join(' '),
    findings: findings.length ? findings : parsed.filesScope,
    risks: asArray(input?.risks).length ? asArray(input?.risks) : parsed.risks,
    recommendedChanges: asArray(input?.recommendedChanges),
    requiredTests: asArray(input?.requiredTests).length ? asArray(input?.requiredTests) : parsed.requiredChecks,
    requiredBuildCommands: asArray(input?.requiredBuildCommands),
    openQuestions: openQuestions.length ? openQuestions : parsed.openQuestions,
    evidenceRequests,
    blockers: blockedByText ? [...blockers, 'Execution/autonomy request detected in pasted review text.'] : blockers,
    warnings: asArray(input?.warnings).concat(parsed.safetyConfirmations.length ? [] : rawText ? ['Safety confirmations missing from review evidence.'] : []),
    rollbackPlan: asArray(input?.rollbackPlan).length ? asArray(input?.rollbackPlan) : parsed.rollback,
    rawText,
    receivedAt: input?.receivedAt || new Date().toISOString(),
    parsedAt: input?.parsedAt || (rawText ? new Date().toISOString() : ''),
    executionAllowed: false,
    selfModificationAllowed: false,
    operatorApprovalRequired: true,
    nextAction: resultStatus === 'not_received' ? 'Ingest Codex review result.' : resultStatus === 'needs_more_evidence' ? 'Collect requested evidence and unresolved answers.' : resultStatus === 'ready_for_implementation_planning' ? 'Build implementation planning packet.' : resultStatus === 'blocked' ? 'Future-gate blocked requests and keep execution disabled.' : 'Review intake result.',
  };
}
