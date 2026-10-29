import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixedSourceTaskRunnerV1} from './sovereign-fixed-runtime-source-task-v1.mjs';
import {resolve} from 'node:path';

test('fixed source runner rejects unbound budget executable cwd and private index before spawn', () => {
  const options={worktreePath:resolve('fixture-worktree'),processingPath:resolve('fixture-claim.json'),remainingMs:900000};
  assert.throws(()=>createFixedSourceTaskRunnerV1({...options,remainingMs:1800001}),/NATIVE_WINDOW_REQUIRED/);
  const run=createFixedSourceTaskRunnerV1(options);
  assert.throws(()=>run('powershell.exe',[],{cwd:options.worktreePath}),/FIXED_EXECUTABLE_REQUIRED/);
  assert.throws(()=>run('node.exe',[],{cwd:resolve('other')}),/FIXED_RUNNER_IDENTITY_REQUIRED/);
  assert.throws(()=>run('git.exe',[],{cwd:options.worktreePath,env:{GIT_INDEX_FILE:resolve('other-index')}}),/PRIVATE_INDEX_UNBOUND/);
});
