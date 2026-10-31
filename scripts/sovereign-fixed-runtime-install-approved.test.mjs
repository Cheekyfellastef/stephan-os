import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = await readFile(new URL('./windows/install-sovereign-fixed-runtime-approved.ps1', import.meta.url), 'utf8');

test('approved fixed runtime bridge parses cleanly in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, () => {
  const path = fileURLToPath(new URL('./windows/install-sovereign-fixed-runtime-approved.ps1', import.meta.url));
  const escaped = path.replace(/'/g, "''");
  const command = "$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('" + escaped
    + "', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message } | Write-Error; exit 1 }";
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('approved fixed runtime bridge has one exact-head approval surface and one fixed UAC child', () => {
  assert.match(source, /\[ValidatePattern\('\^\[0-9a-f\]\{40\}\$'\)\]/);
  assert.match(source, /\[switch\]\$OperatorApproved/);
  assert.match(source, /if \(-not \$OperatorApproved\)/);
  assert.match(source, /scripts\\sovereign-fixed-runtime-install-handoff-v1\.mjs/);
  assert.match(source, /'prepare' '--expected-main' \$ExpectedHead/);
  assert.match(source, /'verify' '--expected-main' \$ExpectedHead/);
  assert.match(source, /Start-Process -FilePath \$powerShellExecutable[\s\S]*'-EncodedCommand'[\s\S]*\$encodedCommand[\s\S]*-Verb RunAs -WindowStyle Hidden -Wait -PassThru/);
  assert.equal((source.match(/\bStart-Process\b/g) || []).length, 1);
  assert.match(source, /FIXED_RUNTIME_INSTALL_COMMAND_DIGEST_CHANGED/);
  assert.match(source, /PENDING_REBOOT/);
  assert.match(source, /QUALIFIED/);
});

test('approved fixed runtime bridge cannot accept caller command, path, task, restart or source-control authority', () => {
  const params = source.slice(source.indexOf('param('), source.indexOf('Set-StrictMode'));
  assert.doesNotMatch(params, /\$(?:Command|Path|Executable|Arguments|Task|Url|Uri|Payload|Script)\b/i);
  assert.doesNotMatch(source, /Invoke-Expression|\biex\b|Invoke-Command|Start-Job|ScriptBlock::Create/i);
  assert.doesNotMatch(source, /Restart-Computer|shutdown\.exe|Stop-Computer|Register-ScheduledTask|New-ScheduledTask|Set-ScheduledTask|Unregister-ScheduledTask/i);
  assert.doesNotMatch(source, /\bgit(?:\.exe)?\s+(?:push|reset|clean|checkout|switch|merge|rebase|stash)\b/i);
  assert.match(source, /pcRestartPerformed = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /mergeAuthority = \$false/);
});

test('approved bridge validates the private candidate before elevation and verifies protected installation after it', () => {
  assert.match(source, /READY_FOR_OPERATOR_APPROVAL/);
  assert.match(source, /StephanosFixedRuntimeInstall-\{0\}\.json/);
  assert.match(source, /payloadSha256/);
  assert.match(source, /encodedCommandSha256/);
  assert.match(source, /installationPerformed -eq \$false/);
  assert.match(source, /elevationPerformed -eq \$false/);
  assert.match(source, /FIXED_RUNTIME_ELEVATED_INSTALL_FAILED/);
  assert.match(source, /FIXED_RUNTIME_INSTALL_READBACK_UNPROVEN/);
  assert.match(source, /laterFullBootRequired/);
});\n