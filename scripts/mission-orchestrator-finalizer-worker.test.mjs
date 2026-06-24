import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeLocalDeployment, parseLocalDeploymentOutput } from './mission-orchestrator-finalizer-worker.mjs';

const document = {
  schemaVersion: 'stephanos.local-deployment-result.v1',
  success: true,
  completedAt: '2026-06-24T23:55:00.000Z',
  error: '',
  steps: {
    sync: { success: true, commandOutputHash: 'a'.repeat(64) },
    build: { success: true, commandOutputHash: 'b'.repeat(64) },
    verify: { success: true, commandOutputHash: 'c'.repeat(64) },
    restart: { success: true, commandOutputHash: 'd'.repeat(64) },
  },
};

test('parses only the bounded local deployment result schema', () => {
  assert.equal(parseLocalDeploymentOutput(JSON.stringify(document)).success, true);
  assert.throws(() => parseLocalDeploymentOutput('{}'), /schema/);
  assert.throws(() => parseLocalDeploymentOutput('not-json'), /invalid JSON/);
});

test('invokes PowerShell with argument arrays and returns deterministic steps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-finalizer-'));
  const scriptPath = join(root, 'deploy.ps1');
  await writeFile(scriptPath, '# fixture\n', 'utf8');
  let invocation;
  const result = await executeLocalDeployment({ actionKind: 'local-deployment', missionId: 'mission-finalizer-test', repositoryRoot: root, mergeCommitSha: 'e'.repeat(40) }, {}, {
    deploymentScriptPath: scriptPath,
    runCommand(executable, args, options) {
      invocation = { executable, args, options };
      return { status: 0, stdout: JSON.stringify(document), stderr: '' };
    },
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.ok(invocation.args.includes('-ExpectedMergeCommit'));
  assert.equal(invocation.options.cwd, root);
  assert.equal(result.success, true);
  assert.equal(result.steps.restart.commandOutputHash, 'd'.repeat(64));
});

test('fails closed when deployment output is malformed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-finalizer-failure-'));
  const scriptPath = join(root, 'deploy.ps1');
  await writeFile(scriptPath, '# fixture\n', 'utf8');
  const result = await executeLocalDeployment({ actionKind: 'local-deployment', missionId: 'mission-finalizer-failure', repositoryRoot: root, mergeCommitSha: 'f'.repeat(40) }, {}, {
    deploymentScriptPath: scriptPath,
    runCommand: () => ({ status: 1, stdout: '', stderr: 'deployment blocked' }),
  });
  assert.equal(result.success, false);
  assert.match(result.error, /deployment blocked/);
});
