import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const navigation = read('scripts/windows/codex-banked-reset-ui-navigation.psm1');
const statusWrapper = read('scripts/windows/read-codex-banked-reset-status-with-navigation.ps1');
const executionWrapper = read('scripts/windows/invoke-codex-banked-reset-ui-with-navigation.ps1');
const statusReader = read('shared/agents/codexBankedResetStatusBattleBridgeReader.mjs');
const executor = read('shared/agents/codexBankedResetBattleBridgeExecutor.mjs');

test('uses only the fixed profile to usage panel route', () => {
  assert.match(navigation, /function Open-CodexUsagePanel/);
  assert.match(navigation, /profile menu|open profile|user menu|account menu/i);
  assert.match(navigation, /reset\(s\)\?\\s\+available|usage summary|usage dashboard|codex usage/i);
  assert.match(navigation, /InvokePattern/);
  assert.match(navigation, /SelectionItemPattern/);
  assert.match(navigation, /ExpandCollapsePattern/);
});

test('forbids generic browser, script and credential automation', () => {
  const combined = [navigation, statusWrapper, executionWrapper].join('\n');
  for (const pattern of [
    /Invoke-WebRequest/i,
    /Start-Process/i,
    /https?:\/\//i,
    /javascript/i,
    /document\./i,
    /querySelector/i,
    /cookie/i,
    /credential/i,
    /SendKeys/i,
    /mouse_event/i,
    /SetCursorPos/i,
  ]) {
    assert.equal(pattern.test(combined), false, `forbidden automation pattern: ${pattern}`);
  }
});

test('wraps the existing status and single-press cores without replacing them', () => {
  assert.match(statusWrapper, /codex-banked-reset-ui-navigation\.psm1/);
  assert.match(statusWrapper, /read-codex-banked-reset-status\.ps1/);
  assert.match(executionWrapper, /codex-banked-reset-ui-navigation\.psm1/);
  assert.match(executionWrapper, /invoke-codex-banked-reset-ui\.ps1/);
  assert.match(executionWrapper, /pressAttempted = \$false/);
  assert.match(executionWrapper, /repeatedPressAllowed = \$false/);
});

test('routes both Battle Bridge adapters through fixed-navigation wrappers', () => {
  assert.match(statusReader, /read-codex-banked-reset-status-with-navigation\.ps1/);
  assert.match(executor, /invoke-codex-banked-reset-ui-with-navigation\.ps1/);
  assert.match(statusReader, /shell: false/);
  assert.match(executor, /shell: false/);
});
