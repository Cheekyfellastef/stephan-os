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

test('tunnel-client profile state is forced into the guarded Stephanos estate', () => {
  assert.match(configure, /\$profileDir = Join-Path \$configDir 'profiles'/);
  assert.match(configure, /\$profilePath = Join-Path \$profileDir "\$profileName\.yaml"/);
  assert.match(configure, /--profile-dir \$profileDir --force/);
  assert.match(configure, /doctor --profile \$profileName --profile-dir \$profileDir --explain/);
  assert.match(configure, /Set-CurrentUserOnlyFileDacl -Path \$profilePath/);
  assert.match(runner, /--profile-dir', \$profileDir/);
  assert.match(runner, /CommandLine -match \[regex\]::Escape\(\$profileDir\)/);
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

test('tunnel reconfiguration restores last-known-good files, profile, pending marker and scheduled task on failure', () => {
  assert.match(configure, /previousTunnelIdExists/);
  assert.match(configure, /previousProtectedKey/);
  assert.match(configure, /previousRestartMarkerExists/);
  assert.match(configure, /previousRestartMarker/);
  assert.match(configure, /previousProfileExists/);
  assert.match(configure, /previousProfileBytes/);
  assert.match(configure, /WriteAllBytes\(\$profilePath, \$previousProfileBytes\)/);
  assert.match(configure, /previousTaskExists/);
  assert.match(configure, /Export-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath/);
  assert.match(configure, /Register-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath -Xml \$previousTaskXml -Force/);
  assert.match(configure, /Unregister-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath -Confirm:\$false/);
  assert.match(configure, /WriteAllText\(\$restartMarkerPath, \$previousRestartMarker/);
  assert.match(configure, /CHATGPT_TUNNEL_CONFIG_APPLY_FAILED_ROLLED_BACK/);
  assert.match(configure, /OPENAI_TUNNEL_CLIENT_ROLLBACK_DOCTOR_FAILED/);
});

test('scheduled task operations are pinned to the root task path', () => {
  assert.match(configure, /\$taskPath = '\\'/);
  assert.match(configure, /Get-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath/);
  assert.match(configure, /Register-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath/);
  assert.match(configure, /Start-ScheduledTask -TaskName \$taskName -TaskPath \$taskPath/);
});

test('tunnel config files use an exclusive verified current-user DACL', () => {
  assert.match(configure, /Set-CurrentUserOnlyFileDacl/);
  assert.match(configure, /RemoveAccessRuleSpecific/);
  assert.match(configure, /rules\.Count -ne 1/);
  assert.match(configure, /CHATGPT_TUNNEL_CONFIG_ACL_NOT_EXCLUSIVE/);
  assert.doesNotMatch(configure, /Set-Acl|icacls\.exe/i);
});

test('windowless watchdog proves old PIDs gone and accepts only the newly launched healthy replacement', () => {
  assert.match(launcher, /Case "sovereign-chatgpt-tunnel"/);
  assert.match(configure, /restart-required\.marker/);
  assert.match(configure, /generation = \[guid\]::NewGuid\(\)\.ToString\('N'\)/);
  assert.match(runner, /Wait-ProcessIdsGone/);
  assert.match(runner, /CHATGPT_TUNNEL_OLD_PROCESS_DID_NOT_EXIT/);
  assert.match(runner, /oldProcessesProvenGone/);
  assert.match(runner, /replacementObserved/);
  assert.match(runner, /matchingReplacement\.Count -eq 1/);
  assert.match(runner, /\$afterPids\[0\] -eq \$startedPid/);
  assert.match(runner, /Stop-Process/);
  assert.match(runner, /Start-Process -FilePath \$tunnelExe/);
  assert.match(runner, /Remove-Item -LiteralPath \$restartMarkerPath/);
  assert.doesNotMatch(runner, /Invoke-Expression|cmd\.exe|powershell\.exe\s+-Command/i);
});

test('restart marker can clear only after replacement proof succeeds', () => {
  const okIndex = runner.indexOf('$ok = if ($managedStartRequired)');
  const clearIndex = runner.indexOf('Remove-Item -LiteralPath $restartMarkerPath');
  assert.ok(okIndex >= 0);
  assert.ok(clearIndex > okIndex);
  assert.match(runner, /if \(\$ok -and \$configRestartRequested\)/);
});

test('failed immediate activation leaves the durable watchdog marker in place', () => {
  assert.match(configure, /activationDeferredToWatchdog = -not \$activationStarted/);
  const startIndex = configure.indexOf('Start-ScheduledTask -TaskName $taskName -TaskPath $taskPath');
  const outputIndex = configure.lastIndexOf('[pscustomobject]@{');
  assert.ok(startIndex >= 0);
  assert.ok(outputIndex > startIndex);
});

test('architecture names Secure MCP Tunnel as the direct ChatGPT route without public exposure', () => {
  assert.match(architecture, /Secure MCP Tunnel/);
  assert.match(architecture, /outbound HTTPS/i);
  assert.match(architecture, /mailbox/i);
  assert.match(architecture, /break-glass/i);
});
