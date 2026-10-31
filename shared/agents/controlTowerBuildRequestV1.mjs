export const CONTROL_TOWER_BUILD_SCHEMA = 'stephanos.control-tower-build-request.v1';
export const CONTROL_TOWER_BUILD_WORKFLOW = '.github/workflows/stephanos-control-tower-build.yml';
export const CONTROL_TOWER_BUILD_FILE = 'control-tower-build-request.json';
export const CONTROL_TOWER_BUILD_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const CONTROL_TOWER_BUILD_OPERATION = 'BUILD_NEXT_ELIGIBLE_GOAL';
export const CONTROL_TOWER_OBSERVE_OPERATION = 'OBSERVE_CONTROL_SYSTEM';
export const CONTROL_TOWER_OPERATIONS_V1 = Object.freeze([
  CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION,
]);
export const CONTROL_TOWER_BUILD_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'operation', 'repository', 'repositoryId', 'operatorId',
  'runId', 'runAttempt', 'sourceHead', 'createdAtUtc', 'expiresAtUtc',
  'admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed',
]);
const SHA = /^[a-f0-9]{40}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const utc = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)
  && Number.isFinite(Date.parse(s));
const denied = blocker => Object.freeze({ ok: false, blocker });

export function createControlTowerBuildRequestV1(event, env, mainHead, nowUtc) {
  // A protected-main push by the exact owner is a bounded standing intent to
  // wake the ORIGINAL scheduler. It is not source, runtime or merge authority.
  // Manual workflow_dispatch remains available as the explicit fallback.
  const manual = env?.GITHUB_EVENT_NAME === 'workflow_dispatch'
    && ['main', 'refs/heads/main'].includes(event?.ref);
  const ownerMainPush = env?.GITHUB_EVENT_NAME === 'push'
    && event?.ref === 'refs/heads/main' && event?.after === mainHead
    && SHA.test(event?.before || '') && event.before !== mainHead
    && event?.head_commit?.id === mainHead
    && event?.created === false && event?.deleted === false && event?.forced === false
    && event?.inputs == null;
  if (env?.GITHUB_ACTIONS !== 'true' || (!manual && !ownerMainPush)
    || env.GITHUB_JOB !== 'request-build' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== CONTROL_TOWER_BUILD_REPOSITORY
    || env.GITHUB_WORKFLOW_REF !== CONTROL_TOWER_BUILD_REPOSITORY + '/' + CONTROL_TOWER_BUILD_WORKFLOW + '@refs/heads/main'
    || event?.repository?.full_name !== CONTROL_TOWER_BUILD_REPOSITORY || event.repository.id !== 1179385578
    || event.repository.owner?.login !== 'Cheekyfellastef'
    || env.GITHUB_ACTOR !== 'Cheekyfellastef' || env.GITHUB_ACTOR_ID !== '267490109'
    || event.sender?.login !== 'Cheekyfellastef' || event.sender?.id !== 267490109 || event.sender?.type !== 'User')
    return denied('AUTHENTICATED_BUILD_DISPATCH_INVALID');
  // The existing authenticated carrier has two fixed operations. An observation
  // never enters the maintenance executor. Neither accepts free text, a path,
  // a command, a goal grant, or any mailbox-rotation authority.
  if (event.inputs != null && (typeof event.inputs !== 'object' || Array.isArray(event.inputs)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(event.inputs))
    || Object.keys(event.inputs).some(key => key !== 'operation')))
    return denied('BUILD_DISPATCH_INPUTS_FORBIDDEN');
  const operation = manual && event.inputs != null && Object.hasOwn(event.inputs, 'operation')
    ? event.inputs.operation : CONTROL_TOWER_BUILD_OPERATION;
  if (!CONTROL_TOWER_OPERATIONS_V1.includes(operation)) return denied('BUILD_DISPATCH_INPUTS_FORBIDDEN');
  if (!SHA.test(mainHead || '') || env.GITHUB_SHA !== mainHead || env.GITHUB_RUN_ATTEMPT !== '1'
    || !/^[1-9][0-9]{0,15}$/.test(env.GITHUB_RUN_ID || '') || !positive(Number(env.GITHUB_RUN_ID)) || !utc(nowUtc))
    return denied('BUILD_DISPATCH_SOURCE_RUN_OR_CLOCK_INVALID');
  return Object.freeze({ ok: true, blocker: '', request: Object.freeze({
    schemaVersion: CONTROL_TOWER_BUILD_SCHEMA,
    requestId: 'control-tower-build-' + env.GITHUB_RUN_ID + '-1',
    operation, repository: CONTROL_TOWER_BUILD_REPOSITORY,
    repositoryId: 1179385578, operatorId: 267490109, runId: Number(env.GITHUB_RUN_ID), runAttempt: 1,
    sourceHead: mainHead, createdAtUtc: nowUtc, expiresAtUtc: new Date(Date.parse(nowUtc) + 600000).toISOString(),
    admissionGranted: false, mergeAuthority: false, runtimeMutationAuthority: false,
    leaseSeizureAllowed: false, arbitraryShellAllowed: false,
  }) });
}

export function validateControlTowerBuildRequestV1(request, run, mainHead, nowUtc) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).length !== CONTROL_TOWER_BUILD_KEYS.length
    || !CONTROL_TOWER_BUILD_KEYS.every(k => Object.hasOwn(request, k))
    || request.schemaVersion !== CONTROL_TOWER_BUILD_SCHEMA
    || !CONTROL_TOWER_OPERATIONS_V1.includes(request.operation)
    || request.repository !== CONTROL_TOWER_BUILD_REPOSITORY || request.repositoryId !== 1179385578
    || request.operatorId !== 267490109 || !positive(request.runId) || request.runAttempt !== 1
    || request.requestId !== 'control-tower-build-' + request.runId + '-1'
    || !['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed']
      .every(k => request[k] === false)) return denied('BUILD_REQUEST_SCOPE_INVALID');
  if (!SHA.test(mainHead || '') || request.sourceHead !== mainHead || run?.head_sha !== mainHead
    || run.id !== request.runId || run.head_branch !== 'main' || run.run_attempt !== 1
    || !['workflow_dispatch', 'push'].includes(run.event)
    || (run.event === 'push' && request.operation !== CONTROL_TOWER_BUILD_OPERATION)
    || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== CONTROL_TOWER_BUILD_WORKFLOW || run.repository?.full_name !== CONTROL_TOWER_BUILD_REPOSITORY
    || run.repository?.id !== 1179385578 || run.actor?.login !== 'Cheekyfellastef' || run.actor?.id !== 267490109
    || run.triggering_actor?.login !== 'Cheekyfellastef' || run.triggering_actor?.id !== 267490109)
    return denied('BUILD_REQUEST_AUTHENTICATED_RUN_INVALID');
  if (![request.createdAtUtc, request.expiresAtUtc, run.created_at, run.updated_at, nowUtc].every(utc)
    || Date.parse(run.updated_at) < Date.parse(run.created_at)
    || Date.parse(request.createdAtUtc) < Date.parse(run.created_at)
    || Date.parse(request.createdAtUtc) > Date.parse(run.updated_at) + 5000
    || Date.parse(request.createdAtUtc) > Date.parse(nowUtc) + 5000
    || Date.parse(run.updated_at) > Date.parse(nowUtc) + 5000
    || Date.parse(request.expiresAtUtc) - Date.parse(request.createdAtUtc) !== 600000
    || Date.parse(request.expiresAtUtc) <= Date.parse(nowUtc)) return denied('BUILD_REQUEST_EXPIRED_OR_CLOCK_INVALID');
  return Object.freeze({ ok: true, blocker: '' });
}
