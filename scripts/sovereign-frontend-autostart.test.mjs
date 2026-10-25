import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { claimFrontendBootAttempt, publishFrontendStartupResult, runFrontendAutostart } from './sovereign-frontend-autostart.mjs';

const head = 'a'.repeat(40);
const witness = { machineHash: 'b'.repeat(64), bootStartedAtUtc: '2026-10-25T22:59:27.5000000Z' };
const health = { ok: true, service: 'stephanos-sovereign-commander', continuousRepairGuardian: {
  timeoutCustodyHeld: false, running: false, maintenanceInFlight: false, persistentCustody: { held: false },
} };
function fixture({ healthBody = health, actions = ['repair-ui-4173'], commandThrows = false, postProof = true } = {}) {
  const calls = [];
  let dispatched = false;
  const response = (body, headers = {}) => ({ ok: true, headers: { get: key => headers[key] || null },
    json: async () => body, text: async () => body === null ? '' : JSON.stringify(body) });
  const options = {
    approved: true, sourceReader: () => head, bootReader: () => witness,
    tokenReader: async () => 'private-test-token'.repeat(3), claim: () => true,
    sleep: async () => {}, attempts: 2, gamingSafe: () => true, proof: async () => ({ ready: dispatched && postProof }),
    fetchFn: async (url, request) => {
      if (url.endsWith('/health')) return response(healthBody);
      assert.equal(url, 'http://127.0.0.1:18791/mcp');
      const message = JSON.parse(request.body); calls.push(message);
      if (message.method === 'initialize') return response({ result: {} }, { 'mcp-session-id': 'session' });
      assert.equal(request.headers['mcp-session-id'], 'session');
      if (message.method === 'notifications/initialized') return response(null);
      if (message.method === 'tools/list') return response({ result: { tools: [{ name: 'maintenance_action', inputSchema: { properties: { actionId: { enum: actions } } } }] } });
      assert.deepEqual(message.params, { name: 'maintenance_action', arguments: { actionId: 'repair-ui-4173' } });
      dispatched = true;
      if (commandThrows) throw new Error('uncertain command transport');
      return response({ result: { isError: true, structuredContent: { ok: false, finalVerdict: 'REPAIR_NOT_READY_AT_TIMEOUT' } } });
    },
  };
  return { options, calls };
}

test('approval and canonical source fail closed before transport', async () => {
  const f = fixture();
  assert.equal((await runFrontendAutostart({ ...f.options, approved: false })).blocker, 'FRONTEND_AUTOSTART_INSTALL_APPROVAL_REQUIRED');
  assert.equal((await runFrontendAutostart({ ...f.options, sourceReader: () => { throw new Error('unpublished'); } })).blocker, 'FRONTEND_AUTOSTART_CANONICAL_SOURCE_UNPROVEN');
  assert.equal(f.calls.length, 0);
});
test('exact-head ready server is reused without a mutation, token read or boot claim', async () => {
  const f = fixture();
  const result = await runFrontendAutostart({ ...f.options, proof: async () => ({ ready: true }),
    tokenReader: () => { throw new Error('must not read'); }, claim: () => { throw new Error('must not claim'); } });
  assert.equal(result.ok, true); assert.equal(result.actionAttempted, false); assert.equal(f.calls.length, 0);
});
test('held, busy or unknown guardian cannot admit startup', async () => {
  for (const delta of [{ timeoutCustodyHeld: true }, { maintenanceInFlight: true }, { running: true }, { persistentCustody: { held: true } }, { persistentCustody: {} }]) {
    const f = fixture({ healthBody: { ...health, continuousRepairGuardian: { ...health.continuousRepairGuardian, ...delta } } });
    const result = await runFrontendAutostart(f.options);
    assert.equal(result.blocker, 'FRONTEND_AUTOSTART_GUARDIAN_NOT_ADMITTED'); assert.equal(f.calls.length, 0);
  }
});
test('fixed UI action must be advertised; broad ignition/control-plane fallback is forbidden', async () => {
  const f = fixture({ actions: ['ignite-stephanos', 'repair-control-plane'] });
  const result = await runFrontendAutostart(f.options);
  assert.equal(result.actionAttempted, false); assert.equal(f.calls.some(call => call.method === 'tools/call'), false);
});
test('gaming protection cannot be bypassed by a healthy guardian', async () => {
  const f = fixture(); const result = await runFrontendAutostart({ ...f.options, gamingSafe: () => false });
  assert.equal(result.ok, false); assert.equal(result.actionAttempted, false); assert.equal(f.calls.length, 0);
});
test('gaming guard is rechecked immediately before boot claim and dispatch', async () => {
  const f = fixture(); let checks = 0;
  const result = await runFrontendAutostart({ ...f.options, gamingSafe: () => ++checks === 1,
    claim: () => { throw new Error('must not claim'); } });
  assert.equal(result.blocker, 'FRONTEND_AUTOSTART_GAMING_PROTECTION_HELD');
  assert.equal(f.calls.some(call => call.method === 'tools/call'), false);
});
test('source advancement before dispatch prevents mutation', async () => {
  const f = fixture(); let reads = 0;
  const result = await runFrontendAutostart({ ...f.options, sourceReader: () => ++reads > 2 ? 'c'.repeat(40) : head });
  assert.equal(result.blocker, 'FRONTEND_AUTOSTART_SOURCE_CHANGED'); assert.equal(f.calls.some(call => call.method === 'tools/call'), false);
});
test('source advancement during an awaited reuse proof cannot publish ready', async () => {
  const f = fixture(); let currentHead = head;
  const result = await runFrontendAutostart({ ...f.options, sourceReader: () => currentHead,
    proof: async () => { currentHead = 'c'.repeat(40); return { ready: true }; } });
  assert.equal(result.ok, false); assert.equal(f.calls.some(call => call.method === 'tools/call'), false);
});
test('source advancement during awaited late completion proof cannot turn a failed command green', async () => {
  const f = fixture(); let currentHead = head;
  const originalProof = f.options.proof;
  const result = await runFrontendAutostart({ ...f.options, sourceReader: () => currentHead,
    proof: async () => { const served = await originalProof(); if (served.ready) currentHead = 'c'.repeat(40); return served; } });
  assert.equal(result.ok, false); assert.equal(result.actionAttempted, true);
  assert.equal(f.calls.filter(call => call.method === 'tools/call').length, 1);
});
test('existing boot attempt prevents startup/logon duplicate mutation', async () => {
  const f = fixture();
  const result = await runFrontendAutostart({ ...f.options, claim: () => false });
  assert.equal(result.blocker, 'FRONTEND_BOOT_ATTEMPT_ALREADY_RESERVED'); assert.equal(f.calls.some(call => call.method === 'tools/call'), false);
});
test('late cold-start readiness preserves original failed command verdict', async () => {
  const f = fixture(); const result = await runFrontendAutostart(f.options);
  assert.equal(result.ok, true); assert.equal(result.servedExactHeadProven, true);
  assert.equal(result.commandOk, false); assert.equal(result.commandVerdict, 'REPAIR_NOT_READY_AT_TIMEOUT');
  assert.equal(f.calls.filter(call => call.method === 'tools/call').length, 1);
});
test('uncertain transport cannot trigger another command or manufacture green', async () => {
  const f = fixture({ commandThrows: true, postProof: false }); const result = await runFrontendAutostart(f.options);
  assert.equal(result.ok, false); assert.equal(result.actionAttempted, true); assert.equal(result.commandVerdict, 'UNKNOWN');
  assert.equal(f.calls.filter(call => call.method === 'tools/call').length, 1);
  assert.equal(JSON.stringify(result).includes('private-test-token'), false);
});
test('same-boot claims serialize atomically; later boot is a different diagnostic', async () => {
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'stephanos-frontend-startup-'));
  mkdirSync(resolve(workspaceRoot, 'status'));
  const args = { workspaceRoot, witness, expectedHead: head };
  assert.equal(claimFrontendBootAttempt(args), true);
  assert.equal(claimFrontendBootAttempt(args), false);
  assert.equal(claimFrontendBootAttempt({ ...args, witness: { ...witness, bootStartedAtUtc: '2026-10-26T00:00:00Z' } }), true);
});
test('startup adapter and installer have narrow Windows entry and preserve existing tasks', () => {
  const installer = readFileSync(new URL('./windows/install-stephanos-frontend-autostart.ps1', import.meta.url), 'utf8');
  assert.match(installer, /FRONTEND_AUTOSTART_TASK_ALREADY_EXISTS/);
  assert.match(installer, /-LogonType S4U -RunLevel Limited/);
  assert.match(installer, /New-ScheduledTaskTrigger -AtStartup/);
  assert.doesNotMatch(installer, /Register-ScheduledTask[^\n]*-Force/);
  assert.doesNotMatch(installer, /Stop-Process|Restart-Computer|Unregister-ScheduledTask|Set-ScheduledTask/);
});
test('terminal receipt uses canonical shared workspace writer and preserves actual boot and result', async () => {
  const actual = { ok: false, actionAttempted: true, commandVerdict: 'UNKNOWN' };
  let published;
  const result = await publishFrontendStartupResult(actual, { workspaceRoot: 'test-root', bootReader: () => witness,
    writer: async (root, segments, record, options) => { published = { root, segments, record, options }; return { ok: true }; } });
  assert.equal(result.ok, true);
  assert.deepEqual(published.segments, ['status', 'stephanos-frontend-autostart-current.json']);
  assert.deepEqual(published.record.result, actual); assert.deepEqual(published.record.bootWitness, witness);
  assert.equal(published.record.status, 'ATTENTION_REQUIRED'); assert.equal(published.options.durable, true);
});
test('real atomic workspace publication accepts both ready and blocked startup evidence', async () => {
  const workspaceRoot = mkdtempSync(resolve(tmpdir(), 'stephanos-frontend-receipt-'));
  for (const actual of [{ ok: true, expectedHead: head, reusedExisting: true, actionAttempted: false },
    { ok: false, expectedHead: head, actionAttempted: true, commandVerdict: 'UNKNOWN', blocker: 'FRONTEND_AUTOSTART_SERVED_HEAD_UNPROVEN' }]) {
    const written = await publishFrontendStartupResult(actual, { workspaceRoot, bootReader: () => witness, sourceReader: () => head });
    assert.equal(written.ok, true, JSON.stringify(written));
    const record = JSON.parse(readFileSync(resolve(workspaceRoot, 'status/stephanos-frontend-autostart-current.json')));
    assert.deepEqual(record.result, actual);
  }
});
test('source change during the awaited publication boot probe refuses a READY receipt', async () => {
  let currentHead = head, writes = 0;
  await assert.rejects(publishFrontendStartupResult({ ok: true, expectedHead: head }, {
    sourceReader: () => currentHead, bootReader: async () => { currentHead = 'c'.repeat(40); return witness; },
    writer: async () => { writes++; return { ok: true }; },
  }), /PUBLICATION_SOURCE_CHANGED/);
  assert.equal(writes, 0);
});
