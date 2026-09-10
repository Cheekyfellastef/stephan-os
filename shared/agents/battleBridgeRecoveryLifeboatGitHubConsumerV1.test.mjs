import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consumerUrl = new URL('../../scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1', import.meta.url);
const runnerUrl = new URL('../../scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1', import.meta.url);
const installerUrl = new URL('../../scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);

async function source(url) { return readFile(url, 'utf8'); }

test('installed consumer has no caller arguments and fixes the public GitHub recovery endpoint', async () => {
  const text = await source(consumerUrl);
  assert.match(text, /\[CmdletBinding\(\)\]\s*\nparam\(\)/);
  assert.match(text, /https:\/\/api\.github\.com\/repos\/Cheekyfellastef\/stephan-os\/issues\/1814\/comments\?per_page=100&page=1/);
  assert.match(text, /application\/vnd\.github\+json/);
  assert.match(text, /GITHUB_RECOVERY_RESPONSE_NOT_JSON/);
  assert.match(text, /GITHUB_RECOVERY_JSON_INVALID/);
  assert.doesNotMatch(text, /127\.0\.0\.1:18789\/identity/);
  assert.doesNotMatch(text, /Invoke-Expression/i);
  assert.doesNotMatch(text, /Start-Process/i);
  assert.doesNotMatch(text, /git\.exe/i);
  assert.doesNotMatch(text, /Restart-Computer/i);
});

test('consumer admits only the three currently qualified fixed R1 recovery actions', async () => {
  const text = await source(consumerUrl);
  const allowed = text.match(/\$allowedActions = @\(([^\n]+)\)/)?.[1] ?? '';
  assert.match(allowed, /'PROBE_BATTLE_BRIDGE'/);
  assert.match(allowed, /'WAKE_CANONICAL_MAILBOX'/);
  assert.match(allowed, /'WAKE_CANONICAL_RECOVERY_MESH'/);
  assert.doesNotMatch(allowed, /RESTART_CANONICAL_BACKEND/);
  assert.doesNotMatch(allowed, /FULL_BATTLE_BRIDGE_RECOVERY/);
  assert.match(text, /-File \$actionPath -Action \$request\.action/);
});

test('owner request must be GitHub-host attested and replay-safe before fixed execution', async () => {
  const text = await source(consumerUrl);
  const selectIndex = text.indexOf('Test-Attestation $attestationEntry');
  const claimIndex = text.indexOf('Write-CreateNewJson -Path $claimPath');
  const executeIndex = text.lastIndexOf('-File $actionPath -Action $request.action');
  const consumedIndex = text.lastIndexOf('Write-Consumed -RequestId $request.requestId');
  assert.ok(selectIndex >= 0);
  assert.ok(claimIndex > selectIndex);
  assert.ok(executeIndex > claimIndex);
  assert.ok(consumedIndex > executeIndex);
  assert.match(text, /github-actions\[bot\]/);
  assert.match(text, /author_association -cne 'OWNER'/);
  assert.match(text, /requestSha256/);
  assert.match(text, /EXCLUSIVE_CLAIM_EXISTS/);
  assert.match(text, /RECOVERY_ACTION_DISPATCHED_PROOF_PENDING/);
  assert.match(text, /recoveredHealthClaimed = \$false/);
  assert.match(text, /replayAllowed = \$false/);
});

test('network or HTML failure degrades recovery truth without leaking into arbitrary execution', async () => {
  const text = await source(consumerUrl);
  assert.match(text, /RECOVERY_SOURCE_UNAVAILABLE/);
  assert.match(text, /RECOVERY_SOURCE_INVALID/);
  assert.match(text, /exit 0/);
  assert.match(text, /callerSelectedUrlAllowed = \$false/);
  assert.match(text, /callerSelectedPathAllowed = \$false/);
  assert.match(text, /callerSelectedTaskAllowed = \$false/);
  assert.match(text, /sourceMutationAllowed = \$false/);
  assert.match(text, /mergeAllowed = \$false/);
  assert.match(text, /pcRestartAllowed = \$false/);
});

test('bank manifest binds the GitHub consumer and candidate self-test cannot poll or execute claims', async () => {
  const runner = await source(runnerUrl);
  const installer = await source(installerUrl);
  assert.match(runner, /claimConsumerHash/);
  assert.match(runner, /claim=\$claimConsumerHash/);
  assert.match(runner, /\[switch\]\$SelfTestOnly/);
  assert.match(runner, /if \(-not \$SelfTestOnly -and \$ok\)/);
  assert.match(installer, /sourceClaimConsumer/);
  assert.match(installer, /claim=\$claimHash/);
  assert.match(installer, /-File \$candidateRunner -SelfTestOnly/);
  assert.match(installer, /githubClaimConsumerIncluded = \$true/);
  assert.match(installer, /repoCheckoutRequiredAfterInstall = \$false/);
  assert.match(installer, /openClawGatewayRequiredAfterInstall = \$false/);
});
