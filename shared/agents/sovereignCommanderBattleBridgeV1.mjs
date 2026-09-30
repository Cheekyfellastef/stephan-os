import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from '../../scripts/battle-bridge-github-sync-policy.mjs';

export const SOVEREIGN_COMMANDER_INSTALL_OPERATION = 'INSTALL_AND_PROVE_SOVEREIGN_COMMANDER';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const SCHTASKS = 'C:\\Windows\\System32\\schtasks.exe';
const TIMEOUT_MS = 90_000;
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL_VERSION = '2025-11-25';

function text(value) {
  return String(value ?? '').trim();
}

function splitLines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE);
  return profile ? resolve(profile, 'Documents', 'GitHub', 'stephan-os') : '';
}

function fixedTokenPath(env = process.env) {
  const profile = text(env.USERPROFILE);
  return profile
    ? resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt')
    : '';
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || TIMEOUT_MS,
    maxBuffer: 256 * 1024,
    ...options,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

function parseJsonOutput(stdout = '') {
  const raw = String(stdout || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {}
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

async function waitForHealth(fetchFn, { attempts = 20, delayMs = 500 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchFn(HEALTH_URL, { method: 'GET' });
      if (response.ok) {
        const body = await response.json();
        if (body?.ok === true
          && body?.service === 'stephanos-sovereign-commander'
          && body?.vendorMeterRequired === false
          && body?.externalSaasRelayRequired === false) {
          return Object.freeze({ ok: true, attempt, body });
        }
      }
    } catch {}
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  }
  return fail('SOVEREIGN_COMMANDER_HEALTH_NOT_READY');
}

async function postMcp(fetchFn, token, message, sessionId = '') {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetchFn(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const bodyText = await response.text();
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch {}
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    sessionId: text(response.headers?.get?.('mcp-session-id')),
    body,
  });
}

export function validateSovereignCommanderInstallCommandShape(command = {}) {
  if (text(command?.operation) !== SOVEREIGN_COMMANDER_INSTALL_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SOVEREIGN_COMMANDER_INSTALL_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('SOVEREIGN_COMMANDER_INSTALL_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead }),
  });
}

export function isTerminalizableSovereignCommanderInstallBlocker(value) {
  return new Set([
    'SOVEREIGN_COMMANDER_INSTALL_FIELD_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_INSTALL_EXPECTED_HEAD_REQUIRED',
  ]).has(text(value));
}

export async function executeSovereignCommanderInstallOnBattleBridge(command = {}, options = {}) {
  const shape = validateSovereignCommanderInstallCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  const tokenPath = fixedTokenPath(env);
  if (!repositoryRoot || !tokenPath) return fail('SOVEREIGN_COMMANDER_USERPROFILE_REQUIRED');

  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const fetchFn = typeof options?.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;
  const readFileFn = typeof options?.readFileFn === 'function' ? options.readFileFn : readFile;

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const dirt = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok || !dirt.ok) return fail('SOVEREIGN_COMMANDER_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('SOVEREIGN_COMMANDER_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('SOVEREIGN_COMMANDER_HEAD_MISMATCH', { expectedHead: shape.expectedHead, observedHead });
  }
  const dirtClassification = classifyDirt(splitLines(dirt.stdout));
  const dirtSummary = Object.freeze({
    trackedSourceCount: dirtClassification.trackedSource.length,
    untrackedSourceCount: dirtClassification.untrackedSource.length,
    runtimeOnlyCount: dirtClassification.runtimeOnly.length,
    generatedSourceCount: dirtClassification.generatedSource.length,
    unknownCount: dirtClassification.unknown.length,
    blocksSync: dirtClassification.blocksSync === true,
  });
  if (dirtClassification.blocksSync) return fail('SOVEREIGN_COMMANDER_SOURCE_DIRT_BLOCKED', { dirtSummary });

  const preHealth = await waitForHealth(fetchFn, { attempts: 1, delayMs: 0 });
  const taskQuery = run(spawnSyncFn, SCHTASKS, [
    '/Query',
    '/TN', 'Stephanos Sovereign Commander',
    '/FO', 'LIST',
  ], { timeout: 15_000 });
  const taskAlreadyInstalled = taskQuery.ok;
  let installerRun = false;
  let receipt = null;

  // An existing scheduled task may be stale or half-installed. If runtime health is absent,
  // re-run the idempotent installer so it can repair the task, token and ACL before retrying.
  if (!taskAlreadyInstalled || !preHealth.ok) {
    const installer = resolve(repositoryRoot, 'scripts', 'windows', 'install-sovereign-commander.ps1');
    const install = run(spawnSyncFn, POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', installer,
      '-StartNow',
    ]);
    installerRun = true;
    if (!install.ok) {
      return fail('SOVEREIGN_COMMANDER_INSTALL_FAILED', {
        status: install.status,
        stderr: text(install.stderr).slice(0, 500),
      });
    }
    receipt = parseJsonOutput(install.stdout);
    if (!receipt
      || receipt.finalVerdict !== 'SOVEREIGN_COMMANDER_TASK_INSTALLED'
      || receipt.installed !== true
      || receipt.startedNow !== true
      || receipt.vendorMeterRequired !== false
      || receipt.externalSaasRelayRequired !== false
      || receipt.arbitraryShellAllowed !== false
      || receipt.pcRestartAllowed !== false) {
      return fail('SOVEREIGN_COMMANDER_INSTALL_RECEIPT_INVALID');
    }
  }

  if (!preHealth.ok) {
    const runner = resolve(repositoryRoot, 'scripts', 'windows', 'run-sovereign-commander-hidden.ps1');
    const runnerStart = run(spawnSyncFn, POWERSHELL, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', runner,
    ], { timeout: 30_000 });
    const runnerReceipt = parseJsonOutput(runnerStart.stdout);
    if (!runnerStart.ok && runnerReceipt?.healthy !== true) {
      return fail('SOVEREIGN_COMMANDER_WATCHDOG_START_FAILED', {
        watchdogBlocker: text(runnerReceipt?.blocker),
        watchdogHealthy: runnerReceipt?.healthy === true,
        watchdogStartRequested: runnerReceipt?.startRequested === true,
        watchdogAfterProcessCount: Number(runnerReceipt?.afterProcessCount || 0),
        watchdogStatus: runnerStart.status,
        watchdogStderr: text(runnerStart.stderr).slice(0, 300),
        taskAlreadyInstalled,
        installerRun,
      });
    }
  }

  const health = await waitForHealth(fetchFn, {
    attempts: Number.isSafeInteger(options?.healthAttempts) ? options.healthAttempts : 20,
    delayMs: Number.isSafeInteger(options?.healthDelayMs) ? options.healthDelayMs : 500,
  });
  if (!health.ok) {
    return fail('SOVEREIGN_COMMANDER_HEALTH_NOT_READY', {
      taskAlreadyInstalled,
      installerRun,
    });
  }

  let token = '';
  try { token = text(await readFileFn(tokenPath, 'utf8')); } catch {}
  if (token.length < 32) return fail('SOVEREIGN_COMMANDER_TOKEN_UNAVAILABLE');

  const initialize = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'battle-bridge-bootstrap', version: '1.0.0' },
      capabilities: {},
    },
  });
  const sessionId = initialize.sessionId;
  if (!initialize.ok || !sessionId || initialize.body?.result?.protocolVersion !== PROTOCOL_VERSION) {
    return fail('SOVEREIGN_COMMANDER_MCP_INITIALIZE_FAILED', { status: initialize.status });
  }

  const initialized = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, sessionId);
  if (!initialized.ok) return fail('SOVEREIGN_COMMANDER_MCP_INITIALIZED_FAILED', { status: initialized.status });

  const listed = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  const tools = Array.isArray(listed.body?.result?.tools) ? listed.body.result.tools.map((tool) => text(tool?.name)) : [];
  if (!listed.ok || !tools.includes('get_config') || !tools.includes('maintenance_action') || tools.includes('run_node_test')) {
    return fail('SOVEREIGN_COMMANDER_TOOL_SURFACE_INVALID', { tools });
  }

  const configCall = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_config', arguments: {} },
  }, sessionId);
  const config = configCall.body?.result?.structuredContent || {};
  if (!configCall.ok
    || config?.implementation !== 'stephanos-local-node'
    || config?.vendorMeterRequired !== false
    || config?.externalSaasRelayRequired !== false
    || config?.arbitraryUnboundedCommandAllowed !== false
    || config?.mergeAuthority !== false
    || config?.pcRestartAuthority !== false
    || config?.canRunFocusedNodeTests !== false
    || config?.sourceControlledMaintenanceOnly !== true) {
    return fail('SOVEREIGN_COMMANDER_AUTHENTICATED_CONFIG_PROOF_FAILED');
  }

  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: SOVEREIGN_COMMANDER_INSTALL_OPERATION,
    requestId: text(command.requestId),
    finalVerdict: 'SOVEREIGN_COMMANDER_INSTALLED_STARTED_AND_AUTHENTICATED',
    sourceHead: shape.expectedHead,
    expectedHead: shape.expectedHead,
    expectedHeadMatch: true,
    healthReady: true,
    authenticatedMcpReady: true,
    negotiatedProtocolVersion: PROTOCOL_VERSION,
    tools: Object.freeze(tools),
    taskName: text(receipt?.taskName || 'Stephanos Sovereign Commander'),
    startedNow: receipt?.startedNow === true || preHealth.ok !== true,
    hidden: receipt ? receipt.hidden === true : true,
    intervalMinutes: Number(receipt?.intervalMinutes || 1),
    taskAlreadyInstalled,
    installerRun,
    dirtSummary,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    arbitraryCommandAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    credentialExported: false,
  });
}
