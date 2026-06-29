import { basename } from 'node:path';

const FORBIDDEN_SEGMENTS = new Set(['runtime', 'tmp', 'memory', 'node_modules']);
const SECRET_EXTENSION_PATTERN = /\.(pem|pfx|key|crt|cer|p12|secret)$/i;
const SECRET_NAME_PATTERN = /(^|\/|[-_.])(secret|secrets|token|tokens|credential|credentials|password|passwd|private[-_.]?key)(\/|[-_.]|$)/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const BRANCH_PATTERN = /^[a-z0-9][a-z0-9._/-]{2,127}$/;

export function normalizeRepoPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function isEnvFile(path) {
  const name = basename(path).toLowerCase();
  return name === '.env' || name.startsWith('.env.');
}

export function validatePublishSourceScope({ files = [], allowDist = false } = {}) {
  const normalizedFiles = uniqueSorted(files.map(normalizeRepoPath).filter(Boolean));
  const blockers = [];

  if (!normalizedFiles.length) blockers.push('Publish lane requires at least one source file.');

  for (const path of normalizedFiles) {
    const segments = path.split('/').filter(Boolean);
    if (!path || path.startsWith('/') || /^[a-z]:\//i.test(path) || segments.includes('..')) {
      blockers.push(`Path escapes repository scope: ${path || '<empty>'}`);
      continue;
    }
    const forbiddenSegment = segments.find((segment) => FORBIDDEN_SEGMENTS.has(segment.toLowerCase()));
    if (forbiddenSegment) blockers.push(`Forbidden source scope segment "${forbiddenSegment}" in ${path}.`);
    if (!allowDist && segments.some((segment) => segment.toLowerCase() === 'dist')) {
      blockers.push(`Generated dist output is blocked unless explicitly allowed: ${path}.`);
    }
    if (isEnvFile(path)) blockers.push(`Environment files are blocked: ${path}.`);
    if (SECRET_EXTENSION_PATTERN.test(path) || SECRET_NAME_PATTERN.test(path)) {
      blockers.push(`Secrets or credential-like files are blocked: ${path}.`);
    }
  }

  return {
    files: normalizedFiles,
    blockers,
    finalVerdict: blockers.length ? 'SOURCE_SCOPE_BLOCKED' : 'SOURCE_SCOPE_PASS',
  };
}

export function publishApprovalToken(branch) {
  return `APPROVE_REPOSITORY_NATIVE_PUBLISH_MERGE:${branch}`;
}

export function mergeApprovalToken(prNumber, headSha) {
  return `APPROVE_REPOSITORY_NATIVE_EXACT_HEAD_MERGE:${prNumber}:${headSha}`;
}

export function validatePublishLaneRequest(input = {}) {
  const branch = String(input.branch || '').trim();
  const sourceFiles = Array.isArray(input.sourceFiles) ? input.sourceFiles.map((file) => normalizeRepoPath(file.path)) : [];
  const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles.map(normalizeRepoPath) : [];
  const files = uniqueSorted([...sourceFiles, ...changedFiles]);
  const scope = validatePublishSourceScope({ files, allowDist: input.allowDist === true });
  const blockers = [...scope.blockers];

  if (!BRANCH_PATTERN.test(branch) || branch === 'main' || branch === String(input.baseBranch || 'main')) {
    blockers.push('Publish lane requires a non-main branch name.');
  }
  if (String(input.approvalToken || '') !== publishApprovalToken(branch)) {
    blockers.push('Publish lane requires exact operator approval token.');
  }
  if (!String(input.goal || '').trim()) blockers.push('PR goal is required.');
  if (!input.proofCommand || (Array.isArray(input.proofCommand) && !input.proofCommand.length)) {
    blockers.push('Focused proof command is required.');
  }

  return {
    schemaVersion: 'repository-native-publish-merge-lane.v1',
    branch,
    files: scope.files,
    approvalTokenRequired: publishApprovalToken(branch),
    blockers,
    finalVerdict: blockers.length ? 'PUBLISH_LANE_BLOCKED' : 'PUBLISH_LANE_READY',
  };
}

export function buildPullRequestBody({ goal, proofCommand, proofResult, filesChanged, headSha }) {
  return [
    '## Goal',
    String(goal || '').trim(),
    '',
    '## Proof',
    `- Command: \`${Array.isArray(proofCommand) ? proofCommand.join(' ') : proofCommand}\``,
    `- Result: ${proofResult}`,
    '',
    '## Files Changed',
    ...uniqueSorted(filesChanged || []).map((file) => `- \`${file}\``),
    '',
    '## Exact Head SHA',
    `\`${headSha}\``,
  ].join('\n');
}

export function buildCompletionPacket({ branch, prNumber, headSha, mergeCommit, proofCommand, proofResult, finalStatus }) {
  const status = String(finalStatus || '').trim();
  return {
    schemaVersion: 'repository-native-publish-merge-lane.completion.v1',
    branch: String(branch || ''),
    prNumber: Number.isInteger(prNumber) ? prNumber : Number.parseInt(prNumber, 10),
    headSha: SHA_PATTERN.test(String(headSha || '')) ? headSha : String(headSha || ''),
    mergeCommit: String(mergeCommit || ''),
    proofCommand: Array.isArray(proofCommand) ? proofCommand.join(' ') : String(proofCommand || ''),
    proofResult: String(proofResult || ''),
    finalStatus: status || 'UNKNOWN',
  };
}
