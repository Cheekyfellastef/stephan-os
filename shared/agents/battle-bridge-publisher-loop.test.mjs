import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS,
  buildBattleBridgePublisherLoopContract,
  createBattleBridgeSupervisorStartupPublisher,
  publishBattleBridgeLoopTick,
  resolveExistingSharedWorkspace,
  startBattleBridgePublisherLoop,
} from './battleBridgePublisherLoop.mjs';

const timestampUtc = '2026-07-07T12:00:00.000Z';
const repoRoot = process.cwd();

test('publisher loop contract enforces minimum safe interval and safety boundaries', () => {
  const contract = buildBattleBridgePublisherLoopContract({ intervalMs: 5 });
  assert.equal(contract.intervalMs, BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS);
  assert.equal(contract.intervalGuardApplied, true);
  assert.equal(contract.stoppable, true);
  assert.equal(contract.guardrails.arbitraryShellAllowed, false);
  assert.equal(contract.guardrails.visiblePowerShellWallsAllowed, false);
  assert.equal(contract.workspaceMustPreexist, true);
});

test('missing runtime workspace is reported unavailable without creating unsafe paths', async () => {
  const missing = join(tmpdir(), `stephanos-missing-${Date.now()}`);
  const result = await resolveExistingSharedWorkspace(missing, { repoRoot });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'WORKSPACE_PATH_MISSING');
  assert.match(result.exactNextAction, /existing external Shared Agent Workspace/);
});

test('loop tick publishes UNKNOWN records and hidden Shared Workspace event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-battle-bridge-loop-'));
  const result = await publishBattleBridgeLoopTick({ root, repoRoot, timestampUtc, nowMs: Date.parse(timestampUtc) });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_PUBLISHED');
  const status = JSON.parse(await readFile(join(root, 'status', 'battle-bridge-current.json'), 'utf8'));
  assert.equal(status.status, 'UNKNOWN');
  const event = await readFile(join(root, 'events', 'battle-bridge-publisher-loop.ndjson'), 'utf8');
  assert.match(event, /publisher loop tick published/);
});

test('publisher source failure publishes STALE with exact next action', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-battle-bridge-loop-failure-'));
  const result = await publishBattleBridgeLoopTick({ root, repoRoot, timestampUtc, nowMs: Date.parse(timestampUtc), buildSlice() { throw new Error('boom'); } });
  assert.equal(result.errorHandled, true);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_FAILURE_PUBLISHED_STALE');
  const status = JSON.parse(await readFile(join(root, 'status', 'battle-bridge-current.json'), 'utf8'));
  assert.equal(status.status, 'UNKNOWN');
  assert.match(status.summary, /stale publisher/);
  const proof = JSON.parse(await readFile(join(root, 'proof', 'battle-bridge-current.json'), 'utf8'));
  assert.match(proof.summary, /Inspect Battle Bridge publisher loop error event/);
});

test('startup integration returns stoppable scheduler cleanup contract', () => {
  const timers = [];
  const cleared = [];
  const loop = createBattleBridgeSupervisorStartupPublisher({
    root: '/tmp/nonexistent-stephanos-workspace-for-noop',
    repoRoot,
    runImmediately: false,
    intervalMs: 1,
    setIntervalFn(fn, ms) { timers.push({ fn, ms }); return 'timer-1'; },
    clearIntervalFn(timer) { cleared.push(timer); },
  });
  assert.equal(timers[0].ms, BATTLE_BRIDGE_PUBLISHER_LOOP_MIN_INTERVAL_MS);
  assert.equal(loop.contract.startupIntegrationPoint, 'battle-bridge-supervisor-startup');
  assert.deepEqual(loop.stop(), { stopped: true, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_STOPPED' });
  assert.deepEqual(cleared, ['timer-1']);
});

test('scheduler skips overlapping ticks deterministically', async () => {
  let releases;
  let calls = 0;
  const root = await mkdtemp(join(tmpdir(), 'stephanos-battle-bridge-overlap-'));
  const loop = startBattleBridgePublisherLoop({
    root,
    repoRoot,
    timestampUtc,
    nowMs: Date.parse(timestampUtc),
    intervalMs: 30_000,
    buildSlice: async () => {
      calls += 1;
      await new Promise((resolve) => { releases = resolve; });
      return undefined;
    },
    setIntervalFn(fn) { return { fn }; },
    clearIntervalFn() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  loop.stop();
  releases();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});
