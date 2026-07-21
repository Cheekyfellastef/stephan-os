import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildCompletionPacket,
  buildPullRequestBody,
  normalizeRepoPath,
  validatePublishLaneRequest,
} from '../shared/agents/repositoryNativePublishMergeLane.mjs';
import { requiredOperatorApprovalStatement } from '../shared/agents/operatorMergeApprovalGate.mjs';

function emit(packet, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  process.exit(exitCode);
}

function fail(message, details = {}) {
  emit({ finalStatus: 'BLOCKED', message, ...details }, 1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function runRequired(command, args, cwd, message) {
  const result = run(command, args, cwd);
  if (result.exitCode !== 0) fail(message, { result });
  return result;
}

function parseJson(stdout, message) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(message, { error: error.message, stdout });
  }
}

const requestPath = process.argv[2];
if (!requestPath) fail('Usage: npm run stephanos:publish-merge -- <request.json>');

let request;
try {
  request = JSON.parse(readFileSync(requestPath, 'utf8'));
} catch (error) {
  fail('Publish lane request could not be read.', { error: error.message });
}

if (String(request.mergeApprovalToken || '').trim()) {
  fail('Raw or deterministic merge approval tokens are disabled. Publication and merge are separate guarded operations.');
}

const validation = validatePublishLaneRequest(request);
if (validation.finalVerdict !== 'PUBLISH_LANE_READY') {
  fail('Publish lane request failed source scope or approval validation.', { validation });
}

const repositoryRoot = resolve(request.repositoryRoot || process.cwd());
const baseBranch = String(request.baseBranch || 'main');
const branch = validation.branch;
const repository = String(request.repository || '').trim();
const proofCommand = Array.isArray(request.proofCommand) ? request.proofCommand.map(String) : String(request.proofCommand).split(/\s+/).filter(Boolean);
if (!proofCommand.length) fail('Focused proof command is empty after parsing.');

runRequired('git', ['-C', repositoryRoot, 'fetch', 'origin', baseBranch], repositoryRoot, 'Could not refresh base branch.');
runRequired('git', ['-C', repositoryRoot, 'checkout', '-B', branch, `origin/${baseBranch}`], repositoryRoot, 'Could not create or reset publish branch.');

for (const file of request.sourceFiles || []) {
  const repoPath = normalizeRepoPath(file.path);
  if (!validation.files.includes(repoPath)) fail('Source file was not in validated scope.', { repoPath });
  const absolutePath = resolve(repositoryRoot, repoPath);
  if (!absolutePath.startsWith(`${repositoryRoot}/`) && absolutePath !== repositoryRoot) {
    fail('Source file resolved outside repository root.', { repoPath });
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, String(file.content ?? ''), 'utf8');
}

const status = runRequired('git', ['-C', repositoryRoot, 'status', '--porcelain'], repositoryRoot, 'Could not inspect working tree.');
const actualChangedFiles = status.stdout
  .split(/\r?\n/)
  .map((line) => normalizeRepoPath(line.slice(3)))
  .filter(Boolean);
const actualValidation = validatePublishLaneRequest({ ...request, changedFiles: actualChangedFiles, sourceFiles: [] });
if (actualValidation.finalVerdict !== 'PUBLISH_LANE_READY') {
  fail('Actual changed files failed source scope validation.', { actualChangedFiles, actualValidation });
}

const proof = run(proofCommand[0], proofCommand.slice(1), repositoryRoot);
const proofResult = proof.exitCode === 0 ? 'PASS exitCode=0' : `FAIL exitCode=${proof.exitCode}`;
if (proof.exitCode !== 0) fail('Focused proof failed; publication refused.', { proofCommand: proof.command, proofResult, proof });

runRequired('git', ['-C', repositoryRoot, 'add', '--', ...actualChangedFiles], repositoryRoot, 'Could not stage validated source files.');
runRequired('git', ['-C', repositoryRoot, 'commit', '-m', String(request.commitMessage || request.title || request.goal)], repositoryRoot, 'Could not commit publish branch.');
const headSha = runRequired('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], repositoryRoot, 'Could not read exact head SHA.').stdout.trim();
runRequired('git', ['-C', repositoryRoot, 'push', '-u', 'origin', branch], repositoryRoot, 'Could not push publish branch.');

const title = String(request.title || request.goal).trim();
const body = buildPullRequestBody({ goal: request.goal, proofCommand: proof.command, proofResult, filesChanged: actualChangedFiles, headSha });
const prCreateArgs = ['pr', 'create', '--draft', '--base', baseBranch, '--head', branch, '--title', title, '--body', body];
if (repository) prCreateArgs.splice(2, 0, '--repo', repository);
runRequired('gh', prCreateArgs, repositoryRoot, 'Could not create draft pull request.');
const prViewArgs = ['pr', 'view', branch, '--json', 'number,headRefOid,isDraft,state'];
if (repository) prViewArgs.splice(2, 0, '--repo', repository);
const prPayload = parseJson(runRequired('gh', prViewArgs, repositoryRoot, 'Could not inspect pull request.').stdout, 'Pull request payload was not JSON.');
const prNumber = prPayload.number;
if (prPayload.headRefOid !== headSha) fail('Pull request head SHA did not match local exact head.', { prPayload, headSha });
if (!prPayload.isDraft || prPayload.state !== 'OPEN') fail('Publication lane must leave a new pull request open and draft.', { prPayload });

emit({
  ...buildCompletionPacket({
    branch,
    prNumber,
    headSha,
    mergeCommit: '',
    proofCommand: proof.command,
    proofResult,
    finalStatus: 'AWAITING_OPERATOR_APPROVAL',
  }),
  mergeAuthority: false,
  approvalGate: 'challenge-bound-operator-receipt-only',
  requiredOperatorStatement: requiredOperatorApprovalStatement(prNumber, headSha),
  nextAction: 'Obtain a direct operator challenge response, validate it through the approved merge executor, then revalidate the unchanged exact head.',
});
