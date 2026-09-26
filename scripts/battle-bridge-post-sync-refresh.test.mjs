import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  projectControlPlaneFailureBlocker,
  runBattleBridgePostSyncRefresh,
} from './battle-bridge-post-sync-refresh.mjs';

const source = await readFile(new URL('./battle-bridge-post-sync-refresh.mjs', import.meta.url), 'utf8');

test('fresh coordinator compares immutable heads through fixed shell-free git argv', () => {
  assert.match(source, /merge-base', '--is-ancestor'/);
  assert.match(source, /diff', '--name-status', '--find-renames', '--diff-filter=ACDMRT'/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression/);
});

test('runtime adapters are fixed to UI backend worker natural reload and bounded control-plane repair', () => {
  assert.match(source, /refreshStephanosUi4173/);
  assert.match(source, /restart-approved-stephanos-runtime\.ps1/);
  assert.match(source, /target: 'backend'/);
  assert.match(source, /target: 'mission-worker'/);
  assert.match(source, /confirmNaturalReload/);
  assert.match(source, /reconcileBattleBridgeControlPlane/);
  assert.doesNotMatch(source, /reconcile-battle-bridge-control-plane\.ps1/);
  assert.doesNotMatch(source, /WAKE_BATTLE_BRIDGE_RECOVERY_MESH/);
  assert.match(source, /refreshUiFn\(\{ expectedHead: afterHead \}\)/);
});

test('control-plane repair runs only after normal exact-head refresh execution passes', () => {
  const executeIndex = source.indexOf('executePostSyncRefreshPlan({');
  const reconcileIndex = source.indexOf('adapter.reconcileControlPlane({ afterHead: normalizedAfter, paths })');
  assert.ok(executeIndex >= 0);
  assert.ok(reconcileIndex > executeIndex);
  assert.match(source, /execution\.ok === true\s*\? adapter\.reconcileControlPlane/);
  assert.match(source, /exactHeadProofOk: effectiveExecution\.exactHeadProofOk === true && controlPlaneReconcile\.ok === true/);
});

test('control-plane failure telemetry appends only canonical fixed task identities', () => {
  assert.equal(
    projectControlPlaneFailureBlocker({
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      failedTaskId: 'recoveryMesh',
    }),
    'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh',
  );
  assert.equal(
    projectControlPlaneFailureBlocker({
      blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
      failedTaskId: '../../secrets',
    }),
    'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
  );
  assert.equal(projectControlPlaneFailureBlocker({ failedTaskId: 'recoveryMesh' }), '');
});

test('fixed control-plane failure identity is persisted into remote-readable post-sync status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-control-plane-failure-'));
  try {
    const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace'), restartScript: join(root, 'unused.ps1') };
    await mkdir(paths.repoRoot, { recursive: true });
    const beforeHead = 'c'.repeat(40);
    const afterHead = 'd'.repeat(40);
    const result = await runBattleBridgePostSyncRefresh({
      beforeHead,
      afterHead,
      paths,
      expectedPaths: paths,
      now: new Date('2026-08-26T14:00:00.000Z'),
      adapter: {
        inspectHeads: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
        changedPaths: () => ({ ok: true, paths: ['docs/runtime-proof.md'] }),
        reconcileControlPlane: () => ({
          ok: false,
          blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
          failedTaskId: 'recoveryMesh',
          sourceHead: afterHead,
          exactHeadProofOk: false,
        }),
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh');
    assert.equal(result.controlPlaneReconcile.failedTaskId, 'recoveryMesh');
    const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), 'utf8'));
    assert.equal(status.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED:recoveryMesh');
    assert.doesNotMatch(JSON.stringify(status), /\.\.\/|secrets/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace publication contains bounded projections and relative proof refs', () => {
  assert.match(source, /receipts', 'post-sync-runtime-refresh'/);
  assert.match(source, /post-sync-runtime-refresh-current\.json/);
  assert.match(source, /buildPostSyncRefreshProjection/);
  assert.doesNotMatch(source, /proofRefs:\s*\[[^\]]*repoRoot/);
});

test('runtime projection cannot overwrite required Shared Workspace record schemas', () => {
  const proofProjection = source.indexOf('...projection,', source.indexOf('const proof = Object.freeze'));
  const proofRecord = source.indexOf('...createSharedWorkspaceProofRecord', source.indexOf('const proof = Object.freeze'));
  const statusProjection = source.indexOf('...projection,', source.indexOf('const status = Object.freeze'));
  const statusRecord = source.indexOf('...createSharedWorkspaceStatusRecord', source.indexOf('const status = Object.freeze'));
  assert.ok(proofProjection >= 0 && proofRecord > proofProjection);
  assert.ok(statusProjection >= 0 && statusRecord > statusProjection);
});

test('real workspace publication preserves proof and status schemas when projection has its own schema', async () => {
  const root = await mkdtemp(join(tmpdir(), 'post-sync-schema-regression-'));
  try {
    const paths = { repoRoot: join(root, 'repo'), workspaceRoot: join(root, 'workspace'), restartScript: join(root, 'unused.ps1') };
    await mkdir(paths.repoRoot, { recursive: true });
    const beforeHead = 'a'.repeat(40);
    const afterHead = 'b'.repeat(40);
    const result = await runBattleBridgePostSyncRefresh({
      beforeHead,
      afterHead,
      paths,
      expectedPaths: paths,
      now: new Date('2026-08-09T01:00:00.000Z'),
      adapter: {
        inspectHeads: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
        changedPaths: () => ({ ok: true, paths: ['docs/runtime-proof.md'] }),
        reconcileControlPlane: () => ({ ok: true, sourceHead: afterHead, exactHeadProofOk: true }),
      },
    });
    assert.equal(result.ok, true);
    const proof = JSON.parse(await readFile(join(paths.workspaceRoot, 'receipts', 'post-sync-runtime-refresh', `${afterHead}-complete.json`), 'utf8'));
    const status = JSON.parse(await readFile(join(paths.workspaceRoot, 'status', 'post-sync-runtime-refresh-current.json'), 'utf8'));
    assert.equal(proof.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(proof.kind, 'stephanos.shared_workspace.proof');
    assert.equal(status.schemaVersion, 'shared-agent-workspace-record.v1');
    assert.equal(status.kind, 'stephanos.shared_workspace.status');
    assert.equal(status.afterHead, afterHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('coordinator resumes exact-head target checkpoints without replaying completed work', () => {
  assert.match(source, /loadResumeResults/);
  assert.match(source, /completedResults/);
  assert.match(source, /checkpoint-\$\{results\.length\}/);
  assert.ok(
    source.indexOf('loadResumeResults(paths.workspaceRoot')
      < source.indexOf("phase: 'plan'"),
  );
});

test('CLI accepts only before and after SHAs and emits one result marker', () => {
  assert.match(source, /POST_SYNC_REFRESH_RESULT=/);
  assert.match(source, /POST_SYNC_REFRESH_ARGUMENT_NOT_ALLOWED/);
  assert.match(source, /POST_SYNC_HEADS_INVALID/);
});