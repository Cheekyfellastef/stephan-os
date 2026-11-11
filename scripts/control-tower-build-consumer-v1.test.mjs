import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { consumeControlTowerBuildRequestV1, createControlTowerBuildConsumerV1,
  CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS } from './control-tower-build-consumer-v1.mjs';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { readControlTowerBuildRequestV1 } from '../shared/agents/controlTowerBuildReaderV1.mjs';
import { fixture, HEAD, NOW } from '../shared/agents/fixtures/controlTowerBuildV1.mjs';
import { runSovereignRelayCycleWithHeartbeat, buildSovereignRelayStatus } from './battle-bridge-sovereign-relay-daemon.mjs';
import { FIXED_MAINTENANCE_RUNTIME_ROUTE_V1, fixedRuntimeMaintenanceActionQualifiedV1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { createControlTowerRequestObservationV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { projectControlTowerBuildBeaconFactsV1 } from '../shared/agents/controlTowerBuildBeaconFactsV1.mjs';
import { controlTowerRequestPointersFromRelayStatusV1 } from './control-tower-build-consumer-v1.mjs';
import { callSovereignMaintenanceOwnerV1,
  consumeSovereignMaintenancePreDispatchRefusalV1 } from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';

const poll = (state, blocker = '', extra = {}) => ({ schemaVersion: 'stephanos.control-tower-build-consumer.v1',
  state, blocker, observedAtUtc: NOW, buildStartedProven: false, nativePickupProven: false,
  goalCompletionProven: false, sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false, ...extra });

function setup(t, overrides = {}, fixtureOptions = {}) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'control-tower-test-'));
  t.after(() => { if (!root.startsWith(parent + sep + 'control-tower-test-')) throw Error('Unsafe fixture cleanup'); rmSync(root, { recursive: true }); });
  const f = fixture(fixtureOptions), calls = [];
  const options = { sourceHead: HEAD, env: { STEPHANOS_SHARED_WORKSPACE_ROOT: root }, repoRoot: root, readSourceHead: async () => HEAD,
    now: () => new Date(NOW), testOnly: true, dependencies: {
      resolveAuth: async () => ({ token: 'fixture-only' }),
      readRequest: args => readControlTowerBuildRequestV1({ ...args, fetchImpl: f.fetchImpl }),
      sleep: async () => {},
      execute: async args => { calls.push(args);
        // Use the SAME predicate as the real native Windows guardian. The old
        // heartbeat target is rejected here, so the lifecycle test detects
        // cross-module route drift rather than approving any fixture action.
        if (!fixedRuntimeMaintenanceActionQualifiedV1(args.actionId)) return {
          ok: false, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
          command: { plan: { processId: args.actionId } }, blocker: 'FIXED_RUNTIME_PROFILE_NOT_QUALIFIED' };
        return { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
          command: { plan: { processId: args.actionId } }, proofHash: 'b'.repeat(64) }; },
      ...overrides,
    } };
  return { root, f, calls, options, consume: extra => consumeControlTowerBuildRequestV1({ ...options, ...extra }) };
}

test('owner comment uses the original fixed owner and keeps its first run receipt on a later authenticated redelivery', async t => {
  const s = setup(t, {}, { ownerComment: true }), first = await s.consume();
  assert.equal(first.state, 'WAKE_COMPLETED'); assert.equal(first.requestId, 'control-tower-comment-700-1');
  assert.equal(first.runId, 100); assert.equal(first.ownerCommentId, 700);
  assert.deepEqual(s.calls, [{ actionId: 'repair-goal-builder-flow', arguments: { actionId: 'repair-goal-builder-flow' }, timeoutMs: 160000 }]);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const original = ledger.read(first.requestId);
  assert.equal(original.issueNumber, 2315); assert.equal(original.phase, 'TERMINAL');
  assert.equal(original.controlTowerObservation.runId, 100);
  assert.equal(original.controlTowerObservation.ownerCommentId, 700);
  const secondCarrier = fixture({ ownerComment: true, runId: 101 });
  s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({ ...args, fetchImpl: secondCarrier.fetchImpl });
  const second = await s.consume();
  assert.equal(second.state, 'WAITING'); assert.equal(s.calls.length, 1);
  assert.deepEqual(ledger.read(first.requestId), original, 'original run, time, head, digest and outcome must not be reconstructed');
  assert.equal(second.latestBuildRequestObservation.runId, 100);
  const relay = { schema: 'stephanos.sovereign-relay-daemon.v1', statusId: 'sovereign-relay-current',
    heartbeatAtUtc: NOW, sourceHead: HEAD, controlTowerBuild: first };
  const facts = projectControlTowerBuildBeaconFactsV1(relay, { expectedHead: HEAD, nowMs: Date.parse(NOW) });
  assert.equal(facts.observed, true); assert.equal(facts.runId, 100); assert.equal(facts.ownerCommentId, 700);
  assert.deepEqual(controlTowerRequestPointersFromRelayStatusV1(relay), {
    latestBuildRequestId: first.requestId, latestObserveRequestId: '',
  });
});

test('competing authenticated runs of one owner comment cannot obtain two original ledger reservations', async t => {
  const s = setup(t, {}, { ownerComment: true });
  const secondCarrier = fixture({ ownerComment: true, runId: 101 }); let readers = 0;
  s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({ ...args,
    fetchImpl: (++readers === 1 ? s.f : secondCarrier).fetchImpl });
  const results = await Promise.all([s.consume(), s.consume()]);
  assert.equal(results.filter(result => result.state === 'WAKE_COMPLETED').length, 1);
  assert.equal(s.calls.length, 1);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const inventory = ledger.inventory(); assert.equal(inventory.recordCount, 1);
  assert.equal(inventory.records[0].requestId, 'control-tower-comment-700-1');
  assert([100, 101].includes(inventory.records[0].controlTowerObservation.runId));
});

test('comment reservations, corrupt records and missing pointers retain custody across restart and later dispatches', async t => {
  for (const mode of ['reserved', 'corrupt', 'metadata-less-terminal', 'missing']) {
    let ownerCalls = 0;
    const s = setup(t, { execute: async () => { ownerCalls++; throw Error('outcome unknown'); } }, { ownerComment: true });
    const first = await s.consume(); assert.equal(first.state, 'UNKNOWN');
    const mailboxRoot = join(s.root, 'github-command-mailbox');
    const ledger = createMailboxExecutionLedger(mailboxRoot);
    const digest = mailboxRotationDigest(first.requestId);
    const recordPath = join(mailboxRoot, 'execution-ledger-v1', digest.slice(0, 2), digest + '.json');
    if (mode === 'corrupt') {
      const record = JSON.parse(readFileSync(recordPath)); record.controlTowerObservation.runId = 0;
      writeFileSync(recordPath, JSON.stringify(record));
    } else if (mode === 'metadata-less-terminal') {
      const record = JSON.parse(readFileSync(recordPath)); delete record.controlTowerObservation;
      record.phase = 'TERMINAL'; record.terminalState = 'DONE'; writeFileSync(recordPath, JSON.stringify(record));
    } else if (mode === 'missing') unlinkSync(recordPath);
    const nextCarrier = fixture({ runId: 102 });
    s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({ ...args, fetchImpl: nextCarrier.fetchImpl });
    const afterRestart = await s.consume({ latestBuildRequestId: first.requestId });
    assert.equal(afterRestart.state, 'HELD', mode); assert.equal(ownerCalls, 1, mode);
    assert.equal(afterRestart.latestBuildRequestObservation.requestId, first.requestId, mode);
    if (mode !== 'reserved') assert.equal(afterRestart.latestBuildRequestObservation.runId, null, 'never infer run ID from comment ID');
    assert.equal(ledger.has('control-tower-build-102-1'), false, mode);
  }
});

test('owner dispatch to authenticated artifact to original guarded build action has one durable invocation', async t => {
  const s = setup(t), result = await s.consume();
  assert.equal(result.state, 'WAKE_COMPLETED');
  assert.deepEqual(s.calls, [{ actionId: 'repair-goal-builder-flow', arguments: { actionId: 'repair-goal-builder-flow' }, timeoutMs: 160000 }]);
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
    command: { plan: { processId: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId } }, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' }) });
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

test('persistent real protocol rejection retries only the proven pre-dispatch window then terminalizes once', async t => {
  let credentialReads = 0, requests = 0, ownerCalls = 0, sleeps = 0;
  const s = setup(t, {
    sleep: async () => { sleeps++; },
    execute: async request => {
      ownerCalls++;
      return callSovereignMaintenanceOwnerV1(request, {
        readFileFn: async () => { credentialReads++; assert.fail('protocol rejection read credentials'); },
        fetchFn: async (url, options) => {
          requests++;
          assert.equal(url, 'http://127.0.0.1:18791/health?view=protocol');
          assert.equal(options.method, 'GET');
          return Response.json({ ok: true, service: 'stephanos-sovereign-commander' });
        },
      });
    },
  });
  const actual = await s.consume();
  assert.equal(credentialReads, 0);
  assert.equal(requests, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1);
  assert.equal(ownerCalls, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1);
  assert.equal(sleeps, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS);
  assert.equal(actual.state, 'WAKE_BLOCKED');
  assert.equal(actual.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
  const record = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(actual.requestId);
  assert.equal(record.phase, 'TERMINAL'); assert.equal(record.terminalState, 'BLOCKED');
  assert.equal(Object.hasOwn(record, 'terminalProofHash'), false, 'a blocked preflight has no completion proof');
  for (const flag of ['buildStartedProven', 'nativePickupProven', 'goalCompletionProven', 'sourceMutationAllowed', 'mergeAuthority', 'leaseSeizureAllowed'])
    assert.equal(actual[flag], false);
  await s.consume();
  assert.equal(ownerCalls, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1, 'terminal request is never replayed');
});

test('protocol refresh during the proven pre-dispatch window reuses the same reservation and completes once', async t => {
  let ownerCalls = 0, sleeps = 0, credentialReads = 0;
  const s = setup(t, {
    sleep: async () => { sleeps++; },
    execute: async request => {
      ownerCalls++;
      if (ownerCalls < 3) {
        return callSovereignMaintenanceOwnerV1(request, {
          readFileFn: async () => { credentialReads++; assert.fail('pre-dispatch refusal read credentials'); },
          fetchFn: async (_url, options) => {
            assert.equal(options.method, 'GET');
            return Response.json({ ok: true, service: 'stephanos-sovereign-commander' });
          },
        });
      }
      return {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
        command: { plan: { processId: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId } },
        proofHash: 'd'.repeat(64),
      };
    },
  });
  const actual = await s.consume();
  assert.equal(credentialReads, 0);
  assert.equal(ownerCalls, 3);
  assert.equal(sleeps, 2);
  assert.equal(actual.state, 'WAKE_COMPLETED');
  assert.equal(actual.blocker, '');
  const record = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(actual.requestId);
  assert.equal(record.phase, 'TERMINAL');
  assert.equal(record.terminalState, 'DONE');
  assert.equal(record.terminalProofHash, 'd'.repeat(64));
});

test('owner-comment pre-dispatch refusal terminalizes its original identity and dedupes another authenticated run', async t => {
  let credentialReads = 0, healthReads = 0, posts = 0, ownerCalls = 0;
  const s = setup(t, { execute: async request => {
    ownerCalls++;
    return callSovereignMaintenanceOwnerV1(request, {
      readFileFn: async () => { credentialReads++; assert.fail('protocol refusal read credentials'); },
      fetchFn: async (url, options) => {
        if (options.method === 'POST') posts++;
        assert.equal(url, 'http://127.0.0.1:18791/health?view=protocol');
        assert.equal(options.method, 'GET'); healthReads++;
        return Response.json({ ok: true, service: 'stephanos-sovereign-commander' });
      },
    });
  } }, { ownerComment: true });
  const first = await s.consume();
  assert.equal(first.state, 'WAKE_BLOCKED');
  assert.equal(first.blocker, 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED');
  assert.equal(first.requestId, 'control-tower-comment-700-1');
  assert.equal(first.runId, 100); assert.equal(first.ownerCommentId, 700);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const original = ledger.read(first.requestId);
  assert.equal(original.phase, 'TERMINAL'); assert.equal(original.terminalState, 'BLOCKED');
  assert.equal(Object.hasOwn(original, 'terminalProofHash'), false);
  for (const key of ['requestId', 'runId', 'sourceHead', 'createdAtUtc', 'expiresAtUtc',
    'ownerCommentId', 'ownerCommentIssueNumber', 'ownerCommentSha256'])
    assert.equal(original.controlTowerObservation[key], s.f.request[key], key);
  assert.equal(original.controlTowerObservation.state, 'WAKE_BLOCKED');
  assert.equal(original.controlTowerObservation.blocker, first.blocker);
  for (const flag of ['buildStartedProven', 'nativePickupProven', 'goalCompletionProven',
    'sourceMutationAllowed', 'mergeAuthority', 'leaseSeizureAllowed']) assert.equal(first[flag], false);

  const secondCarrier = fixture({ ownerComment: true, runId: 101 });
  s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({ ...args, fetchImpl: secondCarrier.fetchImpl });
  const second = await s.consume();
  assert.equal(second.state, 'WAITING');
  assert(secondCarrier.calls.some(call => call.url.endsWith('/actions/runs/101')),
    'redelivery must use the real reader against a distinct authentic run');
  assert.deepEqual(ledger.read(first.requestId), original,
    'redelivery preserves the original comment, actual run, source, digest and blocked outcome');
  assert.equal(ledger.inventory().recordCount, 1);
  assert.equal(second.latestBuildRequestObservation.requestId, first.requestId);
  assert.equal(second.latestBuildRequestObservation.runId, 100);
  assert.equal(second.latestBuildRequestObservation.state, 'WAKE_BLOCKED');
  assert.equal(ownerCalls, 1); assert.equal(healthReads, 1);
  assert.equal(credentialReads, 0); assert.equal(posts, 0);
});

test('plain flags, copied refusals and another invocation cannot prove pre-dispatch exclusion', async t => {
  const refuse = request => callSovereignMaintenanceOwnerV1(request, {
    readFileFn: async () => assert.fail('unexpected token read'),
    fetchFn: async (_url, options) => {
      assert.equal(options.method, 'GET'); return Response.json({ ok: true });
    },
  });
  for (const mode of ['plain', 'copied', 'other-request', 'already-consumed']) {
    const s = setup(t, { execute: async request => {
      if (mode === 'plain') return { ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_PROTOCOL_REQUIRED',
        beforeDispatchProven: true, localPreDispatchRefusal: true };
      if (mode === 'other-request') return refuse(Object.freeze({ ...request,
        arguments: Object.freeze({ ...request.arguments }) }));
      const actual = await refuse(request);
      if (mode === 'already-consumed') {
        assert.equal(consumeSovereignMaintenancePreDispatchRefusalV1(actual, request), true);
        return actual;
      }
      return { ...actual };
    } });
    const actual = await s.consume();
    assert.equal(actual.state, 'UNKNOWN', mode);
    assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(actual.requestId).phase,
      'RESERVED', mode);
  }
});

test('a crash publishing pre-dispatch refusal retains the same reservation across restart', async t => {
  let healthReads = 0;
  const s = setup(t, {
    createLedger: root => ({ ...createMailboxExecutionLedger(root),
      complete: () => { throw Error('terminal publication lost'); } }),
    execute: request => callSovereignMaintenanceOwnerV1(request, {
      readFileFn: async () => assert.fail('unexpected token read'),
      fetchFn: async (_url, options) => {
        healthReads++; assert.equal(options.method, 'GET'); return Response.json({ ok: true });
      },
    }),
  });
  const first = await s.consume();
  assert.equal(first.state, 'UNKNOWN');
  assert.equal(healthReads, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  assert.equal(ledger.read(first.requestId).phase, 'RESERVED');
  const second = await s.consume({ latestBuildRequestId: first.requestId });
  assert.equal(second.state, 'HELD'); assert.equal(second.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
  assert.equal(healthReads, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1,
    'lost terminal publication must not permit another attempt');
  assert.equal(ledger.read(first.requestId).phase, 'RESERVED');
});

test('a terminal local preflight refusal preserves dedupe without blocking a distinct later request', async t => {
  let transport = requestTransport(701), healthReads = 0;
  const s = setup(t, {
    readRequest: args => transport(args),
    execute: request => callSovereignMaintenanceOwnerV1(request, {
      readFileFn: async () => assert.fail('unexpected token read'),
      fetchFn: async (_url, options) => {
        healthReads++; assert.equal(options.method, 'GET'); return Response.json({ ok: true });
      },
    }),
  });
  const first = await s.consume(); assert.equal(first.state, 'WAKE_BLOCKED');
  await s.consume();
  assert.equal(healthReads, CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1, 'recorded request must not repeat');
  transport = requestTransport(702);
  const second = await s.consume({ latestBuildRequestId: first.requestId });
  assert.equal(second.state, 'WAKE_BLOCKED');
  assert.equal(healthReads, 2 * (CONTROL_TOWER_PROTOCOL_RETRY_ATTEMPTS + 1));
  assert.notEqual(first.requestId, second.requestId);
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  for (const value of [first, second]) {
    const record = ledger.read(value.requestId);
    assert.equal(record.phase, 'TERMINAL'); assert.equal(record.terminalState, 'BLOCKED');
    assert.equal(value.nativePickupProven, false); assert.equal(value.buildStartedProven, false);
  }
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
  const g = setup(t, { createLedger: root => ({ ...createMailboxExecutionLedger(root),
    complete: () => { throw Error('lost receipt'); } }) });
  const result = await g.consume(); assert.equal(result.state, 'UNKNOWN'); assert.equal(g.calls.length, 1);
  assert.equal(result.buildStartedProven, false);
});
test('wrong owner action or missing proof is never a successful wake', async t => {
  for (const owned of [{ ok: true }, { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    command: { plan: { processId: 'repair-stephanos' } }, proofHash: 'b'.repeat(64) }]) {
    const s = setup(t, { execute: async () => owned }); assert.equal((await s.consume()).state, 'UNKNOWN');
  }
});

test('the fixed native allowlist remains closed while the consumer uses its compiled route', () => {
  assert(Object.isFrozen(FIXED_MAINTENANCE_RUNTIME_ROUTE_V1));
  assert.equal(FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.profile, 'MAINTENANCE_GOAL_BUILDER_V1');
  assert.equal(fixedRuntimeMaintenanceActionQualifiedV1('repair-goal-builder-flow'), true);
  for (const action of ['goal-discovery-heartbeat', 'repair-stephanos', 'restart-stephanos-runtime',
    'MANAGE_CANONICAL_MAILBOX_ROTATION', 'FREEZE', 'DRAIN', 'STATUS', '', null, undefined, {},
    'repair-goal-builder-flow\n']) assert.equal(fixedRuntimeMaintenanceActionQualifiedV1(action), false);
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
  releaseBuild(poll('WAKE_BLOCKED', 'MAINTENANCE_CUSTODY_STATE_MISSING'));
  await new Promise(resolve => setImmediate(resolve));
  tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.at(-1).controlTowerBuild.state, 'WAKE_BLOCKED');
  releaseMailbox({ ok: false, blocker: 'LEGACY_MAILBOX_FULL' });
  const result = await task; assert.equal(result.blocker, 'LEGACY_MAILBOX_FULL');
  assert.equal(result.controlTowerBuild.blocker, 'MAINTENANCE_CUSTODY_STATE_MISSING');
  const status = buildSovereignRelayStatus({ cycle: result });
  assert.equal(status.controlTowerBuild.state, 'WAKE_BLOCKED'); assert.equal(status.carrierHealthy, false);
});

// Real branded artifacts with distinct run identities; only fixture transport
// URLs are mapped. Authentication/strict request parsing still run unchanged.
function requestTransport(runId, operation = 'BUILD_NEXT_ELIGIBLE_GOAL') {
  const f = fixture(); f.request = { ...f.request, requestId: `control-tower-build-${runId}-1`, runId, operation };
  f.run.id = runId; f.list.workflow_runs = [{ ...f.run }];
  for (const job of f.jobs.jobs) job.run_id = runId;
  f.repack(f.request); f.artifacts.artifacts[0].name = `stephanos-control-tower-build-${runId}`;
  f.artifacts.artifacts[0].workflow_run.id = runId;
  const original = f.fetchImpl;
  f.fetchImpl = (url, init) => original(url.replace(`/actions/runs/${runId}`, '/actions/runs/100'), init);
  return args => readControlTowerBuildRequestV1({ ...args, fetchImpl: f.fetchImpl });
}
const inspectedStatus = () => ({ schemaVersion: 'stephanos.sovereign-control-system-inspection.v1',
  observedAtUtc: NOW, observationOnly: true, observationCompleted: true,
  blocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
  source: { available: true, stable: true, sourceHead: HEAD, expectedMain: HEAD, reason: '' },
  nativeRuntime: { available: true, qualificationObserved: false, observedAtUtc: NOW,
    reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' },
});

test('comment observation completes through the real reader and ledger while an earlier build retains its original reservation', async t => {
  for (const priorIsComment of [false, true]) {
    const inspected = [];
    const s = setup(t, { inspect: async args => { inspected.push(args); return inspectedStatus(); } },
      { ownerComment: true, operation: 'OBSERVE_CONTROL_SYSTEM', runId: 101, commentId: 701 });
    const priorCarrier = fixture({ ownerComment: priorIsComment });
    const acquired = await readControlTowerBuildRequestV1({ token: 'fixture-only', fetchImpl: priorCarrier.fetchImpl, now: () => NOW });
    assert.equal(acquired.ok, true);
    const command = { ...acquired.request, issueNumber: 2315 };
    const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
    ledger.reserve(command, { controlTowerObservation: createControlTowerRequestObservationV1(command, {
      commandDigest: mailboxRotationDigest(command), acceptedAtUtc: NOW, nowMs: Date.parse(NOW),
    }) });
    const reserved = ledger.read(command.requestId);
    const result = await s.consume();
    assert.equal(result.state, 'OBSERVATION_COMPLETED');
    assert.equal(result.requestId, 'control-tower-comment-701-1');
    assert.equal(result.runId, 101); assert.equal(result.ownerCommentId, 701);
    assert.equal(s.calls.length, 0);
    assert.deepEqual(inspected, [{ expectedMain: HEAD, controlTowerRequestId: command.requestId }]);
    assert.deepEqual(ledger.read(command.requestId), reserved, 'inspection cannot release or rewrite the original build');
    assert.equal(result.latestBuildRequestObservation.requestId, command.requestId);
    assert.equal(result.latestBuildRequestObservation.state, 'RESERVED');
    const terminal = ledger.read(result.requestId);
    assert.equal(terminal.phase, 'TERMINAL'); assert.equal(terminal.terminalState, 'DONE');
    assert.equal(terminal.terminalProofHash, undefined, 'read-only proof is never a wake proof');
    assert(Buffer.byteLength(JSON.stringify(terminal.controlTowerObservation)) <= 3500);
    assert(Buffer.byteLength(JSON.stringify(terminal)) <= 4096);
    const facts = projectControlTowerBuildBeaconFactsV1({ schema: 'stephanos.sovereign-relay-daemon.v1',
      statusId: 'sovereign-relay-current', heartbeatAtUtc: NOW, sourceHead: HEAD, controlTowerBuild: result },
    { expectedHead: HEAD, nowMs: Date.parse(NOW) });
    assert.equal(facts.observationCompleted, true);
    assert.equal(facts.latestControlSystemObservation.ownerCommentId, 701);
    assert.equal(facts.latestBuildRequestObservation.requestId, command.requestId);
    const later = fixture({ ownerComment: true, runId: 102, commentId: 702 });
    s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({ ...args, fetchImpl: later.fetchImpl });
    const restart = await s.consume({ latestBuildRequestId: command.requestId, latestObserveRequestId: result.requestId });
    assert.equal(restart.state, 'HELD'); assert.equal(s.calls.length, 0);
    assert.equal(ledger.has('control-tower-comment-702-1'), false);
  }
});

const legacyRequest = (id = 99) => ({
  ...fixture().request,
  requestId: `control-tower-build-${id}-1`,
  runId: id,
  createdAtUtc: '2026-10-28T11:40:00.000Z',
  expiresAtUtc: '2026-10-28T11:50:00.000Z',
  artifactId: id + 200,
  artifactSha256: 'c'.repeat(64),
  proofRef: `https://github.com/Cheekyfellastef/stephan-os/actions/runs/${id}`,
});
const currentRequest = (id = 100) => ({
  ...fixture().request,
  requestId: `control-tower-build-${id}-1`,
  runId: id,
  createdAtUtc: '2026-10-28T12:19:00.000Z',
  expiresAtUtc: '2026-10-28T12:29:00.000Z',
  artifactId: id + 200,
  artifactSha256: 'c'.repeat(64),
  proofRef: `https://github.com/Cheekyfellastef/stephan-os/actions/runs/${id}`,
});
const quiescentLegacyStatus = (custodyState = 'NOT_HELD_REPORTED') => ({
  schemaVersion: 'stephanos.sovereign-control-system-inspection.v1',
  observedAtUtc: '2026-10-28T12:20:00.000Z',
  observationOnly: true,
  observationCompleted: true,
  blocker: '',
  source: { available: true, stable: true, sourceHead: HEAD, expectedMain: HEAD, reason: '' },
  owner: { available: true, stable: true, observedAtUtc: '2026-10-28T12:20:00.000Z', reason: '' },
  guardian: { available: true, enabled: true, running: false, scheduled: false, maintenanceInFlight: false,
    custodyState, blocker: custodyState === 'HELD' ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' : '',
    observedAtUtc: '2026-10-28T12:20:00.000Z' },
  nativeRuntime: { available: true, qualificationObserved: false, observedAtUtc: '2026-10-28T12:20:00.000Z',
    reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' },
  requestLedger: { requested: true, recordObserved: true, phase: 'RESERVED',
    relayWorkspaceIdentityProven: false, reason: '' },
});

test('Control Tower self-heals a proven abandoned legacy reservation as BLOCKED then runs the fresh build in the same poll', async t => {
  const legacy = legacyRequest(99), fresh = currentRequest(100);
  const s = setup(t, {
    isAuthenticated: () => true,
    readHistoricalRequest: async ({ runId }) => ({ ok: runId === 99, blocker: '', request: legacy }),
    readRequest: async args => {
      assert.equal(args.observationOnly, false);
      return { ok: true, blocker: '', request: fresh };
    },
    inspect: async args => {
      assert.deepEqual(args, { expectedMain: HEAD, controlTowerRequestId: legacy.requestId });
      return quiescentLegacyStatus();
    },
  });
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  ledger.reserve({ ...legacy, issueNumber: 2315 });
  const result = await s.consume({ now: () => new Date('2026-10-28T12:20:00.000Z') });
  assert.equal(result.state, 'WAKE_COMPLETED');
  assert.equal(ledger.read(legacy.requestId).phase, 'TERMINAL');
  assert.equal(ledger.read(legacy.requestId).terminalState, 'BLOCKED');
  assert.equal(ledger.read(fresh.requestId).phase, 'TERMINAL');
  assert.equal(ledger.read(fresh.requestId).terminalState, 'DONE');
  assert.equal(s.calls.length, 1);
});

test('Control Tower reconciles an expired superseded observed reservation as delivery-unproven then admits the fresh build', async t => {
  const oldHead = 'b'.repeat(40);
  const stale = { ...legacyRequest(98), sourceHead: oldHead };
  const fresh = currentRequest(100);
  const s = setup(t, {
    isAuthenticated: () => true,
    readHistoricalRequest: async ({ runId }) => ({ ok: runId === 98, blocker: '', request: stale }),
    readRequest: async args => {
      assert.equal(args.observationOnly, false);
      return { ok: true, blocker: '', request: fresh };
    },
    inspect: async args => {
      assert.deepEqual(args, { expectedMain: HEAD, controlTowerRequestId: stale.requestId });
      return quiescentLegacyStatus();
    },
  });
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const command = { ...stale, issueNumber: 2315 };
  const acceptedAtUtc = '2026-10-28T11:41:00.000Z';
  const initial = createControlTowerRequestObservationV1(stale, {
    commandDigest: (await import('../shared/agents/canonicalMailboxRotationV1.mjs')).mailboxRotationDigest(command),
    acceptedAtUtc, observedAtUtc: acceptedAtUtc, nowMs: Date.parse(acceptedAtUtc),
  });
  ledger.reserve(command, { controlTowerObservation: initial });

  const result = await s.consume({ now: () => new Date('2026-10-28T12:20:00.000Z') });
  const retired = ledger.read(stale.requestId);
  assert.equal(result.state, 'WAKE_COMPLETED');
  assert.equal(retired.phase, 'TERMINAL');
  assert.equal(retired.terminalState, 'BLOCKED');
  assert.equal(retired.controlTowerObservation.state, 'WAKE_BLOCKED');
  assert.equal(retired.controlTowerObservation.blocker, 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN');
  assert.equal(ledger.read(fresh.requestId).phase, 'TERMINAL');
  assert.equal(ledger.read(fresh.requestId).terminalState, 'DONE');
  assert.equal(s.calls.length, 1);
});

test('same-head or non-quiescent observed reservations remain unresolved and cannot be replayed', async t => {
  for (const { sourceHead, custodyState } of [
    { sourceHead: HEAD, custodyState: 'NOT_HELD_REPORTED' },
    { sourceHead: 'b'.repeat(40), custodyState: 'HELD' },
  ]) {
    const stale = { ...legacyRequest(97), sourceHead };
    const s = setup(t, {
      readHistoricalRequest: async () => ({ ok: true, blocker: '', request: stale }),
      readRequest: async args => {
        assert.equal(args.observationOnly, true);
        return { ok: false, blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST', request: null };
      },
      inspect: async () => quiescentLegacyStatus(custodyState),
    });
    const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
    const command = { ...stale, issueNumber: 2315 };
    const acceptedAtUtc = '2026-10-28T11:41:00.000Z';
    const initial = createControlTowerRequestObservationV1(stale, {
      commandDigest: (await import('../shared/agents/canonicalMailboxRotationV1.mjs')).mailboxRotationDigest(command),
      acceptedAtUtc, observedAtUtc: acceptedAtUtc, nowMs: Date.parse(acceptedAtUtc),
    });
    ledger.reserve(command, { controlTowerObservation: initial });
    const result = await s.consume({ now: () => new Date('2026-10-28T12:20:00.000Z') });
    assert.equal(result.state, 'HELD');
    assert.equal(result.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
    assert.equal(ledger.read(stale.requestId).phase, 'RESERVED');
    assert.equal(s.calls.length, 0);
  }
});

test('Control Tower never retires a legacy reservation while Commander custody remains held', async t => {
  const legacy = legacyRequest(99);
  const s = setup(t, {
    readHistoricalRequest: async () => ({ ok: true, blocker: '', request: legacy }),
    readRequest: async args => {
      assert.equal(args.observationOnly, true);
      return { ok: false, blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST', request: null };
    },
    inspect: async () => quiescentLegacyStatus('HELD'),
  });
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  ledger.reserve({ ...legacy, issueNumber: 2315 });
  const result = await s.consume({ now: () => new Date('2026-10-28T12:20:00.000Z') });
  assert.equal(result.state, 'HELD');
  assert.equal(result.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
  assert.equal(ledger.read(legacy.requestId).phase, 'RESERVED');
  assert.equal(s.calls.length, 0);
});

test('ambiguous build then observe then restart and empty poll retains original custody and blocks a new build', async t => {
  let invocations = 0; const inspected = [], readerModes = [];
  const s = setup(t, { execute: async () => { invocations++; return { ok: false, blocker: 'SOVEREIGN_MAINTENANCE_OWNER_UNAVAILABLE' }; },
    inspect: async args => { inspected.push(args); return inspectedStatus(); } });
  const first = await s.consume(); assert.equal(first.state, 'UNKNOWN');
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const reserved = ledger.read(first.requestId);
  const observeRequest = requestTransport(101, 'OBSERVE_CONTROL_SYSTEM');
  s.options.dependencies.readRequest = args => { readerModes.push(args.observationOnly); return observeRequest(args); };
  // No saved status/pointer is supplied: recovery must find the reservation in
  // the original ledger after the reserve-before-status crash window.
  const observed = await s.consume(); assert.equal(observed.state, 'OBSERVATION_COMPLETED');
  assert.deepEqual(inspected, [{ expectedMain: HEAD, controlTowerRequestId: first.requestId }]);
  assert.equal(readerModes[0], true); assert.equal(invocations, 1);
  assert.equal(observed.latestBuildRequestObservation.requestId, first.requestId);
  assert.equal(observed.latestBuildRequestObservation.state, 'RESERVED');
  assert.equal(observed.latestControlSystemObservation.state, 'OBSERVATION_COMPLETED');
  assert.equal(observed.latestControlSystemObservation.wakeProofHash, '');
  assert.equal(ledger.read(observed.requestId).terminalProofHash, undefined);
  assert.equal(observed.nativePickupProven, false);
  const { controlTowerRequestPointersFromRelayStatusV1 } = await import('./control-tower-build-consumer-v1.mjs');
  const restored = controlTowerRequestPointersFromRelayStatusV1(JSON.parse(JSON.stringify({
    schema: 'stephanos.sovereign-relay-daemon.v1', statusId: 'sovereign-relay-current', sourceHead: HEAD, controlTowerBuild: observed }))) ;
  assert.equal(restored.latestBuildRequestId, first.requestId); assert.equal(restored.latestObserveRequestId, observed.requestId);
  let at = new Date(Date.parse(NOW) + 60000);
  s.options.dependencies.readRequest = async args => { assert.equal(args.observationOnly, true); return { ok: false, blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST' }; };
  const restarted = createControlTowerBuildConsumerV1({ ...s.options, ...restored, now: () => at });
  const empty = await restarted(); assert.equal(empty.state, 'HELD');
  assert.equal(empty.latestBuildRequestObservation.requestId, first.requestId);
  assert.equal(empty.latestBuildRequestObservation.observedAtUtc, first.latestBuildRequestObservation.observedAtUtc);
  assert.equal(empty.latestControlSystemObservation.observedAtUtc, observed.latestControlSystemObservation.observedAtUtc);
  const buildRequest = requestTransport(102);
  s.options.dependencies.readRequest = args => { assert.equal(args.observationOnly, true); return buildRequest(args); };
  at = new Date(at.getTime() + 30000);
  const held = await restarted(); assert.equal(held.state, 'HELD');
  assert.equal(held.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
  assert.equal(ledger.has('control-tower-build-102-1'), false); assert.equal(invocations, 1);
  assert.deepEqual(ledger.read(first.requestId), reserved);
});

test('legacy terminal records allow a later authenticated build while legacy reserved records remain held', async t => {
  for (const terminalState of ['DONE', 'BLOCKED']) {
    const s = setup(t), ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
    ledger.reserve({ requestId: 'control-tower-build-99-1', issueNumber: 2315 });
    ledger.complete({ requestId: 'control-tower-build-99-1', issueNumber: 2315, state: terminalState });
    const result = await s.consume(); assert.equal(result.state, 'WAKE_COMPLETED'); assert.equal(s.calls.length, 1);
    assert.equal(ledger.read('control-tower-build-99-1').controlTowerObservation, undefined);
  }
  const s = setup(t), ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  ledger.reserve({ requestId: 'control-tower-build-99-1', issueNumber: 2315 });
  const result = await s.consume(); assert.equal(result.state, 'HELD'); assert.equal(s.calls.length, 0);
  assert.equal(result.latestBuildRequestObservation.detailState, 'LEGACY_DETAIL_UNAVAILABLE');
  assert.equal(result.latestBuildRequestObservation.observedAtUtc, '');
  assert.equal(ledger.has('control-tower-build-100-1'), false);
});

test('fixed observation never calls maintenance and malformed or wrong-source reports cannot complete it', async t => {
  for (const changed of [{ observationCompleted: false }, { schemaVersion: 'arbitrary' },
    { source: { available: true, stable: true, sourceHead: 'd'.repeat(40), expectedMain: 'd'.repeat(40), reason: '' } }]) {
    const s = setup(t, { readRequest: requestTransport(101, 'OBSERVE_CONTROL_SYSTEM'),
      inspect: async () => ({ ...inspectedStatus(), ...changed, token: 'PRIVATE_TOKEN' }) });
    const result = await s.consume(); assert.equal(result.state, 'OBSERVATION_BLOCKED');
    assert.equal(s.calls.length, 0); assert.equal(result.nativePickupProven, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN/);
  }
});

test('unproven ledger discovery restricts acquisition to observation and cannot wake or reserve a new build', async t => {
  let mode;
  const s = setup(t, { createLedger: root => ({ ...createMailboxExecutionLedger(root),
    discoverControlTower: async () => {
      await new Promise(resolve => setImmediate(resolve));
      return { ok: false, blocker: 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED' };
    } }),
    readRequest: async args => { mode = args.observationOnly; return requestTransport(101, 'OBSERVE_CONTROL_SYSTEM')(args); },
    inspect: async () => inspectedStatus() });
  const observed = await s.consume(); assert.equal(mode, true); assert.equal(observed.state, 'OBSERVATION_COMPLETED');
  assert.equal(s.calls.length, 0);
  s.options.dependencies.readRequest = args => requestTransport(102)(args);
  const blocked = await s.consume(); assert.equal(blocked.state, 'HELD'); assert.equal(s.calls.length, 0);
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).has('control-tower-build-102-1'), false);
});

test('a known build pointer whose ledger record vanished stays unknown across a successful observation', async t => {
  const prior = 'control-tower-build-99-1';
  const s = setup(t, { readRequest: requestTransport(101, 'OBSERVE_CONTROL_SYSTEM'), inspect: async () => inspectedStatus() });
  const observed = await s.consume({ latestBuildRequestId: prior });
  assert.equal(observed.state, 'OBSERVATION_COMPLETED');
  assert.equal(observed.latestBuildRequestObservation.requestId, prior);
  assert.equal(observed.latestBuildRequestObservation.detailState, 'MISSING');
  assert.equal(observed.latestBuildRequestObservation.ledgerPhase, 'UNPROVEN');
  assert.equal(observed.latestBuildRequestObservation.sourceHead, '');
  assert.equal(observed.latestBuildRequestObservation.observedAtUtc, '');
  s.options.dependencies.readRequest = requestTransport(102);
  const next = await s.consume({ latestBuildRequestId: prior, latestObserveRequestId: observed.requestId });
  assert.equal(next.state, 'HELD'); assert.equal(s.calls.length, 0);
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).has('control-tower-build-102-1'), false);
});

test('an observation-only history does not become a fabricated build pointer after restart', async t => {
  const s = setup(t, { readRequest: requestTransport(101, 'OBSERVE_CONTROL_SYSTEM'), inspect: async () => inspectedStatus() });
  const observed = await s.consume();
  const { controlTowerRequestPointersFromRelayStatusV1 } = await import('./control-tower-build-consumer-v1.mjs');
  const pointers = controlTowerRequestPointersFromRelayStatusV1({ schema: 'stephanos.sovereign-relay-daemon.v1',
    statusId: 'sovereign-relay-current', sourceHead: HEAD, controlTowerBuild: observed });
  assert.equal(pointers.latestBuildRequestId, ''); assert.equal(pointers.latestObserveRequestId, observed.requestId);
  s.options.dependencies.readRequest = requestTransport(102);
  const next = await s.consume(pointers); assert.equal(next.state, 'WAKE_COMPLETED'); assert.equal(s.calls.length, 1);
});

test('existing relay heartbeat preserves a cached consumer event time', async () => {
  const eventAt = '2026-10-28T12:00:20.000Z', heartbeatAt = '2026-10-28T12:01:00.000Z';
  const result = await runSovereignRelayCycleWithHeartbeat({ statusPath: '/fixed-fixture-status',
    sourceHead: HEAD, now: () => new Date(heartbeatAt), cycleStartedAtMs: Date.parse(heartbeatAt),
    runCycle: async () => ({ ok: true }), observeBuild: async () => poll('WAITING', '', { observedAtUtc: eventAt }),
    writeStatus: async () => {}, setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {} });
  assert.equal(result.controlTowerBuild.observedAtUtc, eventAt);
});

test('a later source guard refusal keeps historical ledger outcomes at their original time', async t => {
  const s = setup(t); let at = new Date(NOW), source = HEAD;
  const observe = createControlTowerBuildConsumerV1({ ...s.options, now: () => at, readSourceHead: async () => source });
  const first = await observe(); assert.equal(first.state, 'WAKE_COMPLETED');
  at = new Date(at.getTime() + 30000); source = 'e'.repeat(40);
  const guarded = await observe(); assert.equal(guarded.state, 'HELD');
  assert.equal(guarded.blocker, 'CONTROL_TOWER_INSTALLED_SOURCE_UNPROVEN');
  assert.equal(guarded.latestBuildRequestObservation.requestId, first.requestId);
  assert.equal(guarded.latestBuildRequestObservation.observedAtUtc, first.latestBuildRequestObservation.observedAtUtc);
  assert.equal(s.calls.length, 1);
});

test('source guard failure preserves only closed locators across a persisted status and another restart', async t => {
  const { controlTowerRequestPointersFromRelayStatusV1, controlTowerBuildInitialStatusV1 } = await import('./control-tower-build-consumer-v1.mjs');
  const pointers = { latestBuildRequestId: 'control-tower-build-99-1', latestObserveRequestId: '' };
  const s = setup(t), observed = await s.consume({ ...pointers, readSourceHead: async () => 'e'.repeat(40) });
  assert.equal(observed.state, 'HELD'); assert.equal(observed.latestBuildRequestObservation, null);
  assert.deepEqual(observed.requestPointers, pointers);
  const status = JSON.parse(JSON.stringify({ schema: 'stephanos.sovereign-relay-daemon.v1', statusId: 'sovereign-relay-current',
    sourceHead: HEAD, controlTowerBuild: observed }));
  const restored = controlTowerRequestPointersFromRelayStatusV1(status); assert.deepEqual(restored, pointers);
  const initial = controlTowerBuildInitialStatusV1(restored);
  assert.equal(initial.observedAtUtc, ''); assert.deepEqual(initial.requestPointers, pointers);
  const missing = await s.consume(restored); assert.equal(missing.state, 'HELD');
  assert.equal(missing.latestBuildRequestObservation.requestId, pointers.latestBuildRequestId);
  assert.equal(missing.latestBuildRequestObservation.detailState, 'MISSING'); assert.equal(s.calls.length, 0);
  s.options.dependencies.readRequest = requestTransport(101, 'OBSERVE_CONTROL_SYSTEM');
  s.options.dependencies.inspect = async () => inspectedStatus();
  const readable = await s.consume(restored); assert.equal(readable.state, 'OBSERVATION_COMPLETED');
  assert.equal(readable.latestBuildRequestObservation.detailState, 'MISSING'); assert.equal(s.calls.length, 0);
});

test('relay observer rejection, invalid result and carrier exception retain locators through settled status and restart', async t => {
  const { controlTowerBuildInitialStatusV1, controlTowerRequestPointersFromRelayStatusV1 } = await import('./control-tower-build-consumer-v1.mjs');
  const pointers = { latestBuildRequestId: 'control-tower-build-99-1', latestObserveRequestId: '' };
  for (const failure of ['observer-throw', 'observer-invalid', 'carrier-throw']) {
    const initial = controlTowerBuildInitialStatusV1(pointers), writes = [];
    const cycle = await runSovereignRelayCycleWithHeartbeat({ statusPath: '/fixed-fixture-status',
      sourceHead: HEAD, now: () => new Date(NOW), previousStatus: { controlTowerBuild: initial },
      runCycle: async () => { if (failure === 'carrier-throw') throw Error('fixture carrier failure'); return { ok: false }; },
      observeBuild: async () => { if (failure === 'observer-throw') throw Error('fixture read failure');
        return failure === 'observer-invalid' ? { private: 'SHOULD_NOT_ESCAPE' } : poll('WAITING'); },
      writeStatus: async (_path, value) => { writes.push(value); },
      setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {} });
    assert.deepEqual(cycle.controlTowerBuild.requestPointers, pointers);
    assert.equal(cycle.controlTowerBuild.state, 'HELD');
    assert.deepEqual(writes[0].controlTowerBuild.requestPointers, pointers);
    const settled = buildSovereignRelayStatus({ cycle, sourceHead: HEAD, now: new Date(NOW) });
    const restored = controlTowerRequestPointersFromRelayStatusV1(JSON.parse(JSON.stringify(settled)));
    assert.deepEqual(restored, pointers); assert.doesNotMatch(JSON.stringify(settled.controlTowerBuild), /SHOULD_NOT_ESCAPE/);
    const s = setup(t), restarted = await s.consume(restored);
    assert.equal(restarted.state, 'HELD'); assert.equal(restarted.latestBuildRequestObservation.detailState, 'MISSING');
    assert.equal(restarted.latestBuildRequestObservation.requestId, pointers.latestBuildRequestId);
    assert.equal(s.calls.length, 0);
  }
});

test('state sequence matrix preserves real history through poll failures and restart until new ledger evidence supersedes it', async t => {
  const { retainControlTowerBuildStatusV1: transition, controlTowerRequestPointersFromRelayStatusV1 } = await import('./control-tower-build-consumer-v1.mjs');
  const s = setup(t), original = await s.consume();
  s.options.dependencies.readRequest = requestTransport(101, 'OBSERVE_CONTROL_SYSTEM');
  s.options.dependencies.inspect = async () => inspectedStatus();
  const newer = await s.consume({ latestBuildRequestId: original.requestId });
  const time = Date.parse(NOW) + 120000;
  const actions = [
    current => transition(current, poll('WAITING', 'NO_CONTROL_TOWER_BUILD_REQUEST'), { nowMs: time }),
    current => transition(current, null, { nowMs: time }),
    current => transition(current, { state: 'MALFORMED', private: 'MUST_NOT_ESCAPE' }, { nowMs: time }),
    current => transition(current, null, { nowMs: time, failureBlocker: 'CONTROL_TOWER_RELAY_CYCLE_FAILED' }),
  ];
  for (const first of actions) for (const second of actions) {
    let current = second(first(original));
    assert.equal(current.latestBuildRequestObservation.requestId, original.requestId);
    assert.equal(current.latestBuildRequestObservation.observedAtUtc, original.latestBuildRequestObservation.observedAtUtc);
    assert.equal(current.latestBuildRequestObservation.state, 'WAKE_COMPLETED');
    assert.equal(current.requestPointers.latestBuildRequestId, original.requestId);
    const pointers = controlTowerRequestPointersFromRelayStatusV1(JSON.parse(JSON.stringify({
      schema: 'stephanos.sovereign-relay-daemon.v1', statusId: 'sovereign-relay-current', sourceHead: HEAD, controlTowerBuild: current })));
    const restored = await s.consume({ ...pointers, dependencies: { ...s.options.dependencies,
      readRequest: async () => ({ ok: false, blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST' }) } });
    current = transition(current, restored, { nowMs: time });
    assert.equal(current.latestBuildRequestObservation.observedAtUtc, original.latestBuildRequestObservation.observedAtUtc);
    current = transition(current, newer, { nowMs: time });
    assert.equal(current.latestControlSystemObservation.requestId, newer.requestId);
    assert.equal(current.latestControlSystemObservation.observedAtUtc, newer.latestControlSystemObservation.observedAtUtc);
    assert.equal(current.requestPointers.latestObserveRequestId, newer.requestId);
    assert.equal(current.nativePickupProven, false); assert.doesNotMatch(JSON.stringify(current), /MUST_NOT_ESCAPE/);
  }
});

test('successful reservation advances the locator before a diagnostic re-read can fail', async t => {
  const s = setup(t, { createLedger: root => {
    const real = createMailboxExecutionLedger(root);
    return { ...real, inspectControlTower: () => { throw Error('fixture observation unavailable'); } };
  } });
  const observed = await s.consume(); assert.equal(observed.state, 'UNKNOWN');
  assert.equal(observed.requestPointers.latestBuildRequestId, 'control-tower-build-100-1');
  assert.equal(observed.latestBuildRequestObservation.state, 'RESERVED');
  assert.equal(observed.latestBuildRequestObservation.ledgerPhase, 'RESERVED');
  assert.equal(createMailboxExecutionLedger(join(s.root, 'github-command-mailbox')).read(observed.requestId).phase, 'RESERVED');
  assert.equal(s.calls.length, 0);
});

for (const existingHistory of [false, true]) {
  test('two distinct authenticated requests retain one unresolved build with existing history ' + existingHistory, async t => {
    const s = setup(t, { execute: async args => { s.calls.push(args); return { ok: false, blocker: 'TRANSPORT_OUTCOME_UNKNOWN' }; } });
    const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
    if (existingHistory) ledger.importHistorical('ordinary-mailbox-history', 3258, 'TERMINAL');
    const consume = runId => consumeControlTowerBuildRequestV1({ ...s.options,
      dependencies: { ...s.options.dependencies, readRequest: requestTransport(runId) } });
    const results = await Promise.all([consume(100), consume(101)]);
    assert.equal(s.calls.length, 1);
    assert.equal([100, 101].filter(id => ledger.read('control-tower-build-' + id + '-1')?.phase === 'RESERVED').length, 1);
    assert.equal(results.filter(result => result.state === 'UNKNOWN').length, 1);
    assert.equal(results.filter(result => result.state === 'HELD').length, 1);
  });
}

test('a missing original locator prevents combined admission and owner invocation', async t => {
  let admissions = 0;
  const s = setup(t, { createLedger: root => {
    const real = createMailboxExecutionLedger(root);
    return { ...real, discoverAndReserveControlTower: (...args) => { admissions++; return real.discoverAndReserveControlTower(...args); } };
  } });
  const result = await s.consume({ latestBuildRequestId: 'control-tower-build-99-1' });
  assert.equal(result.state, 'HELD');
  assert.equal(result.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
  assert.equal(admissions, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(result.latestBuildRequestObservation.detailState, 'MISSING');
});

test('uncertain combined reservation keeps its locator and never calls the owner', async t => {
  const s = setup(t, { createLedger: root => {
    const real = createMailboxExecutionLedger(root);
    return { ...real, discoverAndReserveControlTower: async (command, options) => {
      await real.discoverAndReserveControlTower(command, options);
      return { ok: false, blocker: 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN',
        reservation: null, reservationAttempted: true,
        latestBuildRequestObservation: null, latestControlSystemObservation: null };
    } };
  } });
  const result = await s.consume();
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.requestPointers.latestBuildRequestId, 'control-tower-build-100-1');
  assert.equal(result.latestBuildRequestObservation.ledgerPhase, 'RESERVED');
  assert.equal(s.calls.length, 0);
});

test('a retained unresolved BUILD avoids an expensive full scan without granting mutation or starving OBSERVE', async t => {
  let discoveryCalls = 0;
  const s = setup(t, {
    createLedger: path => {
      const original = createMailboxExecutionLedger(path);
      return { ...original, discoverControlTower: async () => {
        discoveryCalls++;
        return { ok: false, blocker: 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED' };
      } };
    },
    inspect: async () => inspectedStatus(),
  });
  const acquired = await readControlTowerBuildRequestV1({
    token: 'fixture-only', fetchImpl: s.f.fetchImpl, now: () => NOW,
  });
  assert.equal(acquired.ok, true, 'fixture must authenticate through the original reader');
  const command = { ...acquired.request, issueNumber: 2315 };
  const ledger = createMailboxExecutionLedger(join(s.root, 'github-command-mailbox'));
  const prior = createControlTowerRequestObservationV1(command, {
    commandDigest: mailboxRotationDigest(command), acceptedAtUtc: NOW, nowMs: Date.parse(NOW),
  });
  assert(prior, 'fixture must be a valid real observation');
  ledger.reserve(command, { controlTowerObservation: prior });
  const original = ledger.read(command.requestId);
  assert.equal(original.phase, 'RESERVED');

  const held = await s.consume({ latestBuildRequestId: command.requestId });
  assert.equal(held.state, 'HELD');
  assert.equal(held.blocker, 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED');
  assert.equal(discoveryCalls, 0, 'no full scan for a known unresolved original BUILD');
  assert.equal(s.calls.length, 0);
  assert.deepEqual(ledger.read(command.requestId), original);

  const observation = fixture({ operation: 'OBSERVE_CONTROL_SYSTEM', runId: 101 });
  s.options.dependencies.readRequest = args => readControlTowerBuildRequestV1({
    ...args, fetchImpl: observation.fetchImpl,
  });
  const observed = await s.consume({ latestBuildRequestId: command.requestId });
  assert.equal(observed.state, 'OBSERVATION_COMPLETED');
  assert.equal(discoveryCalls, 0, 'read-only OBSERVE does not need a second scan');
  assert.equal(s.calls.length, 0, 'the previous BUILD cannot dispatch a worker');
  assert.deepEqual(ledger.read(command.requestId), original, 'original reserved custody unchanged');
});
