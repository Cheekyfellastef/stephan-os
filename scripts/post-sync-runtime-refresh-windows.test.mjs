import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const restartSource = await readFile(new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url), 'utf8');
const backendStartSource = await readFile(new URL('./windows/start-stephanos-backend.ps1', import.meta.url), 'utf8');

test('restart helper accepts only backend and mission-worker', () => {
  assert.match(restartSource, /ValidateSet\('backend', 'mission-worker'\)/);
  assert.match(restartSource, /Stephanos Battle Bridge Backend/);
  assert.match(restartSource, /Stephanos Mission Orchestrator Worker/);
  assert.doesNotMatch(restartSource, /\[string\]\$TaskName/);
});

test('restart helper validates canonical task action before mutation', () => {
  assert.match(restartSource, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(restartSource, /APPROVED_TASK_EXECUTABLE_MISMATCH/);
  assert.match(restartSource, /APPROVED_TASK_ARGUMENTS_MISMATCH/);
  assert.ok(restartSource.includes("TaskPath '\\'"));
});

test('backend restart terminates only the verified 8787 Stephanos Node listener', () => {
  assert.match(restartSource, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(restartSource, /stephanos-server\/server\.js/);
  assert.match(restartSource, /BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED/);
  assert.match(restartSource, /Stop-Process -Id \$listener\.ProcessId -Force/);
  assert.match(restartSource, /stephanos-backend-runtime\.json/);
  assert.match(restartSource, /BACKEND_EXACT_HEAD_RECEIPT_TIMEOUT/);
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
  assert.match(restartSource, /CANONICAL_TRACKED_SOURCE_DIRTY/);
  assert.match(restartSource, /CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START/);
  assert.match(restartSource, /Stop-ScheduledTask -TaskName \$plan\.TaskName -TaskPath '\\' -ErrorAction SilentlyContinue/);
});

test('backend starter proves canonical main and writes a bounded exact-head runtime receipt', () => {
  assert.match(backendStartSource, /branch --show-current/);
  assert.match(backendStartSource, /rev-parse HEAD/);
  assert.match(backendStartSource, /branch -ne 'main'/);
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
