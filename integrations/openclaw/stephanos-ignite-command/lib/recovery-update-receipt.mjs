import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { ensureSafeReceiptDirectoryChainSync } from '../../../../shared/agents/safeReceiptDirectoryChainV1.mjs';

export const OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA = 'stephanos.openclaw-exact-head-update-receipt.v3';
export const OPENCLAW_BATTLE_BRIDGE_UPDATE_AUTHORIZATION_SCHEMA = 'stephanos.openclaw-exact-head-update-authorization.v1';
export const OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE = 'OPENCLAW_WHATSAPP_EXACT_HEAD';
export const OPENCLAW_BATTLE_BRIDGE_DIRECT_CLAIM_SCHEMA = 'stephanos.openclaw-exact-head-update-owner-handler-claim.v1';

const AUTHORIZATION_SUBJECT = 'openclaw:authenticated-operator';
const AUTHORIZATION_SURFACE = 'openclaw.plugin-sdk.authenticated-command';
const RECEIPT_ID = /^[a-f0-9]{32}$/;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const MAX_RECEIPT_BYTES = 128 * 1024;
const AUTHORIZATION_LIFETIME_MS = 60_000;
const AUTHORIZATION_FUTURE_SKEW_MS = 30_000;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function canonicalIso(value) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) return '';
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : '';
}

function assertExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function authorizationKeys() {
  return [
    'authenticatedByHost', 'command', 'commandName', 'commandSurface', 'expectedHead',
    'expiresAtUtc', 'hostPid', 'issuedAtUtc', 'proofId', 'receiptId', 'route',
    'runtimeId', 'schemaVersion', 'senderIsOwner', 'subject',
  ].sort();
}

export function buildOpenClawUpdateAuthorization({ receiptId, expectedHead, authenticatedContext, hostPid = process.pid, now = new Date() } = {}) {
  if (!RECEIPT_ID.test(String(receiptId || '')) || !EXACT_HEAD.test(String(expectedHead || ''))) {
    throw codedError('UPDATE_AUTHORIZATION_BINDING_INVALID');
  }
  if (authenticatedContext?.authenticatedByHost !== true
      || authenticatedContext?.commandName !== 'stephanos-ignite'
      || authenticatedContext?.command !== 'update'
      || authenticatedContext?.senderIsOwner !== true) throw codedError('OWNER_AUTH_REQUIRED');
  if (!Number.isSafeInteger(hostPid) || hostPid < 1 || !Number.isFinite(now?.getTime?.())) {
    throw codedError('UPDATE_AUTHORIZATION_HOST_IDENTITY_INVALID');
  }
  const issuedAtMs = now.getTime();
  return Object.freeze({
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_UPDATE_AUTHORIZATION_SCHEMA,
    proofId: receiptId,
    receiptId,
    expectedHead,
    route: OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE,
    commandName: 'stephanos-ignite',
    command: 'update',
    subject: AUTHORIZATION_SUBJECT,
    authenticatedByHost: true,
    senderIsOwner: true,
    commandSurface: AUTHORIZATION_SURFACE,
    hostPid,
    runtimeId: `openclaw-plugin-host:${hostPid}`,
    issuedAtUtc: new Date(issuedAtMs).toISOString(),
    expiresAtUtc: new Date(issuedAtMs + AUTHORIZATION_LIFETIME_MS).toISOString(),
  });
}

export function validateOpenClawUpdateAuthorization(authorization, { receiptId, expectedHead, parentHostPid, now = new Date() } = {}) {
  const nowMs = now?.getTime?.();
  const issuedAtUtc = canonicalIso(authorization?.issuedAtUtc);
  const expiresAtUtc = canonicalIso(authorization?.expiresAtUtc);
  const issuedAtMs = Date.parse(issuedAtUtc);
  const expiresAtMs = Date.parse(expiresAtUtc);
  const valid = assertExactKeys(authorization, authorizationKeys())
    && RECEIPT_ID.test(String(receiptId || '')) && EXACT_HEAD.test(String(expectedHead || ''))
    && authorization.schemaVersion === OPENCLAW_BATTLE_BRIDGE_UPDATE_AUTHORIZATION_SCHEMA
    && authorization.proofId === receiptId && authorization.receiptId === receiptId
    && authorization.expectedHead === expectedHead && authorization.route === OPENCLAW_BATTLE_BRIDGE_UPDATE_ROUTE
    && authorization.commandName === 'stephanos-ignite' && authorization.command === 'update'
    && authorization.subject === AUTHORIZATION_SUBJECT && authorization.authenticatedByHost === true
    && authorization.senderIsOwner === true && authorization.commandSurface === AUTHORIZATION_SURFACE
    && Number.isSafeInteger(parentHostPid) && parentHostPid > 0 && authorization.hostPid === parentHostPid
    && authorization.runtimeId === `openclaw-plugin-host:${parentHostPid}`
    && Number.isFinite(nowMs) && Number.isFinite(issuedAtMs) && Number.isFinite(expiresAtMs)
    && issuedAtMs <= nowMs + AUTHORIZATION_FUTURE_SKEW_MS && issuedAtMs >= nowMs - AUTHORIZATION_LIFETIME_MS
    && expiresAtMs > nowMs && expiresAtMs > issuedAtMs && expiresAtMs - issuedAtMs <= AUTHORIZATION_LIFETIME_MS;
  return Object.freeze({ ok: valid, blocker: valid ? '' : 'QUEUED_UPDATE_AUTHORIZATION_INVALID' });
}

export function resolveOpenClawUpdateReceiptPaths({ env = process.env, receiptId } = {}) {
  if (!env.USERPROFILE || !RECEIPT_ID.test(String(receiptId || ''))) throw codedError('UPDATE_RECEIPT_PATH_INVALID');
  const root = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace', 'receipts', 'exact-head-update');
  const receiptPath = path.resolve(root, `${receiptId}.json`);
  const claimPath = path.resolve(root, `${receiptId}.claim.json`);
  const activePath = path.resolve(root, 'active-owner-update.json');
  for (const pathname of [receiptPath, claimPath, activePath]) {
    const relative = path.relative(root, pathname);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw codedError('UPDATE_RECEIPT_PATH_INVALID');
  }
  return Object.freeze({ root, receiptPath, claimPath, activePath });
}

export function ensureOpenClawUpdateReceiptRoot(paths, { create = false } = {}) {
  return ensureSafeReceiptDirectoryChainSync(paths.root, {
    create,
    linkedBlocker: 'UPDATE_RECEIPT_LINKED_ANCESTOR',
    changedBlocker: 'UPDATE_RECEIPT_ANCESTOR_CHANGED',
    missingBlocker: 'UPDATE_RECEIPT_DIRECTORY_MISSING',
  });
}

function writeExclusiveJson(pathname, value) {
  const descriptor = openSync(pathname, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}

function serializedRecordDigest(value) {
  return createHash('sha256').update(`${JSON.stringify(value, null, 2)}\n`, 'utf8').digest('hex');
}

export function writeNewOpenClawUpdateReceipt({ paths, safeRoot, receipt }) {
  safeRoot.recheck();
  writeExclusiveJson(paths.receiptPath, receipt);
  safeRoot.recheck();
  return receipt;
}

export function replaceOpenClawUpdateRecord({ pathname, root, safeRoot, value, nonce = randomUUID() }) {
  const suffix = String(nonce).replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
  if (!RECEIPT_ID.test(suffix)) throw codedError('UPDATE_RECEIPT_TEMP_PATH_INVALID');
  const temporaryPath = path.resolve(root, `${path.basename(pathname)}.${suffix}.tmp`);
  const relative = path.relative(root, temporaryPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw codedError('UPDATE_RECEIPT_TEMP_PATH_INVALID');
  safeRoot.recheck();
  writeExclusiveJson(temporaryPath, value);
  safeRoot.recheck();
  renameSync(temporaryPath, pathname);
  safeRoot.recheck();
  return value;
}

function receiptFileIdentity(info) {
  return [info.dev, info.ino, info.mode, info.size, info.mtimeNs ?? info.mtimeMs, info.ctimeNs ?? info.ctimeMs].map(String).join(':');
}

function inspectRegularReceipt(pathname, blocker) {
  let info;
  try { info = lstatSync(pathname, { bigint: true }); } catch { throw codedError(blocker); }
  if (info.isSymbolicLink() || !info.isFile() || info.size > BigInt(MAX_RECEIPT_BYTES)) throw codedError(blocker);
  return Object.freeze({ info, identity: receiptFileIdentity(info) });
}

function readStableJsonRecord({ pathname, safeRoot, invalidBlocker, changedBlocker }) {
  safeRoot.recheck();
  const pathBefore = inspectRegularReceipt(pathname, invalidBlocker);
  let descriptor;
  let before;
  let after;
  let bytes;
  try {
    descriptor = openSync(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
    before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_RECEIPT_BYTES)) throw codedError(invalidBlocker);
    const buffer = Buffer.allocUnsafe(MAX_RECEIPT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > MAX_RECEIPT_BYTES) throw codedError(invalidBlocker);
    bytes = buffer.subarray(0, offset);
    after = fstatSync(descriptor, { bigint: true });
  } catch (error) {
    if (error?.code === invalidBlocker) throw error;
    throw codedError(invalidBlocker);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
  const pathAfter = inspectRegularReceipt(pathname, invalidBlocker);
  safeRoot.recheck();
  const handleBeforeIdentity = receiptFileIdentity(before);
  if (pathBefore.identity !== handleBeforeIdentity || handleBeforeIdentity !== receiptFileIdentity(after)
      || handleBeforeIdentity !== pathAfter.identity) throw codedError(changedBlocker);
  let raw;
  let value;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(raw);
  } catch { throw codedError(invalidBlocker); }
  return Object.freeze({ value, raw, digest: createHash('sha256').update(bytes).digest('hex'), identity: handleBeforeIdentity });
}

export function readStableOpenClawUpdateReceipt({ paths, safeRoot }) {
  const observed = readStableJsonRecord({
    pathname: paths.receiptPath,
    safeRoot,
    invalidBlocker: 'QUEUED_UPDATE_RECEIPT_INVALID',
    changedBlocker: 'QUEUED_UPDATE_RECEIPT_IDENTITY_CHANGED',
  });
  return Object.freeze({ ...observed, receipt: observed.value });
}

export function claimOpenClawUpdateInOwnerHandler({ paths, safeRoot, queued, claimantPid = process.pid, now = new Date() } = {}) {
  const claimedAtUtc = now.toISOString();
  const claim = Object.freeze({
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_DIRECT_CLAIM_SCHEMA,
    receiptId: queued.receiptId,
    expectedHead: queued.expectedHead,
    authorizationProofId: queued.authorization.proofId,
    queuedReceiptSha256: serializedRecordDigest(queued),
    claimantPid,
    status: 'CLAIMED',
    claimedAtUtc,
  });
  safeRoot.recheck();
  try {
    lstatSync(paths.activePath);
    throw codedError('PREVIOUS_UPDATE_EXECUTION_UNPROVEN');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw codedError('PREVIOUS_UPDATE_EXECUTION_UNPROVEN');
  }
  const active = Object.freeze({
    schemaVersion: OPENCLAW_BATTLE_BRIDGE_DIRECT_CLAIM_SCHEMA,
    receiptId: queued.receiptId,
    expectedHead: queued.expectedHead,
    claimantPid,
    status: 'CLAIMED',
    claimedAtUtc,
  });
  let claimWritten = false;
  let activeWritten = false;
  try {
    safeRoot.recheck();
    writeExclusiveJson(paths.claimPath, claim);
    claimWritten = true;
    safeRoot.recheck();
    try { writeExclusiveJson(paths.activePath, active); } catch (error) {
      if (error?.code === 'EEXIST') throw codedError('PREVIOUS_UPDATE_EXECUTION_UNPROVEN');
      throw error;
    }
    activeWritten = true;
    safeRoot.recheck();
    const observed = readStableOpenClawUpdateReceipt({ paths, safeRoot });
    if (observed.digest !== claim.queuedReceiptSha256
        || observed.receipt?.schemaVersion !== OPENCLAW_BATTLE_BRIDGE_UPDATE_RECEIPT_SCHEMA
        || observed.receipt?.status !== 'QUEUED' || observed.receipt?.receiptId !== queued.receiptId
        || observed.receipt?.expectedHead !== queued.expectedHead) throw codedError('QUEUED_UPDATE_RECEIPT_IDENTITY_CHANGED');
    const receipt = Object.freeze({
      ...queued,
      status: 'EXECUTING',
      finalVerdict: 'UPDATE_EXECUTION_RUNNING',
      claimedAtUtc,
      startedAtUtc: claimedAtUtc,
      claimantPid,
    });
    replaceOpenClawUpdateRecord({ pathname: paths.receiptPath, root: paths.root, safeRoot, value: receipt });
    return Object.freeze({ claim, receipt });
  } catch (error) {
    try {
      if (!claimWritten) throw error;
      replaceOpenClawUpdateRecord({
        pathname: paths.claimPath,
        root: paths.root,
        safeRoot,
        value: { ...claim, status: 'FAILED', blocker: error?.code || 'UPDATE_CLAIM_PERSIST_FAILED', failedAtUtc: new Date().toISOString() },
      });
    } catch { /* the exclusive or pre-existing claim remains durable and fail closed */ }
    try {
      if (!activeWritten) throw error;
      replaceOpenClawUpdateRecord({
        pathname: paths.activePath,
        root: paths.root,
        safeRoot,
        value: { ...active, status: 'FAILED', blocker: error?.code || 'UPDATE_CLAIM_PERSIST_FAILED', failedAtUtc: new Date().toISOString() },
      });
    } catch { /* active execution evidence remains nonterminal and fail closed */ }
    throw error;
  }
}

const OWNER_LANE_TERMINAL_STATUSES = new Set([
  'FAILED', 'PLUGIN_RELOAD_PROOF_PENDING', 'SOURCE_UPDATED_RUNTIME_PROOF_PENDING', 'DONE',
]);

// The active record is deliberately not adoptable. A later process treats any
// surviving record as unproven, regardless of its JSON contents. Only the same
// live owner-handler call stack may remove its own record, after all children
// have closed and receipt + claim + active projections agree on terminal truth.
export function releaseOpenClawUpdateOwnerLane({ paths, safeRoot, claimed } = {}) {
  const receipt = readStableOpenClawUpdateReceipt({ paths, safeRoot }).receipt;
  const claim = readStableJsonRecord({
    pathname: paths.claimPath,
    safeRoot,
    invalidBlocker: 'UPDATE_CLAIM_RELEASE_INVALID',
    changedBlocker: 'UPDATE_CLAIM_RELEASE_CHANGED',
  }).value;
  const active = readStableJsonRecord({
    pathname: paths.activePath,
    safeRoot,
    invalidBlocker: 'UPDATE_ACTIVE_RELEASE_INVALID',
    changedBlocker: 'UPDATE_ACTIVE_RELEASE_CHANGED',
  }).value;
  const receiptId = claimed?.receipt?.receiptId;
  const expectedHead = claimed?.receipt?.expectedHead;
  const claimantPid = claimed?.receipt?.claimantPid;
  const bindingMatches = receipt?.receiptId === receiptId
    && claim?.receiptId === receiptId && active?.receiptId === receiptId
    && receipt?.expectedHead === expectedHead
    && claim?.expectedHead === expectedHead && active?.expectedHead === expectedHead
    && receipt?.claimantPid === claimantPid
    && claim?.claimantPid === claimantPid && active?.claimantPid === claimantPid;
  const statusMatches = OWNER_LANE_TERMINAL_STATUSES.has(receipt?.status)
    && claim?.status === receipt.status && active?.status === receipt.status;
  if (!bindingMatches || !statusMatches) throw codedError('UPDATE_ACTIVE_RELEASE_BINDING_INVALID');
  safeRoot.recheck();
  unlinkSync(paths.activePath);
  safeRoot.recheck();
  return Object.freeze({ receiptId, status: receipt.status, released: true });
}

export function persistOpenClawUpdateCheckpoint({ paths, safeRoot, claimed, receipt, claimStatus = receipt.status } = {}) {
  const current = readStableOpenClawUpdateReceipt({ paths, safeRoot });
  if (current.receipt?.receiptId !== claimed.receipt.receiptId
      || current.receipt?.expectedHead !== claimed.receipt.expectedHead
      || current.receipt?.claimantPid !== claimed.receipt.claimantPid) throw codedError('UPDATE_RECEIPT_CLAIM_BINDING_INVALID');
  replaceOpenClawUpdateRecord({ pathname: paths.receiptPath, root: paths.root, safeRoot, value: receipt });
  let projectionBlocker = '';
  try {
    const currentClaim = readStableJsonRecord({
      pathname: paths.claimPath,
      safeRoot,
      invalidBlocker: 'UPDATE_CLAIM_PROJECTION_INVALID',
      changedBlocker: 'UPDATE_CLAIM_PROJECTION_CHANGED',
    }).value;
    if (currentClaim?.receiptId !== claimed.receipt.receiptId
        || currentClaim?.expectedHead !== claimed.receipt.expectedHead
        || currentClaim?.claimantPid !== claimed.receipt.claimantPid) throw codedError('UPDATE_CLAIM_PROJECTION_BINDING_INVALID');
    replaceOpenClawUpdateRecord({
      pathname: paths.claimPath,
      root: paths.root,
      safeRoot,
      value: { ...claimed.claim, status: claimStatus, blocker: String(receipt.blocker || ''), updatedAtUtc: new Date().toISOString() },
    });
  } catch (error) { projectionBlocker = error?.code || 'UPDATE_CLAIM_PROJECTION_FAILED'; }
  try {
    const currentActive = readStableJsonRecord({
      pathname: paths.activePath,
      safeRoot,
      invalidBlocker: 'UPDATE_ACTIVE_PROJECTION_INVALID',
      changedBlocker: 'UPDATE_ACTIVE_PROJECTION_CHANGED',
    }).value;
    if (currentActive?.receiptId !== claimed.receipt.receiptId
        || currentActive?.expectedHead !== claimed.receipt.expectedHead
        || currentActive?.claimantPid !== claimed.receipt.claimantPid) throw codedError('UPDATE_ACTIVE_PROJECTION_BINDING_INVALID');
    replaceOpenClawUpdateRecord({
      pathname: paths.activePath,
      root: paths.root,
      safeRoot,
      value: {
        schemaVersion: OPENCLAW_BATTLE_BRIDGE_DIRECT_CLAIM_SCHEMA,
        receiptId: claimed.receipt.receiptId,
        expectedHead: claimed.receipt.expectedHead,
        claimantPid: claimed.receipt.claimantPid,
        status: claimStatus,
        blocker: String(receipt.blocker || ''),
        updatedAtUtc: new Date().toISOString(),
      },
    });
  } catch (error) { projectionBlocker ||= error?.code || 'UPDATE_ACTIVE_PROJECTION_FAILED'; }
  if (projectionBlocker) {
    try {
      replaceOpenClawUpdateRecord({
        pathname: paths.receiptPath,
        root: paths.root,
        safeRoot,
        value: {
          ...receipt,
          status: 'FAILED',
          finalVerdict: 'UPDATE_CHECKPOINT_PROJECTION_FAILED',
          blocker: projectionBlocker,
          resultPersistenceProven: false,
          failedAtUtc: new Date().toISOString(),
        },
      });
    } catch { /* active nonterminal evidence still blocks every later retry */ }
    throw codedError(projectionBlocker);
  }
  return receipt;
}
