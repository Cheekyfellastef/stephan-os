const RETURN_SOURCES = new Set([
  'codex_manual',
  'openclaw_manual',
  'manual_operator',
  'unknown',
]);

const RETURN_STATUSES = new Set([
  'none',
  'received',
  'incomplete',
  'verification_required',
  'verifying',
  'verified',
  'failed',
  'blocked',
]);

const VERIFICATION_DECISIONS = new Set([
  'not_ready',
  'needs_review',
  'safe_to_accept',
  'unsafe_to_accept',
  'needs_another_agent_pass',
]);

const MERGE_READINESS_STATES = new Set([
  'not_ready',
  'blocked',
  'review_required',
  'ready_for_operator_approval',
  'unsafe',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function uniqueTextList(value) {
  return Array.from(new Set(asArray(value).map((entry) => asText(entry)).filter(Boolean)));
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = asText(value, fallback).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

export function createDefaultVerificationReturn() {
  return {
    returnSource: 'unknown',
    returnStatus: 'none',
    returnedSummary: '',
    returnedFilesChanged: [],
    returnedChecksRun: [],
    returnedAssumptions: [],
    returnedBlockers: [],
    returnedWarnings: [],
    returnedRawText: '',
    verificationChecksRequired: [],
    verificationChecksPassed: [],
    verificationChecksFailed: [],
    verificationCommands: [],
    verificationDecision: 'not_ready',
    verificationReasons: [],
    mergeReadiness: 'not_ready',
  };
}

export function normalizeVerificationReturn(input = {}, fallbackChecks = []) {
  const defaults = createDefaultVerificationReturn();
  const source = input && typeof input === 'object' ? input : {};
  const requiredChecks = uniqueTextList(
    asArray(source.verificationChecksRequired).length > 0 ? source.verificationChecksRequired : fallbackChecks,
  );

  return {
    returnSource: normalizeEnum(source.returnSource, RETURN_SOURCES, defaults.returnSource),
    returnStatus: normalizeEnum(source.returnStatus, RETURN_STATUSES, defaults.returnStatus),
    returnedSummary: asText(source.returnedSummary),
    returnedFilesChanged: uniqueTextList(source.returnedFilesChanged),
    returnedChecksRun: uniqueTextList(source.returnedChecksRun),
    returnedAssumptions: uniqueTextList(source.returnedAssumptions),
    returnedBlockers: uniqueTextList(source.returnedBlockers),
    returnedWarnings: uniqueTextList(source.returnedWarnings),
    returnedRawText: asText(source.returnedRawText),
    verificationChecksRequired: requiredChecks,
    verificationChecksPassed: uniqueTextList(source.verificationChecksPassed),
    verificationChecksFailed: uniqueTextList(source.verificationChecksFailed),
    verificationCommands: uniqueTextList(
      asArray(source.verificationCommands).length > 0 ? source.verificationCommands : requiredChecks,
    ),
    verificationDecision: normalizeEnum(source.verificationDecision, VERIFICATION_DECISIONS, defaults.verificationDecision),
    verificationReasons: uniqueTextList(source.verificationReasons),
    mergeReadiness: normalizeEnum(source.mergeReadiness, MERGE_READINESS_STATES, defaults.mergeReadiness),
  };
}

export function adjudicateVerificationReturn({
  verificationReturn = {},
  fallbackChecks = [],
  packetReady = false,
  lifecycleState = '',
} = {}) {
  const normalized = normalizeVerificationReturn(verificationReturn, fallbackChecks);
  const blockers = [...normalized.returnedBlockers];
  const warnings = [...normalized.returnedWarnings];
  const reasons = [...normalized.verificationReasons];
  const requiredChecks = normalized.verificationChecksRequired;
  const passed = normalized.verificationChecksPassed;
  const failed = normalized.verificationChecksFailed;
  const missingRequiredChecks = requiredChecks.filter((check) => !passed.includes(check));
  const returnPresent = Boolean(normalized.returnedRawText || normalized.returnedSummary || normalized.returnStatus !== 'none');
  const failedChecksPresent = failed.length > 0;
  const blockersPresent = blockers.length > 0;
  const lifecycle = asText(lifecycleState).toLowerCase();

  let verificationReturnStatus = normalized.returnStatus;
  let verificationDecision = normalized.verificationDecision;
  let mergeReadiness = normalized.mergeReadiness;
  let verificationReturnNextAction = 'No verification action reported.';

  if (!returnPresent) {
    verificationDecision = 'not_ready';
    mergeReadiness = 'not_ready';
    verificationReturnStatus = packetReady || lifecycle === 'sent_to_agent' ? 'waiting_for_return' : 'none';
    verificationReturnNextAction = packetReady || lifecycle === 'sent_to_agent'
      ? 'Paste Codex result for verification'
      : 'Prepare and send a manual handoff packet before verification return.';
    if (packetReady || lifecycle === 'sent_to_agent') {
      reasons.push('Awaiting manual return payload from Codex/agent execution.');
    }
  } else if (failedChecksPresent || blockersPresent) {
    verificationReturnStatus = blockersPresent ? 'blocked' : 'failed';
    verificationDecision = blockersPresent ? 'needs_another_agent_pass' : 'unsafe_to_accept';
    mergeReadiness = blockersPresent ? 'blocked' : 'unsafe';
    verificationReturnNextAction = blockersPresent
      ? 'Resolve blockers or request another supervised agent pass.'
      : 'Fix failed checks before operator approval.';
  } else if (missingRequiredChecks.length > 0) {
    verificationReturnStatus = 'verification_required';
    verificationDecision = 'needs_review';
    mergeReadiness = 'review_required';
    verificationReturnNextAction = 'Run and report all required verification checks.';
    blockers.push(`Missing required checks: ${missingRequiredChecks.join(', ')}`);
  } else {
    verificationReturnStatus = 'verified';
    verificationDecision = 'safe_to_accept';
    mergeReadiness = 'ready_for_operator_approval';
    verificationReturnNextAction = 'Review and approve manually (no auto-merge).';
  }

  return {
    ...normalized,
    verificationReturnStatus,
    verificationDecision,
    mergeReadiness,
    verificationReturnReady: returnPresent,
    verificationReturnBlockers: blockers,
    verificationReturnWarnings: warnings,
    verificationReturnReasons: reasons,
    verificationReturnNextAction,
    missingRequiredChecks,
  };
}
