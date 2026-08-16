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

test('M7 requires fresh post-wake task execution rather than accepting a stale successful result', async () => {
  const text = await source();
  assert.match(text, /function Get-ProbeUtc\(\[object\]\$Value\)/);
  assert.match(text, /function Test-TaskCurrentlyHealthy\(\[object\]\$TaskSnapshot, \[object\]\$BaselineSnapshot\)/);
  assert.match(text, /\$postRun = Get-ProbeUtc \$TaskSnapshot\.lastRunTimeUtc/);
  assert.match(text, /\$baselineRun = Get-ProbeUtc \$BaselineSnapshot\.lastRunTimeUtc/);
  assert.match(text, /return \$postRun -gt \$baselineRun/);
  assert.match(text, /\$baseline = if \(\$Action -eq 'WAKE_CANONICAL_MAILBOX'\) \{ \$ActionReceipt\.mailbox\.before \} else \{ \$ActionReceipt\.recoveryMesh\.before \}/);
  assert.match(text, /Test-TaskCurrentlyHealthy \$target \$baseline/);
  assert.doesNotMatch(text, /return \$null -ne \$TaskSnapshot\.lastTaskResult -and \[int64\]\$TaskSnapshot\.lastTaskResult -eq 0\s*\n}/);
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

test('M7 exposes malformed interrupted claims as a fail-closed local-state blocker', async () => {
  const text = await source();
  assert.match(text, /INTERRUPTED_CLAIM_MALFORMED/);
  assert.match(text, /INTERRUPTED_CLAIM_IDENTITY_INVALID/);
  assert.match(text, /INTERRUPTED_CLAIM_ACTION_INVALID/);
  assert.match(text, /RECOVERY_LOCAL_STATE_BLOCKED/);
  assert.match(text, /throw 'Interrupted recovery claim is malformed\.'/);
  assert.match(text, /throw 'Interrupted recovery claim identity is invalid\.'/);
  assert.match(text, /throw 'Interrupted recovery claim action is invalid\.'/);
  assert.doesNotMatch(text, /ConvertFrom-Json \} catch \{ continue \}/);
});

test('M7 trusts a terminal interrupted journal only when journal and receipt identities remain exact', async () => {
  const text = await source();
  assert.match(text, /INTERRUPTED_JOURNAL_MALFORMED/);
  assert.match(text, /INTERRUPTED_JOURNAL_IDENTITY_INVALID/);
  assert.match(text, /INTERRUPTED_JOURNAL_STATE_INVALID/);
  assert.match(text, /INTERRUPTED_JOURNAL_TERMINAL_INVALID/);
  assert.match(text, /INTERRUPTED_TERMINAL_RECEIPT_MISSING/);
  assert.match(text, /INTERRUPTED_TERMINAL_RECEIPT_INVALID/);
  assert.match(text, /\[string\]\$journal\.requestId -cne \$requestId/);
  assert.match(text, /\[string\]\$journal\.action -cne \$action/);
  assert.match(text, /\[string\]\$journal\.bankId -cne \[string\]\$claim\.bankId/);
  assert.match(text, /\$terminalReceipt\.receiptId -cne \$existingReceiptId/);
  assert.match(text, /\$terminalReceipt\.requestId -cne \$requestId/);
  assert.match(text, /\$terminalReceipt\.action -cne \$action/);
  assert.match(text, /\$terminalReceipt\.bankId -cne \[string\]\$claim\.bankId/);
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
