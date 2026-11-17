import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSovereignCommanderMcpHandler } from '../../scripts/sovereign-commander-mcp.mjs';
import { createSovereignMcpSessionConfigV1 } from './sovereignMcpSessionConfigV1.mjs';
import { executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { buildStephanosExecutionCommandEnvelopeV1, STEPHANOS_EXECUTION_SURFACE } from './stephanosExecutionCommandFabricV1.mjs';

const local = { id: 1, isRequest: true, isNotification: false, transportKind: 'local-stdio-mcp', transportAuthenticated: false };
const http = { ...local, transportKind: 'authenticated-http-jsonrpc', transportAuthenticated: true };
const call = (handler, name, args = {}, transport = local) => handler('tools/call', { name, arguments: args }, transport);
const operation = response => response.structuredContent;
const value = response => operation(response).structuredContent;
const set = (handler, key, value, expectedRevision, transport = local) => call(handler, 'set_config_value', { key, value, expectedRevision }, transport);
async function ready(options = {}) {
  const handler = createSovereignCommanderMcpHandler(options);
  await handler('initialize', {}, local);
  await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
  const listed = await handler('tools/list', {}, local);
  return { handler, listed };
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-config-'));
  const file = join(root, 'source.txt');
  await writeFile(file, Array.from({ length: 1205 }, (_, i) => `line-${i}`).join('\n'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, file };
}
function envelope(operation, targetPaths = [], payload = {}) {
  return buildStephanosExecutionCommandEnvelopeV1({
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'session-config-fixture', missionId: 'config-fixture', relatedIssue: '#2573', operation, targetPaths, payload,
  });
}

test('configuration is discoverable, session scoped, and a real private request is required to change it', async () => {
  const { handler, listed } = await ready();
  try {
    const tool = listed.tools.find(tool => tool.name === 'set_config_value'); assert.ok(tool);
    assert.equal(tool.annotations.readOnlyHint, false); assert.equal(tool.inputSchema.additionalProperties, false);
    const initial = value(await call(handler, 'get_config')).sessionConfiguration;
    assert.equal(initial.revision, 0); assert.equal(initial.persistent, false);
    assert.deepEqual(initial.values, { fileReadLineLimit: 1000, fileWriteLineLimit: null });
    assert.match(initial.semantics.fileWriteLineLimit, /not a total-file line limit/);
    for (const transport of [{ id: 1, isRequest: true }, { ...http, transportAuthenticated: false },
      { ...local, isRequest: false, isNotification: true }, { ...http, transportKind: 'public-mailbox' }]) {
      const denied = await set(handler, 'fileReadLineLimit', 2, 0, transport);
      assert.equal(denied.isError, true); assert.equal(operation(denied).blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
    }
    assert.equal(value(await call(handler, 'get_config')).sessionConfiguration.revision, 0);
    const changed = await set(handler, 'fileReadLineLimit', 2, 0, http);
    assert.equal(changed.isError, false); assert.equal(operation(changed).command.operation, 'SET_CONFIG_VALUE');
    assert.equal(operation(changed).command.plan.family, 'config');
    assert.equal(operation(changed).command.mergeAuthority, false);
    assert.match(operation(changed).proofHash, /^[a-f0-9]{64}$/);
  } finally { await handler.close(); }
});

test('actual reads obey the session cap and preserve requested defaults, batch caps and text budgets', async t => {
  const { root, file } = await fixture(t); const { handler } = await ready();
  try {
    assert.equal(value(await call(handler, 'read_file', { path: file })).length, 200);
    assert.equal(value(await call(handler, 'read_multiple_files', { paths: [file] })).files[0].length, 100);
    await set(handler, 'fileReadLineLimit', 3, 0);
    const single = await call(handler, 'read_file', { path: file, offset: 1, length: 1000 });
    assert.equal(operation(single).contentText, 'line-1\nline-2\nline-3');
    assert.equal(value(single).length, 3); assert.equal(value(single).requestedLength, 1000);
    assert.equal(value(single).sessionConfigRevision, 1);
    const batch = value(await call(handler, 'read_multiple_files', { paths: [file, file], length: 200 }));
    assert.deepEqual(batch.files.map(row => row.length), [3, 3]); assert.equal(batch.effectiveReadLineLimit, 3);
    await set(handler, 'fileReadLineLimit', 1000, 1);
    assert.equal(value(await call(handler, 'read_file', { path: file, length: 1000 })).length, 1000);
    assert.equal(value(await call(handler, 'read_multiple_files', { paths: [file], length: 200 })).files[0].length, 200);
    const long = join(root, 'long.txt'); await writeFile(long, 'x'.repeat(20000));
    const bounded = value(await call(handler, 'read_multiple_files', { paths: [long, file], length: 200 }));
    assert.equal(bounded.files[0].content.length, 16 * 1024); assert.equal(bounded.files[0].truncated, true);
    assert.equal(bounded.files[1].content, ''); assert.equal(bounded.contentBudgetExhausted, true);
    assert.equal((await call(handler, 'read_multiple_files', { paths: Array(9).fill(file) })).isError, true);
  } finally { await handler.close(); }
});

test('write, append and replacement payload limits reject before mutation; null restores prior behavior', async t => {
  const { root, file } = await fixture(t); const { handler } = await ready();
  try {
    await set(handler, 'fileWriteLineLimit', 2, 0);
    const original = await readFile(file, 'utf8');
    for (const mode of ['rewrite', 'append']) {
      const denied = await call(handler, 'write_file', { path: file, content: 'one\ntwo\nthree', mode });
      assert.equal(denied.isError, true); assert.equal(operation(denied).blocker, 'SOVEREIGN_SESSION_WRITE_LINE_LIMIT_EXCEEDED');
      assert.equal(await readFile(file, 'utf8'), original);
    }
    const deniedEdit = await call(handler, 'edit_file', { path: file, oldString: 'line-0\n', newString: 'one\rtwo\rthree' });
    assert.equal(deniedEdit.isError, true); assert.equal(await readFile(file, 'utf8'), original);
    const absent = join(root, 'must-not-create.txt');
    assert.equal((await call(handler, 'write_file', { path: absent, content: 'one\ntwo\nthree' })).isError, true);
    await assert.rejects(stat(absent), { code: 'ENOENT' });
    const written = await call(handler, 'write_file', { path: file, content: 'one\r\ntwo\r\n' });
    assert.equal(written.isError, false); assert.equal(value(written).submittedLines, 2);
    assert.equal(value(written).sessionConfigRevision, 1); assert.equal(value(written).fileWriteLineLimit, 2);
    assert.equal(await readFile(file, 'utf8'), 'one\r\ntwo\r\n');
    const appended = await call(handler, 'write_file', { path: file, content: 'three\nfour', mode: 'append' });
    assert.equal(appended.isError, false); assert.equal(await readFile(file, 'utf8'), 'one\r\ntwo\r\nthree\nfour');
    const edited = await call(handler, 'edit_file', { path: file, oldString: 'one', newString: 'uno\neins' });
    assert.equal(edited.isError, false); assert.equal(value(edited).submittedLines, 2);
    assert.match(await readFile(file, 'utf8'), /^uno\neins\r\ntwo/);
    const reset = await set(handler, 'fileWriteLineLimit', null, 1);
    assert.equal(value(reset).change.previousValue, 2); assert.equal(value(reset).revision, 2);
    const manyLines = 'a\n'.repeat(10001);
    assert.equal((await call(handler, 'write_file', { path: file, content: manyLines })).isError, false);
    assert.equal(await readFile(file, 'utf8'), manyLines);
    const tooManyBytes = await call(handler, 'write_file', { path: file, content: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(tooManyBytes.isError, true); assert.equal(operation(tooManyBytes).blocker, 'sovereign-commander-write-content-invalid');
    assert.equal(await readFile(file, 'utf8'), manyLines);
  } finally { await handler.close(); }
});

test('read caps retain existing LF/CRLF line parsing while write payloads also count bare CR', async t => {
  const { file } = await fixture(t); const { handler } = await ready();
  try {
    await writeFile(file, 'one\rtwo\rthree');
    await set(handler, 'fileReadLineLimit', 1, 0);
    const read = await call(handler, 'read_file', { path: file, length: 1000 });
    assert.equal(value(read).length, 1); assert.equal(operation(read).contentText, 'one\rtwo\rthree');
    const config = value(await call(handler, 'get_config')).sessionConfiguration;
    assert.match(config.semantics.fileReadLineLimit, /bare CR is not a read-line delimiter/);
    await set(handler, 'fileWriteLineLimit', 1, 1);
    const denied = await call(handler, 'write_file', { path: file, content: 'a\rb' });
    assert.equal(denied.isError, true); assert.equal(await readFile(file, 'utf8'), 'one\rtwo\rthree');
  } finally { await handler.close(); }
});

test('admission captures settings before IO; concurrent CAS commits only one change', async t => {
  const { file } = await fixture(t); const { handler } = await ready();
  try {
    const alreadyAdmitted = call(handler, 'read_file', { path: file, length: 25 });
    const change = set(handler, 'fileReadLineLimit', 1, 0);
    const [read, changed] = await Promise.all([alreadyAdmitted, change]);
    assert.equal(changed.isError, false); assert.equal(value(read).length, 25); assert.equal(value(read).sessionConfigRevision, 0);
    assert.equal(value(await call(handler, 'read_file', { path: file, length: 25 })).length, 1);
    const competing = await Promise.all([set(handler, 'fileReadLineLimit', 2, 1), set(handler, 'fileReadLineLimit', 3, 1)]);
    assert.equal(competing.filter(result => !result.isError).length, 1);
    assert.equal(competing.filter(result => result.isError).length, 1);
    const denied = competing.find(result => result.isError);
    assert.equal(operation(denied).blocker, 'SOVEREIGN_SESSION_CONFIG_REVISION_CONFLICT');
    assert.equal(value(await call(handler, 'get_config')).sessionConfiguration.revision, 2);
  } finally { await handler.close(); }
});

test('config cannot be supplied through tool arguments and handlers remain isolated through close', async t => {
  const { file } = await fixture(t); const left = await ready(), right = await ready();
  try {
    await set(left.handler, 'fileReadLineLimit', 1, 0);
    const rightConfig = value(await call(right.handler, 'get_config')).sessionConfiguration;
    assert.equal(rightConfig.values.fileReadLineLimit, 1000); assert.equal(rightConfig.revision, 0);
    const rightRead = value(await call(right.handler, 'read_file', { path: file, length: 4 }));
    assert.equal(rightRead.length, 4);
    const injected = value(await call(left.handler, 'read_file', { path: file, length: 4,
      sessionConfig: { values: { fileReadLineLimit: 1000 } }, fileReadLineLimit: 1000 }));
    assert.equal(injected.length, 1);
    for (const args of [{ key: 'allowedDirectories', value: [], expectedRevision: 1 },
      { key: 'fileReadLineLimit', value: 1001, expectedRevision: 1 },
      { key: 'fileReadLineLimit', value: 1, expectedRevision: '1' },
      { key: 'fileReadLineLimit', value: 1, expectedRevision: 1, sessionId: 'other' }])
      assert.equal((await call(left.handler, 'set_config_value', args)).isError, true);
    await left.handler.close(); await left.handler.close();
    await assert.rejects(call(left.handler, 'get_config'), /MCP_SESSION_CLOSED/);
    assert.equal(value(await call(right.handler, 'get_config')).sessionConfiguration.revision, 0);
  } finally { await left.handler.close(); await right.handler.close(); }
});

test('own-session history retains exact config before/after without replaying an old setting', async () => {
  const { handler } = await ready();
  try {
    const first = await set(handler, 'fileReadLineLimit', 3, 0);
    const original = operation(first), callId = original.command.commandId;
    assert.equal(first.isError, false);
    await set(handler, 'fileReadLineLimit', 7, 1);
    const history = value(await call(handler, 'get_recent_tool_calls'));
    assert.equal(history.calls.filter(row => row.tool === 'set_config_value').length, 2);
    const retained = value(await call(handler, 'get_tool_result', { callId }));
    assert.equal(retained.resultAvailable, true);
    assert.deepEqual(retained.result.structuredContent.change, {
      key: 'fileReadLineLimit', previousValue: 1000, value: 3, previousRevision: 0, changed: true,
    });
    assert.equal(retained.result.structuredContent.revision, 1);
    assert.equal(retained.result.proofHash, original.proofHash);
    const current = value(await call(handler, 'get_config')).sessionConfiguration;
    assert.equal(current.revision, 2); assert.equal(current.values.fileReadLineLimit, 7);
  } finally { await handler.close(); }
});

test('canonical non-MCP config and IO preserve legacy behavior; invalid supplied state cannot fall back', async t => {
  const { file } = await fixture(t);
  const config = await executeSovereignCommanderCommandV1(envelope('GET_CONFIG'));
  assert.equal(config.ok, true); assert.equal(config.structuredContent.sessionConfiguration, undefined);
  const legacy = await executeSovereignCommanderCommandV1(envelope('READ_FILE', [file], { length: 4 }));
  assert.equal(legacy.ok, true); assert.equal(legacy.structuredContent.length, 4);
  const service = createSovereignMcpSessionConfigV1();
  for (const options of [{ sessionConfig: undefined }, { sessionConfig: {} },
    { sessionConfig: { getSnapshot: () => ({ ...service.getSnapshot(), values: { fileReadLineLimit: 2000, fileWriteLineLimit: null } }) } }]) {
    assert.equal((await executeSovereignCommanderCommandV1(envelope('READ_FILE', [file], { length: 4 }), options)).blocker, 'SOVEREIGN_SESSION_CONFIG_UNAVAILABLE');
  }
  const setter = envelope('SET_CONFIG_VALUE', [], { key: 'fileReadLineLimit', value: 2, expectedRevision: 0 });
  assert.equal((await executeSovereignCommanderCommandV1(setter, { sessionConfig: service })).blocker, 'SOVEREIGN_PRIVATE_SESSION_REQUIRED');
  const options = { sessionConfig: service, routeProof: { mcpSessionReady: true, commandPathProven: true,
    transport: 'local-stdio-mcp', authenticatedMcp: false } };
  assert.equal((await executeSovereignCommanderCommandV1(setter, options)).ok, true);
  assert.equal((await executeSovereignCommanderCommandV1({ ...setter, targetPaths: [file] }, options)).ok, false);
  service.dispose();
  assert.equal((await executeSovereignCommanderCommandV1(envelope('GET_CONFIG'), options)).blocker, 'SOVEREIGN_SESSION_CONFIG_UNAVAILABLE');
});
