import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFixedSyncAndRefreshAdapter } from './battle-bridge-github-sync-and-refresh.mjs';
import { createFixedWorkerProbeAdapter } from './battle-bridge-worker-watchdog.mjs';

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

test('post-sync refresh child isolates Git stderr without changing the parent process environment', () => {
  const calls = [];
  const parentValue = process.env.GIT_REDIRECT_STDERR;
  const adapter = createFixedSyncAndRefreshAdapter({
    spawnSyncFn(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: 'POST_SYNC_REFRESH_RESULT={"ok":true}\n',
        stderr: '',
        error: null,
      };
    },
  });

  const result = adapter.runRefresh({
    beforeHead: HEAD_A,
    afterHead: HEAD_B,
    paths: { repoRoot: 'C:\\canonical\\stephan-os', refreshCoordinator: 'C:\\canonical\\refresh.mjs' },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.GIT_REDIRECT_STDERR, 'off');
  assert.equal(process.env.GIT_REDIRECT_STDERR, parentValue);
  assert.equal(calls[0].options.shell, false);
});

test('watchdog probe child isolates Git stderr while retaining fixed PowerShell and no-shell execution', () => {
  const calls = [];
  const adapter = createFixedWorkerProbeAdapter({
    probeScriptPath: 'C:\\canonical\\probe-mission-orchestrator-worker-watchdog.ps1',
    powerShellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    spawnSyncFn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '{}', stderr: '', error: null };
    },
  });

  const result = adapter.run('Inspect', { timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0].options.env.GIT_REDIRECT_STDERR, 'off');
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
});

test('watchdog source identity reads keep Git stderr out of parsed stdout while retaining fail-closed exit checks', async () => {
  const source = await readFile(new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url), 'utf8');
  const stdoutOnlyReads = [
    "$output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>$null)",
    '$repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>$null)',
    '$repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>$null)',
    "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)",
  ];
  const contaminatedReads = [
    "$output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>&1)",
    '$repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>&1)',
    '$repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>&1)',
    "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)",
  ];

  for (const read of stdoutOnlyReads) assert.equal(source.includes(read), true, `missing stdout-only Git identity read: ${read}`);
  for (const read of contaminatedReads) assert.equal(source.includes(read), false, `Git stderr must not contaminate parsed source proof: ${read}`);
  assert.match(source, /if \(\$LASTEXITCODE -ne 0\) \{\s*throw \('git symbolic-ref failed:/);
  assert.match(source, /if \(\$LASTEXITCODE -ne 0\) \{\s*throw \('git rev-parse failed:/);
  assert.match(source, /if \(\$LASTEXITCODE -ne 0\) \{\s*throw \('git ls-remote failed:/);
  assert.match(source, /if \(\$trackedStatus\.Count -ne 0\) \{\s*throw 'Canonical repository tracked source is dirty\.'/);
});

test('Mission Worker launcher scopes Git stderr isolation only to canonical Git preflight and restores it before worker launch', async () => {
  const source = await readFile(new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url), 'utf8');
  const save = "$previousGitRedirectStderr = [Environment]::GetEnvironmentVariable('GIT_REDIRECT_STDERR', 'Process')";
  const enable = "$env:GIT_REDIRECT_STDERR = 'off'";
  const cleanProof = "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)";
  const contaminatedCleanProof = "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)";
  const restore = "Remove-Item Env:GIT_REDIRECT_STDERR -ErrorAction SilentlyContinue";
  const restoreExisting = '$env:GIT_REDIRECT_STDERR = $previousGitRedirectStderr';
  const workerLaunch = '$processStartInfo = New-Object System.Diagnostics.ProcessStartInfo';
  const startInvocation = '$ordinaryWorker = Start-ExactWorkerWithLaunchIdentity';

  assert.equal((source.match(/\$env:GIT_REDIRECT_STDERR = 'off'/g) || []).length, 1);
  assert.ok(source.indexOf(save) >= 0);
  assert.ok(source.indexOf(enable) > source.indexOf(save));
  assert.ok(source.indexOf(cleanProof) > source.indexOf(enable));
  assert.equal(source.includes(contaminatedCleanProof), false);
  assert.ok(source.indexOf(restore) > source.indexOf(cleanProof));
  assert.ok(source.indexOf(restoreExisting) > source.indexOf(cleanProof));
  assert.ok(source.indexOf(startInvocation) > source.indexOf(restore));
  assert.ok(source.indexOf(workerLaunch) < source.indexOf(enable), 'worker launch function definition may exist earlier, but invocation must occur after restore');
  assert.match(source, /if \(\$LASTEXITCODE -ne 0 -or \$trackedStatus\.Count -ne 0\) \{\s*throw 'Mission Orchestrator worker requires tracked-clean exact-head source\.'/);
  assert.match(source, /finally \{[\s\S]*Remove-Item Env:GIT_REDIRECT_STDERR[\s\S]*\$env:GIT_REDIRECT_STDERR = \$previousGitRedirectStderr[\s\S]*\}/);
});
