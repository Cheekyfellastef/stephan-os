import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  OPENCLAW_DEFAULT_CAPABILITY,
  SHARED_WORKSPACE_RUNTIME_DIRECTORIES,
  aggregateLatestSharedWorkspaceStatus,
  appendWorkspaceJsonl,
  createAgentCapabilityRecord,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceGoalRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { createSharedWorkspaceMessage, validateSharedWorkspaceMessage } from './sharedAgentWorkspace.mjs';

const REPO_ROOT = resolve('.');
async function tempWorkspace() {
  return mkdtemp(join(tmpdir(), 'stephanos-shared-workspace-test-'));
}

test('directory layout creation creates only allowed workspace tree', async () => {
  const root = await tempWorkspace();
  try {
    const result = await ensureSharedWorkspaceLayout({ root, repoRoot: REPO_ROOT });
    assert.equal(result.ok, true);
    const names = new Set(await readdir(root));
    for (const directory of SHARED_WORKSPACE_RUNTIME_DIRECTORIES) assert.equal(names.has(directory), true);
    assert.equal(names.has('node_modules'), false);
    assert.equal(names.has('dist'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('valid message/status/proof/capability records pass deterministic validators', () => {
  const message = createSharedWorkspaceMessage({ messageId: 'msg-1', sender: 'codex', recipient: 'operator', kind: 'status', summary: 'Ready.', status: 'READY' });
  assert.equal(validateSharedWorkspaceMessage(message).valid, true);
  for (const record of [
    createSharedWorkspaceStatusRecord({ statusId: 'status-1', timestampUtc: '2026-07-07T00:00:00Z', status: 'READY' }),
    createSharedWorkspaceProofRecord({ proofId: 'proof-1', timestampUtc: '2026-07-07T00:00:01Z', status: 'PASS' }),
    createAgentCapabilityRecord({ agentId: 'codex', timestampUtc: '2026-07-07T00:00:02Z', mode: 'source_writer', trustedBuilder: true }),
  ]) {
    assert.equal(validateSharedWorkspaceRecord(record, { nowMs: Date.parse('2026-07-07T00:10:00Z') }).valid, true);
  }
});

test('invalid record refusal is deterministic', () => {
  const result = validateSharedWorkspaceRecord({ schemaVersion: 'bad', kind: 'bad', recordId: '../x' });
  assert.equal(result.valid, false);
  assert.equal(result.finalVerdict, 'SHARED_WORKSPACE_RECORD_BLOCKED');
  assert.equal(result.refusalReason, 'invalid-schema-version');
});

test('stale record detection classifies stale without guessing', () => {
  const record = createSharedWorkspaceStatusRecord({ statusId: 'status-stale', timestampUtc: '2026-07-07T00:00:00Z' });
  const result = validateSharedWorkspaceRecord(record, { nowMs: Date.parse('2026-07-07T02:00:01Z'), staleAfterMs: 60 * 60 * 1000 });
  assert.equal(result.valid, true);
  assert.equal(result.stale, true);
  assert.equal(result.classification, 'STALE_RECORD');
});

test('atomic JSON write behavior writes complete replacement without temp residue', async () => {
  const root = await tempWorkspace();
  try {
    const first = createSharedWorkspaceStatusRecord({ statusId: 'status-atomic', timestampUtc: '2026-07-07T00:00:00Z', status: 'FIRST' });
    const second = createSharedWorkspaceStatusRecord({ statusId: 'status-atomic', timestampUtc: '2026-07-07T00:01:00Z', status: 'SECOND' });
    assert.equal((await writeAtomicJson(root, ['status', 'status-atomic.json'], first, { repoRoot: REPO_ROOT })).ok, true);
    assert.equal((await writeAtomicJson(root, ['status', 'status-atomic.json'], second, { repoRoot: REPO_ROOT })).ok, true);
    const parsed = JSON.parse(await readFile(join(root, 'status', 'status-atomic.json'), 'utf8'));
    assert.equal(parsed.status, 'SECOND');
    const files = await readdir(join(root, 'status'));
    assert.deepEqual(files, ['status-atomic.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSONL append behavior appends one valid JSON object per line', async () => {
  const root = await tempWorkspace();
  try {
    const one = createSharedWorkspaceEventRecord({ eventId: 'event-1', timestampUtc: '2026-07-07T00:00:00Z' });
    const two = createSharedWorkspaceEventRecord({ eventId: 'event-2', timestampUtc: '2026-07-07T00:01:00Z' });
    assert.equal((await appendWorkspaceJsonl(root, ['events', 'events.jsonl'], one, { repoRoot: REPO_ROOT })).ok, true);
    assert.equal((await appendWorkspaceJsonl(root, ['events', 'events.jsonl'], two, { repoRoot: REPO_ROOT })).ok, true);
    const lines = (await readFile(join(root, 'events', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map((line) => line.eventId), ['event-1', 'event-2']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('latest-status aggregation reads latest goal/status/proof/capability records', async () => {
  const root = await tempWorkspace();
  try {
    await writeAtomicJson(root, ['goals', 'goal.json'], createSharedWorkspaceGoalRecord({ goalId: 'goal-1290', timestampUtc: '2026-07-07T00:00:00Z', title: '#1290' }), { repoRoot: REPO_ROOT });
    await writeAtomicJson(root, ['status', 'status.json'], createSharedWorkspaceStatusRecord({ statusId: 'status-1290', timestampUtc: '2026-07-07T00:01:00Z', status: 'READY' }), { repoRoot: REPO_ROOT });
    await writeAtomicJson(root, ['proof', 'proof.json'], createSharedWorkspaceProofRecord({ proofId: 'proof-1290', timestampUtc: '2026-07-07T00:02:00Z', status: 'PASS' }), { repoRoot: REPO_ROOT });
    await writeAtomicJson(root, ['capabilities', 'codex.json'], createAgentCapabilityRecord({ agentId: 'codex', timestampUtc: '2026-07-07T00:03:00Z', mode: 'source_writer', trustedBuilder: true }), { repoRoot: REPO_ROOT });
    const result = await aggregateLatestSharedWorkspaceStatus(root, { repoRoot: REPO_ROOT, nowMs: Date.parse('2026-07-07T00:10:00Z') });
    assert.equal(result.finalVerdict, 'SHARED_WORKSPACE_LATEST_STATUS_READY');
    assert.equal(result.latest.goal.goalId, 'goal-1290');
    assert.equal(result.latest.capability.agentId, 'codex');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('latest-status aggregation blocks missing or stale capability explicitly', async () => {
  const root = await tempWorkspace();
  try {
    assert.equal((await aggregateLatestSharedWorkspaceStatus(root, { repoRoot: REPO_ROOT })).finalVerdict, 'BLOCKED_BY_MISSING_CAPABILITY_RECORD');
    await writeAtomicJson(root, ['capabilities', 'codex.json'], createAgentCapabilityRecord({ agentId: 'codex', timestampUtc: '2026-07-07T00:00:00Z' }), { repoRoot: REPO_ROOT });
    assert.equal((await aggregateLatestSharedWorkspaceStatus(root, { repoRoot: REPO_ROOT, nowMs: Date.parse('2026-07-07T02:00:01Z') })).finalVerdict, 'NEEDS_CAPABILITY_REFRESH');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unsafe path rejection prevents source tree and traversal writes', async () => {
  assert.equal(resolveSharedWorkspacePath({ root: REPO_ROOT, repoRoot: REPO_ROOT }).reason, 'WORKSPACE_PATH_INSIDE_REPOSITORY');
  const root = await tempWorkspace();
  try {
    assert.equal(resolveSharedWorkspacePath({ root, repoRoot: REPO_ROOT, segments: ['..', 'escape.json'] }).ok, false);
    const write = await writeAtomicJson(root, ['status', '../escape.json'], createSharedWorkspaceStatusRecord({ statusId: 'safe', timestampUtc: '2026-07-07T00:00:00Z' }), { repoRoot: REPO_ROOT });
    assert.equal(write.ok, false);
    assert.equal(write.reason, 'UNSAFE_WORKSPACE_PATH');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('secret/env/session fields are rejected rather than persisted', async () => {
  const root = await tempWorkspace();
  try {
    const record = { ...createSharedWorkspaceStatusRecord({ statusId: 'status-secret', timestampUtc: '2026-07-07T00:00:00Z' }), sessionToken: 'abc' };
    const validation = validateSharedWorkspaceRecord(record);
    assert.equal(validation.valid, false);
    assert.match(validation.refusalReason, /forbidden-secret-field/);
    assert.equal((await writeAtomicJson(root, ['status', 'status-secret.json'], record, { repoRoot: REPO_ROOT })).ok, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('OpenClaw default capability remains design_only via /courier-open', () => {
  const record = createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: '2026-07-07T00:00:00Z', mode: 'source_writer', trustedBuilder: true });
  assert.deepEqual(OPENCLAW_DEFAULT_CAPABILITY, { agentId: 'openclaw', mode: 'design_only', boundedWritePath: '/courier-open', trustedBuilder: false, mergeAuthority: false, arbitraryShellAllowed: false });
  assert.equal(record.mode, 'design_only');
  assert.equal(record.boundedWritePath, '/courier-open');
  assert.equal(record.trustedBuilder, false);
  assert.equal(validateSharedWorkspaceRecord(record).valid, true);
});
