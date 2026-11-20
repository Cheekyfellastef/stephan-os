import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = fs.readFileSync(path.join(here, 'invoke-battle-bridge-local-chat-recovery-v1.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(here, 'install-battle-bridge-local-chat-recovery-v1.ps1'), 'utf8');

test('local ChatGPT recovery handler accepts only fixed reviewed lifeboat actions', () => {
  assert.match(handler, /ValidateSet\('PROBE_BATTLE_BRIDGE', 'WAKE_CANONICAL_MAILBOX', 'WAKE_CANONICAL_RECOVERY_MESH'\)/);
  assert.match(handler, /BattleBridgeRecoveryLifeboat/);
  assert.match(handler, /active-bank\.json/);
  assert.match(handler, /payload hash verification failed/);
  assert.match(handler, /MessageBoxButtons\]::YesNo/);
  assert.match(handler, /MessageBoxDefaultButton\]::Button2/);
  assert.match(handler, /permission to \$\{label\}\./);
  assert.doesNotMatch(handler, /permission to \$label\./);
  assert.match(handler, /operatorConfirmed/);
  assert.match(handler, /local-chat-recovery-last\.json/);
  assert.match(handler, /callerSelectedUrlAllowed = \$false/);
  assert.match(handler, /arbitraryShellAllowed = \$false/);
  assert.match(handler, /gitMutationAllowed = \$false/);
  assert.match(handler, /sourceMutationAllowed = \$false/);
  assert.match(handler, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(handler, /\[System\.Uri\]/);
  assert.doesNotMatch(handler, /\$Uri\b/);
  assert.doesNotMatch(handler, /Invoke-Expression/i);
  assert.doesNotMatch(handler, /Start-Process/i);
  assert.doesNotMatch(handler, /git\s+(reset|clean|checkout)/i);
});

test('installer registers three fixed schemes and passes no caller URI text', () => {
  assert.match(installer, /stephanos-recover-probe/);
  assert.match(installer, /stephanos-recover-mailbox/);
  assert.match(installer, /stephanos-recover-mesh/);
  assert.match(installer, /Action = 'PROBE_BATTLE_BRIDGE'/);
  assert.match(installer, /Action = 'WAKE_CANONICAL_MAILBOX'/);
  assert.match(installer, /Action = 'WAKE_CANONICAL_RECOVERY_MESH'/);
  assert.match(installer, /HKCU:\\Software\\Classes\\\$\(\$protocol\.Scheme\)/);
  assert.match(installer, /command\.Contains\('%1'\)/);
  assert.match(installer, /must not receive caller-controlled URI text/);
  assert.match(installer, /callerControlledUriPassedToHandler = \$false/);
  assert.match(installer, /handler hash does not match reviewed source/);
  assert.match(installer, /protocol command identity mismatch/);
  assert.match(installer, /stephanos-recover-probe:/);
  assert.match(installer, /stephanos-recover-mailbox:/);
  assert.match(installer, /stephanos-recover-mesh:/);
  assert.match(installer, /arbitraryShellAllowed = \$false/);
  assert.match(installer, /sourceMutationAllowed = \$false/);
  assert.match(installer, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(installer, /-Uri\b/);
  assert.doesNotMatch(installer, /`"%1`"/);
  assert.doesNotMatch(installer, /Invoke-Expression/i);
});

test('local handler verifies the installer-compatible four-field A/B Lifeboat manifest', () => {
  assert.match(
    handler,
    /\$claimPath = Join-Path \$bankRoot 'github\\invoke-battle-bridge-recovery-lifeboat-github-claim-v1\.ps1'/
  );
  assert.match(
    handler,
    /@\(\$runnerPath, \$actionPath, \$claimPath, \$versionPath, \$manifestPath\)/
  );
  assert.match(handler, /\$claimHash = Get-Sha256 \$claimPath/);
  assert.match(handler, /claim=\$claimHash/);
  assert.match(
    handler,
    /runner=\$runnerHash`naction=\$actionHash`nclaim=\$claimHash`nversion=\$version`n/
  );
  assert.match(handler, /Required installed lifeboat component is missing/);
  assert.match(handler, /Installed lifeboat payload hash verification failed/);
});
