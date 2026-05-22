import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  autoPublishDistWithDeps,
  canAutoPublishDist,
  checkpointAndRemoveTransientRootData,
  classifyPublicationTruth,
  collectApprovedTrackedGeneratedRestorePaths,
  collectRuntimeStatePaths,
  evaluateGitPublicationTruthWithDeps,
  evaluateGitStatusForIgnition,
  isGitWorkingTreeClean,
  isMainModule,
  runGitPullPreflightWithDeps,
  resolveStepExecution,
  shouldAutoPublishDist,
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



test('checkpointAndRemoveTransientRootData uses cross-platform fs copy and remove', () => {
  const calls = [];
  const logs = [];
  const checkpointPath = checkpointAndRemoveTransientRootData({
    timestamp: () => '2026-05-22T00-00-00-000Z',
    makeDir: (dirPath) => calls.push(['mkdir', dirPath]),
    copyPath: (fromPath, toPath) => calls.push(['copy', fromPath, toPath]),
    removePath: (targetPath) => calls.push(['remove', targetPath]),
    log: (message) => logs.push(message),
  });

  assert.equal(checkpointPath, '.stephanos/local-state-checkpoints/2026-05-22T00-00-00-000Z/root-data/data');
  assert.deepEqual(calls, [
    ['mkdir', '.stephanos/local-state-checkpoints/2026-05-22T00-00-00-000Z/root-data'],
    ['copy', 'data', '.stephanos/local-state-checkpoints/2026-05-22T00-00-00-000Z/root-data/data'],
    ['remove', 'data'],
  ]);
  assert.deepEqual(logs, [
    '[IGNITION] transient root data detected: data/',
    '[IGNITION] transient root data checkpointed: .stephanos/local-state-checkpoints/2026-05-22T00-00-00-000Z/root-data/data',
    '[IGNITION] transient root data removed',
  ]);
});

test('preflight housekeeping works without shell cp on Windows-style environment', () => {
  const steps = [];
  runGitPullPreflightWithDeps({
    captureStep: (label) => {
      if (label === 'git-status') return { stdout: '?? data/session-cache.json\n', stderr: '' };
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-ahead-behind') return { stdout: '0\t0\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label, command) => {
      steps.push({ label, command });
      if (command === 'cp' || command === 'rm') throw new Error('unix command not allowed');
    },
    checkpointRootData: () => {
      steps.push({ label: 'checkpoint-root-data-fs', command: 'node-fs' });
    },
    createCheckpoint: () => null,
    restoreCheckpoint: () => {},
  });

  assert.ok(steps.some((step) => step.label === 'git-fetch'));
  assert.ok(steps.some((step) => step.label === 'git-pull-ff-only'));
  assert.ok(steps.every((step) => step.command !== 'cp'));
  assert.ok(steps.every((step) => step.command !== 'rm'));
});

test('server runtime data path is classified as runtime-state not transient root data', () => {
  const evaluation = evaluateGitStatusForIgnition(' M stephanos-server/data/memory/durable-memory.json\n');
  assert.equal(evaluation.runtimeStateEntries.length, 1);
  assert.equal(evaluation.transientRootDataEntries.length, 0);
});

test('package scripts include plain ignition aliases with expected targets', async () => {
  const { readFile } = await import('node:fs/promises');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['stephanos:serve'], 'node scripts/ignite-stephanos-local.mjs');
  assert.equal(packageJson.scripts['stephanos:ignite'], 'npm run stephanos:serve');
  assert.equal(packageJson.scripts['stephanos:ignite:auto-publish'], 'node scripts/ignite-stephanos-local-autopublish.mjs');
});
test('isGitWorkingTreeClean returns true for empty porcelain output', () => {
  assert.equal(isGitWorkingTreeClean(''), true);
  assert.equal(isGitWorkingTreeClean('\n\n'), true);
});

test('isGitWorkingTreeClean returns false when meaningful changes are present', () => {
  assert.equal(isGitWorkingTreeClean(' M scripts/ignite-stephanos-local.mjs\n'), false);
});

test('ignition status evaluator allows dependency dirt but not lockfile source dirt', () => {
  const evaluation = evaluateGitStatusForIgnition([
    '?? node_modules/foo/index.js',
    ' M stephanos-server/package-lock.json',
    '?? stephanos-ui/node_modules/bar/package.json',
  ].join('\n'));

  assert.equal(evaluation.meaningfulEntries.length, 1);
  assert.equal(evaluation.approvedEntries.length, 2);
  assert.equal(isGitWorkingTreeClean('?? node_modules/foo/index.js\n'), true);
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

test('ignition status evaluator classifies backend runtime data dirt separately', () => {
  const evaluation = evaluateGitStatusForIgnition([
    ' M stephanos-server/data/memory/durable-memory.json',
    '?? data/session-cache.json',
  ].join('\n'));

  assert.equal(evaluation.runtimeStateEntries.length, 1);
  assert.equal(evaluation.transientRootDataEntries.length, 1);
  assert.equal(evaluation.meaningfulEntries.length, 0);
  assert.equal(evaluation.approvedEntries.length, 0);
  assert.deepEqual(collectRuntimeStatePaths(evaluation), [
    'stephanos-server/data/memory/durable-memory.json',
  ]);
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
    captureStep: (label) => {
      if (label === 'git-status') {
        return {
          stdout: [
            ' M apps/stephanos/dist/index.html',
            '?? node_modules/foo/index.js',
          ].join('\n'),
          stderr: '',
        };
      }
      if (label === 'git-branch') {
        return { stdout: 'main\n', stderr: '' };
      }
      if (label === 'git-upstream') {
        return { stdout: 'origin/main\n', stderr: '' };
      }
      if (label === 'git-ahead-behind') {
        return { stdout: '0\t0\n', stderr: '' };
      }
      throw new Error(`unexpected capture label: ${label}`);
    },
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
    captureStep: (label) => {
      if (label === 'git-status') {
        return {
          stdout: [
            '?? node_modules/foo/index.js',
            '?? apps/stephanos/dist/assets/chunk-abc123.js',
          ].join('\n'),
          stderr: '',
        };
      }
      if (label === 'git-branch') {
        return { stdout: 'main\n', stderr: '' };
      }
      if (label === 'git-upstream') {
        return { stdout: 'origin/main\n', stderr: '' };
      }
      if (label === 'git-ahead-behind') {
        return { stdout: '0\t0\n', stderr: '' };
      }
      throw new Error(`unexpected capture label: ${label}`);
    },
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

test('runtime state dirt is checkpointed and does not block launch preflight', () => {
  const steps = [];
  let createdPaths = [];
  let restored = false;
  runGitPullPreflightWithDeps({
    captureStep: (label) => {
      if (label === 'git-status') {
        return {
          stdout: [
            ' M stephanos-server/data/memory/durable-memory.json',
          ].join('\n'),
          stderr: '',
        };
      }
      if (label === 'git-branch') {
        return { stdout: 'main\n', stderr: '' };
      }
      if (label === 'git-upstream') {
        return { stdout: 'origin/main\n', stderr: '' };
      }
      if (label === 'git-ahead-behind') {
        return { stdout: '0\t0\n', stderr: '' };
      }
      throw new Error(`unexpected capture label: ${label}`);
    },
    createCheckpoint: (runtimePaths) => {
      createdPaths = runtimePaths;
      return {
        checkpointDir: '.stephanos/local-state-checkpoints/2026-04-27T00-00-00-000Z',
        manifest: { paths: runtimePaths.map((path) => ({ path, exists: true })) },
      };
    },
    restoreCheckpoint: () => {
      restored = true;
    },
    runStepFn: (label, command, args) => {
      steps.push({ label, command, args });
    },
  });

  assert.deepEqual(createdPaths, ['stephanos-server/data/memory/durable-memory.json']);
  assert.equal(restored, true);
  assert.deepEqual(steps, [
    {
      label: 'git-restore-runtime-state-before-pull',
      command: 'git',
      args: ['restore', '--worktree', '--staged', '--', 'stephanos-server/data/memory/durable-memory.json'],
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

test('checkpoint failure blocks safely before pull', () => {
  assert.throws(
    () => runGitPullPreflightWithDeps({
      captureStep: (label) => {
      if (label === 'git-status') {
          return {
            stdout: ' M stephanos-server/data/memory/durable-memory.json\n',
            stderr: '',
          };
        }
        throw new Error(`unexpected capture label: ${label}`);
      },
      createCheckpoint: () => {
        throw new Error('disk full');
      },
      runStepFn: () => {
        throw new Error('should not run');
      },
    }),
    /runtime state checkpoint failed/,
  );
});

test('auto-publish requires explicit env flag', () => {
  assert.equal(shouldAutoPublishDist({}), false);
  assert.equal(shouldAutoPublishDist({ STEPHANOS_IGNITION_AUTOPUBLISH_DIST: '1' }), true);
});

test('auto-publish gate blocks non-main/non-origin and unsafe staged paths', () => {
  const cleanStatus = evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n');
  assert.equal(canAutoPublishDist({ statusAssessment: cleanStatus, branch: 'feature/x', upstream: 'origin/main' }).ok, false);
  assert.equal(canAutoPublishDist({ statusAssessment: cleanStatus, branch: 'main', upstream: 'upstream/main' }).ok, false);
  assert.equal(canAutoPublishDist({
    statusAssessment: cleanStatus,
    branch: 'main',
    upstream: 'origin/main',
    stagedPaths: ['stephanos-server/data/memory/durable-memory.json'],
  }).ok, false);
  assert.equal(canAutoPublishDist({
    statusAssessment: cleanStatus,
    branch: 'main',
    upstream: 'origin/main',
    stagedPaths: ['scripts/ignite-stephanos-local.mjs'],
  }).ok, false);
});

test('auto-publish stages dist only and pushes after verify pass', () => {
  const calls = [];
  autoPublishDistWithDeps({
    statusAssessment: evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n'),
    captureStep: (label) => {
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-diff-staged-names') return { stdout: 'apps/stephanos/dist/index.html\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label, command, commandArgs) => {
      calls.push({ label, command, commandArgs });
    },
  });
  assert.ok(calls.some((call) => call.label === 'verify'));
  assert.ok(calls.some((call) => call.label === 'git-add-dist-only' && call.commandArgs.join(' ') === 'add --all -- apps/stephanos/dist'));
  assert.ok(calls.some((call) => call.label === 'git-push' && call.commandArgs.join(' ') === 'push origin main'));
  assert.ok(calls.every((call) => !(call.command === 'git' && call.commandArgs.join(' ') === 'add .')));
});

test('auto-publish stale verify runs build then verify', () => {
  const calls = [];
  autoPublishDistWithDeps({
    statusAssessment: evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n'),
    captureStep: (label) => {
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-diff-staged-names') return { stdout: 'apps/stephanos/dist/index.html\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label) => {
      calls.push(label);
      if (label === 'verify' && calls.filter((name) => name === 'verify').length === 1) {
        throw new Error('stale dist metadata');
      }
    },
  });
  assert.deepEqual(calls.slice(0, 3), ['verify', 'build', 'verify']);
});

test('auto-publish remote moved retries with rebase/build/verify and no force push', () => {
  const calls = [];
  autoPublishDistWithDeps({
    statusAssessment: evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n'),
    captureStep: (label) => {
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-diff-staged-names') return { stdout: 'apps/stephanos/dist/index.html\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label, command, commandArgs) => {
      calls.push({ label, command, commandArgs });
      if (label === 'git-push') throw new Error('non-fast-forward');
    },
  });
  assert.ok(calls.some((call) => call.label === 'git-pull-rebase-main'));
  assert.ok(calls.some((call) => call.label === 'git-push-retry'));
  assert.ok(calls.every((call) => !(call.command === 'git' && call.commandArgs.includes('--force'))));
});

test('preflight blocks when require-published-head is enabled and branch is ahead', () => {
  assert.throws(
    () => runGitPullPreflightWithDeps({
      argvArgs: new Set(['--require-published-head']),
      captureStep: (label) => {
        if (label === 'git-status') {
          return { stdout: '', stderr: '' };
        }
        if (label === 'git-branch') {
          return { stdout: 'main\n', stderr: '' };
        }
        if (label === 'git-upstream') {
          return { stdout: 'origin/main\n', stderr: '' };
        }
        if (label === 'git-ahead-behind') {
          return { stdout: '1\t0\n', stderr: '' };
        }
        throw new Error(`unexpected capture label: ${label}`);
      },
      runStepFn: (stepLabel) => {
        if (stepLabel !== 'git-fetch') {
          throw new Error(`unexpected runStep label: ${stepLabel}`);
        }
      },
    }),
    /remote publication parity required but local HEAD is not publish-backed/i,
  );
});

test('preflight blocks when branch has no upstream configured', () => {
  assert.throws(
    () => runGitPullPreflightWithDeps({
      captureStep: (label) => {
        if (label === 'git-status') {
          return { stdout: '', stderr: '' };
        }
        if (label === 'git-branch') {
          return { stdout: 'feature/no-upstream\n', stderr: '' };
        }
        if (label === 'git-upstream') {
          throw new Error('fatal: no upstream configured');
        }
        throw new Error(`unexpected capture label: ${label}`);
      },
      runStepFn: (stepLabel) => {
        if (stepLabel !== 'git-fetch') {
          throw new Error(`unexpected runStep label: ${stepLabel}`);
        }
      },
    }),
    /no upstream tracking branch/i,
  );
});

test('shouldAutoPull is true unless skip flag is provided', () => {
  assert.equal(shouldAutoPull(new Set()), true);
  assert.equal(shouldAutoPull(new Set(['--skip-auto-pull'])), false);
});

test('classifyPublicationTruth maps git publication states with operator guidance', () => {
  const healthy = classifyPublicationTruth({
    branch: 'main',
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    aheadCount: 0,
    behindCount: 0,
  });
  assert.equal(healthy.publicationState, 'healthy-synced');
  assert.equal(healthy.headPublished, true);

  const ahead = classifyPublicationTruth({
    branch: 'main',
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    aheadCount: 2,
    behindCount: 0,
  });
  assert.equal(ahead.publicationState, 'unpublished-local-only');
  assert.equal(ahead.headPublished, false);
  assert.match(ahead.operatorAction, /not published to remote truth/i);

  const behind = classifyPublicationTruth({
    branch: 'main',
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    aheadCount: 0,
    behindCount: 1,
  });
  assert.equal(behind.publicationState, 'stale-behind');

  const diverged = classifyPublicationTruth({
    branch: 'main',
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    aheadCount: 1,
    behindCount: 1,
  });
  assert.equal(diverged.publicationState, 'diverged');

  const untracked = classifyPublicationTruth({
    branch: 'feature/no-upstream',
    hasUpstream: false,
  });
  assert.equal(untracked.publicationState, 'unknown-untracked');

  const detached = classifyPublicationTruth({
    detachedHead: true,
    hasUpstream: false,
  });
  assert.equal(detached.publicationState, 'detached-head');
});

test('evaluateGitPublicationTruthWithDeps reports ahead/behind publication truth', () => {
  const calls = [];
  const result = evaluateGitPublicationTruthWithDeps({
    captureStep: (label, command, args) => {
      calls.push({ label, command, args });
      if (label === 'git-branch') {
        return { stdout: 'main\n' };
      }
      if (label === 'git-upstream') {
        return { stdout: 'origin/main\n' };
      }
      if (label === 'git-ahead-behind') {
        return { stdout: '2\t0\n' };
      }
      throw new Error(`unexpected label ${label}`);
    },
  });

  assert.equal(result.branch, 'main');
  assert.equal(result.upstreamBranch, 'origin/main');
  assert.equal(result.aheadCount, 2);
  assert.equal(result.behindCount, 0);
  assert.equal(result.headPublished, false);
  assert.equal(result.publicationState, 'unpublished-local-only');
  assert.deepEqual(calls.map((entry) => entry.label), ['git-branch', 'git-upstream', 'git-ahead-behind']);
});

test('evaluateGitPublicationTruthWithDeps handles missing upstream as untracked state', () => {
  const result = evaluateGitPublicationTruthWithDeps({
    captureStep: (label) => {
      if (label === 'git-branch') {
        return { stdout: 'feature/no-upstream\n' };
      }
      if (label === 'git-upstream') {
        throw new Error('fatal: no upstream configured');
      }
      throw new Error(`unexpected label ${label}`);
    },
  });

  assert.equal(result.hasUpstream, false);
  assert.equal(result.publicationState, 'unknown-untracked');
  assert.equal(result.headPublished, false);
});
