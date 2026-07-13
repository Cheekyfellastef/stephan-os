import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parsePatchEscrowComment,
  reassemblePatchEscrow,
  validatePatchEscrowManifest,
} from '../shared/agents/codexPatchEscrow.mjs';

const TRUSTED_CODEX_BOT = 'chatgpt-codex-connector[bot]';
const REQUIRED_ISSUE_LABEL = 'codex';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SENSITIVE_ENV_PATTERN = /(token|secret|password|credential|private[_-]?key|authorization)/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function lines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
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

function runAllowingNoMatch(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: options.env ? { ...options.env } : { ...process.env },
  });
  if (result.error || ![0, 1].includes(result.status)) {
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
  return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

function safeApiError(error) {
  return {
    message: text(error?.message, 'unknown error').slice(0, 500),
    details: error?.details ? {
      executable: error.details.executable,
      args: error.details.args,
      exitCode: error.details.exitCode,
      stdout: text(error.details.stdout).slice(0, 2000),
      stderr: text(error.details.stderr).slice(0, 2000),
      message: text(error.details.message).slice(0, 500),
      blockers: error.details.blockers,
    } : undefined,
  };
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
  const labels = (event.issue?.labels || []).map((label) => text(typeof label === 'string' ? label : label?.name).toLowerCase());
  const parsed = parsePatchEscrowComment(event.comment?.body);

  if (event.action !== 'created') blockers.push('publish-comment-must-be-new');
  if (!repository || !ownerLogin) blockers.push('missing-repository-identity');
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) blockers.push('invalid-issue-number');
  if (event.issue?.pull_request) blockers.push('pull-request-comments-not-supported');
  if (actor !== ownerLogin) blockers.push('final-publish-request-must-be-authored-by-repository-owner');
  if (!labels.includes(REQUIRED_ISSUE_LABEL)) blockers.push('issue-missing-codex-label');
  if (!parsed || parsed.marker !== 'PATCH_ESCROW_PUBLISH_V1' || !text(parsed.payload?.bundleId)) blockers.push('invalid-publish-request');

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    repository,
    ownerLogin,
    actor,
    issueNumber,
    bundleId: text(parsed?.payload?.bundleId),
    finalVerdict: blockers.length ? 'PATCH_ESCROW_PUBLISH_EVENT_BLOCKED' : 'PATCH_ESCROW_PUBLISH_EVENT_PASS',
  });
}

export function selectPatchEscrowFromComments(comments = [], bundleId, ownerLogin) {
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
  if (manifests.length !== 1) {
    return Object.freeze({ ok: false, reason: manifests.length ? 'duplicate-manifests' : 'manifest-not-found' });
  }
  const manifest = manifests[0].parsed.payload;
  const manifestValidation = validatePatchEscrowManifest(manifest);
  if (!manifestValidation.valid) return Object.freeze({ ok: false, reason: manifestValidation.errors[0], manifestValidation });
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

async function githubRequest(path, options = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  const apiUrl = text(process.env.GITHUB_API_URL, 'https://api.github.com');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (options.allow404 && response.status === 404) return null;
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = raw; }
  }
  if (!response.ok) {
    const error = new Error(`GitHub API ${options.method || 'GET'} ${path} failed with ${response.status}`);
    error.details = { status: response.status, payload };
    throw error;
  }
  return payload;
}

async function fetchAllIssueComments(repository, issueNumber) {
  const comments = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubRequest(`/repos/${repository}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  return comments;
}

async function postIssueComment(repository, issueNumber, body) {
  return githubRequest(`/repos/${repository}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
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

function assertNoPersistedGitCredentials(repositoryRoot) {
  const credentialConfig = runAllowingNoMatch('git', [
    'config', '--local', '--get-regexp', '^(http\\..*extraheader|credential\\..*helper)$',
  ], { cwd: repositoryRoot });
  if (text(credentialConfig.stdout)) throw new Error('persisted git credentials are forbidden during patched-code tests');
  const remoteUrl = text(run('git', ['remote', 'get-url', 'origin'], { cwd: repositoryRoot }).stdout);
  if (/x-access-token|oauth2:|https:\/\/[^/@]+@/i.test(remoteUrl)) throw new Error('credential-bearing git remote is forbidden during patched-code tests');
}

function statusChangedFiles(repositoryRoot) {
  return lines(run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryRoot }).stdout)
    .map((entry) => entry.slice(3).replace(/^"|"$/g, ''));
}

function writePatchFile(manifest, patch) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stephanos-patch-escrow-'));
  const patchPath = join(temporaryDirectory, `${manifest.bundleId}.patch`);
  writeFileSync(patchPath, patch);
  return Object.freeze({ temporaryDirectory, patchPath });
}

function computeExpectedTree(repositoryRoot, manifest, patchPath) {
  const indexDirectory = mkdtempSync(join(tmpdir(), 'stephanos-patch-index-'));
  const indexPath = join(indexDirectory, 'index');
  const environment = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    run('git', ['read-tree', manifest.baseSha], { cwd: repositoryRoot, env: environment });
    run('git', ['apply', '--cached', '--check', '--binary', patchPath], { cwd: repositoryRoot, env: environment });
    run('git', ['apply', '--cached', '--binary', patchPath], { cwd: repositoryRoot, env: environment });
    run('git', ['diff', '--cached', '--check'], { cwd: repositoryRoot, env: environment });
    const changedFiles = lines(run('git', ['diff', '--cached', '--name-only', manifest.baseSha], { cwd: repositoryRoot, env: environment }).stdout);
    if (!sameStrings(changedFiles, manifest.changedFiles)) {
      const error = new Error('expected patch tree changed files do not match signed manifest');
      error.details = { expectedChangedFiles: manifest.changedFiles, actualChangedFiles: changedFiles };
      throw error;
    }
    const treeSha = text(run('git', ['write-tree'], { cwd: repositoryRoot, env: environment }).stdout);
    if (!SHA_PATTERN.test(treeSha)) throw new Error('expected patch tree SHA could not be produced');
    return Object.freeze({ treeSha, changedFiles: Object.freeze(changedFiles) });
  } finally {
    rmSync(indexDirectory, { recursive: true, force: true });
  }
}

async function existingBranch(repository, branch) {
  return githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { allow404: true });
}

async function existingPullRequest(repository, ownerLogin, branch, baseBranch) {
  const pulls = await githubRequest(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${ownerLogin}:${branch}`)}&base=${encodeURIComponent(baseBranch)}`);
  return pulls[0] || null;
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
  if (parents.length !== 1 || text(parents[0]?.sha).toLowerCase() !== text(manifest.baseSha).toLowerCase()) {
    blockers.push('remote-commit-parent-does-not-match-signed-base');
  }
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

async function prepareBundle(event, options = {}) {
  const publishEvent = validatePatchEscrowPublishEvent(event);
  if (!publishEvent.valid) {
    const error = new Error(`publish event blocked: ${publishEvent.blockers.join(', ')}`);
    error.details = publishEvent;
    throw error;
  }
  const comments = await fetchAllIssueComments(publishEvent.repository, publishEvent.issueNumber);
  const selected = selectPatchEscrowFromComments(comments, publishEvent.bundleId, publishEvent.ownerLogin);
  if (!selected.ok) {
    const error = new Error(`patch escrow selection failed: ${selected.reason}`);
    error.details = selected;
    throw error;
  }
  const repositoryRoot = resolve(options.repositoryRoot || process.cwd());
  const repositoryMetadata = await githubRequest(`/repos/${publishEvent.repository}`);
  const defaultBranch = repositoryMetadata.default_branch;
  const manifest = selected.manifest;
  if (manifest.issueNumber !== publishEvent.issueNumber) throw new Error('manifest issue number does not match publish request issue');
  if (manifest.baseBranch !== defaultBranch) throw new Error('manifest base branch does not match repository default branch');
  const currentBase = await githubRequest(`/repos/${publishEvent.repository}/commits/${encodeURIComponent(defaultBranch)}`);
  if (currentBase.sha !== manifest.baseSha) {
    const error = new Error('patch base is stale; rebuild or re-export against current main');
    error.details = { expectedBaseSha: manifest.baseSha, actualBaseSha: currentBase.sha };
    throw error;
  }
  const checkedOutBase = text(run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).stdout);
  if (checkedOutBase !== manifest.baseSha) throw new Error('checked-out base does not match manifest base SHA');
  const patchFile = writePatchFile(manifest, selected.patch);
  const expected = computeExpectedTree(repositoryRoot, manifest, patchFile.patchPath);
  return Object.freeze({ publishEvent, selected, repositoryRoot, defaultBranch, patchFile, expected });
}

function applyPatchToWorkspace(repositoryRoot, manifest, patchPath) {
  run('git', ['checkout', '--detach', manifest.baseSha], { cwd: repositoryRoot });
  run('git', ['apply', '--check', '--binary', patchPath], { cwd: repositoryRoot });
  run('git', ['apply', '--binary', patchPath], { cwd: repositoryRoot });
  const actualChangedFiles = lines(run('git', ['diff', '--name-only'], { cwd: repositoryRoot }).stdout);
  if (!sameStrings(actualChangedFiles, manifest.changedFiles)) {
    const error = new Error('applied patch changed files do not match signed manifest');
    error.details = { expectedChangedFiles: manifest.changedFiles, actualChangedFiles };
    throw error;
  }
  run('git', ['diff', '--check'], { cwd: repositoryRoot });
  return Object.freeze(actualChangedFiles);
}

export async function runPatchEscrowValidation(event, options = {}) {
  const prepared = await prepareBundle(event, options);
  const { manifest } = prepared.selected;
  try {
    const actualChangedFiles = applyPatchToWorkspace(prepared.repositoryRoot, manifest, prepared.patchFile.patchPath);
    assertNoPersistedGitCredentials(prepared.repositoryRoot);
    clearSensitiveProcessEnvironment(process.env);
    const testHome = mkdtempSync(join(tmpdir(), 'stephanos-patch-test-home-'));
    try {
      const environment = sanitizedTestEnvironment(process.env, testHome);
      const testEvidence = runPatchEscrowTestProfile(manifest.testProfile, prepared.repositoryRoot, actualChangedFiles, { environment, homeDirectory: testHome });
      const changedAfterTests = statusChangedFiles(prepared.repositoryRoot);
      if (!sameStrings(changedAfterTests, manifest.changedFiles)) {
        const error = new Error('tests introduced unapproved workspace changes');
        error.details = { expectedChangedFiles: manifest.changedFiles, actualChangedFiles: changedAfterTests };
        throw error;
      }
      return Object.freeze({
        finalVerdict: 'PATCH_ESCROW_VALIDATION_PASS',
        bundleId: manifest.bundleId,
        patchSha256: manifest.patchSha256,
        expectedTreeSha: prepared.expected.treeSha,
        testEvidence,
      });
    } finally {
      rmSync(testHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(prepared.patchFile.temporaryDirectory, { recursive: true, force: true });
  }
}

function pullRequestBody(manifest, issueNumber) {
  return [
    manifest.prBody,
    '',
    `Closes #${issueNumber}`,
    '',
    '### Patch Escrow Publication',
    `- Bundle: \`${manifest.bundleId}\``,
    `- Patch SHA-256: \`${manifest.patchSha256}\``,
    `- Patch bytes: \`${manifest.patchByteLength}\``,
    `- Base: \`${manifest.baseSha}\``,
    `- Test profile: \`${manifest.testProfile}\``,
    '- Merge: not authorised',
  ].filter(Boolean).join('\n');
}

async function createPullRequest(repository, manifest, defaultBranch, issueNumber) {
  return githubRequest(`/repos/${repository}/pulls`, {
    method: 'POST',
    body: {
      title: manifest.prTitle,
      head: manifest.targetBranch,
      base: defaultBranch,
      body: pullRequestBody(manifest, issueNumber),
      maintainer_can_modify: true,
      draft: false,
    },
  });
}

async function publishPreparedBundle(prepared) {
  const { repository, ownerLogin, issueNumber } = prepared.publishEvent;
  const { manifest } = prepared.selected;
  const branchRef = await existingBranch(repository, manifest.targetBranch);
  const pull = await existingPullRequest(repository, ownerLogin, manifest.targetBranch, prepared.defaultBranch);

  if (branchRef) {
    const branchCommit = await githubRequest(`/repos/${repository}/git/commits/${text(branchRef.object?.sha)}`);
    const evidence = validateExistingPublicationEvidence({
      manifest,
      defaultBranch: prepared.defaultBranch,
      expectedTreeSha: prepared.expected.treeSha,
      branchRef,
      branchCommit,
      pull,
    });
    if (!evidence.valid) {
      const error = new Error(`existing deterministic publication failed exact verification: ${evidence.blockers.join(', ')}`);
      error.details = evidence;
      throw error;
    }
    const ensuredPull = pull || await createPullRequest(repository, manifest, prepared.defaultBranch, issueNumber);
    if (text(ensuredPull.head?.sha).toLowerCase() !== evidence.branchSha) throw new Error('created pull request head does not match verified branch head');
    return Object.freeze({
      idempotent: true,
      branch: manifest.targetBranch,
      remoteHeadSha: evidence.branchSha,
      prNumber: ensuredPull.number,
      prUrl: ensuredPull.html_url,
    });
  }
  if (pull) throw new Error('open pull request exists without its deterministic branch ref');

  const actualChangedFiles = applyPatchToWorkspace(prepared.repositoryRoot, manifest, prepared.patchFile.patchPath);
  run('git', ['config', 'user.name', 'stephanos-patch-escrow[bot]'], { cwd: prepared.repositoryRoot });
  run('git', ['config', 'user.email', 'stephanos-patch-escrow[bot]@users.noreply.github.com'], { cwd: prepared.repositoryRoot });
  run('git', ['add', '--', ...manifest.changedFiles], { cwd: prepared.repositoryRoot });
  const staged = lines(run('git', ['diff', '--cached', '--name-only'], { cwd: prepared.repositoryRoot }).stdout);
  if (!sameStrings(staged, manifest.changedFiles) || !sameStrings(actualChangedFiles, manifest.changedFiles)) {
    throw new Error('staged files do not match signed manifest');
  }
  const stagedTreeSha = text(run('git', ['write-tree'], { cwd: prepared.repositoryRoot }).stdout);
  if (stagedTreeSha !== prepared.expected.treeSha) throw new Error('staged tree does not match signed patch tree');
  run('git', ['commit', '-m', manifest.commitMessage], { cwd: prepared.repositoryRoot });
  const localHeadSha = text(run('git', ['rev-parse', 'HEAD'], { cwd: prepared.repositoryRoot }).stdout);
  const localTreeSha = text(run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: prepared.repositoryRoot }).stdout);
  if (localTreeSha !== prepared.expected.treeSha) throw new Error('local commit tree does not match signed patch tree');
  run('git', ['push', 'origin', `HEAD:refs/heads/${manifest.targetBranch}`], { cwd: prepared.repositoryRoot });

  const remoteRef = await existingBranch(repository, manifest.targetBranch);
  const remoteCommit = remoteRef ? await githubRequest(`/repos/${repository}/git/commits/${text(remoteRef.object?.sha)}`) : null;
  const remoteEvidence = validateExistingPublicationEvidence({
    manifest,
    defaultBranch: prepared.defaultBranch,
    expectedTreeSha: prepared.expected.treeSha,
    branchRef: remoteRef,
    branchCommit: remoteCommit,
    pull: null,
  });
  if (!remoteEvidence.valid || remoteEvidence.branchSha !== localHeadSha) {
    const error = new Error('remote exact head could not be verified after push');
    error.details = remoteEvidence;
    throw error;
  }
  const createdPull = await createPullRequest(repository, manifest, prepared.defaultBranch, issueNumber);
  if (text(createdPull.head?.sha).toLowerCase() !== localHeadSha) throw new Error('created pull request head does not match pushed exact head');
  return Object.freeze({
    idempotent: false,
    branch: manifest.targetBranch,
    remoteHeadSha: localHeadSha,
    prNumber: createdPull.number,
    prUrl: createdPull.html_url,
  });
}

export async function runPatchEscrowPublisher(event, options = {}) {
  const prepared = await prepareBundle(event, options);
  try {
    const result = await publishPreparedBundle(prepared);
    await postIssueComment(prepared.publishEvent.repository, prepared.publishEvent.issueNumber, [
      '### PATCH_ESCROW_PUBLICATION_RECEIPT_V1',
      '',
      `- Bundle: \`${prepared.selected.manifest.bundleId}\``,
      `- Branch: \`${result.branch}\``,
      `- REMOTE_HEAD: \`${result.remoteHeadSha}\``,
      `- PR: ${result.prUrl}`,
      `- PR number: \`${result.prNumber}\``,
      `- Idempotent reuse: \`${result.idempotent}\``,
      `- Patch SHA-256: \`${prepared.selected.manifest.patchSha256}\``,
      `- Expected tree: \`${prepared.expected.treeSha}\``,
      `- Test profile: \`${prepared.selected.manifest.testProfile}\``,
      '- Validation job: `passed before write credentials were available`',
      '- Merge performed: `false`',
    ].join('\n'));
    return Object.freeze({
      finalVerdict: 'PATCH_ESCROW_PUBLICATION_PASS',
      bundleId: prepared.selected.manifest.bundleId,
      expectedTreeSha: prepared.expected.treeSha,
      ...result,
    });
  } finally {
    rmSync(prepared.patchFile.temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const mode = text(process.argv[2] || process.env.PATCH_ESCROW_MODE).toLowerCase();
  if (!['validate', 'publish'].includes(mode)) throw new Error('Usage: node scripts/codex-patch-escrow-publisher.mjs <validate|publish>');
  try {
    const result = mode === 'validate'
      ? await runPatchEscrowValidation(event, { repositoryRoot: process.env.GITHUB_WORKSPACE })
      : await runPatchEscrowPublisher(event, { repositoryRoot: process.env.GITHUB_WORKSPACE });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const repository = text(event.repository?.full_name);
    const issueNumber = Number.parseInt(event.issue?.number, 10);
    if (mode === 'publish' && repository && Number.isSafeInteger(issueNumber) && process.env.GITHUB_TOKEN) {
      try {
        await postIssueComment(repository, issueNumber, [
          '### PATCH_ESCROW_PUBLICATION_BLOCKED_V1',
          '',
          `- Reason: \`${text(error.message).replace(/`/g, "'")}\``,
          '- No branch was intentionally overwritten.',
          '- No merge was performed.',
        ].join('\n'));
      } catch {
        // Preserve the original failure as the process result.
      }
    }
    process.stderr.write(`${JSON.stringify({
      finalVerdict: mode === 'validate' ? 'PATCH_ESCROW_VALIDATION_BLOCKED' : 'PATCH_ESCROW_PUBLICATION_BLOCKED',
      ...safeApiError(error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) await main();
