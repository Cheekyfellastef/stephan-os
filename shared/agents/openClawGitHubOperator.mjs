const ALLOWED_OPERATIONS = new Set([
  'inspect',
  'create-worktree',
  'commit',
  'push',
  'open-pr',
  'check-pr',
  'merge-pr',
]);

const MUTATING_OPERATIONS = new Set([
  'create-worktree',
  'commit',
  'push',
  'open-pr',
  'merge-pr',
]);

const FORBIDDEN_PATH_PATTERN = /(^|\/)(apps\/stephanos\/dist|stephanos-server\/data|runtime|runtime-data|root-data|root data|data|tmp|\.git|node_modules)(\/|$)|(^|\/)\.env(\.|$)|\.(pem|pfx|key)$/i;
const LOWERCASE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const BRANCH_PATTERN = /^openclaw\/[a-z0-9][a-z0-9._/-]{2,127}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isForbiddenPath(value) {
  const path = normalizePath(value);
  return !path
    || path.startsWith('/')
    || /^[a-z]:\//i.test(path)
    || path.split('/').includes('..')
    || FORBIDDEN_PATH_PATTERN.test(path)
    || /secret|token/i.test(path);
}

function unique(values) {
  return [...new Set(values)];
}

function scopeAllowsPath(scope, path) {
  const normalizedScope = normalizePath(scope);
  if (normalizedScope === path) return true;
  if (normalizedScope.endsWith('/**')) {
    const base = normalizedScope.slice(0, -3);
    return path === base || path.startsWith(`${base}/`);
  }
  return false;
}

function exactMergeApproval(prNumber, headSha) {
  return `APPROVE_OPENCLAW_SQUASH_MERGE:${prNumber}:${headSha}`;
}

export function buildOpenClawGitHubOperation(input = {}) {
  const operation = text(input.operation).toLowerCase();
  const repository = text(input.repository);
  const repositoryRoot = text(input.repositoryRoot);
  const missionId = text(input.missionId).toLowerCase();
  const defaultBranch = text(input.defaultBranch) || 'main';
  const baseBranch = text(input.baseBranch) || defaultBranch;
  const branch = text(input.branch);
  const worktreePath = text(input.worktreePath);
  const expectedHeadSha = text(input.expectedHeadSha).toLowerCase();
  const actualHeadSha = text(input.actualHeadSha).toLowerCase();
  const prNumber = Number.isInteger(input.prNumber) ? input.prNumber : Number.parseInt(input.prNumber, 10);
  const allowedFiles = unique(list(input.allowedFiles).map(normalizePath));
  const changedFiles = unique(list(input.changedFiles).map(normalizePath));
  const checks = list(input.checks).map((value) => value.toLowerCase());
  const blockers = [];

  if (!ALLOWED_OPERATIONS.has(operation)) blockers.push('Unsupported GitHub operation.');
  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('Repository must use owner/name form.');
  if (!repositoryRoot) blockers.push('Repository root is required.');
  if (!MISSION_ID_PATTERN.test(missionId)) blockers.push('Mission id is missing or invalid.');
  if (baseBranch !== defaultBranch) blockers.push('Pull requests must target the configured default branch.');

  if (MUTATING_OPERATIONS.has(operation)) {
    if (!BRANCH_PATTERN.test(branch)) blockers.push('Mutating operations require an openclaw/* branch.');
    if (branch === defaultBranch || branch === baseBranch) blockers.push('Direct default-branch mutation is forbidden.');
  }

  if (operation === 'create-worktree' && !worktreePath) blockers.push('Isolated worktree path is required.');

  if (operation === 'commit') {
    if (!allowedFiles.length) blockers.push('Commit requires explicit allowed files.');
    if (!changedFiles.length) blockers.push('Commit requires a non-empty changed file set.');
    if (!text(input.commitMessage)) blockers.push('Commit message is required.');
    const unsafeFiles = changedFiles.filter(isForbiddenPath);
    if (unsafeFiles.length) blockers.push(`Changed files include forbidden paths: ${unsafeFiles.join(', ')}`);
    const outsideScope = changedFiles.filter((path) => !allowedFiles.some((scope) => scopeAllowsPath(scope, path)));
    if (outsideScope.length) blockers.push(`Changed files exceed the approved scope: ${outsideScope.join(', ')}`);
  }

  if (operation === 'open-pr' && !text(input.title)) blockers.push('Pull request title is required.');

  if (operation === 'check-pr' || operation === 'merge-pr') {
    if (!Number.isInteger(prNumber) || prNumber < 1) blockers.push('A valid pull request number is required.');
  }

  if (operation === 'merge-pr') {
    if (!LOWERCASE_SHA_PATTERN.test(expectedHeadSha)) blockers.push('Exact lowercase pull request head SHA is required.');
    if (actualHeadSha !== expectedHeadSha) blockers.push('Pull request head SHA changed or could not be verified.');
    if (input.mergeable !== true) blockers.push('Pull request must be mergeable.');
    if (!checks.length || checks.some((check) => check !== 'success')) blockers.push('Every required check must report success.');
    if (text(input.approvalToken) !== exactMergeApproval(prNumber, expectedHeadSha)) {
      blockers.push('Exact operator squash-merge approval token is required.');
    }
  }

  const command = [];
  if (!blockers.length) {
    if (operation === 'inspect') command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'status', '--short', '--branch'] });
    if (operation === 'create-worktree') {
      command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'fetch', 'origin', baseBranch] });
      command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'worktree', 'add', '-b', branch, worktreePath, `origin/${baseBranch}`] });
    }
    if (operation === 'commit') {
      command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'add', '--', ...changedFiles] });
      command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'commit', '-m', text(input.commitMessage)] });
    }
    if (operation === 'push') command.push({ executable: 'git.exe', args: ['-C', repositoryRoot, 'push', '-u', 'origin', branch] });
    if (operation === 'open-pr') {
      command.push({
        executable: 'gh.exe',
        args: ['pr', 'create', '--repo', repository, '--base', baseBranch, '--head', branch, '--title', text(input.title), '--body', text(input.body)],
      });
    }
    if (operation === 'check-pr') command.push({ executable: 'gh.exe', args: ['pr', 'checks', String(prNumber), '--repo', repository] });
    if (operation === 'merge-pr') {
      command.push({
        executable: 'gh.exe',
        args: ['pr', 'merge', String(prNumber), '--repo', repository, '--squash', '--match-head-commit', expectedHeadSha],
      });
    }
  }

  return {
    schemaVersion: 'openclaw-github-operation.v1',
    missionId,
    operation,
    repository,
    repositoryRoot,
    defaultBranch,
    baseBranch,
    branch,
    worktreePath,
    prNumber: Number.isInteger(prNumber) ? prNumber : null,
    expectedHeadSha,
    actualHeadSha,
    allowedFiles,
    changedFiles,
    operatorApprovalRequired: operation === 'merge-pr',
    approvalTokenRequired: operation === 'merge-pr' && Number.isInteger(prNumber) && LOWERCASE_SHA_PATTERN.test(expectedHeadSha)
      ? exactMergeApproval(prNumber, expectedHeadSha)
      : '',
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    branchDeletionAllowed: false,
    repositorySettingsWriteAllowed: false,
    command,
    blockers,
    finalVerdict: blockers.length ? 'BLOCKED' : 'READY_TO_EXECUTE',
  };
}
