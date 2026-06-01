import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  autoPublishDistWithDeps,
  canAutoPublishDist,
  checkpointAndRemoveTransientRootData,
  classifyIgnitionDirtPath,
  classifyPublicationTruth,
  collectApprovedTrackedGeneratedRestorePaths,
  collectRuntimeStatePaths,
  evaluateGitPublicationTruthWithDeps,
  evaluateGitStatusForIgnition,
  isGitWorkingTreeClean,
  isMainModule,
  resolveIgnitionMode,
  runGitPullPreflightWithDeps,
  resolveStepExecution,
  runIgnitionHousekeep,
  shouldAutoPublishDist,
  shouldAutoPull,
} from './ignite-stephanos-local.mjs';
import { isStephanosDebugEnabled } from './stephanos-build-utils.mjs';

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

test('stephanos debug gate defaults to off and enables via --debug or STEPHANOS_DEBUG=1', () => {
  assert.equal(isStephanosDebugEnabled({ argv: [], env: {} }), false);
  assert.equal(isStephanosDebugEnabled({ argv: ['--debug'], env: {} }), true);
  assert.equal(isStephanosDebugEnabled({ argv: [], env: { STEPHANOS_DEBUG: '1' } }), true);
  assert.equal(isStephanosDebugEnabled({ argv: [], env: { STEPHANOS_DEBUG: 'true' } }), false);
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
  assert.equal(packageJson.scripts['stephanos:ignite'], 'node scripts/ignite-stephanos-local.mjs --mode=ignite');
  assert.equal(packageJson.scripts['stephanos:ignite:auto-publish'], 'node scripts/ignite-stephanos-local-autopublish.mjs');
  assert.equal(packageJson.scripts['stephanos:ignite:pr-clean'], 'node scripts/ignite-stephanos-local.mjs --mode=pr-clean');
  assert.equal(packageJson.scripts['stephanos:ignite:housekeep'], 'node scripts/ignite-stephanos-local.mjs --mode=housekeep');
  assert.equal(packageJson.scripts['stephanos:ignite:housekeep:dry-run'], 'node scripts/ignite-stephanos-local.mjs --mode=housekeep-dry-run');
  assert.ok(!packageJson.scripts['stephanos:ignite:pr-clean'].includes('STEPHANOS_IGNITION_MODE='));
  assert.ok(!packageJson.scripts['stephanos:ignite:housekeep'].includes('STEPHANOS_IGNITION_MODE='));
  assert.ok(!packageJson.scripts['stephanos:ignite:housekeep:dry-run'].includes('STEPHANOS_IGNITION_MODE='));
});

test('resolveIgnitionMode accepts CLI housekeep modes', () => {
  assert.equal(resolveIgnitionMode({ argvArgs: ['--mode=ignite'], envMode: '', autoPublishEnabled: false }), 'NORMAL_IGNITION');
  assert.equal(resolveIgnitionMode({ argvArgs: ['--mode=housekeep'], envMode: '', autoPublishEnabled: false }), 'HOUSEKEEP');
  assert.equal(resolveIgnitionMode({ argvArgs: ['--mode=housekeep-dry-run'], envMode: '', autoPublishEnabled: false }), 'HOUSEKEEP_DRY_RUN');
});

test('resolveIgnitionMode keeps env fallback when CLI mode is absent', () => {
  assert.equal(resolveIgnitionMode({ argvArgs: [], envMode: 'housekeep', autoPublishEnabled: false }), 'HOUSEKEEP');
  assert.equal(resolveIgnitionMode({ argvArgs: [], envMode: 'housekeep-dry-run', autoPublishEnabled: false }), 'HOUSEKEEP_DRY_RUN');
  assert.equal(resolveIgnitionMode({ argvArgs: [], envMode: 'pr-clean', autoPublishEnabled: false }), 'PR_CLEAN_ROOM');
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

test('ignition status evaluator classifies secrets and unknown binary as forbidden/blocked', () => {
  const evaluation = evaluateGitStatusForIgnition([
    '?? .env.local',
    '?? mystery.bin',
  ].join('\n'));
  assert.equal(evaluation.forbiddenOrUnknownEntries.length, 2);
  assert.equal(evaluation.meaningfulEntries.length, 2);
});

test('ignition dirt classifier maps required categories', () => {
  assert.equal(classifyIgnitionDirtPath('apps/stephanos/dist/index.html'), 'AUTO_CLEAN_GENERATED');
  assert.equal(classifyIgnitionDirtPath('apps/stephanos/dist/assets/chunk-a.js'), 'AUTO_CLEAN_GENERATED');
  assert.equal(classifyIgnitionDirtPath('stephanos-server/data/memory/durable-memory.json'), 'RUNTIME_CHECKPOINT_CLEAN');
  assert.equal(classifyIgnitionDirtPath('data/activity/latest.json'), 'RUNTIME_CHECKPOINT_CLEAN');
  assert.equal(classifyIgnitionDirtPath('data/knowledge-graph/nodes.json'), 'RUNTIME_CHECKPOINT_CLEAN');
  assert.equal(classifyIgnitionDirtPath('stephanos-ui/node_modules/foo/index.js'), 'DEPENDENCY_WARNING');
  assert.equal(classifyIgnitionDirtPath('stephanos-ui/src/App.jsx'), 'SOURCE_DIRT_APPROVAL_REQUIRED');
  assert.equal(classifyIgnitionDirtPath('package.json'), 'SOURCE_DIRT_APPROVAL_REQUIRED');
  assert.equal(classifyIgnitionDirtPath('.env.local'), 'HARD_BLOCK');
  assert.equal(classifyIgnitionDirtPath('unknown/payload.bin'), 'HARD_BLOCK');
});





test('ignition keeps root-level OpenClaw workspace files hard-blocked', () => {
  const rootOpenClawPaths = [
    '.openclaw',
    'DREAMS.md',
    'HEARTBEAT.md',
    'IDENTITY.md',
    'SOUL.md',
    'TOOLS.md',
    'USER.md',
    'memory',
  ];

  for (const path of rootOpenClawPaths) {
    assert.equal(classifyIgnitionDirtPath(path), 'HARD_BLOCK', `${path} remains root hard-blocked`);
  }

  const rootStatusPaths = rootOpenClawPaths.map((path) => (path === '.openclaw' || path === 'memory') ? `?? ${path}/` : `?? ${path}`);
  const evaluation = evaluateGitStatusForIgnition(rootStatusPaths.join('\n'));
  assert.equal(evaluation.forbiddenOrUnknownEntries.length, rootOpenClawPaths.length);
  assert.equal(evaluation.meaningfulEntries.length, rootOpenClawPaths.length);
});

test('ignition allows OpenClaw files only under sanctioned runtime workspace', () => {
  const sanctionedPaths = [
    'runtime/openclaw-workspace/.openclaw/config.json',
    'runtime/openclaw-workspace/DREAMS.md',
    'runtime/openclaw-workspace/HEARTBEAT.md',
    'runtime/openclaw-workspace/IDENTITY.md',
    'runtime/openclaw-workspace/SOUL.md',
    'runtime/openclaw-workspace/TOOLS.md',
    'runtime/openclaw-workspace/USER.md',
    'runtime/openclaw-workspace/memory/index.json',
  ];

  for (const path of sanctionedPaths) {
    assert.equal(classifyIgnitionDirtPath(path), 'OPENCLAW_RUNTIME_WORKSPACE_ALLOWED', `${path} is allowed only in the sanctioned runtime workspace`);
  }

  const evaluation = evaluateGitStatusForIgnition(sanctionedPaths.map((path) => `?? ${path}`).join('\n'));
  assert.equal(evaluation.forbiddenOrUnknownEntries.length, 0);
  assert.equal(evaluation.meaningfulEntries.length, 0);
  assert.equal(isGitWorkingTreeClean(sanctionedPaths.map((path) => `?? ${path}`).join('\n')), true);
});

test('ignition still blocks unrelated unknown hard-block files', () => {
  const evaluation = evaluateGitStatusForIgnition('?? random-runtime-output.txt\n?? unknown/payload.bin\n');
  assert.equal(evaluation.forbiddenOrUnknownEntries.length, 2);
  assert.equal(evaluation.meaningfulEntries.length, 2);
  assert.equal(isGitWorkingTreeClean('?? random-runtime-output.txt\n'), false);
});

test('housekeep auto-cleans allowlisted root runtime data and stays READY', () => {
  const steps = [];
  runIgnitionHousekeep({
    dryRun: false,
    compact: true,
    captureStepFn: (label) => {
      if (label === 'git-status') return { stdout: '?? data/\n', stderr: '' };
      if (label === 'git-untracked-data') return { stdout: [
        'data/activity/events.json',
        'data/knowledge-graph/nodes.json',
        'data/knowledge-graph/edges.json',
        'data/proposals/proposals.json',
        'data/roadmap/roadmap.json',
        'data/simulations/history.json',
      ].join('\n'), stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label, command, args) => steps.push({ label, command, args }),
  });

  const cleanStep = steps.find((step) => step.label === 'git-clean-runtime-untracked');
  assert.ok(cleanStep);
  assert.deepEqual(cleanStep.args, ['clean', '-fd', '--',
    'data/activity/events.json',
    'data/knowledge-graph/nodes.json',
    'data/knowledge-graph/edges.json',
    'data/proposals/proposals.json',
    'data/roadmap/roadmap.json',
    'data/simulations/history.json',
  ]);
});

test('housekeep hard-blocks unknown data files and surfaces exact hardBlockPaths', () => {
  assert.throws(() => runIgnitionHousekeep({
    dryRun: false,
    compact: true,
    captureStepFn: (label) => {
      if (label === 'git-status') return { stdout: '?? data/\n', stderr: '' };
      if (label === 'git-untracked-data') return { stdout: 'data/unknown.bin\ndata/secrets.json\ndata/random.txt\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: () => {},
  }), /housekeep blocked/);
});
test('housekeep classifies known OpenClaw workspace dirt without weakening hard-block', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));
  try {
    assert.throws(() => runIgnitionHousekeep({
      dryRun: false,
      compact: true,
      captureStepFn: (label) => {
        if (label === 'git-status') return { stdout: '?? .openclaw/\n?? HEARTBEAT.md\n?? stephanos-ui/src/App.jsx\n', stderr: '' };
        if (label === 'git-untracked-data') return { stdout: '', stderr: '' };
        throw new Error(`unexpected capture label: ${label}`);
      },
      runStepFn: () => {},
    }), /housekeep blocked/);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.includes('[HOUSEKEEP] root OpenClaw workspace dirt detected'));
  assert.ok(logs.includes('[HOUSEKEEP] root OpenClaw files still block ignition'));
  assert.ok(logs.includes('[HOUSEKEEP] sanctioned allowed path: runtime/openclaw-workspace/'));
  assert.ok(logs.some((line) => line.startsWith('[HOUSEKEEP] copyable migration command: New-Item -ItemType Directory')));
  const statusLine = logs.find((line) => line.startsWith('[HOUSEKEEP] status='));
  assert.ok(statusLine);
  const status = JSON.parse(statusLine.replace('[HOUSEKEEP] status=', ''));
  assert.equal(status.openClawWorkspaceHygieneStatus, 'blocked-openclaw-workspace-dirt');
  assert.equal(status.openClawWorkspaceDirtDetected, 'yes');
  assert.deepEqual(status.openClawWorkspaceDirtPaths, ['.openclaw', 'HEARTBEAT.md']);
  assert.equal(status.openClawWorkspaceBlocksIgnition, 'yes');
  assert.match(status.openClawWorkspaceRecommendedCleanup, /Move-Item -Force/);
  assert.match(status.openClawWorkspaceRecommendedCleanup, /runtime\\openclaw-workspace/);
  assert.equal(status.ignitionStatus, 'BLOCKED');
});



test('housekeep allows OpenClaw files under sanctioned runtime workspace', () => {
  const steps = [];
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));
  try {
    runIgnitionHousekeep({
      dryRun: false,
      compact: true,
      captureStepFn: (label) => {
        if (label === 'git-status') return { stdout: [
          '?? runtime/openclaw-workspace/.openclaw/config.json',
          '?? runtime/openclaw-workspace/DREAMS.md',
          '?? runtime/openclaw-workspace/HEARTBEAT.md',
          '?? runtime/openclaw-workspace/IDENTITY.md',
          '?? runtime/openclaw-workspace/SOUL.md',
          '?? runtime/openclaw-workspace/TOOLS.md',
          '?? runtime/openclaw-workspace/USER.md',
          '?? runtime/openclaw-workspace/memory/index.json',
        ].join('\n'), stderr: '' };
        if (label === 'git-untracked-data') return { stdout: '', stderr: '' };
        throw new Error(`unexpected capture label: ${label}`);
      },
      runStepFn: (label, command, args) => steps.push({ label, command, args }),
    });
  } finally {
    console.log = originalLog;
  }
  const statusLine = logs.find((line) => line.startsWith('[HOUSEKEEP] status='));
  assert.ok(statusLine);
  const status = JSON.parse(statusLine.replace('[HOUSEKEEP] status=', ''));
  assert.equal(status.ignitionStatus, 'READY');
  assert.equal(status.ignitionHardBlockCount, 0);
  assert.equal(status.openClawWorkspaceDirtDetected, 'no');
  assert.equal(status.openClawWorkspaceSafeRuntimeDirectory, 'runtime/openclaw-workspace/');
  assert.deepEqual(steps.map((step) => step.label), ['git-clean-dist-untracked']);
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
      label: 'git-clean-preview-dist-untracked',
      command: 'git',
      args: ['clean', '-nd', '--', 'apps/stephanos/dist/'],
    },
    {
      label: 'git-clean-dist-untracked',
      command: 'git',
      args: ['clean', '-fd', '--', 'apps/stephanos/dist/'],
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
  assert.equal(calls.some((call) => call.label === 'verify'), false);
  assert.ok(calls.some((call) => call.label === 'git-add-dist-only' && call.commandArgs.join(' ') === 'add --all -- apps/stephanos/dist'));
  assert.ok(calls.some((call) => call.label === 'git-push' && call.commandArgs.join(' ') === 'push origin main'));
  assert.ok(calls.every((call) => !(call.command === 'git' && call.commandArgs.join(' ') === 'add .')));
});

test('auto-publish can require fresh verify when verify result is stale', () => {
  const calls = [];
  autoPublishDistWithDeps({
    statusAssessment: evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n'),
    captureStep: (label) => {
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-diff-staged-names') return { stdout: 'apps/stephanos/dist/index.html\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label) => calls.push(label),
    reuseVerifyResult: false,
  });
  assert.equal(calls[0], 'verify');
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



test('auto-publish reuses existing verify result when current', () => {
  const calls = [];
  autoPublishDistWithDeps({
    statusAssessment: evaluateGitStatusForIgnition(' M apps/stephanos/dist/index.html\n'),
    captureStep: (label) => {
      if (label === 'git-branch') return { stdout: 'main\n', stderr: '' };
      if (label === 'git-upstream') return { stdout: 'origin/main\n', stderr: '' };
      if (label === 'git-diff-staged-names') return { stdout: 'apps/stephanos/dist/index.html\n', stderr: '' };
      throw new Error(`unexpected capture label: ${label}`);
    },
    runStepFn: (label) => calls.push(label),
    reuseVerifyResult: true,
  });

  assert.equal(calls.includes('verify'), false);
  assert.ok(calls.includes('git-add-dist-only'));
});

test('auto-publish blocks runtime/root/source dirt categories', () => {
  const status = evaluateGitStatusForIgnition([
    ' M stephanos-server/data/memory/durable-memory.json',
    '?? data/session.json',
    ' M scripts/ignite-stephanos-local.mjs',
  ].join('\n'));

  assert.equal(status.runtimeStateEntries.length > 0, true);
  assert.equal(status.transientRootDataEntries.length > 0, true);
  assert.equal(status.meaningfulEntries.length > 0, true);
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
