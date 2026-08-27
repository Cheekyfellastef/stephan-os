import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBackendSharedWorkspaceDashboardFeed } from '../stephanos-server/services/sharedWorkspaceDashboardFeedService.js';

const NOW = Date.parse('2026-08-14T11:30:00Z');

async function context() {
  const home = await mkdtemp(join(tmpdir(), 'goal-dashboard-live-home-'));
  const repoRoot = await mkdtemp(join(tmpdir(), 'goal-dashboard-live-repo-'));
  const root = await mkdtemp(join(tmpdir(), 'goal-dashboard-live-workspace-'));
  for (const dir of ['goals', 'status', 'proof', 'capabilities', 'events']) await mkdir(join(root, dir), { recursive: true });
  return {
    root,
    repoRoot,
    env: { HOME: home, USERPROFILE: home, PATH: '', STEPHANOS_SHARED_AGENT_WORKSPACE: root },
  };
}

function liveProjection(lastUpdatedAt) {
  return {
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: lastUpdatedAt,
    githubTelemetry: {
      adapterAvailable: true,
      lastUpdatedAt,
      pullRequests: [
        {
          number: 1780,
          title: 'Realtime Goal Dashboard portfolio',
          branch: 'feat/goal-dashboard-truth-wow-v2',
          headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          checksStatus: 'passed',
          mergeReadiness: 'awaiting_exact_head_approval',
          approvalStatus: 'unknown',
          blockers: [],
          supersededStatus: 'active',
        },
      ],
    },
  };
}

test('current GitHub portfolio keeps polled dashboard feed renderable when workspace has no records', async () => {
  const ctx = await context();
  const payload = await readBackendSharedWorkspaceDashboardFeed({
    ...ctx,
    nowMs: NOW,
    staleAfterMs: 60_000,
    liveProjection: liveProjection('2026-08-14T11:29:40Z'),
  });

  assert.equal(payload.state, 'ready');
  assert.equal(payload.reason, 'LIVE_PROGRAMME_PORTFOLIO_CURRENT');
  assert.equal(payload.projection.portfolioSource, 'LIVE_GITHUB_PLUS_SHARED_WORKSPACE');
  assert.equal(payload.projection.goals[0].issue, 'PR #1780');
  assert.equal(payload.livePortfolio.githubOpenPrCount, 1);
  assert.equal(payload.diagnosticTrace.at(-1).state, 'renderable');
});

test('stale GitHub portfolio makes the polled dashboard feed stale rather than current', async () => {
  const ctx = await context();
  const payload = await readBackendSharedWorkspaceDashboardFeed({
    ...ctx,
    nowMs: NOW,
    staleAfterMs: 60_000,
    liveProjection: liveProjection('2026-08-14T11:20:00Z'),
  });

  assert.equal(payload.state, 'stale');
  assert.equal(payload.reason, 'LIVE_PROGRAMME_PORTFOLIO_STALE');
  assert.equal(payload.projection.sourceTruth, 'STALE');
  assert.equal(payload.projection.goals[0].proofTruth, 'STALE');
});

test('empty workspace without a live portfolio remains honestly unavailable', async () => {
  const ctx = await context();
  const payload = await readBackendSharedWorkspaceDashboardFeed({
    ...ctx,
    nowMs: NOW,
    liveProjection: null,
  });

  assert.equal(payload.state, 'unavailable');
  assert.equal(payload.reason, 'NO_WORKSPACE_RECORDS');
  assert.equal(payload.projection.portfolioSource, 'BASE_PROJECTION_FALLBACK');
});
