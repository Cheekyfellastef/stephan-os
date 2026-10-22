import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  observeRescueIslandPhysicalScopesV1 as observe,
  RESCUE_ISLAND_PHYSICAL_SCOPE_MAX_PATHS as MAX,
} from './rescueIslandPhysicalScopeObservationV1.mjs';

async function fixture(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'rescue-island-physical-scope-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const repositoryRoot = join(parent, 'canonical');
  await mkdir(join(repositoryRoot, '.git'), { recursive: true });
  await mkdir(join(repositoryRoot, 'docs', 'architecture'), { recursive: true });
  await writeFile(join(repositoryRoot, 'docs', 'architecture', 'existing.md'), '# Existing\n');
  return { parent, repositoryRoot };
}

const proposed = 'docs/architecture/rescue-island-pilot-pilot-3109-01.md';
test('read-only physical scope census covers an existing file and a missing leaf', async (t) => {
  const { repositoryRoot } = await fixture(t);
  const result = await observe({ repositoryRoot, paths: ['docs/architecture/existing.md', proposed] });
  assert.equal(result.ok, true);
  assert.equal(result.scopeResolutionScan, 'LOCAL_READ_ONLY_UNAUTHENTICATED');
  assert.equal(result.observedPathCount, 2);
  assert.deepEqual(result.scopeResolutions.map((x) => x.missingLeafOrAncestor), [false, true]);
  assert.equal(result.scopeResolutions[1].canonicalPath, proposed);
  for (const key of ['observationIsAuthoritative', 'ownershipAuthenticated', 'gamingBudgetAuthenticated',
    'sourceMutationAllowed', 'workerStartAllowed', 'mergeAllowed', 'leaseReleaseAllowed'])
    assert.equal(result[key], false, key);
});

test('reject path traversal, nonstring identities, duplicate case aliases and unbounded scope', async (t) => {
  const { repositoryRoot } = await fixture(t);
  for (const paths of [
    [], ['../outside.md'], ['docs//architecture/a.md'], ['docs/./a.md'],
    ['docs/../a.md'], ['.git/config'], ['docs/a.md', 'DOCS/A.MD'],
    ['node_modules/a.js'], [['docs/a.md']], [{ toString: () => proposed }],
    new Array(MAX + 1).fill(proposed), 'not-an-array',
  ]) {
    const result = await observe({ repositoryRoot, paths });
    assert.equal(result.ok, false, JSON.stringify(paths));
    assert.equal(result.blocker, 'RESCUE_ISLAND_SCOPE_INPUT_INVALID');
    assert.equal(result.sourceMutationAllowed, false);
  }
});

test('reject external symlink alias and a redirected existing scope parent', async (t) => {
  const { parent, repositoryRoot } = await fixture(t);
  const outside = join(parent, 'outside');
  await mkdir(outside);
  await symlink(outside, join(repositoryRoot, 'outside-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const direct = await observe({ repositoryRoot, paths: ['outside-alias/secret.md'] });
  assert.equal(direct.ok, false);
  assert.equal(direct.blocker, 'RESCUE_ISLAND_SCOPE_REDIRECTED');
  const inRepoLink = join(repositoryRoot, 'docs', 'link');
  await symlink(join(repositoryRoot, 'docs', 'architecture'), inRepoLink, process.platform === 'win32' ? 'junction' : 'dir');
  const internal = await observe({ repositoryRoot, paths: ['docs/link/existing.md'] });
  assert.equal(internal.ok, false);
  assert.equal(internal.blocker, 'RESCUE_ISLAND_SCOPE_REDIRECTED');
});

test('reject an existing regular file acting as a parent or an untrusted .git root', async (t) => {
  const { repositoryRoot } = await fixture(t);
  const badParent = await observe({ repositoryRoot, paths: ['docs/architecture/existing.md/child.md'] });
  assert.equal(badParent.ok, false);
  assert.equal(badParent.blocker, 'RESCUE_ISLAND_SCOPE_PARENT_NOT_DIRECTORY');
  await rm(join(repositoryRoot, '.git'), { recursive: true });
  const badGit = await observe({ repositoryRoot, paths: [proposed] });
  assert.equal(badGit.ok, false);
  assert.equal(badGit.blocker, 'RESCUE_ISLAND_SCOPE_OS_OBSERVATION_FAILED');
});

test('a previously safe scan does not allow a later redirected path', async (t) => {
  const { parent, repositoryRoot } = await fixture(t);
  const path = 'docs/new-dir/proposal.md';
  const before = await observe({ repositoryRoot, paths: [path] });
  assert.equal(before.ok, true);
  assert.equal(before.scopeResolutions[0].missingLeafOrAncestor, true);
  await symlink(parent, join(repositoryRoot, 'docs', 'new-dir'), process.platform === 'win32' ? 'junction' : 'dir');
  const after = await observe({ repositoryRoot, paths: [path] });
  assert.equal(after.ok, false);
  assert.equal(after.blocker, 'RESCUE_ISLAND_SCOPE_REDIRECTED');
  assert.equal(after.workerStartAllowed, false);
});

test('reject a redirected canonical repository root itself', async (t) => {
  const { parent, repositoryRoot } = await fixture(t);
  await symlink(repositoryRoot, join(parent, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await observe({ repositoryRoot: join(parent, 'alias'), paths: [proposed] });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'RESCUE_ISLAND_REPOSITORY_ROOT_UNTRUSTED');
});
