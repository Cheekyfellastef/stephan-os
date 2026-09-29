import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const navigation = read('scripts/windows/codex-banked-reset-ui-navigation.psm1');
const navigationCompat = read('scripts/windows/compat/codex-banked-reset-ui-navigation.psm1');
const statusWrapper = read('scripts/windows/read-codex-banked-reset-status-with-navigation.ps1');
const executionWrapper = read('scripts/windows/invoke-codex-banked-reset-ui-with-navigation.ps1');
const statusCore = read('scripts/windows/read-codex-banked-reset-status.ps1');
const executionCore = read('scripts/windows/invoke-codex-banked-reset-ui.ps1');
const statusReader = read('shared/agents/codexBankedResetStatusBattleBridgeReader.mjs');
const telemetryMirror = read('shared/agents/codexBankedResetTelemetryMirror.mjs');
const executor = read('shared/agents/codexBankedResetBattleBridgeExecutor.mjs');

test('uses only the fixed profile to usage panel route', () => {
  assert.match(navigation, /function Open-CodexUsagePanel/);
  assert.match(navigation, /profile menu|open profile|user menu|account menu/i);
  assert.match(navigation, /banked reset|usage summary|usage dashboard|codex usage/i);
  assert.match(navigation, /InvokePattern/);
  assert.match(navigation, /SelectionItemPattern/);
  assert.match(navigation, /ExpandCollapsePattern/);
});

test('finds reset summary labels only on newly visible same-process popup surfaces', () => {
  assert.match(navigation, /function Get-CodexProcessSnapshot/);
  assert.match(navigation, /Current\.ProcessId -ne \$ProcessId/);
  assert.match(navigation, /function Get-CodexNewlyVisibleSnapshot/);
  assert.match(navigation, /BLOCKED_RESET_PROFILE_POPUP_NOT_OBSERVED/);
  assert.match(navigation, /profile-popup-delta-scanned/);
});

test('normalizes a one-item popup delta into an array for both wrappers', () => {
  assert.match(navigationCompat, /Import-Module \$baseModulePath -Force -PassThru/);
  assert.match(navigationCompat, /function script:Get-CodexNewlyVisibleSnapshot/);
  assert.doesNotMatch(navigationCompat, /function Get-CodexNewlyVisibleSnapshot/);
  assert.match(navigationCompat, /foreach \(\$item in @\(\$Before\)\)/);
  assert.match(navigationCompat, /foreach \(\$item in @\(\$After\)\)/);
  assert.match(navigationCompat, /Write-Output -NoEnumerate @\(\$newlyVisible\)/);
  assert.match(navigationCompat, /& \$script:BaseNavigationModule/);
  for (const source of [statusWrapper, executionWrapper]) {
    assert.match(source, /Join-Path \(Join-Path \$scriptDir 'compat'\) 'codex-banked-reset-ui-navigation\.psm1'/);
  }
});

test('resolves a bounded invocable ancestor even when its own accessible name is empty', () => {
  assert.match(navigation, /function Get-CodexInvocableAncestor/);
  assert.match(navigation, /TreeWalker\]::RawViewWalker/);
  assert.match(navigation, /MaximumDepth = 5/);
  assert.match(navigation, /-AllowUnnamed -FallbackName \$label\.Name/);
  assert.match(navigation, /labeled-ancestor/);
  assert.match(navigation, /\$width -gt 900 -or \$height -gt 260/);
  assert.match(navigation, /matchedUsageLabel/);
  assert.match(navigation, /usageControlResolution/);
});

test('requires structural usage-panel proof rather than matching reset words alone', () => {
  assert.match(navigation, /function Test-CodexUsagePanelEvidence/);
  assert.match(navigation, /\\b\\d\{1,3\}\\s\*%/);
  assert.match(navigation, /\$resetAction\.Count -gt 0 -or \$expiry\.Count -gt 0/);
  assert.match(navigation, /BLOCKED_RESET_USAGE_PANEL_NOT_PROVEN/);
});

test('keeps labeled-ancestor selection bounded and fail closed', () => {
  assert.match(navigation, /BLOCKED_RESET_USAGE_LABEL_NOT_INVOCABLE/);
  assert.match(navigation, /BLOCKED_RESET_USAGE_CONTROL_AMBIGUOUS/);
  assert.match(navigation, /billing\|security\|privacy\|upgrade\|purchase\|buy credits\|add credits\|auto\.\?top\.\?up/i);
});

test('live cores scan all UIA surfaces owned by the selected ChatGPT process', () => {
  assert.match(statusCore, /function Get-ProcessSnapshot/);
  assert.match(executionCore, /function Get-ProcessSnapshot/);
  assert.match(statusCore, /Current\.ProcessId -ne \$ProcessId/);
  assert.match(executionCore, /Current\.ProcessId -ne \$ProcessId/);
  assert.match(statusCore, /same-process-usage-surface-scanned/);
  assert.match(executionCore, /same-process-usage-surface-scanned/);
});

test('live executor requires changed meter proof and never treats disappearance alone as success', () => {
  assert.match(executionCore, /\$meterRestored = \$meterChanged/);
  assert.doesNotMatch(executionCore, /\$meterChanged\s+-or\s+\$resetControlDisappeared/);
  assert.match(executionCore, /meter-change-confirmed/);
  assert.match(executor, /Boolean\(meterBefore\) && Boolean\(meterAfter\) && meterBefore !== meterAfter/);
});

test('forbids generic browser, script and credential extraction automation', () => {
  const combined = [navigation, navigationCompat, statusWrapper, executionWrapper, statusCore, executionCore].join('\n');
  for (const pattern of [
    /Invoke-WebRequest/i,
    /Start-Process/i,
    /https?:\/\//i,
    /javascript/i,
    /document\./i,
    /querySelector/i,
    /Get-Credential/i,
    /PasswordVault/i,
    /CredentialManager/i,
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

test('preloads UI Automation before importing the typed navigation module and converts launch failures into JSON blockers', () => {
  for (const source of [statusWrapper, executionWrapper]) {
    const addTypeIndex = source.indexOf('Add-Type -AssemblyName UIAutomationClient');
    const importIndex = source.indexOf('Import-Module $navigationModule');
    assert.ok(addTypeIndex >= 0);
    assert.ok(importIndex > addTypeIndex);
    assert.match(source, /BLOCKED_RESET_UI_AUTOMATION_PRELOAD_FAILED/);
    assert.match(source, /BLOCKED_RESET_NAVIGATION_MODULE_IMPORT_FAILED/);
    assert.match(source, /BLOCKED_RESET_USAGE_PANEL_NAVIGATION_EXCEPTION/);
  }
  assert.match(statusWrapper, /BLOCKED_RESET_STATUS_CORE_LAUNCH_FAILED/);
  assert.match(executionWrapper, /BLOCKED_RESET_EXECUTOR_CORE_LAUNCH_FAILED/);
});

test('allows exactly one bounded retry only for read-only status navigation', () => {
  assert.match(statusWrapper, /navigationRetryCount/);
  assert.match(statusWrapper, /Start-Sleep -Milliseconds 350/);
  assert.match(statusWrapper, /navigation-exception-retry-pass/);
  assert.match(statusWrapper, /navigation-exception-retry-failed/);
  assert.match(statusWrapper, /function Convert-ToSafeDiagnosticText/);
  assert.match(statusWrapper, /\$script:SecretPattern/);
  assert.match(statusWrapper, /authorization\|bearer\|oauth/i);
  assert.match(statusReader, /authorization\|bearer\|oauth/i);
  assert.match(telemetryMirror, /authorization\|bearer\|oauth/i);
  assert.match(statusWrapper, /AKIA\|ASIA/);
  assert.match(statusReader, /AKIA\|ASIA/);
  assert.match(telemetryMirror, /AKIA\|ASIA/);
  assert.match(statusWrapper, /Add-Member -NotePropertyName error -NotePropertyValue \$firstNavigationError/);
  assert.match(statusWrapper, /\$navigationError = Convert-ToSafeDiagnosticText/);
  assert.match(statusWrapper, /\$coreError = Convert-ToSafeDiagnosticText/);
  assert.match(statusWrapper, /\$effectiveError = if \(\$navigationError\) \{ \$navigationError \} else \{ \$coreError \}/);
  assert.match(telemetryMirror, /error: safeDiagnosticText\(result\.error, 300\)/);
  const diagnosticStart = statusWrapper.indexOf('function Convert-ToSafeDiagnosticText');
  const diagnosticEnd = statusWrapper.indexOf('function Get-PropertyValue');
  const diagnosticSource = statusWrapper.slice(diagnosticStart, diagnosticEnd);
  assert.ok(diagnosticSource.indexOf('$text -match $script:SecretPattern') < diagnosticSource.indexOf('$text.Length -gt $Limit'));
  assert.equal((statusWrapper.match(/Open-CodexUsagePanel/g) || []).length, 2);
  assert.doesNotMatch(executionWrapper, /navigationRetryCount|navigation-exception-retry|Start-Sleep -Milliseconds 350/);
  assert.equal((executionWrapper.match(/Open-CodexUsagePanel/g) || []).length, 1);
});

test('keeps the complete UIA chain in STA mode rather than explicitly noninteractive mode', () => {
  for (const source of [statusWrapper, executionWrapper, statusReader, executor]) {
    assert.match(source, /-Sta/);
    assert.doesNotMatch(source, /-NonInteractive/);
  }
});

test('routes both Battle Bridge adapters through fixed-navigation wrappers and preserves ancestry evidence', () => {
  assert.match(statusReader, /read-codex-banked-reset-status-with-navigation\.ps1/);
  assert.match(executor, /invoke-codex-banked-reset-ui-with-navigation\.ps1/);
  assert.match(statusReader, /matchedUsageLabel/);
  assert.match(statusReader, /usageControlResolution/);
  assert.match(executor, /matchedUsageLabel/);
  assert.match(executor, /usageControlResolution/);
  assert.match(statusReader, /shell: false/);
  assert.match(executor, /shell: false/);
});
