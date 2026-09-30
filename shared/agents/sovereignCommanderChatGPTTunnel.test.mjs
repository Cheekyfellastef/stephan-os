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

test('windowless watchdog starts only the named tunnel profile and self-heals its own stale process', () => {
  assert.match(launcher, /Case "sovereign-chatgpt-tunnel"/);
  assert.match(runner, /stephanos-sovereign-commander/);
  assert.match(runner, /127\.0\.0\.1:\$healthPort\/readyz/);
  assert.match(runner, /Stop-Process/);
  assert.match(runner, /Start-Process -FilePath \$tunnelExe/);
  assert.doesNotMatch(runner, /Invoke-Expression|cmd\.exe|powershell\.exe\s+-Command/i);
});

test('architecture names Secure MCP Tunnel as the direct ChatGPT route without public exposure', () => {
  assert.match(architecture, /Secure MCP Tunnel/);
  assert.match(architecture, /outbound HTTPS/i);
  assert.match(architecture, /mailbox/i);
  assert.match(architecture, /break-glass/i);
});
