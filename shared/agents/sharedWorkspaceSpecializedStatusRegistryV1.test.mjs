import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY,
  SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS,
  SHARED_WORKSPACE_SPECIALIZED_STATUS_PATTERNS,
  SPECIALIZED_NON_DASHBOARD_STATUS_FILES,
  getSharedWorkspaceSpecializedStatusRecord,
  isSharedWorkspaceSpecializedStatusFile,
} from './sharedWorkspaceSpecializedStatusRegistryV1.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('registry is a status-only boundary with unique fixed filenames and narrowly bounded patterns', () => {
  assert.equal(SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY.records, SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS);
  assert.equal(SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY.patterns, SHARED_WORKSPACE_SPECIALIZED_STATUS_PATTERNS);
  assert.equal(SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY.matchingPolicy, 'exact-filenames-plus-anchored-specialized-patterns');
  assert.equal(SHARED_WORKSPACE_SPECIALIZED_STATUS_REGISTRY.defaultUnregisteredDisposition, 'dashboard-validation-required');
  assert.equal(new Set(SPECIALIZED_NON_DASHBOARD_STATUS_FILES).size, SPECIALIZED_NON_DASHBOARD_STATUS_FILES.length);
  assert.deepEqual(
    [...SPECIALIZED_NON_DASHBOARD_STATUS_FILES],
    [...SPECIALIZED_NON_DASHBOARD_STATUS_FILES].sort(),
  );
  for (const entry of SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(entry.directory, 'status');
    assert.match(entry.fileName, /^[a-z0-9][a-z0-9.-]+\.json$/);
    assert.equal(entry.fileName.includes('*'), false);
    assert.equal(entry.dashboardAuthority, false);
    assert.equal(entry.authority, 'specialized-consumer-only');
    assert.equal(entry.schemaIds.length > 0, true);
    assert.equal(entry.sourcePaths.length > 0, true);
    assert.equal(getSharedWorkspaceSpecializedStatusRecord(entry.fileName), entry);
    assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName: entry.fileName }), true);
    assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'proof', fileName: entry.fileName }), false);
  }
  const digest = 'a'.repeat(64);
  const patternFiles = [
    `mission-orchestrator-worker-launch-identity-${digest}.json`,
    `mission-orchestrator-worker-restart-claim-${digest}.json`,
    `mission-orchestrator-worker-restart-receipt-${digest}.json`,
    `mission-orchestrator-worker-restart-heartbeat-${digest}.json`,
    `mission-orchestrator-worker-restart-confirm-${digest}.json`,
    `mission-orchestrator-worker-restart-cancel-${digest}.json`,
  ];
  assert.equal(patternFiles.length, SHARED_WORKSPACE_SPECIALIZED_STATUS_PATTERNS.length);
  for (const [index, fileName] of patternFiles.entries()) {
    assert.equal(getSharedWorkspaceSpecializedStatusRecord(fileName), SHARED_WORKSPACE_SPECIALIZED_STATUS_PATTERNS[index]);
    assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName }), true);
    assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'proof', fileName }), false);
  }
  assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName: `mission-orchestrator-worker-launch-identity-${'a'.repeat(63)}.json` }), false);
  assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName: 'mission-orchestrator-worker-restart-claim-not-a-digest.json' }), false);
  assert.equal(isSharedWorkspaceSpecializedStatusFile({ directory: 'status', fileName: 'attacker-selected-specialized-record.json' }), false);
});

test('every registry entry is bound to its real producer filename and schema source', async () => {
  for (const entry of SHARED_WORKSPACE_SPECIALIZED_STATUS_RECORDS) {
    const sources = await Promise.all(entry.sourcePaths.map((sourcePath) => readFile(join(REPOSITORY_ROOT, sourcePath), 'utf8')));
    const combined = sources.join('\n');
    assert.match(combined, new RegExp(entry.fileName.replaceAll('.', '\\.')));
    for (const schemaId of entry.schemaIds) assert.match(combined, new RegExp(schemaId.replaceAll('.', '\\.')));
  }
  for (const entry of SHARED_WORKSPACE_SPECIALIZED_STATUS_PATTERNS) {
    const sources = await Promise.all(entry.sourcePaths.map((sourcePath) => readFile(join(REPOSITORY_ROOT, sourcePath), 'utf8')));
    const combined = sources.join('\n');
    assert.match(combined, /mission-orchestrator-worker-launch-identity-/);
    for (const schemaId of entry.schemaIds) assert.match(combined, new RegExp(schemaId.replaceAll('.', '\\.')));
  }
});
