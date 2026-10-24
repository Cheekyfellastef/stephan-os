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

test('canonical parity reconcile persists proposed Skill Forge recipes without starting a builder', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-skill-conjurer-'));
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot: 'C:/repo' },
    now: new Date('2026-10-12T11:12:00.000Z'),
    readQueue: async () => [{
      adapter: 'desktop-commander-direct',
      item: {
        missionId: 'critical-2573-skill-conjurer',
        actionId: 'process-gap-1',
        actionGrant: { operation: 'start-process' },
      },
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.buildableGapCount, 1);
  assert.equal(result.capabilityCompiler.skillForgeCandidateCount, 1);
  const proposal = result.capabilityCompiler.skillForgeCandidates[0];
  assert.equal(proposal.status, 'DRAFT');
  assert.equal(proposal.activationAllowed, false);
  assert.equal(proposal.constructionAdmissionAllowed, false);
  assert.equal(result.duplicateGoalCreationAllowed, false);
  const persisted = JSON.parse(await readFile(
    join(workspaceRoot, 'status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`),
    'utf8',
  ));
  assert.equal(persisted.capabilityCompiler.skillForgeCandidates.length, 1);
  assert.equal(persisted.capabilityCompiler.skillForgeCandidates[0].id, proposal.id);
  assert.equal(persisted.capabilityCompiler.skillForgeActivationAllowed, false);
  assert.equal(persisted.capabilityCompiler.automaticCapabilityConstructionAllowed, false);
  assert.equal(persisted.mergeAuthority, false);
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


test('Sovereign native self-gap events create guarded skill drafts but do not self-authorise', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-native-gap-'));
  const { createSharedWorkspaceEventRecord } = await import('../shared/agents/sharedAgentWorkspaceStore.mjs');
  const event = createSharedWorkspaceEventRecord({
    eventId: 'sovereign-native-capability-gap',
    participantId: 'sovereign-commander',
    timestampUtc: '2026-10-12T11:00:00.000Z',
    eventKind: 'capability-gap',
    summary: 'Missing bounded service ownership diagnosis.',
    capabilityFailure: {
      failureClass: 'CAPABILITY_GAP', genuineCapabilityFailure: true,
      capabilityId: 'windows-service-ownership',
      targetRefs: ['goal:#2573'],
    },
  });
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot: 'C:/repo' },
    now: new Date('2026-10-12T11:20:00.000Z'),
    readQueue: async () => [],
    readNativeEvents: async () => ({ records: [event], errors: [] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.parityPresentCount, 0);
  assert.equal(result.buildableGapCount, 0, 'remote parity is unchanged');
  assert.equal(result.capabilityCompiler.nativeGapCandidateCount, 1);
  assert.equal(result.nativeGapSourceHealth, 'VALIDATED');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_NATIVE_CAPABILITY_GAPS_TRACKED');
  const status = JSON.parse(await readFile(
    join(workspaceRoot, 'status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`), 'utf8',
  ));
  assert.equal(status.nativeGapIntake.candidateCount, 1);
  assert.equal(status.capabilityCompiler.skillForgeCandidates[0].status, 'DRAFT');
  assert.equal(status.capabilityCompiler.automaticCapabilityConstructionAllowed, false);
  assert.equal(status.mergeAuthority, false);
});

test('retains native gap across aged event and degraded feed using the same status record', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-sticky-native-'));
  const { createSharedWorkspaceEventRecord } = await import('../shared/agents/sharedAgentWorkspaceStore.mjs');
  const event = createSharedWorkspaceEventRecord({
    eventId: 'sovereign-native-sticky-gap',
    participantId: 'sovereign-commander',
    timestampUtc: '2026-10-12T11:00:00.000Z',
    eventKind: 'capability-gap',
    capabilityFailure: { failureClass: 'CAPABILITY_GAP', genuineCapabilityFailure: true,
      capabilityId: 'windows-service-ownership', targetRefs: ['goal:#2573'] },
  });
  const args = {
    paths: { workspaceRoot, repoRoot: 'C:/repo' },
    readQueue: async () => [],
  };
  const first = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-12T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: [event], errors: [] }),
  });
  assert.equal(first.capabilityCompiler.nativeGapCandidateCount, 1);
  const aged = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-22T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: [event], errors: [] }),
  });
  assert.equal(aged.capabilityCompiler.nativeGapCandidateCount, 1);
  assert.equal(aged.finalVerdict, 'SOVEREIGN_COMMANDER_NATIVE_CAPABILITY_GAPS_TRACKED');
  const degraded = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-22T12:20:00.000Z'),
    readNativeEvents: async () => ({ records: [], errors: ['EVENT_STORE_UNAVAILABLE'] }),
  });
  assert.equal(degraded.ok, true);
  assert.equal(degraded.nativeGapSourceHealth, 'DEGRADED');
  assert.equal(degraded.capabilityCompiler.nativeGapCandidateCount, 1);
  assert.equal(degraded.finalVerdict, 'SOVEREIGN_COMMANDER_NATIVE_GAP_INTAKE_DEGRADED');
  assert.equal(degraded.mergeAuthority, false);
  assert.equal(degraded.runtimeMutationAuthority, false);
});

test('invalid native event feed degrades intake but preserves canonical remote parity', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-native-invalid-'));
  const result = await reconcileSovereignCommanderCapabilityParity({
    paths: { workspaceRoot, repoRoot: 'C:/repo' },
    now: new Date('2026-10-12T11:20:00.000Z'),
    readQueue: async () => [{
      adapter: 'desktop-commander', item: { actionGrant: { operation: 'read-file' } },
    }],
    readNativeEvents: async () => ({ records: [{ capabilityId: 'untrusted' }], errors: ['INVALID_EVENT'] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.nativeGapSourceHealth, 'DEGRADED');
  assert.equal(result.capabilityCompiler.nativeGapCandidateCount, 0);
  assert.equal(result.parityPresentCount, 1);
  const saved = JSON.parse(await readFile(
    join(workspaceRoot, 'status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`), 'utf8',
  ));
  assert.equal(saved.nativeGapIntake.sourceHealth, 'DEGRADED');
  assert.equal(saved.nativeGapIntake.sourceErrorCount, 1);
  assert.equal(saved.capabilityParity.parityPresentCount, 1);
});


test('native capability inventory survives seven-day expiry beyond two compiler slots', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-multi-native-'));
  const { createSharedWorkspaceEventRecord } = await import('../shared/agents/sharedAgentWorkspaceStore.mjs');
  const events = Array.from({ length: 5 }, (_, i) => createSharedWorkspaceEventRecord({
    eventId: `sovereign-multi-gap-${i}`, participantId: 'sovereign-commander',
    timestampUtc: '2026-10-12T11:00:00.000Z', eventKind: 'capability-gap',
    capabilityFailure: { failureClass: 'CAPABILITY_GAP', genuineCapabilityFailure: true,
      capabilityId: `missing-native-${i}`, targetRefs: ['goal:#2573'] },
  }));
  const args = { paths: { workspaceRoot, repoRoot: 'C:/repo' }, readQueue: async () => [] };
  const first = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-12T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: events, errors: [] }),
  });
  assert.equal(first.ok, true);
  assert.equal(first.nativeGapIntake.candidateTotalCount, 5);
  assert.equal(first.nativeGapIntake.retainedCount, 5);
  assert.equal(first.capabilityCompiler.nativeGapCandidateCount, 2);
  const later = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-23T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: [], errors: [] }),
  });
  assert.equal(later.nativeGapIntake.candidateTotalCount, 5);
  assert.equal(later.nativeGapIntake.retainedCount, 5);
  assert.equal(later.nativeGapSourceHealth, 'VALIDATED');
  assert.equal(later.finalVerdict, 'SOVEREIGN_COMMANDER_NATIVE_CAPABILITY_GAPS_TRACKED');
  const persisted = JSON.parse(await readFile(join(workspaceRoot, 'status',
    `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`), 'utf8'));
  assert.equal(persisted.nativeGapIntake.retainedGaps.length, 5);
  assert.equal(persisted.nativeGapIntake.gaps.length, 2);
  assert.equal(persisted.mergeAuthority, false);
});

test('native inventory overflow survives as an explicit degraded source warning', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'sovereign-native-overflow-'));
  const { createSharedWorkspaceEventRecord } = await import('../shared/agents/sharedAgentWorkspaceStore.mjs');
  const events = Array.from({ length: 129 }, (_, i) => createSharedWorkspaceEventRecord({
    eventId: `sovereign-overflow-gap-${i}`, participantId: 'sovereign-commander',
    timestampUtc: '2026-10-12T11:00:00.000Z', eventKind: 'capability-gap',
    capabilityFailure: { failureClass: 'CAPABILITY_GAP', genuineCapabilityFailure: true,
      capabilityId: `overflow-native-${String(i).padStart(3, '0')}`, targetRefs: ['goal:#2573'] },
  }));
  const args = { paths: { workspaceRoot, repoRoot: 'C:/repo' }, readQueue: async () => [] };
  const first = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-12T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: events, errors: [] }),
  });
  assert.equal(first.nativeGapSourceHealth, 'DEGRADED');
  const later = await reconcileSovereignCommanderCapabilityParity({
    ...args, now: new Date('2026-10-23T11:20:00.000Z'),
    readNativeEvents: async () => ({ records: [], errors: [] }),
  });
  assert.equal(later.nativeGapSourceHealth, 'DEGRADED');
  assert.equal(later.nativeGapIntake.retentionTruncated, false);
  const persisted = JSON.parse(await readFile(join(workspaceRoot, 'status',
    `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`), 'utf8'));
  assert.equal(persisted.nativeGapIntake.retentionTruncated, true);
});
