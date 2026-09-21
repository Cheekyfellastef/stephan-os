import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA } from '../shared/agents/constraintLifecycleAuditV1.mjs';
import { runCapabilityGapScout } from './capability-gap-scout.mjs';

const readyFeed = { state: 'ready', records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [], receiptRecords: [] } };

test('publishes scout status and governed handoff into Shared Workspace', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'stephanos-scout-repo-'));
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'stephanos-scout-workspace-'));
  try {
    const result = await runCapabilityGapScout({
      repoRoot,
      workspaceRoot,
      nowMs: Date.parse('2026-09-21T18:00:00.000Z'),
      timestampUtc: '2026-09-21T18:00:00.000Z',
      audit: {
        schemaVersion: CONSTRAINT_LIFECYCLE_AUDIT_SCHEMA,
        generatedAt: '2026-09-21T18:00:00.000Z',
        findings: [{ constraintClass: 'FLYWHEEL_CONTINUITY', file: 'shared/agents/example.mjs', line: 1, description: 'Missing consumer.', canonicalOwner: '#1903', downstreamOwner: '#1556' }],
      },
      readWorkspaceFeedImpl: async () => readyFeed,
      observeFlywheelOperatorSurfaceImpl: async () => ({ tilePresent: true, sharedWorkspaceConnected: true }),
      observedChannels: { conversationGapStream: true, researchGapStream: true, missionBlockerStream: true },
      reactiveWakeupProven: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.gapCount, 1);
    assert.ok(result.handoffId);

    const status = JSON.parse(await readFile(path.join(workspaceRoot, 'status', 'capability-gap-scout-current.json'), 'utf8'));
    assert.equal(status.gapCount, 1);
    assert.equal(status.coverage.coveragePercent, 100);
    assert.equal(status.scoutAuthority.goalCreationAllowed, false);

    const handoff = JSON.parse(await readFile(path.join(workspaceRoot, 'handoffs', `${result.handoffId}.json`), 'utf8'));
    const body = JSON.parse(handoff.body);
    assert.equal(handoff.toParticipantId, 'mission-orchestrator');
    assert.equal(body.nextAction, 'ROUTE_EVIDENCE_BACKED_GAPS_TO_EXISTING_OWNERS');
    assert.equal(body.constraints.authorityWideningAllowed, false);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
