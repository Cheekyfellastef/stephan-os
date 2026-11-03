import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parsePatchEscrowComment,
  reassemblePatchEscrow,
  validatePatchEscrowManifest,
} from '../shared/agents/codexPatchEscrow.mjs';
import { validatePatchEscrowPublishAuthorization } from '../shared/agents/codexPatchEscrowAuthorization.mjs';

const TRUSTED_CODEX_BOT = 'chatgpt-codex-connector[bot]';
const REQUIRED_ISSUE_LABEL = 'codex';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SENSITIVE_ENV_PATTERN = /(token|secret|password|credential|private[_-]?key|authorization)/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: options.env ? { ...options.env } : { ...process.env },
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`${executable} ${args.join(' ')} failed`);
    error.details = {
      executable,
      args,
      exitCode: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      message: result.error?.message || '',
    };
    throw error;
  }
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function sanitizedTestEnvironment(baseEnvironment = process.env, homeDirectory = '') {
  const sanitized = {};
  for (const [key, value] of Object.entries(baseEnvironment || {})) {
    if (!SENSITIVE_ENV_PATTERN.test(key)) sanitized[key] = value;
  }
  const safeHome = homeDirectory || join(tmpdir(), 'stephanos-patch-test-home');
  return Object.freeze({
    ...sanitized,
    HOME: safeHome,
    XDG_CONFIG_HOME: join(safeHome, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NODE_OPTIONS: '',
  });
}

export function clearSensitiveProcessEnvironment(environment = process.env) {
  const removed = [];
  for (const key of Object.keys(environment || {})) {
    if (!SENSITIVE_ENV_PATTERN.test(key)) continue;
    removed.push(key);
    delete environment[key];
  }
  return Object.freeze(removed.sort((left, right) => left.localeCompare(right)));
}

export function validatePatchEscrowPublishEvent(event = {}) {
  const blockers = [];
  const repository = text(event.repository?.full_name);
  const ownerLogin = text(event.repository?.owner?.login);
  const actor = text(event.comment?.user?.login);
  const issueNumber = Number.parseInt(event.issue?.number, 10);
  const commentId = Number.parseInt(event.comment?.id, 10);
  const labels = (event.issue?.labels || []).map((label) => text(typeof label === 'string' ? label : label?.name).toLowerCase());
  const parsed = parsePatchEscrowComment(event.comment?.body);
  const authorization = parsed?.marker === 'PATCH_ESCROW_PUBLISH_V1'
    ? validatePatchEscrowPublishAuthorization(parsed.payload)
    : validatePatchEscrowPublishAuthorization({});

  if (event.action !== 'created') blockers.push('publish-comment-must-be-new');
  if (!repository || !ownerLogin) blockers.push('missing-repository-identity');
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) blockers.push('invalid-issue-number');
  if (!Number.isSafeInteger(commentId) || commentId < 1) blockers.push('invalid-publish-comment-id');
  if (event.issue?.pull_request) blockers.push('pull-request-comments-not-supported');
  if (actor !== ownerLogin) blockers.push('final-publish-request-must-be-authored-by-repository-owner');
  if (!labels.includes(REQUIRED_ISSUE_LABEL)) blockers.push('issue-missing-codex-label');
  if (!parsed || parsed.marker !== 'PATCH_ESCROW_PUBLISH_V1') blockers.push('invalid-publish-request');
  if (!authorization.valid) blockers.push(...authorization.blockers);

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(sortedUnique(blockers)),
    repository,
    ownerLogin,
    actor,
    issueNumber,
    commentId,
    bundleId: authorization.bundleId,
    patchSha256: authorization.patchSha256,
    finalVerdict: blockers.length ? 'PATCH_ESCROW_PUBLISH_EVENT_BLOCKED' : 'PATCH_ESCROW_PUBLISH_EVENT_PASS',
  });
}

export function selectPatchEscrowFromComments(comments = [], bundleId, ownerLogin, authorizedPatchSha256) {
  const trustedAuthors = new Set([ownerLogin, TRUSTED_CODEX_BOT]);
  const parsed = comments
    .map((comment) => ({
      author: text(comment?.user?.login),
      parsed: parsePatchEscrowComment(comment?.body),
      id: comment?.id,
    }))
    .filter((entry) => entry.parsed && trustedAuthors.has(entry.author));

  const manifests = parsed.filter((entry) => entry.parsed.marker === 'PATCH_ESCROW_MANIFEST_V1' && entry.parsed.payload?.bundleId === bundleId);
  const chunks = parsed.filter((entry) => entry.parsed.marker === 'PATCH_ESCROW_CHUNK_V1' && entry.parsed.payload?.bundleId === bundleId);
  if (manifests.length !== 1) return Object.freeze({ ok: false, reason: manifests.length ? 'duplicate-manifests' : 'manifest-not-found' });
  const manifest = manifests[0].parsed.payload;
  const manifestValidation = validatePatchEscrowManifest(manifest);
  if (!manifestValidation.valid) return Object.freeze({ ok: false, reason: manifestValidation.errors[0], manifestValidation });
  if (!authorizedPatchSha256 || manifest.patchSha256 !== text(authorizedPatchSha256).toLowerCase()) {
    return Object.freeze({ ok: false, reason: 'manifest-patch-hash-not-authorised' });
  }
  const assembled = reassemblePatchEscrow(manifest, chunks.map((entry) => entry.parsed.payload));
  if (!assembled.ok) return Object.freeze({ ok: false, reason: assembled.reason });
  return Object.freeze({
    ok: true,
    reason: 'PATCH_ESCROW_COMMENTS_VERIFIED',
    manifest,
    patch: assembled.patch,
    manifestCommentId: manifests[0].id,
    chunkCommentIds: Object.freeze(chunks.map((entry) => entry.id)),
  });
}

function sharedAgentTestFiles(repositoryRoot) {
  const directory = join(repositoryRoot, 'shared', 'agents');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join('shared', 'agents', name))
    .sort((left, right) => left.localeCompare(right));
}

function runNodeTest(repositoryRoot, files, environment) {
  if (!files.length) throw new Error('test profile resolved to no test files');
  run(process.execPath, ['--test', ...files], { cwd: repositoryRoot, env: environment });
}

export function runPatchEscrowTestProfile(profile, repositoryRoot, changedFiles, options = {}) {
  const environment = options.environment || sanitizedTestEnvironment(process.env, options.homeDirectory);
  if (profile === 'shared-agents') {
    runNodeTest(repositoryRoot, sharedAgentTestFiles(repositoryRoot), environment);
    return Object.freeze({ profile, commands: Object.freeze(['node --test shared/agents/*.test.mjs']) });
  }
  if (profile === 'shared-workspace') {
    const focused = [
      'shared/agents/sharedAgentWorkspaceStore.test.mjs',
      'shared/agents/verificationHarnessWorkspace.test.mjs',
      'shared/agents/shared-workspace-dashboard-feed.test.mjs',
      'shared/agents/battle-bridge-publisher.test.mjs',
      'shared/agents/battle-bridge-publisher-loop.test.mjs',
    ].filter((path) => existsSync(join(repositoryRoot, path)));
    runNodeTest(repositoryRoot, focused, environment);
    runNodeTest(repositoryRoot, sharedAgentTestFiles(repositoryRoot), environment);
    return Object.freeze({
      profile,
      commands: Object.freeze([
        `node --test ${focused.join(' ')}`,
        'node --test shared/agents/*.test.mjs',
      ]),
    });
  }
  if (profile === 'node-changed') {
    const modules = changedFiles.filter((path) => path.endsWith('.mjs'));
    for (const modulePath of modules) run(process.execPath, ['--check', modulePath], { cwd: repositoryRoot, env: environment });
    const tests = modules.filter((path) => path.endsWith('.test.mjs'));
    if (tests.length) runNodeTest(repositoryRoot, tests, environment);
    return Object.freeze({
      profile,
      commands: Object.freeze([
        ...modules.map((path) => `node --check ${path}`),
        ...(tests.length ? [`node --test ${tests.join(' ')}`] : []),
      ]),
    });
  }
  throw new Error(`unsupported test profile: ${profile}`);
}

export function validateExistingPublicationEvidence(input = {}) {
  const blockers = [];
  const branchSha = text(input.branchRef?.object?.sha).toLowerCase();
  const commitSha = text(input.branchCommit?.sha).toLowerCase();
  const treeSha = text(input.branchCommit?.tree?.sha).toLowerCase();
  const expectedTreeSha = text(input.expectedTreeSha).toLowerCase();
  const parents = Array.isArray(input.branchCommit?.parents) ? input.branchCommit.parents : [];
  const pull = input.pull || null;
  const manifest = input.manifest || {};

  if (!SHA_PATTERN.test(branchSha)) blockers.push('missing-or-invalid-branch-head');
  if (commitSha !== branchSha) blockers.push('branch-commit-does-not-match-ref');
  if (treeSha !== expectedTreeSha) blockers.push('remote-tree-does-not-match-signed-patch');
  if (parents.length !== 1 || text(parents[0]?.sha).toLowerCase() !== text(manifest.baseSha).toLowerCase()) blockers.push('remote-commit-parent-does-not-match-signed-base');
  if (pull) {
    if (text(pull.head?.sha).toLowerCase() !== branchSha) blockers.push('pull-request-head-does-not-match-branch');
    if (text(pull.head?.ref) !== text(manifest.targetBranch)) blockers.push('pull-request-head-branch-mismatch');
    if (text(pull.base?.ref) !== text(input.defaultBranch)) blockers.push('pull-request-base-branch-mismatch');
    if (!text(pull.body).includes(text(manifest.patchSha256))) blockers.push('pull-request-missing-patch-receipt');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    branchSha,
    expectedTreeSha,
    finalVerdict: blockers.length ? 'PATCH_ESCROW_EXISTING_PUBLICATION_BLOCKED' : 'PATCH_ESCROW_EXISTING_PUBLICATION_PASS',
  });
}

export async function runPatchEscrowValidation() {
  throw new Error('legacy live-comment validation is disabled; use codex-patch-escrow-validate-prepared.mjs');
}

export async function runPatchEscrowPublisher() {
  throw new Error('validated artifact is required; use codex-patch-escrow-publish-validated.mjs');
}

async function main() {
  throw new Error('direct publisher execution is disabled; use prepare, token-free validate, then publish-validated');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1].endsWith(currentFile.split('/').at(-1))) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ finalVerdict: 'PATCH_ESCROW_DIRECT_EXECUTION_BLOCKED', message: text(error.message) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
