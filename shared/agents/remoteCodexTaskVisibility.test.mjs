import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  REMOTE_CODEX_VISIBILITY_STATES,
  classifyRemoteCodexTaskVisibility,
  createRemoteCodexTaskVisibilitySlice,
  createRemoteCodexVisibilityWorkspaceRecords,
  extractCodexThreadId,
  publishRemoteCodexTaskVisibility,
  renderRemoteCodexGitHubMirrorComment,
  verifyRemoteCodexTaskVisibility,
} from './remoteCodexTaskVisibility.mjs';
import { VERIFICATION_STATUS } from './verificationHarness.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW_MS = Date.parse('2026-07-16T16:00:00.000Z');

function runningInput(overrides = {}) {
  return {
    jobId: 'codex-job-1506-visibility',
    taskId: 'codex-job-1506-visibility',
    issueNumber: 1506,
    status: 'RUNNING',
    heartbeatUtc: '2026-07-16T15:59:45.000Z',
    workerAlive: true,
    sourceHeadBefore: '931cf436687782c59dcd34e3341bc7d6669ba775',
    proofRefs: [
      'proof/remote-codex-codex-job-1506-visibility.json',
      'receipts/codex-job-1506-visibility.json',
    ],
    events: [{ type: 'thread.started', thread_id: 'thread-1506-visible' }],
    ...overrides,
  };
}

test('fresh, stale, dead-worker and completed task states are classified deterministically', () => {
  const fresh = classifyRemoteCodexTaskVisibility(runningInput(), { nowMs: NOW_MS });
  assert.equal(fresh.state, REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT);
  assert.equal(fresh.heartbeatFresh, true);
  assert.equal(fresh.heartbeatAgeMs, 15_000);

  const stale = classifyRemoteCodexTaskVisibility(runningInput({ heartbeatUtc: '2026-07-16T15:55:00.000Z' }), { nowMs: NOW_MS });
  assert.equal(stale.state, REMOTE_CODEX_VISIBILITY_STATES.RUNNING_STALE);
  assert.equal(stale.heartbeatFresh, false);

  const dead = classifyRemoteCodexTaskVisibility(runningInput({ workerAlive: false }), { nowMs: NOW_MS });
  assert.equal(dead.state, REMOTE_CODEX_VISIBILITY_STATES.WORKER_EXITED_WITHOUT_RESULT);

  const completed = classifyRemoteCodexTaskVisibility(runningInput({ status: 'DONE', verdict: 'PASS' }), { nowMs: NOW_MS });
  assert.equal(completed.state, REMOTE_CODEX_VISIBILITY_STATES.RESULT_READY);
  assert.equal(completed.resultAvailable, true);
});

test('Codex thread identity is extracted from bounded JSON events without accepting traversal-shaped values', () => {
  assert.equal(extractCodexThreadId([
    { type: 'turn.started' },
    { type: 'thread.started', thread_id: 'thread-abc-123' },
  ]), 'thread-abc-123');
  assert.equal(extractCodexThreadId([{ type: 'thread.started', thread_id: '../unsafe' }]), '');
  assert.equal(extractCodexThreadId([]), '');
});

test('visibility slice carries one sanitized canonical truth record', () => {
  const slice = createRemoteCodexTaskVisibilitySlice(runningInput({
    blocker: 'token must never be mirrored',
    nextAction: 'Continue monitoring from the Shared Workspace.',
  }), { nowMs: NOW_MS });

  assert.equal(slice.state, REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT);
  assert.equal(slice.codexThreadId, 'thread-1506-visible');
  assert.equal(slice.sourceHead, '931cf436687782c59dcd34e3341bc7d6669ba775');
  assert.equal(slice.blocker, '');
  assert.equal(slice.arbitraryFilesystemAccess, false);
  assert.equal(slice.arbitraryShellAllowed, false);
  assert.equal(slice.mergeAuthority, false);
});

test('local Windows and Unix paths are replaced by the bounded default action before projection', () => {
  for (const unsafeAction of [
    'Inspect spawn C:\\Users\\Stephan\\AppData\\Roaming\\npm\\codex.cmd ENOENT.',
    'Inspect /home/stephan/.local/bin/codex after the failure.',
  ]) {
    const slice = createRemoteCodexTaskVisibilitySlice(runningInput({ nextOperatorAction: unsafeAction }), { nowMs: NOW_MS });
    assert.equal(slice.nextAction, 'Continue monitoring the current Remote Codex task.');
    const comment = renderRemoteCodexGitHubMirrorComment(slice, { nowMs: NOW_MS });
    assert.doesNotMatch(comment, /Stephan|AppData|\/home\//i);
  }
});

test('Shared Workspace status, proof and event records validate through the canonical store', () => {
  const records = createRemoteCodexVisibilityWorkspaceRecords(runningInput(), { nowMs: NOW_MS });
  for (const record of [records.statusRecord, records.proofRecord, records.eventRecord]) {
    const validation = validateSharedWorkspaceRecord(record, { nowMs: NOW_MS });
    assert.equal(validation.valid, true, validation.errors.join(', '));
  }

  const verification = verifyRemoteCodexTaskVisibility(records.slice, { nowMs: NOW_MS });
  assert.equal(verification.status, VERIFICATION_STATUS.PASS);
  assert.equal(verification.operatorNeeded, false);
});

test('publisher writes atomic current status and append-only event evidence outside the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-codex-visibility-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  const published = await publishRemoteCodexTaskVisibility(workspaceRoot, runningInput(), { repoRoot, nowMs: NOW_MS });

  assert.equal(published.ok, true, published.reason);
  const current = JSON.parse(await readFile(join(workspaceRoot, 'status', 'remote-codex-current.json'), 'utf8'));
  assert.equal(current.taskState, REMOTE_CODEX_VISIBILITY_STATES.RUNNING_CURRENT);
  assert.equal(current.jobId, 'codex-job-1506-visibility');
  assert.equal(current.heartbeatFresh, true);

  const events = await readFile(join(workspaceRoot, 'events', 'remote-codex-task-visibility.jsonl'), 'utf8');
  assert.match(events, /remote-codex-task-visibility/);
});

test('GitHub mirror is a sanitized projection and explicitly keeps the Shared Workspace authoritative', () => {
  const comment = renderRemoteCodexGitHubMirrorComment(runningInput(), { nowMs: NOW_MS });
  assert.match(comment, /REMOTE_CODEX_ACTIVE=true/);
  assert.match(comment, /STATE=RUNNING_CURRENT/);
  assert.match(comment, /HEARTBEAT_FRESH=true/);
  assert.match(comment, /CODEX_THREAD_ID=thread-1506-visible/);
  assert.match(comment, /Shared Workspace remains authoritative/);
  assert.doesNotMatch(comment, /C:\\/);
  assert.doesNotMatch(comment, /token must never/i);
});
