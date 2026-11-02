import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveGithubAuth } from './githubAuthResolver.js';
import { readSovereignControlConversationV1 } from './sovereignControlConversationService.js';
import { createMailboxExecutionLedger } from '../../scripts/canonical-mailbox-execution-ledger-v1.mjs';
import { controlTowerBuildObservationUnresolvedV1 } from '../../shared/agents/controlTowerRequestObservationV1.mjs';

export const CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1 = 'stephanos.control-tower-operator-dispatch.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const OWNER_ID = 267490109;
const WORKFLOW = 'stephanos-control-tower-build.yml';
const ACTIONS_BASE = 'https://api.github.com/repos/' + REPO;
const WORKFLOW_URL = 'https://github.com/' + REPO + '/actions/workflows/' + WORKFLOW;
const OPERATIONS = new Set(['OBSERVE_CONTROL_SYSTEM', 'BUILD_NEXT_ELIGIBLE_GOAL']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_ORIGINS = new Set(['http://127.0.0.1:4173', 'http://localhost:4173']);
const LOCAL_HOSTS = new Set(['127.0.0.1:8787', 'localhost:8787']);
const SHA = /^[a-f0-9]{40}$/;
const HMAC = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SECRET = randomBytes(32);
const active = new Set();
const SHA_HEADER = { accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28', 'user-agent': 'stephanos-existing-control-tower' };
const denied = (blocker, status = 403) => Object.freeze({ schemaVersion: CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1,
  ok: false, blocker, status, workflowRequestAccepted: false, nativeActionSubmitted: false, nativePickupProven: false });
const exactKeys = (value, allowed) => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...allowed].sort().join(','));
const nowIso = ms => new Date(ms).toISOString();
const dispatchSignable = value => JSON.stringify([CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1,
  value.handoffId, value.operation, value.sourceHead, value.expiresAtUtc]);
const signature = value => createHmac('sha256', SECRET).update(dispatchSignable(value)).digest('hex');

// The conversation is read-only. This inert, short-lived, source-bound capability
// is issued ONLY to the locally served operator UI and is never a native credential.
export function isLocalControlTowerOperatorSurfaceV1(req) {
  const headers = req?.headers || {};
  const socket = req?.socket?.remoteAddress || '';
  return LOOPBACK.has(socket)
    && LOCAL_ORIGINS.has(headers.origin)
    && LOCAL_HOSTS.has(String(headers.host || '').toLowerCase())
    && ['same-site', 'same-origin'].includes(headers['sec-fetch-site'])
    && !['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded']
      .some(key => headers[key] !== undefined);
}

export function prepareControlTowerOperatorIntentV1(req, conversation, {
  sourceHead = process.env.STEPHANOS_BACKEND_SOURCE_HEAD, nowMs = Date.now(),
} = {}) {
  const handoff = conversation?.handoff;
  if (!isLocalControlTowerOperatorSurfaceV1(req) || !SHA.test(sourceHead || '')
    || handoff?.state !== 'NOT_SUBMITTED' || handoff.requestSubmitted !== false
    || handoff.executionAuthority !== false || handoff.reusableAuthority !== false
    || handoff.authenticatedOwnerSubmissionRequired !== true
    || handoff.singleAuthenticatedRunRequired !== true
    || handoff.submissionBlockedReason !== '' || !UUID.test(handoff.handoffId || '')
    || !OPERATIONS.has(handoff.operation) || handoff.workflowUrl !== WORKFLOW_URL
    || handoff.workflowRef !== 'main' || !exactKeys(handoff.workflowInputs, ['operation'])
    || handoff.workflowInputs.operation !== handoff.operation
    || !Number.isFinite(nowMs) || !Number.isFinite(Date.parse(handoff.createdAtUtc))
    || Date.parse(handoff.createdAtUtc) > nowMs + 5000
    || nowMs - Date.parse(handoff.createdAtUtc) > 60_000
    || Date.parse(handoff.expiresAtUtc) <= nowMs
    || Date.parse(handoff.expiresAtUtc) - Date.parse(handoff.createdAtUtc) > 600_000)
    return null;
  const value = {
    schemaVersion: CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1,
    handoffId: handoff.handoffId, operation: handoff.operation, sourceHead,
    expiresAtUtc: nowIso(Math.min(Date.parse(handoff.expiresAtUtc), nowMs + 120_000)),
  };
  return Object.freeze({ ...value, signature: signature(value),
    operatorClickRequired: true, workflowRequestAccepted: false, nativeActionSubmitted: false });
}

async function githubRead(fetchFn, url, token) {
  const response = await fetchFn(url, { method: 'GET', redirect: 'error',
    headers: { ...SHA_HEADER, authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(8_000) });
  if (!response?.ok || response.status !== 200) throw Error('CONTROL_TOWER_GITHUB_IDENTITY_READ_FAILED');
  const body = await response.text();
  if (body.length > 16384) throw Error('CONTROL_TOWER_GITHUB_RESPONSE_BOUND');
  return JSON.parse(body);
}

async function verifyGithubOwnerAndMain({ fetchFn, token, sourceHead }) {
  const actor = await githubRead(fetchFn, 'https://api.github.com/user', token);
  if (actor?.login !== 'Cheekyfellastef' || actor?.id !== OWNER_ID)
    throw Error('CONTROL_TOWER_GITHUB_OWNER_UNPROVEN');
  const ref = await githubRead(fetchFn, ACTIONS_BASE + '/git/ref/heads/main', token);
  if (ref?.ref !== 'refs/heads/main' || ref.object?.sha !== sourceHead)
    throw Error('CONTROL_TOWER_PROTECTED_MAIN_MOVED');
  const workflow = await githubRead(fetchFn, ACTIONS_BASE + '/actions/workflows/' + WORKFLOW, token);
  if (workflow?.path !== '.github/workflows/' + WORKFLOW || workflow?.state !== 'active'
    || !Number.isSafeInteger(workflow.id) || workflow.id < 1)
    throw Error('CONTROL_TOWER_WORKFLOW_IDENTITY_UNPROVEN');
}

async function existingLedgerSafeToSubmit(operation, nowMs, env) {
  if (operation !== 'BUILD_NEXT_ELIGIBLE_GOAL') return true;
  const root = env.STEPHANOS_SHARED_WORKSPACE_ROOT
    || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace');
  const ledger = createMailboxExecutionLedger(join(root, 'github-command-mailbox'));
  const discovery = ledger.discoverControlTower({ nowMs });
  return discovery?.ok === true && !controlTowerBuildObservationUnresolvedV1(
    discovery.latestBuildRequestObservation, { nowMs });
}

async function reserveIntent(handoffId, operation, sourceHead, env, nowMs) {
  const root = env.STEPHANOS_SHARED_WORKSPACE_ROOT
    || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace');
  const mailbox = join(root, 'github-command-mailbox');
  const rootStat = await lstat(mailbox);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('CONTROL_TOWER_EXISTING_LEDGER_UNSAFE');
  // A one-shot idempotency receipt INSIDE the existing ledger, never a new
  // scheduler, command queue, lease, mailbox, or execution owner.
  const directory = join(mailbox, 'operator-dispatch-intents-v1');
  try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('CONTROL_TOWER_INTENT_PATH_UNSAFE');
  const id = createHash('sha256').update(handoffId).digest('hex');
  const location = join(directory, id + '.json');
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0);
  const file = await open(location, flags, 0o600);
  try {
    await file.writeFile(JSON.stringify({
      schemaVersion: CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1,
      handoffId, operation, sourceHead, acceptedAtUtc: nowIso(nowMs),
      state: 'DISPATCH_OUTCOME_UNVERIFIED',
    }) + '\n');
    await file.sync();
  } finally { await file.close(); }
}

// Explicit operator click only. An uncertain GitHub POST is never retried;
// a 204 is dispatch acceptance, NOT an authenticated run, wake, or native build.
export async function dispatchControlTowerOperatorIntentV1(req, input, options = {}) {
  const test = process.env.NODE_TEST_CONTEXT && options.testOnly === true;
  if (Object.keys(options).length && !test)
    return denied('CONTROL_TOWER_DISPATCH_TEST_OPTIONS_FORBIDDEN');
  const deps = test ? options : {};
  const env = deps.env || process.env;
  const clock = deps.nowMs || Date.now;
  const sourceHead = env.STEPHANOS_BACKEND_SOURCE_HEAD || '';
  const ms = clock();
  if (!isLocalControlTowerOperatorSurfaceV1(req)
    || req.headers?.['x-stephanos-operator-click'] !== 'confirmed-v1'
    || String(req.headers?.['content-type'] || '').split(';')[0].toLowerCase() !== 'application/json')
    return denied('CONTROL_TOWER_LOCAL_OPERATOR_REQUIRED');
  if (!exactKeys(input, ['schemaVersion', 'handoffId', 'operation', 'sourceHead', 'expiresAtUtc', 'signature'])
    || input.schemaVersion !== CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1
    || !UUID.test(input.handoffId || '') || !OPERATIONS.has(input.operation)
    || !SHA.test(input.sourceHead || '') || input.sourceHead !== sourceHead
    || !HMAC.test(input.signature || '')
    || !Number.isFinite(ms) || !Number.isFinite(Date.parse(input.expiresAtUtc))
    || Date.parse(input.expiresAtUtc) <= ms || Date.parse(input.expiresAtUtc) > ms + 120_000)
    return denied('CONTROL_TOWER_OPERATOR_INTENT_INVALID');
  const expected = Buffer.from(signature(input), 'hex');
  if (!timingSafeEqual(Buffer.from(input.signature, 'hex'), expected))
    return denied('CONTROL_TOWER_OPERATOR_INTENT_UNAUTHENTICATED');
  if (active.has(input.handoffId)) return denied('CONTROL_TOWER_INTENT_ALREADY_RESERVED', 409);
  active.add(input.handoffId);
  let reserved = false;
  try {
    const observe = deps.observe || readSovereignControlConversationV1;
    const view = await observe({ prompt: 'Control Tower status', requestedTargetId: 'control-tower' });
    if (view?.controlTower?.observed !== true || view?.controlTower?.exactHeadMatch !== true
      || view?.commander?.observed !== true)
      return denied('CONTROL_TOWER_LIVE_AUTHORITY_UNPROVEN', 503);
    if (!(await (deps.safeLedger || existingLedgerSafeToSubmit)(input.operation, ms, env)))
      return denied('CONTROL_TOWER_PREVIOUS_BUILD_UNRESOLVED', 409);
    const auth = await (deps.resolveAuth || resolveGithubAuth)();
    if (!auth?.token || auth.token.length < 32) return denied('CONTROL_TOWER_GITHUB_OWNER_TOKEN_UNAVAILABLE', 503);
    const fetchFn = deps.fetchFn || globalThis.fetch;
    await verifyGithubOwnerAndMain({ fetchFn, token: auth.token, sourceHead });
    if (clock() >= Date.parse(input.expiresAtUtc)
      || env.STEPHANOS_BACKEND_SOURCE_HEAD !== input.sourceHead)
      return denied('CONTROL_TOWER_DISPATCH_HEAD_OR_EXPIRY_MOVED', 409);
    await (deps.reserve || reserveIntent)(input.handoffId, input.operation, sourceHead, env, clock());
    reserved = true;
    const response = await fetchFn(ACTIONS_BASE + '/actions/workflows/' + WORKFLOW + '/dispatches', {
      method: 'POST', redirect: 'error',
      headers: { ...SHA_HEADER, authorization: 'Bearer ' + auth.token, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { operation: input.operation } }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response?.status !== 204) return denied('CONTROL_TOWER_GITHUB_DISPATCH_REFUSED_OR_UNKNOWN', 502);
    return Object.freeze({ schemaVersion: CONTROL_TOWER_OPERATOR_DISPATCH_SCHEMA_V1,
      ok: true, status: 202, blocker: '', state: 'DISPATCH_ACCEPTED_UNCORRELATED',
      workflowRequestAccepted: true, requestId: '', nativeActionSubmitted: false,
      nativePickupProven: false, workflow: WORKFLOW_URL, operation: input.operation,
      message: 'GitHub accepted the workflow request. Await the original authenticated relay and execution-ledger receipt.' });
  } catch (error) {
    if (reserved) return denied('CONTROL_TOWER_GITHUB_DISPATCH_OUTCOME_UNVERIFIED', 503);
    if (error?.code === 'EEXIST') return denied('CONTROL_TOWER_INTENT_ALREADY_RESERVED', 409);
    return denied(/^[A-Z0-9_]{1,100}$/.test(error?.message || '')
      ? error.message : 'CONTROL_TOWER_DISPATCH_PREFLIGHT_UNAVAILABLE', 503);
  } finally {
    // Failed preflight may be repaired with the SAME signed intent; after a
    // reservation this identity is permanently spent, even after a restart.
    if (!reserved) active.delete(input.handoffId);
  }
}
