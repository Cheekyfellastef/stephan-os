import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processNextGitHubInspectionItem,
  processNextSignedOpenClawItem,
} from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';
import { publishNextMissionWorkerAction } from '../stephanos-server/services/missionOrchestratorWorkerService.js';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function outputHash(stdout, stderr) {
  return createHash('sha256').update(`${stdout || ''}\n${stderr || ''}`, 'utf8').digest('hex');
}

function completedAt(options = {}) {
  return options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
}

export function parseBridgeOutput(stdout = '') {
  return String(stdout).split(/\r?\n/).reduce((result, line) => {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    return result;
  }, {});
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

function requireJson(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label} failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function normalizeChecks(checks = []) {
  return (checks || []).map((check, index) => ({
    id: text(check.context || check.name, `check-${index + 1}`),
    name: text(check.context || check.name, `Check ${index + 1}`),
    status: text(check.conclusion || check.state || check.status, 'unknown').toLowerCase(),
    required: true,
    url: check.detailsUrl || check.targetUrl || '',
    completedAt: check.completedAt || '',
  }));
}

export async function executeSignedOperation(payload, claim, options = {}) {
  const claims = payload?.authorization?.claims || {};
  const repositoryRoot = text(claims.repositoryRoot);
  const bridgePath = options.bridgePath || resolve(repositoryRoot, 'scripts', 'windows', 'invoke-openclaw-github-operator-bridge.ps1');
  if (!repositoryRoot || !existsSync(bridgePath)) throw new Error('Signed OpenClaw bridge or repository root is missing.');
  const requestPath = `${claim.processingPath}.request.json`;
  await writeFile(requestPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const run = options.runCommand || defaultRun;
  try {
    const result = run(options.powerShellExecutable || 'powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridgePath,
      '-RequestPath', requestPath,
      '-StephanosRepositoryRoot', repositoryRoot,
    ], { cwd: repositoryRoot, env: options.env || process.env });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const fields = parseBridgeOutput(stdout);
    return {
      success: !result.error && result.status === 0 && fields.FINAL_VERDICT === 'OPENCLAW_GITHUB_OPERATION_PASS',
      error: result.error?.message || (result.status === 0 ? '' : stderr || stdout),
      exitCode: result.status,
      commandOutputHash: outputHash(stdout, stderr),
      completedAt: completedAt(options),
      resultPath: fields.RESULT_PATH || '',
      snapshotPath: fields.SNAPSHOT_PATH || '',
    };
  } finally {
    await rm(requestPath, { force: true });
  }
}

export async function inspectSignedOperation(payload, _execution, _claim, options = {}) {
  const claims = payload?.authorization?.claims || {};
  const operation = text(payload?.operation || claims.operation).toLowerCase();
  const repositoryRoot = text(claims.repositoryRoot);
  const run = options.runCommand || defaultRun;
  if (operation === 'create-worktree') {
    const status = run('git.exe', ['-C', claims.worktreePath, 'status', '--porcelain=v1', '--untracked-files=normal'], { cwd: claims.worktreePath });
    if (status.error || status.status !== 0) throw new Error(`Worktree inspection failed: ${status.error?.message || status.stderr || ''}`);
    return { worktreePath: claims.worktreePath, clean: !text(status.stdout) };
  }
  if (operation === 'commit') {
    const head = run('git.exe', ['-C', repositoryRoot, 'rev-parse', 'HEAD'], { cwd: repositoryRoot });
    const status = run('git.exe', ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=normal'], { cwd: repositoryRoot });
    if (head.error || head.status !== 0 || status.error || status.status !== 0) throw new Error('Commit inspection failed.');
    return { commitSha: text(head.stdout).toLowerCase(), clean: !text(status.stdout) };
  }
  if (operation === 'push') return { pushed: true };
  if (operation === 'open-pr') {
    const view = requireJson(run('gh.exe', ['pr', 'view', claims.branch, '--repo', claims.repository, '--json', 'number,url,headRefOid,mergeable,state'], { cwd: repositoryRoot }), 'Pull request inspection');
    return { prNumber: view.number, prUrl: view.url, headSha: text(view.headRefOid).toLowerCase(), mergeable: view.mergeable === 'MERGEABLE' && view.state === 'OPEN' };
  }
  if (operation === 'check-pr') {
    const view = requireJson(run('gh.exe', ['pr', 'view', String(claims.prNumber), '--repo', claims.repository, '--json', 'number,headRefOid,mergeable,state,statusCheckRollup'], { cwd: repositoryRoot }), 'Pull request check inspection');
    return {
      prNumber: view.number,
      headSha: text(view.headRefOid).toLowerCase(),
      prState: text(view.state).toLowerCase(),
      mergeable: view.mergeable === 'MERGEABLE' && view.state === 'OPEN',
      checks: normalizeChecks(view.statusCheckRollup),
    };
  }
  if (operation === 'merge-pr') {
    const view = requireJson(run('gh.exe', ['pr', 'view', String(claims.prNumber), '--repo', claims.repository, '--json', 'state,mergeCommit'], { cwd: repositoryRoot }), 'Merged pull request inspection');
    return { prState: text(view.state).toLowerCase(), mergeCommitSha: text(view.mergeCommit?.oid).toLowerCase() };
  }
  throw new Error(`Unsupported signed operation inspection: ${operation || 'unknown'}`);
}

export async function inspectGitHubAction(action, _claim, options = {}) {
  if (action?.actionKind !== 'github-inspection' || action.operation !== 'check-pr') {
    throw new Error('Unsupported read-only GitHub inspection action.');
  }
  const repository = text(action.repository);
  const repositoryRoot = text(action.repositoryRoot);
  const prNumber = Number.parseInt(action.prNumber, 10);
  if (!repository || !Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error('Read-only GitHub inspection requires a repository and pull request number.');
  }
  const run = options.runCommand || defaultRun;
  const result = run('gh.exe', [
    'pr', 'view', String(prNumber), '--repo', repository,
    '--json', 'number,headRefOid,mergeable,state,statusCheckRollup',
  ], { cwd: repositoryRoot || undefined, env: options.env || process.env });
  const view = requireJson(result, 'Read-only pull request check inspection');
  return {
    execution: {
      success: true,
      commandOutputHash: outputHash(result.stdout || '', result.stderr || ''),
      completedAt: completedAt(options),
    },
    inspection: {
      prNumber: view.number,
      headSha: text(view.headRefOid).toLowerCase(),
      prState: text(view.state).toLowerCase(),
      mergeable: view.mergeable === 'MERGEABLE' && view.state === 'OPEN',
      checks: normalizeChecks(view.statusCheckRollup),
    },
  };
}

export async function runMissionWorkerTick(options = {}) {
  const publish = await publishNextMissionWorkerAction({
    ...options,
    privateKeyPath: options.privateKeyPath || process.env.STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH,
  });
  const consumed = await processNextSignedOpenClawItem({
    ...options,
    executeSignedOperation: (payload, claim) => executeSignedOperation(payload, claim, options),
    inspectSignedOperation: (payload, execution, claim) => inspectSignedOperation(payload, execution, claim, options),
  });
  const inspected = await processNextGitHubInspectionItem({
    ...options,
    inspectGitHub: (action, claim) => inspectGitHubAction(action, claim, options),
  });
  return { publish, consumed, inspected };
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalMs = Number.parseInt(process.env.STEPHANOS_MISSION_WORKER_INTERVAL_MS || '2000', 10);
  do {
    try {
      const result = await runMissionWorkerTick();
      process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), ...result })}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), finalVerdict: 'MISSION_WORKER_TICK_FAILED', error: error.message })}\n`);
      if (once) process.exitCode = 1;
    }
    if (!once) await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(intervalMs, 250)));
  } while (!once);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
