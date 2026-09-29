import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
