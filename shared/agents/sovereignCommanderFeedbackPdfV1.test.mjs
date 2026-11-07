import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { createSovereignCommanderHttpServer } from '../../scripts/sovereign-commander-http.mjs';
import { createSovereignFeedbackIntakeV1 } from './sovereignFeedbackIntakeV1.mjs';
import { ensureSharedWorkspaceLayout } from './sharedAgentWorkspaceStore.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

const local = { id: 1, isRequest: true, isNotification: false,
  transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const privateRoute = { mcpSessionReady: true, commandPathProven: true,
  transport: 'local-stdio-mcp', authenticatedMcp: false };
const feedback = { category: 'improvement', operation: 'general', message: 'PRIVATE_FEEDBACK_BODY_CANARY' };
const pdf = { path: 'C:\\SovereignFixture\\report.pdf', pages: [{ lines: ['PRIVATE_DOCUMENT_BODY_CANARY'] }] };
const call = (handler, name, args, transport = local) => handler('tools/call', { name, arguments: args }, transport);
const value = result => result.structuredContent.structuredContent;
const envelope = (operation, payload, targetPaths = []) => buildStephanosExecutionCommandEnvelopeV1({
  surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
  actionId: 'feedback-pdf-fixture', missionId: 'private-capability-fixture', relatedIssue: '#2573',
  operation, targetPaths, payload,
});
async function ready(options = {}) {
  const handler = createSovereignCommanderMcpHandler(options);
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}

test('feedback and PDF discovery never substitute for actual private request admission', async () => {
  let calls = 0;
  const { handler, listed } = await ready({ executor: async () => { calls++; return { ok: true }; } });
  try {
    for (const [name, args] of [['submit_feedback', feedback], ['write_pdf', pdf]]) {
      const tool = listed.tools.find(item => item.name === name);
      assert.ok(tool); assert.equal(tool.inputSchema.additionalProperties, false);
      assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.annotations.idempotentHint, false);
      for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
        { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
        const denied = await call(handler, name, args, transport);
        assert.equal(denied.isError, true);
        assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
      }
    }
    assert.equal(calls, 0);
  } finally { await handler.close(); }
});

test('closed feedback and document schemas refuse caller authority, getters and raw byte inputs before execution', async () => {
  let calls = 0;
  const { handler } = await ready({ executor: async () => { calls++; return { ok: true }; } });
  try {
    for (const [name, original, attacks] of [
      ['submit_feedback', feedback, [{ ...feedback, evidenceVerified: true }, { ...feedback, workspaceRoot: 'C:\\outside' },
        { ...feedback, participantId: 'operator' }, { ...feedback, message: '\u0000' },
        { ...feedback, get message() { throw new Error('must not invoke feedback accessor'); } }]],
      ['write_pdf', pdf, [{ ...pdf, overwrite: true }, { ...pdf, base64: 'JVBERi0=' },
        { ...pdf, pages: [{ lines: ['Unicode \u00e9'] }] },
        { ...pdf, get pages() { throw new Error('must not invoke document accessor'); } },
        { ...pdf, pages: [{ get lines() { throw new Error('must not invoke nested accessor'); } }] }]],
    ]) {
      for (const args of [null, [], Object.create(original), { ...original, [Symbol('authority')]: true }, ...attacks]) {
        const denied = await call(handler, name, args);
        assert.equal(denied.isError, true, name);
        assert.equal(denied.structuredContent.blocker, 'SOVEREIGN_PRIVATE_SESSION_ARGUMENTS_INVALID');
      }
    }
    assert.equal(calls, 0);
  } finally { await handler.close(); }
});

test('canonical feedback/PDF execution binds route and exact scope without returning input bodies', async () => {
  let calls = 0;
  for (const [operation, args, paths, option, receipt] of [
    ['SUBMIT_FEEDBACK', feedback, [], 'feedbackIntake', { ok: true, feedbackState: 'PERSISTED', advisoryOnly: true, executionAuthority: false }],
    ['WRITE_PDF', pdf, [pdf.path], 'pdfWrites', { ok: true, mutationState: 'CREATED', sha256: 'a'.repeat(64), bytes: 123 }],
  ]) {
    const command = envelope(operation, args, paths);
    const service = { execute: async (name, captured, route) => {
      calls++; assert.equal(name, operation); assert.deepEqual(captured, args); assert.deepEqual(route, privateRoute);
      return receipt;
    } };
    for (const options of [{}, { [option]: service }, { [option]: service,
      routeProof: { ...privateRoute, transport: 'public-mailbox' } }]) {
      const denied = await executeSovereignCommanderCommandV1(command, options);
      assert.equal(denied.ok, false);
      assert.equal(JSON.stringify(denied).includes('BODY_CANARY'), false);
      assert.equal(denied.command.plan.inputOmitted, true);
    }
    for (const targetPaths of operation === 'WRITE_PDF'
      ? [[], ['C:\\SovereignFixture\\different.pdf'], [pdf.path, pdf.path]] : [['C:\\outside']]) {
      const denied = await executeSovereignCommanderCommandV1({ ...command, targetPaths }, { [option]: service, routeProof: privateRoute });
      assert.equal(denied.ok, false); assert.equal(JSON.stringify(denied).includes('BODY_CANARY'), false);
    }
    const result = await executeSovereignCommanderCommandV1(command, { [option]: service, routeProof: privateRoute });
    assert.equal(result.ok, true); assert.equal(result.command.plan.inputOmitted, true);
    assert.equal(Object.hasOwn(result.command.plan, 'args'), false);
    assert.equal(result.command.mergeAuthority, false); assert.equal(result.command.pcRestartAuthority, false);
    assert.equal(JSON.stringify(result).includes('BODY_CANARY'), false);
    assert.equal(JSON.stringify(result).includes(pdf.path), false);
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
  assert.equal(calls, 2);
});

test('actual feedback is persisted in the existing workspace while receipts/history omit caller text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-feedback-integration-'));
  const repoRoot = join(root, 'repo'), workspaceRoot = join(root, 'shared');
  await mkdir(repoRoot);
  assert.equal((await ensureSharedWorkspaceLayout({ root: workspaceRoot, repoRoot })).ok, true);
  const { handler } = await ready({ repoRoot,
    feedbackIntakeFactory: options => createSovereignFeedbackIntakeV1({ ...options, workspaceRoot }) });
  const second = await ready();
  try {
    const original = await call(handler, 'submit_feedback', feedback);
    assert.equal(original.isError, false, JSON.stringify(original));
    assert.equal(value(original).feedbackState, 'PERSISTED');
    assert.equal(value(original).advisoryOnly, true);
    assert.equal(value(original).executionAuthority, false);
    const files = await readdir(join(workspaceRoot, 'events'));
    assert.equal(files.length, 1);
    const stored = await readFile(join(workspaceRoot, 'events', files[0]), 'utf8');
    assert.ok(stored.includes(feedback.message));
    assert.ok(stored.includes('CALLER_SUBMITTED_UNVERIFIED'));
    assert.equal(stored.includes('capabilityFailure'), false);
    assert.equal(stored.includes('learningCandidate'), false);
    const callId = original.structuredContent.command.commandId;
    const history = value(await call(handler, 'get_recent_tool_calls', {}));
    assert.equal(history.calls[0].tool, 'submit_feedback');
    const retained = value(await call(handler, 'get_tool_result', { callId }));
    assert.equal(retained.resultAvailable, true);
    for (const result of [original, history, retained]) {
      assert.equal(JSON.stringify(result).includes(feedback.message), false);
      assert.equal(JSON.stringify(result).includes(workspaceRoot), false);
    }
    assert.equal((await call(second.handler, 'get_tool_result', { callId })).isError, true);
    assert.equal((await readdir(join(workspaceRoot, 'events'))).length, 1, 'history cannot republish feedback');
  } finally { await handler.close(); await second.handler.close(); await rm(root, { recursive: true, force: true }); }
});

test('recognized credential text is removed before the canonical feedback envelope observes it', async () => {
  const canary = 'sk_FAKE_CREDENTIAL_CANARY_1234567890';
  let observed;
  const { handler } = await ready({ executor: async command => { observed = command; return { ok: true }; } });
  try {
    const response = await call(handler, 'submit_feedback', { ...feedback, message: `Please improve this error. api_key=${canary}` });
    assert.equal(response.isError, false); assert.ok(observed);
    assert.equal(JSON.stringify(observed).includes(canary), false);
    assert.equal(JSON.stringify(response).includes(canary), false);
  } finally { await handler.close(); }
});

test('missing, contradictory or thrown publication evidence stays UNKNOWN with no automatic retry', async () => {
  for (const [operation, args, paths, option, stateKey, successState] of [
    ['SUBMIT_FEEDBACK', feedback, [], 'feedbackIntake', 'feedbackState', 'PERSISTED'],
    ['WRITE_PDF', pdf, [pdf.path], 'pdfWrites', 'mutationState', 'CREATED'],
  ]) {
    for (const execute of [async () => undefined, async () => ({ ok: true }),
      async () => ({ ok: false, [stateKey]: successState }),
      async () => { throw new Error('PRIVATE_PUBLICATION_ERROR'); }]) {
      let calls = 0;
      const result = await executeSovereignCommanderCommandV1(envelope(operation, args, paths), {
        routeProof: privateRoute, [option]: { execute: (...inputs) => { calls++; return execute(...inputs); } },
      });
      assert.equal(result.ok, false); assert.equal(calls, 1);
      assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
      assert.equal(result.structuredContent[stateKey], 'UNKNOWN');
      assert.equal(result.structuredContent.retryAllowed, false);
      assert.equal(JSON.stringify(result).includes('BODY_CANARY'), false);
      assert.equal(JSON.stringify(result).includes('PRIVATE_PUBLICATION_ERROR'), false);
    }
    const refused = await executeSovereignCommanderCommandV1(envelope(operation, args, paths), {
      routeProof: privateRoute, [option]: { execute: async () => ({ ok: false, [stateKey]: 'NOT_STARTED' }) },
    });
    assert.equal(refused.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED');
  }
});

test('closing a private handler neither cancels nor replays an already owned PDF creation', async () => {
  let finish, calls = 0;
  const { handler } = await ready({ pdfWriteExecutor: () => {
    calls++; return new Promise(resolve => { finish = resolve; });
  } });
  const pending = call(handler, 'write_pdf', pdf, http);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  await handler.close();
  finish({ ok: false, mutationState: 'UNKNOWN', retryAllowed: false });
  const result = await pending;
  assert.equal(result.structuredContent.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_EFFECT_UNKNOWN');
  assert.equal(value(result).mutationState, 'UNKNOWN');
  assert.equal(JSON.stringify(result).includes('BODY_CANARY'), false);
  await assert.rejects(call(handler, 'write_pdf', pdf), /MCP_SESSION_CLOSED/);
  assert.equal(calls, 1);
});

test('actual HTTP authentication gates both tools and DELETE makes the originating handler unusable', { timeout: 12000 }, async () => {
  const token = 'feedback-pdf-http-test-'.padEnd(64, 'x');
  const handlers = [];
  let feedbackCalls = 0, pdfCalls = 0, id = 1;
  const created = await createSovereignCommanderHttpServer({ token, host: '127.0.0.1', port: 0,
    continuousRepairEnabled: false, handlerFactory() {
      const handler = createSovereignCommanderMcpHandler({
        feedbackIntakeFactory: () => ({ execute: async (_operation, _args, route) => {
          assert.equal(route.transport, 'authenticated-http-jsonrpc'); assert.equal(route.authenticatedMcp, true);
          feedbackCalls++; return { ok: true, feedbackState: 'PERSISTED', advisoryOnly: true, executionAuthority: false };
        }, dispose() {} }),
        pdfWriteExecutor: async () => { pdfCalls++; return { ok: true, mutationState: 'CREATED', sha256: 'b'.repeat(64), bytes: 123 }; },
      }); handlers.push(handler); return handler;
    } });
  await new Promise((resolve, reject) => { created.server.once('error', reject); created.server.listen(0, created.host, resolve); });
  const url = `http://127.0.0.1:${created.server.address().port}/mcp`;
  async function rpc(method, params = {}, sessionId, authorized = true) {
    const headers = { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
    const response = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: id++ }), method, params }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, sessionId: response.headers.get('mcp-session-id') };
  }
  try {
    assert.equal((await rpc('initialize', {}, undefined, false)).status, 401);
    assert.equal(handlers.length, 0);
    const opened = await rpc('initialize'); assert.equal(opened.status, 200); const sessionId = opened.sessionId;
    await rpc('notifications/initialized', {}, sessionId); await rpc('tools/list', {}, sessionId);
    for (const [name, args] of [['submit_feedback', feedback], ['write_pdf', pdf]]) {
      assert.equal((await rpc('tools/call', { name, arguments: args }, sessionId, false)).status, 401);
      const response = await rpc('tools/call', { name, arguments: args }, sessionId);
      assert.equal(response.status, 200); assert.equal(response.body.result.isError, false);
      assert.equal(JSON.stringify(response).includes('BODY_CANARY'), false);
    }
    assert.equal(feedbackCalls, 1); assert.equal(pdfCalls, 1);
    const removed = await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'mcp-session-id': sessionId },
      signal: AbortSignal.timeout(4000) });
    assert.equal(removed.status, 204);
    const expired = await rpc('tools/call', { name: 'write_pdf', arguments: pdf }, sessionId);
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.message, 'MCP session required');
    assert.equal(pdfCalls, 1); assert.equal(feedbackCalls, 1);
  } finally {
    await new Promise((resolve, reject) => created.server.close(error => error ? reject(error) : resolve()));
    for (const handler of handlers) await handler.close();
  }
});
