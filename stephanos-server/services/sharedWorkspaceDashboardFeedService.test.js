import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import {
  createSharedWorkspaceGoalRecord,
  createSharedWorkspaceStatusRecord,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { SHARED_WORKSPACE_FEED_RECORD_SCOPES } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-backend-dashboard-feed-'));
  await Promise.all(['goals', 'status', 'proof', 'capabilities', 'events', 'receipts']
    .map((directory) => mkdir(join(root, directory), { recursive: true })));
  return root;
}

test('optional live read deadline preserves local evidence and bounds unfinished work across polls', async () => {
  const root = await createWorkspace();
  await writeFile(join(root, 'status', 'current.json'), JSON.stringify(createSharedWorkspaceStatusRecord({
    statusId: 'current', timestampUtc: new Date().toISOString(), status: 'CURRENT',
  })));
  let finish;
  let calls = 0;
  let startedRetry;
  const retryStarted = new Promise(resolve => { startedRetry = resolve; });
  const reader = async () => {
    calls += 1;
    if (calls === 2) startedRetry();
    return new Promise(resolve => { finish = resolve; });
  };
  const input = { env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd(),
    readLiveGoalProjection: reader, liveProjectionTimeoutMs: 20 };
  let first;
  try {
    first = await readBackendSharedWorkspaceDashboardFeed(input);
    assert.equal(first.state, 'ready');
    assert.equal(first.records.statusRecords.length, 1);
    assert.equal(first.livePortfolio.state, 'unavailable');
    assert.equal(first.livePortfolio.reason, 'LIVE_PROJECTION_DEADLINE_EXCEEDED');
    const waiting = await Promise.all(Array.from({ length: 4 }, () => readBackendSharedWorkspaceDashboardFeed(input)));
    assert.equal(calls, 1, 'timed-out work remains single-flight until it actually settles');
    assert.ok(waiting.every(feed => feed.livePortfolio.reason === 'LIVE_PROJECTION_READ_IN_PROGRESS'));
    assert.ok(waiting.every(feed => feed.records.statusRecords.length === 1));
  } finally { finish?.({ sourceTruth: 'live', generatedAt: new Date().toISOString() }); await setImmediate(); }
  assert.equal(first.livePortfolio.state, 'unavailable', 'late completion cannot upgrade the returned authority verdict');
  const retried = readBackendSharedWorkspaceDashboardFeed(input);
  // Wait for the next real invocation rather than returning a completed cache.
  let guard;
  try {
    await Promise.race([retryStarted, new Promise((_, reject) => {
      guard = setTimeout(() => reject(new Error('completed read did not release admission')), 3000);
    })]);
  } finally { clearTimeout(guard); finish(null); }
  const next = await retried;
  assert.equal(calls, 2);
  assert.equal(next.livePortfolio.reason, 'LIVE_PROJECTION_EMPTY');
});

test('optional live read failures release admission and successful fresh reads are retained', async () => {
  const root = await createWorkspace();
  let calls = 0;
  const input = { env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd(),
    readLiveGoalProjection: async () => {
      if (++calls === 1) throw new Error('injected optional failure');
      return { generatedAt: new Date().toISOString(), sourceTruth: 'mixed', queuedCandidates: [] };
    } };
  const failed = await readBackendSharedWorkspaceDashboardFeed(input);
  assert.equal(failed.livePortfolio.state, 'unavailable');
  assert.match(failed.livePortfolio.reason, /injected optional failure/);
  const next = await readBackendSharedWorkspaceDashboardFeed(input);
  assert.equal(next.livePortfolio.state, 'ready');
  assert.equal(next.livePortfolio.reason, 'LIVE_PROJECTION_READ');
  assert.equal(calls, 2);
});

test('conversation read starts before a blocked history read finishes and its failure remains unavailable', async () => {
  const root = await createWorkspace();
  await writeFile(join(root, 'status', 'current.json'), JSON.stringify(createSharedWorkspaceStatusRecord({
    statusId: 'current', timestampUtc: new Date().toISOString(), status: 'CURRENT',
  })));
  let releaseHistory;
  const historyGate = new Promise(resolve => { releaseHistory = resolve; });
  let conversationStarted;
  const conversationGate = new Promise(resolve => { conversationStarted = resolve; });
  const reading = readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(), liveProjection: null,
    readFile: async (...args) => { await historyGate; return readFile(...args); },
    readConversationUplift: async () => { conversationStarted(); throw new Error('conversation unavailable'); },
  });
  let deadline;
  try {
    await Promise.race([conversationGate, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('conversation queued behind history')), 3000);
    })]);
  } finally { clearTimeout(deadline); releaseHistory(); await reading; }
  const feed = await reading;
  assert.equal(feed.state, 'ready');
  assert.equal(feed.records.statusRecords.length, 1);
  assert.deepEqual(feed.conversationUplift, { state: 'unavailable', turnCount: 0, candidates: [] });
});

test('backend dashboard feed reads current state without walking historical receipt storage', async () => {
  const root = await createWorkspace();
  const now = '2026-09-11T10:00:00.000Z';
  const status = createSharedWorkspaceStatusRecord({
    statusId: 'dashboard-current',
    timestampUtc: now,
    relatedIssue: '#1290',
    status: 'CURRENT',
    summary: 'Current project status is available.',
  });
  await writeFile(join(root, 'status', 'dashboard-current.json'), `${JSON.stringify(status)}\n`, 'utf8');
  await writeFile(join(root, 'receipts', 'unrelated-historical-receipt.json'), '{not-json\n', 'utf8');

  const feed = await readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(),
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  assert.equal(feed.state, 'ready');
  assert.equal(feed.recordScope, SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE);
  assert.equal(feed.records.statusRecords.length, 1);
  assert.equal(feed.records.receiptRecords.length, 0);
  assert.deepEqual(feed.errors, []);
});

test('backend keeps fresh current-state evidence ready while surfacing invalid-record warnings', async () => {
  const root = await createWorkspace();
  const now = '2026-09-11T10:00:00.000Z';
  const status = createSharedWorkspaceStatusRecord({
    statusId: 'dashboard-current',
    timestampUtc: now,
    relatedIssue: '#1290',
    status: 'CURRENT',
    summary: 'Current project status is available.',
  });
  await writeFile(join(root, 'status', 'dashboard-current.json'), `${JSON.stringify(status)}\n`, 'utf8');
  await writeFile(join(root, 'status', 'invalid-current.json'), '{not-json\n', 'utf8');

  const feed = await readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(),
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  assert.equal(feed.state, 'ready');
  assert.equal(feed.reason, 'CURRENT_WORKSPACE_EVIDENCE_WITH_RECORD_WARNINGS');
  assert.equal(feed.records.statusRecords.length, 1);
  assert.equal(feed.errors.length, 1);
  assert.match(feed.errors[0], /status\/invalid-current\.json:PARSE_FAILED/);
  assert.equal(feed.diagnosticTrace.at(-1).state, 'renderable');
});

test('backend still reports stale when valid current-state evidence is genuinely old and record warnings also exist', async () => {
  const root = await createWorkspace();
  const now = '2026-09-11T10:00:00.000Z';
  const status = createSharedWorkspaceStatusRecord({
    statusId: 'dashboard-old',
    timestampUtc: '2026-09-11T09:00:00.000Z',
    relatedIssue: '#1290',
    status: 'CURRENT',
    summary: 'Last valid project status is old.',
  });
  await writeFile(join(root, 'status', 'dashboard-old.json'), `${JSON.stringify(status)}\n`, 'utf8');
  await writeFile(join(root, 'status', 'invalid-current.json'), '{not-json\n', 'utf8');

  const feed = await readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(),
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  assert.equal(feed.state, 'stale');
  assert.equal(feed.reason, 'WORKSPACE_RECORD_ERRORS_WITH_VALID_EVIDENCE');
  assert.equal(feed.errors.length, 1);
});

test('backend remains fail-closed when invalid current-state records have no valid evidence to render', async () => {
  const root = await createWorkspace();
  const now = '2026-09-11T10:00:00.000Z';
  await writeFile(join(root, 'status', 'invalid-only.json'), '{not-json\n', 'utf8');

  const feed = await readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(),
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  assert.equal(feed.state, 'error');
  assert.equal(feed.errors.length, 1);
  assert.match(feed.errors[0], /status\/invalid-only\.json:PARSE_FAILED/);
  assert.equal(feed.diagnosticTrace.at(-1).state, 'honest-unavailable');
});

test('complete Shared Workspace estate reaches the local dashboard without the legacy 24/32-card cap', async () => {
  const root = await createWorkspace();
  const now = '2026-09-22T06:40:00.000Z';
  const writes = Array.from({ length: 86 }, (_, index) => {
    const issue = 3000 + index;
    const record = createSharedWorkspaceGoalRecord({
      goalId: `goal-${issue}`,
      timestampUtc: now,
      title: `Goal ${issue}`,
      status: index < 6 ? 'BUILDING' : 'ELIGIBLE',
      summary: `Durable goal ${issue}`,
    });
    return writeFile(join(root, 'goals', `goal-${issue}.json`), `${JSON.stringify(record)}\n`, 'utf8');
  });
  await Promise.all(writes);

  const feed = await readBackendSharedWorkspaceDashboardFeed({
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root },
    repoRoot: process.cwd(),
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    liveProjection: null,
  });

  assert.equal(feed.goalEstate.totalOpenGoals, 86);
  assert.equal(feed.livePortfolio.workspaceGoalCount, 86);
  assert.equal(feed.projection.goals.length, 86);
  assert.equal(feed.projection.goalEstate.stateCounts.active, 6);
  assert.equal(feed.projection.goalEstate.stateCounts.eligible, 80);
  assert.equal(feed.diagnosticTrace.find((hop) => hop.hop === 'goal-estate-summary')?.openGoalCount, 86);
});
