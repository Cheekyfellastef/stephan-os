import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  inspectRescueIslandLocalBoundaryV1 as probe,
  RESCUE_ISLAND_BOUNDARY_PROBE_MARKER as MARKER,
} from './rescue-island-boundary-probe.mjs';

async function fixture(t) {
  const outer = await realpath(await mkdtemp(join(tmpdir(), 'rescue-island-fixed-probe-')));
  t.after(() => rm(outer, { recursive: true, force: true }));
  const root = join(outer, 'canonical');
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, 'docs', 'architecture'), { recursive: true });
  await mkdir(join(root, 'shared', 'agents'), { recursive: true });
  for (const name of ['rescueIslandFirstCommitV1.mjs', 'rescueIslandPreflightV1.test.mjs'])
    await writeFile(join(root, 'shared', 'agents', name), '// fixture\n');
  return { outer, root };
}

test('fixed native readback is a useful physical check without any writer authority', async t => {
  const { root } = await fixture(t);
  const result = await probe(root);
  assert.equal(result.ok, true);
  assert.equal(result.observedPathCount, 3);
  assert.equal(result.finalVerdict, 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED');
  assert.equal(result.publicReceiptSafe, true);
  for (const field of ['sourceMutationAllowed', 'workerStartAllowed',
    'independentOwnershipAuthenticated', 'gamingBudgetAuthenticated',
    'originalSourceLeaseReleaseAllowed', 'seedForgeQueueAccessAllowed', 'mergeAllowed'])
    assert.equal(result[field], false, field);
});

test('malicious redirected canonical ancestor must fail without a mutable child', async t => {
  const { outer, root } = await fixture(t);
  await rm(join(root, 'docs', 'architecture'), { recursive: true });
  await symlink(outer, join(root, 'docs', 'architecture'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await probe(root);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'RESCUE_ISLAND_SCOPE_REDIRECTED');
  assert.equal(result.workerStartAllowed, false);
});

test('no untrusted scan may substitute owner authority or bypass its bounded path set', async () => {
  const paths = [];
  const spoof = await probe('/tmp/fixed-only', {
    scan: async input => {
      paths.push(...input.paths);
      return {
        schemaVersion: 'stephanos.rescue-island-physical-scope-observation.v1',
        ok: true,
        observationIsAuthoritative: true,
        sourceMutationAllowed: true,
        workerStartAllowed: true,
        leaseReleaseAllowed: true,
        observedPathCount: 3,
      };
    },
  });
  assert.equal(paths.length, 3);
  assert.deepEqual(paths, [
    'docs/architecture/rescue-island-pilot-pilot-3109-01.md',
    'shared/agents/rescueIslandFirstCommitV1.mjs',
    'shared/agents/rescueIslandPreflightV1.test.mjs',
  ]);
  assert.equal(spoof.ok, false);
  assert.equal(spoof.sourceMutationAllowed, false);
  const failed = await probe('/tmp/fixed-only', { scan: async () => { throw new Error('private path'); } });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes('private path'), false);
});

test('production CLI refuses dynamic arguments and keeps its one-line bounded marker', () => {
  const source = fileURLToPath(new URL('./rescue-island-boundary-probe.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [source, '--write', 'C:/unapproved'], {
    encoding: 'utf8', shell: false, timeout: 10000,
  });
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].startsWith(MARKER), true);
  const parsed = JSON.parse(lines[0].slice(MARKER.length));
  assert.equal(parsed.blocker, 'RESCUE_ISLAND_PROBE_ARGUMENTS_FORBIDDEN');
  assert.equal(parsed.sourceMutationAllowed, false);
});


test('local scanner reports only source-typed OS denial, never host filenames', async t => {
  const { root } = await fixture(t);
  const denied = await probe(root, { scan: async () => ({
    schemaVersion: 'stephanos.rescue-island-physical-scope-observation.v1',
    ok: false, blocker: 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED',
  }) });
  assert.equal(denied.ok, false);
  assert.equal(denied.blocker, 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED');
  assert.equal(denied.observedPathCount, 0);
  assert.equal(denied.workerStartAllowed, false);
  const unknown = await probe(root, { scan: async () => ({
    schemaVersion: 'stephanos.rescue-island-physical-scope-observation.v1',
    ok: false, blocker: 'NATIVE_PRIVATE_ERROR_DETAIL',
  }) });
  assert.equal(unknown.blocker, 'OS_SCOPE_OBSERVATION_HELD');
  assert.doesNotMatch(JSON.stringify(unknown), /NATIVE_PRIVATE/);
});
