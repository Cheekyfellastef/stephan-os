import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixedSourceTaskRunnerV1} from './sovereign-fixed-runtime-source-task-v1.mjs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('fixed source runner rejects unbound budget executable cwd and private index before spawn', () => {
  const options={worktreePath:resolve('fixture-worktree'),processingPath:resolve('fixture-claim.json'),remainingMs:900000};
  assert.throws(()=>createFixedSourceTaskRunnerV1({...options,remainingMs:1800001}),/NATIVE_WINDOW_REQUIRED/);
  const run=createFixedSourceTaskRunnerV1(options);
  assert.throws(()=>run('powershell.exe',[],{cwd:options.worktreePath}),/FIXED_EXECUTABLE_REQUIRED/);
  assert.throws(()=>run('node.exe',[],{cwd:resolve('other')}),/FIXED_RUNNER_IDENTITY_REQUIRED/);
  assert.throws(()=>run('git.exe',[],{cwd:options.worktreePath,env:{GIT_INDEX_FILE:resolve('other-index')}}),/PRIVATE_INDEX_UNBOUND/);
});

test('actual fixed child rejects elastic identity aliases before any claim filesystem observation', () => {
  for (const missionId of ['CRITICAL-3106-ELASTIC-GOAL', 'critical-3106-Elastic-goal',
    ' critical-3106-elastic-goal', 'critical-03106-elastic-goal', 'critical-3106-elastic-goal-copy',
    'critical-3106-elastic-goalcopy', 'critical-3106-elastic-goal:copy', 'critical_3106_elastic_goal']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./sovereign-fixed-runtime-source-task-v1.mjs', import.meta.url))], {
      input: JSON.stringify({ missionId }), encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 5000, maxBuffer: 16384,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /NONCANONICAL_ELASTIC_MISSION_IDENTITY/);
    assert.doesNotMatch(result.stdout, /ENOENT|SOURCE_TASK_CLAIM/);
  }
});
