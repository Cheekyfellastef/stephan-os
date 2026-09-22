#!/usr/bin/env node
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const [filePath, expectedSha256, oldText, newText, expectedBranch, expectedHead] = process.argv.slice(2);

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) fail(6, `PATCH_REFUSED: git proof failed: ${result.stderr.trim() || args.join(' ')}`);
  return result.stdout.trim();
}

if (!filePath || !expectedSha256 || oldText === undefined || newText === undefined || !expectedBranch || !expectedHead) {
  fail(2, 'usage: node scripts/apply-bounded-same-branch-text-patch.mjs <tracked-file> <expected-sha256> <exact-old-text> <replacement-text> <expected-branch> <expected-head>');
}
if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) fail(2, 'PATCH_REFUSED: expected sha256 must be exactly 64 hex characters');
if (!/^[a-f0-9]{40}$/i.test(expectedHead)) fail(2, 'PATCH_REFUSED: expected head must be exactly 40 hex characters');
if (oldText.length === 0) fail(2, 'PATCH_REFUSED: exact old text must not be empty');

const repositoryRoot = await realpath(git(['rev-parse', '--show-toplevel'], process.cwd()));
const currentBranch = git(['branch', '--show-current'], repositoryRoot);
const currentHead = git(['rev-parse', 'HEAD'], repositoryRoot);
if (currentBranch !== expectedBranch) fail(7, `PATCH_REFUSED: branch identity changed expected=${expectedBranch} actual=${currentBranch || '(detached)'}`);
if (currentHead.toLowerCase() !== expectedHead.toLowerCase()) fail(8, `PATCH_REFUSED: head identity changed expected=${expectedHead.toLowerCase()} actual=${currentHead.toLowerCase()}`);

const requestedPath = resolve(repositoryRoot, filePath);
let targetPath;
try {
  targetPath = await realpath(requestedPath);
} catch {
  fail(9, 'PATCH_REFUSED: target must already exist');
}
const repositoryPrefix = repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`;
if (targetPath !== repositoryRoot && !targetPath.startsWith(repositoryPrefix)) fail(9, 'PATCH_REFUSED: target resolves outside repository checkout');
const trackedPath = relative(repositoryRoot, targetPath).split(sep).join('/');
if (!trackedPath || trackedPath.startsWith('../')) fail(9, 'PATCH_REFUSED: target is not a repository file');
const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', trackedPath], { cwd: repositoryRoot, encoding: 'utf8' });
if (tracked.status !== 0) fail(9, 'PATCH_REFUSED: target is not tracked by the exact checkout');

const source = await readFile(targetPath, 'utf8');
const actualSha256 = createHash('sha256').update(source, 'utf8').digest('hex');
if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) fail(5, `PATCH_REFUSED: file identity changed expected=${expectedSha256.toLowerCase()} actual=${actualSha256}`);
const first = source.indexOf(oldText);
if (first < 0) fail(3, 'PATCH_REFUSED: exact target not found');
if (source.indexOf(oldText, first + oldText.length) >= 0) fail(4, 'PATCH_REFUSED: exact target is not unique');

const updated = `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`;
await writeFile(targetPath, updated, 'utf8');
const resultSha256 = createHash('sha256').update(updated, 'utf8').digest('hex');
console.log(JSON.stringify({
  verdict: 'BOUNDED_SAME_BRANCH_PATCH_APPLIED',
  repositoryRoot,
  branch: currentBranch,
  head: currentHead,
  filePath: trackedPath,
  expectedSha256: expectedSha256.toLowerCase(),
  resultSha256,
  replacements: 1,
  mergeAuthority: false,
  deploymentAuthority: false,
  runtimeMutationAuthority: false,
  branchCreationAuthority: false,
  pullRequestCreationAuthority: false,
}));