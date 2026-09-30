import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installer = await readFile(new URL('../../scripts/windows/install-openai-secure-mcp-tunnel.ps1', import.meta.url), 'utf8');
const configure = await readFile(new URL('../../scripts/windows/configure-sovereign-commander-chatgpt-tunnel.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-chatgpt-tunnel-hidden.ps1', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url), 'utf8');
const architecture = await readFile(new URL('../../docs/architecture/sovereign-commander-v1.md', import.meta.url), 'utf8');

test('official tunnel client install is explicit, pinned by upstream checksum, and avoids package managers', () => {
  assert.match(installer, /ApproveNetworkInstall/);
  assert.match(installer, /openai\/tunnel-client/);
  assert.match(installer, /SHA256SUMS\.txt/);
  assert.match(installer, /Get-FileHash/);
  assert.match(installer, /windows-amd64/);
  assert.doesNotMatch(installer, /npm\s+install|npx\s+|winget\s+install|choco\s+install/i);
});

test('ChatGPT tunnel config stores the runtime key under Windows DPAPI and keeps the MCP server private', () => {
  assert.match(configure, /System\.Security\.SecureString/);
  assert.match(configure, /ConvertFrom-SecureString/);
  assert.match(configure, /runtime-api-key\.dpapi/);
  assert.match(configure, /Windows-DPAPI-current-user/);
  assert.match(configure, /sample_mcp_stdio_local/);
  assert.match(configure, /sovereign-commander-mcp\.mjs/);
  assert.match(configure, /inboundFirewallPortRequired = \$false/);
  assert.match(configure, /publicMcpEndpointRequired = \$false/);
  assert.match(configure, /arbitraryShellAllowed = \$false/);
});

test('WhatIf/declined ShouldProcess cannot persist tunnel credentials, initialize profile, or register task', () => {
  const gate = configure.indexOf('$shouldApply = $PSCmdlet.ShouldProcess');
  const declined = configure.indexOf('if (-not $shouldApply)');
  assert.ok(gate >= 0);
  assert.ok(declined > gate);
  for (const mutation of [
    'New-Item -ItemType Directory -Path $configDir',
    'WriteAllText($tunnelIdPath',
    'ConvertFrom-SecureString -SecureString $RuntimeApiKey',
    '& $tunnelExe init',
    'Register-ScheduledTask',
  ]) {
    const index = configure.indexOf(mutation);
    assert.ok(index > declined, `mutation must follow ShouldProcess decline gate: ${mutation}`);
  }
  assert.match(configure, /mutationPerformed = \$false/);
  assert.match(configure, /CHATGPT_SECURE_MCP_TUNNEL_CONFIG_SKIPPED/);
});

test('tunnel reconfiguration restores last-known-good files and profile if apply fails', () => {
  assert.match(configure, /previousTunnelIdExists/);
  assert.match(configure, /previousProtectedKey/);
  assert.match(configure, /CHATGPT_TUNNEL_CONFIG_APPLY_FAILED_ROLLED_BACK/);
  assert.match(configure, /OPENAI_TUNNEL_CLIENT_ROLLBACK_INIT_FAILED/);
  assert.match(configure, /OPENAI_TUNNEL_CLIENT_ROLLBACK_DOCTOR_FAILED/);
  assert.match(configure, /Remove-Item -LiteralPath \$restartMarkerPath/);
});

test('tunnel config files use an exclusive verified current-user DACL', () => {
  assert.match(configure, /Set-CurrentUserOnlyFileDacl/);
  assert.match(configure, /RemoveAccessRuleSpecific/);
  assert.match(configure, /rules\.Count -ne 1/);
  assert.match(configure, /CHATGPT_TUNNEL_CONFIG_ACL_NOT_EXCLUSIVE/);
  assert.doesNotMatch(configure, /Set-Acl|icacls\.exe/i);
});

test('windowless watchdog forces a managed-process recycle after config changes', () => {
  assert.match(launcher, /Case "sovereign-chatgpt-tunnel"/);
  assert.match(configure, /restart-required\.marker/);
  assert.match(configure, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(runner, /restart-required\.marker/);
  assert.match(runner, /configRestartRequested/);
  assert.match(runner, /restartedForConfigChange/);
  assert.match(runner, /Stop-Process/);
  assert.match(runner, /Start-Process -FilePath \$tunnelExe/);
  assert.match(runner, /Remove-Item -LiteralPath \$restartMarkerPath/);
  assert.doesNotMatch(runner, /Invoke-Expression|cmd\.exe|powershell\.exe\s+-Command/i);
});

test('architecture names Secure MCP Tunnel as the direct ChatGPT route without public exposure', () => {
  assert.match(architecture, /Secure MCP Tunnel/);
  assert.match(architecture, /outbound HTTPS/i);
  assert.match(architecture, /mailbox/i);
  assert.match(architecture, /break-glass/i);
});
