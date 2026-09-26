import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BATTLE_BRIDGE_RUNTIME_DATA_PATHS,
  BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
  preserveBattleBridgeDirtyData,
} from './battleBridgeDirtyDataPreservationV1.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'stephanos-preserve-'));
  const repoRoot = path.join(root, 'repo');
  const workspaceRoot = path.join(root, 'workspace');
  await mkdir(repoRoot);
  await mkdir(workspaceRoot);
  for (const [index, relativePath] of BATTLE_BRIDGE_RUNTIME_DATA_PATHS.entries()) {
    const target = path.join(repoRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ index, relativePath })}\n`);
  }
  return {
    root,
    repoRoot,
    workspaceRoot,
    statusLines: [
      ' M apps/stephanos/dist/index.html',
      ' M stephanos-server/data/memory/durable-memory.json',
      ...BATTLE_BRIDGE_RUNTIME_DATA_PATHS.map((relativePath) => `?? ${relativePath}`),
      '?? memory/.dreams/events.jsonl',
    ],
  };
}

function preserve(fx, overrides = {}) {
  return preserveBattleBridgeDirtyData({
    repoRoot: fx.repoRoot,
    workspaceRoot: fx.workspaceRoot,
    expectedRepoRoot: fx.repoRoot,
    expectedWorkspaceRoot: fx.workspaceRoot,
    profile: BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE,
    operatorApproval: 'operator-approved',
    statusLines: fx.statusLines,
    sourceHead: 'a'.repeat(40),
    now: new Date('2026-08-24T07:00:00.000Z'),
    ...overrides,
  });
}

test('fixed profile preserves exactly six untracked runtime-data files with verified hashes', async () => {
  const fx = await fixture();
  try {
    const result = preserve(fx);
    assert.equal(result.ok, true);
    assert.equal(result.receipt.itemCount, 6);
    assert.equal(result.receipt.allHashesVerified, true);
    assert.equal(result.trackedSourceMutationPerformed, false);
    assert.equal(result.destructiveCleanupPerformed, false);
    for (const item of result.receipt.items) {
      assert.equal(existsSync(path.join(fx.repoRoot, item.relativePath)), false);
      const destination = path.join(result.preservationRoot, item.destinationRelativePath);
      assert.equal(existsSync(destination), true);
      assert.equal(item.byteLength, Buffer.byteLength(readFileSync(destination)));
      assert.match(item.sha256, /^[a-f0-9]{64}$/);
      assert.equal(item.verified, true);
    }
    const durable = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
    assert.equal(durable.profile, BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE);
    assert.equal(durable.itemCount, 6);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('missing approval, extra source dirt, and destination reuse all fail before moving files', async () => {
  for (const mutate of [
    (fx) => ({ operatorApproval: '' }),
    (fx) => ({ statusLines: [...fx.statusLines, '?? data/unapproved.json'] }),
    (fx) => {
      const destination = path.join(
        fx.workspaceRoot,
        'preserved-source-dirt',
        `${BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE}-2026-08-24T07-00-00-000Z`,
      );
      return mkdir(destination, { recursive: true }).then(() => ({}));
    },
  ]) {
    const fx = await fixture();
    try {
      const overrides = await mutate(fx);
      const result = preserve(fx, overrides);
      assert.equal(result.ok, false);
      assert.equal(result.fileMovePerformed, false);
      for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
        assert.equal(existsSync(path.join(fx.repoRoot, relativePath)), true);
      }
    } finally {
      await rm(fx.root, { recursive: true, force: true });
    }
  }
});

test('caller-selected profiles and non-canonical roots are rejected', async () => {
  const fx = await fixture();
  try {
    assert.equal(preserve(fx, { profile: 'caller-selected' }).blocker, 'PRESERVATION_PROFILE_NOT_ALLOWED');
    assert.equal(preserve(fx, { expectedRepoRoot: path.join(fx.root, 'other') }).blocker, 'NON_CANONICAL_REPOSITORY_PATH');
    assert.equal(preserve(fx, { expectedWorkspaceRoot: path.join(fx.root, 'other') }).blocker, 'NON_CANONICAL_WORKSPACE_PATH');
    assert.equal(preserve(fx, { sourceHead: 'not-an-exact-head' }).blocker, 'PRESERVATION_SOURCE_HEAD_INVALID');
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});
