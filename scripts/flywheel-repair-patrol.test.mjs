import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runFlywheelRepairPatrol } from './flywheel-repair-patrol.mjs';
import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from '../shared/agents/constraintLifecycleAuditV1.mjs';

const NOW = Date.parse('2026-09-20T12:45:00.000Z');

function orphan() {
  return {
    signalId: 'ORPHAN_FLYWHEEL_ENDPOINT_SIGNAL',
    constraintClass: 'FLYWHEEL_CONTINUITY',
    description: 'Flywheel-facing module has no production consumer.',
    file: 'shared/agents/exampleFlywheelV1.mjs',
    line: 1,
    excerpt: 'No production consumer imports exampleFlywheelV1.mjs.',
    lifecycleState: null,
    needsLifecycleReview: true,
  };
}

function audit(findings, generatedAt) {
  return {
    schemaVersion: CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA,
    generatedAt,
    findingCount: findings.length,
    unclassifiedCount: findings.length,
    lifecycleDeclaredCount: 0,
    byConstraintClass: {},
    bySignal: {},
    findings,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flywheel-repair-patrol-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(repoRoot, { recursive: true });
  return { repoRoot, workspaceRoot };
}

async function handoffFiles(workspaceRoot) {
  try {
    return (await readdir(path.join(workspaceRoot, 'handoffs'))).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

test('patrol persists changed orphan findings, rate-limits scans, dedupes stable findings, and emits recovery teaching handoff', async () => {
  const { repoRoot, workspaceRoot } = await fixture();
  let findings = [orphan()];
  let auditCalls = 0;
  const runConstraintLifecycleAuditImpl = async ({ generatedAt }) => {
    auditCalls += 1;
    return audit(findings, generatedAt);
  };

  const first = await runFlywheelRepairPatrol({
    repoRoot,
    workspaceRoot,
    nowMs: NOW,
    runConstraintLifecycleAuditImpl,
  });
  assert.equal(first.ok, true);
  assert.equal(first.state, 'REPAIR_REQUIRED');
  assert.equal(first.changed, true);
  assert.equal(first.findingCount, 1);
  assert.ok(first.handoffId.startsWith('flywheel-repair-'));
  assert.equal(auditCalls, 1);

  const firstHandoff = JSON.parse(await readFile(path.join(workspaceRoot, 'handoffs', `${first.handoffId}.json`), 'utf8'));
  const firstBody = JSON.parse(firstHandoff.body);
  assert.equal(firstHandoff.toParticipantId, 'mission-orchestrator');
  assert.equal(firstHandoff.relatedIssue, '#1903');
  assert.equal(firstBody.continuation.kind, 'FLYWHEEL_CONTINUITY_REPAIR_REQUIRED');
  assert.equal(firstBody.constraints.existingOwnerFirst, true);
  assert.equal(firstBody.constraints.sourceMutationAllowed, false);
  assert.equal(firstBody.constraints.mergeAuthority, false);

  const early = await runFlywheelRepairPatrol({
    repoRoot,
    workspaceRoot,
    nowMs: NOW + 60_000,
    runConstraintLifecycleAuditImpl,
  });
  assert.equal(early.ok, true);
  assert.equal(early.skipped, true);
  assert.equal(early.reason, 'FLYWHEEL_REPAIR_PATROL_NOT_DUE');
  assert.equal(auditCalls, 1);
  assert.equal((await handoffFiles(workspaceRoot)).length, 1);

  const stable = await runFlywheelRepairPatrol({
    repoRoot,
    workspaceRoot,
    nowMs: NOW + 15 * 60_000,
    runConstraintLifecycleAuditImpl,
  });
  assert.equal(stable.ok, true);
  assert.equal(stable.state, 'REPAIR_REQUIRED');
  assert.equal(stable.changed, false);
  assert.equal(stable.handoffId, '');
  assert.equal(auditCalls, 2);
  assert.equal((await handoffFiles(workspaceRoot)).length, 1);

  findings = [];
  const recovered = await runFlywheelRepairPatrol({
    repoRoot,
    workspaceRoot,
    nowMs: NOW + 30 * 60_000,
    runConstraintLifecycleAuditImpl,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.state, 'HEALTHY');
  assert.equal(recovered.changed, true);
  assert.ok(recovered.handoffId.startsWith('flywheel-repair-'));
  assert.equal(auditCalls, 3);
  assert.equal((await handoffFiles(workspaceRoot)).length, 2);

  const recoveryHandoff = JSON.parse(await readFile(path.join(workspaceRoot, 'handoffs', `${recovered.handoffId}.json`), 'utf8'));
  const recoveryBody = JSON.parse(recoveryHandoff.body);
  assert.equal(recoveryBody.continuation.kind, 'FLYWHEEL_CONTINUITY_RECOVERED');
  assert.equal(recoveryBody.continuation.nextAction, 'CAPTURE_PROVEN_REPAIR_LESSON_AND_REARM_PATROL');
});

test('healthy bootstrap writes patrol truth without generating a repair handoff', async () => {
  const { repoRoot, workspaceRoot } = await fixture();
  const result = await runFlywheelRepairPatrol({
    repoRoot,
    workspaceRoot,
    nowMs: NOW,
    runConstraintLifecycleAuditImpl: async ({ generatedAt }) => audit([], generatedAt),
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'HEALTHY');
  assert.equal(result.changed, false);
  assert.equal(result.handoffId, '');
  assert.equal((await handoffFiles(workspaceRoot)).length, 0);
  const status = JSON.parse(await readFile(path.join(workspaceRoot, 'status', 'flywheel-repair-patrol-current.json'), 'utf8'));
  assert.equal(status.healthState, 'HEALTHY');
  assert.equal(status.findingCount, 0);
  assert.equal(status.patrolAuthority.sourceMutationAllowed, false);
  assert.equal(status.patrolAuthority.mergeAllowed, false);
});
