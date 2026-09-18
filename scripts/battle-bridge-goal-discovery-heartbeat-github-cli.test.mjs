import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { readFile } from 'node:fs/promises';

import {
  BATTLE_BRIDGE_CANONICAL_GITHUB_CLI,
  runBattleBridgeGoalDiscoveryHeartbeat,
} from './battle-bridge-goal-discovery-heartbeat.mjs';

const githubReady = Object.freeze({
  ok: true,
  available: true,
  sourceHead: 'a'.repeat(40),
  finalVerdict: 'GITHUB_LIFEBOAT_LANE7_READY',
});

const forgeReady = Object.freeze({
  ok: true,
  available: true,
  finalVerdict: 'FORGE_LIFEBOAT_LANE_6_CAPACITY_PUBLISHED',
});

function baseOptions(refreshGithubLifeboat, githubLifeboatOptions = {}) {
  return {
    githubLifeboatOptions,
    refreshGithubLifeboat,
    refreshGithubLifeboatClaimAck: async () => ({ ok: true, published: false }),
    refreshLifeboatCapacity: async () => forgeReady,
    conveyor: async () => ({ ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' }),
    buildClaimedGoal: async () => ({ processed: false, success: false, reason: 'queue-empty' }),
  };
}

test('Lane 7 receives the canonical GitHub CLI identity from the goal-discovery heartbeat', async () => {
  const observed = [];
  const result = await runBattleBridgeGoalDiscoveryHeartbeat(baseOptions(async (options) => {
    observed.push(options.ghCommand);
    return githubReady;
  }));

  const expected = process.platform === 'win32'
    ? 'C:\\Program Files\\GitHub CLI\\gh.exe'
    : 'gh';

  assert.equal(BATTLE_BRIDGE_CANONICAL_GITHUB_CLI, expected);
  assert.deepEqual(observed, [expected]);
  assert.equal(result.ok, true);
  assert.equal(result.githubLifeboat.available, true);
});

test('Lane 7 source pins the canonical Windows GitHub CLI path instead of relying on hidden-task PATH lookup', async () => {
  const source = await readFile(new URL('./battle-bridge-goal-discovery-heartbeat.mjs', import.meta.url), 'utf8');
  assert.match(source, /process\.platform === 'win32'[\s\S]*C:\\\\Program Files\\\\GitHub CLI\\\\gh\.exe/);
  assert.match(source, /ghCommand:\s*githubLifeboatOptions\.ghCommand \|\| BATTLE_BRIDGE_CANONICAL_GITHUB_CLI/);
  assert.doesNotMatch(source, /ghCommand:\s*githubLifeboatOptions\.ghCommand \|\| ['"]gh['"]/);
});

test('Lane 7 preserves an explicit GitHub CLI override', async () => {
  const observed = [];
  const result = await runBattleBridgeGoalDiscoveryHeartbeat(baseOptions(async (options) => {
    observed.push(options.ghCommand);
    return githubReady;
  }, { ghCommand: 'test-gh-override' }));

  assert.deepEqual(observed, ['test-gh-override']);
  assert.equal(result.ok, true);
});
