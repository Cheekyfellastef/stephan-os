import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { bindMailboxRotationOwnerControlCandidateV2 } from './canonicalMailboxRotationOwnerControlV2.mjs';

// Original Goal #2315: a bounded read/re-read adapter, not a second command
// carrier or native executor. GitHub consent and native custody remain distinct.
export const MAILBOX_ROTATION_OWNER_GITHUB_SCHEMA_V2 = 'stephanos.canonical-mailbox-owner-github-read.v2';
const REPO = 'Cheekyfellastef/stephan-os';
const REPO_ID = 1179385578;
const BASE = 'https://api.github.com/repos/' + REPO;
const AUTHORITY_PATH = 'shared/agents/canonicalMailboxAuthorityV1.mjs';
const SHA = /^[a-f0-9]{40}$/;
const MAX_JSON = 256 * 1024;
const MAX_SOURCE = 64 * 1024;
const MAX_READ_MS = 20000;
const MAX_EVIDENCE_AGE_MS = 120000;
const liveFetch = globalThis.fetch;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const noNativeAuthority = Object.freeze({
  nativeExecutionAuthorized: false, freezeCertified: false, protectedMergeAuthorized: false,
  sourceSyncAuthorized: false, epochAdoptionAuthorized: false, nativeProducerQualified: false,
  originalGuardHeld: false, nativeObservationAuthenticated: false, ordinaryReceiptDebtDrained: false,
});
function held(blocker) {
  return Object.freeze({ schemaVersion: MAILBOX_ROTATION_OWNER_GITHUB_SCHEMA_V2,
    ok: false, candidate: false, blocker, apiTransportAuthenticated: false,
    ownerConsentAuthenticated: false, ...noNativeAuthority });
}
const internalErrors = new WeakSet();
function requireValue(ok, code) {
  if (!ok) { const error = Error(code); internalErrors.add(error); throw error; }
}
function dataSnapshot(value, depth = 0, budget = { count: 0 }) {
  requireValue(++budget.count <= 192 && depth <= 8, 'OWNER_CONTROL_INPUT_INVALID');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  requireValue(value && typeof value === 'object' && !types.isProxy(value)
    && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'OWNER_CONTROL_INPUT_INVALID');
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    requireValue(typeof key === 'string' && key.length <= 128, 'OWNER_CONTROL_INPUT_INVALID');
    const d = Object.getOwnPropertyDescriptor(value, key);
    requireValue(d && Object.hasOwn(d, 'value') && d.enumerable, 'OWNER_CONTROL_INPUT_INVALID');
    out[key] = dataSnapshot(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}
function options(input, recheck = false) {
  const clean = dataSnapshot(input);
  const fields = recheck ? ['token', 'observation'] : ['commentId', 'token', 'observation'];
  requireValue(clean && typeof clean === 'object' && Object.keys(clean).length === fields.length
    && fields.every(k => Object.hasOwn(clean, k)), 'OWNER_CONTROL_INPUT_INVALID');
  requireValue(typeof clean.token === 'string' && clean.token.length > 0 && clean.token.length <= 4096
    && !/[\r\n\0]/.test(clean.token), 'OWNER_CONTROL_READ_CREDENTIAL_UNAVAILABLE');
  if (!recheck) requireValue(Number.isSafeInteger(clean.commentId) && clean.commentId > 0,
    'OWNER_CONTROL_COMMENT_ID_INVALID');
  return clean;
}
function approvedPath(path) {
  return ['/git/ref/heads/main', '/pulls/3268', '/issues/3149', '/issues/3258'].includes(path)
    || /^\/issues\/comments\/[1-9][0-9]{0,15}$/.test(path)
    || /^\/git\/commits\/[a-f0-9]{40}$/.test(path)
    || new RegExp('^/contents/' + AUTHORITY_PATH.replaceAll('.', '\\.') + '\\?ref=[a-f0-9]{40}$').test(path);
}
async function boundedGet(fetchImpl, path, token, signal, deadline) {
  requireValue(approvedPath(path), 'OWNER_CONTROL_NONCANONICAL_GET');
  const url = BASE + path;
  const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit',
    cache: 'no-store', signal, headers: { Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      'Cache-Control': 'no-cache', 'User-Agent': 'stephanos-mailbox-owner-control-v2' } });
  requireValue(response?.status === 200 && response.ok === true && response.redirected === false
    && response.url === url, 'OWNER_CONTROL_GITHUB_RESPONSE_INVALID');
  requireValue(/^application\/(?:json|vnd\.github\+json)(?:;|$)/i.test(response.headers.get('content-type') || ''),
    'OWNER_CONTROL_GITHUB_RESPONSE_INVALID');
  const size = response.headers.get('content-length');
  requireValue(size === null || (/^[0-9]{1,10}$/.test(size) && Number(size) <= MAX_JSON), 'OWNER_CONTROL_GITHUB_RESPONSE_TOO_LARGE');
  const contentEncoding = (response.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
  requireValue(['identity', 'gzip', 'br', 'deflate'].includes(contentEncoding),
    'OWNER_CONTROL_GITHUB_RESPONSE_INVALID');
  const reader = response.body?.getReader();
  requireValue(reader, 'OWNER_CONTROL_GITHUB_BODY_MISSING');
  const chunks = []; let total = 0;
  try {
    for (;;) {
      requireValue(Date.now() <= deadline && !signal.aborted, 'OWNER_CONTROL_GITHUB_READ_DEADLINE');
      const { done, value } = await reader.read();
      if (done) break;
      requireValue(value instanceof Uint8Array && chunks.length < 2048, 'OWNER_CONTROL_GITHUB_BODY_INVALID');
      total += value.byteLength;
      requireValue(total <= MAX_JSON, 'OWNER_CONTROL_GITHUB_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  // Node fetch decodes supported content encodings but retains the wire length.
  // The streamed limit above always bounds decoded bytes; only identity lengths
  // describe the same byte sequence and can be compared here.
  requireValue(size === null || contentEncoding !== 'identity' || Number(size) === total,
    'OWNER_CONTROL_GITHUB_BODY_INVALID');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, total));
  const result = JSON.parse(text);
  requireValue(result && typeof result === 'object' && !Array.isArray(result), 'OWNER_CONTROL_GITHUB_JSON_INVALID');
  return result;
}
function repoMatches(repo) {
  return repo?.id === REPO_ID && repo.full_name === REPO && repo.owner?.id === 267490109
    && repo.owner.login === 'Cheekyfellastef';
}
function validateMutable(main, pull, predecessor, successor, consent) {
  requireValue(main?.ref === 'refs/heads/main' && main.object?.type === 'commit'
    && SHA.test(main.object.sha) && main.object.sha === consent.source.protectedMainHead,
    'OWNER_CONTROL_MAIN_CHANGED');
  requireValue(pull?.number === 3268 && pull.html_url === 'https://github.com/' + REPO + '/pull/3268'
    && pull.state === 'open' && pull.merged === false && pull.draft === false
    && repoMatches(pull.head?.repo) && repoMatches(pull.base?.repo) && pull.base.ref === 'main'
    && pull.head.sha === consent.activation.headSha && pull.base.sha === consent.activation.baseSha,
    'OWNER_CONTROL_ACTIVATION_CHANGED');
  requireValue(predecessor?.number === 3149 && predecessor.url === BASE + '/issues/3149'
    && predecessor.state === 'open' && Number.isSafeInteger(predecessor.comments)
    && predecessor.comments === consent.barrier.commentCount, 'OWNER_CONTROL_PREDECESSOR_CHANGED');
  const marker = '<!-- stephanos:canonical-mailbox-successor:v1 predecessor=3149 successor=3258 state=INACTIVE -->';
  requireValue(successor?.number === 3258 && successor.url === BASE + '/issues/3258'
    && successor.state === 'open' && successor.user?.login === 'Cheekyfellastef'
    && successor.user.id === 267490109 && successor.comments === 0
    && typeof successor.body === 'string' && successor.body.startsWith('Status: INACTIVE')
    && successor.body.split(marker).length === 2
    && (successor.body.match(/<!-- stephanos:canonical-mailbox-successor:v1[^>]*-->/g) || []).length === 1,
    'OWNER_CONTROL_SUCCESSOR_NOT_INACTIVE');
}
function authoritySource(file, expectedHead) {
  requireValue(file?.path === AUTHORITY_PATH && file.type === 'file' && file.encoding === 'base64'
    && SHA.test(file.sha) && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= MAX_SOURCE
    && typeof file.content === 'string' && file.content.length <= 2 * MAX_SOURCE, 'OWNER_CONTROL_AUTHORITY_SOURCE_INVALID');
  const base64 = file.content.replaceAll('\n', '');
  const bytes = Buffer.from(base64, 'base64');
  requireValue(bytes.length === file.size && bytes.toString('base64') === base64
    && createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') === file.sha,
    'OWNER_CONTROL_AUTHORITY_BLOB_MISMATCH');
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const active = [...source.matchAll(/^export const CANONICAL_MAILBOX_ISSUE = ([1-9][0-9]*);$/gm)];
  const retired = [...source.matchAll(/^export const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze\(\[([0-9, ]*)\]\);$/gm)];
  requireValue(active.length === 1 && active[0][1] === '3149' && retired.length === 1,
    'OWNER_CONTROL_PREDECESSOR_EPOCH_CHANGED');
  const ids = retired[0][1].split(',').map(s => Number(s.trim()));
  requireValue(ids.length > 0 && ids.every(n => Number.isSafeInteger(n) && n > 0 && n < 3149)
    && new Set(ids).size === ids.length, 'OWNER_CONTROL_PREDECESSOR_EPOCH_CHANGED');
  requireValue(file.url === BASE + '/contents/' + AUTHORITY_PATH + '?ref=' + expectedHead,
    'OWNER_CONTROL_AUTHORITY_SOURCE_INVALID');
  return file.sha;
}
function failure(error) {
  const message = error?.message;
  return held(internalErrors.has(error) && typeof message === 'string' && /^OWNER_CONTROL_[A-Z0-9_]{1,100}$/.test(message)
    ? message : 'OWNER_CONTROL_GITHUB_READ_FAILED');
}
function makeReader(fetchImpl, production) {
  const observations = new WeakMap();
  const recognized = value => {
    const item = value && typeof value === 'object' ? observations.get(value) : null;
    return Boolean(item && Date.now() >= item.readAt && Date.now() - item.readAt <= MAX_EVIDENCE_AGE_MS
      && Date.now() < item.expiresAt);
  };
  async function read(input) {
    const stop = new AbortController();
    try {
      const { commentId, token, observation } = options(input);
      const start = Date.now(), deadline = start + MAX_READ_MS;
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(MAX_READ_MS)]);
      const get = path => boundedGet(fetchImpl, path, token, signal, deadline);
      const path = '/issues/comments/' + commentId;
      const comment = await get(path);
      requireValue(comment.id === commentId && comment.url === BASE + path, 'OWNER_CONTROL_COMMENT_ID_MISMATCH');
      const first = bindMailboxRotationOwnerControlCandidateV2(comment, observation);
      if (!first.ok) return held(first.blocker);
      const consent = first.consent;
      const [main, pull, predecessor, successor, mainCommit, headCommit, source] = await Promise.all([
        get('/git/ref/heads/main'), get('/pulls/3268'), get('/issues/3149'), get('/issues/3258'),
        get('/git/commits/' + consent.source.protectedMainHead), get('/git/commits/' + consent.activation.headSha),
        get('/contents/' + AUTHORITY_PATH + '?ref=' + consent.source.protectedMainHead),
      ]);
      validateMutable(main, pull, predecessor, successor, consent);
      requireValue(mainCommit.sha === consent.source.protectedMainHead
        && mainCommit.tree?.sha === consent.source.protectedMainTreeSha
        && headCommit.sha === consent.activation.headSha && headCommit.tree?.sha === consent.activation.treeSha,
        'OWNER_CONTROL_GIT_TREE_MISMATCH');
      const authorityBlob = authoritySource(source, consent.source.protectedMainHead);
      // These are independent GETs, not cached first-pass objects. A successful
      // first read cannot hide an edited/deleted consent or moving PR/main.
      const [again, finalMain, finalPull, finalPredecessor, finalSuccessor] = await Promise.all([
        get(path), get('/git/ref/heads/main'), get('/pulls/3268'), get('/issues/3149'), get('/issues/3258'),
      ]);
      requireValue(again.id === commentId && again.url === BASE + path, 'OWNER_CONTROL_COMMENT_ID_MISMATCH');
      const bound = bindMailboxRotationOwnerControlCandidateV2(again, observation);
      if (!bound.ok) return held(bound.blocker);
      requireValue(bound.requestId === first.requestId && again.body === comment.body
        && again.created_at === comment.created_at && again.updated_at === comment.updated_at,
        'OWNER_CONTROL_CONSENT_CHANGED_DURING_READ');
      validateMutable(finalMain, finalPull, finalPredecessor, finalSuccessor, consent);
      requireValue(successor.body === finalSuccessor.body, 'OWNER_CONTROL_SUCCESSOR_CHANGED_DURING_READ');
      const readAt = Date.now();
      requireValue(readAt >= start && readAt <= deadline && !signal.aborted, 'OWNER_CONTROL_GITHUB_READ_DEADLINE');
      const evidence = Object.freeze({ schemaVersion: MAILBOX_ROTATION_OWNER_GITHUB_SCHEMA_V2,
        ...bound, apiTransportAuthenticated: production, ownerConsentAuthenticated: production,
        githubReadVerified: production, testTransport: !production,
        readAtUtc: new Date(readAt).toISOString(), authorityBlobSha: authorityBlob,
        githubBindingSha256: hash(JSON.stringify([bound.requestId, consent.source.protectedMainHead,
          consent.source.protectedMainTreeSha, consent.activation.headSha, consent.activation.baseSha,
          consent.activation.treeSha, authorityBlob])), ...noNativeAuthority });
      observations.set(evidence, { commentId, requestId: evidence.requestId,
        binding: evidence.githubBindingSha256, readAt, expiresAt: Date.parse(consent.expiresAtUtc) });
      return evidence;
    } catch (error) { return failure(error); }
    finally { stop.abort(); }
  }
  async function recheck(evidence, input) {
    if (!recognized(evidence)) return held('OWNER_CONTROL_PRIOR_READ_NOT_AUTHENTICATED');
    const previous = observations.get(evidence);
    // Invalidate the previous observation before any awaited IO. Failure or
    // cancellation cannot leave an old successful read available for reuse.
    observations.delete(evidence);
    try {
      const { token, observation } = options(input, true);
      const fresh = await read({ commentId: previous.commentId, token, observation });
      if (!fresh.ok) return fresh;
      if (fresh.requestId !== previous.requestId || fresh.githubBindingSha256 !== previous.binding) {
        observations.delete(fresh);
        return held('OWNER_CONTROL_RECHECK_IDENTITY_CHANGED');
      }
      return fresh;
    } catch (error) { return failure(error); }
  }
  return Object.freeze({ read, recheck, recognized });
}
const live = makeReader(liveFetch, true);
export const readMailboxRotationOwnerControlGitHubV2 = live.read;
export const recheckMailboxRotationOwnerControlGitHubV2 = live.recheck;
export const isAuthenticatedMailboxRotationOwnerControlGitHubV2 = live.recognized;

// Fixture transports never mint observations recognized by the production
// reader, even in a test process. There is no production fetch/clock override.
export function createMailboxRotationOwnerControlGitHubTestReaderV2(fetchImpl) {
  if (!process.env.NODE_TEST_CONTEXT || typeof fetchImpl !== 'function') throw Error('TEST_TRANSPORT_NOT_ADMITTED');
  return makeReader(fetchImpl, false);
}
