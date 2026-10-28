import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { consumeControlTowerBuildRequestV1, createControlTowerBuildConsumerV1 } from './control-tower-build-consumer-v1.mjs';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { readControlTowerBuildRequestV1 } from '../shared/agents/controlTowerBuildReaderV1.mjs';
import { fixture, HEAD, NOW } from '../shared/agents/fixtures/controlTowerBuildV1.mjs';
import { runSovereignRelayCycleWithHeartbeat, buildSovereignRelayStatus } from './battle-bridge-sovereign-relay-daemon.mjs';

function setup(t, overrides = {}) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'control-tower-test-'));
  t.after(() => { if (!root.startsWith(parent + sep + 'control-tower-test-')) throw Error('Unsafe fixture cleanup'); rmSync(root, { recursive: true }); });
  const f = fixture(), calls = [];
  const options = { sourceHead: HEAD, env: { STEPHANOS_SHARED_WORKSPACE_ROOT: root }, repoRoot: root, readSourceHead: async () => HEAD,
    now: () => new Date(NOW), testOnly: true, dependencies: {
      resolveAuth: async () => ({ token: 'fixture-only' }),
      readRequest: args => readControlTowerBuildRequestV1({ ...args, fetchImpl: f.fetchImpl }),
      execute: async args => { calls.push(args); return { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
        command: { plan: { processId: 'goal-discovery-heartbeat' } }, proofHash: 'b'.repeat(64) }; },
      ...overrides,
    } };
  return { root, f, calls, options, consume: extra => consumeControlTowerBuildRequestV1({ ...options, ...extra }) };
}

test('owner dispatch to authenticated artifact to original guarded build action has one durable invocation', async t => {
  const s = setup(t), result = await s.consume();
  assert.equal(result.state, 'WAKE_COMPLETED');
  assert.deepEqual(s.calls, [{ actionId: 'goal-discovery-heartbeat', arguments: { actionId: 'goal-discovery-heartbeat' }, timeoutMs: 60000 }]);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  assert.equal(ledger.read(result.requestId).phase, 'TERMINAL');
  assert.equal(ledger.read(result.requestId).terminalState, 'DONE');
  assert.equal(ledger.read(result.requestId).terminalProofHash, 'b'.repeat(64));
  assert.equal(ledger.read(result.requestId).issueNumber, 2315);
  assert.equal((await s.consume()).state, 'WAITING'); assert.equal(s.calls.length, 1);
  assert.equal(existsSync(join(s.root, 'receipts', 'execution-receipts.jsonl')), false);
  for (const flag of ['buildStartedProven', 'nativePickupProven', 'goalCompletionProven', 'sourceMutationAllowed', 'mergeAuthority', 'leaseSeizureAllowed'])
    assert.equal(result[flag], false);
});
test('two consumers racing the same authenticated request cannot launch twice', async t => {
  const s = setup(t); const results = await Promise.all([s.consume(), s.consume()]);
  assert.equal(results.filter(r => r.state === 'WAKE_COMPLETED').length, 1);
  assert.equal(s.calls.length, 1);
});
test('invalid terminal proof cannot discharge the original execution reservation', t => {
  const s = setup(t), ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  ledger.reserve({ requestId: 'control-tower-build-100-1', issueNumber: 2315 });
  assert.throws(() => ledger.complete({ requestId: 'control-tower-build-100-1', issueNumber: 2315,
    state: 'DONE', proofHash: 'unverified' }), /MAILBOX_EXECUTION_TERMINAL_PROOF_INVALID/);
  assert.equal(ledger.read('control-tower-build-100-1').phase, 'RESERVED');
});
test('existing custody refusal becomes a bounded blocked wake without a fabricated build', async t => {
  const s = setup(t, { execute: async () => ({ ok: false, blocker: 'MAINTENANCE_CUSTODY_STATE_MISSING',
    command: { plan: { processId: 'goal-discovery-heartbeat' } }, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' }) });
  const result = await s.consume(); assert.equal(result.state, 'WAKE_BLOCKED');
  assert.equal(result.blocker, 'MAINTENANCE_CUSTODY_STATE_MISSING'); assert.equal(result.nativePickupProven, false);
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(result.requestId).terminalState, 'BLOCKED');
});
test('a crash or missing terminal result retains the original reservation across new consumer instances', async t => {
  let calls = 0;
  const s = setup(t, { execute: async () => { calls++; throw Error('uncertain private response'); } });
  const first = await s.consume(); assert.equal(first.state, 'UNKNOWN');
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(first.requestId).phase, 'RESERVED');
  await s.consume(); assert.equal(calls, 1); assert.ok(!JSON.stringify(first).includes('private'));
});
test('an unavailable owner response may follow pickup and must retain an unknown reservation', async t => {
  let calls = 0;
  const s = setup(t, { execute: async () => { calls++; return { ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE' }; } });
  const result = await s.consume(); assert.equal(result.state, 'UNKNOWN');
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(result.requestId).phase, 'RESERVED');
  await s.consume(); assert.equal(calls, 1);
});
test('forged objects, source drift and expired observations cannot reach the owner', async t => {
  const s = setup(t, { readRequest: async () => ({ ok: true, request: { ...fixture().request } }) });
  assert.equal((await s.consume()).blocker, 'CONTROL_TOWER_BUILD_REQUEST_NOT_AUTHENTICATED');
  assert.equal(s.calls.length, 0);
  const g = setup(t); let reads = 0;
  assert.equal((await g.consume({ readSourceHead: async () => ++reads < 3 ? HEAD : 'c'.repeat(40) })).blocker,
    'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED');
  assert.equal(g.calls.length, 0);
  const h = setup(t); let clocks = 0;
  const expired = await h.consume({ now: () => new Date(++clocks < 2 ? NOW : '2026-10-28T12:11:00.000Z') });
  assert.notEqual(expired.state, 'WAKE_COMPLETED'); assert.equal(h.calls.length, 0);
});
test('a failed ledger or terminal write cannot be converted into executed or completed truth', async t => {
  const s = setup(t, { createLedger: () => { throw Error('unsafe ledger'); } });
  assert.equal((await s.consume()).state, 'HELD'); assert.equal(s.calls.length, 0);
  const g = setup(t, { createLedger: () => ({ has: () => false, reserve: () => {}, complete: () => { throw Error('lost receipt'); } }) });
  const result = await g.consume(); assert.equal(result.state, 'UNKNOWN'); assert.equal(g.calls.length, 1);
  assert.equal(result.buildStartedProven, false);
});
test('wrong owner action or missing proof is never a successful wake', async t => {
  for (const owned of [{ ok: true }, { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    command: { plan: { processId: 'repair-stephanos' } }, proofHash: 'b'.repeat(64) }]) {
    const s = setup(t, { execute: async () => owned }); assert.equal((await s.consume()).state, 'UNKNOWN');
  }
});
test('relay cooldown coalesces overlapping reads and re-observes after 30 seconds', async t => {
  const s = setup(t); let at = new Date(NOW);
  const observe = createControlTowerBuildConsumerV1({ ...s.options, now: () => at });
  const [a, b] = await Promise.all([observe(), observe()]); assert.equal(a, b); assert.equal(s.calls.length, 1);
  at = new Date(at.getTime() + 29999); assert.equal(await observe(), a);
  at = new Date(at.getTime() + 1); assert.equal((await observe()).state, 'WAITING'); assert.equal(s.calls.length, 1);
});
test('existing relay heartbeat checks build transport while the legacy carrier remains in flight', async () => {
  let releaseMailbox, releaseBuild, tick;
  const mailbox = new Promise(resolve => { releaseMailbox = resolve; });
  const build = new Promise(resolve => { releaseBuild = resolve; });
  const writes = []; let buildReads = 0;
  const task = runSovereignRelayCycleWithHeartbeat({ statusPath: '/fixed-fixture-status',
    runCycle: () => mailbox, observeBuild: async () => { buildReads++; return build; },
    writeStatus: async (_path, value) => { writes.push(value); },
    setTimeoutFn: callback => { tick = callback; return { unref() {} }; }, clearTimeoutFn: () => {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(buildReads, 1); tick(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(writes.length >= 2); assert.equal(buildReads, 1);
  releaseBuild({ state: 'WAKE_BLOCKED', blocker: 'MAINTENANCE_CUSTODY_STATE_MISSING' });
  await new Promise(resolve => setImmediate(resolve));
  tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.at(-1).controlTowerBuild.state, 'WAKE_BLOCKED');
  releaseMailbox({ ok: false, blocker: 'LEGACY_MAILBOX_FULL' });
  const result = await task; assert.equal(result.blocker, 'LEGACY_MAILBOX_FULL');
  assert.equal(result.controlTowerBuild.blocker, 'MAINTENANCE_CUSTODY_STATE_MISSING');
  const status = buildSovereignRelayStatus({ cycle: result });
  assert.equal(status.controlTowerBuild.state, 'WAKE_BLOCKED'); assert.equal(status.carrierHealthy, false);
});
