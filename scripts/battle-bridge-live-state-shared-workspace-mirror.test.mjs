import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE,
  buildBattleBridgeOutboundBeacon,
  compareBattleBridgeCompleteStateMirrors,
  mirrorBattleBridgeCompleteStateToSharedWorkspace,
} from './battle-bridge-outbound-health-beacon.mjs';
import {
  getSharedWorkspaceSpecializedStatusRecord,
  isSharedWorkspaceSpecializedStatusFile,
} from '../shared/agents/sharedWorkspaceSpecializedStatusRegistryV1.mjs';

const HEAD = 'a'.repeat(40);

function completeStateRecord() {
  return buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now: new Date('2026-08-29T17:54:55.697Z'),
    statusRecords: {},
  });
}

test('complete-state mirror writes the exact outbound record atomically outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-live-state-mirror-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(repoRoot, { recursive: true });
  try {
    const record = completeStateRecord();
    const result = mirrorBattleBridgeCompleteStateToSharedWorkspace({ workspaceRoot, repoRoot, record });
    assert.equal(result.ok, true);
    assert.equal(result.state, 'SHARED_WORKSPACE_COMPLETE_STATE_MIRRORED');
    assert.equal(result.fileName, BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE);
    assert.equal(result.sourceHead, HEAD);
    assert.match(result.recordSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replaceAll('\\', '\\\\')));

    const mirrored = JSON.parse(readFileSync(join(workspaceRoot, 'status', BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE), 'utf8'));
    assert.deepEqual(mirrored, record);
    assert.deepEqual(compareBattleBridgeCompleteStateMirrors(record, mirrored), {
      state: 'CONSISTENT',
      consistent: true,
      sourceHead: HEAD,
      observedAtUtc: '2026-08-29T17:54:55.697Z',
      githubRecordSha256: result.recordSha256,
      sharedWorkspaceRecordSha256: result.recordSha256,
      mismatches: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('GitHub and Shared Workspace live-state disagreement fails closed as CONFLICTING', () => {
  const githubRecord = completeStateRecord();
  const workspaceRecord = { ...githubRecord, sourceHead: 'b'.repeat(40) };
  const consistency = compareBattleBridgeCompleteStateMirrors(githubRecord, workspaceRecord);
  assert.equal(consistency.state, 'CONFLICTING');
  assert.equal(consistency.consistent, false);
  assert.ok(consistency.mismatches.includes('sourceHead'));
});

test('complete-state mirror rejects any widened authority before persistence', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-live-state-authority-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(repoRoot, { recursive: true });
  try {
    const unsafe = { ...completeStateRecord(), processRestartAllowed: true };
    assert.throws(
      () => mirrorBattleBridgeCompleteStateToSharedWorkspace({ workspaceRoot, repoRoot, record: unsafe }),
      /BATTLE_BRIDGE_COMPLETE_STATE_AUTHORITY_INVALID/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('complete-state projection is registered as specialized Shared Workspace truth, never generic dashboard authority', () => {
  const entry = getSharedWorkspaceSpecializedStatusRecord(BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE);
  assert.ok(entry);
  assert.equal(entry.directory, 'status');
  assert.equal(entry.role, 'battle-bridge-complete-state-projection');
  assert.equal(entry.dashboardAuthority, false);
  assert.equal(entry.authority, 'specialized-consumer-only');
  assert.deepEqual(entry.schemaIds, ['stephanos.battle-bridge-outbound-health-beacon.v1']);
  assert.ok(entry.sourcePaths.includes('scripts/battle-bridge-outbound-health-beacon.mjs'));
  assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName: BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE }), true);
});
