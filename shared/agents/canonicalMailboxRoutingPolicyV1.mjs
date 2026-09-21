import {
  CANONICAL_MAILBOX_ISSUE,
  RETIRED_CANONICAL_MAILBOX_ISSUES,
} from './canonicalMailboxAuthorityV1.mjs';

export const CANONICAL_MAILBOX_ROUTING_POLICY_SCHEMA = 'stephanos.canonical-mailbox-routing-policy.v1';
export const CANONICAL_MAILBOX_AUTHORITY_SOURCE = 'canonicalMailboxAuthorityV1.mjs';

const CANONICAL_ACTIVE_REFERENCE_BRAND = Symbol('stephanos.canonical-mailbox-active-reference.v1');

const ACTIVE_USAGE = new Set([
  'runtime-routing',
  'workflow-guard',
  'polling',
  'operator-runbook-active',
]);

const HISTORICAL_USAGE = new Set([
  'historical',
  'provenance',
  'retired-rejection-test',
]);

const positiveInteger = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
};

function result(ok, blocker, details = {}) {
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROUTING_POLICY_SCHEMA,
    ok,
    blocker,
    ...details,
  });
}

export function canonicalActiveMailboxReference(usage) {
  const normalizedUsage = String(usage || '').trim();
  if (!ACTIVE_USAGE.has(normalizedUsage)) return null;
  return Object.freeze({
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    usage: normalizedUsage,
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
    [CANONICAL_ACTIVE_REFERENCE_BRAND]: true,
  });
}

export function evaluateCanonicalMailboxReference(reference = {}) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    return result(false, 'CANONICAL_MAILBOX_REFERENCE_INVALID');
  }

  const issue = positiveInteger(reference.issueNumber);
  const normalizedUsage = String(reference.usage || '').trim();

  if (!issue) return result(false, 'CANONICAL_MAILBOX_REFERENCE_ISSUE_INVALID');
  if (!ACTIVE_USAGE.has(normalizedUsage) && !HISTORICAL_USAGE.has(normalizedUsage)) {
    return result(false, 'CANONICAL_MAILBOX_REFERENCE_USAGE_INVALID', { issueNumber: issue });
  }

  if (HISTORICAL_USAGE.has(normalizedUsage)) {
    return result(true, '', {
      issueNumber: issue,
      usage: normalizedUsage,
      activeAuthority: false,
      historicalReferenceAllowed: true,
    });
  }

  if (RETIRED_CANONICAL_MAILBOX_ISSUES.includes(issue)) {
    return result(false, 'RETIRED_MAILBOX_ACTIVE_REFERENCE_FORBIDDEN', {
      issueNumber: issue,
      usage: normalizedUsage,
    });
  }

  if (issue !== CANONICAL_MAILBOX_ISSUE) {
    return result(false, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_MISMATCH', {
      issueNumber: issue,
      expectedIssueNumber: CANONICAL_MAILBOX_ISSUE,
      usage: normalizedUsage,
    });
  }

  if (reference[CANONICAL_ACTIVE_REFERENCE_BRAND] !== true) {
    return result(false, 'CANONICAL_MAILBOX_ACTIVE_REFERENCE_NOT_DERIVED_FROM_AUTHORITY', {
      issueNumber: issue,
      usage: normalizedUsage,
      requiredAuthoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
    });
  }

  return result(true, '', {
    issueNumber: issue,
    usage: normalizedUsage,
    activeAuthority: true,
    authoritySource: CANONICAL_MAILBOX_AUTHORITY_SOURCE,
    hardCodedActiveIssueAllowed: false,
  });
}

export function auditCanonicalMailboxReferences(references) {
  if (!Array.isArray(references)) {
    const evaluation = result(false, 'CANONICAL_MAILBOX_REFERENCE_COLLECTION_INVALID');
    return Object.freeze({
      schemaVersion: CANONICAL_MAILBOX_ROUTING_POLICY_SCHEMA,
      ok: false,
      blockerCount: 1,
      blockers: Object.freeze([evaluation.blocker]),
      evaluations: Object.freeze([evaluation]),
    });
  }

  const evaluations = references.map((reference) => evaluateCanonicalMailboxReference(reference));
  const blockers = evaluations.filter((entry) => !entry.ok).map((entry) => entry.blocker);
  return Object.freeze({
    schemaVersion: CANONICAL_MAILBOX_ROUTING_POLICY_SCHEMA,
    ok: blockers.length === 0,
    blockerCount: blockers.length,
    blockers: Object.freeze(blockers),
    evaluations: Object.freeze(evaluations),
  });
}
