import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readSovereignControlConversationV1 } from './sovereignControlConversationService.js';
import { classifySovereignControlConversationV1 } from '../../shared/agents/sovereignControlConversationV1.mjs';
import { routeStephanosConversationV1 } from '../../shared/agents/stephanosConversationRouterV1.mjs';
import { parseCommand, resolveRoute } from './commandRouter.js';
import { buildErrorResponse, buildSuccessResponse } from './responseBuilder.js';
import { createControlTowerRequestObservationV1 } from '../../shared/agents/controlTowerRequestObservationV1.mjs';
import { projectSovereignControlSystemStatusV1 } from '../../shared/agents/sovereignControlSystemStatusV1.mjs';

const AT = '2026-10-31T12:00:00.000Z';
const NOW = Date.parse(AT);
const HEAD = 'a'.repeat(40);
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const health = () => ({ ok: true, service: 'stephanos-sovereign-commander',
  transport: 'authenticated-http-jsonrpc', observedAtUtc: AT,
  continuousRepairGuardian: { enabled: true, running: false, scheduled: false,
    maintenanceInFlight: false, timeoutCustodyHeld: false, persistentCustody: { held: false },
    cycleCount: 0, lastBlocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' },
});
const relay = () => ({ schema: 'stephanos.sovereign-relay-daemon.v1', statusId: 'sovereign-relay-current',
  sourceHead: HEAD, heartbeatAtUtc: AT, controlTowerBuild: {
    schemaVersion: 'stephanos.control-tower-build-consumer.v1', state: 'WAITING', blocker: '',
    observedAtUtc: AT, buildStartedProven: false, nativePickupProven: false, goalCompletionProven: false,
    sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false,
  }, privateField: 'private-relay-secret',
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-conversation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'status'));
  const path = join(root, 'status', 'sovereign-relay-current.json');
  await writeFile(path, JSON.stringify(relay()));
  const requests = [];
  const options = {
    testOnly: true,
    env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root, STEPHANOS_BACKEND_SOURCE_HEAD: HEAD },
    nowMs: () => NOW,
    fetchFn: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(health()) };
    },
  };
  return { root, path, options, requests };
}

test('service uses real fixed read-only observers and ignores caller URLs, tokens, heads and workspace paths', async t => {
  const f = await fixture(t);
  const input = { prompt: 'Sovereign Commander status', requestedTargetId: 'everyone',
    url: 'https://evil.invalid', token: 'caller-secret', expectedHead: 'b'.repeat(40),
    workspaceRoot: '/private', env: { STEPHANOS_SHARED_AGENT_WORKSPACE: '/private' } };
  const result = await readSovereignControlConversationV1(input, f.options);
  assert.equal(result.commander.reachable, true);
  assert.equal(result.commander.guardian.state, 'NO_NEXT_CYCLE');
  assert.equal(result.controlTower.observed, true);
  assert.equal(result.controlTower.state, 'WAITING');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, HEALTH_URL);
  assert.equal(f.requests[0].init.method, 'GET');
  assert.equal(f.requests[0].init.redirect, 'error');
  assert.equal(f.requests[0].init.headers, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-relay-secret|caller-secret|evil\.invalid|workspaceRoot/);
});

test('ordinary synthesis skips every control observer', async t => {
  const f = await fixture(t);
  assert.equal(await readSovereignControlConversationV1({ prompt: 'Explain CSS grid' }, f.options), null);
  assert.equal(f.requests.length, 0);
});

test('missing source identity, stale relay and cross-head relay do not claim current Control Tower observation', async t => {
  const f = await fixture(t);
  const cases = [
    [relay(), '', 'CONTROL_TOWER_BUILD_PROJECTION_CONTEXT_INVALID'],
    [{ ...relay(), sourceHead: 'b'.repeat(40) }, HEAD, 'CONTROL_TOWER_RELAY_SOURCE_MISMATCH'],
    [{ ...relay(), heartbeatAtUtc: '2026-10-31T11:00:00.000Z' }, HEAD, 'CONTROL_TOWER_RELAY_HEARTBEAT_STALE'],
  ];
  for (const [value, expectedHead, blocker] of cases) {
    await writeFile(f.path, JSON.stringify(value));
    const result = await readSovereignControlConversationV1({ prompt: 'status', requestedTargetId: 'control-tower' }, {
      ...f.options, env: { ...f.options.env, STEPHANOS_BACKEND_SOURCE_HEAD: expectedHead },
    });
    assert.equal(result.controlTower.observed, false);
    assert.equal(result.controlTower.exactHeadMatch, false);
    assert.equal(result.controlTower.blocker, blocker);
    assert.equal(result.nativeActionSubmitted, false);
  }
});

test('malformed, oversized and missing relay records safely degrade without exposing bytes or paths', async t => {
  const f = await fixture(t);
  for (const value of ['{"secret":"private-read-value"', 'private-read-value'.repeat(6000), '[]']) {
    await writeFile(f.path, value);
    const result = await readSovereignControlConversationV1({ prompt: 'status', requestedTargetId: 'control-tower' }, f.options);
    assert.equal(result.controlTower.observed, false);
    assert.doesNotMatch(JSON.stringify(result), /private-read-value|sovereign-conversation-|\/tmp\//);
  }
  await rm(f.path);
  const missing = await readSovereignControlConversationV1({ prompt: 'status', requestedTargetId: 'control-tower' }, f.options);
  assert.equal(missing.controlTower.observed, false);
  assert.equal(missing.controlTower.blocker, 'CONTROL_TOWER_RELAY_READ_UNAVAILABLE');
});

test('real relay projector preserves unresolved build and native diagnosis across current, stale and cross-head polls', async t => {
  const f = await fixture(t);
  const makeRequest = (runId, operation, createdAtUtc) => ({
    requestId: `control-tower-build-${runId}-1`, runId, runAttempt: 1, operation,
    sourceHead: HEAD, artifactId: runId, artifactSha256: 'b'.repeat(64),
    createdAtUtc, expiresAtUtc: new Date(Date.parse(createdAtUtc) + 600000).toISOString(),
  });
  const reservedAt = '2026-10-31T11:40:00.000Z';
  const reserved = createControlTowerRequestObservationV1(makeRequest(401, 'BUILD_NEXT_ELIGIBLE_GOAL', reservedAt), {
    commandDigest: 'c'.repeat(64), acceptedAtUtc: reservedAt, nowMs: NOW,
  });
  assert.ok(reserved);
  const observedAt = '2026-10-31T11:51:00.000Z';
  const diagnostic = projectSovereignControlSystemStatusV1({
    schemaVersion: 'stephanos.sovereign-control-system-status.v1', observedAtUtc: observedAt,
    observationOnly: true, observationCompleted: true, blocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
    source: { available: true, sourceHead: HEAD, expectedMain: HEAD, stable: true },
    nativeRuntime: { available: true, qualificationObserved: false, observedAtUtc: observedAt,
      reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' },
  });
  const observed = createControlTowerRequestObservationV1(makeRequest(402, 'OBSERVE_CONTROL_SYSTEM', '2026-10-31T11:50:00.000Z'), {
    commandDigest: 'd'.repeat(64), acceptedAtUtc: '2026-10-31T11:50:00.000Z', observedAtUtc: observedAt,
    state: 'OBSERVATION_COMPLETED', blocker: '', controlSystemStatus: diagnostic,
    observationProofHash: createHash('sha256').update(JSON.stringify(diagnostic)).digest('hex'), nowMs: NOW,
  });
  assert.ok(observed);
  const record = relay();
  record.controlTowerBuild.latestBuildRequestObservation = { ...reserved, ledgerPhase: 'RESERVED', terminalState: '', detailState: 'OBSERVED' };
  record.controlTowerBuild.latestControlSystemObservation = { ...observed, ledgerPhase: 'TERMINAL', terminalState: 'DONE', detailState: 'OBSERVED' };
  for (const change of [{}, { heartbeatAtUtc: '2026-10-31T11:00:00.000Z' }, { sourceHead: 'e'.repeat(40) }]) {
    await writeFile(f.path, JSON.stringify({ ...record, ...change }));
    const result = await readSovereignControlConversationV1({ prompt: 'prepare repair', requestedTargetId: 'control-tower' }, f.options);
    assert.equal(result.controlTower.latestRequestObservation.requestId, observed.requestId);
    assert.equal(result.controlTower.latestBuildRequestObservation.requestId, reserved.requestId);
    assert.equal(result.controlTower.latestBuildRequestObservation.observedAtUtc, reservedAt);
    assert.equal(result.controlTower.latestBuildRequestObservation.outcomeUnresolved, true);
    assert.equal(result.controlTower.controlSystemStatus.nativeRuntime.reason, 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING');
    assert.equal(result.handoff.submissionBlockedReason, 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN');
    assert.equal(result.handoff.originalRequestId, reserved.requestId);
    assert.equal(result.nativeActionSubmitted, false);
  }
});

test('final-component and ancestor links cannot redirect the fixed relay read', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'other.json');
  await writeFile(outside, JSON.stringify(relay()));
  await rm(f.path);
  await symlink(outside, f.path);
  const linked = await readSovereignControlConversationV1({ prompt: 'status', requestedTargetId: 'control-tower' }, f.options);
  assert.equal(linked.controlTower.observed, false);
  await rm(join(f.root, 'status'), { recursive: true });
  await mkdir(join(f.root, 'redirect'));
  await writeFile(join(f.root, 'redirect', 'sovereign-relay-current.json'), JSON.stringify(relay()));
  await symlink(join(f.root, 'redirect'), join(f.root, 'status'));
  const ancestor = await readSovereignControlConversationV1({ prompt: 'status', requestedTargetId: 'control-tower' }, f.options);
  assert.equal(ancestor.controlTower.observed, false);
});

test('offline Commander is an observation failure, never a claimed action or model fallback', async t => {
  const f = await fixture(t);
  const result = await readSovereignControlConversationV1({ prompt: 'repair', requestedTargetId: 'sovereign-commander' }, {
    ...f.options, fetchFn: async () => { throw new Error('private-network-detail'); },
  });
  assert.equal(result.commander.observed, false);
  assert.equal(result.commander.blocker, 'COMMANDER_HEALTH_UNREACHABLE');
  assert.equal(result.handoff.state, 'NOT_SUBMITTED');
  assert.equal(result.modelInvoked, false);
  assert.equal(result.nativeActionSubmitted, false);
  assert.doesNotMatch(JSON.stringify(result), /private-network-detail/);
});

// Execute the entire checked-in route body, including its real registered
// /chat handler. Only ESM bindings are supplied by the harness; no production
// route code, branches or response construction are replaced. This keeps the
// safety test dependency-free while making accidental provider/native calls fail.
async function routeHarness(f, { continuityOk = true, allowLegacyHealthTool = false } = {}) {
  const routes = new Map();
  const calls = { forbidden: [], prepare: [], complete: [], history: [], stores: [], activity: [], tools: [] };
  const forbidden = name => () => { calls.forbidden.push(name); throw new Error('UNEXPECTED_' + name); };
  const logger = { info() {}, warn() {}, error() {} };
  const bindings = {
    express: { Router: () => ({ post: (path, handler) => routes.set(path, handler) }) },
    createLogger: () => logger, console: { log() {} }, AbortController, process,
    DEFAULT_PROVIDER_KEY: 'ollama',
    classifySovereignControlConversationV1, routeStephanosConversationV1, parseCommand, resolveRoute,
    buildErrorResponse, buildSuccessResponse,
    ERROR_CODES: { CMD_INVALID: 'CMD_INVALID' },
    normalizeError: error => ({ message: error.message, code: 'FAILED', status: 500 }),
    memoryService: { buildContextSummary: () => ({ relevantItems: [], summaryText: '' }) },
    providerSecretStore: { buildProviderConfigOverlay: forbidden('PROVIDER_CREDENTIALS') },
    resolveProviderRequest: forbidden('PROVIDER_RESOLUTION'),
    routeLLMRequest: forbidden('MODEL_EXECUTION'),
    getProviderHealthSnapshot: forbidden('PROVIDER_HEALTH'),
    executeTool: allowLegacyHealthTool ? async name => {
      calls.tools.push(name);
      assert.equal(name, 'getSovereignCommanderStatus');
      return { tool: { name, subsystem: 'system', state: 'ready' },
        result: { output_text: 'Read-only Commander health', data: { readOnly: true, executionProven: false } } };
    } : forbidden('TOOL_OR_NATIVE_EXECUTION'),
    readLiveGoalProjection: forbidden('UNRELATED_GOAL_READ'),
    buildStephanosExecutiveChatBridge: forbidden('EXECUTIVE_ACTION_BRIDGE'),
    readSovereignControlConversationV1: input => readSovereignControlConversationV1(input, f.options),
    prepareSharedIntelligenceForAiTurnV1: async value => {
      calls.prepare.push(value);
      return { ok: continuityOk, classification: continuityOk ? 'OBSERVED' : 'WORKSPACE_UNAVAILABLE',
        threadId: 'thread-1', operatorTurnId: 'operator-1', knowledgeTwin: { valid: true, visibleItems: [] } };
    },
    completeSharedIntelligenceAiTurnV1: async value => {
      calls.complete.push(value);
      return { ...value.prepared, stephanosTurnId: 'answer-1', conversationCanvasView: { threadId: 'thread-1' } };
    },
    prepareAuthorisedHistoricalChatContextV1: value => { calls.history.push(value); return { ok: true, knowledgeTwin: { valid: true } }; },
    governAuthorisedHistoricalTeachingV1: () => ({ classification: 'GOVERNED', candidateCount: 1, promotedCount: 0 }),
    recallGovernedOperatorTeachingV1: () => ({ classification: 'OBSERVED', recordCount: 1 }),
    durableMemoryService: { getStore: () => ({ records: {} }), setStore: (...args) => calls.stores.push(args) },
    activityLogService: { record: record => calls.activity.push(record) },
  };
  const source = await readFile(new URL('../routes/ai.js', import.meta.url), 'utf8');
  const start = source.indexOf('const logger =');
  assert.ok(start > 0);
  const body = source.slice(start).replace(/^export function /gm, 'function ').replace(/^export default router;\s*$/m, '');
  new vm.Script(body, { filename: 'actual-ai-route.js' }).runInNewContext(bindings);
  const handler = routes.get('/chat');
  assert.equal(typeof handler, 'function');
  return { calls, async call(body, headers = {}) {
    const chunks = [];
    const response = {
      statusCode: 200, headers: {}, writableEnded: false, headersSent: false,
      status(value) { this.statusCode = value; return this; },
      setHeader(key, value) { this.headers[key] = value; },
      on() {}, write(value) { chunks.push(value); return true; },
      json(value) { this.payload = value; this.writableEnded = true; return this; },
      end() { this.writableEnded = true; return this; },
    };
    await handler({ body, headers: { 'x-request-id': 'control-route-test', ...headers }, query: {}, on() {} }, response);
    return { ...response, chunks: chunks.join('') };
  } };
}

test('actual AI handler returns control answer with continuity and no provider, credentials or native dispatch', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f);
  const historical = { source: 'operator-provided-history' };
  const response = await h.call({ prompt: 'repair Stephanos', provider: 'openai', fallbackEnabled: true,
    providerConfigs: { openai: { apiKey: 'untrusted-api-key' } },
    runtimeContext: { participantTarget: 'control-tower', surface: 'ipad', ownerToken: 'untrusted-owner-token' },
    authorised_chat_history: historical,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.type, 'control_result');
  assert.equal(response.payload.data.sovereign_control_conversation.handoff.state, 'NOT_SUBMITTED');
  assert.equal(response.payload.data.conversation_routing.responder.label, 'Stephanos control');
  assert.equal(response.payload.data.conversation_routing.directParticipantDispatchProven, false);
  assert.equal(response.payload.data.execution_metadata.model_invoked, false);
  assert.equal(response.payload.data.execution_metadata.actual_provider_used, null);
  assert.equal(h.calls.prepare[0].operatorText, 'repair Stephanos');
  assert.equal(h.calls.history[0], historical);
  assert.equal(h.calls.complete[0].answerText, response.payload.output_text);
  assert.equal(h.calls.complete[0].surface, 'ipad');
  assert.equal(response.payload.data.shared_intelligence_continuity.stephanos_turn_id, 'answer-1');
  assert.equal(response.payload.data.shared_intelligence_continuity.knowledge_twin_valid, true);
  assert.equal(response.payload.data.conversation_canvas_view.threadId, 'thread-1');
  assert.equal(h.calls.stores.length, 1);
  assert.equal(h.calls.forbidden.length, 0);
  assert.equal(f.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(response.payload), /untrusted-api-key|untrusted-owner-token/);
});

test('actual AI handler sends complete SSE answer and durable metadata without starting token generation', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f);
  const response = await h.call({ prompt: 'Sovereign Commander status', stream: true }, { accept: 'text/event-stream' });
  assert.equal(response.headers['Content-Type'], 'text/event-stream');
  assert.equal(response.writableEnded, true);
  assert.match(response.chunks, /event: final\n/);
  assert.match(response.chunks, /event: metadata\n/);
  assert.match(response.chunks, /event: complete\n/);
  assert.doesNotMatch(response.chunks, /event: token\n/);
  const events = response.chunks.trim().split('\n\n').map(block => JSON.parse(block.split('\ndata: ')[1]));
  assert.equal(events[1].data.data.sovereign_control_conversation.modelInvoked, false);
  assert.equal(events[1].data.data.shared_intelligence_continuity.stephanos_turn_id, 'answer-1');
  assert.equal(events[2].success, true);
  assert.equal(h.calls.forbidden.length, 0);
});

test('actual AI handler reports unavailable persistence truth while still answering safely', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f, { continuityOk: false });
  const response = await h.call({ prompt: '/control-tower inspect', runtimeContext: { participantTarget: 'everyone' } });
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.data.shared_intelligence_continuity.ok, false);
  assert.equal(response.payload.data.conversation_canvas_view, null);
  assert.equal(h.calls.complete.length, 0);
  assert.equal(response.payload.data.sovereign_control_conversation.handoff.operation, 'OBSERVE_CONTROL_SYSTEM');
  assert.equal(h.calls.forbidden.length, 0);
});

test('actual AI handler never routes oversized addressed diagnostics to a provider', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f);
  for (const [prefix, participantTarget] of [
    ['', 'control-tower'], ['', 'sovereign-commander'], ['/control-tower inspect ', 'everyone'],
    ['/sovereign ', 'everyone'], ['Sovereign Commander status ', 'everyone'],
  ]) {
    const response = await h.call({ prompt: prefix + 'x'.repeat(6001), provider: 'openai',
      runtimeContext: { participantTarget } });
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.data.sovereign_control_conversation.intent, 'INPUT_TOO_LONG');
    assert.equal(response.payload.data.sovereign_control_conversation.handoff, null);
    assert.equal(response.payload.data.execution_metadata.model_invoked, false);
    assert.doesNotMatch(response.payload.output_text, /x{20}/);
  }
  assert.equal(h.calls.forbidden.length, 0);
});

test('actual AI handler preserves exact /sovereign tool contract without provider setup or probes', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f, { allowLegacyHealthTool: true });
  const response = await h.call({ prompt: '/sovereign', provider: 'openai',
    runtimeContext: { participantTarget: 'sovereign-commander' } });
  assert.equal(response.payload.type, 'tool_result');
  assert.equal(response.payload.data.readOnly, true);
  assert.equal(response.payload.data.executionProven, false);
  assert.deepEqual(h.calls.tools, ['getSovereignCommanderStatus']);
  assert.equal(h.calls.forbidden.length, 0);
  assert.equal(h.calls.prepare.length, 0);
});

test('actual AI handler answers repair status and historical build questions without action handoffs', async t => {
  const f = await fixture(t);
  const h = await routeHarness(f);
  for (const [prompt, participantTarget] of [
    ['Why did the last build fail?', 'control-tower'],
    ['Show Sovereign Commander repair status.', 'everyone'],
  ]) {
    const response = await h.call({ prompt, runtimeContext: { participantTarget } });
    assert.equal(response.payload.data.sovereign_control_conversation.intent, 'STATUS');
    assert.equal(response.payload.data.sovereign_control_conversation.handoff, null);
  }
  assert.equal(h.calls.forbidden.length, 0);
});
