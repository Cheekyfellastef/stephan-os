#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_ID = /^[1-9][0-9]{0,19}$/;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function bounded(value, limit = 8000) {
  const normalized = text(value);
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n...[truncated]` : normalized;
}

function safeSegment(value) {
  return text(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'unknown';
}

export function parseFailureExcerpt(log = '') {
  const lines = String(log).split(/\r?\n/);
  const interesting = lines.filter((line) => /(?:^|\s)(?:not ok|AssertionError(?::|\s)|ERR_ASSERTION|error:|failed|failure)(?:\s|$)/i.test(line));
  return bounded((interesting.length ? interesting : lines.slice(-80)).join('\n'), 12000);
}

export function buildFailureLogPaths({ workspaceRoot, repository, runId, jobId = '' }) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required.');
  const normalizedRepository = text(repository);
  if (!SAFE_REPOSITORY.test(normalizedRepository) || normalizedRepository.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('repository must be owner/name.');
  }
  if (!SAFE_ID.test(text(runId))) throw new Error('runId must be a positive GitHub Actions run ID.');
  if (jobId && !SAFE_ID.test(text(jobId))) throw new Error('jobId must be a positive GitHub Actions job ID.');
  const root = resolve(workspaceRoot, 'logs', 'github-actions', safeSegment(normalizedRepository), `run-${runId}`);
  const stem = jobId ? `job-${jobId}` : 'failed-jobs';
  return Object.freeze({ root, logPath: join(root, `${stem}.log`), receiptPath: join(root, `${stem}.receipt.json`) });
}

export function recoverGitHubActionsFailureLog(input = {}, options = {}) {
  const repository = text(input.repository);
  const runId = text(input.runId);
  const jobId = text(input.jobId);
  const paths = buildFailureLogPaths({ workspaceRoot: input.workspaceRoot, repository, runId, jobId });
  const run = options.runCommand || ((executable, args) => spawnSync(executable, args, { encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }));
  const args = jobId
    ? ['run', 'view', runId, '--repo', repository, '--job', jobId, '--log']
    : ['run', 'view', runId, '--repo', repository, '--log-failed'];
  const result = run(options.ghExecutable || 'gh.exe', args);
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  if (result.error || result.status !== 0 || !stdout.trim()) {
    return Object.freeze({ ok: false, finalVerdict: 'GITHUB_ACTIONS_LOG_RECOVERY_BLOCKED', blocker: result.error?.message || bounded(stderr || `gh exited ${result.status ?? 'unknown'}`), repository, runId, jobId, logPath: '', receiptPath: '' });
  }

  mkdirSync(paths.root, { recursive: true });
  writeFileSync(paths.logPath, stdout, { encoding: 'utf8', mode: 0o600 });
  const sha256 = createHash('sha256').update(stdout, 'utf8').digest('hex');
  const receipt = {
    schemaVersion: 'stephanos.github-actions-log-recovery.v1',
    generatedAtUtc: new Date().toISOString(),
    repository,
    runId,
    jobId,
    command: [options.ghExecutable || 'gh.exe', ...args],
    logFile: basename(paths.logPath),
    logPath: paths.logPath,
    bytes: Buffer.byteLength(stdout, 'utf8'),
    sha256,
    failureExcerpt: parseFailureExcerpt(stdout),
    readOnly: true,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    finalVerdict: 'GITHUB_ACTIONS_FULL_LOG_RECOVERED',
  };
  writeFileSync(paths.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return Object.freeze({ ok: true, ...receipt, receiptPath: paths.receiptPath });
}

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = recoverGitHubActionsFailureLog({
    repository: flag('--repo'),
    runId: flag('--run'),
    jobId: flag('--job'),
    workspaceRoot: flag('--workspace') || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
