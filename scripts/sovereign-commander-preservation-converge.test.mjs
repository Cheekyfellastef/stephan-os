import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  executeSovereignPreservationConvergence,
  validatePreservationConvergenceRequest,
} from './sovereign-commander-preservation-converge.mjs';

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return String(result.stdout || '').trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-converge-test-'));
  const origin = join(root, 'origin.git');
  const seed = join(root, 'seed');
  const work = join(root, 'work');
  spawnSync('git', ['init', '--bare', origin], { encoding: 'utf8' });
  spawnSync('git', ['clone', origin, seed], { encoding: 'utf8' });
  git(seed, ['config', 'user.email', 'test@example.com']);
  git(seed, ['config', 'user.name', 'Stephanos Test']);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(seed, 'base.txt'), 'base\n'));
  git(seed, ['add', 'base.txt']);
  git(seed, ['commit', '-m', 'base']);
  git(seed, ['branch', '-M', 'main']);
  git(seed, ['push', '-u', 'origin', 'main']);
  const base = git(seed, ['rev-parse', 'HEAD']);
  git(seed, ['checkout', '-b', 'feature/test']);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(seed, 'feature.txt'), 'feature\n'));
  git(seed, ['add', 'feature.txt']);
  git(seed, ['commit', '-m', 'feature']);
  git(seed, ['push', '-u', 'origin', 'feature/test']);
  const featureHead = git(seed, ['rev-parse', 'HEAD']);
  git(seed, ['checkout', 'main']);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(join(seed, 'main.txt'), 'main moved\n'));
  git(seed, ['add', 'main.txt']);
  git(seed, ['commit', '-m', 'main moved']);
  git(seed, ['push', 'origin', 'main']);
  const mainHead = git(seed, ['rev-parse', 'HEAD']);
  spawnSync('git', ['clone', origin, work], { encoding: 'utf8' });
  git(work, ['config', 'user.email', 'test@example.com']);
  git(work, ['config', 'user.name', 'Stephanos Test']);
  return { root, origin, seed, work, base, featureHead, mainHead };
}

test('request validator rejects protected branch and malformed heads', () => {
  const blocked = validatePreservationConvergenceRequest({
    prNumber: 2561,
    branch: 'main',
    expectedHead: 'x',
    expectedMain: 'y',
  });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.includes('target-branch-invalid-or-protected'));
  assert.ok(blocked.blockers.includes('expected-head-invalid'));
  assert.ok(blocked.blockers.includes('expected-main-invalid'));
});

test('Sovereign preservation convergence non-force merges main into the existing branch', async () => {
  const fx = await fixture();
  let receipt = null;
  try {
    const result = await executeSovereignPreservationConvergence({
      repoRoot: fx.work,
      prNumber: 2561,
      branch: 'feature/test',
      expectedHead: fx.featureHead,
      expectedMain: fx.mainHead,
      gitExecutable: 'git',
      publishReceipt: async (value) => {
        receipt = value;
        return { ok: true, path: 'test' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalVerdict, 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE');
    assert.equal(result.oldHead, fx.featureHead);
    assert.equal(result.protectedMainHead, fx.mainHead);
    assert.notEqual(result.newHead, fx.featureHead);
    assert.equal(result.pushed, true);
    assert.equal(result.nonForcePushOnly, true);
    assert.equal(result.forcePushAllowed, false);
    assert.equal(result.rebaseAllowed, false);
    assert.equal(result.resetAllowed, false);
    assert.equal(result.directMainWriteAllowed, false);
    assert.equal(git(fx.seed, ['fetch', 'origin', 'feature/test']), '');
    const remoteHead = git(fx.seed, ['rev-parse', 'refs/remotes/origin/feature/test']);
    assert.equal(remoteHead, result.newHead);
    assert.equal(git(fx.seed, ['merge-base', '--is-ancestor', fx.featureHead, remoteHead]), '');
    assert.equal(git(fx.seed, ['merge-base', '--is-ancestor', fx.mainHead, remoteHead]), '');
    assert.equal(receipt.proofHash, result.proofHash);
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('writer race fails closed before push', async () => {
  const fx = await fixture();
  try {
    git(fx.seed, ['checkout', 'feature/test']);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(join(fx.seed, 'race.txt'), 'race\n'));
    git(fx.seed, ['add', 'race.txt']);
    git(fx.seed, ['commit', '-m', 'race']);
    git(fx.seed, ['push', 'origin', 'feature/test']);
    const result = await executeSovereignPreservationConvergence({
      repoRoot: fx.work,
      prNumber: 2561,
      branch: 'feature/test',
      expectedHead: fx.featureHead,
      expectedMain: fx.mainHead,
      gitExecutable: 'git',
      publishReceipt: async () => ({ ok: true }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_PRESERVATION_CONVERGENCE_BRANCH_MOVED');
  } finally {
    await rm(fx.root, { recursive: true, force: true });
  }
});

test('source contains no rebase reset force-push or direct-main push path', async () => {
  const source = await readFile(new URL('./sovereign-commander-preservation-converge.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /push[^\n]*--force|force-with-lease|\brebase\b|\breset\b/i);
  assert.doesNotMatch(source, /HEAD:refs\/heads\/main/);
  assert.match(source, /push', 'origin', `HEAD:refs\/heads\/\$\{request\.branch\}`/);
});
