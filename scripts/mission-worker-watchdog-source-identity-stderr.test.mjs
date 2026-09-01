import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url),
  'utf8',
);

const stdoutOnlyIdentityReads = [
  "$output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>$null)",
  '$repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>$null)',
  '$repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>$null)',
  "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)",
];

const mergedStderrIdentityReads = [
  "$output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>&1)",
  '$repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>&1)',
  '$repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>&1)',
  "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)",
];

test('watchdog source identity parses Git stdout only while keeping exit-code authority', () => {
  for (const line of stdoutOnlyIdentityReads) assert.ok(source.includes(line), line);
  for (const line of mergedStderrIdentityReads) assert.ok(!source.includes(line), line);

  assert.match(source, /\$repositoryBranchOutput[\s\S]*?\$LASTEXITCODE -ne 0[\s\S]*?git symbolic-ref failed/);
  assert.match(source, /\$repositoryHeadOutput[\s\S]*?\$LASTEXITCODE -ne 0[\s\S]*?git rev-parse failed/);
  assert.match(source, /\$trackedStatus[\s\S]*?\$LASTEXITCODE -ne 0[\s\S]*?git status failed/);
  assert.match(source, /\$output[\s\S]*?\$LASTEXITCODE -ne 0[\s\S]*?git ls-remote failed/);
  assert.match(source, /\$repositoryBranch -ne 'main'/);
  assert.match(source, /\$repositoryHead -notmatch '\^\[0-9a-f\]\{40\}\$'/);
  assert.match(source, /\$trackedStatus\.Count -ne 0/);
  assert.match(source, /\$repositoryHead -ne \$remoteMainHead/);
});
