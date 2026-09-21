import { createHash } from 'node:crypto';

import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from './constraintLifecycleAuditV1.mjs';

export const CAPABILITY_GAP_SCOUT_SCHEMA_VERSION = 'stephanos.capability-gap-scout.v1';
export const CAPABILITY_GAP_SCOUT_OWNER = '#1903';
export const CAPABILITY_GAP_SCOUT_GAP_INTAKE_OWNER = '#1721';
export const CAPABILITY_GAP_SCOUT_FLYWHEEL_OWNER = '#1607';

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

const GAP_FIELDS = Object.freeze([
  'capabilityGap',
  'capabilityGaps',
  'candidateCapabilityGap',
  'candidateCapabilityGaps',
  'possibleCapabilityGap',
]);
const GOAL_REF = /^#[1-9][0-9]{0,9}$/;
const MAX_GAPS = 48;
const MAX_SUMMARY = 480;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function boundedText(value, fallback = '') {
  return text(value, fallback).slice(0, MAX_SUMMARY);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function goalRef(value) {
  const normalized = text(value);
  return GOAL_REF.test(normalized) ? normalized : '';
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function structuredGapValues(record = {}) {
  const values = [];
  for (const field of GAP_FIELDS) for (const candidate of list(record?.[field])) values.push({ field, candidate });
  if (typeof record?.body === 'string' && record.body.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(record.body);
      for (const field of GAP_FIELDS) for (const candidate of list(parsed?.[field])) values.push({ field: `body.${field}`, candidate });
    } catch {}
  }
  return values;
}

function normalizeStructuredCandidate(candidate, context = {}) {
  if (typeof candidate === 'string') {
    const summary = boundedText(candidate);
    return summary ? { summary, canonicalOwner: goalRef(context.canonicalOwner), downstreamOwner: goalRef(context.downstreamOwner), evidenceRefs: [] } : null;
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const summary = boundedText(candidate.summary || candidate.description || candidate.title || candidate.gap);
  if (!summary) return null;
  return {
    summary,
    canonicalOwner: goalRef(candidate.canonicalOwner || candidate.owner || context.canonicalOwner),
    downstreamOwner: goalRef(candidate.downstreamOwner || context.downstreamOwner),
    evidenceRefs: list(candidate.proofRefs || candidate.evidenceRefs).map((item) => boundedText(item)).filter(Boolean).slice(0, 8),
  };
}

function candidateRecord(input = {}) {
  const gapClass = text(input.gapClass, 'CAPABILITY_GAP');
  const source = boundedText(input.source, 'unknown');
  const summary = boundedText(input.summary);
  if (!summary) return null;
  const canonicalOwner = goalRef(input.canonicalOwner);
  const downstreamOwner = goalRef(input.downstreamOwner);
  const ownerResolutionRequired = !canonicalOwner;
  const evidenceRefs = list(input.evidenceRefs).map((item) => boundedText(item)).filter(Boolean).slice(0, 8);
  const gapId = `cap-gap-${hash([gapClass, source, summary, canonicalOwner, downstreamOwner]).slice(0, 24)}`;
  return Object.freeze({ gapId, gapClass, source, summary, canonicalOwner, downstreamOwner, ownerResolutionRequired, evidenceRefs: Object.freeze(evidenceRefs) });
}

function workspaceRecords(feed) {
  const records = feed?.records || {};
  return [
    ...(Array.isArray(records.goalRecords) ? records.goalRecords : []),
    ...(Array.isArray(records.statusRecords) ? records.statusRecords : []),
    ...(Array.isArray(records.proofRecords) ? records.proofRecords : []),
    ...(Array.isArray(records.capabilityRecords) ? records.capabilityRecords : []),
    ...(Array.isArray(records.eventRecords) ? records.eventRecords : []),
    ...(Array.isArray(records.receiptRecords) ? records.receiptRecords : []),
  ];
}

function fromWorkspace(feed) {
  const out = [];
  for (const record of workspaceRecords(feed)) {
    const context = { canonicalOwner: record?.relatedIssue || record?.goalId, downstreamOwner: record?.downstreamOwner };
    for (const { field, candidate } of structuredGapValues(record)) {
      const normalized = normalizeStructuredCandidate(candidate, context);
      if (!normalized) continue;
      const recordId = text(record.recordId || record.statusId || record.goalId || record.proofId || record.eventId || record.receiptId, 'workspace-record');
      const projected = candidateRecord({ gapClass: 'STRUCTURED_CAPABILITY_GAP', source: `shared-workspace:${recordId}:${field}`, ...normalized });
      if (projected) out.push(projected);
    }
  }
  return out;
}

function fromSurfaceObservation(surface = {}) {
  const out = [];
  if (surface.tilePresent === false) out.push(candidateRecord({
    gapClass: 'FLYWHEEL_OPERATOR_SURFACE_GAP',
    source: 'apps/flywheel',
    summary: 'The Flywheel landing-page tile is not present in the canonical app registry.',
    canonicalOwner: CAPABILITY_GAP_SCOUT_FLYWHEEL_OWNER,
    downstreamOwner: CAPABILITY_GAP_SCOUT_OWNER,
    evidenceRefs: ['apps/index.json', 'apps/flywheel/app.json'],
  }));
  if (surface.sharedWorkspaceConnected === false) out.push(candidateRecord({
    gapClass: 'FLYWHEEL_OPERATOR_SURFACE_GAP',
    source: 'apps/flywheel:index.html',
    summary: 'The Flywheel operator surface is not proven to read the canonical Shared Workspace flywheel and scout status records.',
    canonicalOwner: CAPABILITY_GAP_SCOUT_FLYWHEEL_OWNER,
    downstreamOwner: CAPABILITY_GAP_SCOUT_OWNER,
    evidenceRefs: ['apps/flywheel/index.html', 'stephanos-server/services/sharedWorkspaceDashboardFeedService.js'],
  }));
  return out.filter(Boolean);
}

function coverageProjection({ audit, workspaceFeed, surfaceObservation, observedChannels = {} }) {
  const channels = Object.freeze({
    continuityAudit: Boolean(audit?.schemaVersion === CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA),
    sharedWorkspace: Boolean(workspaceFeed && !['error', 'unavailable'].includes(workspaceFeed.state)),
    operatorSurface: Boolean(surfaceObservation?.tilePresent && surfaceObservation?.sharedWorkspaceConnected),
    conversationGapStream: observedChannels.conversationGapStream === true,
    researchGapStream: observedChannels.researchGapStream === true,
    missionBlockerStream: observedChannels.missionBlockerStream === true,
  });
  const missingChannels = Object.freeze(Object.entries(channels).filter(([, seen]) => !seen).map(([name]) => name));
  const observedCount = Object.values(channels).filter(Boolean).length;
  const totalCount = Object.keys(channels).length;
  return Object.freeze({ channels, observedCount, totalCount, coveragePercent: Math.round((observedCount / totalCount) * 100), missingChannels });
}

function selfImprovementOpportunities(coverage, input = {}) {
  const opportunities = [];
  if (coverage.missingChannels.length) opportunities.push(Object.freeze({
    opportunityId: 'expand-gap-observation-coverage',
    kind: 'SCOUT_COVERAGE_IMPROVEMENT',
    summary: `Expand Capability Gap Scout evidence coverage to: ${coverage.missingChannels.join(', ')}.`,
    routedAsRepair: false,
  }));
  if (input.reactiveWakeupProven !== true) opportunities.push(Object.freeze({
    opportunityId: 'reactive-flywheel-wakeup',
    kind: 'FLYWHEEL_SPEED_IMPROVEMENT',
    summary: 'Prove an event-driven flywheel wake-up path while retaining the scheduled patrol as a watchdog.',
    routedAsRepair: false,
  }));
  return Object.freeze(opportunities);
}

function continuityFindingCount(audit) {
  if (!audit || audit.schemaVersion !== CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA) return 0;
  return (Array.isArray(audit.findings) ? audit.findings : []).filter((finding) => finding?.constraintClass === 'FLYWHEEL_CONTINUITY').length;
}

export function projectCapabilityGapScoutV1(input = {}) {
  const audit = input.audit;
  const workspaceFeed = input.workspaceFeed || null;
  const surfaceObservation = input.surfaceObservation || {};
  const coverage = coverageProjection({ audit, workspaceFeed, surfaceObservation, observedChannels: input.observedChannels || {} });
  const candidates = [...fromWorkspace(workspaceFeed), ...fromSurfaceObservation(surfaceObservation)];
  const byId = new Map();
  for (const candidate of candidates) if (candidate && !byId.has(candidate.gapId)) byId.set(candidate.gapId, candidate);
  const gaps = Object.freeze([...byId.values()].sort((a, b) => a.gapClass.localeCompare(b.gapClass) || a.source.localeCompare(b.source) || a.gapId.localeCompare(b.gapId)).slice(0, MAX_GAPS));
  const gapFingerprint = hash(gaps.map(({ gapId, canonicalOwner, downstreamOwner, ownerResolutionRequired }) => [gapId, canonicalOwner, downstreamOwner, ownerResolutionRequired]));
  const previousFingerprint = /^[0-9a-f]{64}$/i.test(text(input.previousStatus?.gapFingerprint)) ? text(input.previousStatus.gapFingerprint).toLowerCase() : '';
  const changed = previousFingerprint ? previousFingerprint !== gapFingerprint : gaps.length > 0;
  const unresolvedOwnerCount = gaps.filter((gap) => gap.ownerResolutionRequired).length;
  const opportunities = selfImprovementOpportunities(coverage, input);
  const state = gaps.length ? 'GAPS_FOUND' : coverage.missingChannels.length ? 'WATCHING_WITH_COVERAGE_GAPS' : 'WATCHING';
  const operatorMessage = gaps.length
    ? `${gaps.length} evidence-backed capability gap${gaps.length === 1 ? '' : 's'} found; ${unresolvedOwnerCount} still need owner resolution.`
    : coverage.missingChannels.length
      ? `No evidence-backed capability gaps are open, but the scout is not yet observing ${coverage.missingChannels.length} channel${coverage.missingChannels.length === 1 ? '' : 's'}.`
      : 'No evidence-backed capability gaps are open across the currently observed channels.';

  return Object.freeze({
    schemaVersion: CAPABILITY_GAP_SCOUT_SCHEMA_VERSION,
    valid: true,
    state,
    generatedAtUtc: text(input.generatedAtUtc, new Date(Number.isFinite(input.nowMs) ? input.nowMs : Date.now()).toISOString()),
    gapCount: gaps.length,
    unresolvedOwnerCount,
    continuityFindingCount: continuityFindingCount(audit),
    gaps,
    gapFingerprint,
    changed,
    coverage,
    selfImprovementOpportunities: opportunities,
    operatorMessage,
    authority: AUTHORITY,
  });
}
