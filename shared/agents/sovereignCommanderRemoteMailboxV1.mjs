import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const SOVEREIGN_COMMANDER_REMOTE_OPERATION = 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION';
export const SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS = 6;
export const SOVEREIGN_COMMANDER_REMOTE_ACTIONS = Object.freeze([
  'status',
  'search-project',
  'battle-bridge-status',
  'repair-ui-4173',
  'restart-stephanos-runtime',
  'status-recovery-mesh',
  'status-worker-watchdog',
  'qwen35-canary',
  'vr-resource-governor',
  'gaming-resource-status',
  'gaming-resource-prepare',
  'gaming-resource-auto',
  'gaming-resource-force-on',
  'gaming-resource-force-off',
  'gaming-resource-acceptance',
  'vr-virtual-airlink-acceptance',
  'starfield-vr-performance-diagnosis',
  'report-starfield-vr-telemetry',
  'starfield-vr-telemetry-refresh',
  'ignite-stephanos',
  'repair-battle-bridge',
  'repair-control-plane',
  'goal-discovery-heartbeat',
  'fleet-goal-supervisor',
  'start-mission-orchestrator-worker',
  'status-mission-orchestrator-worker',
  'start-stephanos-backend',
  'status-stephanos-backend',
  'status-openclaw-whatsapp',
  'repair-openclaw-ignite',
  'repair-openclaw-standalone',
  'repair-openclaw-local',
  'repair-goal-builder-flow',
  'reconcile-remote-commander-parity',
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
  'remotePlan',
  'searchQuery',
  'searchMaxResults',
]);
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL_VERSION = '2025-11-25';
const REMOTE_SEARCH_QUERY = /^[A-Za-z0-9_.:/#@() +\-]{1,160}$/;

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function sovereignCommanderCompletionEnvelope(call = {}) {
  const result = call?.body?.result;
  if (result?.isError === true) return {};
  let candidate = result?.structuredContent;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const proofHash = text(candidate.proofHash).toLowerCase();
    if (
      candidate.ok === true
      && candidate.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(proofHash)
    ) {
      return candidate;
    }
    candidate = candidate.structuredContent;
  }
  return {};
}

function mcpStructuredPayload(call = {}) {
  const envelope = sovereignCommanderCompletionEnvelope(call);
  const nested = envelope?.structuredContent;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return {};
  return nested;
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

function safeProjectSearchProjection(value = {}, query = '') {
  const results = Array.isArray(value?.results) ? value.results : [];
  const safeResults = results.slice(0, 30).flatMap((entry) => {
    const relativePath = text(entry?.relativePath).replaceAll('\\', '/');
    const line = Number(entry?.line);
    const column = Number(entry?.column);
    if (!relativePath
      || relativePath.startsWith('/')
      || relativePath.includes('..')
      || /^[A-Za-z]:/.test(relativePath)
      || relativePath.length > 240
      || !Number.isSafeInteger(line) || line < 1
      || !Number.isSafeInteger(column) || column < 1) return [];
    return [Object.freeze({ relativePath, line, column })];
  });
  return Object.freeze({
    queryHash: createHash('sha256').update(String(query)).digest('hex'),
    resultCount: safeResults.length,
    truncated: value?.truncated === true || results.length > safeResults.length,
    results: Object.freeze(safeResults),
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
  const remotePlanFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'remotePlan');
  const remotePlanSupplied = Array.isArray(command?.remotePlan);
  if (remotePlanFieldPresent && !remotePlanSupplied) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID', { requested: true });
  }
  if (remoteAction && remotePlanFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT', { requested: true });
  }
  if (remotePlanSupplied) {
    const remotePlan = command.remotePlan.map((value) => text(value));
    if (remotePlan.length < 1 || remotePlan.length > SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID', {
        requested: true,
        stepCount: remotePlan.length,
      });
    }
    const invalidAction = remotePlan.find((actionId) => (
      actionId === 'status'
      || actionId === 'search-project'
      || !SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(actionId)
    ));
    if (invalidAction) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED', {
        requested: true,
        remoteAction: invalidAction,
      });
    }
    if (new Set(remotePlan).size !== remotePlan.length) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction: '',
        remotePlan: Object.freeze(remotePlan),
      }),
    });
  }
  if (!SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(remoteAction)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', {
      requested: true,
      remoteAction,
    });
  }
  const searchFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'searchQuery')
    || Object.prototype.hasOwnProperty.call(command || {}, 'searchMaxResults');
  if (remoteAction === 'search-project') {
    const searchQuery = text(command?.searchQuery);
    const searchMaxResults = Number(command?.searchMaxResults ?? 20);
    if (!REMOTE_SEARCH_QUERY.test(searchQuery)) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID', { requested: true });
    }
    if (!Number.isSafeInteger(searchMaxResults) || searchMaxResults < 1 || searchMaxResults > 30) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({ ...command, expectedHead, remoteAction, searchQuery, searchMaxResults }),
    });
  }
  if (searchFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED', { requested: true });
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
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED',
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
  if (!listed.ok
    || !tools.includes('get_config')
    || !tools.includes('maintenance_action')
    || (shape.command.remoteAction === 'search-project' && !tools.includes('search_project'))) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_TOOL_SURFACE_INVALID');
  }

  const configCall = await postMcp(fetchFn, token, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_config', arguments: {} },
  }, sessionId);
  const config = mcpStructuredPayload(configCall);
  if (!configCall.ok || !isBoundedCommanderConfig(config)) {
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

  if (shape.command.remoteAction === 'search-project') {
    const searchCall = await postMcp(fetchFn, token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_project',
        arguments: {
          query: shape.command.searchQuery,
          maxResults: shape.command.searchMaxResults,
        },
      },
    }, sessionId);
    const completion = sovereignCommanderCompletionEnvelope(searchCall);
    const rawSearch = completion?.structuredContent;
    if (!searchCall.ok
      || completion?.ok !== true
      || completion?.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(text(completion?.proofHash))) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FAILED', {
        status: searchCall.status,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const projection = safeProjectSearchProjection(rawSearch, shape.command.searchQuery);
    const searchResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE',
      remoteAction: 'search-project',
      sourceHead: shape.expectedHead,
      proofHash: text(completion.proofHash).toLowerCase(),
      queryHash: projection.queryHash,
      resultCount: projection.resultCount,
      truncated: projection.truncated,
      results: projection.results,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      fileContentsReturned: false,
    });
    return Object.freeze({
      ...searchResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: searchResult,
    });
  }

  if (Array.isArray(shape.command.remotePlan)) {
    const completedSteps = [];
    for (let index = 0; index < shape.command.remotePlan.length; index += 1) {
      const actionId = shape.command.remotePlan[index];
      const actionCall = await postMcp(fetchFn, token, {
        jsonrpc: '2.0',
        id: 4 + index,
        method: 'tools/call',
        params: {
          name: 'maintenance_action',
          arguments: { actionId },
        },
      }, sessionId);
      if (!actionCall.ok) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          status: actionCall.status,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const projection = safeMaintenanceProjection(sovereignCommanderCompletionEnvelope(actionCall));
      const proofComplete = projection.ok === true
        && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
        && PROOF_HASH_PATTERN.test(projection.proofHash)
        && projection.processId === actionId
        && projection.status === 0;
      if (!proofComplete) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
          processIdMatch: projection.processId === actionId,
          successfulStatus: projection.status === 0,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      completedSteps.push(Object.freeze({
        stepIndex: index,
        remoteAction: actionId,
        proofHash: projection.proofHash,
        processId: projection.processId,
        status: projection.status,
        errorCode: projection.errorCode,
      }));
    }

    const planProofHash = createHash('sha256').update(JSON.stringify({
      requestId: text(shape.command.requestId),
      sourceHead: shape.expectedHead,
      remotePlan: shape.command.remotePlan,
      completedSteps: completedSteps.map((step) => ({
        stepIndex: step.stepIndex,
        remoteAction: step.remoteAction,
        proofHash: step.proofHash,
        processId: step.processId,
        status: step.status,
      })),
    })).digest('hex');
    const planResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE',
      remotePlan: shape.command.remotePlan,
      stepCount: completedSteps.length,
      completedSteps: Object.freeze(completedSteps),
      planProofHash,
      sourceHead: shape.expectedHead,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...planResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: planResult,
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
  const projection = safeMaintenanceProjection(sovereignCommanderCompletionEnvelope(actionCall));
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
