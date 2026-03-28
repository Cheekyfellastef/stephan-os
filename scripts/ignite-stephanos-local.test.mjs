import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  collectApprovedTrackedGeneratedRestorePaths,
  evaluateGitStatusForIgnition,
  isGitWorkingTreeClean,
  isMainModule,
  runGitPullPreflightWithDeps,
  resolveStepExecution,
  shouldAutoPull,
} from './ignite-stephanos-local.mjs';

test('isMainModule matches direct script execution path', () => {
  const scriptPath = resolve('scripts/ignite-stephanos-local.mjs');
  const argv = ['node', scriptPath];
  const metaUrl = pathToFileURL(scriptPath).href;
  assert.equal(isMainModule(argv, metaUrl), true);
});

test('isMainModule does not match different module path', () => {
  const scriptPath = resolve('scripts/ignite-stephanos-local.mjs');
  const argv = ['node', scriptPath];
  const metaUrl = pathToFileURL(resolve('scripts/verify-stephanos-dist.mjs')).href;
  assert.equal(isMainModule(argv, metaUrl), false);
});

test('resolveStepExecution wraps Windows npm commands via cmd.exe', () => {
  const resolved = resolveStepExecution('npm.cmd', ['run', 'stephanos:build'], 'win32');
  assert.equal(resolved.mode, 'windows-cmd-wrapper');
  assert.match(resolved.command.toLowerCase(), /cmd\.exe$/);
  assert.deepEqual(resolved.commandArgs.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(resolved.commandArgs[3], 'npm run stephanos:build');
});

test('resolveStepExecution keeps non-Windows commands direct', () => {
  const resolved = resolveStepExecution('npm', ['run', 'stephanos:verify'], 'linux');
  assert.equal(resolved.mode, 'direct');
  assert.equal(resolved.command, 'npm');
  assert.deepEqual(resolved.commandArgs, ['run', 'stephanos:verify']);
});

test('isGitWorkingTreeClean returns true for empty porcelain output', () => {
  assert.equal(isGitWorkingTreeClean(''), true);
  assert.equal(isGitWorkingTreeClean('\n\n'), true);
});

test('isGitWorkingTreeClean returns false when meaningful changes are present', () => {
  assert.equal(isGitWorkingTreeClean(' M scripts/ignite-stephanos-local.mjs\n'), false);
});

test('ignition status evaluator allows approved local node_modules and lockfile dirt', () => {
  const evaluation = evaluateGitStatusForIgnition([
    '?? node_modules/foo/index.js',
    ' M stephanos-server/package-lock.json',
    '?? stephanos-ui/node_modules/bar/package.json',
  ].join('\n'));

  assert.equal(evaluation.meaningfulEntries.length, 0);
  assert.equal(evaluation.approvedEntries.length, 3);
  assert.equal(isGitWorkingTreeClean([
    '?? node_modules/foo/index.js',
    ' M stephanos-server/package-lock.json',
  ].join('\n')), true);
});

test('ignition status evaluator allows approved generated dist dirt', () => {
  const evaluation = evaluateGitStatusForIgnition([
    ' M apps/stephanos/dist/index.html',
    '?? apps/stephanos/dist/assets/chunk-abc123.js',
  ].join('\n'));

  assert.equal(evaluation.meaningfulEntries.length, 0);
  assert.equal(evaluation.approvedEntries.length, 2);
  assert.equal(isGitWorkingTreeClean(' M apps/stephanos/dist/index.html\n'), true);
});

test('collectApprovedTrackedGeneratedRestorePaths returns tracked dist paths only', () => {
  const evaluation = evaluateGitStatusForIgnition([
    ' M apps/stephanos/dist/index.html',
    ' M package-lock.json',
    '?? apps/stephanos/dist/assets/chunk-abc123.js',
  ].join('\n'));

  assert.deepEqual(collectApprovedTrackedGeneratedRestorePaths(evaluation), ['apps/stephanos/dist/index.html']);
});

test('ignition status evaluator blocks meaningful tracked source/script dirt', () => {
  const evaluation = evaluateGitStatusForIgnition([
    ' M scripts/ignite-stephanos-local.mjs',
    ' M shared/runtime/truthEngine.mjs',
  ].join('\n'));

  assert.equal(evaluation.meaningfulEntries.length, 2);
  assert.equal(evaluation.approvedEntries.length, 0);
  assert.equal(isGitWorkingTreeClean(' M scripts/ignite-stephanos-local.mjs\n'), false);
});

test('ignition status evaluator blocks unexpected tracked deletions outside allowlist', () => {
  const evaluation = evaluateGitStatusForIgnition([
    ' D scripts/serve-stephanos-dist.mjs',
    '?? node_modules/foo/index.js',
  ].join('\n'));

  assert.equal(evaluation.meaningfulEntries.length, 1);
  assert.equal(evaluation.meaningfulEntries[0].paths[0], 'scripts/serve-stephanos-dist.mjs');
  assert.equal(evaluation.approvedEntries.length, 1);
  assert.equal(isGitWorkingTreeClean([
    ' D scripts/serve-stephanos-dist.mjs',
    '?? node_modules/foo/index.js',
  ].join('\n')), false);
});

test('preflight restores approved tracked generated dirt before pull', () => {
  const steps = [];
  runGitPullPreflightWithDeps({
    captureStep: () => ({
      stdout: [
        ' M apps/stephanos/dist/index.html',
        '?? node_modules/foo/index.js',
      ].join('\n'),
      stderr: '',
    }),
    runStepFn: (label, command, args) => {
      steps.push({ label, command, args });
    },
  });

  assert.deepEqual(steps, [
    {
      label: 'git-restore-approved-tracked-generated-dirt',
      command: 'git',
      args: ['restore', '--worktree', '--staged', '--', 'apps/stephanos/dist/index.html'],
    },
    {
      label: 'git-fetch',
      command: 'git',
      args: ['fetch', '--prune', '--tags'],
    },
    {
      label: 'git-pull-ff-only',
      command: 'git',
      args: ['pull', '--ff-only'],
    },
  ]);
});

test('preflight keeps approved untracked local noise non-blocking without restore', () => {
  const steps = [];
  runGitPullPreflightWithDeps({
    captureStep: () => ({
      stdout: [
        '?? node_modules/foo/index.js',
        '?? apps/stephanos/dist/assets/chunk-abc123.js',
      ].join('\n'),
      stderr: '',
    }),
    runStepFn: (label, command, args) => {
      steps.push({ label, command, args });
    },
  });

  assert.deepEqual(steps, [
    {
      label: 'git-fetch',
      command: 'git',
      args: ['fetch', '--prune', '--tags'],
    },
    {
      label: 'git-pull-ff-only',
      command: 'git',
      args: ['pull', '--ff-only'],
    },
  ]);
});

test('preflight blocks meaningful dirt', () => {
  assert.throws(
    () => runGitPullPreflightWithDeps({
      captureStep: () => ({
        stdout: ' M scripts/ignite-stephanos-local.mjs\n',
        stderr: '',
      }),
      runStepFn: () => {
        throw new Error('should not run');
      },
    }),
    /blocked for safety: local working tree is dirty/,
  );
});

test('preflight blocks mixed approved and meaningful dirt', () => {
  assert.throws(
    () => runGitPullPreflightWithDeps({
      captureStep: () => ({
        stdout: [
          ' M apps/stephanos/dist/index.html',
          ' M scripts/ignite-stephanos-local.mjs',
        ].join('\n'),
        stderr: '',
      }),
      runStepFn: () => {
        throw new Error('should not run');
      },
    }),
    /blocked for safety: local working tree is dirty/,
  );
});

test('shouldAutoPull is true unless skip flag is provided', () => {
  assert.equal(shouldAutoPull(new Set()), true);
  assert.equal(shouldAutoPull(new Set(['--skip-auto-pull'])), false);
});
