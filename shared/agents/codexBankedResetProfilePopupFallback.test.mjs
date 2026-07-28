import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const compatibilityModule = read('scripts/windows/compat/codex-banked-reset-ui-navigation.psm1');
const statusWrapper = read('scripts/windows/read-codex-banked-reset-status-with-navigation.ps1');
const executionWrapper = read('scripts/windows/invoke-codex-banked-reset-ui-with-navigation.ps1');
const workflow = read('.github/workflows/codex-reset-fixed-navigation.yml');

test('falls back only to bounded same-process usage labels when the popup delta is empty', () => {
  assert.match(compatibilityModule, /function script:Get-CodexNewlyVisibleSnapshot/);
  assert.match(compatibilityModule, /if \(\$newlyVisible\.Count -eq 0\)/);
  assert.match(compatibilityModule, /\$fallback = @\(\$After \| Where-Object/);
  assert.match(compatibilityModule, /billing\|security\|privacy\|upgrade\|purchase\|buy credits\|add credits\|auto\.\?top\.\?up/i);
  assert.match(compatibilityModule, /\.Name -notmatch \$forbidden/);
  assert.match(compatibilityModule, /\.AutomationId -notmatch \$forbidden/);
  assert.match(compatibilityModule, /banked reset\|rate\.\?limit reset\|reset\(s\)\?\\s\+available\|usage summary\|usage dashboard\|codex usage\|\\busage\\b/i);
  assert.match(compatibilityModule, /\.AutomationId -match '\(\?i\)usage\|limit\|reset'/);
  assert.match(compatibilityModule, /\$script:CodexPopupFallbackUsed = \$true/);
  assert.match(compatibilityModule, /profile-popup-same-process-usage-fallback/);
  assert.match(compatibilityModule, /Add-Member -NotePropertyName proofRefs/);
});

test('keeps the fallback inside the existing fixed navigation and proof chain', () => {
  assert.match(compatibilityModule, /Import-Module \$baseModulePath -Force -PassThru -ErrorAction Stop/);
  assert.match(compatibilityModule, /& \$script:BaseNavigationModule/);
  assert.match(compatibilityModule, /Write-Output -NoEnumerate @\(\$newlyVisible\)/);
  assert.match(statusWrapper, /navigationRetryCount/);
  assert.match(statusWrapper, /Start-Sleep -Milliseconds 350/);
  assert.doesNotMatch(executionWrapper, /navigationRetryCount|navigation-exception-retry|Start-Sleep -Milliseconds 350/);
  assert.equal((executionWrapper.match(/Open-CodexUsagePanel/g) || []).length, 1);
});

test('parses and exercises the compatibility module in Windows CI', () => {
  assert.match(workflow, /scripts\/windows\/compat\/codex-banked-reset-ui-navigation\.psm1/);
  assert.match(workflow, /shared\/agents\/codexBankedResetProfilePopupFallback\.test\.mjs/);
  const parseBlock = workflow.slice(workflow.indexOf("$files = @("), workflow.indexOf('foreach ($file in $files)'));
  assert.match(parseBlock, /scripts\/windows\/compat\/codex-banked-reset-ui-navigation\.psm1/);
});

test('does not introduce generic browser, credential, shell or repeated-press automation', () => {
  for (const pattern of [
    /Invoke-WebRequest/i,
    /Start-Process/i,
    /https?:\/\//i,
    /javascript/i,
    /querySelector/i,
    /Get-Credential/i,
    /PasswordVault/i,
    /CredentialManager/i,
    /SendKeys/i,
    /mouse_event/i,
    /SetCursorPos/i,
    /press retry/i,
  ]) {
    assert.equal(pattern.test(compatibilityModule), false, `forbidden fallback pattern: ${pattern}`);
  }
});
