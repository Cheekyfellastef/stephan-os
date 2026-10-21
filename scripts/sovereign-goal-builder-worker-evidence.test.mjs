import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMissionWorkerHeartbeatRecord, resolveCanonicalMissionWorkerPaths } from './mission-orchestrator-worker-heartbeat.mjs';
import { readGoalBuilderSourceIdentity, readGoalBuilderWorkerHeartbeatAgeMs, runSovereignCommanderGoalBuilderRepair } from './sovereign-commander-goal-builder-repair.mjs';

const HEAD = 'a'.repeat(40), nowMs = Date.parse('2026-10-21T17:00:00Z');
function fixture(action) {
  const home = mkdtempSync(join(tmpdir(), 'sovereign-worker-evidence-'));
  const env = { USERPROFILE: home }, paths = resolveCanonicalMissionWorkerPaths({ env });
  mkdirSync(dirname(paths.heartbeatPath), { recursive: true });
  const record = createMissionWorkerHeartbeatRecord({ timestampUtc: '2026-10-21T16:59:59Z',
    repositoryRoot: paths.repositoryRoot, branch: 'main', headSha: HEAD, pid: 123,
    launchIdentityId: 'b'.repeat(64), workerStartedAtUtc: '2026-10-21T16:00:00Z' });
  const read = () => readGoalBuilderWorkerHeartbeatAgeMs({ env, nowMs,
    readSourceIdentity: () => ({ ok: true, branch: 'main', sourceHead: HEAD }) });
  try { action({ env, paths, record, read }); }
  finally { rmSync(home, { recursive: true, force: true }); }
}

test('actual bounded reader admits a valid canonical worker record, independent of filesystem mtime', () => fixture(({ paths, record, read }) => {
  writeFileSync(paths.heartbeatPath, JSON.stringify(record));
  utimesSync(paths.heartbeatPath, new Date(0), new Date(0));
  assert.equal(read(), 1000);
}));

test('fresh malformed, oversized, unrelated, stale, failed and invalid-launch records cannot start even the supervisor', () => fixture(({ paths, record, read }) => {
  const attacks = ['{bad', ' '.repeat(16385), JSON.stringify(null), JSON.stringify([]),
    ...[
      { schemaVersion: 'other' }, { repositoryRoot: join(paths.repositoryRoot, 'other') },
      { headSha: 'c'.repeat(40) }, { branch: 'other' }, { taskName: 'other' }, { pid: 0 },
      { launchIdentityId: 'wrong' }, { workerStartedAtUtc: record.timestampUtc },
      { timestampUtc: '2026-10-21T16:00:01Z' }, { timestampUtc: '2026-10-21T17:00:01Z' },
      { lastTickVerdict: 'MISSION_WORKER_TICK_FAILED' }, { arbitraryShellAllowed: true },
    ].map(change => JSON.stringify({ ...record, ...change }))];
  for (const bytes of attacks) {
    writeFileSync(paths.heartbeatPath, bytes);
    assert.equal(read(), null);
    const result = runSovereignCommanderGoalBuilderRepair({ readWorkerHeartbeatAgeMs: read,
      runStep() { assert.fail('unqualified record reached a repair step'); } });
    assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
  }
  rmSync(paths.heartbeatPath);
  mkdirSync(paths.heartbeatPath);
  assert.equal(read(), null, 'fresh directory is not a worker heartbeat');
}));

test('a configured nondefault tree stays held even when both trees contain fresh valid-looking records', () => fixture(({ env, paths, record, read }) => {
  writeFileSync(paths.heartbeatPath, JSON.stringify(record));
  env.STEPHANOS_SHARED_AGENT_WORKSPACE = join(env.USERPROFILE, 'custom');
  const customHeartbeat = join(env.STEPHANOS_SHARED_AGENT_WORKSPACE, 'status', 'mission-orchestrator-worker-heartbeat.json');
  mkdirSync(dirname(customHeartbeat), { recursive: true });
  writeFileSync(customHeartbeat, JSON.stringify(record));
  assert.equal(read(), null);
}));

test('each mutating step rechecks evidence after the preceding awaited/process work', () => {
  const calls = []; let reads = 0;
  const result = runSovereignCommanderGoalBuilderRepair({
    readWorkerHeartbeatAgeMs: () => ++reads === 1 ? 1000 : null,
    runStep(step) { calls.push(step.id); return { ok: false, status: 2 }; },
  });
  assert.deepEqual(calls, ['fleet-goal-supervisor', 'controller-lane-status']);
  assert.equal(result.blocker, 'MISSION_WORKER_CUSTODY_UNPROVEN');
});

test('source identity observation reuses fixed Git custody and strips inherited execution settings', () => {
  const calls = [];
  const result = readGoalBuilderSourceIdentity({ env: { ...process.env, GIT_DIR: 'foreign', GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'hostile', NODE_OPTIONS: '--require hostile' },
    spawnSyncFn(executable, args, options) {
      calls.push(args);
      assert.match(executable, /(?:Program Files[\\/]Git[\\/]cmd[\\/]git\.exe|\/usr\/bin\/git)$/);
      assert.ok(args.includes('core.fsmonitor=false'));
      assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
      assert.notEqual(options.env.GIT_DIR, 'foreign'); assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(Object.values(options.env).includes('hostile'), false);
      return { status: 0, stdout: args.includes('symbolic-ref') ? 'main\n' : HEAD + '\n' };
    },
  });
  assert.deepEqual(result, { ok: true, sourceHead: HEAD, branch: 'main' });
  assert.equal(calls.length, 2);
});
