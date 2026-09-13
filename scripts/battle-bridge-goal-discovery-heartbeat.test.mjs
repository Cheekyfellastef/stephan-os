import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runBattleBridgeGoalDiscoveryHeartbeat } from './battle-bridge-goal-discovery-heartbeat.mjs';

test('goal discovery heartbeat delegates to the existing critical backlog conveyor without authority widening', async () => {
  let calls = 0;
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor: async () => {
      calls += 1;
      return { ok: true, classification: 'WAIT_NO_ELIGIBLE_ITEM' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_COMPLETE');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.destructiveGitAllowed, false);
});

test('goal discovery heartbeat fails closed when the conveyor blocks', async () => {
  const result = await runBattleBridgeGoalDiscoveryHeartbeat({
    conveyor: async () => ({ ok: false, blocker: 'NO_QUALIFIED_CAPACITY' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'GOAL_DISCOVERY_HEARTBEAT_BLOCKED');
});

test('Battle Bridge GitHub sync launcher checks goals only after successful sync', async () => {
  const source = await readFile(new URL('./windows/run-battle-bridge-github-sync-hidden.ps1', import.meta.url), 'utf8');
  assert.match(source, /battle-bridge-github-sync-and-refresh\.mjs/);
  assert.match(source, /battle-bridge-goal-discovery-heartbeat\.mjs/);
  assert.match(source, /\$syncExitCode\s*=\s*\$LASTEXITCODE/);
  assert.match(source, /if \(\$syncExitCode -ne 0\) \{[\s\S]*?exit \$syncExitCode[\s\S]*?\}[\s\S]*?\$goalDiscoveryPath/);
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|reset --hard|git clean|git push/i);
});
