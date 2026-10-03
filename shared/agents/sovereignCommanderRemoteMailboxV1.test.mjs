import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOVEREIGN_COMMANDER_REMOTE_OPERATION,
  SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS,
  executeSovereignCommanderRemoteOnBattleBridge,
  validateSovereignCommanderRemoteCommandShape,
} from './sovereignCommanderRemoteMailboxV1.mjs';

const HEAD = 'e42d31670da802cc15d4c323dd8dcff10a03033f';

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'sovereign-mobile-1001',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2590,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-10-01T12:00:00.000Z',
    remoteAction: 'status',
    ...overrides,
  };
}

function spawnForHead(head = HEAD) {
  return (_executable, args) => {
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${head}\n`, stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
}

function response(body, { status = 200, sessionId = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId : '' },
    json: async () => body,
    text: async () => body === null || body === undefined ? '' : JSON.stringify(body),
  };
}

function mcpFetch({ maintenance = null, maintenanceByAction = {}, config = null, configReceipt = null, configIsError = false } = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) {
      return response({
        ok: true,
        service: 'stephanos-sovereign-commander',
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
      });
    }
    const message = JSON.parse(options.body || '{}');
    if (message.method === 'initialize') {
      return response({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }, { sessionId: 'session-1' });
    }
    if (message.method === 'notifications/initialized') return response(null, { status: 202, sessionId: 'session-1' });
    if (message.method === 'tools/list') {
      return response({
        jsonrpc: '2.0',
        id: 2,
        result: { tools: [{ name: 'get_config' }, { name: 'maintenance_action' }, { name: 'search_project' }] },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'get_config') {
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          isError: configIsError,
          structuredContent: configReceipt || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'c'.repeat(64),
            structuredContent: config || {
              implementation: 'stephanos-local-node',
              vendorMeterRequired: false,
              externalSaasRelayRequired: false,
              sourceControlledMaintenanceOnly: true,
              arbitraryUnboundedCommandAllowed: false,
              mergeAuthority: false,
              pcRestartAuthority: false,
              canRunFocusedNodeTests: false,
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'search_project') {
      return response({
        jsonrpc: '2.0',
        id: 4,
        result: {
          structuredContent: {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'd'.repeat(64),
            contentText: 'PRIVATE SEARCH PREVIEW MUST NOT ESCAPE',
            structuredContent: {
              resultCount: 2,
              truncated: false,
              results: [
                { relativePath: 'shared/agents/sovereignCommanderV1.mjs', line: 42, column: 7, preview: 'PRIVATE PREVIEW' },
                { relativePath: 'scripts/sovereign-commander-mcp.mjs', line: 88, column: 3, preview: 'PRIVATE PREVIEW 2' },
              ],
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    if (message.method === 'tools/call' && message.params?.name === 'maintenance_action') {
      const actionId = message.params.arguments.actionId;
      const selectedMaintenance = maintenanceByAction[actionId] || maintenance;
      return response({
        jsonrpc: '2.0',
        id: 3,
        result: {
          structuredContent: selectedMaintenance || {
            ok: true,
            finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
            proofHash: 'a'.repeat(64),
            command: { plan: { processId: actionId } },
            contentText: 'SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE',
            structuredContent: {
              ok: true,
              status: 0,
              stdout: 'PRIVATE RAW STDOUT',
              stderr: '',
              errorCode: '',
            },
          },
        },
      }, { sessionId: 'session-1' });
    }
    return response({ error: 'unexpected' }, { status: 500 });
  };
  return { calls, fetchFn };
}

const readToken = async () => 'x'.repeat(44);

test('mobile command shape is closed-world and action allowlisted', () => {
  assert.equal(validateSovereignCommanderRemoteCommandShape(command()).ok, true);
  for (const [field, value] of [
    ['path', 'C:\\secret.txt'],
    ['content', 'secret'],
    ['token', 'secret'],
    ['args', ['whoami']],
    ['command', 'powershell.exe'],
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', field);
  }
  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: 'run-any-shell' }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED');
});


test('remote repair delegation exposes the bounded local repair/orchestration registry without arbitrary shell', () => {
  for (const remoteAction of [
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
    'reconcile-remote-commander-parity',
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, true, remoteAction);
  }
  for (const remoteAction of ['run-any-shell', 'powershell', 'cmd', 'restart-pc', 'merge-main']) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction }));
    assert.equal(result.ok, false, remoteAction);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', remoteAction);
  }
});

test('remote project search accepts only bounded public-safe literal queries', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'search-project',
    searchQuery: 'Sovereign Commander',
    searchMaxResults: 12,
  }));
  assert.equal(valid.ok, true);
  assert.equal(valid.command.searchQuery, 'Sovereign Commander');
  assert.equal(valid.command.searchMaxResults, 12);

  const unsafe = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'search-project',
    searchQuery: 'TOKEN=secret',
  }));
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.blocker, 'SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID');

  const stray = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'status',
    searchQuery: 'Sovereign',
  }));
  assert.equal(stray.ok, false);
  assert.equal(stray.blocker, 'SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED');
});

test('remote plan is bounded to unique admitted maintenance actions', () => {
  const valid = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
  }));
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.command.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(valid.command.remoteAction, '');

  const conflict = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: 'battle-bridge-status',
    remotePlan: ['repair-control-plane'],
  }));
  assert.equal(conflict.ok, false);
  assert.equal(conflict.blocker, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT');

  for (const remotePlan of ['repair-control-plane', { actionId: 'repair-control-plane' }, null]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID');
  }

  for (const remotePlan of [
    [],
    Array.from({ length: SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS + 1 }, (_, index) => index % 2 ? 'repair-ui-4173' : 'battle-bridge-status'),
  ]) {
    const result = validateSovereignCommanderRemoteCommandShape(command({ remoteAction: '', remotePlan }));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID');
  }

  const statusInPlan = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['status'],
  }));
  assert.equal(statusInPlan.ok, false);
  assert.equal(statusInPlan.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const arbitrary = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['repair-control-plane', 'run-any-shell'],
  }));
  assert.equal(arbitrary.ok, false);
  assert.equal(arbitrary.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');

  const duplicate = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-status', 'battle-bridge-status'],
  }));
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION');
});

test('remote plan executes admitted actions in order and returns only bounded proof', async () => {
  const { calls, fetchFn } = mcpFetch();
  const remotePlan = ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'];
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: '', remotePlan }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE');
  assert.equal(result.stepCount, 3);
  assert.match(result.planProofHash, /^[0-9a-f]{64}$/);
  assert.equal(result.result.planProofHash, result.planProofHash);
  assert.deepEqual(result.remotePlan, remotePlan);
  assert.deepEqual(result.completedSteps.map((step) => step.remoteAction), remotePlan);
  assert.equal(result.completedSteps.every((step) => step.status === 0), true);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), remotePlan);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('remote plan stops at first invalid maintenance receipt', async () => {
  const badReceipt = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    proofHash: 'b'.repeat(64),
    command: { plan: { processId: 'repair-control-plane' } },
    structuredContent: { ok: false, status: 1, errorCode: 'FAILED' },
  };
  const { calls, fetchFn } = mcpFetch({
    maintenanceByAction: { 'repair-control-plane': badReceipt },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: '',
      remotePlan: ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'],
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID');
  assert.equal(result.stepIndex, 1);
  assert.equal(result.remoteAction, 'repair-control-plane');
  assert.equal(result.completedSteps.length, 1);
  assert.equal(result.stepCount, 1);
  assert.deepEqual(result.remotePlan, ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos']);
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.deepEqual(maintenanceCalls.map((message) => message.params.arguments.actionId), [
    'battle-bridge-status',
    'repair-control-plane',
  ]);
});

test('status route proves authenticated local commander without returning secrets', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(command(), {
    spawnSyncFn: spawnForHead(),
    readFileFn: readToken,
    fetchFn,
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
  assert.equal(result.vendorMeterRequired, false);
  assert.equal(result.arbitraryUnboundedCommandAllowed, false);
  assert.equal(result.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE');
  assert.equal(result.result.remoteAction, 'status');
  assert.equal(JSON.stringify(result).includes('x'.repeat(20)), false);
});

test('remote project search returns path and location proof without file contents', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({
      remoteAction: 'search-project',
      searchQuery: 'Sovereign Commander',
      searchMaxResults: 12,
    }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE');
  assert.equal(result.resultCount, 2);
  assert.match(result.queryHash, /^[0-9a-f]{64}$/);
  assert.equal(result.results[0].relativePath, 'shared/agents/sovereignCommanderV1.mjs');
  assert.equal(result.fileContentsReturned, false);
  assert.equal(result.publicReceiptSafe, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE PREVIEW'), false);
  assert.equal(serialized.includes('PRIVATE SEARCH PREVIEW'), false);
  assert.equal(serialized.includes('Sovereign Commander'), false);
  const searchCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'search_project');
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].params.arguments.query, 'Sovereign Commander');
  assert.equal(searchCalls[0].params.arguments.maxResults, 12);
});

test('maintenance route publishes only sanitised proof metadata', async () => {
  const { fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.maintenance.proofHash, 'a'.repeat(64));
  assert.equal(result.maintenance.processId, 'battle-bridge-status');
  assert.equal(result.maintenance.status, 0);
  assert.equal(result.result.remoteAction, 'battle-bridge-status');
  assert.equal(result.result.proofHash, 'a'.repeat(64));
  assert.equal(result.result.processId, 'battle-bridge-status');
  assert.equal(result.result.status, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});



test('Starfield VR telemetry refresh returns bounded headline instead of generic invalid receipt', async () => {
  const telemetryPayload = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-02T20:15:00.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED',
    sessionId: 'starfield-vr-performance-test',
    headline: {
      focus: 'VRAM_PRESSURE',
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      launchSessionId: 'launch-1',
      sourceHead: HEAD,
      telemetrySessionId: 'starfield-vr-performance-test',
      signals: ['vram-pressure-high'],
      sessionOutcome: 'COMPLETED',
      partialTelemetry: false,
      crashEvidenceCount: 0,
      sampleCount: 100,
      avgGpuUtilPct: 79.4,
      maxGpuUtilPct: 100,
      maxGpuMemoryPct: 98.4,
      avgStarfieldCpuPct: 11.2,
      avgSystemCpuPct: 42.3,
      maxLlamaServerCount: 1,
      airLinkRuntimeSamplePct: 100,
      minGameDriveFreeGiB: 321.5,
      minGameDriveFreePct: 18.2,
      avgGameDriveActivePct: 14.6,
      maxGameDriveLatencyMs: 8.2,
      maxGameDriveQueueLength: 1.3,
      maxPagesPerSec: 2,
      storageTelemetryAvailable: true,
      topRecommendation: 'Lower one bounded render-scale step',
      topRecommendationSource: 'VR Research Lab',
      projectLoopState: 'READY',
      projectTelemetryGapCount: 2,
      projectNextExperiment: 'Repeat same-save lateral-motion segment',
    },
    history: { sessionCount: 5, newestSessionId: 'starfield-vr-performance-test' },
    publication: { packet: true, history: true, loop: true, event: true },
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: true,
    sharedWorkspacePublished: true,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '9'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    contentText: 'PRIVATE VERBOSE TELEMETRY MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=' + JSON.stringify(telemetryPayload) + '\n{VERY LARGE PRIVATE TELEMETRY BODY}',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_COMPLETE');
  assert.equal(result.telemetry.headline.focus, 'VRAM_PRESSURE');
  assert.equal(result.telemetry.headline.provider, 'mutar-openxr');
  assert.equal(result.telemetry.headline.sampleCount, 100);
  assert.equal(result.telemetry.headline.maxGpuMemoryPct, 98.4);
  assert.equal(result.telemetry.headline.airLinkRuntimeSamplePct, 100);
  assert.equal(result.telemetry.history.sessionCount, 5);
  assert.equal(result.telemetry.sharedWorkspacePublished, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('VERY LARGE PRIVATE TELEMETRY BODY'), false);
  assert.equal(serialized.includes('PRIVATE VERBOSE TELEMETRY'), false);
});

test('Starfield VR telemetry refresh returns honest degraded receipt when primary telemetry is published', async () => {
  const telemetryPayload = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-02T20:59:44.363Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
    sessionId: 'starfield-vr-performance-20261002-014019-238',
    headline: {
      focus: '',
      provider: 'UNKNOWN',
      providerIdentityStatus: 'UNKNOWN_PROVIDER',
      sourceHead: '',
      telemetrySessionId: 'starfield-vr-performance-20261002-014019-238',
      signals: [],
      sessionOutcome: 'CRASHED',
      partialTelemetry: true,
      crashEvidenceCount: 2,
      sampleCount: 73,
      avgGpuUtilPct: 71.4,
      maxGpuUtilPct: 100,
      maxGpuMemoryPct: 98.3,
      avgStarfieldCpuPct: 25.3,
      avgSystemCpuPct: 70.9,
      maxLlamaServerCount: 1,
      airLinkRuntimeSamplePct: 100,
      minGameDriveFreeGiB: 190.6,
      minGameDriveFreePct: 10.2,
      avgGameDriveActivePct: 1.9,
      maxGameDriveLatencyMs: 0,
      maxGameDriveQueueLength: 4,
      maxPagesPerSec: 33188,
      storageTelemetryAvailable: true,
      projectLoopState: 'UNKNOWN_PROVIDER',
      projectTelemetryGapCount: 8,
      projectNextExperiment: 'Prove exact VR run identity before tuning',
    },
    history: { sessionCount: 24, newestSessionId: 'starfield-vr-performance-20261002-014019-238' },
    publication: { packet: true, history: true, loop: false, event: true },
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: false,
    sharedWorkspacePublished: false,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '7'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=' + JSON.stringify(telemetryPayload) + '\n',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED');
  assert.equal(result.telemetry.degraded, true);
  assert.equal(result.telemetry.primaryTelemetryPublished, true);
  assert.equal(result.telemetry.auxiliaryProjectionPublished, false);
  assert.equal(result.telemetry.sharedWorkspacePublished, false);
  assert.deepEqual(result.telemetry.publication, { packet: true, history: true, loop: false, event: true });
  assert.equal(result.telemetry.headline.sampleCount, 73);
  assert.equal(result.telemetry.headline.maxGpuMemoryPct, 98.3);
});

test('Starfield VR telemetry refresh fails closed when bounded headline marker is absent', async () => {
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: '8'.repeat(64),
    command: { plan: { processId: 'starfield-vr-telemetry-refresh' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: '{"schemaVersion":"stephanos.starfield-vr-telemetry-report.v1","private":"raw"}',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'starfield-vr-telemetry-refresh' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_RECEIPT_INVALID');
  assert.equal(result.telemetryProjectionPresent, false);
});

test('parity reconciliation returns bounded zero-gap truth without raw ledger output', async () => {
  const parityPayload = {
    ok: true,
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 14,
    parityPresentCount: 12,
    buildableGapCount: 0,
    boundaryHoldCount: 2,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
    privateLedgerPath: 'C:\\private\\parity.json',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'e'.repeat(64),
    command: { plan: { processId: 'reconcile-remote-commander-parity' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT=' + JSON.stringify(parityPayload) + '\nPRIVATE RAW PARITY',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'reconcile-remote-commander-parity' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.capabilityParity, {
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 14,
    parityPresentCount: 12,
    buildableGapCount: 0,
    boundaryHoldCount: 2,
    zeroGapInvariantSatisfied: true,
    closureRequired: false,
    daemonMayReportGreen: true,
    mustContinueUntilZero: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE RAW PARITY'), false);
  assert.equal(serialized.includes('private\\parity.json'), false);
});

test('Battle Bridge observation returns bounded services, GPU and model facts without raw output', async () => {
  const observationPayload = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T10:55:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 12345,
    memory: { totalBytes: 64000000000, freeBytes: 32000000000, usedBytes: 32000000000 },
    gpu: { available: true, name: 'NVIDIA GeForce RTX 5090', memoryTotalMiB: 32607, memoryUsedMiB: 12000, memoryFreeMiB: 20607, utilizationGpuPercent: 21 },
    ollama: {
      reachable: true,
      installedModelCount: 2,
      loadedModelCount: 1,
      installedModelsTruncated: true,
      loadedModelsTruncated: false,
      installedModels: [{ name: 'qwen:14b', sizeBytes: 1000, parameterSize: '14B', quantizationLevel: 'Q4', family: 'qwen' }],
      loadedModels: [{ name: 'llama3.2:3b', sizeBytes: 500, sizeVramBytes: 400, contextLength: 32768 }],
    },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'f'.repeat(64),
    command: { plan: { processId: 'battle-bridge-observe' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(observationPayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-observe' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_BATTLE_BRIDGE_OBSERVATION_COMPLETE');
  assert.equal(result.observation.services.ui.ready, true);
  assert.equal(result.observation.gpu.memoryTotalMiB, 32607);
  assert.equal(result.observation.ollama.installedModelCount, 2);
  assert.equal(result.observation.ollama.installedModelsTruncated, true);
  assert.equal(result.observation.ollama.loadedModels[0].name, 'llama3.2:3b');
  assert.equal(result.observation.readOnly, true);
  assert.equal(result.observation.secretMaterialIncluded, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('PRIVATE STDERR MUST NOT ESCAPE'), false);
});

test('VR Atlas runtime proof returns sanitised machine evidence without leaking local artifact paths', async () => {
  const privateScreenshot = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-proof.png';
  const privateReceipt = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-proof.json';
  const proofPayload = {
    ok: true,
    profile: 'vr-atlas-status-pills',
    sourceHead: HEAD,
    exactHeadProofOk: true,
    finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_PASS',
    evidenceHash: 'd'.repeat(64),
    screenshotSha256: 'e'.repeat(64),
    pillCount: 8,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: privateScreenshot,
    receiptPath: privateReceipt,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-vr-atlas-runtime' } },
    contentText: 'SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload) + '\nPRIVATE RAW STDOUT',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-vr-atlas-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'prove-vr-atlas-runtime');
  assert.equal(result.result.runtimeProof.sourceHead, HEAD);
  assert.equal(result.result.runtimeProof.screenshotCaptured, true);
  assert.equal(result.result.runtimeProof.receiptCaptured, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(privateScreenshot), false);
  assert.equal(serialized.includes(privateReceipt), false);
  assert.equal(serialized.includes('PRIVATE RAW STDOUT'), false);
  assert.equal(serialized.includes('SECRET-LIKE-RAW-OUTPUT-MUST-NOT-ESCAPE'), false);
});

test('Flywheel runtime proof returns sanitised connected-feed evidence without leaking local artifacts', async () => {
  const privateScreenshot = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-flywheel.png';
  const privateReceipt = '.stephanos/local-state-checkpoints/sovereign-ui-proof/private-flywheel.json';
  const proofPayload = {
    ok: true,
    profile: 'flywheel-live-feed',
    sourceHead: HEAD,
    exactHeadProofOk: true,
    finalVerdict: 'FLYWHEEL_RUNTIME_PROOF_PASS',
    evidenceHash: 'b'.repeat(64),
    screenshotSha256: 'c'.repeat(64),
    feed: {
      state: 'stale',
      responseMs: 1661,
      goalCount: 51,
      eventCount: 79,
      starfieldSeedPlanted: true,
    },
    browser: {
      liveState: 'stale',
      liveLabel: 'STALE',
      backendUnreachableVisible: false,
      seedVisible: true,
    },
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: privateScreenshot,
    receiptPath: privateReceipt,
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-flywheel-runtime' } },
    contentText: 'PRIVATE FLYWHEEL OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload) + '\nPRIVATE RAW FLYWHEEL STDOUT',
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-flywheel-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'prove-flywheel-runtime');
  assert.equal(result.result.runtimeProof.sourceHead, HEAD);
  assert.equal(result.result.runtimeProof.feedState, 'stale');
  assert.equal(result.result.runtimeProof.routeResponseMs, 1661);
  assert.equal(result.result.runtimeProof.goalCount, 51);
  assert.equal(result.result.runtimeProof.eventCount, 79);
  assert.equal(result.result.runtimeProof.starfieldSeedPlanted, true);
  assert.equal(result.result.runtimeProof.browserLiveState, 'stale');
  assert.equal(result.result.runtimeProof.browserLiveLabel, 'STALE');
  assert.equal(result.result.runtimeProof.backendUnreachableVisible, false);
  assert.equal(result.result.runtimeProof.seedVisible, true);
  assert.equal(result.result.runtimeProof.screenshotCaptured, true);
  assert.equal(result.result.runtimeProof.receiptCaptured, true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(privateScreenshot), false);
  assert.equal(serialized.includes(privateReceipt), false);
  assert.equal(serialized.includes('PRIVATE RAW FLYWHEEL STDOUT'), false);
  assert.equal(serialized.includes('PRIVATE FLYWHEEL OUTPUT MUST NOT ESCAPE'), false);
});

test('VR Atlas runtime proof cannot report green on wrong-head evidence', async () => {
  const proofPayload = {
    ok: true,
    profile: 'vr-atlas-status-pills',
    sourceHead: 'f'.repeat(40),
    exactHeadProofOk: true,
    finalVerdict: 'VR_ATLAS_RUNTIME_PROOF_PASS',
    evidenceHash: 'd'.repeat(64),
    screenshotSha256: 'e'.repeat(64),
    pillCount: 8,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    screenshotPath: 'local.png',
    receiptPath: 'local.json',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'prove-vr-atlas-runtime' } },
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=' + JSON.stringify(proofPayload),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'prove-vr-atlas-runtime' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID');
  assert.equal(result.runtimeProof.sourceHead, 'f'.repeat(40));
  assert.equal(result.publicReceiptSafe, true);
  assert.equal(result.secretMaterialReturned, false);
});

test('Virtual AirLink acceptance returns bounded failure evidence instead of a transport error', async () => {
  const acceptancePayload = {
    schemaVersion: 'stephanos.vr-virtual-airlink-acceptance.v1',
    ok: false,
    virtualAirLinkTestUsed: true,
    virtualAirLinkRestoredOff: true,
    launchAllowed: false,
    realHeadsetProofClaimed: false,
    governorWatchStarted: false,
    governorWatchProcessCount: 1,
    lightweightModel: 'llama3.2:3b',
    loadedModelsBefore: ['qwen:14b'],
    heavyModelsBefore: ['qwen:14b'],
    heavyModelSamplesDuringGuard: ['qwen:14b'],
    loadedModelsAfterGuard: ['qwen:14b'],
    heavyModelsAfterGuard: ['qwen:14b'],
    gpuBefore: { available: true, memoryUsedMiB: 30451, memoryTotalMiB: 32607, utilizationGpuPercent: 0 },
    gpuAfter: { available: true, memoryUsedMiB: 30451, memoryTotalMiB: 32607, utilizationGpuPercent: 0 },
    vramReleasedMiB: 0,
    observationSeconds: 12,
    blocker: 'VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED',
    finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED',
  };
  const maintenance = {
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    command: { plan: { processId: 'vr-virtual-airlink-acceptance' } },
    structuredContent: {
      ok: false,
      status: 2,
      stdout: JSON.stringify(acceptancePayload),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'vr-virtual-airlink-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\\\Users\\\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.verdict, 'COMMAND_EXECUTION_COMPLETE');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_COMPLETE');
  assert.equal(result.acceptancePassed, false);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(result.processId, 'vr-virtual-airlink-acceptance');
  assert.equal(result.status, 2);
  assert.equal(result.acceptance.blocker, 'VR_ACCEPTANCE_HEAVY_MODEL_RESPAWNED');
  assert.deepEqual(result.acceptance.heavyModelsAfterGuard, ['qwen:14b']);
  assert.equal(result.acceptance.vramReleasedMiB, 0);
  assert.equal(result.acceptance.virtualAirLinkRestoredOff, true);
  assert.equal(result.acceptance.launchAllowed, false);
  assert.equal(result.acceptance.realHeadsetProofClaimed, false);
});

test('failed outer config receipts are rejected before maintenance mutation', async () => {
  const safeConfig = {
    implementation: 'stephanos-local-node',
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    sourceControlledMaintenanceOnly: true,
    arbitraryUnboundedCommandAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    canRunFocusedNodeTests: false,
  };
  const baseReceipt = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'c'.repeat(64),
    structuredContent: safeConfig,
  };
  const cases = [
    { configReceipt: { ...baseReceipt, ok: false } },
    { configReceipt: { ...baseReceipt, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED' } },
    { configReceipt: { ...baseReceipt, proofHash: 'bad' } },
    { configReceipt: baseReceipt, configIsError: true },
  ];
  for (const options of cases) {
    const { calls, fetchFn } = mcpFetch(options);
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'battle-bridge-status' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
    const maintenanceCalls = calls
      .filter((entry) => entry.url.endsWith('/mcp'))
      .map((entry) => JSON.parse(entry.options.body || '{}'))
      .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
    assert.equal(maintenanceCalls.length, 0);
  }
});

test('unsafe Commander posture blocks before maintenance mutation', async () => {
  const { calls, fetchFn } = mcpFetch({
    config: {
      implementation: 'stephanos-local-node',
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: true,
      pcRestartAuthority: false,
      canRunFocusedNodeTests: false,
    },
  });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  const maintenanceCalls = calls
    .filter((entry) => entry.url.endsWith('/mcp'))
    .map((entry) => JSON.parse(entry.options.body || '{}'))
    .filter((message) => message.method === 'tools/call' && message.params?.name === 'maintenance_action');
  assert.equal(maintenanceCalls.length, 0);
});

test('maintenance receipt normalizes one extra MCP structured-content wrapper', async () => {
  const nestedReceipt = {
    structuredContent: {
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
      proofHash: 'd'.repeat(64),
      command: { plan: { processId: 'gaming-resource-acceptance' } },
      structuredContent: { ok: true, status: 0, errorCode: '' },
    },
  };
  const { fetchFn } = mcpFetch({ maintenance: nestedReceipt });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'gaming-resource-acceptance' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.result.remoteAction, 'gaming-resource-acceptance');
  assert.equal(result.result.proofHash, 'd'.repeat(64));
  assert.equal(result.result.processId, 'gaming-resource-acceptance');
  assert.equal(result.result.status, 0);
});

test('maintenance receipt must contain exact completion proof', async () => {
  const baseline = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'battle-bridge-status' } },
    structuredContent: { ok: true, status: 0, errorCode: '' },
  };
  for (const maintenance of [
    { ...baseline, finalVerdict: 'SOMETHING_ELSE' },
    { ...baseline, proofHash: 'bad' },
    { ...baseline, command: { plan: { processId: 'other-action' } } },
    { ...baseline, structuredContent: { ok: false, status: 1, errorCode: 'FAILED' } },
  ]) {
    const { fetchFn } = mcpFetch({ maintenance });
    const result = await executeSovereignCommanderRemoteOnBattleBridge(
      command({ remoteAction: 'battle-bridge-status' }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID');
  }
});

test('main-head drift blocks before authenticated MCP mutation', async () => {
  const { calls, fetchFn } = mcpFetch();
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'restart-stephanos-runtime' }),
    {
      spawnSyncFn: spawnForHead('b'.repeat(40)),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH');
  assert.equal(calls.length, 0);
});


test('aggregate plan proof is request-specific even with identical step receipts', async () => {
  const remotePlan = ['battle-bridge-status', 'repair-control-plane'];
  const run = async (requestId) => {
    const { fetchFn } = mcpFetch();
    return executeSovereignCommanderRemoteOnBattleBridge(
      command({ requestId, remoteAction: '', remotePlan }),
      {
        spawnSyncFn: spawnForHead(),
        readFileFn: readToken,
        fetchFn,
        env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
      },
    );
  };
  const first = await run('sovereign-plan-proof-a');
  const second = await run('sovereign-plan-proof-b');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.match(first.planProofHash, /^[0-9a-f]{64}$/);
  assert.match(second.planProofHash, /^[0-9a-f]{64}$/);
  assert.notEqual(first.planProofHash, second.planProofHash);
});


test('remote Battle Bridge observer returns sanitised machine and model facts', async () => {
  const observation = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T10:55:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 12345,
    memory: { totalBytes: 68719476736, freeBytes: 25769803776, usedBytes: 42949672960 },
    gpu: {
      available: true,
      name: 'NVIDIA GeForce RTX 5090',
      memoryTotalMiB: 32768,
      memoryUsedMiB: 8192,
      memoryFreeMiB: 24576,
      utilizationGpuPercent: 17,
    },
    ollama: {
      reachable: true,
      installedModels: [{
        name: 'qwen3.5:27b',
        sizeBytes: 17000000000,
        parameterSize: '27.8B',
        quantizationLevel: 'Q4_K_M',
        family: 'qwen3',
        privatePath: 'C:\\private\\models',
      }],
      loadedModels: [{
        name: 'qwen:14b',
        sizeBytes: 8200000000,
        sizeVramBytes: 7900000000,
        contextLength: 32768,
      }],
    },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'battle-bridge-observe' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: JSON.stringify(observation),
      stderr: '',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'battle-bridge-observe' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.remoteAction, 'battle-bridge-observe');
  assert.equal(result.observation.schemaVersion, 'stephanos.battle-bridge-observation.v1');
  assert.equal(result.observation.gpu.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(result.observation.ollama.installedModels[0].name, 'qwen3.5:27b');
  assert.equal(result.observation.ollama.loadedModels[0].contextLength, 32768);
  assert.equal(result.observation.services.ollama.ready, true);
  assert.equal(result.observation.readOnly, true);
  assert.equal(result.observation.arbitraryShellAllowed, false);
  assert.equal(result.observation.secretMaterialIncluded, false);
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /MUST_NOT_ESCAPE|private\\\\models|PRIVATE RAW OUTPUT/);
});

test('Battle Bridge observer is intentionally single-action, not a remote plan step', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['battle-bridge-observe'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});

test('meter-status returns a bounded public meter projection without raw output', async () => {
  const meterPayload = {
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T11:45:00.000Z',
    counts: { total: 3, green: 1, amber: 0, red: 1, grey: 1 },
    meters: [
      {
        meterId: 'codex-capacity',
        provider: 'codex',
        source: 'shared-workspace',
        observationState: 'CURRENT',
        trafficLight: 'RED',
        remainingPercent: 3,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T11:44:00.000Z',
        ageSeconds: 60,
        naturalResetAtUtc: '',
        meterTruthUsable: true,
        observableBySovereign: true,
        privatePath: 'C:\\private\\must-not-escape',
      },
      {
        meterId: 'github-core',
        provider: 'github',
        source: 'github-rate-limit-api',
        observationState: 'CURRENT',
        trafficLight: 'GREEN',
        remainingPercent: 80,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T11:45:00.000Z',
        ageSeconds: 0,
        naturalResetAtUtc: '2026-10-02T12:00:00.000Z',
        meterTruthUsable: true,
        observableBySovereign: true,
        limit: 5000,
        remaining: 4000,
      },
      {
        meterId: 'remote-desktop-commander',
        provider: 'desktop-commander',
        source: 'external-observation-required',
        observationState: 'UNKNOWN',
        trafficLight: 'GREY',
        remainingPercent: null,
        availability: 'UNKNOWN',
        truthState: 'UNKNOWN',
        observedAtUtc: '',
        ageSeconds: null,
        naturalResetAtUtc: '',
        meterTruthUsable: false,
        observableBySovereign: false,
        blocker: 'EXTERNAL_CONNECTOR_METER_NOT_PUBLISHED',
      },
    ],
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_METER_STATUS_RED_PRESENT',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'meter-status' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_METER_STATUS_RESULT=' + JSON.stringify(meterPayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'meter-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_COMPLETE');
  assert.equal(result.meterStatus.counts.red, 1);
  assert.equal(result.meterStatus.meters.find((item) => item.meterId === 'codex-capacity').remainingPercent, 3);
  assert.equal(result.meterStatus.meters.find((item) => item.meterId === 'remote-desktop-commander').trafficLight, 'GREY');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('MUST_NOT_ESCAPE'), false);
  assert.equal(serialized.includes('PRIVATE RAW OUTPUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
  assert.equal(serialized.includes('private\\\\must-not-escape'), false);
});

test('meter-status is intentionally single-action and cannot be hidden inside a remote plan', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['meter-status'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});

test('controller-lane-status returns bounded physical logical and refill truth without raw output', async () => {
  const controllerLanePayload = {
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T14:30:00.000Z',
    physical: {
      expected: 5,
      building: 4,
      amber: 1,
      red: 0,
      unknown: 0,
      allCurrent: true,
      allObservedEnabled: true,
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
      controllers: [
        {
          controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
          title: 'Stephanos Autonomous Goal Builder',
          freshness: 'CURRENT',
          activityState: 'BUILDING',
          trafficLight: 'GREEN',
          materialLaneCount: 3,
          activeLaneCount: 3,
          parkedLaneCount: 0,
          safeEligibleWorkRemaining: 0,
          blocker: '',
          privatePath: 'C:\\private\\must-not-escape',
        },
        {
          controllerId: '6aa425918c8881918c1763ee6acf3cb6',
          title: 'Stephanos Hourly Build Controller',
          freshness: 'CURRENT',
          activityState: 'NARRATING_OR_IDLE_WITH_ELIGIBLE_WORK',
          trafficLight: 'AMBER',
          materialLaneCount: 0,
          activeLaneCount: 0,
          parkedLaneCount: 0,
          safeEligibleWorkRemaining: 8,
          blocker: 'SAFE_ELIGIBLE_WORK_WITHOUT_MATERIAL_ACTION',
        },
      ],
    },
    logical: {
      current: true,
      valid: true,
      observedAtUtc: '2026-10-02T14:29:00.000Z',
      physicalControllerCount: 5,
      total: 40,
      active: 11,
      tracking: 21,
      parked: 8,
      retired: 0,
      selectedForAdmission: 7,
      finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
      hostLoads: [
        {
          controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
          title: 'Stephanos Autonomous Goal Builder',
          logicalControllerCount: 8,
          activeCount: 3,
          trackingCount: 4,
          parkedCount: 1,
        },
      ],
    },
    lanes: {
      targetMaterialLanes: 15,
      activeMaterialLaneCount: 7,
      activeLaneClaimCount: 7,
      reportedMaterialLaneCountSum: 12,
      occupancyPercent: 46.67,
      freeTargetLaneSlots: 8,
      runnableBacklogCount: 8,
      parkedPhysicalLaneCount: 1,
      reportedSafeEligibleWorkMax: 8,
      reportedSafeEligibleWorkSum: 8,
      refillHealth: 'AMBER',
      refillState: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
    token: 'MUST_NOT_ESCAPE',
  };
  const maintenance = {
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    proofHash: 'a'.repeat(64),
    command: { plan: { processId: 'controller-lane-status' } },
    contentText: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
    structuredContent: {
      ok: true,
      status: 0,
      stdout: 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=' + JSON.stringify(controllerLanePayload),
      stderr: 'PRIVATE STDERR MUST NOT ESCAPE',
      errorCode: '',
    },
  };
  const { fetchFn } = mcpFetch({ maintenance });
  const result = await executeSovereignCommanderRemoteOnBattleBridge(
    command({ remoteAction: 'controller-lane-status' }),
    {
      spawnSyncFn: spawnForHead(),
      readFileFn: readToken,
      fetchFn,
      env: { USERPROFILE: 'C:\\Users\\Operator' },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE');
  assert.equal(result.controllerLaneStatus.physical.building, 4);
  assert.equal(result.controllerLaneStatus.logical.total, 40);
  assert.equal(result.controllerLaneStatus.lanes.targetMaterialLanes, 15);
  assert.equal(result.controllerLaneStatus.lanes.activeMaterialLaneCount, 7);
  assert.equal(result.controllerLaneStatus.lanes.freeTargetLaneSlots, 8);
  assert.equal(result.controllerLaneStatus.lanes.runnableBacklogCount, 8);
  assert.equal(result.controllerLaneStatus.lanes.refillHealth, 'AMBER');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('MUST_NOT_ESCAPE'), false);
  assert.equal(serialized.includes('PRIVATE RAW OUTPUT'), false);
  assert.equal(serialized.includes('PRIVATE STDERR'), false);
  assert.equal(serialized.includes('private\\\\must-not-escape'), false);
});

test('controller-lane-status is intentionally single-action and cannot be hidden inside a remote plan', () => {
  const result = validateSovereignCommanderRemoteCommandShape(command({
    remoteAction: '',
    remotePlan: ['controller-lane-status'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED');
});
