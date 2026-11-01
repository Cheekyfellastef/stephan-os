import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildWorkspaceIntegritySeedPressureEventV1,
  publishWorkspaceIntegritySeedPressureEventV1,
} from './workspaceIntegritySeedPressureV1.mjs';
import { reconcileFlywheelLearningGoalsV1 } from '../../stephanos-server/services/flywheelLearningGoalBridgeService.js';

const NOW = '2026-10-07T20:30:00.000Z';

function activeGrowth(overrides = {}) {
  return {
    planted: true,
    pressureState: 'ACTIVE',
    inventoryProofCount: 0,
    identityProofCount: 0,
    canonicalBindingProofCount: 0,
    contractProofCount: 0,
    hydrationProofCount: 0,
    reconciliationProofCount: 0,
    syntheticProofCount: 0,
    orphanAuditProofCount: 0,
    continuousAuditProofCount: 0,
    nextBestAction: 'Inventory every visible component.',
    ...overrides,
  };
}

test('pressure event raises only the first unproved integrity rung as an actionable capability gap', () => {
  const event = buildWorkspaceIntegritySeedPressureEventV1({
    growth: activeGrowth(),
    timestampUtc: NOW,
  });
  assert.equal(event.eventId, 'workspace-integrity-pressure-workspace-integrity-inventory-visible-components');
  assert.equal(event.missionId, 'workspace-integrity-provenance');
  assert.equal(event.workspaceIntegritySeedPressure.targetRung, 'INVENTORY_VISIBLE_COMPONENTS');
  assert.equal(event.closedLoopLearning.learningEligibleCapabilityFailure, true);
  assert.equal(event.closedLoopLearning.capabilityId, 'workspace-integrity-inventory-visible-components');
  assert.deepEqual(event.closedLoopLearning.targetRefs, ['goal:#2670']);
  assert.equal(event.workspaceIntegritySeedPressure.authorityWidened, false);
});

test('pressure advances to the next rung once inventory proof exists', () => {
  const event = buildWorkspaceIntegritySeedPressureEventV1({
    growth: activeGrowth({ inventoryProofCount: 2 }),
    timestampUtc: NOW,
  });
  assert.equal(event.workspaceIntegritySeedPressure.targetRung, 'STABLE_IDENTITIES');
  assert.equal(event.closedLoopLearning.capabilityId, 'workspace-integrity-stable-identities');
});

test('current or unplanted seed emits no capability-gap event', () => {
  assert.equal(buildWorkspaceIntegritySeedPressureEventV1({
    growth: activeGrowth({ pressureState: 'CURRENT' }),
    timestampUtc: NOW,
  }), null);
  assert.equal(buildWorkspaceIntegritySeedPressureEventV1({
    growth: activeGrowth({ planted: false }),
    timestampUtc: NOW,
  }), null);
});

test('publisher writes one stable event and repeat cycles dedupe it', async () => {
  const writes = [];
  const dashboardFeed = {
    workspaceRoot: '/workspace',
    records: { eventRecords: [] },
  };
  const workspaceView = { workspaceIntegritySeedGrowth: activeGrowth() };
  const first = await publishWorkspaceIntegritySeedPressureEventV1({
    repoRoot: '/repo',
    dashboardFeed,
    workspaceView,
    timestampUtc: NOW,
    writeRecord: async (root, segments, record) => {
      writes.push({ root, segments, record });
      return { ok: true };
    },
  });
  assert.equal(first.published, true);
  assert.equal(first.capabilityId, 'workspace-integrity-inventory-visible-components');
  assert.equal(writes.length, 1);

  const second = await publishWorkspaceIntegritySeedPressureEventV1({
    repoRoot: '/repo',
    dashboardFeed: {
      ...dashboardFeed,
      records: { eventRecords: [writes[0].record] },
    },
    workspaceView,
    timestampUtc: '2026-10-07T20:31:00.000Z',
    writeRecord: async () => {
      throw new Error('deduped event must not be rewritten');
    },
  });
  assert.equal(second.deduped, true);
  assert.equal(second.published, false);
  assert.equal(second.eventId, first.eventId);
});

test('existing Flywheel learning-goal bridge consumes the pressure event and can admit one canonical child goal', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'workspace-integrity-pressure-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  await Promise.all([mkdir(root, { recursive: true }), mkdir(repoRoot, { recursive: true })]);

  const event = buildWorkspaceIntegritySeedPressureEventV1({
    growth: activeGrowth(),
    timestampUtc: NOW,
  });
  let admissionCalls = 0;
  const result = await reconcileFlywheelLearningGoalsV1({
    root,
    repoRoot,
    nowUtc: NOW,
    canonicalGoalAdmissionAuthorized: true,
    brainDiagnosisAuthorized: false,
    readEvents: async () => ({ records: [event], errors: [] }),
    readGoalCandidates: async () => ({ receipts: [] }),
    admitCanonicalGoal: async (input) => {
      admissionCalls += 1;
      assert.equal(input.capabilityId, 'workspace-integrity-inventory-visible-components');
      return {
        ok: true,
        created: true,
        issue: { number: 3901, title: 'Inventory workspace integrity bindings' },
        schedulerGoal: { goalId: 'goal-3901' },
      };
    },
    createGoalCandidate: async () => {
      throw new Error('canonical admission should win before fallback candidate creation');
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.observedActionableEventCount, 1);
  assert.equal(result.createdCanonicalGoalCount, 1);
  assert.deepEqual(result.createdCanonicalGoalIssueNumbers, [3901]);
  assert.equal(result.attachments[0].disposition, 'CANONICAL_GOAL_CREATED_AND_ADMITTED');
  assert.equal(admissionCalls, 1);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.dispatchAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);
});
