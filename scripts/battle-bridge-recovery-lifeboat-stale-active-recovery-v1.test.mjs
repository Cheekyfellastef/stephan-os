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
  assert.match(text, /Assert-ActivePayloadManifest[\s\S]*?try\s*\{[\s\S]*?Read-FreshHealthyHeartbeat[\s\S]*?\$activeBankFreshHealthy\s*=\s*\$true[\s\S]*?\}\s*catch\s*\{[\s\S]*?\$activeBankFreshHealthy\s*=\s*\$false/);

  assert.match(text, /\$targetBank\s*=\s*if\s*\(\$activeBank\s*-eq\s*'A'\)\s*\{\s*'B'\s*\}\s*else\s*\{\s*'A'\s*\}/);
  assert.match(text, /if\s*\(\$targetBank\s*-eq\s*\$activeBank\)\s*\{\s*throw\s*'Lifeboat installer must never target the active bank\.'/);

  assert.match(text, /if\s*\(\$null\s*-ne\s*\$activeState\s*-and\s*\$activeBankFreshHealthy\s*-and\s*\$manifestSha256\s*-eq\s*\[string\]\$activeState\.manifestSha256\)/);

  const candidateHeartbeat = text.indexOf('Read-FreshHealthyHeartbeat -BankId $targetBank -ExpectedManifest $manifestSha256');
  const promotion = text.indexOf('Write-AtomicJson -Path $activeStatePath -Value $newState');
  assert.ok(candidateHeartbeat >= 0, 'candidate heartbeat proof must remain mandatory');
  assert.ok(promotion > candidateHeartbeat, 'candidate heartbeat must be proven before active-bank promotion');
});

test('stale active recovery must not pretend the stale rollback bank is production-ready', async () => {
  const text = await source();
  assert.match(text, /productionRedundancyReady\s*=\s*\[bool\]\(\$activeBankFreshHealthy\s*-and\s*\$activeBank\s*-in\s*@\('A',\s*'B'\)\)/);
});
