import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FLYWHEEL_REPAIR_PATROL_OWNER,
  projectFlywheelRepairPatrolV1,
} from './flywheelRepairPatrolV1.mjs';
import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from './constraintLifecycleAuditV1.mjs';

const NOW = Date.parse('2026-09-20T12:45:00.000Z');

function finding(overrides = {}) {
  return {
    signalId: 'ORPHAN_FLYWHEEL_ENDPOINT_SIGNAL',
    constraintClass: 'FLYWHEEL_CONTINUITY',
    description: 'Flywheel-facing module has no production consumer.',
    file: 'shared/agents/exampleFlywheelV1.mjs',
    line: 1,
    excerpt: 'No production consumer imports exampleFlywheelV1.mjs.',
    lifecycleState: null,
    needsLifecycleReview: true,
    ...overrides,
  };
}

function audit(findings = []) {
  return {
    schemaVersion: CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA,
    generatedAt: new Date(NOW).toISOString(),
    findingCount: findings.length,
    unclassifiedCount: findings.filter((item) => item.needsLifecycleReview !== false).length,
    lifecycleDeclaredCount: 0,
    byConstraintClass: {},
    bySignal: {},
    findings,
  };
}

test('patrol promotes only flywheel continuity findings and leaves broad constraint findings as audit evidence', () => {
  const result = projectFlywheelRepairPatrolV1({
    audit: audit([
      finding(),
      finding({
        signalId: 'FAIL_CLOSED_SIGNAL',
        constraintClass: 'FAIL_CLOSED',
        file: 'shared/agents/safetyBoundary.mjs',
      }),
    ]),
    nowMs: NOW,
  });

  assert.equal(result.valid, true);
  assert.equal(result.state, 'REPAIR_REQUIRED');
  assert.equal(result.findingCount, 1);
  assert.equal(result.broadAuditFindingCount, 2);
  assert.equal(result.findings[0].constraintClass, 'FLYWHEEL_CONTINUITY');
  assert.equal(result.continuation.kind, 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED');
  assert.equal(result.continuation.canonicalOwner, FLYWHEEL_REPAIR_PATROL_OWNER);
  assert.equal(result.continuation.nextAction, 'RESOLVE_EXISTING_COMPONENT_OWNER_AND_ROUTE_GOVERNED_REPAIR');
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
});

test('same continuity finding fingerprint does not emit duplicate repair continuation', () => {
  const first = projectFlywheelRepairPatrolV1({ audit: audit([finding()]), nowMs: NOW });
  const second = projectFlywheelRepairPatrolV1({
    audit: audit([finding()]),
    previousStatus: {
      findingFingerprint: first.findingFingerprint,
      findingCount: first.findingCount,
    },
    nowMs: NOW + 15 * 60_000,
  });

  assert.equal(second.state, 'REPAIR_REQUIRED');
  assert.equal(second.changed, false);
  assert.equal(second.continuation, null);
  assert.equal(second.findingFingerprint, first.findingFingerprint);
  assert.deepEqual(second.findings.map((item) => item.findingId), first.findings.map((item) => item.findingId));
});

test('clearing a previously detected orphan emits a recovery teaching continuation', () => {
  const first = projectFlywheelRepairPatrolV1({ audit: audit([finding()]), nowMs: NOW });
  const recovered = projectFlywheelRepairPatrolV1({
    audit: audit([]),
    previousStatus: {
      findingFingerprint: first.findingFingerprint,
      findingCount: 1,
    },
    nowMs: NOW + 15 * 60_000,
  });

  assert.equal(recovered.state, 'HEALTHY');
  assert.equal(recovered.changed, true);
  assert.equal(recovered.continuation.kind, 'FLYWHEEL_CONTINUITY_RECOVERED');
  assert.equal(recovered.continuation.nextAction, 'CAPTURE_PROVEN_REPAIR_LESSON_AND_REARM_PATROL');
  assert.equal(recovered.continuation.canonicalOwner, FLYWHEEL_REPAIR_PATROL_OWNER);
});

test('healthy first patrol establishes baseline without creating notification work', () => {
  const result = projectFlywheelRepairPatrolV1({ audit: audit([]), nowMs: NOW });
  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.changed, false);
  assert.equal(result.continuation, null);
  assert.equal(result.findingCount, 0);
});

test('invalid audit cannot be promoted into repair work', () => {
  const result = projectFlywheelRepairPatrolV1({ audit: { findings: [finding()] }, nowMs: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.continuation, null);
  assert.equal(result.authority.dispatchAllowed, false);
});
