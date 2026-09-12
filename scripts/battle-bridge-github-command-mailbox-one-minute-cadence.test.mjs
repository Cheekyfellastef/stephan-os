import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installer = await readFile(
  new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url),
  'utf8',
);

test('mailbox uses one-minute primary polling without removing the five-minute compatibility fallback', () => {
  assert.match(installer, /\$fastIntervalTrigger = New-ScheduledTaskTrigger[\s\S]*?-At \(Get-Date\)\.AddMinutes\(1\)[\s\S]*?-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /\$compatibilityIntervalTrigger = New-ScheduledTaskTrigger[\s\S]*?-At \(Get-Date\)\.AddMinutes\(5\)[\s\S]*?-RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(installer, /-Trigger @\(\$logonTrigger, \$fastIntervalTrigger, \$compatibilityIntervalTrigger\)/);
  assert.equal((installer.match(/-RepetitionInterval \(New-TimeSpan -Minutes 1\)/g) || []).length, 1);
  assert.equal((installer.match(/-RepetitionInterval \(New-TimeSpan -Minutes 5\)/g) || []).length, 1);
});

test('one-minute polling preserves the existing single-instance and bounded-execution safety gates', () => {
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /-ExecutionTimeLimit \(New-TimeSpan -Minutes 15\)/);
  assert.match(installer, /effectivePollIntervalMinutes = 1/);
  assert.match(installer, /compatibilityIntervalMinutes = 5/);
  assert.match(installer, /pollStrategy = 'ONE_MINUTE_PRIMARY_FIVE_MINUTE_COMPATIBILITY_FALLBACK'/);
  assert.match(installer, /multipleInstances = 'IgnoreNew'/);
  assert.match(installer, /executionTimeLimitMinutes = 15/);
});

test('legacy validators remain truthful during the compatibility migration', () => {
  assert.match(installer, /intervalMinutes = 5/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /outboxGuardEnabled = \$true/);
  assert.match(installer, /arbitraryShellAllowed = \$false/);
  assert.match(installer, /destructiveGitAllowed = \$false/);
  assert.match(installer, /liveOpenClawUpdateAllowed = \$false/);
  assert.match(installer, /headlessLauncher = \$true/);
});
