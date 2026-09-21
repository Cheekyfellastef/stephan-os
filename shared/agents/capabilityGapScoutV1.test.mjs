import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from './constraintLifecycleAuditV1.mjs';
import { projectCapabilityGapScoutV1 } from './capabilityGapScoutV1.mjs';

const surface = { tilePresent: true, sharedWorkspaceConnected: true };
const audit = (findings = []) => ({ schemaVersion: CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA, generatedAt: '2026-09-21T18:00:00.000Z', findings });
const feed = (statusRecords = []) => ({ state: 'ready', records: { goalRecords: [], statusRecords, proofRecords: [], capabilityRecords: [], eventRecords: [], receiptRecords: [] } });

test('projects structured workspace gaps without duplicating continuity patrol routing or promoting vague prose', () => {
  const result = projectCapabilityGapScoutV1({
    audit: audit([{ constraintClass: 'FLYWHEEL_CONTINUITY', file: 'shared/agents/example.mjs', line: 7, description: 'Missing consumer.', canonicalOwner: '#1903', downstreamOwner: '#1556' }]),
    workspaceFeed: feed([
      { statusId: 'structured', capabilityGaps: [{ summary: 'A proven capability has no durable consumer.', canonicalOwner: '#1624', downstreamOwner: '#1607' }] },
      { statusId: 'prose-only', summary: 'This could probably be improved later.' },
    ]),
    surfaceObservation: surface,
    observedChannels: { conversationGapStream: true, researchGapStream: true, missionBlockerStream: true },
    reactiveWakeupProven: true,
  });
  assert.equal(result.gapCount, 1);
  assert.equal(result.continuityFindingCount, 1);
  assert.ok(result.gaps.some((gap) => gap.gapClass === 'STRUCTURED_CAPABILITY_GAP' && gap.canonicalOwner === '#1624'));
  assert.equal(result.gaps.some((gap) => gap.gapClass === 'FLYWHEEL_CONTINUITY'), false);
  assert.equal(result.coverage.coveragePercent, 100);
});

test('surface regression becomes a real gap while missing observation coverage stays advisory', () => {
  const broken = projectCapabilityGapScoutV1({ audit: audit(), workspaceFeed: feed(), surfaceObservation: { tilePresent: false, sharedWorkspaceConnected: false }, reactiveWakeupProven: true });
  assert.equal(broken.gapCount, 2);
  assert.ok(broken.gaps.every((gap) => gap.gapClass === 'FLYWHEEL_OPERATOR_SURFACE_GAP'));

  const advisory = projectCapabilityGapScoutV1({ audit: audit(), workspaceFeed: feed(), surfaceObservation: surface, reactiveWakeupProven: false });
  assert.equal(advisory.gapCount, 0);
  assert.equal(advisory.state, 'WATCHING_WITH_COVERAGE_GAPS');
  assert.ok(advisory.selfImprovementOpportunities.some((item) => item.opportunityId === 'reactive-flywheel-wakeup'));
  assert.ok(advisory.selfImprovementOpportunities.every((item) => item.routedAsRepair === false));
});

test('unchanged structured evidence fingerprint is deduped across laps', () => {
  const input = {
    audit: audit(),
    workspaceFeed: feed([{ statusId: 'structured', capabilityGap: { summary: 'Missing reusable capability.', canonicalOwner: '#1903' } }]),
    surfaceObservation: surface,
    reactiveWakeupProven: true,
  };
  const first = projectCapabilityGapScoutV1(input);
  const second = projectCapabilityGapScoutV1({ ...input, previousStatus: { gapFingerprint: first.gapFingerprint } });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
});
