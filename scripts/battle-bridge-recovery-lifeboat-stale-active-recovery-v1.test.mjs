import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerUrl = new URL('./windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);

async function source() {
  return readFile(installerUrl, 'utf8');
}

test('stale active Lifeboat is recoverable only through the inactive bank', async () => {
  const text = await source();

  assert.match(text, /\$activeBankFreshHealthy\s*=\s*\$false/);
  assert.match(text, /Assert-ActivePayloadManifest[\s\S]*?try\s*\{[\s\S]*?Read-FreshHealthyHeartbeat[\s\S]*?\$activeBankFreshHealthy\s*=\s*\$true[\s\S]*?\}\s*catch\s*\{[\s\S]*?\$heartbeatFailure\s*=\s*\[string\]\$_\.Exception\.Message[\s\S]*?\$recoverableHeartbeatFailures\s*=\s*@\([\s\S]*?has no heartbeat\.[\s\S]*?heartbeat is not healthy and payload verified\.[\s\S]*?heartbeat is stale\.[\s\S]*?\)[\s\S]*?if\s*\(\$heartbeatFailure\s*-notin\s*\$recoverableHeartbeatFailures\)\s*\{\s*throw\s*\}[\s\S]*?\$activeBankFreshHealthy\s*=\s*\$false/);

  assert.match(text, /\$targetBank\s*=\s*if\s*\(\$activeBank\s*-eq\s*'A'\)\s*\{\s*'B'\s*\}\s*else\s*\{\s*'A'\s*\}/);
  assert.match(text, /if\s*\(\$targetBank\s*-eq\s*\$activeBank\)\s*\{\s*throw\s*'Lifeboat installer must never target the active bank\.'/);

  assert.match(text, /if\s*\(\$null\s*-ne\s*\$activeState\s*-and\s*\$activeBankFreshHealthy\s*-and\s*\$manifestSha256\s*-eq\s*\[string\]\$activeState\.manifestSha256\)/);

  const candidateHeartbeat = text.indexOf('Read-FreshHealthyHeartbeat -BankId $targetBank -ExpectedManifest $manifestSha256');
  const promotion = text.indexOf('Write-AtomicJson -Path $activeStatePath -Value $newState');
  assert.ok(candidateHeartbeat >= 0, 'candidate heartbeat proof must remain mandatory');
  assert.ok(promotion > candidateHeartbeat, 'candidate heartbeat must be proven before active-bank promotion');
});

test('identity, parse and manifest heartbeat failures are not downgraded to stale recovery', async () => {
  const text = await source();
  assert.match(text, /heartbeat schema is invalid/);
  assert.match(text, /heartbeat identity is invalid/);
  assert.match(text, /heartbeat manifest mismatch/);
  assert.match(text, /if\s*\(\$heartbeatFailure\s*-notin\s*\$recoverableHeartbeatFailures\)\s*\{\s*throw\s*\}/);
});

test('already-current reinstall proves the rollback bank before claiming production redundancy', async () => {
  const text = await source();
  const branchStart = text.indexOf('if ($null -ne $activeState -and $activeBankFreshHealthy -and $manifestSha256 -eq [string]$activeState.manifestSha256) {');
  const branchEnd = text.indexOf('\n$targetRoot = Join-Path $banksRoot $targetBank', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const branch = text.slice(branchStart, branchEnd);

  assert.match(branch, /\$rollbackBankFreshHealthy\s*=\s*\$false/);
  assert.match(branch, /\$rollbackManifest\s*=\s*\(\[string\]\$activeState\.previousManifestSha256\)\.Trim\(\)\.ToLowerInvariant\(\)/);
  assert.match(branch, /Assert-ActivePayloadManifest -BankId \$rollbackBank -ExpectedManifest \$rollbackManifest/);
  assert.match(branch, /Read-FreshHealthyHeartbeat -BankId \$rollbackBank -ExpectedManifest \$rollbackManifest/);
  assert.match(branch, /productionRedundancyReady\s*=\s*\[bool\]\$rollbackBankFreshHealthy/);
  assert.doesNotMatch(branch, /productionRedundancyReady\s*=\s*\[bool\]\(\$activeBankFreshHealthy/);
});

test('stale active recovery does not claim the stale active bank as production-ready rollback redundancy', async () => {
  const text = await source();
  assert.match(text, /productionRedundancyReady\s*=\s*\[bool\]\(\$activeBankFreshHealthy\s*-and\s*\$activeBank\s*-in\s*@\('A',\s*'B'\)\)/);
});
