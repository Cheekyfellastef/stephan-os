import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const SOVEREIGN_COMMANDER_REMOTE_OPERATION = 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION';
export const SOVEREIGN_COMMANDER_REMOTE_ACTIONS = Object.freeze([
  'status',
  'battle-bridge-status',
  'repair-ui-4173',
  'restart-stephanos-runtime',
  'status-recovery-mesh',
  'status-worker-watchdog',
  'qwen35-canary',
  'ignite-stephanos',
  'repair-battle-bridge',
  'repair-control-plane',
  'goal-discovery-heartbeat',
  'start-mission-orchestrator-worker',
  'status-mission-orchestrator-worker',
  'start-stephanos-backend',
  'status-stephanos-backend',
  'status-openclaw-whatsapp',
  'repair-openclaw-ignite',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PROOF_HASH_PATTERN = /^[0-9a-f]{64}$/i;
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
  'remoteAction',
]);
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL_VERSION = '2025-11-25';

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'GitHub', 'stephan-os');
}

function fixedTokenPath(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 30_000,
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

function safeMaintenanceProjection(value = {}) {
  const proofHash = text(value?.proofHash).toLowerCase();
  const processId = text(value?.command?.plan?.processId);
  const status = Number(value?.structuredContent?.status);
  const errorCode = text(value?.structuredContent?.errorCode);
  return Object.freeze({
    ok: value?.ok === true,
    finalVerdict: text(value?.finalVerdict),
    proofHash: PROOF_HASH_PATTERN.test(proofHash) ? proofHash : '',
    processId: /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(processId) ? processId : '',
    status: Number.isInteger(status) ? status : null,
    errorCode: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(errorCode) ? errorCode : '',
  });
}

function isBoundedCommanderConfig(config = {}) {
  return config?.implementation === 'stephanos-local-node'
    && config?.vendorMeterRequired === false
    && config?.externalSaasRelayRequired === false
    && config?.sourceControlledMaintenanceOnly === true
    && config?.arbitraryUnboundedCommandAllowed === false
    && config?.mergeAuthority === false
    && config?.pcRestartAuthority === false
    && config?.canRunFocusedNodeTests === false;
}

export function validateSovereignCommanderRemoteCommandShape(command = {}) {
  if (text(command?.operation) !== SOVEREIGN_COMMANDER_REMOTE_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  const remoteAction = text(command?.remoteAction);
  if (!SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(remoteAction)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', {
      requested: true,
      remoteAction,
    });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead, remoteAction }),
  });
}

export function isTerminalizableSovereignCommanderRemoteBlocker(value) {
  return new Set([
    'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED',
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED',
  ]).has(text(value));
}

export async function executeSovereignCommanderRemoteOnBattleBridge(command = {}, options = {}) {
  const shape = validateSovereignCommanderRemoteCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  const tokenPath = fixedTokenPath(env);
  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const readFileFn = typeof options?.readFileFn === 'function' ? options.readFileFn : readFile;
  const fetchFn = typeof options?.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok) return fail('SOVEREIGN_COMMANDER_REMOTE_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('SOVEREIGN_COMMANDER_REMOTE_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH', {
      expectedHead: shape.expectedHead,
      observedHead,
    });
  }

  let health;
  try {
    const response = await fetchFn(HEALTH_URL, { method: 'GET' });
    health = response.ok ? await response.json() : null;
  } catch {
    health = null;
  }
  if (health?.ok !== true || health?.service !== 'stephanos-sovereign-commander') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEALTH_REQUIRED');
  }

  let token = '';
  try { token = text(await readFileFn(tokenPath, 'utf8')); } catch {}
  if (token.length < 32) return fail('SOVEREIGN_COMMANDER_REMOTE_TOKEN_UNAVAILABLE');

  const initialize = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'battle-bridge-mobile-ingress', version: '1.0.0' },
      capabilities: {},
    },
  });
  const sessionId = initialize.sessionId;
  if (!initialize.ok || !sessionId) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZE_FAILED', { status: initialize.status });
  }

  const initialized = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, sessionId);
  if (!initialized.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZED_FAILED', { status: initialized.status });
  }

  const listed = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  const tools = Array.isArray(listed.body?.result?.tools)
    ? listed.body.result.tools.map((tool) => text(tool?.name))
    : [];
  if (!listed.ok || !tools.includes('get_config') || !tools.includes('maintenance_action')) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_TOOL_SURFACE_INVALID');
  }

  const configCall = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_config', arguments: {} },
  }, sessionId);
  const configMcpResult = configCall.body?.result || {};
  const configReceipt = configMcpResult?.structuredContent || {};
  const config = configReceipt?.structuredContent && typeof configReceipt.structuredContent === 'object'
    ? configReceipt.structuredContent
    : configReceipt;
  const configReceiptComplete = configCall.ok
    && configMcpResult?.isError !== true
    && configReceipt?.ok === true
    && configReceipt?.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';
  if (!configReceiptComplete || !isBoundedCommanderConfig(config)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  }

  if (shape.command.remoteAction === 'status') {
    const statusResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE',
      remoteAction: 'status',
      sourceHead: shape.expectedHead,
      healthReady: true,
      authenticatedMcpReady: true,
      implementation: 'stephanos-local-node',
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...statusResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: statusResult,
    });
  }

  const actionCall = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'maintenance_action',
      arguments: { actionId: shape.command.remoteAction },
    },
  }, sessionId);
  if (!actionCall.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', { status: actionCall.status });
  }
  const projection = safeMaintenanceProjection(actionCall.body?.result?.structuredContent || {});
  const proofComplete = projection.ok === true
    && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
    && PROOF_HASH_PATTERN.test(projection.proofHash)
    && projection.processId === shape.command.remoteAction
    && projection.status === 0;
  if (!proofComplete) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID', {
      remoteAction: shape.command.remoteAction,
      proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
      processIdMatch: projection.processId === shape.command.remoteAction,
      successfulStatus: projection.status === 0,
    });
  }

  const maintenanceResult = Object.freeze({
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
    remoteAction: shape.command.remoteAction,
    sourceHead: shape.expectedHead,
    proofHash: projection.proofHash,
    processId: projection.processId,
    status: projection.status,
    errorCode: projection.errorCode,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
  return Object.freeze({
    ...maintenanceResult,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    requestId: text(shape.command.requestId),
    maintenance: projection,
    result: maintenanceResult,
  });
}
