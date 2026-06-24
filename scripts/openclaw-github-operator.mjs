import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildOpenClawGitHubOperation } from '../shared/agents/openClawGitHubOperator.mjs';

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({ finalVerdict: 'BLOCKED', message, ...details }, null, 2)}\n`);
  process.exit(1);
}

const requestPath = process.argv[2];
if (!requestPath) fail('Usage: node scripts/openclaw-github-operator.mjs <request.json>');

let input;
try {
  input = JSON.parse(readFileSync(requestPath, 'utf8'));
} catch (error) {
  fail('GitHub operation request could not be read.', { error: error.message });
}

function run(executable, args, cwd = input.repositoryRoot) {
  return spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

if (String(input.operation || '').toLowerCase() === 'merge-pr') {
  const view = run('gh.exe', [
    'pr', 'view', String(input.prNumber), '--repo', String(input.repository),
    '--json', 'headRefOid,baseRefName,mergeable,state',
  ]);
  const checks = run('gh.exe', [
    'pr', 'checks', String(input.prNumber), '--repo', String(input.repository),
    '--json', 'state',
  ]);
  if (view.error || view.status !== 0 || checks.error || checks.status !== 0) {
    fail('GitHub merge preflight could not be verified.', {
      viewExitCode: view.status,
      checksExitCode: checks.status,
      viewError: view.error?.message || view.stderr || '',
      checksError: checks.error?.message || checks.stderr || '',
    });
  }
  const viewPayload = JSON.parse(view.stdout);
  const checkPayload = JSON.parse(checks.stdout);
  input = {
    ...input,
    actualHeadSha: viewPayload.headRefOid,
    baseBranch: viewPayload.baseRefName,
    mergeable: viewPayload.mergeable === 'MERGEABLE' && viewPayload.state === 'OPEN',
    checks: checkPayload.map((check) => String(check.state || '').toLowerCase()),
  };
}

const packet = buildOpenClawGitHubOperation(input);
if (packet.finalVerdict !== 'READY_TO_EXECUTE') {
  fail('GitHub operation contract blocked execution.', { packet });
}

const receipts = [];
for (const command of packet.command) {
  const result = run(command.executable, command.args, packet.repositoryRoot);
  receipts.push({
    executable: command.executable,
    args: command.args,
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  });
  if (result.error || result.status !== 0) {
    fail('Approved GitHub command failed.', {
      packet,
      receipts,
      error: result.error?.message || '',
    });
  }
}

process.stdout.write(`${JSON.stringify({
  finalVerdict: 'OPENCLAW_GITHUB_OPERATION_PASS',
  packet,
  receipts,
}, null, 2)}\n`);
