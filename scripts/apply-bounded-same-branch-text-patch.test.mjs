import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./apply-bounded-same-branch-text-patch.mjs', import.meta.url);
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function fixture(source) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-bounded-patch-'));
  git(root, 'init', '-b', 'bounded-test');
  git(root, 'config', 'user.email', 'bounded-test@example.invalid');
  git(root, 'config', 'user.name', 'Bounded Patch Test');
  const path = join(root, 'target.txt');
  await writeFile(path, source, 'utf8');
  git(root, 'add', 'target.txt');
  git(root, 'commit', '-m', 'fixture');
  return { root, path, head: git(root, 'rev-parse', 'HEAD') };
}

function run(root, path, expected, oldText, newText, branch = 'bounded-test', head = git(root, 'rev-parse', 'HEAD')) {
  return spawnSync(process.execPath, [script.pathname, path, expected, oldText, newText, branch, head], { cwd: root, encoding: 'utf8' });
}

test('applies exactly one replacement to a tracked file on exact branch and head', async (t) => {
  const original = 'alpha\nunique target\nomega\n';
  const { root, path, head } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = run(root, 'target.txt', sha256(original), 'unique target', 'bounded replacement', 'bounded-test', head);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path, 'utf8'), 'alpha\nbounded replacement\nomega\n');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.verdict, 'BOUNDED_SAME_BRANCH_PATCH_APPLIED');
  assert.equal(receipt.filePath, 'target.txt');
  assert.equal(receipt.branch, 'bounded-test');
  assert.equal(receipt.head, head);
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
  const result = run(root, 'target.txt', sha256('different source'), 'target', 'replacement');
  assert.equal(result.status, 5);
  assert.match(result.stderr, /file identity changed/);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('refuses ambiguous and missing targets without modifying the file', async (t) => {
  const original = 'target\nmiddle\ntarget\n';
  const { root, path } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  let result = run(root, 'target.txt', sha256(original), 'target', 'replacement');
  assert.equal(result.status, 4);
  assert.match(result.stderr, /target is not unique/);
  assert.equal(await readFile(path, 'utf8'), original);
  result = run(root, 'target.txt', sha256(original), 'missing', 'replacement');
  assert.equal(result.status, 3);
  assert.match(result.stderr, /target not found/);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('refuses wrong branch or stale head', async (t) => {
  const original = 'alpha\ntarget\nomega\n';
  const { root, path, head } = await fixture(original);
  t.after(() => rm(root, { recursive: true, force: true }));
  let result = run(root, 'target.txt', sha256(original), 'target', 'replacement', 'other-branch', head);
  assert.equal(result.status, 7);
  assert.match(result.stderr, /branch identity changed/);
  result = run(root, 'target.txt', sha256(original), 'target', 'replacement', 'bounded-test', '0'.repeat(40));
  assert.equal(result.status, 8);
  assert.match(result.stderr, /head identity changed/);
  assert.equal(await readFile(path, 'utf8'), original);
});

test('refuses untracked, traversal, absolute outside, and symlink-escape targets', async (t) => {
  const original = 'alpha\ntarget\nomega\n';
  const { root, path, head } = await fixture(original);
  const outsideRoot = await mkdtemp(join(tmpdir(), 'stephanos-bounded-patch-outside-'));
  const outside = join(outsideRoot, 'outside.txt');
  await writeFile(outside, original, 'utf8');
  const untracked = join(root, 'untracked.txt');
  await writeFile(untracked, original, 'utf8');
  const link = join(root, 'escape.txt');
  await symlink(outside, link);
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outsideRoot, { recursive: true, force: true })]));

  for (const candidate of ['untracked.txt', outside, join('..', outsideRoot.split('/').pop(), 'outside.txt'), 'escape.txt']) {
    const result = run(root, candidate, sha256(original), 'target', 'replacement', 'bounded-test', head);
    assert.equal(result.status, 9, `${candidate}: ${result.stderr}`);
  }
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(await readFile(outside, 'utf8'), original);
});