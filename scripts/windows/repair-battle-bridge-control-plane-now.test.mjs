import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ps1Url = new URL('./repair-battle-bridge-control-plane-now.ps1', import.meta.url);
const cmdUrl = new URL('./Repair-Battle-Bridge-Control-Plane-Now.cmd', import.meta.url);
const [ps1, cmd] = await Promise.all([
  readFile(ps1Url, 'utf8'),
  readFile(cmdUrl, 'utf8'),
]);

test('rescue is fixed to the canonical repository and three existing task installers', () => {
  assert.match(ps1, /Cheekyfellastef\/stephan-os/);
  assert.match(ps1, /Documents\\GitHub\\stephan-os/);
  assert.match(ps1, /install-battle-bridge-github-sync\.ps1/);
  assert.match(ps1, /install-battle-bridge-recovery-mesh\.ps1/);
  assert.match(ps1, /install-battle-bridge-github-command-mailbox\.ps1/);
  assert.match(ps1, /Stephanos Battle Bridge GitHub Sync/);
  assert.match(ps1, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(ps1, /Stephanos Battle Bridge GitHub Command Mailbox/);
});

test('rescue reads Git identity but delegates all source convergence to the reviewed sync task', () => {
  assert.match(ps1, /git\\cmd\\git\.exe/i);
  assert.match(ps1, /'ls-remote', \$publicRemote, 'refs\/heads\/main'/);
  assert.match(ps1, /sourceMutationPerformedByRescue = \$false/);
  assert.match(ps1, /sourceConvergencePerformedByExistingReviewedSync = \$true/);
  assert.doesNotMatch(ps1, /\b(?:reset|clean|stash|rebase|push|checkout|switch)\b/i);
  assert.doesNotMatch(ps1, /['"](?:fetch|merge)['"]/i);
  assert.doesNotMatch(ps1, /Invoke-Expression|\biex\b|Start-Process/i);
});

test('rescue does not require or expose Tailscale and Forge credentials or mutate Forge', () => {
  assert.match(ps1, /tailscaleCredentialRequired = \$false/);
  assert.match(ps1, /forgeMutationPerformed = \$false/);
  assert.doesNotMatch(ps1, /TS_OAUTH_CLIENT_ID|TS_AUDIENCE|SSH_PRIVATE_KEY|SSH_KNOWN_HOSTS/);
  assert.doesNotMatch(ps1, /INSTALL_FORGE_SHADOW_M2|podman|forgejo/i);
  assert.match(ps1, /BATTLE_BRIDGE_NO_FAFF_RESCUE_READY/);
});

test('one-click launcher invokes only the fixed source-controlled rescue script', () => {
  assert.match(cmd, /repair-battle-bridge-control-plane-now\.ps1/);
  assert.match(cmd, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(cmd, /-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"/);
  assert.doesNotMatch(cmd, /curl|wget|Invoke-WebRequest|bitsadmin|certutil|powershell -Command/i);
});
