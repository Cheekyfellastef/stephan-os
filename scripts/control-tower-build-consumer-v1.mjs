import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { readControlTowerBuildRequestV1, isAuthenticatedControlTowerBuildRequestV1 } from '../shared/agents/controlTowerBuildReaderV1.mjs';
import { callSovereignMaintenanceOwnerV1 } from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import { resolveGithubAuth } from '../stephanos-server/services/githubAuthResolver.js';
import { FIXED_MAINTENANCE_RUNTIME_ROUTE_V1 } from './sovereign-fixed-runtime-parent-v1.mjs';

const SCHEMA = 'stephanos.control-tower-build-consumer.v1';
const ACTION = FIXED_MAINTENANCE_RUNTIME_ROUTE_V1.actionId;
const SHA = /^[a-f0-9]{40}$/;
const code = value => /^[A-Z0-9_:-]{1,160}$/.test(value || '') ? value : 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN';
const result = (state, blocker = '', extra = {}) => Object.freeze({
  schemaVersion: SCHEMA, state, blocker, ...extra,
  buildStartedProven: false, nativePickupProven: false, goalCompletionProven: false,
  sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false,
});

// An adapter of the existing relay, executor and execution ledger. These are
// transport wake receipts: they never enter the Mission Worker's source-proof
// history or substitute for source claims, pickup, tests or goal completion.
export async function consumeControlTowerBuildRequestV1({
  sourceHead, repoRoot, env = process.env, readSourceHead, now = () => new Date(),
  testOnly = false, dependencies,
} = {}) {
  if (dependencies && (!testOnly || !process.env.NODE_TEST_CONTEXT)) throw Error('test-only dependencies');
  const deps = { resolveAuth: resolveGithubAuth, readRequest: readControlTowerBuildRequestV1,
    isAuthenticated: isAuthenticatedControlTowerBuildRequestV1,
    createLedger: createMailboxExecutionLedger, execute: callSovereignMaintenanceOwnerV1, ...dependencies };
  let request = null, reserved = false;
  const evidence = () => request ? { requestId: request.requestId, runId: request.runId, sourceHead: request.sourceHead,
    artifactId: request.artifactId, artifactSha256: request.artifactSha256, proofRef: request.proofRef } : {};
  try {
    if (!SHA.test(sourceHead || '') || typeof readSourceHead !== 'function'
      || await readSourceHead() !== sourceHead) return result('HELD', 'CONTROL_TOWER_INSTALLED_SOURCE_UNPROVEN');
    // The original ledger's wx reservation and cross-carrier request identity
    // remain authoritative. No second queue, claim store or execution owner.
    const mailboxWorkspace = resolve(env.STEPHANOS_SHARED_WORKSPACE_ROOT
      || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
    const ledger = deps.createLedger(join(mailboxWorkspace, 'github-command-mailbox'));
    const auth = await deps.resolveAuth();
    const observed = await deps.readRequest({ token: auth?.token, now: () => now().toISOString(),
      isRecorded: runId => ledger.has('control-tower-build-' + runId + '-1') });
    if (!observed.ok) return result('WAITING', code(observed.blocker));
    request = observed.request;
    if (!deps.isAuthenticated(request)) return result('HELD', 'CONTROL_TOWER_BUILD_REQUEST_NOT_AUTHENTICATED');
    if (request.sourceHead !== sourceHead || Date.parse(request.expiresAtUtc) <= now().getTime()
      || await readSourceHead() !== sourceHead) return result('HELD', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED', evidence());
    if (ledger.has(request.requestId)) return result('REPLAY_HELD', 'CONTROL_TOWER_BUILD_REQUEST_ALREADY_RECORDED', evidence());
    // issueNumber is the owning build-transport goal, not a mailbox routing
    // identity. The control-tower-build namespace is never a comment command.
    ledger.reserve({ ...request, issueNumber: 2315 });
    reserved = true;
    // A durable reservation precedes the sole invocation. Crash, corruption,
    // lost response or incomplete terminal publication retain the reservation.
    if (await readSourceHead() !== sourceHead || Date.parse(request.expiresAtUtc) <= now().getTime())
      return result('HELD', 'CONTROL_TOWER_BUILD_SOURCE_OR_EXPIRY_CHANGED', evidence());
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
    if (!completed && !refused) return result('UNKNOWN', code(owned?.blocker), evidence());
    const blocker = completed ? '' : code(owned?.blocker);
    ledger.complete({ requestId: request.requestId, issueNumber: 2315, state: completed ? 'DONE' : 'BLOCKED',
      ...(completed ? { proofHash: owned.proofHash } : {}) });
    return result(completed ? 'WAKE_COMPLETED' : 'WAKE_BLOCKED', blocker,
      { ...evidence(), wakeProofHash: completed ? owned.proofHash : '' });
  } catch {
    return result(reserved ? 'UNKNOWN' : 'HELD', 'CONTROL_TOWER_BUILD_DELIVERY_UNPROVEN', evidence());
  }
}

// Cooldown is part of the existing relay cycle, not another scheduled lane.
export function createControlTowerBuildConsumerV1(options) {
  let next = 0, cached = result('WAITING', 'CONTROL_TOWER_BUILD_NOT_OBSERVED'), pending = null;
  return async () => {
    const clock = (options.now || (() => new Date()))().getTime();
    if (pending) return pending;
    if (clock >= next - 30000 && clock < next) return cached;
    pending = consumeControlTowerBuildRequestV1(options);
    try { cached = await pending; next = (options.now || (() => new Date()))().getTime() + 30000; return cached; }
    finally { pending = null; }
  };
}
