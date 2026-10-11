import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID,
  reconcileSovereignCommanderCapabilityParity,
} from './sovereign-commander-capability-parity-reconcile.mjs';

test('reconcile proves source construction parity without needing Remote Commander health', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-parity-'));
  const repoRoot = 'C:/repo';
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot },
    now: new Date('2026-10-01T20:10:00.000Z'),
    readQueue: async () => [{
      adapter: 'desktop-commander',
      path: 'C:/queue/source-build.json',
      item: {
        missionId: 'critical-2573-parity',
        actionId: 'source-build-1',
        actionGrant: { operation: 'source-construction' },
      },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.canonicalOwnerGoal, '#2573');
  assert.equal(result.buildableGapCount, 0);
  assert.equal(result.parityPresentCount, 1);
  assert.equal(result.capabilityCompiler.buildableCapabilityCount, 0);
  assert.equal(result.capabilityCompiler.flywheelExam.length, 10);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.meterDependencyAccepted, false);

  const persisted = JSON.parse(await readFile(
    join(workspaceRoot, 'status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`),
    'utf8',
  ));
  assert.equal(persisted.kind, 'stephanos.shared_workspace.status');
  assert.equal(persisted.relatedIssue, '#2573');
  assert.equal(persisted.capabilityParity.buildableGapCount, 0);
  assert.equal(persisted.capabilityParity.parityPresentCount, 1);
  assert.equal(persisted.capabilityParity.capabilities[0].capabilityId, 'source-construction');
  assert.equal(persisted.capabilityParity.capabilities[0].canonicalOwnerGoal, '#2573');
  assert.equal(persisted.capabilityParity.duplicateGoalCreationAllowed, false);
  assert.equal(persisted.capabilityCompiler.buildableCapabilityCount, 0);
  assert.equal(persisted.standingGoalMustRemainOpen, true);
});

test('proven parity transition is promoted into Flywheel learning', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-parity-learning-'));
  const repoRoot = 'C:/repo';
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot },
    now: new Date('2026-10-02T14:35:00.000Z'),
    readPrior: async () => ({
      capabilityParity: {
        capabilities: [{
          capabilityId: 'read-file',
          state: 'BUILDABLE_GAP',
          sovereignEquivalent: 'sovereign-read-file',
          firstSeenAtUtc: '2026-10-02T14:30:00.000Z',
          lastSeenAtUtc: '2026-10-02T14:30:00.000Z',
          observationCount: 1,
        }],
      },
    }),
    readQueue: async () => [{
      adapter: 'desktop-commander-direct',
      path: 'C:/queue/read-file.json',
      item: {
        missionId: 'critical-2573-parity',
        actionId: 'read-file-2',
        actionGrant: { operation: 'read-file' },
      },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.newlyProvenParityCount, 1);
  assert.equal(result.capabilityCompiler.newlyProvenParityCount, 1);
  assert.equal(result.flywheelEventPublications.length, 1);
  assert.equal(result.flywheelEventPublications[0].ok, true);
  assert.equal(result.flywheelLearning.ok, true);

  const lesson = JSON.parse(await readFile(
    join(workspaceRoot, 'lessons', 'sovereign-capability-read-file.json'),
    'utf8',
  ));
  assert.equal(lesson.lessonId, 'sovereign-capability-read-file');
  assert.equal(lesson.engineeringRecord.recordClass, 'REUSABLE_METHOD');
  assert.match(lesson.engineeringRecord.repairOrMethod, /read_file/);
  assert.equal(lesson.mergeAuthority, false);
  assert.equal(lesson.runtimeMutationAllowed, false);
});
