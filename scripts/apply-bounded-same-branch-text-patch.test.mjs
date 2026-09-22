import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./apply-bounded-same-branch-text-patch.mjs', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

async function fixture(source) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-bounded-patch-'));
  const path = join(root, 'target.txt');
  await writeFile(path, source, 'utf8');
  return { root, path };
}

function run(path, expected, oldText, newText) {
  return spawnSync(process.execPath, [script.pathname, path, expected, oldText, newText], { encoding: 'utf8' });
}

test('applies exactly one replacement when file identity and target are exact', async (t) => {
  const original = 'alpha\nunique target\nomega\n';
  const { root, path } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = run(path, sha256(original), 'unique target', 'bounded replacement');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path, 'utf8'), 'alpha\nbounded replacement\nomega\n');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.verdict, 'BOUNDED_SAME_BRANCH_PATCH_APPLIED');
  assert.equal(receipt.replacements, 1);
  assert.equal(receipt.mergeAuthority, false);
  assert.equal(receipt.deploymentAuthority, false);
  assert.equal(receipt.runtimeMutationAuthority, false);
  assert.equal(receipt.branchCreationAuthority, false);
  assert.equal(receipt.pullRequestCreationAuthority, false);
});

test('refuses stale file identity without modifying the file', async (t) => {
  const original = 'alpha\ntarget\nomega\n';
  const { root, path } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = run(path, sha256('different source'), 'target', 'replacement');
  assert.equal(result.status, 5);
  assert.match(result.stderr, /file identity changed/);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('refuses an ambiguous target without modifying the file', async (t) => {
  const original = 'target\nmiddle\ntarget\n';
  const { root, path } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = run(path, sha256(original), 'target', 'replacement');
  assert.equal(result.status, 4);
  assert.match(result.stderr, /target is not unique/);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('refuses a missing target without modifying the file', async (t) => {
  const original = 'alpha\nomega\n';
  const { root, path } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = run(path, sha256(original), 'missing', 'replacement');
  assert.equal(result.status, 3);
  assert.match(result.stderr, /target not found/);
  assert.equal(await readFile(path, 'utf8'), original);
});