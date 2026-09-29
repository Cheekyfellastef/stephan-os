import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSharedWorkspaceLayout } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  publishSupportSnapshotWorkspaceObservation,
  SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID,
} from './supportSnapshotSharedWorkspaceBridgeService.js';

const REPO_ROOT = process.cwd();
const NOW = Date.parse('2026-09-27T12:00:00.000Z');

test('support snapshot bridge writes one bounded status and deduplicates unchanged observations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-support-bridge-'));
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: REPO_ROOT });
    assert.equal(layout.ok, true);
    const observation = {
      backendState: 'online',
      routeMode: 'auto',
      flywheelState: 'ready',
      lessonCount: 3,
      latestLessonId: 'ai-chat-render-loop-prevention',
      renderState: 'stable',
    };
    const first = await publishSupportSnapshotWorkspaceObservation({
      root,
      repoRoot: REPO_ROOT,
      nowMs: NOW,
      observation,
    });
    assert.equal(first.ok, true);
    assert.equal(first.changed, true);

    const second = await publishSupportSnapshotWorkspaceObservation({
      root,
      repoRoot: REPO_ROOT,
      nowMs: NOW + 30_000,
      observation,
    });
    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
    assert.equal(second.reason, 'SUPPORT_SNAPSHOT_OBSERVATION_UNCHANGED');

    const record = JSON.parse(await readFile(
      join(root, 'status', `${SUPPORT_SNAPSHOT_WORKSPACE_STATUS_ID}.json`),
      'utf8',
    ));
    assert.equal(record.observation.lessonCount, 3);
    assert.equal(record.observation.renderState, 'stable');
    assert.equal(record.readOnlyObservation, true);
    assert.equal(record.mergeAuthority, false);
    assert.equal(record.runtimeMutationAllowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
