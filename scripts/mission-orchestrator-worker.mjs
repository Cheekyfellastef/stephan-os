import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  processNextCodexItem,
  processNextGitHubInspectionItem,
  processNextOpenClawReadonlyItem,
  processNextSignedOpenClawItem,
} from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';
import {
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
} from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import {
  OPENCLAW_OC1_ISSUE,
  OPENCLAW_OC1_PROVIDER,
  OPENCLAW_OC1_PROVIDER_VERSION,
  OPENCLAW_OC1_TASK_CLASS,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc1-repository-scout.mjs';
import {
  OPENCLAW_OC1_GATEWAY_METHOD,
  OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA,
  OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc1-gateway-provider.mjs';
import {
  OPENCLAW_OC2_ISSUE,
  OPENCLAW_OC2_OPERATION,
  OPENCLAW_OC2_PROVIDER,
  OPENCLAW_OC2_PROVIDER_VERSION,
  OPENCLAW_OC2_TASK_CLASS,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs';
import {
  OPENCLAW_OC2_GATEWAY_METHOD,
  OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
  OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs';

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
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`${label} returned invalid JSON.`); }
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
      evidence: { type: 'array', items: { type: 'object', properties: { requirement: { type: 'string' }, command: { type: 'string' } }, required: ['requirement', 'command'], additionalProperties: false } },
    },
    required: ['success', 'summary', 'evidence'],
    additionalProperties: false,
  };
}

function codexPrompt(action) {
  return [
    `Mission ID: ${action.missionId}`,
    `Operator intent: ${action.operatorIntent || ''}`,
    `Intended outcome: ${action.intendedOutcome || ''}`,
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
    return event?.type === 'item.completed' && item.type === 'command_execution'
      && ['completed', 'success'].includes(text(item.status).toLowerCase())
      && exitCode === 0 && text(item.command);
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
      requirement, source: 'codex-cli', evidenceType: 'command-output', verified: true,
      commandOutputHash: createHash('sha256').update(JSON.stringify(commandEvent)).digest('hex'), createdAt: timestamp,
    });
  }
  return receipts;
}

function inspectChangedFiles(worktreePath, run) {
  const tracked = run('git.exe', ['-C', worktreePath, 'diff', '--name-only', 'HEAD', '--'], { cwd: worktreePath });
  const untracked = run('git.exe', ['-C', worktreePath, 'ls-files', '--others', '--exclude-standard'], { cwd: worktreePath });
  if (tracked.error || tracked.status !== 0 || untracked.error || untracked.status !== 0) throw new Error('Codex changed-file inspection failed.');
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
      'exec', '--ephemeral', '--cd', worktreePath, '--sandbox', 'workspace-write', '--json',
      '--output-schema', schemaPath, '--output-last-message', outputPath,
      '-c', 'approval_policy="never"', codexPrompt(action),
    ], { cwd: worktreePath, env: options.env || process.env });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const commandOutputHash = outputHash(stdout, stderr);
    if (result.error || result.status !== 0) return { success: false, error: result.error?.message || stderr || stdout || `Codex exited with code ${result.status}.`, completedAt: timestamp, changedFiles: [], evidenceReceipts: [] };
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
      resultId: threadId, changedFiles, completedAt: timestamp,
      receipt: success ? { receiptId: `codex-result-${action.actionId}`.slice(0, 128), requirement: 'codex result', source: 'codex-cli', evidenceType: 'codex-exec', verified: true, commandOutputHash, createdAt: timestamp } : undefined,
      evidenceReceipts: success ? groundedCodexEvidence(action, finalOutput, events, timestamp) : [],
    };
  } finally {
    await Promise.all([rm(schemaPath, { force: true }), rm(outputPath, { force: true })]);
  }
}

function openClawPrompt(action) {
  return [
    'STEPHANOS MISSION ORCHESTRATOR READ-ONLY INVESTIGATION',
    `Mission ID: ${action.missionId}`,
    `Operator intent: ${action.operatorIntent || ''}`,
    `Intended outcome: ${action.intendedOutcome || ''}`,
    `Repository root: ${action.repositoryRoot || ''}`,
    `Required evidence: ${JSON.stringify(action.requiredEvidence || [])}`,
    `Browser proof required: ${action.browserProofRequired === true}`,
    '',
    'Operate read-only. Do not edit files, run mutating commands, change Git state, commit, push, open or merge pull requests, install software, broaden policy, or expose secrets.',
    'You may inspect existing files, runtime state, browser state, and network responses only as allowed by your configured read-only tools.',
    'Any evidence receipt must already exist under the Mission Runner proof directory. Do not invent paths, hashes, commands, screenshots, or observations.',
    'Return exactly one JSON object and no prose with this shape:',
    '{"success":true,"summary":"grounded summary","evidence":[{"requirement":"exact required evidence string","receiptPath":"absolute existing proof file path"}]}',
    'Use success=false when the requested investigation cannot be grounded. Omit unsupported evidence rather than guessing.',
  ].join('\n');
}

function openClawPayloadText(response) {
  const payloads = Array.isArray(response?.payloads) ? response.payloads : Array.isArray(response?.result?.payloads) ? response.result.payloads : [];
  return payloads.map((payload) => text(payload?.text)).filter(Boolean).join('\n').trim();
}

function openClawOc1GatewayPayload(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout || '')); }
  catch { return null; }
  if (parsed?.schemaVersion === OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA) return parsed;
  if (parsed?.result?.schemaVersion === OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA) return parsed.result;
  return null;
}

function validateOpenClawOc1GatewayPayload(payload, grant) {
  const taskId = text(grant?.actionId).toLowerCase();
  const missionId = text(grant?.missionId).toLowerCase();
  const sourceHead = text(grant?.sourceRevision).toLowerCase();
  const providerInstance = text(payload?.providerInstance);
  const result = payload?.result;
  return payload?.schemaVersion === OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA
    && payload?.success === true
    && payload?.qualificationEligible === true
    && text(payload?.missionId).toLowerCase() === missionId
    && text(payload?.goalId) === `#${OPENCLAW_OC1_ISSUE}`
    && text(payload?.taskId).toLowerCase() === taskId
    && text(payload?.taskClass) === OPENCLAW_OC1_TASK_CLASS
    && text(payload?.repository) === text(grant?.repository)
    && text(payload?.requestedSourceHead).toLowerCase() === sourceHead
    && text(payload?.provider) === OPENCLAW_OC1_PROVIDER
    && /^openclaw-gateway:[1-9][0-9]*$/.test(providerInstance)
    && text(payload?.providerVersion) === OPENCLAW_OC1_PROVIDER_VERSION
    && payload?.executionSurface === 'openclaw-gateway-plugin'
    && result?.success === true
    && text(result?.resultId).toLowerCase() === taskId
    && Array.isArray(result?.changedFiles)
    && result.changedFiles.length === 0
    && result?.receipt?.verified === true
    && Array.isArray(result?.evidenceReceipts)
    && result.evidenceReceipts.length > 0
    && result.evidenceReceipts.every((receipt) => receipt?.verified === true);
}

function openClawOc2GatewayPayload(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout || '')); }
  catch { return null; }
  if (parsed?.schemaVersion === OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA) return parsed;
  if (parsed?.result?.schemaVersion === OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA) return parsed.result;
  return null;
}

function validateOpenClawOc2GatewayPayload(payload, grant) {
  const taskId = text(grant?.actionId).toLowerCase();
  const missionId = text(grant?.missionId).toLowerCase();
  const sourceHead = text(grant?.sourceRevision).toLowerCase();
  const providerInstance = text(payload?.providerInstance);
  const result = payload?.result;
  return payload?.schemaVersion === OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA
    && payload?.success === true
    && payload?.qualificationEligible === true
    && text(payload?.missionId).toLowerCase() === missionId
    && text(payload?.goalId) === `#${OPENCLAW_OC2_ISSUE}`
    && text(payload?.taskId).toLowerCase() === taskId
    && text(payload?.taskClass) === OPENCLAW_OC2_TASK_CLASS
    && text(payload?.repository) === text(grant?.repository)
    && text(payload?.requestedSourceHead).toLowerCase() === sourceHead
    && text(payload?.provider) === OPENCLAW_OC2_PROVIDER
    && /^openclaw-gateway:[1-9][0-9]*$/.test(providerInstance)
    && text(payload?.providerVersion) === OPENCLAW_OC2_PROVIDER_VERSION
    && payload?.executionSurface === 'openclaw-gateway-plugin'
    && result?.success === true
    && result?.qualificationEligible === true
    && text(result?.resultId).toLowerCase() === taskId
    && Array.isArray(result?.changedFiles)
    && result.changedFiles.length === 0
    && result?.receipt?.verified === true
    && Array.isArray(result?.evidenceReceipts)
    && result.evidenceReceipts.length > 0
    && result.evidenceReceipts.every((receipt) => receipt?.verified === true);
}

async function groundedOpenClawEvidence(action, finalOutput, options, timestamp) {
  const env = options.env || process.env;
  const missionRunnerRoot = text(options.missionRunnerRoot || env.STEPHANOS_MISSION_RUNNER_ROOT || (env.USERPROFILE ? resolve(env.USERPROFILE, 'Documents', 'OpenClaw-Standalone', 'mission-runner') : ''));
  if (!missionRunnerRoot) return [];
  const proofRoot = resolve(missionRunnerRoot, 'proof');
  const required = new Set((action.requiredEvidence || []).map((value) => text(value)));
  const receipts = [];
  for (const evidence of Array.isArray(finalOutput.evidence) ? finalOutput.evidence : []) {
    const requirement = text(evidence.requirement);
    const receiptPath = resolve(text(evidence.receiptPath));
    const relativePath = normalizePath(relative(proofRoot, receiptPath));
    if (!required.has(requirement) || !relativePath || relativePath === '..' || relativePath.startsWith('../')) continue;
    try {
      const info = await stat(receiptPath);
      if (!info.isFile()) continue;
      const sha256 = createHash('sha256').update(await readFile(receiptPath)).digest('hex');
      receipts.push({
        receiptId: `openclaw-evidence-${createHash('sha256').update(`${requirement}\n${relativePath}\n${sha256}`).digest('hex').slice(0, 20)}`,
        requirement, source: 'openclaw-readonly-cli', evidenceType: action.browserProofRequired === true ? 'browser-proof' : 'readonly-inspection',
        verified: true, sha256, receiptPath: `proof/${relativePath}`, createdAt: timestamp,
      });
    } catch { /* An absent or unreadable receipt is not evidence. */ }
  }
  return receipts;
}

function gatewayFailure(error, timestamp) {
  return {
    success: false,
    error,
    completedAt: timestamp,
    changedFiles: [],
    evidenceReceipts: [],
  };
}

export async function executeOpenClawReadonlyAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action.adapter !== 'openclaw-readonly') throw new Error('Unsupported OpenClaw read-only worker action.');
  const grant = options.actionGrant;
  const grantOperation = text(grant?.operation).toLowerCase();
  if (grant?.issueNumber === OPENCLAW_OC2_ISSUE && grantOperation === OPENCLAW_OC2_OPERATION) {
    const request = {
      schemaVersion: OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
      actionGrant: grant,
    };
    const run = options.runCommand || defaultRun;
    const timestamp = completedAt(options);
    const command = run(options.openClawExecutable || process.env.STEPHANOS_OPENCLAW_EXECUTABLE || 'openclaw.cmd', [
      'gateway', 'call', OPENCLAW_OC2_GATEWAY_METHOD,
      '--params', JSON.stringify(request),
      '--timeout', '120000',
      '--json',
    ], { cwd: text(action.repositoryRoot) || undefined, env: options.env || process.env });
    const stdout = command.stdout || '';
    const stderr = command.stderr || '';
    if (command.error || command.status !== 0) {
      return gatewayFailure(command.error?.message || stderr || stdout || `OpenClaw OC2 Gateway call exited with code ${command.status}.`, timestamp);
    }
    const payload = openClawOc2GatewayPayload(stdout);
    if (!validateOpenClawOc2GatewayPayload(payload, grant)) {
      return gatewayFailure('OPENCLAW_OC2_GATEWAY_RESULT_LINEAGE_INVALID', timestamp);
    }
    return payload.result;
  }
  if (grant?.issueNumber === OPENCLAW_OC1_ISSUE) {
    if (grantOperation) return gatewayFailure('OPENCLAW_OC1_OPERATION_NOT_ALLOWLISTED', completedAt(options));
    const request = {
      schemaVersion: OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA,
      actionGrant: grant,
    };
    const run = options.runCommand || defaultRun;
    const timestamp = completedAt(options);
    const command = run(options.openClawExecutable || process.env.STEPHANOS_OPENCLAW_EXECUTABLE || 'openclaw.cmd', [
      'gateway', 'call', OPENCLAW_OC1_GATEWAY_METHOD,
      '--params', JSON.stringify(request),
      '--timeout', '120000',
      '--json',
    ], { cwd: text(action.repositoryRoot) || undefined, env: options.env || process.env });
    const stdout = command.stdout || '';
    const stderr = command.stderr || '';
    if (command.error || command.status !== 0) {
      return gatewayFailure(command.error?.message || stderr || stdout || `OpenClaw OC1 Gateway call exited with code ${command.status}.`, timestamp);
    }
    const payload = openClawOc1GatewayPayload(stdout);
    if (!validateOpenClawOc1GatewayPayload(payload, grant)) {
      return gatewayFailure('OPENCLAW_OC1_GATEWAY_RESULT_LINEAGE_INVALID', timestamp);
    }
    return payload.result;
  }
  const promptPath = `${claim.processingPath}.openclaw-prompt.txt`;
  await writeFile(promptPath, openClawPrompt(action), { encoding: 'utf8', flag: 'wx' });
  const run = options.runCommand || defaultRun;
  const timestamp = completedAt(options);
  try {
    const result = run(options.openClawExecutable || process.env.STEPHANOS_OPENCLAW_EXECUTABLE || 'openclaw.cmd', [
      'agent', '--agent', options.openClawAgent || process.env.STEPHANOS_OPENCLAW_READONLY_AGENT || 'stephanos-scout',
      '--session-key', `orchestrator-${action.missionId}`, '--message-file', promptPath,
      '--timeout', String(options.openClawTimeoutSeconds || 600), '--json',
    ], { cwd: text(action.repositoryRoot) || undefined, env: options.env || process.env });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    if (result.error || result.status !== 0) return { success: false, error: result.error?.message || stderr || stdout || `OpenClaw exited with code ${result.status}.`, completedAt: timestamp, changedFiles: [], evidenceReceipts: [] };
    let response;
    try { response = JSON.parse(stdout); }
    catch { return { success: false, error: 'OpenClaw did not return valid JSON.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [] }; }
    let finalOutput;
    try { finalOutput = JSON.parse(openClawPayloadText(response)); }
    catch { return { success: false, error: 'OpenClaw did not return the required bounded JSON result.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [] }; }
    const evidenceReceipts = await groundedOpenClawEvidence(action, finalOutput, options, timestamp);
    const success = finalOutput.success === true;
    return {
      success,
      error: success ? '' : text(finalOutput.summary, 'OpenClaw could not ground the requested read-only investigation.'),
      resultId: text(response?.meta?.runId || response?.result?.meta?.runId, action.actionId), changedFiles: [], completedAt: timestamp,
      receipt: success ? { receiptId: `openclaw-result-${action.actionId}`.slice(0, 128), requirement: 'openclaw result', source: 'openclaw-readonly-cli', evidenceType: 'openclaw-agent-turn', verified: true, commandOutputHash: outputHash(stdout, stderr), createdAt: timestamp } : undefined,
      evidenceReceipts: success ? evidenceReceipts : [],
    };
  } finally { await rm(promptPath, { force: true }); }
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
    const result = run(options.powerShellExecutable || 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bridgePath, '-RequestPath', requestPath, '-StephanosRepositoryRoot', repositoryRoot], { cwd: repositoryRoot, env: options.env || process.env });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const fields = parseBridgeOutput(stdout);
    return { success: !result.error && result.status === 0 && fields.FINAL_VERDICT === 'OPENCLAW_GITHUB_OPERATION_PASS', error: result.error?.message || (result.status === 0 ? '' : stderr || stdout), exitCode: result.status, commandOutputHash: outputHash(stdout, stderr), completedAt: completedAt(options), resultPath: fields.RESULT_PATH || '', snapshotPath: fields.SNAPSHOT_PATH || '' };
  } finally { await rm(requestPath, { force: true }); }
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
    return { prNumber: view.number, headSha: text(view.headRefOid).toLowerCase(), prState: text(view.state).toLowerCase(), mergeable: view.mergeable === 'MERGEABLE' && view.state === 'OPEN', checks: normalizeChecks(view.statusCheckRollup) };
  }
  if (operation === 'merge-pr') {
    const view = requireJson(run('gh.exe', ['pr', 'view', String(claims.prNumber), '--repo', claims.repository, '--json', 'state,mergeCommit'], { cwd: repositoryRoot }), 'Merged pull request inspection');
    return { prState: text(view.state).toLowerCase(), mergeCommitSha: text(view.mergeCommit?.oid).toLowerCase() };
  }
  throw new Error(`Unsupported signed operation inspection: ${operation || 'unknown'}`);
}

export async function inspectGitHubAction(action, _claim, options = {}) {
  if (action?.actionKind !== 'github-inspection' || action.operation !== 'check-pr') throw new Error('Unsupported read-only GitHub inspection action.');
  const repository = text(action.repository);
  const repositoryRoot = text(action.repositoryRoot);
  const prNumber = Number.parseInt(action.prNumber, 10);
  if (!repository || !Number.isInteger(prNumber) || prNumber < 1) throw new Error('Read-only GitHub inspection requires a repository and pull request number.');
  const run = options.runCommand || defaultRun;
  const result = run('gh.exe', ['pr', 'view', String(prNumber), '--repo', repository, '--json', 'number,headRefOid,mergeable,state,statusCheckRollup'], { cwd: repositoryRoot || undefined, env: options.env || process.env });
  const view = requireJson(result, 'Read-only pull request check inspection');
  return { execution: { success: true, commandOutputHash: outputHash(result.stdout || '', result.stderr || ''), completedAt: completedAt(options) }, inspection: { prNumber: view.number, headSha: text(view.headRefOid).toLowerCase(), prState: text(view.state).toLowerCase(), mergeable: view.mergeable === 'MERGEABLE' && view.state === 'OPEN', checks: normalizeChecks(view.statusCheckRollup) } };
}

function payloadActionKind(payload, adapter) {
  const declared = text(payload?.actionKind);
  if (declared) return declared;
  if (
    adapter === 'openclaw-signed'
    && payload?.schemaVersion === 'stephanos.mission-worker-request.v1'
  ) {
    return 'signed-openclaw-operation';
  }
  return '';
}

function queuePayloadMatchesGrant(entry, actionGrant) {
  const payload = entry?.item?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const adapter = text(actionGrant.adapter).toLowerCase();
  const expectedOperation = text(actionGrant.operation).toLowerCase();
  const declaredPayloadAdapter = text(payload.adapter).toLowerCase();
  return (
    text(payload.missionId).toLowerCase() === text(actionGrant.missionId).toLowerCase()
    && text(payload.actionId).toLowerCase() === text(actionGrant.actionId).toLowerCase()
    && (!declaredPayloadAdapter || declaredPayloadAdapter === adapter)
    && payloadActionKind(payload, adapter) === text(actionGrant.actionKind)
    && text(payload.operation).toLowerCase() === expectedOperation
  );
}

export function selectGrantedMissionWorkerQueueItem(queue = [], actionGrant = {}) {
  const missionId = text(actionGrant.missionId).toLowerCase();
  const actionId = text(actionGrant.actionId).toLowerCase();
  const adapter = text(actionGrant.adapter).toLowerCase();
  if (
    actionGrant.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || actionGrant.boundedActionCount !== 1
    || !missionId
    || !actionId
    || !adapter
  ) {
    return { ok: false, reason: 'exact-action-grant-invalid', entry: null };
  }
  const envelopeMatches = queue.filter((entry) => (
    text(entry?.adapter).toLowerCase() === adapter
    && entry?.item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && text(entry?.item?.adapter).toLowerCase() === adapter
    && text(entry?.item?.missionId).toLowerCase() === missionId
    && text(entry?.item?.actionId).toLowerCase() === actionId
  ));
  const matches = envelopeMatches.filter((entry) => (
    queuePayloadMatchesGrant(entry, actionGrant)
  ));
  if (matches.length !== 1) {
    return {
      ok: false,
      reason: matches.length
        ? 'exact-action-queue-item-ambiguous'
        : envelopeMatches.length
          ? 'exact-action-queue-payload-mismatch'
          : 'exact-action-queue-item-not-pending',
      entry: null,
    };
  }
  return { ok: true, reason: 'exact-action-queue-item-selected', entry: matches[0] };
}

export async function runMissionWorkerTick(options = {}) {
  const actionGrant = options.actionGrant;
  const grantCheck = selectGrantedMissionWorkerQueueItem([], actionGrant);
  if (grantCheck.reason === 'exact-action-grant-invalid') {
    return {
      publish: { published: false, reason: 'exact-action-grant-required' },
      processed: { processed: false, reason: 'exact-action-grant-required' },
    };
  }
  const workerOptions = {
    ...options,
    actionGrant,
    privateKeyPath: options.privateKeyPath
      || options.env?.STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH
      || process.env.STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH,
  };
  const publish = await publishNextMissionWorkerAction(workerOptions);
  if (publish.reason === 'action-grant-mismatch' || publish.reason?.startsWith('action-grant-mission-')) {
    return { publish, processed: { processed: false, reason: publish.reason } };
  }
  const selection = selectGrantedMissionWorkerQueueItem(
    await readMissionWorkerQueue(workerOptions),
    actionGrant,
  );
  if (!selection.ok) {
    return { publish, processed: { processed: false, reason: selection.reason } };
  }
  let processed;
  if (selection.entry.adapter === 'openclaw-signed') {
    processed = await processNextSignedOpenClawItem({
      ...workerOptions,
      executeSignedOperation: (payload, claim) => executeSignedOperation(payload, claim, options),
      inspectSignedOperation: (payload, execution, claim) => inspectSignedOperation(payload, execution, claim, options),
    });
  } else if (selection.entry.adapter === 'openclaw-github-readonly') {
    processed = await processNextGitHubInspectionItem({
      ...workerOptions,
      inspectGitHub: (action, claim) => inspectGitHubAction(action, claim, options),
    });
  } else if (selection.entry.adapter === 'codex') {
    processed = await processNextCodexItem({
      ...workerOptions,
      executeCodexAction: (action, claim) => executeCodexAction(action, claim, options),
    });
  } else if (selection.entry.adapter === 'openclaw-readonly') {
    processed = await processNextOpenClawReadonlyItem({
      ...workerOptions,
      executeOpenClawReadonlyAction: (action, claim) => executeOpenClawReadonlyAction(action, claim, options),
    });
  } else if (['chatgpt-github', 'foundry-forge'].includes(selection.entry.adapter)) {
    processed = { processed: false, reason: 'proven-external-lane-handoff-pending', adapter: selection.entry.adapter, queuePath: selection.entry.path };
  } else {
    processed = { processed: false, reason: 'granted-action-adapter-not-supported-by-worker' };
  }
  return { publish, actionGrant, processed };
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
