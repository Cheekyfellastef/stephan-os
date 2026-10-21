import test from 'node:test';
import assert from 'node:assert/strict';
import { checkParallelSeedModelResourceV1, isParallelSeedGovernorSnapshotFreshV1, isParallelSeedLocalWorkAllowedV1, SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED } from './seedCanopyParallelResourceV1.mjs';

test('source write custody remains uncommissioned independently of model residency', () => {
  assert.equal(SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED, false);
});

const NOW = Date.parse('2026-10-13T16:00:00.000Z');
const idle = { schemaVersion: 'stephanos.vr-resource-governor.v1',
  active: false, phase: 'NORMAL', localModelAllowed: true, updatedAtUtc: new Date(NOW - 1000).toISOString() };
const loaded = { data: [{ id: 'qwen3-coder:30b', status: { value: 'loaded', args: ['llama-server', '-ctx', '4096'] } }] };

test('resident router remains held without canonical governor custody even with fresh idle proof', () => {
  const result = checkParallelSeedModelResourceV1({
    governor: idle, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasonCodes.includes('RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED'));
  assert.equal(result.residencyCustodyProven, false);
  assert.equal(result.alreadyLoaded, true);
  assert.equal(result.addedModelResidencyAllowed, false);
});

test('missing, gaming-protected or stale local model evidence must not start heavyweight inference', () => {
  const changes = [
    { governor: null },
    { governor: { ...idle, active: true, localModelAllowed: false } },
    { governor: { ...idle, active: false, phase: 'GAMING' } },
    { governor: { ...idle, active: false, phase: 'COOLDOWN' } },
    { governor: { ...idle, localModelAllowed: false } },
    { governor: { ...idle, schemaVersion: 'unknown' } },
    { governor: { ...idle, updatedAtUtc: new Date(NOW - 60000).toISOString() } },
    { governor: { ...idle, updatedAtUtc: new Date(NOW + 2000).toISOString() } },
    { governor: { ...idle, updatedAtUtc: '' } },
    { modelInventory: { data: [] } },
    { modelInventory: { data: [{ id: 'other-heavy-model:30b', status: { value: 'loaded' } }] } },
    { modelInventory: { data: [{ id: 'qwen3-coder:30b', status: { value: 'unloaded' } }] } },
    { modelInventory: { data: [{ id: 'qwen3-coder:30b', status: { value: 'loaded', args: ['llama-server', '--sleep-idle-seconds=10'] } }] } },
    { modelInventory: { data: [{ id: 'qwen3-coder:30b', status: { value: 'loaded' } }] } },
    { selectedModel: 'http://not-local.example' },
    { selectedModel: '' },
  ];
  for (const delta of changes) {
    const result = checkParallelSeedModelResourceV1({
      governor: idle, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', ...delta,
    });
    assert.equal(result.ok, false, JSON.stringify(delta));
    assert.ok(result.reasonCodes.length > 0);
  }
});

test('a live canonical reconcile can restore idle freshness without trusting stale or gaming snapshots', () => {
  const stale = { ...idle, updatedAtUtc: new Date(NOW - 60000).toISOString() };
  assert.equal(isParallelSeedGovernorSnapshotFreshV1(stale, NOW), false);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: stale, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, false);
  const reconciled = { ...stale, updatedAtUtc: new Date(NOW).toISOString() };
  assert.equal(isParallelSeedGovernorSnapshotFreshV1(reconciled, NOW), true);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: reconciled, modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, false);
  assert.equal(checkParallelSeedModelResourceV1({
    governor: { ...reconciled, active: true, localModelAllowed: false },
    modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
  }).ok, false, 'fresh active game always retains resource protection');
  assert.equal(isParallelSeedGovernorSnapshotFreshV1({
    ...reconciled, updatedAtUtc: new Date(NOW + 1).toISOString(),
  }, NOW), false, 'future proof is not admissible');
});

test('local post-inference test stage parks on game, cooldown, stale or corrupt governor proof', () => {
  assert.equal(isParallelSeedLocalWorkAllowedV1(idle, NOW), true);
  for (const state of [
    null, {}, { ...idle, phase: 'GAMING' }, { ...idle, phase: 'COOLDOWN' },
    { ...idle, active: true }, { ...idle, localModelAllowed: false },
    { ...idle, updatedAtUtc: new Date(NOW - 31000).toISOString() },
  ]) assert.equal(isParallelSeedLocalWorkAllowedV1(state, NOW), false);
});

test('direct autoload-capable Ollama generation is not an admissible Seed Forge route', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../../scripts/seed-canopy-parallel-builder.mjs', import.meta.url), 'utf8');
  assert.match(worker, /\/v1\/completions\?autoload=false/);
  assert.match(worker, /GAME_PRIORITY_ABORTED_LOCAL_INFERENCE/);
  assert.match(worker, /clearInterval\(gameWatch\)/);
  assert.match(worker, /const refreshWatch = process\.platform === 'win32' \? setInterval/);
  assert.match(worker, /GAME_PRIORITY_GOVERNOR_LIVE_REFRESH_FAILED/);
  assert.match(worker, /if \(refreshWatch\) clearInterval\(refreshWatch\)/);
  assert.match(worker, /if \(gamingGuarded\) await assertHeavyLocalGamingHeadroom\(\)/);
  assert.match(worker, /GAME_PRIORITY_LOCAL_TEST_ABORTED/);
  assert.match(worker, /await processExec\(process\.execPath, \['--test', path\], worktree, 120000, true\)/);
  assert.doesNotMatch(worker, /'\/api\/generate'/);
  assert.doesNotMatch(worker, /'\/api\/ps'/);
});

test('both local model HTTP calls reject redirects rather than forwarding source to a remote host', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../../scripts/seed-canopy-parallel-builder.mjs', import.meta.url), 'utf8');
  // Inventory and completion requests may carry non-public model identity or source.
  // A malicious or stale local proxy must not redirect either request off-host.
  const loopbackCalls = [...worker.matchAll(/fetch\('http:\/\/127\.0\.0\.1:' \+ port \+ '([^']+)', \{([\s\S]*?)\n    \}\);/g)];
  assert.equal(loopbackCalls.length, 2, 'only the two fixed loopback model calls are expected');
  assert.deepEqual(loopbackCalls.map((match) => match[1]).sort(),
    ['/models', '/v1/completions?autoload=false']);
  for (const match of loopbackCalls) {
    assert.match(match[2], /^\s*(?:\/\/[^\n]*\n\s*)*redirect: 'error',/);
    assert.doesNotMatch(match[2], /redirect:\s*'follow'/);
  }
});

test('Seed Forge file write rejects physical junction aliases as well as symlinks', async () => {
  const { readFile } = await import('node:fs/promises');
  const worker = await readFile(new URL('../../scripts/seed-canopy-parallel-builder.mjs', import.meta.url), 'utf8');
  assert.match(worker, /SEED_WORKTREE_ROOT_REDIRECTED/);
  assert.match(worker, /SEED_TARGET_PARENT_PHYSICAL_REDIRECT/);
  assert.match(worker, /SEED_TARGET_LEAF_PHYSICAL_REDIRECT/);
  assert.match(worker, /await realpath\(current\)/);
  assert.match(worker, /await realpath\(full\)/);
  assert.match(worker, /await realpath\(root\)/);
  assert.match(worker, /await mkdir\(dirname\(target\), \{ recursive: true \}\);[\s\S]*await safeTarget\(worktree, request\.targetPath\)/);
  assert.match(worker, /await writeFile\(writeTarget, proposal\.content/);
  assert.match(worker, /SEED_SOURCE_TRACKED_ORIGIN_MAIN_MISMATCH/);
});
