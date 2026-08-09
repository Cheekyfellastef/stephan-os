import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSharedWorkspaceHeadTruthProjection,
  loadSharedWorkspaceHeadTruthEvidence,
} from './sharedWorkspaceHeadTruthV1.mjs';

const MAIN = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const NOW = Date.parse('2026-08-09T01:00:00.000Z');

function records(overrides = {}) {
  return {
    sync: {
      timestampUtc: '2026-08-09T00:55:00.000Z',
      classification: 'SYNC_NO_CHANGE',
      localHeadBefore: MAIN,
      remoteHeadObserved: MAIN,
      taskName: 'Stephanos Battle Bridge GitHub Sync',
      proofRefs: ['receipts/battle-bridge-github-sync/current.json'],
    },
    refresh: {
      timestampUtc: '2026-08-09T00:54:00.000Z',
      afterHead: MAIN,
      exactHeadProofOk: true,
      resultTargets: [{ targetId: 'stephanos-ui-4173', ok: true, exactHeadProofOk: true, sourceHead: MAIN }],
    },
    supervisor: {
      generatedAt: '2026-08-09T00:56:00.000Z',
      services: { stephanosUi4173: { servedRuntimeProof: { ready: true, currentHead: MAIN, gitCommitMatches: true, runtimeMarkerMatches: true, healthOk: true, distOk: true } } },
    },
    ...overrides,
  };
}

test('projects exact GitHub, Windows, built and served heads when all current evidence agrees', () => {
  const result = buildSharedWorkspaceHeadTruthProjection({ records: records(), timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.state, 'CURRENT');
  assert.equal(result.freshness, 'CURRENT');
  assert.equal(result.githubMainHead, MAIN);
  assert.equal(result.windowsCheckoutHead, MAIN);
  assert.equal(result.builtRuntimeHead, MAIN);
  assert.equal(result.servedRuntimeHead, MAIN);
  assert.equal(result.sourceHeadsAgree, true);
  assert.equal(result.servedMatchesCheckout, true);
  assert.equal(result.blocker, '');
  assert.equal(result.syncTaskHealth, 'HEALTHY');
  assert.equal(result.syncTaskExpectedIntervalMinutes, 15);
});

test('reports exact source drift without allowing a stale live claim', () => {
  const value = records();
  value.sync = { ...value.sync, classification: 'SYNC_FAST_FORWARD_READY', localHeadBefore: OLD, remoteHeadObserved: MAIN };
  value.supervisor = { ...value.supervisor, services: { stephanosUi4173: { servedRuntimeProof: { ready: true, currentHead: OLD, gitCommitMatches: true, runtimeMarkerMatches: true } } } };
  const result = buildSharedWorkspaceHeadTruthProjection({ records: value, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.windowsCheckoutHead, OLD);
  assert.equal(result.githubMainHead, MAIN);
  assert.equal(result.sourceHeadsAgree, false);
  assert.equal(result.blocker, 'WINDOWS_CHECKOUT_NOT_AT_GITHUB_MAIN');
});

test('stale evidence is explicit and never treated as current even when heads agree', () => {
  const value = records();
  value.sync = { ...value.sync, timestampUtc: '2026-08-08T22:00:00.000Z' };
  value.refresh = null;
  value.supervisor = null;
  const result = buildSharedWorkspaceHeadTruthProjection({ records: value, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.state, 'STALE');
  assert.equal(result.freshness, 'STALE');
  assert.equal(result.blocker, 'HEAD_TRUTH_SYNC_RECORD_STALE');
  assert.equal(result.syncTaskHealth, 'STALE_OR_NOT_RUNNING');
  assert.equal(result.builtRuntimeHead, '');
  assert.equal(result.servedRuntimeHead, '');
});

test('fresh unrelated runtime evidence cannot launder a stale sync observation', () => {
  const value = records();
  value.sync = { ...value.sync, timestampUtc: '2026-08-08T22:00:00.000Z' };
  value.supervisor = { ...value.supervisor, generatedAt: '2026-08-09T00:59:30.000Z' };
  const result = buildSharedWorkspaceHeadTruthProjection({ records: value, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.observedAtUtc, '2026-08-09T00:59:30.000Z');
  assert.equal(result.syncObservedAtUtc, '2026-08-08T22:00:00.000Z');
  assert.equal(result.freshness, 'STALE');
  assert.equal(result.blocker, 'HEAD_TRUTH_SYNC_RECORD_STALE');
});

test('matching source heads cannot claim current when built or served exact-head proof is missing', () => {
  const withoutBuild = buildSharedWorkspaceHeadTruthProjection({
    records: records({ refresh: null }),
    timestampUtc: '2026-08-09T01:00:00.000Z',
    nowMs: NOW,
  });
  assert.equal(withoutBuild.state, 'BLOCKED');
  assert.equal(withoutBuild.blocker, 'BUILT_RUNTIME_HEAD_UNPROVEN');

  const withoutServed = buildSharedWorkspaceHeadTruthProjection({
    records: records({ supervisor: null }),
    timestampUtc: '2026-08-09T01:00:00.000Z',
    nowMs: NOW,
  });
  assert.equal(withoutServed.state, 'BLOCKED');
  assert.equal(withoutServed.blocker, 'SERVED_RUNTIME_NOT_AT_WINDOWS_HEAD');
});

test('reports explicit Windows proof coverage with original evidence timestamps', () => {
  const value = records({
    publisher: {
      timestampUtc: '2026-08-09T00:59:00.000Z',
      observedServiceFacts: {
        'stephanos-ui': { ready: true },
        backend: { ready: true },
        'openclaw-gateway': { ready: true },
        'shared-workspace': { ready: true },
      },
    },
    recoveryMesh: {
      timestampUtc: '2026-08-09T00:58:00.000Z',
      classification: 'RECOVERY_MESH_ALL_SERVICES_HEALTHY',
    },
    mailbox: {
      timestampUtc: '2026-08-09T00:59:20.000Z',
      finalVerdict: 'MAILBOX_RECEIPT_INDEX_READY',
    },
    worker: {
      timestampUtc: '2026-08-09T00:59:30.000Z',
      taskName: 'Stephanos Mission Orchestrator Worker',
      branch: 'main',
      headSha: MAIN,
      lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    },
    attachment: {
      observedAt: '2026-08-09T00:59:40.000Z',
      attached: true,
      can_local_windows_proof: true,
      requiredDispatchToolsPresent: true,
      sourceHead: MAIN,
    },
  });
  const result = buildSharedWorkspaceHeadTruthProjection({ records: value, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.windowsProofCoverage.complete, true);
  assert.equal(result.windowsProofCoverage.finalVerdict, 'WINDOWS_PROOF_COVERAGE_COMPLETE');
  assert.equal(result.windowsProofCoverage.checks.commandMailbox.observedAtUtc, '2026-08-09T00:59:20.000Z');
  assert.equal(result.windowsProofCoverage.checks.windowsExecutionSurface.canLocalWindowsProof, true);
  assert.deepEqual(result.windowsProofCoverage.blockers, []);
});

test('missing sync evidence fails closed while optional runtime records may be absent', () => {
  const result = buildSharedWorkspaceHeadTruthProjection({ records: { sync: null, refresh: null, supervisor: null }, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.freshness, 'UNKNOWN');
  assert.equal(result.blocker, 'HEAD_TRUTH_SYNC_RECORD_MISSING');
  assert.equal(result.syncTaskHealth, 'UNPROVEN');
});

test('a fresh published sync blocker proves the watcher ran but could not converge', () => {
  const value = records();
  value.sync = { ...value.sync, classification: 'BLOCKED_DIRTY_SOURCE', exactNextAction: 'Preserve source dirt.' };
  const result = buildSharedWorkspaceHeadTruthProjection({ records: value, timestampUtc: '2026-08-09T01:00:00.000Z', nowMs: NOW });
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.syncTaskHealth, 'RUNNING_BLOCKED');
  assert.equal(result.blocker, 'BLOCKED_DIRTY_SOURCE');
  assert.equal(result.exactNextAction, 'Preserve source dirt.');
});

test('bounded loader reads only the fixed Shared Workspace proof records', async () => {
  const seen = [];
  const result = await loadSharedWorkspaceHeadTruthEvidence({
    workspaceRoot: '/shared',
    repoRoot: '/repo',
    readFileFn: async (file) => {
      seen.push(file.replace(/\\/g, '/'));
      if (file.endsWith('battle-bridge-github-sync-current.json')) return JSON.stringify(records().sync);
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.records.sync.remoteHeadObserved, MAIN);
  assert.equal(result.records.refresh, null);
  assert.equal(result.records.supervisor, null);
  assert.equal(seen.length, 8);
  assert.equal(seen.every((file) => file.startsWith('/shared/status/') || file.startsWith('/shared/codex-dispatch/')), true);
});
