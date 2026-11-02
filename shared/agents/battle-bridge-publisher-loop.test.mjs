import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

async function settled(loop) {
  const deadline = Date.now() + 3000;
  while (loop.getStatus().inFlight && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(loop.getStatus().inFlight, false);
  return loop.getStatus().lastResult;
}

test('persistent rename failure preserves prior bytes and the same loop can recover next tick', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-publisher-rename-'));
  await publishBattleBridgeLoopTick({ root, repoRoot, timestampUtc, nowMs: Date.parse(timestampUtc) });
  const path = join(root, 'status', 'battle-bridge-current.json'), before = await readFile(path);
  let intervalFn, fail = true, renameCalls = 0;
  const loop = startBattleBridgePublisherLoop({ root, repoRoot, timestampUtc,
    nowMs: Date.parse(timestampUtc), runImmediately: false,
    options: { atomicRenameRetryDelaysMs: [], renameFn: async (...args) => {
      renameCalls++;
      if (fail) throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EPERM' });
      return rename(...args);
    } },
    setIntervalFn(fn) { intervalFn = fn; return 1; }, clearIntervalFn() {},
  });
  intervalFn();
  const blocked = await settled(loop);
  assert.equal(blocked.ok, false); assert.equal(blocked.errorCode, 'EPERM');
  assert.equal(blocked.reason, 'PUBLISHER_WORKSPACE_PUBLICATION_FAILED');
  assert.equal(renameCalls, 1); // no attempt to mark the same failing sink STALE
  assert.deepEqual(await readFile(path), before);
  assert.doesNotMatch(JSON.stringify(blocked), /PRIVATE_PATH/);
  fail = false; intervalFn();
  assert.equal((await settled(loop)).finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_PUBLISHED');
  loop.stop(); const calls = renameCalls; intervalFn();
  assert.equal(renameCalls, calls);
});

test('an unavailable audit-event sink does not reject an otherwise published tick', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-publisher-audit-'));
  await mkdir(join(root, 'events', 'battle-bridge-publisher-loop.ndjson'), { recursive: true });
  const result = await publishBattleBridgeLoopTick({ root, repoRoot, timestampUtc, nowMs: Date.parse(timestampUtc) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PUBLISHER_LOOP_EVENT_WRITE_FAILED');
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_LOOP_TICK_BLOCKED');
  assert.equal(JSON.parse(await readFile(join(root, 'status', 'battle-bridge-current.json'), 'utf8')).status, 'UNKNOWN');
});

test('a real backend-like HTTP process survives detached immediate and scheduled publication failures', () => {
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict',
    fileURLToPath(new URL('./fixtures/battleBridgePublisherLoopHostProbe.mjs', import.meta.url))],
    { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /HOST_SURVIVED/);
  assert.doesNotMatch(child.stderr, /PRIVATE_IO_FAILURE/);
});

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
  let releaseTick;
  let markBuildStarted;
  const buildStarted = new Promise((resolve) => { markBuildStarted = resolve; });
  let intervalFn;
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
      markBuildStarted();
      await new Promise((resolve) => { releaseTick = resolve; });
      return undefined;
    },
    setIntervalFn(fn) { intervalFn = fn; return { fn }; },
    clearIntervalFn() {},
  });
  await buildStarted;
  intervalFn();
  loop.stop();
  releaseTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});
