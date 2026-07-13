import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parsePatchEscrowComment,
  reassemblePatchEscrow,
  validatePatchEscrowManifest,
} from '../shared/agents/codexPatchEscrow.mjs';

const TRUSTED_CODEX_BOT = 'chatgpt-codex-connector[bot]';
const REQUIRED_ISSUE_LABEL = 'codex';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, ...(options.env || {}) },
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

function lines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameStrings(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
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
    } : undefined,
  };
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

function runNodeTest(repositoryRoot, files) {
  if (!files.length) throw new Error('test profile resolved to no test files');
  run(process.execPath, ['--test', ...files], { cwd: repositoryRoot });
}

export function runPatchEscrowTestProfile(profile, repositoryRoot, changedFiles) {
  if (profile === 'shared-agents') {
    runNodeTest(repositoryRoot, sharedAgentTestFiles(repositoryRoot));
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
    runNodeTest(repositoryRoot, focused);
    runNodeTest(repositoryRoot, sharedAgentTestFiles(repositoryRoot));
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
    for (const modulePath of modules) run(process.execPath, ['--check', modulePath], { cwd: repositoryRoot });
    const tests = modules.filter((path) => path.endsWith('.test.mjs'));
    if (tests.length) runNodeTest(repositoryRoot, tests);
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

async function existingBranch(repository, branch) {
  return githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { allow404: true });
}

async function existingPullRequest(repository, ownerLogin, branch, baseBranch) {
  const pulls = await githubRequest(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${ownerLogin}:${branch}`)}&base=${encodeURIComponent(baseBranch)}`);
  return pulls[0] || null;
}

async function publishBundle({ event, publishEvent, selected, repositoryRoot }) {
  const { repository, ownerLogin, issueNumber } = publishEvent;
  const { manifest, patch } = selected;
  if (manifest.issueNumber !== issueNumber) throw new Error('manifest issue number does not match publish request issue');

  const repositoryMetadata = await githubRequest(`/repos/${repository}`);
  const defaultBranch = repositoryMetadata.default_branch;
  if (manifest.baseBranch !== defaultBranch) throw new Error('manifest base branch does not match repository default branch');
  const currentBase = await githubRequest(`/repos/${repository}/commits/${encodeURIComponent(defaultBranch)}`);
  if (currentBase.sha !== manifest.baseSha) {
    const error = new Error('patch base is stale; rebuild or re-export against current main');
    error.details = { expectedBaseSha: manifest.baseSha, actualBaseSha: currentBase.sha };
    throw error;
  }

  const branchRef = await existingBranch(repository, manifest.targetBranch);
  const pull = await existingPullRequest(repository, ownerLogin, manifest.targetBranch, defaultBranch);
  if (branchRef || pull) {
    if (pull && text(pull.body).includes(manifest.patchSha256)) {
      return Object.freeze({
        idempotent: true,
        branch: manifest.targetBranch,
        remoteHeadSha: branchRef?.object?.sha || pull.head?.sha,
        prNumber: pull.number,
        prUrl: pull.html_url,
        testEvidence: null,
      });
    }
    throw new Error('deterministic patch branch already exists without matching patch receipt');
  }

  run('git', ['fetch', 'origin', defaultBranch], { cwd: repositoryRoot });
  const fetchedBase = text(run('git', ['rev-parse', `origin/${defaultBranch}`], { cwd: repositoryRoot }).stdout);
  if (fetchedBase !== manifest.baseSha) throw new Error('checked-out origin base does not match manifest base SHA');

  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stephanos-patch-escrow-'));
  const patchPath = join(temporaryDirectory, `${manifest.bundleId}.patch`);
  try {
    writeFileSync(patchPath, patch);
    run('git', ['checkout', '--detach', manifest.baseSha], { cwd: repositoryRoot });
    run('git', ['checkout', '-b', manifest.targetBranch], { cwd: repositoryRoot });
    run('git', ['apply', '--check', '--binary', patchPath], { cwd: repositoryRoot });
    run('git', ['apply', '--binary', patchPath], { cwd: repositoryRoot });

    const actualChangedFiles = lines(run('git', ['diff', '--name-only'], { cwd: repositoryRoot }).stdout);
    if (!sameStrings(actualChangedFiles, manifest.changedFiles)) {
      const error = new Error('applied patch changed files do not match signed manifest');
      error.details = { expectedChangedFiles: manifest.changedFiles, actualChangedFiles };
      throw error;
    }

    run('git', ['diff', '--check'], { cwd: repositoryRoot });
    const testEvidence = runPatchEscrowTestProfile(manifest.testProfile, repositoryRoot, actualChangedFiles);
    const changedAfterTests = lines(run('git', ['diff', '--name-only'], { cwd: repositoryRoot }).stdout);
    if (!sameStrings(changedAfterTests, manifest.changedFiles)) throw new Error('tests introduced unapproved source changes');

    run('git', ['config', 'user.name', 'stephanos-patch-escrow[bot]'], { cwd: repositoryRoot });
    run('git', ['config', 'user.email', 'stephanos-patch-escrow[bot]@users.noreply.github.com'], { cwd: repositoryRoot });
    run('git', ['add', '--', ...manifest.changedFiles], { cwd: repositoryRoot });
    const staged = lines(run('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot }).stdout);
    if (!sameStrings(staged, manifest.changedFiles)) throw new Error('staged files do not match signed manifest');
    run('git', ['commit', '-m', manifest.commitMessage], { cwd: repositoryRoot });
    const localHeadSha = text(run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).stdout);
    run('git', ['push', 'origin', `HEAD:refs/heads/${manifest.targetBranch}`], { cwd: repositoryRoot });

    const remoteRef = await existingBranch(repository, manifest.targetBranch);
    const remoteHeadSha = text(remoteRef?.object?.sha);
    if (!remoteHeadSha || remoteHeadSha !== localHeadSha) throw new Error('remote exact head could not be verified after push');

    const prBody = [
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

    const createdPull = await githubRequest(`/repos/${repository}/pulls`, {
      method: 'POST',
      body: {
        title: manifest.prTitle,
        head: manifest.targetBranch,
        base: defaultBranch,
        body: prBody,
        maintainer_can_modify: true,
        draft: false,
      },
    });

    return Object.freeze({
      idempotent: false,
      branch: manifest.targetBranch,
      remoteHeadSha,
      prNumber: createdPull.number,
      prUrl: createdPull.html_url,
      testEvidence,
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function runPatchEscrowPublisher(event, options = {}) {
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
  const result = await publishBundle({ event, publishEvent, selected, repositoryRoot });
  await postIssueComment(publishEvent.repository, publishEvent.issueNumber, [
    '### PATCH_ESCROW_PUBLICATION_RECEIPT_V1',
    '',
    `- Bundle: \`${selected.manifest.bundleId}\``,
    `- Branch: \`${result.branch}\``,
    `- REMOTE_HEAD: \`${result.remoteHeadSha}\``,
    `- PR: ${result.prUrl}`,
    `- PR number: \`${result.prNumber}\``,
    `- Idempotent reuse: \`${result.idempotent}\``,
    `- Patch SHA-256: \`${selected.manifest.patchSha256}\``,
    `- Test profile: \`${selected.manifest.testProfile}\``,
    '- Merge performed: `false`',
  ].join('\n'));
  return Object.freeze({
    finalVerdict: 'PATCH_ESCROW_PUBLICATION_PASS',
    bundleId: selected.manifest.bundleId,
    ...result,
  });
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  try {
    const result = await runPatchEscrowPublisher(event, { repositoryRoot: process.env.GITHUB_WORKSPACE });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const repository = text(event.repository?.full_name);
    const issueNumber = Number.parseInt(event.issue?.number, 10);
    if (repository && Number.isSafeInteger(issueNumber) && process.env.GITHUB_TOKEN) {
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
    process.stderr.write(`${JSON.stringify({ finalVerdict: 'PATCH_ESCROW_PUBLICATION_BLOCKED', ...safeApiError(error) }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) await main();
