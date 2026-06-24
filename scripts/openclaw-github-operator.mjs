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

const packet = buildOpenClawGitHubOperation(input);
if (packet.finalVerdict !== 'READY_TO_EXECUTE') {
  fail('GitHub operation contract blocked execution.', { packet });
}

const receipts = [];
for (const command of packet.command) {
  const result = spawnSync(command.executable, command.args, {
    cwd: packet.repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
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
