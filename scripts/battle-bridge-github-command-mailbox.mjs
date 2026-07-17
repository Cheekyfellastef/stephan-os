#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { updateStephanosFromChat } from '../shared/agents/stephanosChatUpdate.mjs';
import { runBattleBridgeDiagnostics } from '../shared/agents/codexDispatchHostOps.mjs';
import { createSanitizedSharedWorkspaceProjection } from '../shared/agents/chatGptParticipantBridgeV1.mjs';
import {
  buildStephanosCapabilityRegistrySummary,
  validateStephanosCapabilityRegistry,
} from '../shared/agents/stephanosCapabilityRegistry.mjs';
import { runBattleBridgeWorkerWatchdogAcceptance } from './battle-bridge-worker-watchdog-acceptance.mjs';
import { runBattleBridgeMonitorMultiplexerCanary } from './battle-bridge-monitor-multiplexer-canary.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  selectNextBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
const mailboxWorkspaceRoot = resolve(process.env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
const sharedWorkspaceRoot = resolve(process.env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
const mailboxStateRoot = join(mailboxWorkspaceRoot, 'github-command-mailbox');
const canonicalReceiptRoot = join(sharedWorkspaceRoot, 'receipts', 'github-command-mailbox');
const statePath = join(mailboxStateRoot, 'state.json');
const MAX_GITHUB_JSON_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_RECEIPT_JSON_BYTES = 9 * 1024;
const MAX_LOCAL_RECEIPT_BYTES = 256 * 1024;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_PROOF_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

function bounded(value, limit = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 900000,
    maxBuffer: options.maxBuffer || MAX_GITHUB_JSON_BYTES,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: options.preserveStdout ? stdout : bounded(stdout),
    stderr: bounded(stderr),
    error: result.error?.message || '',
  };
}

export function parseBoundedGitHubJson(stdout, maxBytes = MAX_GITHUB_JSON_BYTES) {
  const text = String(stdout || '');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`GITHUB_RESPONSE_TOO_LARGE:${byteLength}:${maxBytes}`);
  }
  try {
    return JSON.parse(text || 'null');
  } catch (error) {
    throw new Error(`GITHUB_RESPONSE_JSON_INVALID:${error?.message || String(error)}`);
  }
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? value.map(String).filter((ref) => SAFE_PROOF_REF_PATTERN.test(ref) && !ref.includes('..')).slice(0, 20)
    : [];
}

export function createSanitizedMailboxReceiptProjection(receipt = {}) {
  const execution = receipt?.result || {};
  const operationResult = execution?.result || {};
  return Object.freeze({
    schemaVersion: String(receipt?.schemaVersion || ''),
    requestId: String(receipt?.requestId || ''),
    operation: String(receipt?.operation || ''),
    state: String(receipt?.state || ''),
    acceptedAt: String(receipt?.acceptedAt || ''),
    heartbeatAt: String(receipt?.heartbeatAt || ''),
    completedAt: String(receipt?.completedAt || ''),
    blocker: String(receipt?.blocker || operationResult?.blocker || ''),
    proofRefs: safeProofRefs(receipt?.proofRefs),
    execution: Object.freeze({
      ok: execution?.ok !== false,
      verdict: String(execution?.verdict || ''),
      operation: String(execution?.operation || receipt?.operation || ''),
      requestId: String(execution?.requestId || receipt?.requestId || ''),
    }),
    operationResult: Object.freeze({
      ok: operationResult?.ok !== false,
      blocker: String(operationResult?.blocker || ''),
      finalVerdict: String(operationResult?.finalVerdict || ''),
      sourceHead: String(operationResult?.sourceHead || ''),
      branch: String(operationResult?.branch || ''),
      expectedHeadMatch: operationResult?.expectedHeadMatch === true,
      monitorCount: Number(operationResult?.monitorCount || 0),
      executedCount: Number(operationResult?.executedCount || 0),
      unaffectedMonitorCount: Number(operationResult?.unaffectedMonitorCount || 0),
      expectedFailureCount: Number(operationResult?.expectedFailureCount || 0),
      notificationBatchCount: Number(operationResult?.notificationBatchCount || 0),
      notificationCount: Number(operationResult?.notificationCount || 0),
      notificationSurface: String(operationResult?.notificationSurface || ''),
      externalTaskSlotsRequired: Number(operationResult?.externalTaskSlotsRequired || 0),
      maxConcurrencyObserved: Number(operationResult?.maxConcurrencyObserved || 0),
      receiptCount: Number(operationResult?.receiptCount || 0),
      watchdogStartedThroughScheduledTask: operationResult?.watchdogStartedThroughScheduledTask === true,
      watchdogRecoveryRoute: String(operationResult?.watchdogRecoveryRoute || ''),
      initialHead: String(operationResult?.initialHead || ''),
      recoveredHead: String(operationResult?.recoveredHead || ''),
      initialPid: Number(operationResult?.initialPid || 0),
      recoveredPid: Number(operationResult?.recoveredPid || 0),
      workerKilled: operationResult?.workerKilled === true,
      workerKilledObserved: operationResult?.workerKilledObserved === true,
      supervisorDetectedWorkerDown: operationResult?.supervisorDetectedWorkerDown === true,
      supervisorRestartedWorker: operationResult?.supervisorRestartedWorker === true,
      workerRecovered: operationResult?.workerRecovered === true,
      workerFromMain: operationResult?.workerFromMain === true,
      proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
      publicationState: String(operationResult?.publicationState || ''),
      visiblePowerShellRequired: operationResult?.visiblePowerShellRequired === true,
      proofRefs: safeProofRefs(operationResult?.proofRefs),
    }),
    arbitraryFilesystemAccess: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    sourceMutationAllowed: false,
  });
}

export function serializeBoundedReceiptJson(receipt, maxBytes = MAX_GITHUB_RECEIPT_JSON_BYTES) {
  const fullJson = JSON.stringify(receipt, null, 2);
  const fullBytes = Buffer.byteLength(fullJson, 'utf8');
  if (fullBytes <= maxBytes) return fullJson;

  const execution = receipt?.result || {};
  const operationResult = execution?.result || {};
  const compactReceipt = {
    schemaVersion: String(receipt?.schemaVersion || ''),
    requestId: String(receipt?.requestId || ''),
    operation: String(receipt?.operation || ''),
    repository: String(receipt?.repository || ''),
    issueNumber: Number(receipt?.issueNumber || 0),
    branch: String(receipt?.branch || ''),
    state: String(receipt?.state || ''),
    acceptedAt: String(receipt?.acceptedAt || ''),
    heartbeatAt: String(receipt?.heartbeatAt || ''),
    completedAt: String(receipt?.completedAt || ''),
    blocker: String(receipt?.blocker || operationResult?.blocker || ''),
    proofRefs: safeProofRefs(receipt?.proofRefs),
    result: {
      ok: execution?.ok !== false,
      verdict: String(execution?.verdict || ''),
      operation: String(execution?.operation || receipt?.operation || ''),
      requestId: String(execution?.requestId || receipt?.requestId || ''),
      result: {
        ok: operationResult?.ok !== false,
        blocker: String(operationResult?.blocker || ''),
        finalVerdict: String(operationResult?.finalVerdict || ''),
        sourceHead: String(operationResult?.sourceHead || ''),
        branch: String(operationResult?.branch || ''),
        expectedHeadMatch: operationResult?.expectedHeadMatch === true,
        monitorCount: Number(operationResult?.monitorCount || 0),
        executedCount: Number(operationResult?.executedCount || 0),
        unaffectedMonitorCount: Number(operationResult?.unaffectedMonitorCount || 0),
        expectedFailureCount: Number(operationResult?.expectedFailureCount || 0),
        notificationBatchCount: Number(operationResult?.notificationBatchCount || 0),
        notificationCount: Number(operationResult?.notificationCount || 0),
        notificationSurface: String(operationResult?.notificationSurface || ''),
        externalTaskSlotsRequired: Number(operationResult?.externalTaskSlotsRequired || 0),
        maxConcurrencyObserved: Number(operationResult?.maxConcurrencyObserved || 0),
        receiptCount: Number(operationResult?.receiptCount || 0),
        targetRequestId: String(operationResult?.targetRequestId || ''),
        receipt: operationResult?.receipt ? createSanitizedMailboxReceiptProjection(operationResult.receipt) : null,
        initialPid: Number(operationResult?.initialPid || 0),
        recoveredPid: Number(operationResult?.recoveredPid || 0),
        workerKilledObserved: operationResult?.workerKilledObserved === true,
        supervisorDetectedWorkerDown: operationResult?.supervisorDetectedWorkerDown === true,
        supervisorRestartedWorker: operationResult?.supervisorRestartedWorker === true,
        workerRecovered: operationResult?.workerRecovered === true,
        workerFromMain: operationResult?.workerFromMain === true,
        proofWrittenToSharedWorkspace: operationResult?.proofWrittenToSharedWorkspace === true,
        visiblePowerShellRequired: operationResult?.visiblePowerShellRequired === true,
        proofRefs: safeProofRefs(operationResult?.proofRefs),
        githubProjectionTruncated: true,
        originalBytes: fullBytes,
      },
    },
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    githubProjectionTruncated: true,
  };
  const compactJson = JSON.stringify(compactReceipt, null, 2);
  if (Buffer.byteLength(compactJson, 'utf8') > maxBytes) {
    throw new Error(`GITHUB_RECEIPT_PROJECTION_TOO_LARGE:${fullBytes}:${maxBytes}`);
  }
  return compactJson;
}

function loadState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { consumedRequestIds: [] }; }
}

function saveState(state) {
  mkdirSync(mailboxStateRoot, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function writeReceipt(receipt) {
  mkdirSync(mailboxStateRoot, { recursive: true });
  mkdirSync(canonicalReceiptRoot, { recursive: true });
  const filename = `${receipt.requestId}.json`;
  const legacyPath = join(mailboxStateRoot, filename);
  const canonicalPath = join(canonicalReceiptRoot, filename);
  const payload = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(legacyPath, payload, 'utf8');
  writeFileSync(canonicalPath, payload, 'utf8');
  return {
    path: canonicalPath,
    legacyPath,
    ref: `receipts/github-command-mailbox/${filename}`,
  };
}

function ghJson(args) {
  const result = run('gh.exe', args, {
    timeout: 120000,
    preserveStdout: true,
    maxBuffer: MAX_GITHUB_JSON_BYTES,
  });
  if (!result.ok) throw new Error(result.error || result.stderr || 'gh command failed');
  return parseBoundedGitHubJson(result.stdout);
}

function postReceipt(receipt) {
  const body = [
    '<!-- stephanos-battle-bridge-command-receipt -->',
    '```json',
    serializeBoundedReceiptJson(receipt),
    '```',
  ].join('\n');
  return run('gh.exe', ['issue', 'comment', String(BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE), '--repo', BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY, '--body', body], { timeout: 120000 });
}

async function installUnattendedSync() {
  const installer = join(repoRoot, 'scripts', 'windows', 'install-battle-bridge-github-sync.ps1');
  if (!existsSync(installer)) return { ok: false, blocker: 'MERGED_SYNC_INSTALLER_MISSING', installer };
  const result = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-StartNow']);
  return { ...result, installer, fixedCommand: true, arbitraryShellAllowed: false };
}

function readCanonicalSourceIdentity(command = {}) {
  const source = run('git.exe', ['rev-parse', 'HEAD'], { timeout: 120000 });
  const branch = run('git.exe', ['branch', '--show-current'], { timeout: 120000 });
  const sourceHead = source.stdout.trim().toLowerCase();
  const branchName = branch.stdout.trim();
  if (!source.ok || !branch.ok || !/^[0-9a-f]{40}$/.test(sourceHead)) {
    return { ok: false, blocker: 'SOURCE_IDENTITY_READ_FAILED', sourceHead: '', branch: branchName || '' };
  }
  if (branchName !== 'main') {
    return { ok: false, blocker: 'SOURCE_BRANCH_NOT_MAIN', sourceHead, branch: branchName };
  }
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (expectedHead && expectedHead !== sourceHead) {
    return { ok: false, blocker: 'EXPECTED_HEAD_MISMATCH', sourceHead, expectedHead, branch: branchName };
  }
  return { ok: true, sourceHead, expectedHead, expectedHeadMatch: !expectedHead || expectedHead === sourceHead, branch: branchName };
}

async function readDeploymentStatus(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  const task = run('powershell.exe', ['-NoProfile', '-Command', "Get-ScheduledTask -TaskName 'Stephanos Battle Bridge GitHub Sync' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress"], { timeout: 120000 });
  return { ...identity, task };
}

async function readCapabilityRegistry(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  const registry = buildStephanosCapabilityRegistrySummary({
    sourceHead: identity.sourceHead,
    generatedAtUtc: new Date().toISOString(),
  });
  const validation = validateStephanosCapabilityRegistry();
  return {
    ok: validation.valid,
    blocker: validation.valid ? '' : 'CAPABILITY_REGISTRY_INVALID',
    finalVerdict: validation.finalVerdict,
    sourceHead: identity.sourceHead,
    branch: identity.branch,
    expectedHeadMatch: identity.expectedHeadMatch,
    registry,
  };
}

async function readSharedWorkspaceStatus(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  const projection = await createSanitizedSharedWorkspaceProjection({
    workspaceRoot: sharedWorkspaceRoot,
    repoRoot,
    timestampUtc: new Date().toISOString(),
  });
  const ready = projection.aggregationOk === true
    && projection.aggregationVerdict === 'SHARED_WORKSPACE_LATEST_STATUS_READY'
    && projection.currentStatus !== null;
  return {
    ok: ready,
    blocker: ready ? '' : 'SHARED_WORKSPACE_STATUS_NOT_READY',
    finalVerdict: ready ? 'SHARED_WORKSPACE_STATUS_READY' : 'SHARED_WORKSPACE_STATUS_BLOCKED',
    workspaceVerdict: projection.aggregationVerdict,
    sourceHead: identity.sourceHead,
    branch: identity.branch,
    expectedHeadMatch: identity.expectedHeadMatch,
    projection,
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

async function readMailboxReceipt(command = {}) {
  const identity = readCanonicalSourceIdentity(command);
  if (!identity.ok) return identity;
  const targetRequestId = String(command.targetRequestId || '');
  if (!SAFE_REQUEST_ID_PATTERN.test(targetRequestId)) {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_TARGET_INVALID' };
  }
  const receiptPath = join(canonicalReceiptRoot, `${targetRequestId}.json`);
  let payload;
  try {
    payload = readFileSync(receiptPath, 'utf8');
  } catch {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_NOT_FOUND', targetRequestId };
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_LOCAL_RECEIPT_BYTES) {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_TOO_LARGE', targetRequestId };
  }
  let receipt;
  try {
    receipt = JSON.parse(payload);
  } catch {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_JSON_INVALID', targetRequestId };
  }
  if (String(receipt?.requestId || '') !== targetRequestId) {
    return { ...identity, ok: false, blocker: 'MAILBOX_RECEIPT_ID_MISMATCH', targetRequestId };
  }
  return {
    ...identity,
    ok: true,
    finalVerdict: 'MAILBOX_RECEIPT_READ_READY',
    targetRequestId,
    receipt: createSanitizedMailboxReceiptProjection(receipt),
    arbitraryFilesystemAccess: false,
    commandExecutionAccess: false,
    sourceMutationAccess: false,
  };
}

export async function runBattleBridgeGitHubCommandMailbox({ now = () => new Date() } = {}) {
  if (process.platform !== 'win32') return { ok: false, blocker: 'WINDOWS_REQUIRED' };
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return { ok: false, blocker: 'CANONICAL_CHECKOUT_REQUIRED', repoRoot, expectedRepoRoot };
  }
  const comments = ghJson(['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}/comments`, '--paginate']);
  const state = loadState();
  const selected = selectNextBattleBridgeGitHubCommand(comments, {
    consumedRequestIds: new Set(state.consumedRequestIds || []),
    now: now(),
  });
  if (selected.verdict === 'NO_COMMAND_READY') return selected;
  if (!selected.ok) return selected;

  const acceptedAt = now().toISOString();
  let receipt = buildBattleBridgeGitHubCommandReceipt({ command: selected.command, state: 'ACCEPTED', acceptedAt, heartbeatAt: acceptedAt, proofRefs: [selected.commentUrl] });
  const receiptLocation = writeReceipt(receipt);
  const receiptRef = receiptLocation.ref;
  postReceipt({ ...receipt, receiptRef });

  const execution = await executeBattleBridgeGitHubCommand(selected.command, {
    updateStephanos: (command) => updateStephanosFromChat({ operatorApproval: command.operatorApproval, expectedBranch: 'main' }),
    installUnattendedSync,
    runDiagnostics: () => runBattleBridgeDiagnostics(),
    readDeploymentStatus,
    readCapabilityRegistry,
    readSharedWorkspaceStatus,
    readMailboxReceipt,
    runWorkerWatchdogAcceptance: (command) => runBattleBridgeWorkerWatchdogAcceptance({ expectedHead: command.expectedHead }),
    runMonitorMultiplexerAcceptance: (command) => runBattleBridgeMonitorMultiplexerCanary({ expectedHead: command.expectedHead, requestId: command.requestId }),
  });

  const completedAt = now().toISOString();
  receipt = buildBattleBridgeGitHubCommandReceipt({
    command: selected.command,
    state: execution.ok ? 'DONE' : 'BLOCKED',
    acceptedAt,
    heartbeatAt: completedAt,
    completedAt,
    result: execution,
    blocker: execution.blocker || execution.result?.blocker || '',
    proofRefs: [selected.commentUrl, receiptRef],
  });
  writeReceipt(receipt);
  state.consumedRequestIds = [...new Set([...(state.consumedRequestIds || []), selected.command.requestId])].slice(-500);
  state.lastReceipt = receipt;
  saveState(state);
  postReceipt({ ...receipt, receiptRef });
  return { ...receipt, receiptPath: receiptLocation.path, receiptRef };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBattleBridgeGitHubCommandMailbox()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result?.ok === false ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
