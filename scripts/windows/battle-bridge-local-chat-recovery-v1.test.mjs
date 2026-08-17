import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const handler = fs.readFileSync(path.join(here, 'invoke-battle-bridge-local-chat-recovery-v1.ps1'), 'utf8');
const installer = fs.readFileSync(path.join(here, 'install-battle-bridge-local-chat-recovery-v1.ps1'), 'utf8');

test('local ChatGPT recovery ingress is closed-world and lifeboat-backed', () => {
  assert.match(handler, /stephanos-recover/);
  assert.match(handler, /'probe' = 'PROBE_BATTLE_BRIDGE'/);
  assert.match(handler, /'wake-mailbox' = 'WAKE_CANONICAL_MAILBOX'/);
  assert.match(handler, /'wake-recovery-mesh' = 'WAKE_CANONICAL_RECOVERY_MESH'/);
  assert.match(handler, /outside the closed-world allowlist/);
  assert.match(handler, /BattleBridgeRecoveryLifeboat/);
  assert.match(handler, /active-bank\.json/);
  assert.match(handler, /payload hash verification failed/);
  assert.match(handler, /MessageBoxButtons\]::YesNo/);
  assert.match(handler, /MessageBoxDefaultButton\]::Button2/);
  assert.match(handler, /operatorConfirmed/);
  assert.match(handler, /local-chat-recovery-last\.json/);
  assert.match(handler, /arbitraryShellAllowed = \$false/);
  assert.match(handler, /gitMutationAllowed = \$false/);
  assert.match(handler, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(handler, /Invoke-Expression/i);
  assert.doesNotMatch(handler, /Start-Process/i);
  assert.doesNotMatch(handler, /git\s+(reset|clean|checkout)/i);
});

test('installer registers only the fixed per-user protocol handler', () => {
  assert.match(installer, /HKCU:\\Software\\Classes\\stephanos-recover/);
  assert.match(installer, /BattleBridgeRecoveryLifeboat/);
  assert.match(installer, /handler hash does not match reviewed source/);
  assert.match(installer, /protocol command identity mismatch/);
  assert.match(installer, /stephanos-recover:\/\/probe/);
  assert.match(installer, /stephanos-recover:\/\/wake-mailbox/);
  assert.match(installer, /stephanos-recover:\/\/wake-recovery-mesh/);
  assert.match(installer, /arbitraryShellAllowed = \$false/);
  assert.match(installer, /sourceMutationAllowed = \$false/);
  assert.match(installer, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(installer, /Invoke-Expression/i);
});
