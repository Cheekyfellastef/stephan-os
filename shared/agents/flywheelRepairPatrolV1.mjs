import { createHash } from 'node:crypto';

import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from './constraintLifecycleAuditV1.mjs';

export const FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION = 'stephanos.flywheel-repair-patrol.v1';
export const FLYWHEEL_REPAIR_PATROL_OWNER = '#1903';
export const FLYWHEEL_REPAIR_PATROL_INTERVAL_MS = 15 * 60_000;

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  schedulerMutationAllowed: false,
  goalCreationAllowed: false,
  dispatchAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  authorityWideningAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeFinding(finding = {}) {
  if (finding.constraintClass !== 'FLYWHEEL_CONTINUITY') return null;
  const file = text(finding.file).replaceAll('\\', '/');
  const signalId = text(finding.signalId);
  const description = text(finding.description);
  const excerpt = text(finding.excerpt);
  const line = Number.isSafeInteger(finding.line) && finding.line > 0 ? finding.line : 1;
  if (!file || !signalId) return null;
  const findingId = `flywheel-continuity-${hash([file, line, signalId]).slice(0, 24)}`;
  return Object.freeze({
    findingId,
    signalId,
    constraintClass: 'FLYWHEEL_CONTINUITY',
    file,
    line,
    description,
    excerpt,
    lifecycleState: finding.lifecycleState || null,
    needsLifecycleReview: finding.needsLifecycleReview !== false,
  });
}

function normalizeFindings(audit) {
  return Object.freeze((Array.isArray(audit?.findings) ? audit.findings : [])
    .map(safeFinding)
    .filter(Boolean)
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.findingId.localeCompare(right.findingId)));
}

function previousFingerprint(previousStatus = {}) {
  const value = text(previousStatus?.findingFingerprint);
  return /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : '';
}

export function projectFlywheelRepairPatrolV1(input = {}) {
  const audit = input.audit;
  if (!audit || audit.schemaVersion !== CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA) {
    return Object.freeze({
      schemaVersion: FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION,
      valid: false,
      state: 'BLOCKED',
      blocker: 'CONSTRAINT_LIFECYCLE_AUDIT_REQUIRED',
      findings: Object.freeze([]),
      findingFingerprint: '',
      changed: false,
      continuation: null,
      authority: AUTHORITY,
    });
  }

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.parse(audit.generatedAt);
  const generatedAtUtc = Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : audit.generatedAt;
  const findings = normalizeFindings(audit);
  const findingFingerprint = hash(findings.map((finding) => [
    finding.findingId,
    finding.file,
    finding.line,
    finding.signalId,
  ]));
  const priorFingerprint = previousFingerprint(input.previousStatus);
  const previousKnown = Boolean(priorFingerprint);
  const changed = previousKnown ? findingFingerprint !== priorFingerprint : findings.length > 0;
  const state = findings.length ? 'REPAIR_REQUIRED' : 'HEALTHY';
  const previousHadFindings = Number(input.previousStatus?.findingCount || 0) > 0;
  const continuation = changed
    ? Object.freeze(findings.length
      ? {
        kind: 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED',
        canonicalOwner: FLYWHEEL_REPAIR_PATROL_OWNER,
        ownerResolutionRequired: true,
        nextAction: 'RESOLVE_EXISTING_COMPONENT_OWNER_AND_ROUTE_GOVERNED_REPAIR',
        findingIds: Object.freeze(findings.map((finding) => finding.findingId)),
      }
      : {
        kind: 'FLYWHEEL_CONTINUITY_RECOVERED',
        canonicalOwner: FLYWHEEL_REPAIR_PATROL_OWNER,
        ownerResolutionRequired: false,
        nextAction: previousHadFindings
          ? 'CAPTURE_PROVEN_REPAIR_LESSON_AND_REARM_PATROL'
          : 'REARM_PATROL',
        findingIds: Object.freeze([]),
      })
    : null;

  return Object.freeze({
    schemaVersion: FLYWHEEL_REPAIR_PATROL_SCHEMA_VERSION,
    valid: true,
    state,
    blocker: '',
    generatedAtUtc,
    nextDueUtc: new Date(Date.parse(generatedAtUtc) + FLYWHEEL_REPAIR_PATROL_INTERVAL_MS).toISOString(),
    findingCount: findings.length,
    findings,
    findingFingerprint,
    changed,
    continuation,
    broadAuditFindingCount: Number(audit.findingCount || 0),
    broadAuditUnclassifiedCount: Number(audit.unclassifiedCount || 0),
    authority: AUTHORITY,
  });
}
