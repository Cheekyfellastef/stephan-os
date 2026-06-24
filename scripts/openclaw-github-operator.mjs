import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildOpenClawGitHubOperation } from '../shared/agents/openClawGitHubOperator.mjs';
import { evaluateGitExecutorPreflight } from '../shared/agents/openClawGitHubExecutorPreflight.mjs';
import {
  completeOpenClawGitHubAuthorizationReservation,
  reserveOpenClawGitHubAuthorization,
  verifyOpenClawGitHubAuthorization,
} from '../shared/agents/openClawGitHubAuthorization.mjs';

let activeReservation = null;

function fail(message, details = {}) {
  if (activeReservation) {
    completeOpenClawGitHubAuthorizationReservation(activeReservation, 'FAILED');
    activeReservation = null;
  }
  process.stdout.write(`${JSON.stringify({ finalVerdict: 'BLOCKED', message, ...details }, null, 2)}\n`);
  process.exit(1);
}

const requestPath = process.argv[2];
if (!requestPath) fail('Usage: node scripts/openclaw-github-operator.mjs <request.json>');

let request;
try {
  request = JSON.parse(readFileSync(requestPath, 'utf8'));
} catch (error) {
  fail('GitHub operation request could not be read.', { error: error.message });
}

const publicKeyPath = process.env.STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH;
if (!publicKeyPath) fail('STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH is required.');

let publicKeyPem;
try {
  publicKeyPem = readFileSync(publicKeyPath, 'utf8');
} catch (error) {
  fail('Stephanos GitHub authorization public key could not be read.', { error: error.message });
}

const verification = verifyOpenClawGitHubAuthorization(request.authorization, publicKeyPem);
if (verification.finalVerdict !== 'STEPHANOS_AUTHORIZATION_VERIFIED') {
  fail('Stephanos GitHub authorization verification failed.', { verification });
}

let input = {
  ...verification.claims,
  approvalToken: request.approvalToken,
};

const configuredReceiptRoot = process.env.STEPHANOS_GITHUB_AUTH_RECEIPT_DIR;
if (!configuredReceiptRoot) fail('STEPHANOS_GITHUB_AUTH_RECEIPT_DIR is required.');
const receiptRoot = resolve(configuredReceiptRoot);
const reservation = reserveOpenClawGitHubAuthorization(receiptRoot, verification);
if (reservation.finalVerdict !== 'AUTHORIZATION_RESERVED') {
  fail('Stephanos GitHub authorization could not be reserved.', { reservation });
}
activeReservation = reservation;

function run(executable, args, cwd = input.repositoryRoot) {
  return spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

let actualBranch = '';
let stagedFiles = [];
let actualChangedFiles = [];
const normalizedOperation = String(input.operation || '').toLowerCase();
if (['commit', 'push', 'open-pr'].includes(normalizedOperation)) {
  const branchCheck = run('git.exe', ['-C', input.repositoryRoot, 'branch', '--show-current']);
  actualBranch = String(branchCheck.stdout || '').trim();
  if (branchCheck.error || branchCheck.status !== 0) {
    fail('Git branch preflight could not be read.', {
      exitCode: branchCheck.status,
      error: branchCheck.error?.message || branchCheck.stderr || '',
    });
  }
}

if (normalizedOperation === 'commit') {
  const stagedCheck = run('git.exe', ['-C', input.repositoryRoot, 'diff', '--cached', '--name-only']);
  stagedFiles = String(stagedCheck.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (stagedCheck.error || stagedCheck.status !== 0) {
    fail('Git index preflight could not be read.', {
      exitCode: stagedCheck.status,
      error: stagedCheck.error?.message || stagedCheck.stderr || '',
    });
  }
  const trackedCheck = run('git.exe', ['-C', input.repositoryRoot, 'diff', '--name-only', 'HEAD']);
  const untrackedCheck = run('git.exe', ['-C', input.repositoryRoot, 'ls-files', '--others', '--exclude-standard']);
  if (trackedCheck.error || trackedCheck.status !== 0 || untrackedCheck.error || untrackedCheck.status !== 0) {
    fail('Git working tree preflight could not be read.', {
      trackedExitCode: trackedCheck.status,
      untrackedExitCode: untrackedCheck.status,
      trackedError: trackedCheck.error?.message || trackedCheck.stderr || '',
      untrackedError: untrackedCheck.error?.message || untrackedCheck.stderr || '',
    });
  }
  actualChangedFiles = [
    ...String(trackedCheck.stdout || '').split(/\r?\n/),
    ...String(untrackedCheck.stdout || '').split(/\r?\n/),
  ].map((item) => item.trim()).filter(Boolean);
}

if (['push', 'open-pr'].includes(normalizedOperation)) {
  const fetchBase = run('git.exe', ['-C', input.repositoryRoot, 'fetch', 'origin', input.baseBranch]);
  if (fetchBase.error || fetchBase.status !== 0) {
    fail('Git base branch could not be refreshed.', {
      exitCode: fetchBase.status,
      error: fetchBase.error?.message || fetchBase.stderr || '',
    });
  }
  const branchDiff = run('git.exe', [
    '-C', input.repositoryRoot, 'diff', '--name-only', `origin/${input.baseBranch}...HEAD`,
  ]);
  if (branchDiff.error || branchDiff.status !== 0) {
    fail('Git branch diff preflight could not be read.', {
      exitCode: branchDiff.status,
      error: branchDiff.error?.message || branchDiff.stderr || '',
    });
  }
  actualChangedFiles = String(branchDiff.stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

const gitPreflight = evaluateGitExecutorPreflight({
  operation: input.operation,
  expectedBranch: input.branch,
  actualBranch,
  stagedFiles,
  expectedChangedFiles: input.changedFiles,
  actualChangedFiles,
});
if (gitPreflight.finalVerdict !== 'PREFLIGHT_PASS') {
  fail('Git executor preflight blocked execution.', { gitPreflight });
}
input = { ...input, actualChangedFiles };

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

completeOpenClawGitHubAuthorizationReservation(reservation, 'CONSUMED');
activeReservation = null;

process.stdout.write(`${JSON.stringify({
  finalVerdict: 'OPENCLAW_GITHUB_OPERATION_PASS',
  packet,
  receipts,
}, null, 2)}\n`);
