import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSharedWorkspaceStatusRecord } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { SHARED_WORKSPACE_FEED_RECORD_SCOPES } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-backend-dashboard-feed-'));
  await Promise.all(['goals', 'status', 'proof', 'capabilities', 'events', 'receipts']
    .map((directory) => mkdir(join(root, directory), { recursive: true })));
  return root;
}

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

test('backend keeps valid current-state evidence renderable as stale when another current-state record is invalid', async () => {
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

  assert.equal(feed.state, 'stale');
  assert.equal(feed.reason, 'WORKSPACE_RECORD_ERRORS_WITH_VALID_EVIDENCE');
  assert.equal(feed.records.statusRecords.length, 1);
  assert.equal(feed.errors.length, 1);
  assert.match(feed.errors[0], /status\/invalid-current\.json:PARSE_FAILED/);
  assert.equal(feed.diagnosticTrace.at(-1).state, 'renderable');
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
