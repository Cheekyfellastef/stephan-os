import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createSharedWorkspaceHandoffRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const PROVIDER_NEUTRAL_DISPATCH_BATON_SCHEMA = 'stephanos.provider-neutral-dispatch-baton.v1';
export const PROVIDER_NEUTRAL_DISPATCH_BATON_BODY_SCHEMA = 'stephanos.provider-neutral-dispatch-baton-body.v1';

const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_ROUTE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_PROOF_REF = /^(?:proof|proofs|receipts|evidence\/receipts)\/[A-Za-z0-9][A-Za-z0-9._/@:#-]{0,239}$/;
const MAX_BATON_BYTES = 64 * 1024;

const ZERO_AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  publicationAllowed: false,
  reviewAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
  credentialAccessAllowed: false,
  spendingAllowed: false,
  leaseSeizureAllowed: false,
  duplicateDispatchAllowed: false,
  arbitraryCommandAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalTimestamp(value) {
  const raw = text(value);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && new Date(ms).toISOString() === raw ? raw : '';
}

function normalizeProofRefs(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
  const refs = value.map(text);
  if (refs.some((ref) => !SAFE_PROOF_REF.test(ref) || ref.includes('..'))) return null;
  if (new Set(refs).size !== refs.length) return null;
  return Object.freeze(refs);
}

function normalizeSelectedRoute(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const routeId = text(value.routeId);
  const adapterId = text(value.adapterId);
  const providerFamily = text(value.providerFamily).toUpperCase();
  const workerId = text(value.workerId);
  const capacityReceiptId = text(value.capacityReceiptId || value.routeId);
  const proofRefs = normalizeProofRefs(
    Array.isArray(value.proofRefs) && value.proofRefs.length > 0
      ? value.proofRefs
      : (text(value.proofRef) ? [value.proofRef] : []),
  );
  if (![routeId, adapterId, providerFamily, capacityReceiptId].every((item) => SAFE_ROUTE_VALUE.test(item))) return null;
  if (workerId && !SAFE_ROUTE_VALUE.test(workerId)) return null;
  if (!proofRefs) return null;
  return Object.freeze({
    routeId,
    adapterId,
    providerFamily,
    workerId,
    capacityReceiptId,
    proofRefs,
  });
}

function batonIdForJob(dispatchJobId) {
  const jobId = text(dispatchJobId);
  if (!SAFE_JOB_ID.test(jobId)) return '';
  return `provider-baton-${createHash('sha256').update(jobId).digest('hex').slice(0, 24)}`;
}

function validateBatonBody(body, expectedDispatchJobId = '') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'PROVIDER_NEUTRAL_BATON_BODY_INVALID';
  const allowed = new Set([
    'schemaVersion',
    'dispatchJobId',
    'requestId',
    'repository',
    'expectedHead',
    'selectedRoute',
    'providerExecutionStarted',
    'resultReadbackOperation',
    'authority',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return 'PROVIDER_NEUTRAL_BATON_BODY_FIELD_NOT_ALLOWED';
  if (body.schemaVersion !== PROVIDER_NEUTRAL_DISPATCH_BATON_BODY_SCHEMA) return 'PROVIDER_NEUTRAL_BATON_BODY_SCHEMA_INVALID';
  if (!SAFE_JOB_ID.test(text(body.dispatchJobId))) return 'PROVIDER_NEUTRAL_BATON_JOB_ID_INVALID';
  if (expectedDispatchJobId && text(body.dispatchJobId) !== expectedDispatchJobId) return 'PROVIDER_NEUTRAL_BATON_JOB_ID_MISMATCH';
  if (!SAFE_REQUEST_ID.test(text(body.requestId))) return 'PROVIDER_NEUTRAL_BATON_REQUEST_ID_INVALID';
  if (!REPOSITORY.test(text(body.repository))) return 'PROVIDER_NEUTRAL_BATON_REPOSITORY_INVALID';
  if (!SHA40.test(text(body.expectedHead).toLowerCase())) return 'PROVIDER_NEUTRAL_BATON_EXPECTED_HEAD_INVALID';
  if (!normalizeSelectedRoute(body.selectedRoute)) return 'PROVIDER_NEUTRAL_BATON_ROUTE_INVALID';
  if (body.providerExecutionStarted !== false || text(body.resultReadbackOperation) !== '') {
    return 'PROVIDER_NEUTRAL_BATON_EXECUTION_TRUTH_INVALID';
  }
  if (!body.authority || typeof body.authority !== 'object' || Array.isArray(body.authority)) {
    return 'PROVIDER_NEUTRAL_BATON_AUTHORITY_INVALID';
  }
  const authorityKeys = Object.keys(ZERO_AUTHORITY);
  if (Object.keys(body.authority).length !== authorityKeys.length
      || authorityKeys.some((key) => body.authority[key] !== false)) {
    return 'PROVIDER_NEUTRAL_BATON_AUTHORITY_INVALID';
  }
  return '';
}

export function createProviderNeutralDispatchBaton(input = {}) {
  const dispatchJobId = text(input.dispatchJobId);
  const requestId = text(input.requestId);
  const repository = text(input.repository);
  const expectedHead = text(input.expectedHead).toLowerCase();
  const timestampUtc = canonicalTimestamp(input.timestampUtc);
  const issueNumber = Number(input.issueNumber);
  const selectedRoute = normalizeSelectedRoute(input.selectedRoute);
  const proofRefs = normalizeProofRefs(
    Array.isArray(input.proofRefs) && input.proofRefs.length > 0
      ? input.proofRefs
      : (selectedRoute?.proofRefs || []),
  );
  const batonId = batonIdForJob(dispatchJobId);

  if (!batonId) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_JOB_ID_INVALID' });
  if (!SAFE_REQUEST_ID.test(requestId)) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_REQUEST_ID_INVALID' });
  if (!REPOSITORY.test(repository)) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_REPOSITORY_INVALID' });
  if (!SHA40.test(expectedHead)) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_EXPECTED_HEAD_INVALID' });
  if (!timestampUtc) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_TIMESTAMP_INVALID' });
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_ISSUE_INVALID' });
  }
  if (!selectedRoute || !proofRefs) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_ROUTE_INVALID' });

  const body = Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_DISPATCH_BATON_BODY_SCHEMA,
    dispatchJobId,
    requestId,
    repository,
    expectedHead,
    selectedRoute,
    providerExecutionStarted: false,
    resultReadbackOperation: '',
    authority: ZERO_AUTHORITY,
  });
  const record = createSharedWorkspaceHandoffRecord({
    handoffId: batonId,
    participantId: 'codex-dispatch',
    fromParticipantId: 'codex-dispatch',
    toParticipantId: 'provider-router',
    timestampUtc,
    correlationId: dispatchJobId,
    relatedIssue: `#${issueNumber}`,
    proofRefs,
    summary: `Provider-neutral dispatch baton for ${dispatchJobId}.`,
    body: JSON.stringify(body),
  });
  const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(timestampUtc) });
  const bodyBlocker = validateBatonBody(body, dispatchJobId);
  if (!validation.valid || bodyBlocker) {
    return Object.freeze({
      ok: false,
      blocker: bodyBlocker || validation.refusalReason || 'PROVIDER_NEUTRAL_BATON_RECORD_INVALID',
    });
  }
  return Object.freeze({
    ok: true,
    blocker: '',
    schemaVersion: PROVIDER_NEUTRAL_DISPATCH_BATON_SCHEMA,
    batonId,
    dispatchJobId,
    record: Object.freeze(record),
    body,
    proofRef: `outbox/${batonId}.json`,
    authority: ZERO_AUTHORITY,
    finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_READY',
  });
}

function existingBatonSemanticallyMatches(payload, built) {
  let record;
  let body;
  try {
    record = JSON.parse(payload);
    body = JSON.parse(record.body || '');
  } catch {
    return false;
  }
  const validation = validateSharedWorkspaceRecord(record, {
    nowMs: Date.parse(record.timestampUtc),
    staleAfterMs: Number.MAX_SAFE_INTEGER,
  });
  const bodyBlocker = validateBatonBody(body, built.dispatchJobId);
  return validation.valid
    && !bodyBlocker
    && record.handoffId === built.batonId
    && record.correlationId === built.dispatchJobId
    && record.fromParticipantId === 'codex-dispatch'
    && record.toParticipantId === 'provider-router'
    && JSON.stringify(record.proofRefs || []) === JSON.stringify(built.record.proofRefs || [])
    && JSON.stringify(body) === JSON.stringify(built.body);
}

async function readExistingBaton(path, expectedPayload = '') {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ exists: false, same: false, payload: '' });
    return Object.freeze({ exists: true, same: false, payload: '', blocker: 'PROVIDER_NEUTRAL_BATON_STAT_FAILED' });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_BATON_BYTES) {
    return Object.freeze({ exists: true, same: false, payload: '', blocker: 'PROVIDER_NEUTRAL_BATON_EXISTING_FILE_INVALID' });
  }
  try {
    const payload = await readFile(path, 'utf8');
    return Object.freeze({ exists: true, same: Boolean(expectedPayload) && payload === expectedPayload, payload });
  } catch {
    return Object.freeze({ exists: true, same: false, payload: '', blocker: 'PROVIDER_NEUTRAL_BATON_READ_FAILED' });
  }
}

export async function persistProviderNeutralDispatchBaton(root, input = {}, options = {}) {
  const built = createProviderNeutralDispatchBaton(input);
  if (!built.ok) return built;
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['outbox', `${built.batonId}.json`],
  });
  if (!resolved.ok) {
    return Object.freeze({ ...built, ok: false, blocker: resolved.reason, finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_BLOCKED' });
  }

  const payload = `${JSON.stringify(built.record, null, 2)}\n`;
  if (Buffer.byteLength(payload, 'utf8') > MAX_BATON_BYTES) {
    return Object.freeze({ ...built, ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_TOO_LARGE', finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_BLOCKED' });
  }
  await mkdir(dirname(resolved.path), { recursive: true });

  const existing = await readExistingBaton(resolved.path, payload);
  if (existing.exists) {
    const sameBaton = !existing.blocker && existingBatonSemanticallyMatches(existing.payload, built);
    return Object.freeze({
      ...built,
      ok: sameBaton,
      blocker: sameBaton ? '' : (existing.blocker || 'PROVIDER_NEUTRAL_BATON_CONFLICT'),
      path: resolved.path,
      alreadyPresent: sameBaton,
      finalVerdict: sameBaton
        ? 'PROVIDER_NEUTRAL_DISPATCH_BATON_ALREADY_PRESENT'
        : 'PROVIDER_NEUTRAL_DISPATCH_BATON_CONFLICT',
    });
  }

  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await link(tempPath, resolved.path);
    await unlink(tempPath);
    return Object.freeze({
      ...built,
      path: resolved.path,
      alreadyPresent: false,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_PERSISTED',
    });
  } catch (error) {
    try { await handle?.close(); } catch {}
    try { await unlink(tempPath); } catch {}
    if (error?.code === 'EEXIST') {
      const raced = await readExistingBaton(resolved.path, payload);
      const sameBaton = !raced.blocker && existingBatonSemanticallyMatches(raced.payload, built);
      return Object.freeze({
        ...built,
        ok: sameBaton,
        blocker: sameBaton ? '' : (raced.blocker || 'PROVIDER_NEUTRAL_BATON_CONFLICT'),
        path: resolved.path,
        alreadyPresent: sameBaton,
        finalVerdict: sameBaton
          ? 'PROVIDER_NEUTRAL_DISPATCH_BATON_ALREADY_PRESENT'
          : 'PROVIDER_NEUTRAL_DISPATCH_BATON_CONFLICT',
      });
    }
    return Object.freeze({
      ...built,
      ok: false,
      blocker: 'PROVIDER_NEUTRAL_BATON_PERSIST_FAILED',
      path: resolved.path,
      alreadyPresent: false,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_BLOCKED',
    });
  }
}

export async function readProviderNeutralDispatchBaton(root, dispatchJobId, options = {}) {
  const batonId = batonIdForJob(dispatchJobId);
  if (!batonId) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_JOB_ID_INVALID' });
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['outbox', `${batonId}.json`],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, blocker: resolved.reason, batonId });

  const existing = await readExistingBaton(resolved.path);
  if (!existing.exists) return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_NOT_FOUND', batonId });
  if (existing.blocker) return Object.freeze({ ok: false, blocker: existing.blocker, batonId });

  let record;
  let body;
  try {
    record = JSON.parse(existing.payload);
    body = JSON.parse(record.body || '');
  } catch {
    return Object.freeze({ ok: false, blocker: 'PROVIDER_NEUTRAL_BATON_JSON_INVALID', batonId });
  }
  const recordValidation = validateSharedWorkspaceRecord(record, {
    nowMs: Date.parse(record.timestampUtc),
    staleAfterMs: Number.MAX_SAFE_INTEGER,
  });
  const bodyBlocker = validateBatonBody(body, text(dispatchJobId));
  if (!recordValidation.valid || bodyBlocker
      || record.handoffId !== batonId
      || record.correlationId !== text(dispatchJobId)
      || record.fromParticipantId !== 'codex-dispatch'
      || record.toParticipantId !== 'provider-router') {
    return Object.freeze({
      ok: false,
      blocker: bodyBlocker || recordValidation.refusalReason || 'PROVIDER_NEUTRAL_BATON_BINDING_INVALID',
      batonId,
    });
  }
  return Object.freeze({
    ok: true,
    blocker: '',
    schemaVersion: PROVIDER_NEUTRAL_DISPATCH_BATON_SCHEMA,
    batonId,
    dispatchJobId: text(dispatchJobId),
    record: Object.freeze(record),
    body: Object.freeze(body),
    path: resolved.path,
    proofRef: `outbox/${batonId}.json`,
    authority: ZERO_AUTHORITY,
    finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_RECOVERED',
  });
}

export async function listProviderNeutralDispatchBatonCandidates(root, options = {}) {
  const maxResults = Number.isSafeInteger(options.maxResults)
    ? Math.max(1, Math.min(256, options.maxResults))
    : 64;
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['outbox'],
  });
  if (!resolved.ok) {
    return Object.freeze({
      ok: false,
      blocker: resolved.reason,
      candidates: Object.freeze([]),
      invalidCount: 0,
      truncated: false,
      automaticRedispatchAllowed: false,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_DISCOVERY_BLOCKED',
    });
  }

  let entries;
  try {
    entries = await readdir(resolved.path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({
        ok: true,
        blocker: '',
        candidates: Object.freeze([]),
        invalidCount: 0,
        truncated: false,
        automaticRedispatchAllowed: false,
        finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_DISCOVERY_EMPTY',
      });
    }
    return Object.freeze({
      ok: false,
      blocker: 'PROVIDER_NEUTRAL_BATON_DISCOVERY_READ_FAILED',
      candidates: Object.freeze([]),
      invalidCount: 0,
      truncated: false,
      automaticRedispatchAllowed: false,
      finalVerdict: 'PROVIDER_NEUTRAL_DISPATCH_BATON_DISCOVERY_BLOCKED',
    });
  }

  const names = entries
    .filter((entry) => entry.isFile() && /^provider-baton-[0-9a-f]{24}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const candidates = [];
  let invalidCount = 0;

  for (const name of names) {
    const batonId = name.slice(0, -5);
    const existing = await readExistingBaton(`${resolved.path}/${name}`);
    if (!existing.exists || existing.blocker) {
      invalidCount += 1;
      continue;
    }
    let record;
    let body;
    try {
      record = JSON.parse(existing.payload);
      body = JSON.parse(record.body || '');
    } catch {
      invalidCount += 1;
      continue;
    }
    const dispatchJobId = text(body?.dispatchJobId);
    const recordValidation = validateSharedWorkspaceRecord(record, {
      nowMs: Date.parse(record.timestampUtc),
      staleAfterMs: Number.MAX_SAFE_INTEGER,
    });
    const bodyBlocker = validateBatonBody(body, dispatchJobId);
    if (!recordValidation.valid || bodyBlocker
        || !dispatchJobId
        || batonIdForJob(dispatchJobId) !== batonId
        || record.handoffId !== batonId
        || record.correlationId !== dispatchJobId
        || record.fromParticipantId !== 'codex-dispatch'
        || record.toParticipantId !== 'provider-router') {
      invalidCount += 1;
      continue;
    }
    candidates.push(Object.freeze({
      batonId,
      dispatchJobId,
      requestId: body.requestId,
      repository: body.repository,
      expectedHead: body.expectedHead,
      selectedRoute: Object.freeze({ ...body.selectedRoute }),
      timestampUtc: record.timestampUtc,
      proofRef: `outbox/${name}`,
      providerExecutionStarted: false,
      automaticRedispatchAllowed: false,
      exactNextAction: 'Check the selected provider for a durable execution receipt before any redispatch or result readback.',
    }));
  }

  candidates.sort((left, right) => Date.parse(right.timestampUtc) - Date.parse(left.timestampUtc)
    || left.dispatchJobId.localeCompare(right.dispatchJobId));
  const truncated = candidates.length > maxResults;
  return Object.freeze({
    ok: true,
    blocker: '',
    candidates: Object.freeze(candidates.slice(0, maxResults)),
    invalidCount,
    truncated,
    automaticRedispatchAllowed: false,
    finalVerdict: candidates.length
      ? 'PROVIDER_NEUTRAL_DISPATCH_BATON_CANDIDATES_READY'
      : 'PROVIDER_NEUTRAL_DISPATCH_BATON_DISCOVERY_EMPTY',
  });
}