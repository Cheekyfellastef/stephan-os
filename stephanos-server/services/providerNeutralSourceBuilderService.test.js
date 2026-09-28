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
  const result = await processNextProviderNeutralSourceBuild({
    preferredAdapter: 'foundry-forge',
    sharedWorkspaceRoot: fx.sharedWorkspaceRoot,
    repoRoot: fx.repoRoot,
    actionGrant: fx.actionGrant,
    runCommand: run,
    claimNext: async (adapter) => adapter === 'foundry-forge' ? fx.claim : null,
    generatePatch: async () => ({ patch: PATCH, summary: 'Update the bounded value.' }),
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
