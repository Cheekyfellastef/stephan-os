import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { backendStarterInvocation } from './run-battle-bridge-ignition.mjs';

const restartSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const backendStartSource = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');
const ignitionEntrySource = await readFile(new URL('./run-battle-bridge-ignition.mjs', import.meta.url), 'utf8');

test('restart helper accepts only backend and mission-worker', () => {
  assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
  assert.match(restartSource, /Stephanos Battle Bridge Backend/);
  assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
  assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
});

test('restart helper validates canonical task action and overlap policy before mutation', () => {
  assert.match(restartSource, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(restartSource, /APPROVED_TASK_EXECUTABLE_MISMATCH/);
  assert.match(restartSource, /APPROVED_TASK_ARGUMENTS_MISMATCH/);
  assert.match(restartSource, /\$Target -eq 'backend' -and \[string\]\$task\.Settings\.MultipleInstances -ne 'IgnoreNew'/);
  assert.match(restartSource, /APPROVED_BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH/);
  assert.ok(restartSource.includes("TaskPath '\\'"));
});

test('backend entry preflight carries the parent-proven exact head into its PowerShell child', () => {
  const provenHead = 'a'.repeat(40);
  const laterHead = 'b'.repeat(40);
  const invocation = backendStarterInvocation(provenHead);
  const expectedHeadIndex = invocation.args.indexOf('-ExpectedHead');
  assert.notEqual(expectedHeadIndex, -1);
  assert.equal(invocation.args[expectedHeadIndex + 1], provenHead);
  assert.equal(invocation.args.includes(laterHead), false);
  assert.match(ignitionEntrySource, /const currentHead = entryHeadProof\.currentHead;[\s\S]*const starter = backendStarterInvocation\(currentHead\)/);
});

test('backend restart terminates only the verified 8787 Stephanos Node listener', () => {
  assert.match(restartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(restartSource, /stephanos-server\/server\.js/);
  assert.match(restartSource, /BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED/);
  assert.match(restartSource, /Stop-Process -Id \$listener\.ProcessId -Force/);
  assert.match(restartSource, /stephanos-backend-runtime\.json/);
  assert.match(restartSource, /BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT/);
  assert.match(restartSource, /stephanos\.backend-expected-head-handoff\.v1/);
  assert.match(restartSource, /BACKEND_LISTENER_DID_NOT_STOP[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /Disable-ScheduledTask[\s\S]*\$task\.State -in @\('Running', 'Queued'\)[\s\S]*\$prePublishTask = Get-ScheduledTask[\s\S]*\$prePublishTask\.State -ne 'Disabled'[\s\S]*\$prePublishTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_HANDOFF[\s\S]*Publish-BackendExpectedHeadHandoff[\s\S]*Enable-ScheduledTask[\s\S]*\$preStartTask = Get-ScheduledTask[\s\S]*\$preStartTask\.Settings\.MultipleInstances -ne 'IgnoreNew'[\s\S]*BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START[\s\S]*Start-ScheduledTask/);
  assert.match(restartSource, /backend-expected-head-handoff\.json/);
  assert.match(restartSource, /expiresAtUtc = \$issuedAtUtc\.AddMinutes\(2\)/);
  assert.match(restartSource, /catch \{[\s\S]*Remove-Item -LiteralPath \$backendExpectedHeadHandoffPath/);
  assert.match(restartSource, /BACKEND_TASK_DID_NOT_STOP/);
  assert.doesNotMatch(restartSource, /Stop-Process\s+-Name|taskkill|killall/);
});

test('worker restart requires task-owned process stop and a fresh exact-head heartbeat', () => {
  assert.match(restartSource, /mission-orchestrator-worker-heartbeat\.json/);
  assert.match(restartSource, /headSha -ne \$ExpectedSourceHead/);
  assert.match(restartSource, /MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/);
  assert.match(restartSource, /MISSION_WORKER_TASK_DID_NOT_STOP/);
  assert.match(restartSource, /MISSION_WORKER_VERIFIED_PROCESS_DID_NOT_STOP/);
  assert.match(restartSource, /Stop-Process -Id \$oldWorker\.ProcessId -Force/);
  assert.doesNotMatch(restartSource, /MISSION_WORKER_TASK_OR_PROCESS_DID_NOT_STOP|MISSION_WORKER_PROCESS_OUTSIDE_RUNNING_TASK/);
  assert.match(restartSource, /unrelatedTasksChanged = \$false/);
});

test('backend starter proves canonical main and writes a bounded exact-head runtime receipt', () => {
  assert.match(backendStartSource, /\[string\]\$ExpectedHead = ''/);
  assert.match(backendStartSource, /branch --show-current/);
  assert.match(backendStartSource, /rev-parse HEAD/);
  assert.match(backendStartSource, /branch -ne 'main'/);
  assert.match(backendStartSource, /upstream -ne 'origin\/main'/);
  assert.match(backendStartSource, /originHead -ne \$headSha/);
  assert.match(backendStartSource, /\$boundExpectedHead = if \(\$providedExpectedHead\) \{ \$providedExpectedHead \} else \{ \$headSha \}/);
  assert.match(backendStartSource, /observedHead -ne \$boundExpectedHead/);
  assert.match(backendStartSource, /function Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /Move-Item -LiteralPath \$handoffPath -Destination \$consumedPath/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_CONSUME_FAILED/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED/);
  assert.doesNotMatch(backendStartSource, /expiresAtUtc -le \$nowUtc\) \{ return \$null/);
  assert.match(backendStartSource, /BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID/);
  assert.match(backendStartSource, /expiresAtUtc -le \$issuedAtUtc/);
  assert.match(backendStartSource, /if \(-not \$providedExpectedHead\) \{[\s\S]*Read-BackendExpectedHeadHandoff/);
  assert.match(backendStartSource, /stephanos-backend-runtime\.json/);
  assert.match(backendStartSource, /headSha = \$HeadSha/);
  assert.match(backendStartSource, /taskName = 'Stephanos Battle Bridge Backend'/);
  assert.match(backendStartSource, /pathValuesPublished = \$false/);
  assert.match(backendStartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.doesNotMatch(backendStartSource, /repositoryRoot\s*=/);
});

test('backend starter captures native Git exit codes before selecting bounded output', () => {
  assert.match(
    backendStartSource,
    /\$branchOutput = @\(& \$canonicalGit -C \$repoRoot branch --show-current 2>\$null\)\r?\n\$branchExitCode = \$LASTEXITCODE\r?\nif \(\$branchExitCode -ne 0\)/,
  );
  assert.match(
    backendStartSource,
    /\$headOutput = @\(& \$canonicalGit -C \$repoRoot rev-parse HEAD 2>\$null\)\r?\n\$headExitCode = \$LASTEXITCODE\r?\nif \(\$headExitCode -ne 0\)/,
  );
  assert.match(backendStartSource, /\$branchRaw = \$branchOutput \| Select-Object -First 1/);
  assert.match(backendStartSource, /\$headRaw = \$headOutput \| Select-Object -First 1/);
  assert.doesNotMatch(backendStartSource, /& \$canonicalGit[^\r\n]+\|\s*Select-Object/);
});
