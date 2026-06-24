import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processNextCodexItem,
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

function normalizePath(value) {
  return text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function pathAllowed(path, scopes = []) {
  const normalized = normalizePath(path);
  return scopes.some((scopeValue) => {
    const scope = normalizePath(scopeValue);
    if (scope === normalized) return true;
    if (!scope.endsWith('/**')) return false;
    const root = scope.slice(0, -3);
    return normalized === root || normalized.startsWith(`${root}/`);
  });
}

export function parseBridgeOutput(stdout = '') {
  return String(stdout).split(/\r?\n/).reduce((result, line) => {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    return result;
  }, {});
}

export function parseCodexJsonLines(stdout = '') {
  const events = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* Ignore non-JSON diagnostic lines. */ }
  }
  return events;
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

function codexOutputSchema() {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      summary: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            command: { type: 'string' },
          },
          required: ['requirement', 'command'],
          additionalProperties: false,
        },
      },
    },
    required: ['success', 'summary', 'evidence'],
    additionalProperties: false,
  };
}

function codexPrompt(action) {
  return [
    `Mission ID: ${action.missionId}`,
    `Repair round: ${Number.isInteger(action.repairRound) ? action.repairRound : 0}`,
    `Allowed source files: ${JSON.stringify(action.allowedFiles || [])}`,
    `Required tests: ${JSON.stringify(action.requiredTests || [])}`,
    `Required evidence: ${JSON.stringify(action.requiredEvidence || [])}`,
    '',
    'Implement the bounded mission in this existing isolated Git worktree.',
    'Read and obey repository AGENTS.md instructions before editing.',
    'Only edit files inside the allowed source scopes.',
    'Do not edit generated output, runtime data, dependencies, environment files, keys, tokens, or secret-bearing files.',
    'Do not commit, push, open or merge pull requests, or modify main. The OpenClaw worker owns GitHub mutations.',
    'Run the required tests that are relevant to the change.',
    'Return success=true only when the bounded implementation and claimed tests actually completed.',
    'For each grounded evidence requirement, return the exact required test command that produced it.',
  ].join('\n');
}

function successfulCodexCommands(events) {
  return events.filter((event) => {
    const item = event?.item || {};
    const exitCode = Number.isInteger(item.exit_code) ? item.exit_code : item.exitCode;
    return event?.type === 'item.completed'
      && item.type === 'command_execution'
      && ['completed', 'success'].includes(text(item.status).toLowerCase())
      && exitCode === 0
      && text(item.command);
  });
}

function groundedCodexEvidence(action, finalOutput, events, timestamp) {
  const requiredEvidence = new Set((action.requiredEvidence || []).map((value) => text(value)));
  const requiredTests = new Set((action.requiredTests || []).map((value) => text(value)));
  const successful = successfulCodexCommands(events);
  const receipts = [];
  for (const evidence of Array.isArray(finalOutput.evidence) ? finalOutput.evidence : []) {
    const requirement = text(evidence.requirement);
    const command = text(evidence.command);
    if (!requiredEvidence.has(requirement) || !requiredTests.has(command)) continue;
    const commandEvent = successful.find((event) => text(event.item?.command).includes(command));
    if (!commandEvent) continue;
    receipts.push({
      receiptId: `codex-evidence-${createHash('sha256').update(`${requirement}\n${command}`).digest('hex').slice(0, 20)}`,
      requirement,
      source: 'codex-cli',
      evidenceType: 'command-output',
      verified: true,
      commandOutputHash: createHash('sha256').update(JSON.stringify(commandEvent)).digest('hex'),
      createdAt: timestamp,
    });
  }
  return receipts;
}

function inspectChangedFiles(worktreePath, run) {
  const tracked = run('git.exe', ['-C', worktreePath, 'diff', '--name-only', 'HEAD', '--'], { cwd: worktreePath });
  const untracked = run('git.exe', ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'], { cwd: worktreePath });
  if (tracked.error || tracked.status !== 0 || untracked.error || untracked.status !== 0) {
    throw new Error('Codex changed-file inspection failed.');
  }
  return [...new Set(`${tracked.stdout || ''}\n${untracked.stdout || ''}`.split(/\r?\n/).map(normalizePath).filter(Boolean))].sort();
}

export async function executeCodexAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action.adapter !== 'codex') throw new Error('Unsupported Codex worker action.');
  const worktreePath = text(action.worktreePath);
  if (!worktreePath || !existsSync(worktreePath)) throw new Error('Codex handoff requires an existing isolated worktree.');
  const schemaPath = `${claim.processingPath}.codex-schema.json`;
  const outputPath = `${claim.processingPath}.codex-result.json`;
  await writeFile(schemaPath, `${JSON.stringify(codexOutputSchema(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  const run = options.runCommand || defaultRun;
  const timestamp = completedAt(options);
  try {
    const result = run(options.codexExecutable || process.env.STEPHANOS_CODEX_EXECUTABLE || 'codex.exe', [
      'exec', '--ephemeral', '--cd', worktreePath,
      '--sandbox', 'workspace-write', '--json',
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-c', 'approval_policy="never"',
      codexPrompt(action),
    ], { cwd: worktreePath, env: options.env || process.env });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const commandOutputHash = outputHash(stdout, stderr);
    if (result.error || result.status !== 0) {
      return { success: false, error: result.error?.message || stderr || stdout || `Codex exited with code ${result.status}.`, completedAt: timestamp, changedFiles: [], evidenceReceipts: [] };
    }
    let finalOutput;
    try { finalOutput = JSON.parse(await readFile(outputPath, 'utf8')); }
    catch { return { success: false, error: 'Codex did not produce a valid schema-constrained result.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [] }; }
    const changedFiles = inspectChangedFiles(worktreePath, run);
    const unsafeChanges = changedFiles.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    const events = parseCodexJsonLines(stdout);
    const threadId = text(events.find((event) => event.type === 'thread.started')?.thread_id, action.actionId);
    const success = finalOutput.success === true && changedFiles.length > 0 && unsafeChanges.length === 0;
    return {
      success,
      error: success ? '' : unsafeChanges.length ? `Codex changed files outside approved scope: ${unsafeChanges.join(', ')}` : changedFiles.length ? text(finalOutput.summary, 'Codex reported an unsuccessful result.') : 'Codex completed without a source change.',
      resultId: threadId,
      changedFiles,
      completedAt: timestamp,
      receipt: success ? {
        receiptId: `codex-result-${action.actionId}`.slice(0, 128),
        requirement: 'codex result',
        source: 'codex-cli',
        evidenceType: 'codex-exec',
        verified: true,
        commandOutputHash,
        createdAt: timestamp,
      } : undefined,
      evidenceReceipts: success ? groundedCodexEvidence(action, finalOutput, events, timestamp) : [],
    };
  } finally {
    await Promise.all([rm(schemaPath, { force: true }), rm(outputPath, { force: true })]);
  }
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
  const codex = await processNextCodexItem({
    ...options,
    executeCodexAction: (action, claim) => executeCodexAction(action, claim, options),
  });
  return { publish, consumed, inspected, codex };
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
