import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSharedWorkspaceEventRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  readSharedWorkspaceDashboardFeed,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
} from './shared-workspace-dashboard-feed.mjs';
import {
  promoteSharedWorkspaceLearningCandidatesV1,
} from './flywheelLearningFabricV1.mjs';

const REPO_ROOT = process.cwd();
const NOW = '2026-09-27T12:00:00.000Z';

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-learning-'));
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: REPO_ROOT });
  assert.equal(layout.ok, true);
  return root;
}

function learningEvent() {
  return createSharedWorkspaceEventRecord({
    eventId: 'render-loop-incident',
    participantId: 'chatgpt',
    timestampUtc: NOW,
    eventKind: 'warning',
    summary: 'AI Chat Command Deck render loop repaired and proven.',
    learningCandidate: {
      lessonId: 'ai-chat-render-loop-prevention',
      recordKey: 'ai-chat-render-loop-prevention',
      recordClass: 'SUCCESSFUL_REPAIR',
      problemClass: 'render-loop-feedback',
      componentAndOwnerRefs: [
        'stephanos-ui/src',
        'shared/runtime/runtimeWorkGovernor.mjs',
        'stephanos-server/routes/ai.js',
      ],
      symptom: 'Command Deck, App and provider renders climbed continuously while backend memory also grew.',
      rootCause: 'Semantic no-op state churn, recursive provider-health context echo and peer heartbeat rebroadcast.',
      repairOrMethod: 'Reject unchanged state before scheduling, bound polling payloads and never rebroadcast peer heartbeats.',
      prerequisites: ['Measure the live persisted runtime surface before declaring success.'],
      forbiddenShortcuts: ['Do not treat a clean fresh browser state as proof for a persisted browser-state failure.'],
      failureModes: ['Provider-health payload recursion', 'BroadcastChannel heartbeat feedback'],
      counterexamples: ['A healthy backend-only sample can miss a persisted browser-state loop.'],
      testAndProofRefs: ['pr:#2454', 'pr:#2455', 'pr:#2458', 'pr:#2459'],
      runtimeEvidenceRefs: ['proof:persisted-profile-zero-render-delta'],
      confidenceBasis: 'Merged exact-head fixes plus persisted-profile runtime proof.',
      freshness: 'CURRENT',
      applicableDomains: ['react-ui', 'runtime-governor', 'provider-health'],
      privacyAndSensitivity: 'INTERNAL_BOUNDED',
      status: 'CURRENT',
    },
  });
}
test('structured incident promotes once into durable Shared Lesson current state', async () => {
  const root = await tempWorkspace();
  try {
    const event = learningEvent();
    const eventWrite = await writeAtomicJson(
      root,
      ['events', 'render-loop-incident.json'],
      event,
      { repoRoot: REPO_ROOT, nowMs: Date.parse(NOW) },
    );
    assert.equal(eventWrite.ok, true);
    await writeFile(
      join(root, 'receipts', 'unrelated-malformed-history.json'),
      '{"this":"receipt history must not be scanned by learning promotion"',
      'utf8',
    );

    const first = await promoteSharedWorkspaceLearningCandidatesV1({
      root,
      repoRoot: REPO_ROOT,
      nowMs: Date.parse(NOW),
    });
    assert.equal(first.ok, true);
    assert.deepEqual(first.promotedLessonIds, ['ai-chat-render-loop-prevention']);

    const second = await promoteSharedWorkspaceLearningCandidatesV1({
      root,
      repoRoot: REPO_ROOT,
      nowMs: Date.parse(NOW) + 1000,
    });
    assert.equal(second.ok, true);
    assert.deepEqual(second.promotedLessonIds, []);
    assert.deepEqual(second.skippedLessonIds, ['ai-chat-render-loop-prevention']);
    const current = await readSharedWorkspaceDashboardFeed({
      root,
      repoRoot: REPO_ROOT,
      nowMs: Date.parse(NOW) + (48 * 60 * 60 * 1000),
      staleAfterMs: 60 * 60 * 1000,
      recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE,
    });
    assert.equal(current.records.eventRecords.length, 0);
    assert.equal(current.records.lessonRecords.length, 1);
    const lesson = current.records.lessonRecords[0];
    assert.equal(lesson.lessonId, 'ai-chat-render-loop-prevention');
    assert.equal(lesson.engineeringRecord.recordClass, 'SUCCESSFUL_REPAIR');
    const validation = validateSharedWorkspaceRecord(lesson, {
      nowMs: Date.parse(NOW) + (48 * 60 * 60 * 1000),
      staleAfterMs: 60 * 60 * 1000,
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.stale, false);

    const persisted = JSON.parse(await readFile(
      join(root, 'lessons', 'ai-chat-render-loop-prevention.json'),
      'utf8',
    ));
    assert.equal(persisted.readOnly, true);
    assert.equal(persisted.mergeAuthority, false);
    assert.equal(persisted.runtimeMutationAllowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
