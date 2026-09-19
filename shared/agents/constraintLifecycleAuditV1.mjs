export const CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA = 'stephanos.constraint-lifecycle-audit.v1';

export const CONSTRAINT_LIFECYCLE_STATES = Object.freeze([
  'CONSTITUTIONAL_PERMANENT',
  'CONDITIONAL_ACTIVE',
  'TEMPORARY_ACTIVE',
  'RETIREMENT_CANDIDATE',
  'SUPERSEDED',
  'RETIRED',
  'UNKNOWN_REQUIRES_RECONSTRUCTION',
]);

const LIFECYCLE_STATE_SET = new Set(CONSTRAINT_LIFECYCLE_STATES);
const LIFECYCLE_ANNOTATION = /CONSTRAINT-LIFECYCLE:\s*([A-Z_]+)/i;

export const CONSTRAINT_SIGNAL_RULES = Object.freeze([
  Object.freeze({
    id: 'FAIL_CLOSED_SIGNAL',
    constraintClass: 'FAIL_CLOSED',
    description: 'Explicit fail-closed language can encode a durable invariant or an obsolete blanket stop.',
    test: ({ context }) => /\bfail(?:s|ed|ing)?\s+closed\b/i.test(context),
  }),
  Object.freeze({
    id: 'MANUAL_DISPATCH_SIGNAL',
    constraintClass: 'MANUAL_DISPATCH',
    description: 'Manual-dispatch states can outlive the execution model that originally required them.',
    test: ({ context }) => /WAITING_OPERATOR_APPROVAL|READY_FOR_MANUAL_DISPATCH|\bmanual(?:ly)?[- ]dispatch/i.test(context),
  }),
  Object.freeze({
    id: 'MUTATION_DEFAULT_DENY_SIGNAL',
    constraintClass: 'MUTATION_DEFAULT_DENY',
    description: 'Default-deny mutation/write/dispatch flags need an explicit promotion or revalidation path.',
    test: ({ context }) => /\b(?:durableWriteAllowed|mutationAllowed|codexAutoDispatchAllowed|automaticCodexLaunchAllowed)\s*:\s*false\b|\bopenClawMutationLocked\s*:\s*true\b/i.test(context),
  }),
  Object.freeze({
    id: 'PROVIDER_ADMISSION_DENY_SIGNAL',
    constraintClass: 'PROVIDER_ADMISSION_DENY',
    description: 'Qualification that can never flow into provider-pool admission may leave proven capability permanently unusable.',
    test: ({ context }) => /\b(?:providerPoolAdmissionAllowed|providerQualificationAuthority)\s*:\s*false\b/i.test(context),
  }),
  Object.freeze({
    id: 'RESTART_INTENT_ONLY_SIGNAL',
    constraintClass: 'DIAGNOSE_BUT_DO_NOT_ACT',
    description: 'Restart-intent-only recovery can fossilise into diagnosis without bounded remediation.',
    test: ({ context }) => /restart[- ]intent[- ]only|restart intent only|never stores commands/i.test(context),
  }),
  Object.freeze({
    id: 'PROVIDER_QUALIFICATION_EXPIRY_SIGNAL',
    constraintClass: 'FRESHNESS_OR_EXPIRY',
    description: 'Provider qualification/capacity expiry needs an automatic renewal or explicit requalification path.',
    test: ({ context }) => /(?:openclaw|provider|qualification|capacity)/i.test(context)
      && /expiresAtUtc|MAX_(?:RECEIPT_LIFETIME|QUALIFICATION_LAG)/.test(context),
  }),
  Object.freeze({
    id: 'WAITING_OPERATOR_OR_SAFE_HOLD_SIGNAL',
    constraintClass: 'BLOCKED_STATE',
    description: 'Operator-wait and safe-hold states should identify the exact live failed predicate.',
    test: ({ context }) => /WAITING_FOR_OPERATOR|OPERATOR_APPROVAL_REQUIRED|SAFE_HOLD/.test(context),
  }),
]);

function normalizeString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizePath(value) {
  return normalizeString(value).replaceAll('\\', '/');
}

export function extractConstraintLifecycleAnnotation(context) {
  const match = normalizeString(context).match(LIFECYCLE_ANNOTATION);
  if (!match) return null;
  const state = match[1].toUpperCase();
  return LIFECYCLE_STATE_SET.has(state) ? state : 'UNKNOWN_REQUIRES_RECONSTRUCTION';
}

export function classifyConstraintCandidate(input = {}) {
  const file = normalizePath(input.file);
  const line = Number.isSafeInteger(input.line) && input.line > 0 ? input.line : 0;
  const excerpt = normalizeString(input.excerpt).trim();
  const context = normalizeString(input.context || excerpt);
  const lifecycleState = extractConstraintLifecycleAnnotation(context);
  const findings = [];

  for (const rule of CONSTRAINT_SIGNAL_RULES) {
    if (!rule.test({ file, line, excerpt, context })) continue;
    findings.push(Object.freeze({
      signalId: rule.id,
      constraintClass: rule.constraintClass,
      description: rule.description,
      file,
      line,
      excerpt: excerpt.slice(0, 320),
      lifecycleState,
      needsLifecycleReview: lifecycleState === null || lifecycleState === 'UNKNOWN_REQUIRES_RECONSTRUCTION',
    }));
  }

  return Object.freeze(findings);
}

function summarizeBy(findings, key) {
  const counts = new Map();
  for (const finding of findings) {
    const value = finding[key] || 'UNKNOWN';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Object.freeze(Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))));
}

export function buildConstraintLifecycleAudit(findings = [], options = {}) {
  const normalized = [...findings].sort((a, b) => (
    a.file.localeCompare(b.file)
      || a.line - b.line
      || a.signalId.localeCompare(b.signalId)
  ));
  const generatedAt = normalizeString(options.generatedAt) || new Date().toISOString();
  const unclassifiedCount = normalized.filter((finding) => finding.needsLifecycleReview).length;

  return Object.freeze({
    schemaVersion: CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA,
    generatedAt,
    findingCount: normalized.length,
    unclassifiedCount,
    lifecycleDeclaredCount: normalized.length - unclassifiedCount,
    byConstraintClass: summarizeBy(normalized, 'constraintClass'),
    bySignal: summarizeBy(normalized, 'signalId'),
    findings: Object.freeze(normalized),
  });
}
