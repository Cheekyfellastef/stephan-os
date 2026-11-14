import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../../scripts/windows/install-stephanos-native-capacity-publisher.ps1', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const reviewer = readFileSync(new URL('./windowsAuthorityStephanosNativeCapacityPublisherReviewV1.mjs', import.meta.url), 'utf8');
const BLOB = '24a4a9d1124da84dc99f34ba61fb3e6ed7d3153e';

test('source updater preserves original exact qualification and only the candidate installer is pinned', () => {
  const bytes = Buffer.from(source, 'utf8');
  const gitBlob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert.equal(gitBlob, BLOB);
  assert.ok(reviewer.includes("'" + BLOB + "'"));
  assert.match(reviewer, /native-capacity-recovery-repetition-missing/);
  assert.match(reviewer, /native-capacity-recovery-must-reuse-task/);
  assert.match(reviewer, /native-capacity-registered-recovery-unverified/);
});

test('one existing task retains sign-in and bounded five-minute recovery admission', () => {
  assert.match(source, /\$trigger\s*=\s*New-ScheduledTaskTrigger -AtLogOn -User \$env:USERNAME/);
  assert.match(source, /\$recoveryTrigger\s*=\s*New-ScheduledTaskTrigger -Once -At \(Get-Date\)\.AddMinutes\(2\)/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(source, /-RepetitionDuration \(New-TimeSpan -Days 365\)/);
  assert.match(source, /\$task\s*=\s*New-ScheduledTask -Action \$action -Trigger @\(\$trigger, \$recoveryTrigger\) -Settings \$settings -Principal \$principal/);
  assert.match(source, /\$registeredTriggers = @\(\$registered\.Triggers\)/);
  assert.match(source, /\$registeredTriggers.Count -ne 2/);
  assert.match(source, /MSFT_TaskLogonTrigger/);
  assert.match(source, /MSFT_TaskTimeTrigger/);
  assert.match(source, /'PT5M'/);
  assert.match(source, /'P365D'/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /-LogonType Interactive -RunLevel Limited/);
  assert.doesNotMatch(source, /Unregister-ScheduledTask|Disable-ScheduledTask|Stop-ScheduledTask|Stop-Process|taskkill|Restart-Computer|Start-Process|-RunLevel Highest/);
  assert.equal((source.match(/Register-ScheduledTask -TaskName \$taskName/g) || []).length, 1);
});

test('full candidate PowerShell parses without executing the installer', {skip: process.platform !== 'win32'}, () => {
  const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const pathArg = "'" + sourcePath.replaceAll("'", "''") + "'";
  const script = "$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile("
    + pathArg + ",[ref]$tokens,[ref]$errors);if(@($errors).Count -ne 0){exit 3};'INSTALLER_AST_PASS'";
  const result = spawnSync(psPath, ['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {encoding:'utf8', windowsHide:true, timeout:15000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr).slice(0,600));
  assert.equal(result.stdout.trim(), 'INSTALLER_AST_PASS');
});

test('real Windows Task Scheduler constructs exactly two bounded triggers without registering a task', {skip: process.platform !== 'win32'}, () => {
  const psPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const script = String.raw`
$ErrorActionPreference='Stop'
$logon=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$recovery=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 365)
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument '-NoProfile -NonInteractive -EncodedCommand ZQB4AGkAdAA='
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$principal=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$inMemoryOnly=New-ScheduledTask -Action $action -Trigger @($logon,$recovery) -Settings $settings -Principal $principal
$t=@($inMemoryOnly.Triggers)
if($t.Count -ne 2 -or $t[0].CimClass.CimClassName -ne 'MSFT_TaskLogonTrigger' -or $t[1].CimClass.CimClassName -ne 'MSFT_TaskTimeTrigger' -or $t[1].Repetition.Interval -ne 'PT5M' -or $t[1].Repetition.Duration -ne 'P365D' -or $inMemoryOnly.Settings.MultipleInstances -ne 'IgnoreNew' -or $inMemoryOnly.Principal.RunLevel -ne 'Limited') { throw 'TASK_RECURRENCE_NOT_QUALIFIED' }
'IN_MEMORY_TASK_FACTORY_PASS'
`;
  const result = spawnSync(psPath, ['-NoProfile','-NonInteractive','-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], {encoding:'utf8', windowsHide:true, timeout:15000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, String(result.stderr).slice(0,600));
  assert.equal(result.stdout.trim(), 'IN_MEMORY_TASK_FACTORY_PASS');
});