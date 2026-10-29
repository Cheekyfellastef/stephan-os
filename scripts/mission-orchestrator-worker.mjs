import {createSharedWorkspaceProofRecord,writeAtomicJson} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { FORGE_LIFEBOAT_WORKER_ID, MISSION_CONTROLLER_ROUTE, projectMissionControllerTaskV1 } from '../shared/agents/missionControllerCapacityRouterV1.mjs';
import { CODEX_TASK_CLASS } from '../shared/agents/codexCapacityGovernorV1.mjs';
import { projectNarrowedMissionSourceScopeV1 } from '../shared/agents/missionOrchestrator.mjs';
import { inspectStephanosNativeCapacityGamingAdmissionV1 } from '../shared/agents/stephanosNativeCapacityGamingAdmissionV1.mjs';
import { readMissionRecord, runWithMissionStatePrecondition } from '../stephanos-server/services/missionOrchestratorStore.js';
import { finalizeSourceArtifactEscrowFromCapturedIdentityV1 } from '../stephanos-server/services/sourceArtifactEscrowStore.js';
import { inspectFixedRuntimeQualificationV1, executeFixedSourceTaskRuntimeV1, consumeFixedRuntimeTerminalProvenanceV1, consumeFixedRuntimePrelaunchExclusionV1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1 } from './sovereign-fixed-runtime-source-task-v1.mjs';
import { resolveCanonicalMissionWorkerPaths } from './mission-orchestrator-worker-heartbeat.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, openSync, fstatSync, readFileSync, readSync, closeSync } from 'node:fs';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  claimNextMissionWorkerItem,
  beginMissionWorkerExecutionReceiptChain,
  appendMissionWorkerExecutionReceiptTransition,
  finalizeMissionWorkerQueueClaim,
  processNextCodexItem,
  processNextForgePublicationItem,
  processNextGitHubInspectionItem,
  processNextOpenClawReadonlyItem,
  processNextOpenClawStandaloneItem,
  processNextOpenClawLocalItem,
  processNextSignedOpenClawItem,
  processNextStephanosNativeItem,
  processNextVerificationItem,
} from '../stephanos-server/services/missionOrchestratorWorkerConsumer.js';
import {
  collectAgentWorkerResult,
  publishNextMissionWorkerAction,
  readMissionWorkerQueue,
} from '../stephanos-server/services/missionOrchestratorWorkerService.js';
import { executeStephanosNativeAction } from '../stephanos-server/services/missionOrchestratorStephanosNativeExecutor.js';
import { issueOpenClawGitHubAuthorization } from '../shared/agents/openClawGitHubAuthorization.mjs';
import { publishForgePrePrToGitHub } from '../stephanos-server/services/forgePrePrGitHubPublisherService.js';
import { githubApi as canonicalForgeGithubApi } from './publish-forge-pre-pr-escrow-signed.mjs';

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
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
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
    const commandEvent = successful.find((event) => text(event.item?.command) === command);
    if (!commandEvent) continue;
    receipts.push({
      receiptId: `codex-evidence-${createHash('sha256').update(`${requirement}\n${command}`).digest('hex').slice(0, 20)}`,
      requirement, testCommand: command, source: 'codex-cli', evidenceType: 'command-output', verified: true,
      commandOutputHash: createHash('sha256').update(JSON.stringify(commandEvent)).digest('hex'), createdAt: timestamp,
    });
  }
  return receipts;
}

function groundedCodexTestReceipts(action, events, timestamp) {
  const successful = successfulCodexCommands(events);
  return [...new Set((action.requiredTests || []).map((value) => text(value)).filter(Boolean))].flatMap((command) => {
    const commandEvent = successful.find((event) => text(event.item?.command) === command);
    if (!commandEvent) return [];
    return [{
      receiptId: `codex-test-${createHash('sha256').update(command).digest('hex').slice(0, 20)}`,
      requirement: 'source deterministic test',
      testCommand: command,
      source: 'codex-cli',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: createHash('sha256').update(JSON.stringify(commandEvent)).digest('hex'),
      createdAt: timestamp,
    }];
  });
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
    if (result.error || result.status !== 0) return { success: false, error: result.error?.message || stderr || stdout || `Codex exited with code ${result.status}.`, completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] };
    let finalOutput;
    try { finalOutput = JSON.parse(await readFile(outputPath, 'utf8')); }
    catch { return { success: false, error: 'Codex did not produce a valid schema-constrained result.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] }; }
    const changedFiles = inspectChangedFiles(worktreePath, run);
    const unsafeChanges = changedFiles.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    const events = parseCodexJsonLines(stdout);
    const threadId = text(events.find((event) => event.type === 'thread.started')?.thread_id, action.actionId);
    const success = finalOutput.success === true && changedFiles.length > 0 && unsafeChanges.length === 0;
    const evidenceReceipts = success ? groundedCodexEvidence(action, finalOutput, events, timestamp) : [];
    const sourceTestReceipts = success ? groundedCodexTestReceipts(action, events, timestamp) : [];
    return {
      success,
      error: success ? '' : unsafeChanges.length ? `Codex changed files outside approved scope: ${unsafeChanges.join(', ')}` : changedFiles.length ? text(finalOutput.summary, 'Codex reported an unsuccessful result.') : 'Codex completed without a source change.',
      resultId: threadId, changedFiles, completedAt: timestamp,
      receipt: success ? { receiptId: `codex-result-${action.actionId}`.slice(0, 128), requirement: 'codex result', source: 'codex-cli', evidenceType: 'codex-exec', verified: true, commandOutputHash, createdAt: timestamp } : undefined,
      evidenceReceipts,
      sourceTestReceipts,
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

function openClawSourcePrompt(action, agentId) {
  return [
    'STEPHANOS BOUNDED SOURCE IMPLEMENTATION',
    'Executor: ' + agentId,
    'Mission ID: ' + (action.missionId || ''),
    'Operator intent: ' + (action.operatorIntent || ''),
    'Intended outcome: ' + (action.intendedOutcome || ''),
    'Worktree: ' + (action.worktreePath || ''),
    'Allowed source files: ' + JSON.stringify(action.allowedFiles || []),
    'Required tests (the Mission Worker will rerun these independently): ' + JSON.stringify(action.requiredTests || []),
    'Required evidence: ' + JSON.stringify(action.requiredEvidence || []),
    '',
    'Work only in the supplied isolated worktree and only inside the allowed source scopes.',
    'Do not commit, push, open or merge pull requests, change main, install software, alter secrets, or edit environment files.',
    'Do not claim tests passed merely because you ran them; the Mission Worker is the acceptance authority.',
    'When the bounded source change is complete, return exactly one JSON object and no prose:',
    '{"success":true,"summary":"brief grounded summary"}',
    'Return success=false with a summary when the requested bounded change cannot be completed safely.',
  ].join('\n');
}

function parseBoundedTestCommand(command) {
  const normalized = text(command);
  if (!normalized || /[&|><^\x60\r\n]/.test(normalized)) return null;
  const parts = normalized.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!parts?.length) return null;
  const tokens = parts.map((part) => (
    (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))
      ? part.slice(1, -1)
      : part
  ));
  const requested = tokens.shift().toLowerCase();
  if (!['node', 'node.exe'].includes(requested)) return null;
  if (!tokens.length || !['--test', '--check'].includes(tokens[0])) return null;
  return { executable: 'node.exe', args: tokens, command: normalized };
}
function runBoundedSourceTests(action, run, options = {}, source = 'openclaw-standalone-worker') {
  const requiredTests = [...new Set((action.requiredTests || []).map((value) => text(value)).filter(Boolean))];
  const timestamp = completedAt(options);
  if (!requiredTests.length) {
    return { ok: false, error: 'Bounded source execution requires at least one deterministic required test.', receipts: [] };
  }
  const receipts = [];
  for (const command of requiredTests) {
    const parsed = parseBoundedTestCommand(command);
    if (!parsed) {
      return { ok: false, error: 'Unsupported or unsafe required test command: ' + command, receipts };
    }
    const result = run(parsed.executable, parsed.args, {
      cwd: text(action.worktreePath),
      env: options.env || process.env,
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const commandOutputHash = outputHash(stdout, stderr);
    if (result.error || result.status !== 0) {
      return {
        ok: false,
        error: 'Required test failed: ' + command + ': ' + (result.error?.message || stderr || stdout || ('exit ' + result.status)),
        receipts,
      };
    }
    receipts.push({
      receiptId: ('openclaw-test-' + createHash('sha256').update(command).digest('hex').slice(0, 20)).slice(0, 128),
      requirement: 'source deterministic test',
      testCommand: command,
      source,
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash,
      exitCode: 0,
      createdAt: timestamp,
    });
  }
  return { ok: true, error: '', receipts };
}

function sourceEvidenceFromTestReceipts(action, testReceipts, timestamp, source = 'openclaw-standalone-worker') {
  const receipts = Array.isArray(testReceipts) ? testReceipts.filter((receipt) => receipt?.verified === true) : [];
  if (!receipts.length) return [];
  const digest = createHash('sha256')
    .update(JSON.stringify(receipts.map((receipt) => ({
      testCommand: receipt.testCommand,
      commandOutputHash: receipt.commandOutputHash,
    }))))
    .digest('hex');
  const testGroundedRequirement = (value) => {
    const requirement = text(value);
    if (!requirement) return false;
    if (/\b(browser|ui|visual|screenshot|screen|manual|live|runtime|network|http|playtest)\b/i.test(requirement)) return false;
    return /\b(test|tests|check|checks)\b/i.test(requirement);
  };
  return [...new Set((action.requiredEvidence || []).map((value) => text(value)).filter(testGroundedRequirement))]
    .map((requirement) => ({
      receiptId: ('openclaw-evidence-' + createHash('sha256').update(requirement + '\n' + digest).digest('hex').slice(0, 20)).slice(0, 128),
      requirement,
      source,
      evidenceType: 'source-test-suite',
      verified: true,
      commandOutputHash: digest,
      createdAt: timestamp,
    }));
}
export async function executeOpenClawStandaloneAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action.adapter !== 'openclaw-standalone') {
    throw new Error('Unsupported OpenClaw Standalone worker action.');
  }
  const worktreePath = text(action.worktreePath);
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new Error('OpenClaw Standalone handoff requires an existing isolated worktree.');
  }
  const promptPath = claim?.processingPath
    ? claim.processingPath + '.openclaw-standalone-prompt.txt'
    : resolve(worktreePath, '.stephanos-openclaw-standalone-prompt.txt');
  await writeFile(promptPath, openClawSourcePrompt(action, 'openclaw-standalone'), {
    encoding: 'utf8',
    flag: 'wx',
  });
  const run = options.runCommand || defaultRun;
  const timestamp = completedAt(options);
  try {
    const command = run(
      options.openClawExecutable || process.env.STEPHANOS_OPENCLAW_EXECUTABLE || 'openclaw.cmd',
      [
        'agent',
        '--agent', 'openclaw-standalone',
        '--session-key', ('orchestrator-' + action.missionId + '-' + action.actionId).slice(0, 120),
        '--message-file', promptPath,
        '--timeout', String(options.openClawSourceTimeoutSeconds || 900),
        '--json',
      ],
      { cwd: worktreePath, env: options.env || process.env },
    );
    const stdout = command.stdout || '';
    const stderr = command.stderr || '';
    if (command.error || command.status !== 0) {
      return {
        success: false,
        error: command.error?.message || stderr || stdout || ('OpenClaw Standalone exited with code ' + command.status + '.'),
        completedAt: timestamp,
        changedFiles: [],
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    let response;
    try { response = JSON.parse(stdout); }
    catch {
      return { success: false, error: 'OpenClaw Standalone did not return valid JSON.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] };
    }
    let finalOutput;
    try { finalOutput = JSON.parse(openClawPayloadText(response)); }
    catch {
      return { success: false, error: 'OpenClaw Standalone did not return the required bounded JSON result.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] };
    }
    const changedFiles = inspectChangedFiles(worktreePath, run);
    const unsafeChanges = changedFiles.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    if (unsafeChanges.length) {
      return {
        success: false,
        error: 'OpenClaw Standalone changed files outside approved scope: ' + unsafeChanges.join(', '),
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    if (finalOutput.success !== true || changedFiles.length === 0) {
      return {
        success: false,
        error: changedFiles.length
          ? text(finalOutput.summary, 'OpenClaw Standalone reported an unsuccessful bounded source result.')
          : 'OpenClaw Standalone completed without a source change.',
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    const tests = runBoundedSourceTests(action, run, options);
    if (!tests.ok) {
      return {
        success: false,
        error: tests.error,
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: tests.receipts,
      };
    }
    const changedFilesAfterTests = inspectChangedFiles(worktreePath, run);
    const unsafeAfterTests = changedFilesAfterTests.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    if (unsafeAfterTests.length || JSON.stringify(changedFilesAfterTests) !== JSON.stringify(changedFiles)) {
      return {
        success: false,
        error: unsafeAfterTests.length
          ? 'Required tests changed files outside approved scope: ' + unsafeAfterTests.join(', ')
          : 'Required tests changed the source tree after OpenClaw Standalone returned its result.',
        completedAt: timestamp,
        changedFiles: changedFilesAfterTests,
        evidenceReceipts: [],
        sourceTestReceipts: tests.receipts,
      };
    }
    const resultId = text(response?.meta?.runId || response?.result?.meta?.runId, action.actionId);
    const commandOutputHash = outputHash(stdout, stderr);
    return {
      success: true,
      error: '',
      resultId,
      changedFiles,
      completedAt: timestamp,
      receipt: {
        receiptId: ('openclaw-standalone-result-' + action.actionId).slice(0, 128),
        requirement: 'openclaw standalone source result',
        source: 'openclaw-standalone-worker',
        evidenceType: 'openclaw-agent-turn',
        verified: true,
        commandOutputHash,
        createdAt: timestamp,
      },
      evidenceReceipts: sourceEvidenceFromTestReceipts(action, tests.receipts, timestamp),
      sourceTestReceipts: tests.receipts,
    };
  } finally {
    await rm(promptPath, { force: true });
  }
}

export async function executeOpenClawLocalAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action.adapter !== 'openclaw-local') {
    throw new Error('Unsupported OpenClaw Local worker action.');
  }
  const worktreePath = text(action.worktreePath);
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new Error('OpenClaw Local handoff requires an existing Stephanos-scoped isolated worktree.');
  }
  const promptPath = claim?.processingPath
    ? claim.processingPath + '.openclaw-local-prompt.txt'
    : resolve(worktreePath, '.stephanos-openclaw-local-prompt.txt');
  const agentId = options.openClawLocalAgent
    || process.env.STEPHANOS_OPENCLAW_LOCAL_AGENT
    || 'stephanos-scout-coder';
  await writeFile(promptPath, openClawSourcePrompt(action, agentId), {
    encoding: 'utf8',
    flag: 'wx',
  });
  const run = options.runCommand || defaultRun;
  const timestamp = completedAt(options);
  try {
    const command = run(
      options.openClawExecutable || process.env.STEPHANOS_OPENCLAW_EXECUTABLE || 'openclaw.cmd',
      [
        'agent',
        '--agent', agentId,
        '--session-key', ('orchestrator-local-' + action.missionId + '-' + action.actionId).slice(0, 120),
        '--message-file', promptPath,
        '--timeout', String(options.openClawSourceTimeoutSeconds || 900),
        '--json',
      ],
      { cwd: worktreePath, env: options.env || process.env },
    );
    const stdout = command.stdout || '';
    const stderr = command.stderr || '';
    if (command.error || command.status !== 0) {
      return {
        success: false,
        error: command.error?.message || stderr || stdout || ('OpenClaw Local exited with code ' + command.status + '.'),
        completedAt: timestamp,
        changedFiles: [],
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    let response;
    try { response = JSON.parse(stdout); }
    catch {
      return { success: false, error: 'OpenClaw Local did not return valid JSON.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] };
    }
    let finalOutput;
    try { finalOutput = JSON.parse(openClawPayloadText(response)); }
    catch {
      return { success: false, error: 'OpenClaw Local did not return the required bounded JSON result.', completedAt: timestamp, changedFiles: [], evidenceReceipts: [], sourceTestReceipts: [] };
    }
    const changedFiles = inspectChangedFiles(worktreePath, run);
    const unsafeChanges = changedFiles.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    if (unsafeChanges.length) {
      return {
        success: false,
        error: 'OpenClaw Local changed files outside approved scope: ' + unsafeChanges.join(', '),
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    if (finalOutput.success !== true || changedFiles.length === 0) {
      return {
        success: false,
        error: changedFiles.length
          ? text(finalOutput.summary, 'OpenClaw Local reported an unsuccessful bounded source result.')
          : 'OpenClaw Local completed without a source change.',
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: [],
      };
    }
    const tests = runBoundedSourceTests(action, run, options, 'openclaw-local-worker');
    if (!tests.ok) {
      return {
        success: false,
        error: tests.error,
        completedAt: timestamp,
        changedFiles,
        evidenceReceipts: [],
        sourceTestReceipts: tests.receipts,
      };
    }
    const changedFilesAfterTests = inspectChangedFiles(worktreePath, run);
    const unsafeAfterTests = changedFilesAfterTests.filter((path) => !pathAllowed(path, action.allowedFiles || []));
    if (unsafeAfterTests.length || JSON.stringify(changedFilesAfterTests) !== JSON.stringify(changedFiles)) {
      return {
        success: false,
        error: unsafeAfterTests.length
          ? 'Required tests changed files outside approved scope: ' + unsafeAfterTests.join(', ')
          : 'Required tests changed the source tree after OpenClaw Local returned its result.',
        completedAt: timestamp,
        changedFiles: changedFilesAfterTests,
        evidenceReceipts: [],
        sourceTestReceipts: tests.receipts,
      };
    }
    const resultId = text(response?.meta?.runId || response?.result?.meta?.runId, action.actionId);
    const commandOutputHash = outputHash(stdout, stderr);
    return {
      success: true,
      error: '',
      resultId,
      changedFiles,
      completedAt: timestamp,
      receipt: {
        receiptId: ('openclaw-local-result-' + action.actionId).slice(0, 128),
        requirement: 'openclaw local source result',
        source: 'openclaw-local-worker',
        evidenceType: 'openclaw-agent-turn',
        verified: true,
        commandOutputHash,
        createdAt: timestamp,
      },
      evidenceReceipts: sourceEvidenceFromTestReceipts(
        action,
        tests.receipts,
        timestamp,
        'openclaw-local-worker',
      ),
      sourceTestReceipts: tests.receipts,
    };
  } finally {
    await rm(promptPath, { force: true });
  }
}

export async function executeOpenClawReadonlyAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action.adapter !== 'openclaw-readonly') throw new Error('Unsupported OpenClaw read-only worker action.');
  if (options.actionGrant?.issueNumber === OPENCLAW_OC1_ISSUE) {
    const grant = options.actionGrant;
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
      return {
        success: false,
        error: command.error?.message || stderr || stdout || `OpenClaw OC1 Gateway call exited with code ${command.status}.`,
        completedAt: timestamp,
        changedFiles: [],
        evidenceReceipts: [],
      };
    }
    const payload = openClawOc1GatewayPayload(stdout);
    if (!validateOpenClawOc1GatewayPayload(payload, grant)) {
      return {
        success: false,
        error: 'OPENCLAW_OC1_GATEWAY_RESULT_LINEAGE_INVALID',
        completedAt: timestamp,
        changedFiles: [],
        evidenceReceipts: [],
      };
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


export async function executeForgePublicationAction(action, claim, options = {}) {
  if (action?.actionKind !== 'forge-escrow-publication'
      || action?.adapter !== 'forge-publication'
      || !claim?.item?.actionGrant
      || claim.item.actionGrant.actionId !== action.actionId
      || claim.item.actionGrant.missionId !== action.missionId) {
    throw new Error('FORGE_PUBLICATION_CONTROLLER_GRANT_REQUIRED');
  }
  if (action.exactParentHead !== claim.item.actionGrant.sourceRevision) {
    throw new Error('FORGE_PUBLICATION_PARENT_HEAD_GRANT_MISMATCH');
  }
  // The scheduler stores lowercase repository IDs, while the immutable escrow
  // and signed GitHub grant require the exact canonical repository identity.
  // Never trust the queued action to name a different repository.
  const canonicalRepository = 'Cheekyfellastef/stephan-os';
  if (text(action.repository).toLowerCase() !== canonicalRepository.toLowerCase()) {
    throw new Error('FORGE_PUBLICATION_CANONICAL_REPOSITORY_REQUIRED');
  }
  const env = options.env || process.env;
  const root = resolve(options.sharedWorkspaceRoot
    || env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || env.STEPHANOS_SHARED_WORKSPACE_ROOT
    || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  if (!/^[a-f0-9]{64}$/.test(text(action.artifactSha256))
      || !/^offline-publication-[a-f0-9]{24}$/.test(text(action.outboxId))) {
    throw new Error('FORGE_PUBLICATION_SOURCE_ARTIFACT_IDENTITY_INVALID');
  }
  const escrowFile = join(root, 'source-artifacts', action.artifactSha256 + '.escrow.json');
  const bundleFile = join(root, 'source-artifacts', action.artifactSha256 + '.json');
  const outboxFile = join(root, 'publication-outbox', 'pending', action.outboxId + '.json');
  const [escrow, bundleBytes, outbox] = await Promise.all([
    readFile(escrowFile, 'utf8').then(JSON.parse),
    readFile(bundleFile),
    readFile(outboxFile, 'utf8').then(JSON.parse),
  ]);
  if (escrow.missionId !== action.missionId
      || escrow.repository !== canonicalRepository
      || outbox.repository !== canonicalRepository
      || escrow.canonicalBranch !== action.branch
      || escrow.completeArtifactSha256 !== action.artifactSha256
      || escrow.exactParentHead !== action.exactParentHead
      || escrow.exactResultTree !== action.exactResultTree
      || outbox.outboxId !== action.outboxId
      || outbox.completeArtifactSha256 !== action.artifactSha256) {
    throw new Error('FORGE_PUBLICATION_ESCROW_QUEUE_IDENTITY_MISMATCH');
  }
  const privateKeyPath = options.privateKeyPath || env.STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH;
  const publicKeyPath = options.publicKeyPath || env.STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH;
  if (!privateKeyPath || !publicKeyPath) throw new Error('FORGE_PUBLICATION_SIGNING_KEYS_UNAVAILABLE');
  const [privateKeyPem, publicKeyPem] = await Promise.all([
    readFile(privateKeyPath, 'utf8'), readFile(publicKeyPath, 'utf8'),
  ]);
  const now = options.now instanceof Date ? options.now : new Date();
  const claims = {
    authorizationId: 'forge-publish-' + createHash('sha256')
      .update(action.actionId + ':' + action.artifactSha256).digest('hex').slice(0, 24),
    missionId: action.missionId, operation: 'publish-forge-escrow',
    repository: canonicalRepository, branch: action.branch,
    issueNumber: escrow.canonicalIssue,
    parentHead: action.exactParentHead, resultTree: action.exactResultTree,
    mergeAuthority: false, forcePushAllowed: false, singleUse: true,
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  };
  const authorization = issueOpenClawGitHubAuthorization(claims, privateKeyPem, { now });
  if (authorization.finalVerdict !== 'STEPHANOS_AUTHORIZATION_ISSUED') {
    throw new Error('FORGE_PUBLICATION_SIGNATURE_ISSUANCE_BLOCKED');
  }
  return publishForgePrePrToGitHub({
    escrow, outbox, bundleBytes, authorization, publicKeyPem,
    receiptRoot: join(root, 'publication-authorizations'),
    githubApi: options.forgeGithubApi || canonicalForgeGithubApi,
    nowUtc: now.toISOString(),
    env,
  });
}



function fixedSourceGrantClass(grant) {
  return grant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && grant.adapter === 'foundry-forge' && grant.actionKind === 'agent-handoff'
    && text(grant.operation) === '' && grant.capacityRoute === MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE
    && grant.workerId === FORGE_LIFEBOAT_WORKER_ID && grant.boundedActionCount === 1
    && grant.mergeAuthority === false && grant.leaseSeizureAllowed === false;
}
function sourceFingerprint(value) {
  const normalize = row => Array.isArray(row) ? row.map(normalize)
    : row && typeof row === 'object' ? Object.fromEntries(Object.keys(row).sort().map(k => [k, normalize(row[k])])) : row;
  return JSON.stringify(normalize(value));
}
function sourceContract(state) {
  return sourceFingerprint({missionId:state.missionId,repository:text(state.repository).toLowerCase(),
    branch:state.git?.branch,worktreePath:state.git?.worktreePath,allowedFiles:state.allowedFiles,
    requiredTests:state.requiredTests,requiredEvidence:state.requiredEvidence,
    repairRound:state.repair?.currentRound,repairMaximum:state.repair?.maximumRounds});
}
function fixedSourceFile(path, maximum) {
  const before=lstatSync(path);
  if(!before.isFile() || before.isSymbolicLink() || before.nlink!==1 || before.size<1 || before.size>maximum)
    throw new Error('NATIVE_SOURCE_FILE_IDENTITY_UNPROVEN');
  const fd=openSync(path,'r');
  try {
    const actual=fstatSync(fd);
    if(!actual.isFile() || actual.nlink!==1 || actual.ino!==before.ino || actual.dev!==before.dev || actual.size!==before.size)
      throw new Error('NATIVE_SOURCE_FILE_CHANGED');
    const buffer=Buffer.alloc(maximum+1);
    const length=readSync(fd,buffer,0,buffer.length,0);
    const after=fstatSync(fd);
    if(length!==actual.size || after.size!==actual.size || after.mtimeMs!==actual.mtimeMs || after.nlink!==1)
      throw new Error('NATIVE_SOURCE_FILE_CHANGED');
    return {bytes:buffer.subarray(0,length),ino:actual.ino,dev:actual.dev};
  } finally {closeSync(fd);}
}
async function preserveNativeSourceEvidence(kind,evidence,binding,grant,options) {
  const proofId='native-'+binding.requestId+'-'+kind;
  const record={...createSharedWorkspaceProofRecord({proofId,participantId:FORGE_LIFEBOAT_WORKER_ID,
    correlationId:grant.actionId,relatedIssue:'#'+grant.issueNumber,timestampUtc:new Date().toISOString(),
    status:'RECORDED',summary:'Original native '+kind+' evidence; operation success and source acceptance are separate.',
    proofRefs:grant.capacityProofRefs}),nativeEvidence:evidence,originalBinding:binding};
  const write=await writeAtomicJson(options.sharedWorkspaceRoot,['proof',proofId+'.json'],record,{repoRoot:options.repoRoot});
  if(!write.ok)throw new Error('NATIVE_SOURCE_EVIDENCE_PRESERVATION_UNPROVEN');
  const snapshot=fixedSourceFile(write.path,65536);
  return ['proof/'+proofId+'.json',fixedSourceHash(snapshot.bytes)];
}
function fixedSourceHash(bytes) {return createHash('sha256').update(bytes).digest('hex');}
function readFixedSourceProposal(nativeResult,binding,claim) {
  const lines=text(nativeResult.stdout).split(/\r?\n/);
  const marker='SOVEREIGN_RUNTIME_SOURCE_PROPOSAL_V1=';
  if(lines.length!==1 || !lines[0].startsWith(marker))throw new Error('NATIVE_SOURCE_PROPOSAL_REFERENCE_UNPROVEN');
  const reference=JSON.parse(lines[0].slice(marker.length));
  const name=binding.actionId+'.json.source-task-'+binding.requestId+'.proposal';
  if(reference.schemaVersion!=='stephanos.fixed-source-task-proposal-reference.v1'
    || reference.requestId!==binding.requestId || reference.claimSha256!==binding.claimSha256
    || reference.proposalName!==name || !/^[a-f0-9]{64}$/.test(reference.proposalSha256??'')
    || !Number.isSafeInteger(reference.proposalBytes) || reference.proposalBytes<1
    || reference.proposalBytes>FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1)throw new Error('NATIVE_SOURCE_PROPOSAL_REFERENCE_UNBOUND');
  const path=claim.processingPath+'.source-task-'+binding.requestId+'.proposal';
  const {bytes}=fixedSourceFile(path,FIXED_SOURCE_PROPOSAL_MAX_BYTES_V1);
  if(bytes.length!==reference.proposalBytes || fixedSourceHash(bytes)!==reference.proposalSha256)
    throw new Error('NATIVE_SOURCE_PROPOSAL_BYTES_UNBOUND');
  const envelope=JSON.parse(bytes);
  const receipt=nativeResult.nativeReceipt;
  if(envelope.schemaVersion!=='stephanos.fixed-source-task-proposal.v1'
    || envelope.requestId!==binding.requestId || envelope.actionId!==binding.actionId
    || envelope.missionId!==binding.missionId || envelope.claimSha256!==binding.claimSha256
    || envelope.sourceHead!==binding.sourceHead || envelope.frameSha256!==receipt?.FrameSha256
    || envelope.rootPid!==receipt?.TaskStage?.RootPid || receipt.Profile!=='SOURCE_TASK_V1')
    throw new Error('NATIVE_SOURCE_PROPOSAL_EXECUTION_UNBOUND');
  const proposal=envelope.proposal;
  if(proposal?.schemaVersion!=='stephanos.provider-neutral-source-build-proposal.v1'
    || proposal.actionId!==binding.actionId || proposal.missionId!==binding.missionId
    || proposal.adapter!=='foundry-forge' || reference.success!==(proposal.success===true))
    throw new Error('NATIVE_SOURCE_PROPOSAL_TASK_UNBOUND');
  return proposal;
}

// Existing Mission Worker owns the one claim and chain; this is its Windows
// adapter, never a second worker/scheduler or a caller-qualified execution lane.
async function processFixedSourceTaskInWorker(options) {
  const grant=JSON.parse(JSON.stringify(options.actionGrant));
  if(!fixedSourceGrantClass(grant))return {processed:false,reason:'native-source-local-worker-class-required'};
  const before=await readMissionRecord(grant.missionId,options);
  if(projectMissionControllerTaskV1(before.state).taskClass!==CODEX_TASK_CLASS.FOCUSED_REPAIR
    || !Array.isArray(before.state.allowedFiles) || before.state.allowedFiles.length<1 || before.state.allowedFiles.length>4)
    return {processed:false,reason:'native-source-focused-repair-class-required'};
  const resource=()=>inspectStephanosNativeCapacityGamingAdmissionV1({
    env:options.env,workspaceRoot:options.sharedWorkspaceRoot,repoRoot:options.repoRoot});
  const admission=resource();
  if(!admission.ok)return {processed:false,reason:admission.reason};
  const probe=inspectFixedRuntimeQualificationV1();
  if(!probe.ok || !probe.profiles.includes('SOURCE_TASK_V1'))
    return {processed:false,reason:probe.reason||'native-source-profile-unqualified'};
  if(probe.sourceHead!==grant.sourceRevision)return {processed:false,reason:'native-source-grant-head-mismatch'};
  const originalContract=sourceContract(before.state);
  const claim=await claimNextMissionWorkerItem('foundry-forge',{...options,actionGrant:grant});
  if(!claim)return {processed:false,reason:'native-source-exact-claim-unavailable'};
  let nativeProofRefs=[];
  let chain=null,nativeReleased=false,nativeTerminalProven=false,nativeResult=null,proposal=null,proposalReadError='',expectedResult=null;
  let claimSnapshot,binding,claimedState,originalRevision,monitor,monitorBusy=false;
  const controller=new AbortController();
  const forwardAbort=()=>controller.abort();
  options.signal?.addEventListener('abort',forwardAbort,{once:true});
  if(options.signal?.aborted)controller.abort();
  const held=(reason,extra={})=>({schemaVersion:'stephanos.provider-neutral-source-builder.v1',
    processed:true,success:false,adapter:'foundry-forge',providerAdapter:'foundry-forge',
    missionId:grant.missionId,actionId:grant.actionId,reason,error:reason,sourceState:proposal?.sourceState||'UNKNOWN',
    changedFiles:proposal?.changedFiles??null,preserveWorktree:true,preserveProposal:true,
    executionCustodyReleased:nativeReleased,finalVerdict:'NATIVE_SOURCE_FINALIZATION_HELD',...extra});
  const assertClaim=()=>{
    if(!claimSnapshot)throw new Error('NATIVE_SOURCE_CLAIM_SNAPSHOT_REQUIRED');
    const current=fixedSourceFile(claim.processingPath,131072);
    if(current.ino!==claimSnapshot.ino || current.dev!==claimSnapshot.dev
      || fixedSourceHash(current.bytes)!==binding.claimSha256)throw new Error('NATIVE_SOURCE_ORIGINAL_CLAIM_CHANGED');
  };
  const assertActionContract=(state)=>{
    const action=claim.item.payload;
    if(action?.missionId!==grant.missionId || action.actionId!==grant.actionId || action.adapter!=='foundry-forge'
      || action.actionKind!=='agent-handoff' || text(action.repository).toLowerCase()!==text(state.repository).toLowerCase()
      || action.branch!==state.git?.branch || action.branch!==grant.branch
      || resolve(action.worktreePath||'')!==resolve(state.git?.worktreePath||'')
      || !projectNarrowedMissionSourceScopeV1(state.allowedFiles,action.allowedFiles).valid
      || sourceFingerprint(action.requiredTests)!==sourceFingerprint(state.requiredTests)
      || sourceFingerprint(action.requiredEvidence)!==sourceFingerprint(state.requiredEvidence))
      throw new Error('NATIVE_SOURCE_ORIGINAL_PAYLOAD_CONTRACT_UNPROVEN');
  };
  const assertState=(state,allowOwnResult=false)=>{
    if(!state || state.cancelled===true || state.currentPhase==='CANCELLED'
      || state.storeMetadata?.originalSourceAttemptFence || state.storeMetadata?.supervisedRecoveryMaintenance
      || sourceContract(state)!==originalContract)throw new Error('NATIVE_SOURCE_CURRENT_STATE_FENCED');
    assertActionContract(state);
    if(state.revision===originalRevision && state.dispatch?.status==='running'
      && state.dispatch.adapter==='foundry-forge' && state.currentPhase===claimedState.currentPhase)return;
    const ids=state.storeMetadata?.processedEventIds||[];
    const resultId=('result-'+grant.actionId).slice(0,128),evidenceId=('evidence-'+grant.actionId).slice(0,128);
    const delta=1+(ids.includes(evidenceId)?1:0);
    const own=allowOwnResult && expectedResult && ids.includes(resultId)
      && state.revision===originalRevision+delta && state.dispatch?.resultId===grant.actionId
      && state.dispatch?.adapter==='foundry-forge'
      && (expectedResult.success===true
        ? state.dispatch.status==='complete' && ['VERIFYING','GITHUB_COMMIT'].includes(state.currentPhase)
          && state.sourcePublication?.artifactSha256===expectedResult.sourceArtifactEscrow?.completeArtifactSha256
        : state.dispatch.status==='failed' && state.currentPhase==='BLOCKED');
    if(!own)throw new Error('NATIVE_SOURCE_CURRENT_REVISION_OR_RESULT_MISMATCH');
  };
  // Native extinction does not make a cancelled invocation eligible to commit.
  // This monotonic intent check applies to both successful and failed results.
  const assertInvocationEligible=()=>{
    if(controller.signal.aborted)throw new Error('NATIVE_SOURCE_INVOCATION_CANCELLED');
  };
  const assertResultCustody=(state,event)=>{
    assertInvocationEligible();
    if(!nativeReleased)throw new Error('NATIVE_SOURCE_PHYSICAL_EXCLUSION_REQUIRED');
    assertClaim();
    assertState(state||JSON.parse(fixedSourceFile(before.statePath,4*1024*1024).bytes),true);
    if(options.assertResultCustody)options.assertResultCustody(state,event);
    assertInvocationEligible();
  };
  try {
    if(claim.pickupProof?.state!=='PROCESSING_CLAIM_PROVEN')
      throw new Error('NATIVE_SOURCE_FRESH_PROCESSING_PICKUP_REQUIRED');
    const observed=await readMissionRecord(grant.missionId,options);
    claimedState=observed.state;originalRevision=claimedState.revision;
    if(originalRevision!==before.state.revision+1 || sourceContract(claimedState)!==originalContract
      || sourceFingerprint(claim.item.actionGrant)!==sourceFingerprint(grant))
      throw new Error('NATIVE_SOURCE_CLAIM_GRANT_OR_REVISION_CHANGED');
    claimSnapshot=fixedSourceFile(claim.processingPath,131072);
    const item=JSON.parse(claimSnapshot.bytes);
    if(sourceFingerprint(item)!==sourceFingerprint(claim.item))throw new Error('NATIVE_SOURCE_CLAIM_BYTES_CHANGED');
    let qualification;
    binding=Object.freeze({requestId:'source-'+randomUUID(),sourceHead:grant.sourceRevision,
      custodyRecordSha256:probe.custodyRecordSha256,
      nativeRecordId:probe.nativeRecordId,
      actionId:grant.actionId,missionId:grant.missionId,claimSha256:fixedSourceHash(claimSnapshot.bytes)});
    assertClaim();assertState(claimedState);
    chain=await beginMissionWorkerExecutionReceiptChain(claim,{...options,actionGrant:grant});
    if(!chain || chain.state!=='progress' || chain.phase!=='worker-execution-active')
      throw new Error('NATIVE_SOURCE_FRESH_ORIGINAL_RECEIPT_CHAIN_REQUIRED');
    if(typeof options.awaitActiveClaimHeartbeat!=='function' || await options.awaitActiveClaimHeartbeat(grant)!==true)
      throw new Error('NATIVE_SOURCE_ACTIVE_CLAIM_PUBLICATION_UNPROVEN');
    assertClaim();assertState((await readMissionRecord(grant.missionId,options)).state);
    qualification=inspectFixedRuntimeQualificationV1();
    binding=Object.freeze({...binding,
      custodyRecordSha256:qualification.custodyRecordSha256??binding.custodyRecordSha256,
      nativeRecordId:qualification.nativeRecordId??binding.nativeRecordId});
    // Scoped cancellation sampling, not another scheduler. It reads only the
    // original canonical mission/resource state for this in-flight invocation.
    monitor=setInterval(async()=>{
      if(monitorBusy)return;monitorBusy=true;
      try {const state=(await readMissionRecord(grant.missionId,options)).state;assertState(state);}
      catch{controller.abort();}finally{monitorBusy=false;}
    },1000);
    nativeResult=await executeFixedSourceTaskRuntimeV1(qualification,binding,{
      signal:controller.signal,
      onPrepared:async prepared=>{
        assertClaim();assertState((await readMissionRecord(grant.missionId,options)).state);
        if(!resource().ok || prepared.Profile!=='SOURCE_TASK_V1' || prepared.RequestId!==binding.requestId
          || prepared.RuntimeSourceHead!==binding.sourceHead) return false;
        if(!chain)throw new Error('NATIVE_SOURCE_ORIGINAL_RECEIPT_REQUIRED');
        const rootProofRefs=await preserveNativeSourceEvidence('root',prepared,binding,grant,options);
        chain=await appendMissionWorkerExecutionReceiptTransition(chain,'progress',options,{
          phase:'native-source-root-bound',
          proofRefs:[...chain.proofRefs,...rootProofRefs],
          expectedNextAction:'Resume only this already-owned source root; parent alone may finalize after native zero.'});
        assertClaim();assertState((await readMissionRecord(grant.missionId,options)).state);
        return !controller.signal.aborted;
      }});
    clearInterval(monitor);monitor=undefined;
    nativeTerminalProven=consumeFixedRuntimeTerminalProvenanceV1(nativeResult,binding);
    nativeReleased=nativeTerminalProven || consumeFixedRuntimePrelaunchExclusionV1(nativeResult,binding);
    if(!nativeReleased)return held('NATIVE_SOURCE_CUSTODY_UNPROVEN');
    if(nativeTerminalProven)nativeProofRefs=await preserveNativeSourceEvidence('terminal',nativeResult.nativeReceipt,binding,grant,options);
    assertClaim();
    try {proposal=readFixedSourceProposal(nativeResult,binding,claim);}
    catch(error){proposalReadError=error.message;}
    const current=(await readMissionRecord(grant.missionId,options)).state;
    if(current.cancelled===true || current.currentPhase==='CANCELLED') {
      // Cancellation does not erase partially edited source or its original
      // processing ownership. Physical zero is a separate fact; no mission
      // result/queue terminalization is permitted through this branch.
      if(chain)chain=await appendMissionWorkerExecutionReceiptTransition(chain,'progress',options,{
        phase:'native-source-cancelled-reconciliation-held',blocker:'NATIVE_SOURCE_CANCELLED_SOURCE_PRESERVED',
        proofRefs:[...chain.proofRefs,...nativeProofRefs],
        expectedNextAction:'Preserve cancelled original claim/proposal/worktree and reconcile source without another execution.'});
      return held('NATIVE_SOURCE_CANCELLED_SOURCE_PRESERVED');
    }
    assertState(current);
    let failure=nativeResult.ok && nativeResult.taskExecuted===true?'':(nativeResult.reason||'NATIVE_SOURCE_OPERATION_FAILED');
    failure=failure||proposalReadError;
    if(!failure && proposal?.success===true) {
      const execution=proposal.execution,identity=proposal.sourceArtifactIdentity;
      const paths=execution?.changedFiles;
      if(!Array.isArray(paths) || !paths.length || paths.some(p=>typeof p!=='string')
        || !projectNarrowedMissionSourceScopeV1(claim.item.payload.allowedFiles,paths).valid
        || sourceFingerprint(paths)!==sourceFingerprint(proposal.changedFiles)
        || !Array.isArray(identity?.changedFiles)
        || sourceFingerprint([...paths].sort())!==sourceFingerprint(identity.changedFiles.map(p=>p.path).sort())
        || identity.missionId!==grant.missionId || identity.actionId!==grant.actionId
        || identity.repository!=='Cheekyfellastef/stephan-os' || identity.canonicalBranch!==grant.branch
        || identity.canonicalIssue!==grant.issueNumber || identity.canonicalPr!==grant.prNumber
        || identity.exactParentHead!==(grant.headSha||grant.sourceRevision)
        || execution.success!==true || execution.testsPassed!==true)
        throw new Error('NATIVE_SOURCE_CAPTURED_IDENTITY_OR_SCOPE_UNPROVEN');
      assertResultCustody();
      const finalized=await finalizeSourceArtifactEscrowFromCapturedIdentityV1(claim.item.payload,execution,identity,{
        ...options,actionGrant:grant});
      assertResultCustody();
      if(!finalized.sourceArtifactEscrow || !finalized.offlinePublicationOutbox || !finalized.testsPassed)
        throw new Error('NATIVE_SOURCE_OFFLINE_PRESERVATION_REQUIRED');
      expectedResult={missionId:grant.missionId,actionId:grant.actionId,adapter:'foundry-forge',
        success:true,resultId:grant.actionId,changedFiles:paths,receipt:execution.receipt,
        evidenceReceipts:execution.sourceTestReceipts,sourceArtifactEscrow:finalized.sourceArtifactEscrow,
        offlinePublicationOutbox:finalized.offlinePublicationOutbox,error:''};
      await collectAgentWorkerResult(expectedResult,{...options,assertResultCustody});
      assertResultCustody();
      const result={schemaVersion:'stephanos.provider-neutral-source-builder.v1',processed:true,success:true,
        adapter:'foundry-forge',providerAdapter:'foundry-forge',missionId:grant.missionId,actionId:grant.actionId,
        providerInvoked:proposal.providerInvoked,providerCompleted:proposal.providerCompleted,
        changedFiles:paths,testsPassed:true,sourceArtifactRef:finalized.sourceArtifactEscrow.artifactRef,
        offlinePublicationOutboxId:finalized.offlinePublicationOutbox.outboxId,executionCustodyReleased:true,
        finalVerdict:'PROVIDER_NEUTRAL_SOURCE_CHANGED_AND_TESTED'};
      const terminalState=(await readMissionRecord(grant.missionId,options)).state;
      assertResultCustody(terminalState);
      const terminal=await runWithMissionStatePrecondition(grant.missionId,{
        expectedRevision:terminalState.revision,expectedCurrentPhase:terminalState.currentPhase},async locked=>{
        assertResultCustody(locked);
        chain=await appendMissionWorkerExecutionReceiptTransition(chain,'completed',options,{
          phase:'native-source-result-validated',proofRefs:[...chain.proofRefs,execution.receipt.receiptId]});
        // This final synchronous guard authorizes the existing queue commit.
        // A later abort cannot roll back its in-flight result write and rename.
        assertResultCustody(locked);
        await finalizeMissionWorkerQueueClaim(claim,result,true);
        return result;
      },options);
      if(terminal.preconditionFailed)return held('NATIVE_SOURCE_SUCCESS_TERMINAL_CAS_FAILED');
      return terminal.result;
    }
    if(!proposal || proposal.success!==false || proposal.sourceState!=='UNCHANGED_OBSERVED'
      || proposal.sourceInspection?.known!==true || proposal.partialSourcePossible!==false
      || !Array.isArray(proposal.changedFiles) || proposal.changedFiles.length!==0) {
      if(chain)chain=await appendMissionWorkerExecutionReceiptTransition(chain,'progress',options,{
        phase:nativeTerminalProven?'native-source-zero-proposal-reconciliation-held':'native-source-prelaunch-excluded-claim-held',
        blocker:failure||proposal?.error||'NATIVE_SOURCE_PROPOSAL_INCOMPLETE',
        proofRefs:[...chain.proofRefs,...nativeProofRefs],
        expectedNextAction:'Preserve this original claim/worktree/proposal; reconcile source state without another execution.'});
      return held(failure||proposal?.error||'NATIVE_SOURCE_SOURCE_STATE_UNPROVEN');
    }
    expectedResult={missionId:grant.missionId,actionId:grant.actionId,adapter:'foundry-forge',
      success:false,resultId:grant.actionId,changedFiles:proposal?.changedFiles??null,
      error:failure||proposal?.error||'NATIVE_SOURCE_PROPOSAL_INCOMPLETE'};
    if(!proposal || proposal.sourceState==='UNKNOWN')expectedResult.error+=';SOURCE_STATE_UNKNOWN_PRESERVED';
    assertResultCustody();
    await collectAgentWorkerResult(expectedResult,{...options,assertResultCustody});
    assertResultCustody();
    const result={...held(expectedResult.error),providerInvoked:proposal?.providerInvoked===true,
      providerCompleted:proposal?.providerCompleted===true,finalVerdict:'PROVIDER_NEUTRAL_SOURCE_BUILD_BLOCKED'};
    const terminalState=(await readMissionRecord(grant.missionId,options)).state;
    assertResultCustody(terminalState);
    const terminal=await runWithMissionStatePrecondition(grant.missionId,{
      expectedRevision:terminalState.revision,expectedCurrentPhase:terminalState.currentPhase},async locked=>{
      assertResultCustody(locked);
      chain=await appendMissionWorkerExecutionReceiptTransition(chain,'failed',options,{
        phase:'native-source-failed-after-zero',blocker:expectedResult.error});
      assertResultCustody(locked);
      await finalizeMissionWorkerQueueClaim(claim,result,false);
      return result;
    },options);
    if(terminal.preconditionFailed)return held('NATIVE_SOURCE_FAILURE_TERMINAL_CAS_FAILED');
    return terminal.result;
  } catch(error) {
    return held(error?.message||'NATIVE_SOURCE_PARENT_INCOMPLETE');
  } finally {
    if(monitor)clearInterval(monitor);
    options.signal?.removeEventListener('abort',forwardAbort);
    // Proposal/worktree are deliberately preserved for canonical reconciliation.
  }
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
  const env = options.env || process.env;
  const canonicalPaths = resolveCanonicalMissionWorkerPaths({ env });
  const workerOptions = {
    ...options,
    env,
    sharedWorkspaceRoot: resolve(options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE
      || env.STEPHANOS_SHARED_WORKSPACE_ROOT || canonicalPaths.workspaceRoot),
    repoRoot: options.repoRoot || env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT || canonicalPaths.repositoryRoot,
    actionGrant,
    runCommand: options.runCommand || defaultRun,
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
  if (selection.entry.adapter === 'forge-publication') {
    processed = await processNextForgePublicationItem({
      ...workerOptions,
      executeForgePublication: (action, claim) => executeForgePublicationAction(action, claim, workerOptions),
    });
  } else if (selection.entry.adapter === 'openclaw-signed') {
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
  } else if (selection.entry.adapter === 'stephanos-native') {
    processed = await processNextStephanosNativeItem({
      ...workerOptions,
      executeStephanosNativeAction: (action, claim) => executeStephanosNativeAction(action, claim, workerOptions),
    });
  } else if (selection.entry.adapter === 'openclaw-standalone') {
    processed = await processNextOpenClawStandaloneItem({
      ...workerOptions,
      executeOpenClawStandaloneAction: (action, claim) => executeOpenClawStandaloneAction(action, claim, workerOptions),
    });
  } else if (selection.entry.adapter === 'openclaw-local') {
    processed = await processNextOpenClawLocalItem({
      ...workerOptions,
      executeOpenClawLocalAction: (action, claim) => executeOpenClawLocalAction(action, claim, workerOptions),
    });
  } else if (selection.entry.adapter === 'openclaw-readonly') {
    processed = await processNextOpenClawReadonlyItem({
      ...workerOptions,
      executeOpenClawReadonlyAction: (action, claim) => executeOpenClawReadonlyAction(action, claim, options),
    });
  } else if (selection.entry.adapter === 'verification') {
    processed = await processNextVerificationItem(workerOptions);
  } else if (selection.entry.adapter === 'foundry-forge' && fixedSourceGrantClass(actionGrant)) {
    processed = await processFixedSourceTaskInWorker(workerOptions);
  } else if (['chatgpt-github', 'foundry-forge', 'desktop-commander', 'sovereign-commander'].includes(selection.entry.adapter)) {
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
