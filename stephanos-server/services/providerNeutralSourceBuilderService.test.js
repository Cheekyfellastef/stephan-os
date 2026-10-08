import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { processNextProviderNeutralSourceBuild } from './providerNeutralSourceBuilderService.js';

function run(executable, args, options = {}) {
  const normalized = executable === 'git.exe'
    ? 'git'
    : executable === 'node.exe'
      ? process.execPath
      : executable;
  return spawnSync(normalized, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

async function fixture(requiredTests = ['node --test focused.test.mjs']) {
  const parent = await mkdtemp(join(tmpdir(), 'forge-offline-builder-'));
  const repoRoot = join(parent, 'repo');
  const sharedWorkspaceRoot = join(parent, 'workspace');
  await mkdir(join(repoRoot, 'shared', 'agents'), { recursive: true });
  await mkdir(sharedWorkspaceRoot, { recursive: true });
  await writeFile(join(repoRoot, 'shared', 'agents', 'example.mjs'), 'export const value = 1;\n');
  await writeFile(join(repoRoot, 'focused.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './shared/agents/example.mjs';",
    "test('value is updated', () => assert.equal(value, 2));",
    '',
  ].join('\n'));
  for (const args of [
    ['init'],
    ['config', 'user.email', 'offline-builder@example.invalid'],
    ['config', 'user.name', 'Offline Builder Test'],
    ['add', '.'],
    ['commit', '-m', 'baseline'],
  ]) {
    const result = run('git.exe', ['-C', repoRoot, ...args], { cwd: repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }
  const head = run('git.exe', ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const action = {
    actionKind: 'agent-handoff',
    adapter: 'foundry-forge',
    missionId: 'critical-3001-offline-forge',
    actionId: 'critical-3001-offline-forge-source-1',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: repoRoot,
    worktreePath: repoRoot,
    branch: 'openclaw/elastic-goal-3001',
    operatorIntent: 'Make the bounded local source change.',
    intendedOutcome: 'The focused test passes.',
    allowedFiles: ['shared/agents/**'],
    requiredTests,
    requiredEvidence: ['focused test output'],
  };
  const actionGrant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    issueNumber: 3001,
    prNumber: null,
    sourceRevision: head,
    headSha: null,
  };
  const claim = {
    adapter: 'foundry-forge',
    processingPath: join(parent, 'claim.json'),
    item: { payload: action, actionGrant },
  };
  return { parent, repoRoot, sharedWorkspaceRoot, action, actionGrant, claim };
}

const PATCH = [
  'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
  '--- a/shared/agents/example.mjs',
  '+++ b/shared/agents/example.mjs',
  '@@ -1 +1 @@',
  '-export const value = 1;',
  '+export const value = 2;',
  '',
].join('\n');

test('local Forge builder edits, tests, escrows and queues source while offline publication remains zero-authority', async () => {
  const fx = await fixture();
  const collected = [];
  let generatePatchArgs;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, context) => {
      generatePatchArgs = context;
      return { patch: PATCH, summary: 'Update the bounded value.' };
    },
    collectAgentWorkerResult: async (record) => { collected.push(record); return { state: { revision: 1 } }; },
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, true, result.error);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(result.testsPassed, true);
  assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
  assert.match(result.offlinePublicationOutboxId, /^offline-publication-/);
  assert.equal(result.preservationVerdict, 'PROVIDER_NEUTRAL_SOURCE_ESCROWED_FOR_OFFLINE_PUBLICATION');
  assert.equal(collected.length, 1);
  assert.equal(collected[0].success, true);
  assert.equal(collected[0].sourceArtifactEscrow?.schemaVersion, 'stephanos.source-artifact-escrow.v1');
  assert.equal(collected[0].offlinePublicationOutbox?.schemaVersion, 'stephanos.offline-publication-outbox.v1');
  assert.equal(collected[0].offlinePublicationOutbox?.completeArtifactSha256,
    collected[0].sourceArtifactEscrow?.completeArtifactSha256);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
  // Verify sourceSnapshots are passed to generatePatch
  assert.ok(generatePatchArgs.sourceSnapshots);
  assert.equal(generatePatchArgs.sourceSnapshots.length, 1);
  assert.equal(generatePatchArgs.sourceSnapshots[0].path, 'shared/agents/example.mjs');
  assert.equal(generatePatchArgs.sourceSnapshots[0].content, 'export const value = 1;\n');
  const outboxPath = join(
    fx.sharedWorkspaceRoot,
    'publication-outbox',
    'pending',
    result.offlinePublicationOutboxId + '.json',
  );
  const outbox = JSON.parse(await readFile(outboxPath, 'utf8'));
  assert.equal(outbox.pushAuthority, false);
  assert.equal(outbox.mergeAuthority, false);
  assert.equal(outbox.deploymentAuthority, false);
  assert.equal(outbox.rebuildRequired, false);
});

test('local Forge builder runs stephanos verify through an ephemeral build and restores generated dist without granting generic npm execution', async () => {
  const fx = await fixture(['npm run stephanos:verify']);
  await mkdir(join(fx.repoRoot, 'scripts'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'apps', 'stephanos', 'dist'), { recursive: true });
  await writeFile(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'index.html'), 'tracked-old\n');
  await writeFile(join(fx.repoRoot, 'scripts', 'build-stephanos-ui.mjs'), [
    "import { mkdir, writeFile } from 'node:fs/promises';",
    "await mkdir('apps/stephanos/dist/assets', { recursive: true });",
    "await writeFile('apps/stephanos/dist/index.html', 'built-current\\n');",
    "await writeFile('apps/stephanos/dist/assets/generated.js', 'export const built = true;\\n');",
    "console.log('ephemeral-build-ok');",
    '',
  ].join('\n'));
  await writeFile(join(fx.repoRoot, 'scripts', 'verify-stephanos-dist.mjs'), [
    "import { readFile } from 'node:fs/promises';",
    "const built = await readFile('apps/stephanos/dist/index.html', 'utf8');",
    "if (built !== 'built-current\\n') process.exit(2);",
    "console.log('ephemeral-verify-ok');",
    '',
  ].join('\n'));
  const add = run('git.exe', ['-C', fx.repoRoot, 'add', 'scripts/build-stephanos-ui.mjs', 'scripts/verify-stephanos-dist.mjs', 'apps/stephanos/dist/index.html'], { cwd: fx.repoRoot });
  assert.equal(add.status, 0, add.stderr);
  const commit = run('git.exe', ['-C', fx.repoRoot, 'commit', '-m', 'add ephemeral verify fixture'], { cwd: fx.repoRoot });
  assert.equal(commit.status, 0, commit.stderr);
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  const accepted = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Run the fixed verify contract.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(accepted.success, true, accepted.error);
  assert.equal((await readFile(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'index.html'), 'utf8')).replace(/\r\n/g, '\n'), 'tracked-old\n');
  assert.equal(existsSync(join(fx.repoRoot, 'apps', 'stephanos', 'dist', 'assets', 'generated.js')), false);
  const distStatus = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain=v1', '--untracked-files=all', '--', 'apps/stephanos/dist'], { cwd: fx.repoRoot });
  assert.equal(distStatus.stdout.trim(), '');

  const unsafeFx = await fixture(['npm run arbitrary-script']);
  const rejected = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: unsafeFx.sharedWorkspaceRoot,
    repoRoot: unsafeFx.repoRoot,
    actionGrant: unsafeFx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? unsafeFx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Generic npm must remain blocked.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE:npm run arbitrary-script/);
});

test('local Forge builder rejects shell-shaped tests and rolls its patch back cleanly', async () => {
  const fx = await fixture(['node --test focused.test.mjs & echo unsafe']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Unsafe test fixture.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_COMMAND_UNSAFE/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects path-escape attempts and does not invoke generatePatch', async () => {
  const fx = await fixture();
  await writeFile(join(fx.parent, 'outside.mjs'), 'export const outside = true;\n');
  fx.action.allowedFiles = ['../outside.mjs'];
  let generatePatchCalled = false;
  const escapeRun = (executable, args, options = {}) => {
    if (
      executable === 'git.exe'
      && args[2] === 'ls-files'
      && args.includes('--')
      && args.at(-1) === '../outside.mjs'
    ) {
      return { status: 0, stdout: '../outside.mjs\n', stderr: '', error: null };
    }
    return run(executable, args, options);
  };
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: escapeRun,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => {
      generatePatchCalled = true;
      return { patch: PATCH, summary: 'Should not be called.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.processed, true);
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SOURCE_CONTEXT_PATH_ESCAPE/);
  assert.equal(generatePatchCalled, false);
});


test('local Forge builder bounds broad directory source context instead of rejecting the route', async () => {
  const fx = await fixture();
  for (let index = 0; index < 4; index += 1) {
    await writeFile(join(fx.repoRoot, 'shared', 'agents', `bulk-${index}.mjs`), 'x'.repeat(200 * 1024));
  }
  for (const args of [['add', '.'], ['commit', '-m', 'broad source context fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => { context = value; return { patch: PATCH, summary: 'Update the bounded value.' }; },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.ok(context.sourceSnapshots.length < 5);
  assert.ok(context.sourceSnapshots.reduce((sum, entry) => sum + Buffer.byteLength(entry.content, 'utf8'), 0) <= 768 * 1024);
});


test('local Forge builder accepts repository-wide scope while excluding protected tracked context', async () => {
  const fx = await fixture();
  fx.action.allowedFiles = ['**'];
  await mkdir(join(fx.repoRoot, 'runtime'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'shared', 'runtime'), { recursive: true });
  await mkdir(join(fx.repoRoot, 'apps', 'music-tile', 'data'), { recursive: true });
  await writeFile(join(fx.repoRoot, 'runtime', 'state.json'), '{"unsafe":true}\n');
  await writeFile(join(fx.repoRoot, 'shared', 'runtime', 'runtimeAdjudicator.mjs'), 'export const runtimeSource = true;\n');
  await writeFile(join(fx.repoRoot, 'apps', 'music-tile', 'data', 'trackLibrary.js'), 'export const tracks = [];\n');
  await writeFile(join(fx.repoRoot, 'safe-source.mjs'), 'export const safe = true;\n');
  for (const args of [['add', '.'], ['commit', '-m', 'repository-wide source context fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => {
      context = value;
      return { patch: PATCH, summary: 'Update the bounded value.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'safe-source.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/runtime/runtimeAdjudicator.mjs'));
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'apps/music-tile/data/trackLibrary.js'));
  assert.equal(context.sourceSnapshots.some((entry) => entry.path === 'runtime/state.json'), false);
});

test('local Forge builder rejects a protected patch target even under repository-wide scope', async () => {
  const fx = await fixture();
  fx.action.allowedFiles = ['**'];
  const unsafePatch = [
    'diff --git a/runtime/state.json b/runtime/state.json',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/runtime/state.json',
    '@@ -0,0 +1 @@',
    '+{"unsafe":true}',
    '',
  ].join('\n');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: unsafePatch, summary: 'Attempt protected edit.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION:runtime\/state\.json/);
});

test('local Forge builder permits an empty source snapshot for a scoped new file', async () => {
  const fx = await fixture();
  fx.action.allowedFiles = ['shared/agents/new-file.mjs'];
  const newFilePatch = [
    'diff --git a/shared/agents/new-file.mjs b/shared/agents/new-file.mjs',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/shared/agents/new-file.mjs',
    '@@ -0,0 +1 @@',
    '+export const created = true;',
    '',
  ].join('\n');
  let context;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => { context = value; return { patch: newFilePatch, summary: 'Create the scoped file.' }; },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.deepEqual(context.sourceSnapshots, []);
  assert.equal((await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-file.mjs'), 'utf8')).replace(/\r\n/g, '\n'), 'export const created = true;\n');
});


test('local Forge builder rejects an allowlisted tracked symlink before provider invocation', async () => {
  const fx = await fixture();
  let generatePatchCalled = false;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    sourceContextLstatImpl: async () => ({ isSymbolicLink: () => true }),
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => {
      generatePatchCalled = true;
      return { patch: PATCH, summary: 'Should not be called.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SOURCE_CONTEXT_SYMLINK_REJECTED/);
  assert.equal(result.providerInvoked, false);
  assert.equal(generatePatchCalled, false);
});


test('local Forge builder safely recounts model patch hunk lengths before applying', async () => {
  const fx = await fixture();
  const recountPatch = PATCH.replace('@@ -1 +1 @@', '@@ -1,99 +1,99 @@');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: recountPatch, summary: 'Patch with incorrect hunk counts.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});


test('local Forge builder still rejects a structurally malformed patch after recount', async () => {
  const fx = await fixture();
  const malformedPatch = [
    'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
    '--- a/shared/agents/example.mjs',
    '+++ b/shared/agents/example.mjs',
    '@@ this-is-not-a-valid-hunk @@',
    '-export const value = 1;',
    '+export const value = 2;',
    '',
  ].join('\n');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: malformedPatch, summary: 'Malformed patch.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_PATCH_CHECK_FAILED/);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder rolls back a recounted patch when a later test fails', async () => {
  const fx = await fixture(['node --test missing-focused.test.mjs']);
  const recountPatch = PATCH.replace('@@ -1 +1 @@', '@@ -1,99 +1,99 @@');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: recountPatch, summary: 'Recounted patch followed by a failing test.' }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.doesNotMatch(result.error, /PROVIDER_NEUTRAL_PATCH_ROLLBACK/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.status, 0);
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder applies exact structured edits and escrows the resulting worktree', async () => {
  const fx = await fixture();
  const collected = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/example.mjs',
        old: 'export const value = 1;\n',
        new: 'export const value = 2;\n',
      }],
      summary: 'Update the bounded value through structured edits.',
    }),
    collectAgentWorkerResult: async (record) => { collected.push(record); return { state: { revision: 1 } }; },
  });
  assert.equal(result.success, true, result.error);
  assert.equal(result.testsPassed, true);
  assert.match(result.sourceArtifactRef, /^shared-workspace:\/\/source-artifacts\//);
  assert.equal(collected.length, 1);
  assert.equal(collected[0].success, true);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});

test('local Forge builder creates a bounded new file through structured edits', async () => {
  const fx = await fixture(['node --check shared/agents/new-file.mjs']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, context) => {
      assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
      assert.equal(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/new-file.mjs'), false);
      return {
        edits: [{
          path: 'shared/agents/new-file.mjs',
          old: '',
          new: 'export const created = true;\n',
        }],
        summary: 'Create one bounded source file through structured edits.',
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.equal(result.testsPassed, true);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-file.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const created = true;\n',
  );
});

test('local Forge builder removes a structured new file when a later required test fails', async () => {
  const fx = await fixture(['node --test missing-new-file-test.mjs']);
  const newFile = join(fx.repoRoot, 'shared', 'agents', 'rollback-new-file.mjs');
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/rollback-new-file.mjs',
        old: '',
        new: 'export const temporary = true;\n',
      }],
      summary: 'Create a file that must roll back after test failure.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.equal(existsSync(newFile), false);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('elastic Forge model can create an allowed new file with structured edits while source snapshots exist', async () => {
  const fx = await fixture(['node --check shared/agents/model-created.mjs']);
  fx.action.missionId = 'critical-3001-elastic-goal';
  let prompt = '';
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nCreate shared/agents/model-created.mjs.',
    localModelFetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      prompt = body.messages[0].content;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              edits: [{
                path: 'shared/agents/model-created.mjs',
                old: '',
                new: 'export const fromModel = true;\n',
              }],
              summary: 'Create the bounded new source file.',
            }),
          },
        }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.match(prompt, /old as the empty string/i);
  assert.match(prompt, /Do not return a unified diff/i);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'model-created.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const fromModel = true;\n',
  );
});

test('elastic Forge model retries a semantically invalid structured edit before mutation', async () => {
  const fx = await fixture();
  fx.action.missionId = 'critical-3001-elastic-goal';
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate the bounded existing source.',
    localModelFetchImpl: async (_url, request) => {
      calls += 1;
      const body = JSON.parse(request.body);
      if (calls === 2) {
        assert.match(body.messages[0].content, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_CONTENT_INVALID/);
      }
      const edits = calls === 1
        ? [{
            path: 'shared/agents/example.mjs',
            old: '',
            new: 'export const value = 2;\n',
          }]
        : [{
            path: 'shared/agents/example.mjs',
            old: 'export const value = 1;\n',
            new: 'export const value = 2;\n',
          }];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            content: JSON.stringify({
              edits,
              summary: 'Update the bounded existing source.',
            }),
          },
        }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.equal(calls, 2);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});

test('elastic Forge model rejects unified-diff fallback when source snapshots are available', async () => {
  const fx = await fixture();
  fx.action.missionId = 'critical-3001-elastic-goal';
  let calls = 0;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate bounded source.',
    localModelFetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { content: JSON.stringify({ patch: PATCH, summary: 'fragile patch fallback' }) } }),
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, false);
  assert.equal(calls, 2);
  assert.match(result.error, /PROVIDER_NEUTRAL_MODEL_STRUCTURED_EDITS_MISSING/);
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects structured edits outside the allowlist without touching source', async () => {
  const fx = await fixture();
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{ path: 'README.md', old: 'before', new: 'after' }],
      summary: 'Attempt an out-of-scope edit.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_SCOPE_VIOLATION/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rejects a non-unique structured edit anchor before mutation', async () => {
  const fx = await fixture();
  await writeFile(join(fx.repoRoot, 'shared', 'agents', 'duplicate.txt'), 'same\nsame\n');
  for (const args of [['add', '.'], ['commit', '-m', 'duplicate anchor fixture']]) {
    const command = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(command.status, 0, command.stderr);
  }
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{ path: 'shared/agents/duplicate.txt', old: 'same', new: 'changed' }],
      summary: 'Ambiguous anchor fixture.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_ANCHOR_MISMATCH/);
  assert.equal(await readFile(join(fx.repoRoot, 'shared', 'agents', 'duplicate.txt'), 'utf8'), 'same\nsame\n');
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});

test('local Forge builder rolls structured edits back cleanly when a required test fails', async () => {
  const fx = await fixture(['node --test missing-structured-edit.test.mjs']);
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({
      edits: [{
        path: 'shared/agents/example.mjs',
        old: 'export const value = 1;\n',
        new: 'export const value = 2;\n',
      }],
      summary: 'Structured edit followed by a failing test.',
    }),
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_TEST_FAILED/);
  assert.doesNotMatch(result.error, /PROVIDER_NEUTRAL_STRUCTURED_EDIT_ROLLBACK/);
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 1;\n',
  );
  const status = run('git.exe', ['-C', fx.repoRoot, 'status', '--porcelain'], { cwd: fx.repoRoot });
  assert.equal(status.stdout.trim(), '');
});


test('local Forge builder retains patch mode for mixed tracked-source plus new-file missions', async () => {
  const fx = await fixture();
  let context;
  const mixedPatch = [
    'diff --git a/shared/agents/example.mjs b/shared/agents/example.mjs',
    '--- a/shared/agents/example.mjs',
    '+++ b/shared/agents/example.mjs',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;',
    'diff --git a/shared/agents/new-regression.mjs b/shared/agents/new-regression.mjs',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/shared/agents/new-regression.mjs',
    '@@ -0,0 +1 @@',
    '+export const regression = true;',
    '',
  ].join('\n');

  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (_action, value) => {
      context = value;
      return { patch: mixedPatch, summary: 'Update tracked source and create a bounded regression file.' };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.ok(context.sourceSnapshots.some((entry) => entry.path === 'shared/agents/example.mjs'));
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'new-regression.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const regression = true;\n',
  );
});


test('elastic Forge builder hydrates authoritative goal context and retries malformed local-model output once', async () => {
  const fx = await fixture();
  fx.action.missionId = 'critical-3001-elastic-goal';
  let modelCalls = 0;
  const prompts = [];
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '# Goal 3001\nUpdate shared/agents/example.mjs so the value becomes 2.',
    localModelFetchImpl: async (_url, request) => {
      modelCalls += 1;
      const body = JSON.parse(request.body);
      prompts.push(body.messages[0].content);
      const content = modelCalls === 1
        ? JSON.stringify({
            edits: [{
              path: 'shared/agents/example.mjs',
              new: 'export const value = 2;\n',
              explanation: 'malformed response must be retried',
            }],
            summary: 'structurally invalid first response',
          })
        : JSON.stringify({
            edits: [{
              path: 'shared/agents/example.mjs',
              old: 'export const value = 1;\n',
              new: 'export const value = 2;\n',
            }],
            summary: 'Apply the bounded goal change.',
          });
      return { ok: true, status: 200, json: async () => ({ message: { content } }) };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, true, result.error);
  assert.equal(modelCalls, 2);
  assert.match(prompts[0], /Authoritative GitHub goal context:/);
  assert.match(prompts[0], /Update shared\/agents\/example\.mjs/);
  assert.match(prompts[1], /previous response did not satisfy/i);
});

test('elastic Forge builder fails closed before model invocation when authoritative goal context is unavailable', async () => {
  const fx = await fixture();
  fx.action.missionId = 'critical-3001-elastic-goal';
  let modelCalled = false;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    loadGoalContext: async () => '',
    localModelFetchImpl: async () => {
      modelCalled = true;
      throw new Error('model must not run');
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /PROVIDER_NEUTRAL_AUTHORITATIVE_GOAL_CONTEXT_UNAVAILABLE/);
  assert.equal(modelCalled, false);
});


test('elastic Forge builder revalidates queued GitHub goal authority before source mutation', async () => {
  const revokedCases = [
    {
      name: 'closed issue',
      payload: { number: 3001, state: 'closed', title: 'Goal 3001', body: 'change source', labels: [{ name: 'goal' }] },
    },
    {
      name: 'goal label removed',
      payload: { number: 3001, state: 'open', title: 'Goal 3001', body: 'change source', labels: [{ name: 'other' }] },
    },
    {
      name: 'pull request identity',
      payload: { number: 3001, state: 'open', title: 'Goal 3001', body: 'change source', labels: [{ name: 'goal' }], pull_request: { url: 'https://example.invalid/pr/3001' } },
    },
    {
      name: 'wrong issue identity',
      payload: { number: 3002, state: 'open', title: 'Goal 3002', body: 'change source', labels: [{ name: 'goal' }] },
    },
  ];

  for (const revoked of revokedCases) {
    const fx = await fixture();
    fx.action.missionId = 'critical-3001-elastic-goal';
    let modelCalled = false;
    const result = await processNextProviderNeutralSourceBuild({
      preferredAdapter: 'foundry-forge',
      sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
      repoRoot: fx.repoRoot,
      actionGrant: fx.actionGrant,
      runCommand: run,
      claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
      githubAuth: { configured: true, authority: 'test', token: 'test-token' },
      githubFetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => revoked.payload,
      }),
      localModelFetchImpl: async () => {
        modelCalled = true;
        throw new Error('model must not run after goal authority is revoked');
      },
      collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
    });
    assert.equal(result.success, false, revoked.name);
    assert.match(result.error, /PROVIDER_NEUTRAL_AUTHORITATIVE_GOAL_CONTEXT_UNAVAILABLE/, revoked.name);
    assert.equal(modelCalled, false, revoked.name);
    assert.equal(
      (await readFile(join(fx.repoRoot, 'shared', 'agents', 'example.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
      'export const value = 1;\n',
      revoked.name,
    );
  }
});


test('local Forge builder resolves lowercased mission scope to one exact tracked Git path without widening authority', async () => {
  const fx = await fixture();
  const move = run('git.exe', ['-C', fx.repoRoot, 'mv', 'shared/agents/example.mjs', 'shared/agents/exampleMemory.mjs'], { cwd: fx.repoRoot });
  assert.equal(move.status, 0, move.stderr);
  await writeFile(join(fx.repoRoot, 'focused.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { value } from './shared/agents/exampleMemory.mjs';",
    "test('value is updated', () => assert.equal(value, 2));",
    '',
  ].join('\n'));
  for (const args of [
    ['add', '.'],
    ['commit', '-m', 'camel-case tracked path fixture'],
  ]) {
    const result = run('git.exe', ['-C', fx.repoRoot, ...args], { cwd: fx.repoRoot });
    assert.equal(result.status, 0, result.stderr);
  }

  fx.action.allowedFiles = [
    'shared/agents/examplememory.mjs',
    'shared/agents/examplememory.mjs/**',
  ];
  fx.actionGrant.sourceRevision = run('git.exe', ['-C', fx.repoRoot, 'rev-parse', 'HEAD'], { cwd: fx.repoRoot }).stdout.trim();

  let generatedAction = null;
  let generatedContext = null;
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async (action, context) => {
      generatedAction = action;
      generatedContext = context;
      return {
        edits: [{
          path: 'shared/agents/exampleMemory.mjs',
          old: 'export const value = 1;\n',
          new: 'export const value = 2;\n',
        }],
        summary: 'Update the exact tracked camel-case source path.',
      };
    },
    collectAgentWorkerResult: async () => ({ state: { revision: 1 } }),
  });

  assert.equal(result.success, true, result.error);
  assert.deepEqual(generatedAction.allowedFiles, [
    'shared/agents/exampleMemory.mjs',
    'shared/agents/exampleMemory.mjs/**',
  ]);
  assert.deepEqual(
    generatedContext.sourceSnapshots.map(({ path: snapshotPath }) => snapshotPath),
    ['shared/agents/exampleMemory.mjs'],
  );
  assert.equal(
    (await readFile(join(fx.repoRoot, 'shared', 'agents', 'exampleMemory.mjs'), 'utf8')).replace(/\r\n/g, '\n'),
    'export const value = 2;\n',
  );
});
