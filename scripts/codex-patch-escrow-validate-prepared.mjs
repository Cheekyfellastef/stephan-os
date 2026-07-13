import { createHash } from 'node:crypto';
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
  derivePatchEscrowBundleId,
  validatePatchEscrowManifest,
} from '../shared/agents/codexPatchEscrow.mjs';
import {
  runPatchEscrowTestProfile,
  sanitizedTestEnvironment,
} from './codex-patch-escrow-publisher.mjs';
import { PREPARED_PATCH_ESCROW_SCHEMA_VERSION } from './codex-patch-escrow-prepare.mjs';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const GITHUB_CREDENTIAL_NAMES = Object.freeze(new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_PAT',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
]));

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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

function decodeCanonicalBase64(value) {
  const encoded = text(value);
  if (!encoded || encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, 'base64');
  return decoded.toString('base64') === encoded ? decoded : null;
}

export function validatePreparedPatchEscrow(prepared = {}) {
  const blockers = [];
  const manifestValidation = validatePatchEscrowManifest(prepared.manifest || {});
  const patch = decodeCanonicalBase64(prepared.patchBase64);
  const manifest = prepared.manifest || {};
  const expectedBundleId = derivePatchEscrowBundleId(manifest.issueNumber, manifest.patchSha256);

  if (prepared.schemaVersion !== PREPARED_PATCH_ESCROW_SCHEMA_VERSION) blockers.push('invalid-prepared-schema-version');
  if (!text(prepared.repository).includes('/')) blockers.push('invalid-prepared-repository');
  if (!text(prepared.ownerLogin)) blockers.push('invalid-prepared-owner');
  if (!Number.isSafeInteger(prepared.issueNumber) || prepared.issueNumber < 1) blockers.push('invalid-prepared-issue-number');
  if (prepared.defaultBranch !== 'main') blockers.push('invalid-prepared-default-branch');
  if (!SHA_PATTERN.test(text(prepared.currentBaseSha))) blockers.push('invalid-prepared-base-sha');
  if (!manifestValidation.valid) blockers.push(...manifestValidation.errors.map((error) => `manifest:${error}`));
  if (!expectedBundleId || prepared.bundleId !== expectedBundleId || manifest.bundleId !== expectedBundleId) blockers.push('prepared-bundle-id-mismatch');
  if (manifest.issueNumber !== prepared.issueNumber) blockers.push('prepared-issue-number-mismatch');
  if (manifest.baseBranch !== prepared.defaultBranch) blockers.push('prepared-base-branch-mismatch');
  if (manifest.baseSha !== prepared.currentBaseSha) blockers.push('prepared-base-sha-mismatch');
  if (!patch) blockers.push('invalid-prepared-patch-base64');
  if (patch && patch.length !== prepared.patchByteLength) blockers.push('prepared-patch-length-mismatch');
  if (patch && patch.length !== manifest.patchByteLength) blockers.push('manifest-patch-length-mismatch');
  if (patch && sha256(patch) !== prepared.patchSha256) blockers.push('prepared-patch-hash-mismatch');
  if (prepared.patchSha256 !== manifest.patchSha256) blockers.push('prepared-manifest-patch-hash-mismatch');

  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(sortedUnique(blockers)),
    patch,
    manifest,
    finalVerdict: blockers.length ? 'PATCH_ESCROW_PREPARED_BLOCKED' : 'PATCH_ESCROW_PREPARED_PASS',
  });
}

function parseEnvironmentNames(raw) {
  return String(raw || '')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('=');
      return separator < 0 ? { name: entry, value: '' } : { name: entry.slice(0, separator), value: entry.slice(separator + 1) };
    });
}

export function inspectGithubCredentialProcessAncestry(options = {}) {
  if ((options.platform || process.platform) !== 'linux') {
    return Object.freeze({ safe: false, blockers: Object.freeze(['process-ancestry-proof-requires-linux']), inspectedPids: Object.freeze([]) });
  }
  const readProcFile = options.readProcFile || ((path) => readFileSync(path, 'utf8'));
  const blockers = [];
  const inspectedPids = [];
  const seen = new Set();
  let pid = Number.parseInt(options.startPid ?? process.pid, 10);

  while (Number.isSafeInteger(pid) && pid > 0 && !seen.has(pid)) {
    seen.add(pid);
    inspectedPids.push(pid);
    let environment;
    let status;
    try {
      environment = readProcFile(`/proc/${pid}/environ`);
      status = readProcFile(`/proc/${pid}/status`);
    } catch (error) {
      blockers.push(`process-ancestry-unreadable:${pid}:${text(error?.code || error?.message, 'unknown')}`);
      break;
    }
    for (const entry of parseEnvironmentNames(environment)) {
      if (GITHUB_CREDENTIAL_NAMES.has(entry.name) && entry.value) blockers.push(`github-credential-in-process-ancestry:${pid}:${entry.name}`);
    }
    const parentMatch = String(status).match(/^PPid:\s+(\d+)$/m);
    if (!parentMatch) {
      blockers.push(`process-parent-unreadable:${pid}`);
      break;
    }
    const parentPid = Number.parseInt(parentMatch[1], 10);
    if (parentPid === 0) break;
    pid = parentPid;
  }

  return Object.freeze({
    safe: blockers.length === 0,
    blockers: Object.freeze(sortedUnique(blockers)),
    inspectedPids: Object.freeze(inspectedPids),
  });
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

function sharedAgentTestFiles(repositoryRoot) {
  const directory = join(repositoryRoot, 'shared', 'agents');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join('shared', 'agents', name))
    .sort((left, right) => left.localeCompare(right));
}

function writePatchFile(manifest, patch) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'stephanos-patch-escrow-validate-'));
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
    if (!sameStrings(changedFiles, manifest.changedFiles)) throw new Error('expected patch tree changed files do not match signed manifest');
    const treeSha = text(run('git', ['write-tree'], { cwd: repositoryRoot, env: environment }).stdout);
    if (!SHA_PATTERN.test(treeSha)) throw new Error('expected patch tree SHA could not be produced');
    return Object.freeze({ treeSha, changedFiles: Object.freeze(changedFiles) });
  } finally {
    rmSync(indexDirectory, { recursive: true, force: true });
  }
}

function applyPatchToWorkspace(repositoryRoot, manifest, patchPath) {
  run('git', ['checkout', '--detach', manifest.baseSha], { cwd: repositoryRoot });
  run('git', ['apply', '--check', '--binary', patchPath], { cwd: repositoryRoot });
  run('git', ['apply', '--binary', patchPath], { cwd: repositoryRoot });
  const actualChangedFiles = lines(run('git', ['diff', '--name-only'], { cwd: repositoryRoot }).stdout);
  if (!sameStrings(actualChangedFiles, manifest.changedFiles)) throw new Error('applied patch changed files do not match signed manifest');
  run('git', ['diff', '--check'], { cwd: repositoryRoot });
  return Object.freeze(actualChangedFiles);
}

export async function runPreparedPatchEscrowValidation(preparedPath, options = {}) {
  const prepared = JSON.parse(readFileSync(resolve(preparedPath), 'utf8'));
  const validation = validatePreparedPatchEscrow(prepared);
  if (!validation.valid) {
    const error = new Error(`prepared patch escrow blocked: ${validation.blockers.join(', ')}`);
    error.details = validation;
    throw error;
  }

  const ancestry = inspectGithubCredentialProcessAncestry(options.ancestryOptions);
  if (!ancestry.safe) {
    const error = new Error(`patched-code process ancestry is not credential-free: ${ancestry.blockers.join(', ')}`);
    error.details = ancestry;
    throw error;
  }

  const repositoryRoot = resolve(options.repositoryRoot || process.cwd());
  const checkedOutBase = text(run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).stdout);
  if (checkedOutBase !== validation.manifest.baseSha) throw new Error('checked-out base does not match prepared manifest base SHA');

  const patchFile = writePatchFile(validation.manifest, validation.patch);
  try {
    const expected = computeExpectedTree(repositoryRoot, validation.manifest, patchFile.patchPath);
    const actualChangedFiles = applyPatchToWorkspace(repositoryRoot, validation.manifest, patchFile.patchPath);
    assertNoPersistedGitCredentials(repositoryRoot);

    const testHome = mkdtempSync(join(tmpdir(), 'stephanos-patch-test-home-'));
    try {
      const environment = sanitizedTestEnvironment(process.env, testHome);
      const testEvidence = runPatchEscrowTestProfile(
        validation.manifest.testProfile,
        repositoryRoot,
        actualChangedFiles,
        { environment, homeDirectory: testHome },
      );
      const changedAfterTests = statusChangedFiles(repositoryRoot);
      if (!sameStrings(changedAfterTests, validation.manifest.changedFiles)) throw new Error('tests introduced unapproved workspace changes');
      return Object.freeze({
        finalVerdict: 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_PASS',
        bundleId: validation.manifest.bundleId,
        patchSha256: validation.manifest.patchSha256,
        expectedTreeSha: expected.treeSha,
        ancestry,
        testEvidence,
      });
    } finally {
      rmSync(testHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(patchFile.temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const preparedPath = text(process.argv[2] || process.env.PATCH_ESCROW_PREPARED_PATH);
  if (!preparedPath || !existsSync(resolve(preparedPath))) throw new Error('Usage: node scripts/codex-patch-escrow-validate-prepared.mjs <prepared.json>');
  const result = await runPreparedPatchEscrowValidation(preparedPath, { repositoryRoot: process.env.GITHUB_WORKSPACE });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      finalVerdict: 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_BLOCKED',
      message: text(error.message, 'unknown error'),
      details: error.details,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
