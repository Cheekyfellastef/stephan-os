import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { readControlTowerBuildRequestV1, isAuthenticatedControlTowerBuildRequestV1 } from '../shared/agents/controlTowerBuildReaderV1.mjs';
import { callSovereignMaintenanceOwnerV1 } from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { FIXED_MAINTENANCE_RUNTIME_ROUTE_V1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION,
  CONTROL_TOWER_OPERATIONS_V1 } from '../shared/agents/controlTowerBuildRequestV1.mjs';
import { mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { createControlTowerRequestObservationV1, projectControlTowerLatestRequestObservationV1,
  controlTowerObservationBlockerV1, controlTowerBuildObservationUnresolvedV1,
  controlTowerMissingLedgerObservationV1, projectControlTowerLedgerObservationV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { inspectSovereignControlSystemV1 } from './sovereign-commander-native-inspect.mjs';
import { projectSovereignControlSystemStatusV1, SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1 } from '../shared/agents/sovereignControlSystemStatusV1.mjs';

const SCHEMA = 'stephanos.control-tower-build-consumer.v1';
const POLL_STATES = new Set(['WAITING', 'HELD', 'REPLAY_HELD', 'UNKNOWN', 'WAKE_BLOCKED', 'WAKE_COMPLETED',
  'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED']);
const ACTION = FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId;
const SHA = /^[a-f0-9]{40}$/;
const REQUEST = /^control-tower-build-[1-9][0-9]{0,15}-1$/;
const requestId = value => typeof value === 'string' && REQUEST.test(value)
  && Number.isSafeInteger(Number(value.split('-').at(-2))) ? value : '';
const requestPointers = value => Object.freeze({
  latestBuildRequestId: requestId(value?.latestBuildRequestId),
  latestObserveRequestId: requestId(value?.latestObserveRequestId),
});
const code = value => /^[A-Z0-9_:-]{1,160}$/.test(value || '') ? value : 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN';
const result = (state, blocker = '', extra = {}) => Object.freeze({
  schemaVersion: SCHEMA, state, blocker, ...extra,
  buildStartedProven: false, nativePickupProven: false, goalCompletionProven: false,
  sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false,
});

export function controlTowerBuildInitialStatusV1(pointers = {}) {
  return result('WAITING', 'CONTROL_TOWER_BUILD_NOT_OBSERVED', {
    observedAtUtc: '', requestPointers: requestPointers(pointers),
  });
}

// The single state transition for cached polls and relay failure paths. New
// polls may replace current evidence; only validated ledger observations or
// reservation-derived locators replace retained history. Failure is not erasure.
export function retainControlTowerBuildStatusV1(previous, observed, {
  nowMs = Date.now(), failureBlocker = 'CONTROL_TOWER_BUILD_OBSERVATION_FAILED',
} = {}) {
  const safePrevious = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const valid = observed && typeof observed === 'object' && !Array.isArray(observed)
    && observed.schemaVersion === SCHEMA && POLL_STATES.has(observed.state)
    && ['buildStartedProven', 'nativePickupProven', 'goalCompletionProven', 'sourceMutationAllowed',
      'mergeAuthority', 'leaseSeizureAllowed'].every(flag => observed[flag] === false)
    && typeof observed.observedAtUtc === 'string' && Number.isFinite(Date.parse(observed.observedAtUtc))
    && Date.parse(observed.observedAtUtc) <= nowMs + 5000;
  const next = valid ? observed : {};
  const project = value => projectControlTowerLatestRequestObservationV1(value, { nowMs });
  const build = value => {
    const item = project(value);
    return item && [CONTROL_TOWER_BUILD_OPERATION, ''].includes(item.operation) ? item : null;
  };
  const inspect = value => {
    const item = project(value);
    return item?.operation === CONTROL_TOWER_OBSERVE_OPERATION ? item : null;
  };
  const latestBuildRequestObservation = build(next.latestBuildRequestObservation) || build(safePrevious.latestBuildRequestObservation);
  const latestControlSystemObservation = inspect(next.latestControlSystemObservation) || inspect(safePrevious.latestControlSystemObservation);
  const latestRequestObservation = [latestBuildRequestObservation, latestControlSystemObservation].filter(Boolean)
    .sort((a, b) => (Date.parse(b.acceptedAtUtc) || 0) - (Date.parse(a.acceptedAtUtc) || 0) || b.runId - a.runId)[0] || null;
  const oldPointers = requestPointers(safePrevious.requestPointers), newPointers = requestPointers(next.requestPointers);
  const pointers = requestPointers({
    latestBuildRequestId: newPointers.latestBuildRequestId || latestBuildRequestObservation?.requestId || oldPointers.latestBuildRequestId,
    latestObserveRequestId: newPointers.latestObserveRequestId || latestControlSystemObservation?.requestId || oldPointers.latestObserveRequestId,
  });
  const extra = { observedAtUtc: valid ? next.observedAtUtc : new Date(nowMs).toISOString() };
  if (requestId(next.requestId) && next.runId === Number(next.requestId.split('-').at(-2))) {
    extra.requestId = next.requestId; extra.runId = next.runId;
    if (typeof next.sourceHead === 'string' && SHA.test(next.sourceHead)) extra.sourceHead = next.sourceHead;
    if (CONTROL_TOWER_OPERATIONS_V1.includes(next.operation)) extra.operation = next.operation;
    if (Number.isSafeInteger(next.artifactId) && next.artifactId > 0) extra.artifactId = next.artifactId;
    for (const key of ['artifactSha256', 'wakeProofHash', 'observationProofHash'])
      if (typeof next[key] === 'string' && /^[a-f0-9]{64}$/.test(next[key])) extra[key] = next[key];
    if (next.proofRef === `https://github.com/Cheekyfellastef/stephan-os/actions/runs/${next.runId}`) extra.proofRef = next.proofRef;
  }
  const currentPoll = result(valid ? next.state : 'HELD', valid && next.blocker === '' ? ''
    : controlTowerObservationBlockerV1(valid ? next.blocker : failureBlocker, 'CONTROL_TOWER_BUILD_OBSERVATION_FAILED'), extra);
  return Object.freeze({ ...currentPoll, currentPoll, latestBuildRequestObservation, latestControlSystemObservation,
    latestRequestObservation, controlSystemStatus: latestControlSystemObservation?.controlSystemStatus || null,
    requestPointers: pointers });
}

// An adapter of the existing relay, executor and execution ledger. These are
// transport wake receipts: they never enter the Mission Worker's source-proof
// history or substitute for source claims, pickup, tests or goal completion.
export async function consumeControlTowerBuildRequestV1({
  sourceHead, repoRoot, env = process.env, readSourceHead, now = () => new Date(),
  testOnly = false, dependencies, latestBuildRequestId = '', latestObserveRequestId = '',
} = {}) {
  if (dependencies && (!testOnly || !process.env.NODE_TEST_CONTEXT)) throw Error('test-only dependencies');
  const deps = { resolveAuth: resolveGithubAuth, readRequest: readControlTowerBuildRequestV1,
    isAuthenticated: isAuthenticatedControlTowerBuildRequestV1,
    createLedger: createMailboxExecutionLedger, execute: callSovereignMaintenanceOwnerV1,
    inspect: inspectSovereignControlSystemV1, ...dependencies };
  let request = null, reserved = false, ledger = null, initialObservation = null;
  let latestBuild = null, latestObserve = null, discovery = null;
  const restore = (id, operation) => {
    if (!REQUEST.test(id || '') || typeof ledger?.inspectControlTower !== 'function') return null;
    const value = ledger.inspectControlTower(id, { nowMs: now().getTime() });
    // A legacy build-era pointer carries no operation proof. It remains an
    // unresolved build observation, never an observation completion.
    if (value && (value.operation === operation || (operation === CONTROL_TOWER_BUILD_OPERATION && !value.operation))) return value;
    return null;
  };
  const refreshStoredRequest = () => {
    if (!request) return;
    const value = restore(request.requestId, request.operation);
    if (request.operation === CONTROL_TOWER_BUILD_OPERATION) latestBuild = value || latestBuild;
    if (request.operation === CONTROL_TOWER_OBSERVE_OPERATION) latestObserve = value || latestObserve;
  };
  const finish = (state, blocker = '', extra = {}) => {
    const at = now();
    return retainControlTowerBuildStatusV1(null, result(state, blocker, { ...extra, observedAtUtc: at.toISOString(),
      latestBuildRequestObservation: latestBuild, latestControlSystemObservation: latestObserve,
      requestPointers: requestPointers({ latestBuildRequestId: latestBuild?.requestId || latestBuildRequestId,
        latestObserveRequestId: latestObserve?.requestId || latestObserveRequestId }) }), { nowMs: at.getTime() });
  };
  const evidence = () => request ? { requestId: request.requestId, runId: request.runId, sourceHead: request.sourceHead,
    operation: request.operation, artifactId: request.artifactId, artifactSha256: request.artifactSha256, proofRef: request.proofRef } : {};
  try {
    if (!SHA.test(sourceHead || '') || typeof readSourceHead !== 'function'
      || await readSourceHead() !== sourceHead) return finish('HELD', 'CONTROL_TOWER_INSTALLED_SOURCE_UNPROVEN');
    // The original ledger's wx reservation and cross-carrier request identity
    // remain authoritative. No second queue, claim store or execution owner.
    const mailboxWorkspace = resolve(env.STEPHANOS_SHARED_WORKSPACE_ROOT
      || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
    ledger = deps.createLedger(join(mailboxWorkspace, 'github-command-mailbox'));
    latestBuild = restore(latestBuildRequestId, CONTROL_TOWER_BUILD_OPERATION)
      || controlTowerMissingLedgerObservationV1(latestBuildRequestId);
    latestObserve = restore(latestObserveRequestId, CONTROL_TOWER_OBSERVE_OPERATION);
    discovery = typeof ledger.discoverControlTower === 'function'
      ? ledger.discoverControlTower({ nowMs: now().getTime() }) : null;
    if (discovery?.ok) {
      if (latestBuild?.detailState !== 'MISSING') latestBuild = discovery.latestBuildRequestObservation || latestBuild;
      latestObserve = discovery.latestControlSystemObservation || latestObserve;
    }
    const auth = await deps.resolveAuth();
    const observed = await deps.readRequest({ token: auth?.token, now: () => now().toISOString(),
      observationOnly: discovery?.ok !== true || controlTowerBuildObservationUnresolvedV1(latestBuild, { nowMs: now().getTime() }),
      isRecorded: runId => ledger.has('control-tower-build-' + runId + '-1') });
    if (!observed.ok) return discovery?.ok !== true
      ? finish('HELD', discovery?.blocker || 'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN')
      : controlTowerBuildObservationUnresolvedV1(latestBuild, { nowMs: now().getTime() })
        ? finish('HELD', 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED') : finish('WAITING', code(observed.blocker));
    request = observed.request;
    if (!deps.isAuthenticated(request) || !CONTROL_TOWER_OPERATIONS_V1.includes(request.operation))
      return finish('HELD', 'CONTROL_TOWER_BUILD_REQUEST_NOT_AUTHENTICATED');
    if (request.sourceHead !== sourceHead || Date.parse(request.expiresAtUtc) <= now().getTime()
      || await readSourceHead() !== sourceHead) return finish('HELD', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED', evidence());
    if (ledger.has(request.requestId)) { refreshStoredRequest(); return finish('REPLAY_HELD', 'CONTROL_TOWER_BUILD_REQUEST_ALREADY_RECORDED', evidence()); }
    if (request.operation === CONTROL_TOWER_BUILD_OPERATION) {
      // Recheck after authenticated network/source reads, immediately before
      // the synchronous original reservation. This is not a cross-process lock.
      discovery = typeof ledger.discoverControlTower === 'function'
        ? ledger.discoverControlTower({ nowMs: now().getTime() }) : null;
      if (discovery?.ok !== true)
        return finish('HELD', discovery?.blocker || 'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN', evidence());
      if (latestBuild?.detailState !== 'MISSING') latestBuild = discovery.latestBuildRequestObservation || latestBuild;
      latestObserve = discovery.latestControlSystemObservation || latestObserve;
    }
    if (request.operation === CONTROL_TOWER_BUILD_OPERATION
      && controlTowerBuildObservationUnresolvedV1(latestBuild, { nowMs: now().getTime() }))
      return finish('HELD', 'CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED', evidence());
    // issueNumber is the owning build-transport goal, not a mailbox routing
    // identity. The control-tower-build namespace is never a comment command.
    const command = { ...request, issueNumber: 2315 };
    const acceptedAtUtc = now().toISOString();
    initialObservation = createControlTowerRequestObservationV1(request, {
      commandDigest: mailboxRotationDigest(command), acceptedAtUtc, nowMs: now().getTime(),
    });
    if (!initialObservation) return finish('HELD', 'CONTROL_TOWER_BUILD_REQUEST_OBSERVATION_INVALID', evidence());
    const reservation = ledger.reserve(command, { controlTowerObservation: initialObservation });
    reserved = true;
    // Only the original ledger establishes acceptance. Current status is a
    // locator/projection, never a second execution or dedupe authority.
    const previousBuildRequestId = latestBuild?.requestId || '';
    // The successful original wx reservation establishes this locator before
    // any diagnostic re-read can fail. Its returned record is a real ledger fact.
    if (request.operation === CONTROL_TOWER_BUILD_OPERATION) latestBuildRequestId = request.requestId;
    if (request.operation === CONTROL_TOWER_OBSERVE_OPERATION) latestObserveRequestId = request.requestId;
    const reservedObservation = projectControlTowerLedgerObservationV1(reservation, { nowMs: now().getTime() });
    if (request.operation === CONTROL_TOWER_BUILD_OPERATION) latestBuild = reservedObservation || latestBuild;
    if (request.operation === CONTROL_TOWER_OBSERVE_OPERATION) latestObserve = reservedObservation || latestObserve;
    refreshStoredRequest();
    // A durable reservation precedes the sole invocation. Crash, corruption,
    // lost response or incomplete terminal publication retain the reservation.
    if (await readSourceHead() !== sourceHead || Date.parse(request.expiresAtUtc) <= now().getTime())
      return finish('HELD', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED', evidence());
    if (request.operation === CONTROL_TOWER_OBSERVE_OPERATION) {
      // This fixed read-only route never calls the maintenance owner or MCP.
      // Inspect the preceding build's ledger identity, not our own new claim.
      const report = await deps.inspect({ expectedMain: sourceHead,
        ...(previousBuildRequestId ? { controlTowerRequestId: previousBuildRequestId } : {}) });
      const controlSystemStatus = projectSovereignControlSystemStatusV1(report);
      const completed = report?.schemaVersion === SOVEREIGN_CONTROL_SYSTEM_INSPECTION_SCHEMA_V1
        && report.observationCompleted === true && controlSystemStatus?.observationCompleted === true
        && controlSystemStatus.source?.sourceHead === sourceHead
        && controlSystemStatus.source?.expectedMain === sourceHead;
      const state = completed ? 'OBSERVATION_COMPLETED' : 'OBSERVATION_BLOCKED';
      const blocker = completed ? '' : 'CONTROL_TOWER_OBSERVATION_BLOCKED';
      const terminal = createControlTowerRequestObservationV1(request, {
        commandDigest: initialObservation.commandDigest, acceptedAtUtc: initialObservation.acceptedAtUtc,
        observedAtUtc: now().toISOString(), nowMs: now().getTime(), state, blocker, controlSystemStatus,
        observationProofHash: createHash('sha256').update(JSON.stringify(controlSystemStatus)).digest('hex'),
      });
      if (!terminal) return finish('UNKNOWN', 'CONTROL_TOWER_OBSERVATION_UNPROVEN', evidence());
      ledger.complete({ requestId: request.requestId, issueNumber: 2315, state: completed ? 'DONE' : 'BLOCKED',
        controlTowerObservation: terminal });
      refreshStoredRequest();
      return finish(state, blocker, { ...evidence(), observationProofHash: terminal.observationProofHash });
    }
    // Reuse the original compiled goal-builder profile and its complete bounded
    // deadline. A legacy heartbeat is not an admitted native Windows operation.
    // Request authentication grants intent only; the original owner retains
    // every identity/qualification/lease/goal/resource/custody gate.
    const owned = await deps.execute({ actionId: ACTION, arguments: { actionId: ACTION },
      timeoutMs: FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.executionTimeoutMs });
    const exactOwnerAction = owned?.command?.plan?.processId === ACTION;
    const completed = exactOwnerAction && owned?.ok === true
      && owned.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' && /^[a-f0-9]{64}$/.test(owned.proofHash || '');
    const refused = exactOwnerAction && owned?.ok === false
      && owned.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED'
      && typeof owned.blocker === 'string' && code(owned.blocker) === owned.blocker;
    // A transport failure may arrive after owner pickup. Without a matching
    // completed/refused owner response, retain custody and never terminalize.
    if (!completed && !refused) return finish('UNKNOWN', code(owned?.blocker), evidence());
    const blocker = completed ? '' : controlTowerObservationBlockerV1(owned?.blocker);
    const terminal = createControlTowerRequestObservationV1(request, {
      commandDigest: initialObservation.commandDigest, acceptedAtUtc: initialObservation.acceptedAtUtc,
      observedAtUtc: now().toISOString(), nowMs: now().getTime(), state: completed ? 'WAKE_COMPLETED' : 'WAKE_BLOCKED',
      blocker, wakeProofHash: completed ? owned.proofHash : '',
    });
    if (!terminal) return finish('UNKNOWN', 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN', evidence());
    ledger.complete({ requestId: request.requestId, issueNumber: 2315, state: completed ? 'DONE' : 'BLOCKED',
      ...(completed ? { proofHash: owned.proofHash } : {}), controlTowerObservation: terminal });
    refreshStoredRequest();
    return finish(completed ? 'WAKE_COMPLETED' : 'WAKE_BLOCKED', blocker,
      { ...evidence(), wakeProofHash: completed ? owned.proofHash : '' });
  } catch {
    // Do not rewrite RESERVED to annotate UNKNOWN: a lost response retains the
    // same durable identity, and no new metadata writer can race completion.
    return finish(reserved ? 'UNKNOWN' : 'HELD', 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN', evidence());
  }
}

// Cooldown is part of the existing relay cycle, not another scheduled lane.
export function createControlTowerBuildConsumerV1(options) {
  let next = 0, cached = controlTowerBuildInitialStatusV1(options), pending = null;
  let latestBuildRequestId = options.latestBuildRequestId || '';
  let latestObserveRequestId = options.latestObserveRequestId || '';
  return async () => {
    const clock = (options.now || (() => new Date()))().getTime();
    if (pending) return pending;
    if (clock >= next - 30000 && clock < next) return cached;
    pending = (async () => {
      const observed = await consumeControlTowerBuildRequestV1({ ...options, latestBuildRequestId, latestObserveRequestId });
      cached = retainControlTowerBuildStatusV1(cached, observed, { nowMs: (options.now || (() => new Date()))().getTime() });
      if (cached.requestPointers.latestBuildRequestId) latestBuildRequestId = cached.requestPointers.latestBuildRequestId;
      if (cached.requestPointers.latestObserveRequestId) latestObserveRequestId = cached.requestPointers.latestObserveRequestId;
      next = (options.now || (() => new Date()))().getTime() + 30000; return cached;
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}

// A status record restores only bounded locators. Its observations cannot mint
// a ledger outcome or request; each ID is re-read through the original ledger.
export function controlTowerRequestPointersFromRelayStatusV1(status) {
  if (!status || status.schema !== 'stephanos.sovereign-relay-daemon.v1'
    || status.statusId !== 'sovereign-relay-current') return Object.freeze({});
  const value = status.controlTowerBuild;
  const nowMs = Date.now();
  const pointers = requestPointers(value?.requestPointers);
  const build = projectControlTowerLatestRequestObservationV1(value?.latestBuildRequestObservation,
    { expectedHead: status.sourceHead, nowMs });
  const observe = projectControlTowerLatestRequestObservationV1(value?.latestControlSystemObservation,
    { expectedHead: status.sourceHead, nowMs });
  const legacy = value?.operation !== CONTROL_TOWER_OBSERVE_OPERATION
    && !String(value?.state || '').startsWith('OBSERVATION_') && REQUEST.test(value?.requestId || '') ? value.requestId : '';
  return Object.freeze({
    latestBuildRequestId: pointers.latestBuildRequestId || build?.requestId || legacy,
    latestObserveRequestId: pointers.latestObserveRequestId || observe?.requestId || '',
  });
}
