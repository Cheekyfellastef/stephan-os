import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { createMaintenanceCustodyStoreV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { createSovereignCommanderHttpServer } from './sovereign-commander-http.mjs';
import * as nativeBoundary from './sovereign-fixed-runtime-parent-v1.mjs';
import {
  createCoreRepairAttemptControllerV1, readCoreRepairAttemptV1, CORE_REPAIR_ATTEMPT_FILE,
} from '../shared/agents/stephanosCoreRepairAttemptV1.mjs';
import { executeSovereignCommanderCommandV1 } from '../shared/agents/sovereignCommanderV1.mjs';
import {
  callSovereignMaintenanceOwnerV1, querySovereignMaintenanceRequestStatusV1,
  prepareSovereignMaintenanceRequestV1,
} from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import {
  buildStephanosExecutionCommandEnvelopeV1, buildStephanosExecutionSurfaceCatalogV1,
  STEPHANOS_EXECUTION_SURFACE,
} from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';
import { captureCoreRepairContinuationStatusV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const HEAD = 'a'.repeat(40), NEXT_HEAD = 'b'.repeat(40);
const token = 'inert-core-integration-token-'.repeat(3);
const key = 'inert-core-integration-signing-key-'.repeat(3);
const sha = value => createHash('sha256').update(value).digest('hex');

// This is a source integration fixture, not a Windows qualification. Core,
// Commander, authenticated loopback HTTP/MCP, guardian and the signed custody
// store are the production implementations. Only the OS anchor/boot witness
// and the fixed native adapter are inert fixtures. No runtime bypass is added.
async function loadHttpWithNativeFixture(boundary) {
  const id = randomUUID();
  const moduleUrl = new URL(`./sovereign-commander-http.mjs?source-integration=${id}`, import.meta.url).href;
  const slot = `stephanos.test.core-repair.native.${id}`;
  const fixtureUrl = 'data:text/javascript,' + encodeURIComponent(`
    const fixture = globalThis[Symbol.for(${JSON.stringify(slot)})];
    export const FIXED_MAINTENANCE_RUNTIME_ROUTE_V1 = fixture.FIXED_MAINTENANCE_RUNTIME_ROUTE_V1;
    export const fixedRuntimeMaintenanceActionQualifiedV1 = fixture.fixedRuntimeMaintenanceActionQualifiedV1;
    export const inspectFixedRuntimeQualificationV1 = fixture.inspectFixedRuntimeQualificationV1;
    export const executeFixedMaintenanceRuntimeV1 = fixture.executeFixedMaintenanceRuntimeV1;
    export const consumeFixedRuntimeCompletionV1 = fixture.consumeFixedRuntimeCompletionV1;
    export const consumeFixedRuntimePrelaunchExclusionV1 = fixture.consumeFixedRuntimePrelaunchExclusionV1;
  `);
  const processUrl = 'data:text/javascript,' + encodeURIComponent(`
    import actual from 'node:process';
    export default new Proxy(actual, { get(target, key) {
      return key === 'platform' ? 'win32' : Reflect.get(target, key);
    }});
  `);
  globalThis[Symbol.for(slot)] = boundary;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === moduleUrl && specifier === './sovereign-fixed-runtime-parent-v1.mjs')
      return { url: fixtureUrl, shortCircuit: true };
    if (context.parentURL === moduleUrl && specifier === 'node:process')
      return { url: processUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  try { return await import(moduleUrl); }
  finally { hooks.deregister(); delete globalThis[Symbol.for(slot)]; }
}

async function fixture(t, { native = true, disposition = 'SUCCEEDED', losePrepare = false,
  loseExecution = false, terminalSource = HEAD } = {}) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'core-repair-full-integration-'));
  mkdirSync(join(workspaceRoot, 'status')); mkdirSync(join(workspaceRoot, 'events'));
  let server, store;
  t.after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
    store?.close(); rmSync(workspaceRoot, { force: true, recursive: true });
  });
  const time = Date.now(), now = () => new Date(time).toISOString();
  const oldNow = () => new Date(time - 60_000).toISOString();
  const oldBoot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash: 'f'.repeat(64),
    bootStartedAtUtc: new Date(time - 86_400_000).toISOString(), observedAtUtc: oldNow() };
  const successorBoot = { ...oldBoot, bootStartedAtUtc: new Date(time - 30_000).toISOString(), observedAtUtc: now() };
  let latest = null, recordId = 0;
  const anchor = { readLatest: () => latest && { ...latest, bytes: Buffer.from(latest.bytes) },
    append(bytes, { expectedRecordId }) {
      assert.equal(latest?.eventRecordId ?? null, expectedRecordId, 'native metadata CAS fixture');
      latest = { bytes: Buffer.from(bytes), eventRecordId: ++recordId };
    } };
  const makeStore = boot => createMaintenanceCustodyStoreV1({ workspaceRoot, signingKey: key,
    anchor, bootWitness: boot, readBootWitness: () => boot, now: boot === oldBoot ? oldNow : now });
  const legacy = makeStore(oldBoot);
  assert.equal(legacy.prepareIncident({ reservationId: 'legacy-original', operation: 'repair-stephanos' }).ok, true);
  const expectedDigest = legacy.status().digest;
  legacy.close(); store = makeStore(successorBoot);
  assert.equal((await store.recoverAfterBoot({ expectedDigest, operatorApproval: 'operator-approved' })).ok, true);

  const calls = [], nativeCalls = [], preparedReads = [], lost = [];
  const proofs = new WeakMap();
  const qualification = Object.freeze({ ok: true, sourceHead: HEAD, dispatchAllowed: true });
  const boundary = {
    FIXED_MAINTENANCE_RUNTIME_ROUTE_V1: nativeBoundary.FIXED_MAINTENANCE_RUNTIME_ROUTE_V1,
    fixedRuntimeMaintenanceActionQualifiedV1: nativeBoundary.fixedRuntimeMaintenanceActionQualifiedV1,
    inspectFixedRuntimeQualificationV1: () => qualification,
    async executeFixedMaintenanceRuntimeV1(observedQualification, binding, options) {
      assert.equal(observedQualification, qualification);
      assert.equal(binding.actionId, 'repair-goal-builder-flow');
      assert.equal(binding.sourceHead, HEAD);
      const local = await readCoreRepairAttemptV1({ workspaceRoot });
      assert.equal(local.ok, true); assert.equal(local.attempt.stage, 'DISPATCH_FENCED');
      assert.equal(local.attempt.continuation.requestId, binding.requestId);
      const active = store.status();
      assert.equal(active.held, true); assert.equal(active.reservationId, binding.requestId);
      assert.equal(active.digest, binding.custodyRecordSha256); assert.equal(active.anchorRecordId, binding.nativeRecordId);
      nativeCalls.push({ ...binding });
      const common = { RequestId: binding.requestId, Profile: 'MAINTENANCE_GOAL_BUILDER_V1',
        OwnerPid: process.pid, RuntimeSourceHead: HEAD,
        CustodyRecordSha256: binding.custodyRecordSha256, NativeRecordId: binding.nativeRecordId };
      const root = { ...common, SchemaVersion: 'stephanos.fixed-runtime-prepared.v1',
        RootPid: 812, RootCreatedAtUtc: now() };
      assert.equal(options.onPrepared(root), true, 'production store archives the bound native root');
      const output = JSON.stringify({ fixture: 'inert native boundary' });
      const terminal = { ...common, RuntimeSourceHead: terminalSource,
        SchemaVersion: 'stephanos.fixed-runtime-job.v1', ExecutionCustodyReleased: disposition !== 'UNPROVEN',
        OperationOk: disposition === 'SUCCEEDED', TaskStage: {
          ExecutionCustodyReleased: disposition !== 'UNPROVEN', ZeroActiveProcessesObserved: disposition !== 'UNPROVEN',
          ActiveProcesses: disposition === 'UNPROVEN' ? 1 : 0, RootPid: root.RootPid,
          RootCreatedAtUtc: root.RootCreatedAtUtc, Output: output, OutputSha256: sha(output),
        } };
      const result = Object.freeze({ ok: disposition === 'SUCCEEDED', reason: disposition === 'SUCCEEDED' ? '' : 'FIXED_RUNTIME_TERMINAL_CUSTODY_UNPROVEN',
        executionCustodyReleased: disposition !== 'UNPROVEN', taskRootCreated: true, taskExecuted: true,
        stdout: output, nativeReceipt: terminal });
      if (disposition !== 'UNPROVEN') proofs.set(result, { binding: { ...binding }, disposition });
      return result;
    },
    consumeFixedRuntimePrelaunchExclusionV1: () => false,
    consumeFixedRuntimeCompletionV1(result, binding) {
      const proof = proofs.get(result); proofs.delete(result);
      if (!proof || JSON.stringify(proof.binding) !== JSON.stringify(binding)) return null;
      return { executionCustodyReleased: true, operationDisposition: proof.disposition };
    },
  };
  const createServer = native
    ? (await loadHttpWithNativeFixture(boundary)).createSovereignCommanderHttpServer
    : createSovereignCommanderHttpServer;
  const owner = await createServer({ token, host: '127.0.0.1', port: 0, repoRoot, now,
    mobileInstallationPublicOrigin: '', continuousRepairEnabled: false, custodyStore: store,
    readContinuationSourceHead: () => HEAD });
  server = owner.server;
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const unauthenticated = await fetch(origin + '/mcp', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) });
  assert.equal(unauthenticated.status, 401); await unauthenticated.text();
  assert.equal(owner.sessionCount(), 0);
  const transport = { readFileFn: async () => token,
    fetchFn: async (url, init) => {
      assert(url.startsWith('http://127.0.0.1:18791/'));
      const frame = init.body ? JSON.parse(init.body) : null;
      calls.push({ method: init.method, frame });
      if (init.method !== 'GET') assert.equal(init.headers.authorization, `Bearer ${token}`);
      const response = await fetch(url.replace('http://127.0.0.1:18791', origin), init);
      const tool = frame?.method === 'tools/call' ? frame.params.name : '';
      if (tool === 'maintenance_request_prepare') {
        const local = await readCoreRepairAttemptV1({ workspaceRoot });
        preparedReads.push(local);
        if (losePrepare) { losePrepare = false; lost.push(tool); await response.text(); throw new Error('fixture lost preparation response'); }
      }
      if (tool === 'maintenance_action' && loseExecution) {
        loseExecution = false; lost.push(tool); await response.text(); throw new Error('fixture lost executable response');
      }
      return response;
    } };
  let nextRequest = 0;
  const createController = () => createCoreRepairAttemptControllerV1({ workspaceRoot, repoRoot,
    observerSourceHead: HEAD, assertCoreOwner: async () => true, now,
    requestId: () => 'core-full-path-' + String(++nextRequest).padStart(4, '0'),
    readOwnerStatus: request => querySovereignMaintenanceRequestStatusV1(request, transport),
    prepareOwner: request => prepareSovereignMaintenanceRequestV1(request, transport) });
  const action = { actionId: 'repair-goal-builder-flow', missionId: 'stephanos-core-octopus-self-heal', phase: 'goal-builder',
    admit: async () => true,
    dispatch: continuation => executeSovereignCommanderCommandV1(buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: continuation.requestId, missionId: continuation.missionId, relatedIssue: continuation.relatedIssue,
      operation: 'MAINTENANCE_ACTION', payload: { actionId: continuation.actionId },
    }), { repoRoot, coreContinuation: continuation,
      callMaintenanceOwner: request => callSovereignMaintenanceOwnerV1(request, transport),
      spawnSyncFn: () => assert.fail('Core must delegate to the existing owner'),
    }) };
  return { workspaceRoot, store, owner, transport, calls, nativeCalls, preparedReads, lost,
    createController, action, allocated: () => nextRequest };
}

test('full source path preserves durable identity through lost prepare and execution replies and signed terminal release', async t => {
  const f = await fixture(t, { losePrepare: true, loseExecution: true });
  const controller = f.createController();
  assert.equal((await controller.restore()).ok, true);
  const epoch = await querySovereignMaintenanceRequestStatusV1({}, f.transport);
  assert.match(epoch.enrollmentId, /^[a-f0-9]{64}$/);
  const result = await controller.execute(f.action);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.finalVerdict, 'CORE_REPAIR_ORIGINAL_ATTEMPT_SUCCEEDED');
  assert.equal(result.originalOutcomeProven, false);
  assert.equal(result.continuation.enrollmentId, epoch.enrollmentId);
  assert.equal(result.custodyReleased, true); assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.lost, ['maintenance_request_prepare', 'maintenance_action']);
  assert.equal(f.nativeCalls.length, 1); assert.equal(f.allocated(), 1);
  assert.equal(f.preparedReads.length, 1); assert.equal(f.preparedReads[0].attempt.stage, 'DISPATCH_FENCED');
  assert.deepEqual(f.preparedReads[0].attempt.continuation, result.continuation);
  assert.equal(f.nativeCalls[0].requestId, result.continuation.requestId);
  const executable = f.calls.filter(call => call.frame?.params?.name === 'maintenance_action');
  assert.equal(executable.length, 1);
  assert.deepEqual(executable[0].frame.params.arguments, { actionId: result.continuation.actionId, coreContinuation: result.continuation });
  const original = await querySovereignMaintenanceRequestStatusV1({ continuation: result.continuation }, f.transport);
  assert.ok(captureCoreRepairContinuationStatusV1(original));
  assert.equal(original.state, 'SUCCEEDED'); assert.equal(original.terminalProofHash, result.proofHash);
  assert.equal(original.historyAuthenticated, true); assert.equal(original.custodyReleased, true);
  assert.equal(original.currentAdmissionAvailable, true); assert.equal(original.sameRequestDeliveryAllowed, false);
  const foreignEpoch = { ...result.continuation, enrollmentId: 'e'.repeat(64) };
  for (const exchange of [querySovereignMaintenanceRequestStatusV1, prepareSovereignMaintenanceRequestV1]) {
    const refused = await exchange({ continuation: foreignEpoch }, f.transport);
    assert.equal(refused.blocker, 'CORE_REPAIR_ENROLLMENT_CHANGED');
    assert.equal(refused.historyAuthenticated, false); assert.equal(refused.sameRequestDeliveryAllowed, false);
  }
  assert.equal((await callSovereignMaintenanceOwnerV1({ actionId: foreignEpoch.actionId,
    arguments: { actionId: foreignEpoch.actionId }, coreContinuation: foreignEpoch }, f.transport)).ok, false);
  assert.equal(f.calls.filter(call => call.frame?.params?.name === 'maintenance_action').length, 1);
  const archive = readdirSync(join(f.workspaceRoot, 'events', 'sovereign-maintenance-custody'));
  assert.equal(archive.filter(name => name.startsWith('native-root-')).length, 1);
  assert.equal(archive.filter(name => name.startsWith('native-terminal-')).length, 1);
  const restart = f.createController();
  assert.equal((await restart.restore()).ok, true);
  assert.equal(restart.snapshot().requestId, result.continuation.requestId);
  assert.equal(restart.snapshot().stage, 'SETTLED'); assert.equal(restart.snapshot().originalOutcomeProven, false);
  let work = 0;
  assert.equal((await restart.runAffectedWork({ admit: async () => true, run: async () => ++work })).ok, true);
  assert.equal(work, 1); assert.equal(f.nativeCalls.length, 1); assert.equal(f.allocated(), 1);
  assert.equal(f.owner.sessionCount(), 0);
});

test('full source path retains an unresolved native reservation across missing local state and denies another delivery', async t => {
  const f = await fixture(t, { disposition: 'UNPROVEN', loseExecution: true });
  const controller = f.createController(); await controller.restore();
  const result = await controller.execute(f.action);
  assert.equal(result.ok, false); assert.equal(result.custodyReleased, false);
  assert.equal(controller.snapshot().held, true); assert.equal(f.nativeCalls.length, 1);
  unlinkSync(join(f.workspaceRoot, 'status', CORE_REPAIR_ATTEMPT_FILE));
  const restart = f.createController();
  assert.equal((await restart.restore()).ok, false);
  assert.equal(restart.snapshot().requestId, result.continuation.requestId);
  assert.equal(restart.snapshot().held, true);
  assert.equal((await restart.execute(f.action)).attempted, false);
  assert.equal(f.nativeCalls.length, 1); assert.equal(f.allocated(), 1);
  const original = await querySovereignMaintenanceRequestStatusV1({ continuation: result.continuation }, f.transport);
  assert.equal(original.state, 'RESERVED'); assert.equal(original.historyAuthenticated, true);
  assert.equal(original.custodyReleased, false); assert.equal(original.currentAdmissionAvailable, false);
  assert.equal(original.sameRequestDeliveryAllowed, false); assert.equal(original.terminalProofHash, '');
});

test('full source path does not release the signed store for a native terminal with another source', async t => {
  const f = await fixture(t, { terminalSource: NEXT_HEAD });
  const controller = f.createController(); await controller.restore();
  const result = await controller.execute(f.action);
  assert.equal(result.ok, false); assert.equal(result.custodyReleased, false);
  assert.equal(controller.snapshot().held, true); assert.equal(f.nativeCalls.length, 1);
  const original = await querySovereignMaintenanceRequestStatusV1({ continuation: result.continuation }, f.transport);
  assert.equal(original.state, 'RESERVED'); assert.equal(original.continuation.sourceHead, HEAD);
  assert.equal(original.terminalProofHash, ''); assert.equal(original.custodyReleased, false);
});

test('unmodified Linux guardian durably refuses prepared Core execution without a native launch', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, { native: false });
  const controller = f.createController(); await controller.restore();
  const result = await controller.execute(f.action);
  assert.equal(result.ok, false); assert.equal(result.finalVerdict, 'CORE_REPAIR_ORIGINAL_ATTEMPT_NOT_STARTED');
  assert.equal(result.blocker, 'CORE_REPAIR_NATIVE_WINDOWS_QUALIFICATION_REQUIRED');
  assert.equal(result.custodyReleased, true); assert.equal(result.originalOutcomeProven, false);
  assert.equal(f.nativeCalls.length, 0); assert.equal(f.allocated(), 1);
  assert.equal(controller.snapshot().stage, 'SETTLED');
  const original = await querySovereignMaintenanceRequestStatusV1({ continuation: result.continuation }, f.transport);
  assert.equal(original.state, 'NOT_STARTED'); assert.match(original.terminalProofHash, /^[a-f0-9]{64}$/);
  assert.equal(original.currentAdmissionAvailable, true); assert.equal(original.sameRequestDeliveryAllowed, false);
  assert.equal(original.historyAuthenticated, true); assert.equal(original.custodyReleased, true);
});
