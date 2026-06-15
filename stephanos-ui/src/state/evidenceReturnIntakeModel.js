function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}
function asList(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function yes(value) { return String(value || '').trim().toLowerCase() === 'yes' || value === true; }

const PACKET_IDS = [
  'packet-evidence-review-local-ai-proof-v1b',
  'packet-browser-proof-checklist-operator-v1b',
  'packet-pr-evidence-collection-v1b',
];
const FAIL_RE = /\b(fail(?:ed|ure)?|error|red console|exception|blocked|blocker|missing proof|proof missing|not reachable|unavailable|timeout|failed checks?)\b/i;
const TEMPLATE_RE = /<\s*(?:your|insert|todo|response|answer)[^>]*>|\{\{[^}]+\}\}|TODO_PLACEHOLDER|your question or action request|say next|as a language model/i;

function finding(type, status, summary, confidence = 'medium') {
  return { evidenceType: type, status, summary, confidence };
}

function inferPacketId(text, packetBayProjection = {}) {
  const lower = text.toLowerCase();
  const explicit = PACKET_IDS.find((id) => lower.includes(id));
  if (explicit) return explicit;
  const packets = asList(packetBayProjection.packets);
  const active = packets.find((packet) => ['awaiting-result', 'ready-to-copy', 'operator-action'].includes(packet?.status));
  if (/browser|console|checklist/.test(lower)) return 'packet-browser-proof-checklist-operator-v1b';
  if (/pull request|\bpr\s*#?\d+|checks?|commit|merge/.test(lower)) return 'packet-pr-evidence-collection-v1b';
  if (/local ai|review/.test(lower)) return 'packet-evidence-review-local-ai-proof-v1b';
  return active?.id || 'none';
}

function sourceFromText(text) {
  const lower = text.toLowerCase();
  if (/source[_ -]?pack|stephanos_handoff_packet|useful_facts/.test(lower)) return 'source-pack-runner';
  if (/browser proof|browser checklist|red console|console errors?/.test(lower)) return 'browser-proof';
  if (/pull request|\bpr\s*#?\d+|check status|commit|merged/.test(lower)) return 'pr-evidence';
  if (/local ai|read-only review|evidence review packet/.test(lower)) return 'local-ai-review';
  return text ? 'operator-paste' : 'none';
}

function parseFindings(text) {
  const findings = [];
  const lower = text.toLowerCase();
  const normalizedForFailure = text.replace(/no red console errors?/ig, 'console-clean').replace(/no errors?/ig, 'clean');
  const hasFail = FAIL_RE.test(normalizedForFailure);
  if (/source[_ -]?pack|source pack|stephanos_handoff_packet|useful_facts/.test(lower)) {
    findings.push(finding('source-pack', (TEMPLATE_RE.test(text) || /stale/.test(lower)) ? 'blocked' : (hasFail ? 'failed' : 'observed'), TEMPLATE_RE.test(text) ? 'Source Pack return includes template/stale leakage.' : 'Source Pack bounded return candidate is present.', TEMPLATE_RE.test(text) ? 'high' : 'medium'));
  }
  if (/npm run [\w:-]*build|build\s*(pass(?:ed)?|success|ok)|stephanos:build[^\n]*(pass|success|0)/i.test(text)) {
    findings.push(finding('build', hasFail ? 'failed' : 'observed', 'Explicit build proof text is present.', 'high'));
  }
  if (/npm run [\w:-]*verify|verify\s*(pass(?:ed)?|success|ok)|stephanos:verify[^\n]*(pass|success|0)/i.test(text)) {
    findings.push(finding('verify', hasFail ? 'failed' : 'observed', 'Explicit verify proof text is present.', 'high'));
  }
  if (/browser proof|browser checklist|ui reality|command deck|console errors?|red console/i.test(text)) {
    const status = /red console|console errors?:?\s*(yes|present)|error/i.test(normalizedForFailure) ? 'failed' : (/pass|observed|visible|ok|no red console errors/i.test(text) ? 'observed' : 'pending-review');
    findings.push(finding('browser-proof', status, 'Browser proof checklist return candidate is present.', status === 'observed' ? 'high' : 'medium'));
  }
  if (/pull request|\bpr\s*#?\d+|https:\/\/github\.com\/[^\s]+\/pull\/\d+|commit\s+[a-f0-9]{7,40}|check status|checks?:\s*(pass|success|green)|merged:\s*(yes|true)/i.test(text)) {
    const observed = /(\bpr\s*#?\d+|pull\/\d+|commit\s+[a-f0-9]{7,40}|checks?:\s*(pass|success|green)|check status:\s*(pass|success|green)|merged:\s*(yes|true))/i.test(text);
    findings.push(finding('pr-evidence', hasFail ? 'failed' : (observed ? 'observed' : 'pending-review'), observed ? 'PR/check evidence includes explicit identifier or status.' : 'PR evidence lacks explicit identifier/status.', observed ? 'high' : 'low'));
  }
  if (/local ai|read-only review|evidence review packet/i.test(text) && findings.length === 0) {
    findings.push(finding('local-ai-review', 'pending-review', 'Local AI review text is advisory until explicit proof is present.', 'medium'));
  }
  if (hasFail && findings.length === 0) findings.push(finding('unknown', /blocked|missing proof|not reachable|unavailable/i.test(text) ? 'blocked' : 'failed', 'Failure/blocking language is present.', 'medium'));
  if (text && findings.length === 0) findings.push(finding('unknown', 'pending-review', 'Pasted evidence return is ambiguous and needs operator review.', 'low'));
  return findings;
}

export function deriveEvidenceReturnIntakeProjection(input = {}) {
  const workbench = input.builderWorkbenchInput || input.workbenchInput || {};
  const text = asText(input.operatorPastedIntakeText || input.intakeText || workbench.evidenceReturnIntakeText || workbench.localAiReviewText || '', '');
  const intakeAvailable = true;
  if (!text) return {
    status: 'idle', intakeAvailable, intakeSource: 'none', relatedPacketId: 'none', relatedMissionId: input.missionEvidenceLedgerProjection?.missionId || 'mission-unknown', relatedEvidenceType: 'none', parsedResultPresent: false, parsedResultStatus: 'unknown', proofObservedCount: 0, proofFailedCount: 0, proofPendingReviewCount: 0, proofBlockedCount: 0, missingProofResolved: false, remainingMissingProofSummary: input.missionEvidenceContextSummary?.missingProofSummary || input.missionEvidenceLedgerProjection?.missingProofSummary || 'none', trustedForMerge: false, trustedForCanon: false, recommendedNextAction: 'Paste returned proof into the existing Builder Workbench Evidence Return Intake field, then classify/review.', mutationAllowed: false, durableWriteAllowed: false, operatorApprovalRequiredForWrite: true, openClawMutationLocked: true, codexAutoDispatchAllowed: false, confidence: 'low', warnings: [], parsedFindings: [], summary: 'Evidence Return Intake is idle; no proof has been observed.' };
  const parsedFindings = parseFindings(text);
  const count = (status) => parsedFindings.filter((item) => item.status === status).length;
  const proofObservedCount = count('observed');
  const proofFailedCount = count('failed');
  const proofPendingReviewCount = count('pending-review');
  const proofBlockedCount = count('blocked');
  const parsedResultStatus = proofBlockedCount ? 'blocked' : (proofFailedCount ? 'failed' : (proofObservedCount && !proofPendingReviewCount ? 'observed' : (proofPendingReviewCount ? 'pending-review' : 'unknown')));
  const status = parsedResultStatus === 'observed' ? 'parsed' : parsedResultStatus;
  const observedTypes = parsedFindings.filter((item) => item.status === 'observed').map((item) => item.evidenceType);
  const blockersRemain = Number(input.missionEvidenceLedgerProjection?.blockerCount || 0) > 0 || /blocked/i.test(asText(input.missionEvidenceLedgerProjection?.status, ''));
  const trustedForMerge = false && observedTypes.includes('build') && observedTypes.includes('verify') && !blockersRemain;
  const trustedForCanon = /canon proof:\s*(pass|observed|yes)|protected-canon proof:\s*(pass|observed|yes)/i.test(text);
  const warnings = [];
  if (proofFailedCount || proofBlockedCount) warnings.push('Returned proof contains failure/blocking language and is not accepted as observed.');
  if (proofPendingReviewCount) warnings.push('Ambiguous/advisory proof remains pending operator review.');
  if (trustedForCanon) warnings.push('Canon trust marker found; operator review is still required before any durable write.');
  return {
    status, intakeAvailable, intakeSource: sourceFromText(text), relatedPacketId: inferPacketId(text, input.packetBayProjection), relatedMissionId: input.missionEvidenceLedgerProjection?.missionId || input.projectAwarenessProjection?.missionId || 'derived-runtime-mission', relatedEvidenceType: observedTypes[0] || parsedFindings[0]?.evidenceType || 'unknown', parsedResultPresent: true, parsedResultStatus, proofObservedCount, proofFailedCount, proofPendingReviewCount, proofBlockedCount, missingProofResolved: proofObservedCount > 0 && !proofFailedCount && !proofBlockedCount, remainingMissingProofSummary: input.missionEvidenceContextSummary?.missingProofSummary || input.missionEvidenceLedgerProjection?.missingProofSummary || 'pending operator review', trustedForMerge, trustedForCanon: false, recommendedNextAction: parsedResultStatus === 'observed' ? 'Review observed proof candidate; operator approval is required before any durable ledger write or merge claim.' : 'Collect explicit build/verify/browser/PR evidence and keep intake pending review.', mutationAllowed: false, durableWriteAllowed: false, operatorApprovalRequiredForWrite: true, openClawMutationLocked: true, codexAutoDispatchAllowed: false, confidence: parsedFindings.some((item) => item.confidence === 'high') ? 'high' : (parsedFindings.some((item) => item.confidence === 'medium') ? 'medium' : 'low'), warnings, parsedFindings, summary: `Evidence return classified as ${parsedResultStatus}; observed ${proofObservedCount}, failed ${proofFailedCount}, pending ${proofPendingReviewCount}, blocked ${proofBlockedCount}.`,
  };
}

export const EVIDENCE_RETURN_INTAKE_PACKET_IDS = PACKET_IDS;
