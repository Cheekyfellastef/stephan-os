import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consumerUrl = new URL('../../scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1', import.meta.url);

async function source() {
  return readFile(consumerUrl, 'utf8');
}

test('M7 keeps the fixed three-action recovery boundary and performs only read-only post-action proof', async () => {
  const text = await source();
  const allowed = text.match(/\$allowedActions = @\(([^\n]+)\)/)?.[1] ?? '';
  assert.match(allowed, /'PROBE_BATTLE_BRIDGE'/);
  assert.match(allowed, /'WAKE_CANONICAL_MAILBOX'/);
  assert.match(allowed, /'WAKE_CANONICAL_RECOVERY_MESH'/);
  assert.doesNotMatch(allowed, /RESTART_CANONICAL_BACKEND/);
  assert.doesNotMatch(allowed, /FULL_BATTLE_BRIDGE_RECOVERY/);
  assert.match(text, /function Invoke-ReadOnlyProbe\(\)/);
  assert.match(text, /-File \$actionPath -Action PROBE_BATTLE_BRIDGE/);
  assert.match(text, /function Verify-PostAction/);
  assert.match(text, /RECOVERY_WAKE_TARGET_COMPONENT_VERIFIED/);
  assert.match(text, /battleBridgeHealthyClaimed = \$false/);
  assert.match(text, /recoveredHealthClaimed = \$false/);
});

test('M7 journals execution before mutation and terminalizes every completed attempt', async () => {
  const text = await source();
  const claimIndex = text.indexOf('Write-CreateNewJson -Path $claimPath');
  const journalIndex = text.indexOf('Write-CreateNewJson -Path $journalPath');
  const actionIndex = text.lastIndexOf('-File $actionPath -Action $request.action');
  const terminalIndex = text.indexOf("$journal.state = 'TERMINAL'");
  const consumedIndex = text.lastIndexOf('Write-Consumed -RequestId $request.requestId');
  assert.ok(claimIndex >= 0);
  assert.ok(journalIndex > claimIndex);
  assert.ok(actionIndex > journalIndex);
  assert.ok(terminalIndex > actionIndex);
  assert.ok(consumedIndex > terminalIndex);
  assert.match(text, /executionReplayAllowed = \$false/);
  assert.match(text, /replayAllowed = \$false/);
  assert.match(text, /RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED/);
  assert.match(text, /RECOVERY_ACTION_TARGET_VERIFIED/);
});

test('M7 detects an interrupted previous owner and refuses ambiguous replay', async () => {
  const text = await source();
  const repairIndex = text.indexOf('function Terminalize-InterruptedClaims');
  const callIndex = text.indexOf('Terminalize-InterruptedClaims\n');
  const fetchIndex = text.indexOf('Invoke-WebRequest -Uri $apiUrl');
  assert.ok(repairIndex >= 0);
  assert.ok(callIndex > repairIndex);
  assert.ok(fetchIndex > callIndex);
  assert.match(text, /RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY/);
  assert.match(text, /PREVIOUS_LIFEBOAT_PROCESS_INTERRUPTED_AFTER_EXCLUSIVE_CLAIM/);
  assert.match(text, /READ_ONLY_POST_CRASH_PROBE_COMPLETE/);
  assert.match(text, /executionReplayAllowed = \$false/);
  assert.match(text, /if \(Test-Path -LiteralPath \$consumedPath -PathType Leaf\) \{ continue \}/);
});

test('M7 retains the closed-world no-shell no-git no-restart boundary', async () => {
  const text = await source();
  assert.doesNotMatch(text, /Invoke-Expression/i);
  assert.doesNotMatch(text, /Start-Process/i);
  assert.doesNotMatch(text, /git\.exe/i);
  assert.doesNotMatch(text, /Restart-Computer/i);
  assert.match(text, /arbitraryShellAllowed = \$false/);
  assert.match(text, /sourceMutationAllowed = \$false/);
  assert.match(text, /mergeAllowed = \$false/);
  assert.match(text, /pcRestartAllowed = \$false/);
});
