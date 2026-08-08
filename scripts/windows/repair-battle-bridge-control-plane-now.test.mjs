import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ps1Url = new URL('./repair-battle-bridge-control-plane-now.ps1', import.meta.url);
const cmdUrl = new URL('./Repair-Battle-Bridge-Control-Plane-Now.cmd', import.meta.url);
const statusUrl = new URL('./status-stephanos-codex-dispatch-plugin.ps1', import.meta.url);
const [ps1, cmd, status] = await Promise.all([
  readFile(ps1Url, 'utf8'),
  readFile(cmdUrl, 'utf8'),
  readFile(statusUrl, 'utf8'),
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

test('rescue repairs the existing Codex dispatch plugin without creating another execution lane', () => {
  assert.match(ps1, /install-stephanos-codex-dispatch-plugin\.ps1/);
  assert.match(ps1, /status-stephanos-codex-dispatch-plugin\.ps1/);
  assert.match(ps1, /readyForRemoteChatDispatch/);
  assert.match(ps1, /CHATGPT_DESKTOP_PLUGIN_ATTACHMENT_REQUIRED/);
  assert.match(ps1, /BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_ATTACHMENT_REQUIRED/);
  assert.match(ps1, /BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_READY/);
  assert.match(ps1, /newWorkerCreated = \$false/);
  assert.match(ps1, /newMailboxCreated = \$false/);
  assert.doesNotMatch(ps1, /New-ScheduledTask|Register-ScheduledTask|Start-Job/i);
});

test('dispatch readiness requires a fresh exact-head Windows tools-list attachment proof', () => {
  assert.match(status, /surface-attachment-latest\.json/);
  assert.match(status, /stephanos\.codex-dispatch-surface-attachment\.v1/);
  assert.match(status, /can_local_windows_proof/);
  assert.match(status, /sourceHead -eq \$sourceHead/);
  assert.match(status, /serverSourceSha256 -eq \$serverSourceSha256/);
  assert.match(status, /Get-FileHash/);
  assert.match(status, /TotalMinutes -le 10/);
  assert.match(status, /executionSurfaceHandshake/);
  assert.match(status, /heartbeatFresh/);
  assert.match(status, /dispatch_codex_task/);
  assert.match(status, /get_codex_task_status/);
  assert.match(status, /read_codex_task_result/);
  assert.match(status, /BLOCKED_CHATGPT_PLUGIN_ATTACHMENT_UNPROVEN/);
  assert.match(status, /STEPHANOS_CODEX_DISPATCH_BRIDGE_ATTACHED_READY/);
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
  assert.match(ps1, /BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_READY/);
});

test('one-click launcher invokes only the fixed source-controlled rescue script', () => {
  assert.match(cmd, /repair-battle-bridge-control-plane-now\.ps1/);
  assert.match(cmd, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(cmd, /-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"/);
  assert.doesNotMatch(cmd, /curl|wget|Invoke-WebRequest|bitsadmin|certutil|powershell -Command/i);
  assert.match(cmd, /Remote Codex attachment proven/);
});
