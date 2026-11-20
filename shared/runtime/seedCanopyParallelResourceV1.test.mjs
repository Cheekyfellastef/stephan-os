import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { checkParallelSeedModelResourceV1, isParallelSeedGovernorSnapshotFreshV1, isParallelSeedLocalWorkAllowedV1, SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED, SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED } from './seedCanopyParallelResourceV1.mjs';

test('source write custody remains uncommissioned independently of model residency', () => {
  assert.equal(SEED_PARALLEL_TARGET_WRITE_CUSTODY_IMPLEMENTED, false);
});

const NOW = Date.parse('2026-10-13T16:00:00.000Z');
const idle = { schemaVersion: 'stephanos.vr-resource-governor.v1',
  active: false, phase: 'NORMAL', localModelAllowed: true, prepareLeaseActive: false, updatedAtUtc: new Date(NOW - 1000).toISOString() };
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

test('local work requires explicit inactive gaming preparation lease evidence', () => {
  assert.equal(isParallelSeedLocalWorkAllowedV1(idle, NOW), true);
  for (const value of [true, undefined, null, 'false', 0, {}, []]) {
    assert.equal(isParallelSeedLocalWorkAllowedV1({ ...idle, prepareLeaseActive: value }, NOW), false,
      'preparation lease must be explicitly false: ' + String(value));
  }
  const missing = { ...idle };
  delete missing.prepareLeaseActive;
  assert.equal(isParallelSeedLocalWorkAllowedV1(missing, NOW), false);
});

const preparationLeaseCases = [
  ['inactive', false], ['active', true], ['undefined', undefined], ['null', null],
  ['string', 'false'], ['number', 0], ['object', {}], ['array', []], ['absent'],
];

function preparationLeaseGovernor([name, value]) {
  const governor = { ...idle, prepareLeaseActive: value };
  if (name === 'absent') delete governor.prepareLeaseActive;
  return governor;
}

test('model preflight identifies unsafe preparation leases independently of the custody hold', async (t) => {
  assert.equal(SEED_PARALLEL_ROUTER_GOVERNOR_CUSTODY_IMPLEMENTED, false);
  for (const leaseCase of preparationLeaseCases) {
    await t.test(leaseCase[0], () => {
      const result = checkParallelSeedModelResourceV1({
        governor: preparationLeaseGovernor(leaseCase),
        modelInventory: loaded, selectedModel: 'qwen3-coder:30b', nowMs: NOW,
      });
      assert.equal(result.ok, false, 'production residency custody stays uncommissioned');
      assert.ok(result.reasonCodes.includes('RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED'));
      assert.equal(result.reasonCodes.includes('VR_OR_GAMING_MODEL_PROTECTION_ACTIVE'),
        leaseCase[0] !== 'inactive', 'custody denial must not conceal a missing lease decision');
    });
  }
});

async function runInferenceWatcherFixture(watcherMs, {
  governors = [idle], readError = false, reconcileError = false, ticks = 1,
} = {}) {
  const worker = await readFile(new URL('../../scripts/seed-canopy-parallel-builder.mjs', import.meta.url), 'utf8');
  const start = worker.indexOf('async function localModelWrite(');
  const end = worker.indexOf('\nasync function safeTarget(', start);
  assert.ok(start >= 0 && end > start, 'exercise the complete existing inference function');
  const callbacks = new Map();
  const clearedIntervals = [];
  const clearedTimeouts = [];
  let reads = 0, reconciles = 0, signal;
  const proposal = { path: 'docs/fixture.md', content: '# Fixture\n' };
  // Run the actual inference function with bounded in-memory dependencies.
  // The preflight stub isolates its running-inference watchers; it neither
  // changes the production custody constants nor starts a model or Windows command.
  const localModelWrite = runInNewContext('(' + worker.slice(start, end) + ')', {
    localModelPreflight: async () => ({ model: 'fixture-model', port: 8080 }),
    AbortController,
    setTimeout: () => 120000,
    clearTimeout: (id) => clearedTimeouts.push(id),
    setInterval: (callback, ms) => { callbacks.set(ms, callback); return ms; },
    clearInterval: (id) => clearedIntervals.push(id),
    process: { platform: 'win32' },
    repoRoot: '/fixture', governorFile: '/fixture/governor.json',
    join: (...parts) => parts.join('/'),
    readFile: async () => {
      const governor = governors[Math.min(reads++, governors.length - 1)];
      if (readError) throw new Error('fixture governor read failure');
      return JSON.stringify(governor);
    },
    processExec: async () => {
      reconciles += 1;
      if (reconcileError) throw new Error('fixture reconcile failure');
    },
    isParallelSeedGovernorSnapshotFreshV1: (governor) =>
      isParallelSeedGovernorSnapshotFreshV1(governor, NOW),
    fetch: async (_url, options) => {
      signal = options.signal;
      assert.deepEqual([...callbacks.keys()].sort((a, b) => a - b), [500, 15000]);
      for (let tick = 0; tick < ticks; tick += 1) await callbacks.get(watcherMs)();
      if (signal.aborted) throw new Error('fixture request aborted');
      return { ok: true, json: async () => ({ choices: [{ text: JSON.stringify(proposal) }] }) };
    },
    parseParallelSeedModelResponseV1: (text) => JSON.parse(text),
  }, { timeout: 1000 });
  let result, error = '';
  try {
    result = await localModelWrite(
      { targetPath: proposal.path, intent: 'fixture only' }, '',
      { title: 'Fixture', seedId: 'fixture', issue: '#3096', source: 'fixture' },
      { model: 'fixture-model', port: 8080 },
    );
  } catch (caught) {
    error = caught.message;
  }
  assert.deepEqual(clearedIntervals.sort((a, b) => a - b), [500, 15000]);
  assert.deepEqual(clearedTimeouts, [120000]);
  return { result, error, aborted: signal?.aborted, reads, reconciles, proposal };
}

for (const [watcherName, watcherMs] of [['gameWatch', 500], ['refreshWatch', 15000]]) {
  test(watcherName + ' aborts unsafe preparation leases and continues only on explicit false', async (t) => {
    for (const leaseCase of preparationLeaseCases) {
      await t.test(leaseCase[0], async () => {
        const observed = await runInferenceWatcherFixture(watcherMs, {
          governors: [preparationLeaseGovernor(leaseCase)],
        });
        const allowed = leaseCase[0] === 'inactive';
        assert.equal(observed.aborted, !allowed);
        assert.equal(observed.error, allowed ? '' : 'GAME_PRIORITY_ABORTED_LOCAL_INFERENCE');
        assert.deepEqual(observed.result, allowed ? observed.proposal : undefined);
        assert.equal(observed.reads, 1);
        assert.equal(observed.reconciles, watcherMs === 15000 ? 1 : 0);
      });
    }
    await t.test('new active lease aborts after an allowed tick', async () => {
      const observed = await runInferenceWatcherFixture(watcherMs, {
        governors: [idle, { ...idle, prepareLeaseActive: true }], ticks: 2,
      });
      assert.equal(observed.aborted, true);
      assert.equal(observed.error, 'GAME_PRIORITY_ABORTED_LOCAL_INFERENCE');
      assert.equal(observed.result, undefined);
      assert.equal(observed.reads, 2);
      assert.equal(observed.reconciles, watcherMs === 15000 ? 2 : 0);
    });
    await t.test('unreadable governor aborts', async () => {
      const observed = await runInferenceWatcherFixture(watcherMs, { readError: true });
      assert.equal(observed.aborted, true);
      assert.equal(observed.error, watcherMs === 500
        ? 'GAME_PRIORITY_GOVERNOR_TRUTH_UNAVAILABLE' : 'GAME_PRIORITY_GOVERNOR_LIVE_REFRESH_FAILED');
      assert.equal(observed.result, undefined);
    });
  });
}

test('refreshWatch aborts a failed canonical reconcile before reading advisory state', async () => {
  const observed = await runInferenceWatcherFixture(15000, { reconcileError: true });
  assert.equal(observed.aborted, true);
  assert.equal(observed.error, 'GAME_PRIORITY_GOVERNOR_LIVE_REFRESH_FAILED');
  assert.equal(observed.result, undefined);
  assert.equal(observed.reads, 0);
  assert.equal(observed.reconciles, 1);
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
