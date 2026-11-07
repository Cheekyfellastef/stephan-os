import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateExistingPublicationEvidence,
  validatePatchEscrowPublishEvent,
} from './codex-patch-escrow-publisher.mjs';
import { validateValidatedPatchEscrowArtifact } from './codex-patch-escrow-validated-artifact.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;

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

export function parseWorkspaceChangedFiles(statusOutput) {
  return String(statusOutput || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((entry) => {
      if (entry.length < 4 || entry[2] !== ' ') throw new Error('invalid git porcelain status entry');
      return entry.slice(3).replace(/^"|"$/g, '');
    });
}

function statusChangedFiles(repositoryRoot) {
  return parseWorkspaceChangedFiles(
    run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryRoot }).stdout,
  );
}

async function githubRequest(path, options = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  const apiUrl = text(process.env.GITHUB_API_URL, 'https://api.github.com');
  if (!token) throw new Error('GITHUB_TOKEN is required for validated escrow publication');
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

async function postIssueComment(repository, issueNumber, body) {
  return githubRequest(`/repos/${repository}/issues/${issueNumber}/comments`, { method: 'POST', body: { body } });
}

function writePatchFile(manifest, patch) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stephanos-validated-patch-escrow-'));
  const patchPath = join(temporaryDirectory, `${manifest.bundleId}.patch`);
  writeFileSync(patchPath, patch, { mode: 0o600 });
  return Object.freeze({ temporaryDirectory, patchPath });
}

function computeExpectedTree(repositoryRoot, manifest, patchPath) {
  const indexDirectory = mkdtempSync(join(tmpdir(), 'stephanos-validated-patch-index-'));
  const indexPath = join(indexDirectory, 'index');
  const environment = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    run('git', ['read-tree', manifest.baseSha], { cwd: repositoryRoot, env: environment });
    run('git', ['apply', '--cached', '--check', '--binary', patchPath], { cwd: repositoryRoot, env: environment });
    run('git', ['apply', '--cached', '--binary', patchPath], { cwd: repositoryRoot, env: environment });
    run('git', ['diff', '--cached', '--check'], { cwd: repositoryRoot, env: environment });
    const changedFiles = lines(run('git', ['diff', '--cached', '--name-only', manifest.baseSha], { cwd: repositoryRoot, env: environment }).stdout);
    if (!sameStrings(changedFiles, manifest.changedFiles)) throw new Error('validated patch tree changed files do not match manifest');
    const treeSha = text(run('git', ['write-tree'], { cwd: repositoryRoot, env: environment }).stdout);
    if (!SHA_PATTERN.test(treeSha)) throw new Error('validated patch tree SHA could not be produced');
    return Object.freeze({ treeSha, changedFiles: Object.freeze(changedFiles) });
  } finally {
    rmSync(indexDirectory, { recursive: true, force: true });
  }
}

function applyPatchToWorkspace(repositoryRoot, manifest, patchPath) {
  run('git', ['checkout', '--detach', manifest.baseSha], { cwd: repositoryRoot });
  run('git', ['apply', '--check', '--binary', patchPath], { cwd: repositoryRoot });
  run('git', ['apply', '--binary', patchPath], { cwd: repositoryRoot });
  const actualChangedFiles = statusChangedFiles(repositoryRoot);
  if (!sameStrings(actualChangedFiles, manifest.changedFiles)) throw new Error('applied validated patch changed files do not match manifest');
  run('git', ['diff', '--check'], { cwd: repositoryRoot });
  return Object.freeze(actualChangedFiles);
}

async function existingBranch(repository, branch) {
  return githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { allow404: true });
}

async function existingPullRequest(repository, ownerLogin, branch, baseBranch) {
  const pulls = await githubRequest(`/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${ownerLogin}:${branch}`)}&base=${encodeURIComponent(baseBranch)}`);
  return pulls[0] || null;
}

function pullRequestBody(manifest, issueNumber, artifact) {
  return [
    manifest.prBody,
    '',
    `Closes #${issueNumber}`,
    '',
    '### Patch Escrow Publication',
    `- Bundle: \`${manifest.bundleId}\``,
    `- Patch SHA-256: \`${manifest.patchSha256}\``,
    `- Prepared artifact SHA-256: \`${artifact.preparedArtifactSha256}\``,
    `- Validated artifact SHA-256: \`${artifact.artifactSha256}\``,
    `- Patch bytes: \`${manifest.patchByteLength}\``,
    `- Base: \`${manifest.baseSha}\``,
    `- Expected tree: \`${artifact.expectedTreeSha}\``,
    `- Test profile: \`${manifest.testProfile}\``,
    '- Merge: not authorised',
  ].filter(Boolean).join('\n');
}

async function createPullRequest(repository, manifest, defaultBranch, issueNumber, artifact) {
  return githubRequest(`/repos/${repository}/pulls`, {
    method: 'POST',
    body: {
      title: manifest.prTitle,
      head: manifest.targetBranch,
      base: defaultBranch,
      body: pullRequestBody(manifest, issueNumber, artifact),
      maintainer_can_modify: true,
      draft: false,
    },
  });
}

function validateEventArtifactBinding(eventValidation, artifact) {
  const blockers = [];
  if (!eventValidation.valid) blockers.push(...eventValidation.blockers);
  if (eventValidation.repository !== artifact.repository) blockers.push('event-repository-does-not-match-validated-artifact');
  if (eventValidation.ownerLogin !== artifact.ownerLogin) blockers.push('event-owner-does-not-match-validated-artifact');
  if (eventValidation.issueNumber !== artifact.issueNumber) blockers.push('event-issue-does-not-match-validated-artifact');
  if (eventValidation.commentId !== artifact.publishCommentId) blockers.push('event-comment-does-not-match-validated-artifact');
  if (eventValidation.bundleId !== artifact.bundleId) blockers.push('event-bundle-does-not-match-validated-artifact');
  if (eventValidation.patchSha256 !== artifact.patchSha256) blockers.push('event-full-patch-hash-does-not-match-validated-artifact');
  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(sortedUnique(blockers)) });
}

export function isVerifiedPatchEscrowPrCreation403(error) {
  return error?.message === 'GitHub API POST /repos/Cheekyfellastef/stephan-os/pulls failed with 403'
    && error?.details?.status === 403
    && error?.details?.payload?.message === 'GitHub Actions is not permitted to create or approve pull requests.';
}

// This pure planner never grants a mutation. The publisher supplies actual
// authenticated GitHub readbacks and retains all original approval boundaries.
export function validateEscrowBranchOnlyHandoff({
  error, manifest, artifact, currentBaseSha, branchRef, branchCommit, pull,
} = {}) {
  if (!isVerifiedPatchEscrowPrCreation403(error)) return Object.freeze({ ok: false, blocker: 'PR_CREATION_DENIAL_NOT_EXACT' });
  if (pull) return Object.freeze({ ok: false, blocker: 'ESCROW_PR_ALREADY_EXISTS_OR_COLLIDES' });
  if (!artifact || currentBaseSha !== artifact.baseSha) return Object.freeze({ ok: false, blocker: 'ESCROW_BASE_DRIFTED' });
  const evidence = validateExistingPublicationEvidence({
    manifest,
    defaultBranch: manifest?.baseBranch,
    expectedTreeSha: artifact.expectedTreeSha,
    branchRef,
    branchCommit,
    pull: null,
  });
  if (!evidence.valid) return Object.freeze({ ok: false, blocker: 'ESCROW_REMOTE_BRANCH_IDENTITY_UNPROVEN' });
  return Object.freeze({
    ok: true, blocker: '',
    branch: manifest.targetBranch, remoteHeadSha: evidence.branchSha,
    exactTreeSha: artifact.expectedTreeSha,
  });
}

async function recoverProvenEscrowBranchOnly(artifact, validation, error) {
  const manifest = validation.manifest;
  const [branchRef, pull, currentBase] = await Promise.all([
    existingBranch(artifact.repository, manifest.targetBranch),
    existingPullRequest(artifact.repository, artifact.ownerLogin, manifest.targetBranch, validation.prepared.defaultBranch),
    githubRequest('/repos/' + artifact.repository + '/commits/' + encodeURIComponent(validation.prepared.defaultBranch)),
  ]);
  const branchCommit = branchRef?.object?.sha
    ? await githubRequest('/repos/' + artifact.repository + '/git/commits/' + branchRef.object.sha)
    : null;
  const evidence = validateEscrowBranchOnlyHandoff({
    error, manifest, artifact, currentBaseSha: currentBase?.sha,
    branchRef, branchCommit, pull,
  });
  if (!evidence.ok) throw new Error(evidence.blocker);
  return evidence;
}

async function publishValidatedBundle(event, artifact, validation, options = {}) {
  const repositoryRoot = resolve(options.repositoryRoot || process.cwd());
  const manifest = validation.manifest;
  const repositoryMetadata = await githubRequest(`/repos/${artifact.repository}`);
  const defaultBranch = text(repositoryMetadata.default_branch);
  if (defaultBranch !== validation.prepared.defaultBranch) throw new Error('repository default branch no longer matches validated artifact');
  const currentBase = await githubRequest(`/repos/${artifact.repository}/commits/${encodeURIComponent(defaultBranch)}`);
  if (text(currentBase.sha) !== artifact.baseSha) throw new Error('validated patch base is stale; rebuild and revalidate against current main');
  const checkedOutBase = text(run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).stdout);
  if (checkedOutBase !== artifact.baseSha) throw new Error('checked-out base does not match validated artifact base SHA');

  const patchFile = writePatchFile(manifest, validation.patch);
  try {
    const expected = computeExpectedTree(repositoryRoot, manifest, patchFile.patchPath);
    if (expected.treeSha !== artifact.expectedTreeSha) throw new Error('reproduced patch tree does not match token-free validated tree');
    const branchRef = await existingBranch(artifact.repository, manifest.targetBranch);
    const pull = await existingPullRequest(artifact.repository, artifact.ownerLogin, manifest.targetBranch, defaultBranch);

    if (branchRef) {
      const branchCommit = await githubRequest(`/repos/${artifact.repository}/git/commits/${text(branchRef.object?.sha)}`);
      const evidence = validateExistingPublicationEvidence({
        manifest,
        defaultBranch,
        expectedTreeSha: artifact.expectedTreeSha,
        branchRef,
        branchCommit,
        pull,
      });
      if (!evidence.valid) throw new Error(`existing deterministic publication failed exact verification: ${evidence.blockers.join(', ')}`);
      const ensuredPull = pull || await createPullRequest(artifact.repository, manifest, defaultBranch, artifact.issueNumber, artifact);
      if (text(ensuredPull.head?.sha).toLowerCase() !== evidence.branchSha) throw new Error('created pull request head does not match verified branch head');
      return Object.freeze({ idempotent: true, branch: manifest.targetBranch, remoteHeadSha: evidence.branchSha, prNumber: ensuredPull.number, prUrl: ensuredPull.html_url });
    }
    if (pull) throw new Error('open pull request exists without its deterministic branch ref');

    const actualChangedFiles = applyPatchToWorkspace(repositoryRoot, manifest, patchFile.patchPath);
    run('git', ['config', 'user.name', 'stephanos-patch-escrow[bot]'], { cwd: repositoryRoot });
    run('git', ['config', 'user.email', 'stephanos-patch-escrow[bot]@users.noreply.github.com'], { cwd: repositoryRoot });
    run('git', ['add', '--', ...manifest.changedFiles], { cwd: repositoryRoot });
    const staged = lines(run('git', ['diff', '--cached', '--name-only'], { cwd: repositoryRoot }).stdout);
    if (!sameStrings(staged, manifest.changedFiles) || !sameStrings(actualChangedFiles, manifest.changedFiles)) throw new Error('staged files do not match validated manifest');
    const stagedTreeSha = text(run('git', ['write-tree'], { cwd: repositoryRoot }).stdout);
    if (stagedTreeSha !== artifact.expectedTreeSha) throw new Error('staged tree does not match token-free validated tree');
    run('git', ['commit', '-m', manifest.commitMessage], { cwd: repositoryRoot });
    const localHeadSha = text(run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).stdout);
    const localTreeSha = text(run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot }).stdout);
    if (localTreeSha !== artifact.expectedTreeSha) throw new Error('local commit tree does not match token-free validated tree');
    run('git', ['push', 'origin', `HEAD:refs/heads/${manifest.targetBranch}`], { cwd: repositoryRoot });

    const remoteRef = await existingBranch(artifact.repository, manifest.targetBranch);
    const remoteCommit = remoteRef ? await githubRequest(`/repos/${artifact.repository}/git/commits/${text(remoteRef.object?.sha)}`) : null;
    const remoteEvidence = validateExistingPublicationEvidence({
      manifest,
      defaultBranch,
      expectedTreeSha: artifact.expectedTreeSha,
      branchRef: remoteRef,
      branchCommit: remoteCommit,
      pull: null,
    });
    if (!remoteEvidence.valid || remoteEvidence.branchSha !== localHeadSha) throw new Error('remote exact head could not be verified after push');
    const createdPull = await createPullRequest(artifact.repository, manifest, defaultBranch, artifact.issueNumber, artifact);
    if (text(createdPull.head?.sha).toLowerCase() !== localHeadSha) throw new Error('created pull request head does not match pushed exact head');
    return Object.freeze({ idempotent: false, branch: manifest.targetBranch, remoteHeadSha: localHeadSha, prNumber: createdPull.number, prUrl: createdPull.html_url });
  } finally {
    rmSync(patchFile.temporaryDirectory, { recursive: true, force: true });
  }
}

export async function runValidatedPatchEscrowPublisher(event, artifactPath, options = {}) {
  const artifact = JSON.parse(readFileSync(resolve(artifactPath), 'utf8'));
  const validation = validateValidatedPatchEscrowArtifact(artifact);
  if (!validation.valid) throw new Error(`validated patch escrow artifact blocked: ${validation.blockers.join(', ')}`);
  const eventValidation = validatePatchEscrowPublishEvent(event);
  const binding = validateEventArtifactBinding(eventValidation, artifact);
  if (!binding.valid) throw new Error(`publish event is not bound to validated artifact: ${binding.blockers.join(', ')}`);
  let result;
  try {
    result = await publishValidatedBundle(event, artifact, validation, options);
  } catch (error) {
    if (!isVerifiedPatchEscrowPrCreation403(error)) throw error;
    // A verified source push can succeed even when GitHub Actions cannot
    // create a pull request. Reprove the exact remote branch, tree, ancestry,
    // signed main and absence of an existing PR before recording a handoff.
    const proof = await recoverProvenEscrowBranchOnly(artifact, validation, error);
    await postIssueComment(artifact.repository, artifact.issueNumber, [
      '### PATCH_ESCROW_BRANCH_PUBLISHED_PR_ATTACHMENT_PENDING_V1',
      '',
      '- Bundle: `' + artifact.bundleId + '`',
      '- Branch: `' + proof.branch + '`',
      '- REMOTE_HEAD: `' + proof.remoteHeadSha + '`',
      '- Exact remote tree: `' + proof.exactTreeSha + '`',
      '- Signed base: `' + artifact.baseSha + '`',
      '- Validated artifact SHA-256: `' + artifact.artifactSha256 + '`',
      '- Patch SHA-256: `' + artifact.patchSha256 + '`',
      '- PR: NOT CREATED; GitHub Actions PR creation permission denied',
      '- Next owner action: verify original source authority and attach ONE PR to this exact branch through an already-qualified connected GitHub App.',
      '- No duplicate execution, force push, merge, new source lease or main write authorised.',
    ].join('\n'));
    return Object.freeze({
      finalVerdict: 'PATCH_ESCROW_BRANCH_PUBLISHED_PR_ATTACHMENT_PENDING',
      bundleId: artifact.bundleId, patchSha256: artifact.patchSha256,
      validatedArtifactSha256: artifact.artifactSha256,
      ...proof, prNumber: null, prUrl: null,
      mergePerformed: false, rebuildRequired: false,
    });
  }
  await postIssueComment(artifact.repository, artifact.issueNumber, [
    '### PATCH_ESCROW_PUBLICATION_RECEIPT_V1',
    '',
    `- Bundle: \`${artifact.bundleId}\``,
    `- Branch: \`${result.branch}\``,
    `- REMOTE_HEAD: \`${result.remoteHeadSha}\``,
    `- PR: ${result.prUrl}`,
    `- PR number: \`${result.prNumber}\``,
    `- Idempotent reuse: \`${result.idempotent}\``,
    `- Patch SHA-256: \`${artifact.patchSha256}\``,
    `- Prepared artifact SHA-256: \`${artifact.preparedArtifactSha256}\``,
    `- Validated artifact SHA-256: \`${artifact.artifactSha256}\``,
    `- Expected tree: \`${artifact.expectedTreeSha}\``,
    '- Validation job: `token-free immutable artifact consumed by publisher`',
    '- Merge performed: `false`',
  ].join('\n'));
  return Object.freeze({
    finalVerdict: 'PATCH_ESCROW_VALIDATED_PUBLICATION_PASS',
    bundleId: artifact.bundleId,
    patchSha256: artifact.patchSha256,
    preparedArtifactSha256: artifact.preparedArtifactSha256,
    artifactSha256: artifact.artifactSha256,
    expectedTreeSha: artifact.expectedTreeSha,
    ...result,
  });
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  const artifactPath = text(process.argv[2] || process.env.PATCH_ESCROW_VALIDATED_PATH);
  if (!eventPath || !artifactPath) throw new Error('Usage: node scripts/codex-patch-escrow-publish-validated.mjs <validated.json>');
  const event = JSON.parse(readFileSync(resolve(eventPath), 'utf8'));
  const result = await runValidatedPatchEscrowPublisher(event, artifactPath, { repositoryRoot: process.env.GITHUB_WORKSPACE });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch(async (error) => {
    process.stderr.write(`${JSON.stringify({ finalVerdict: 'PATCH_ESCROW_VALIDATED_PUBLICATION_BLOCKED', message: text(error.message), details: error.details }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
