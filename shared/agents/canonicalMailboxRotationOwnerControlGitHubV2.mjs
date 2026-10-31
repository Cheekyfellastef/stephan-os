import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { bindMailboxRotationOwnerControlCandidateV2 } from './canonicalMailboxRotationOwnerControlV2.mjs';
import { auditMailboxRotationComments, parseMailboxRotationComment, mailboxRotationDigest } from './canonicalMailboxRotationV1.mjs';
import { RETIRED_CANONICAL_MAILBOX_ISSUES } from './canonicalMailboxAuthorityV1.mjs';
import { LEGACY_PUBLICATION_CONTRACTS, mailboxActionsExecutionQuiescent,
  mailboxActionEvidenceSummary } from './canonicalMailboxRotationActionEvidenceV1.mjs';
import { inventoryMailboxRotationExecution, localMailboxPublicationRevocations } from '../../scripts/canonical-mailbox-action-evidence-v2.mjs';

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
const PUBLIC_READ_MS = 60000;
const PUBLIC_MAX_GETS = 384;
const PUBLIC_MAX_BYTES = 64 * 1024 * 1024;
const PUBLIC_MAX_COMMENTS = 2500;
const COMMENT_PAGE_SIZE = 25;
const RUN_PAGE_SIZE = 10;
const SOURCE_MODULES = ['shared/agents/mailboxReceiptIndexGitHubMirror.mjs',
  'shared/agents/codexBankedResetTelemetryMirror.mjs'];
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
function approvedPublicPath(path) {
  if (path === '/commits/main' || path === '/issues/3149') return true;
  let match = path.match(/^\/issues\/3149\/comments\?per_page=25&page=([1-9][0-9]{0,2})$/);
  if (match) return Number(match[1]) <= 101;
  match = path.match(/^\/actions\/runs\?status=(queued|in_progress|waiting|requested|pending)&per_page=10&page=([1-9][0-9]?)$/);
  if (match) return Number(match[2]) <= 11;
  if (/^\/actions\/runs\/[1-9][0-9]{0,15}(?:\/attempts\/[1-9][0-9]{0,15}\/jobs\?per_page=100)?$/.test(path)) return true;
  return SOURCE_MODULES.some(file => new RegExp('^/contents/' + file.replaceAll('.', '\\.') + '\\?ref=[a-f0-9]{40}$').test(path))
    || LEGACY_PUBLICATION_CONTRACTS.some(c => path === '/contents/' + c.path + '?ref=' + c.head);
}
async function boundedGet(fetchImpl, path, token, signal, deadline, publicBudget = null) {
  requireValue(publicBudget ? approvedPublicPath(path) : approvedPath(path), 'OWNER_CONTROL_NONCANONICAL_GET');
  if (publicBudget) requireValue(++publicBudget.gets <= PUBLIC_MAX_GETS, 'OWNER_CONTROL_PUBLIC_GET_BOUND');
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
      if (publicBudget) requireValue((publicBudget.bytes += value.byteLength) <= PUBLIC_MAX_BYTES,
        'OWNER_CONTROL_PUBLIC_BYTE_BOUND');
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
  const list = Boolean(publicBudget && path.startsWith('/issues/3149/comments?'));
  requireValue(result && typeof result === 'object' && Array.isArray(result) === list, 'OWNER_CONTROL_GITHUB_JSON_INVALID');
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

function immutableJson(value, depth = 0, budget = { nodes: 0 }) {
  requireValue(++budget.nodes <= 200000 && depth <= 32, 'OWNER_CONTROL_PUBLIC_RESPONSE_COMPLEX');
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutableJson(child, depth + 1, budget);
    Object.freeze(value);
  }
  return value;
}
const positive = value => Number.isSafeInteger(value) && value > 0;
const exactInstant = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const LOCAL_FALSE_FIELDS = ['fullDrainProofComplete', 'publicHistoryAuthenticated', 'actionsAuthenticated',
  'installedSourceAuthenticated', 'nativeProducerQualified', 'consentAuthenticated', 'nativeEvidenceAuthenticated',
  'nativeExecutionAuthorized', 'freezeCertified', 'protectedMergeAuthorized', 'sourceSyncAuthorized',
  'epochAdoptionAuthorized', 'effectReplayAllowed'];
const UNKNOWN_DRAIN_FIELDS = ['ordinaryReceiptDebtCount', 'historyPendingBeforeCount', 'historyPendingAfterCount',
  'orphanAcceptedCount', 'actionPendingAggregateCount', 'actionBlockingCount'];
const LOCAL_DIGEST_FIELDS = ['journalGenerationSha256', 'bindingSha256', 'stateSha256', 'guardGenerationSha256',
  'localInventorySha256', 'executionLedgerSha256', 'acceptedRequestIdsSha256', 'inlinePublicationInventorySha256',
  'outboxManifestSha256', 'outboxIndexInventorySha256', 'outboxSegmentInventorySha256'];
const LOCAL_COUNT_FIELDS = ['acceptedCount', 'inlinePublicationCount', 'segmentedPublicationCount',
  'distinctPublicationCount', 'executionLedgerCount', 'reservedCount', 'terminalCount', 'retiredCount',
  'currentRotationReservationCount'];
function localDrainCandidate(value, evidence, expectedGeneration, now = Date.now()) {
  const fields = ['schemaVersion', 'requestId', 'transitionId', 'sourceBinding', 'epochBinding', 'barrierBinding',
    'captureStartedAtUtc', 'observedAtUtc', 'outboxStoreId', 'counts', 'localCaptureComplete', 'storageOnly',
    ...LOCAL_DIGEST_FIELDS, ...UNKNOWN_DRAIN_FIELDS, ...LOCAL_FALSE_FIELDS];
  requireValue(value && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)),
    'OWNER_CONTROL_PUBLIC_LOCAL_CANDIDATE_INVALID');
  requireValue(value.schemaVersion === 'stephanos.canonical-mailbox-local-drain-inputs.v2'
    && value.requestId === evidence.requestId && value.transitionId === evidence.consent.transitionId
    && LOCAL_DIGEST_FIELDS.every(k => /^[a-f0-9]{64}$/.test(value[k]))
    && /^[a-f0-9]{64}$/.test(expectedGeneration) && value.journalGenerationSha256 === expectedGeneration
    && value.bindingSha256 === mailboxRotationDigest({ origin: evidence.origin, consent: evidence.consent })
    && ['source', 'epoch', 'barrier'].every(k => mailboxRotationDigest(value[k + 'Binding']) === mailboxRotationDigest(evidence.consent[k]))
    && /^[a-f0-9]{32}$/.test(value.outboxStoreId) && value.localCaptureComplete === true && value.storageOnly === true
    && LOCAL_FALSE_FIELDS.every(k => value[k] === false) && UNKNOWN_DRAIN_FIELDS.every(k => value[k] === null),
    'OWNER_CONTROL_PUBLIC_LOCAL_BINDING_UNPROVEN');
  requireValue(value.counts && Object.keys(value.counts).length === LOCAL_COUNT_FIELDS.length
    && LOCAL_COUNT_FIELDS.every(k => Number.isSafeInteger(value.counts[k]) && value.counts[k] >= 0 && value.counts[k] <= 1000000)
    && value.counts.currentRotationReservationCount === 1 && value.counts.reservedCount >= 1
    && value.counts.executionLedgerCount === value.counts.reservedCount + value.counts.terminalCount + value.counts.retiredCount,
    'OWNER_CONTROL_PUBLIC_LOCAL_COUNTS_INVALID');
  requireValue(exactInstant(value.captureStartedAtUtc) && exactInstant(value.observedAtUtc)
    && Date.parse(value.captureStartedAtUtc) <= Date.parse(value.observedAtUtc)
    && Date.parse(value.observedAtUtc) <= now && now - Date.parse(value.captureStartedAtUtc) <= MAX_EVIDENCE_AGE_MS,
    'OWNER_CONTROL_PUBLIC_LOCAL_CAPTURE_STALE');
  return value;
}
function publicOptions(input) {
  const clean = dataSnapshot(input), fields = ['token', 'observation', 'drainInputCandidate', 'expectedGenerationSha256'];
  requireValue(clean && Object.keys(clean).length === fields.length && fields.every(k => Object.hasOwn(clean, k))
    && Buffer.byteLength(JSON.stringify(clean), 'utf8') <= 64 * 1024, 'OWNER_CONTROL_PUBLIC_INPUT_INVALID');
  options({ token: clean.token, observation: clean.observation }, true);
  return clean;
}
function predecessorMetadata(issue, consent) {
  requireValue(issue?.number === 3149 && issue.url === BASE + '/issues/3149' && issue.state === 'open'
    && Number.isSafeInteger(issue.comments) && issue.comments >= 0 && issue.comments <= PUBLIC_MAX_COMMENTS
    && issue.comments === consent.barrier.commentCount, 'OWNER_CONTROL_PUBLIC_HISTORY_COUNT_CHANGED');
}
function commentIdentity(comment, previousId) {
  requireValue(positive(comment?.id) && comment.id > previousId
    && comment.url === BASE + '/issues/comments/' + comment.id
    && comment.issue_url === BASE + '/issues/3149'
    && comment.html_url === 'https://github.com/' + REPO + '/issues/3149#issuecomment-' + comment.id
    && typeof comment.body === 'string' && Buffer.byteLength(comment.body, 'utf8') <= 64000
    && positive(comment.user?.id) && typeof comment.user.login === 'string' && comment.user.login.length <= 100
    && ['User', 'Bot'].includes(comment.user.type) && typeof comment.author_association === 'string'
    && Number.isFinite(Date.parse(comment.created_at)) && Number.isFinite(Date.parse(comment.updated_at))
    && Date.parse(comment.created_at) <= Date.parse(comment.updated_at) && Date.parse(comment.updated_at) <= Date.now(),
    'OWNER_CONTROL_PUBLIC_COMMENT_IDENTITY_INVALID');
  if (comment.user.login === 'Cheekyfellastef') requireValue(comment.user.id === 267490109
    && comment.user.type === 'User', 'OWNER_CONTROL_PUBLIC_COMMENT_OWNER_MISMATCH');
  return { id: comment.id, bodySha256: hash(comment.body), user: { id: comment.user.id, login: comment.user.login, type: comment.user.type },
    createdAt: comment.created_at, updatedAt: comment.updated_at, authorAssociation: comment.author_association,
    url: comment.url, issueUrl: comment.issue_url, htmlUrl: comment.html_url };
}
function publicProtocolDisposition(comment) {
  if (comment.user.login !== 'Cheekyfellastef') return 'IRRELEVANT';
  const commands = [...comment.body.matchAll(/```stephanos-battle-bridge-command\s*([\s\S]*?)```/gi)];
  const commandTag = /```stephanos-battle-bridge-command\b/i.test(comment.body);
  const receipts = comment.body.split('<!-- stephanos-battle-bridge-command-receipt -->').length - 1;
  if (!commandTag && !receipts) return 'IRRELEVANT';
  if (commandTag && !commands.length) return 'UNCLASSIFIED';
  const blocks = commands.length ? commands : [...comment.body.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (blocks.length !== 1 || commands.length > 1 || receipts > 1 || (commands.length && receipts)) return 'UNCLASSIFIED';
  if (parseMailboxRotationComment(comment, 3149)) return 'CANONICAL';
  // This is only conservative triage of rows the canonical auditor excluded,
  // never another command/receipt parser or an execution/debt adjudicator.
  try {
    const value = JSON.parse(blocks[0][1]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'UNCLASSIFIED';
    const schemas = ['stephanos.battle-bridge-github-command.v1', 'stephanos.battle-bridge-github-command-receipt.v1'];
    if (!schemas.includes(value.schemaVersion)) return 'NONCANONICAL_SCHEMA';
    if (value.repository === REPO && RETIRED_CANONICAL_MAILBOX_ISSUES.includes(value.issueNumber)) return 'RETIRED_EPOCH';
  } catch { /* An unparseable owner-tagged target cannot become an empty audit. */ }
  return 'UNCLASSIFIED';
}
async function completePublicHistory(get, consent) {
  const count = consent.barrier.commentCount, pages = Math.floor(count / COMMENT_PAGE_SIZE) + 1;
  requireValue(Number.isSafeInteger(count) && count >= 0 && count <= PUBLIC_MAX_COMMENTS && pages <= 101,
    'OWNER_CONTROL_PUBLIC_HISTORY_BOUND');
  const comments = [], identities = [];
  for (let first = 1; first <= pages; first += 4) {
    const selected = Array.from({ length: Math.min(4, pages - first + 1) }, (_, i) => first + i);
    const batches = await Promise.all(selected.map(page => get('/issues/3149/comments?per_page=25&page=' + page)));
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i], expected = selected[i] === pages ? count % COMMENT_PAGE_SIZE : COMMENT_PAGE_SIZE;
      requireValue(Array.isArray(batch) && batch.length === expected, 'OWNER_CONTROL_PUBLIC_HISTORY_INCOMPLETE');
      for (const comment of batch) {
        identities.push(commentIdentity(comment, identities.at(-1)?.id || 0)); comments.push(comment);
      }
    }
  }
  requireValue(comments.length === count, 'OWNER_CONTROL_PUBLIC_HISTORY_INCOMPLETE');
  const inventory = auditMailboxRotationComments(comments, { issueNumber: 3149,
    barrierCommentId: consent.barrier.highestCommandCommentId || Number.MAX_SAFE_INTEGER });
  requireValue(inventory.highestCommandCommentId === consent.barrier.highestCommandCommentId
    && inventory.inventoryDigest === consent.barrier.inventorySha256, 'OWNER_CONTROL_PUBLIC_BARRIER_CHANGED');
  const commandIds = new Set(comments.map(comment => parseMailboxRotationComment(comment, 3149))
    .filter(row => row?.type === 'command').map(row => row.value.requestId));
  // The canonical auditor owns envelope classification. An unparsed owner-tagged
  // envelope stays visible as unclassified public input; it cannot become zero
  // ordinary debt through this observational adapter.
  const dispositions = comments.map(publicProtocolDisposition);
  return immutableJson({ commentCount: count, completeHistorySha256: mailboxRotationDigest(identities), inventory,
    unclassifiedProtocolCommentCount: dispositions.filter(x => x === 'UNCLASSIFIED').length,
    noncanonicalSchemaCommentCount: dispositions.filter(x => x === 'NONCANONICAL_SCHEMA').length,
    retiredEpochCommentCount: dispositions.filter(x => x === 'RETIRED_EPOCH').length,
    orphanAcceptedCount: inventory.acceptedIds.filter(id => !commandIds.has(id)).length });
}
async function completeActionRuns(get, status) {
  async function capture() {
    const first = await get('/actions/runs?status=' + status + '&per_page=10&page=1');
    requireValue(Number.isSafeInteger(first?.total_count) && first.total_count >= 0 && first.total_count <= 100,
      'OWNER_CONTROL_PUBLIC_ACTIONS_INCOMPLETE');
    const count = first.total_count, pages = Math.floor(count / RUN_PAGE_SIZE) + 1, runs = [], seen = new Set();
    for (let page = 1; page <= pages; page++) {
      const value = page === 1 ? first : await get('/actions/runs?status=' + status + '&per_page=10&page=' + page);
      requireValue(value?.total_count === count && Array.isArray(value.workflow_runs)
        && value.workflow_runs.length === (page === pages ? count % RUN_PAGE_SIZE : RUN_PAGE_SIZE),
        'OWNER_CONTROL_PUBLIC_ACTIONS_INCOMPLETE');
      for (const run of value.workflow_runs) {
        requireValue(positive(run?.id) && !seen.has(run.id) && run.status === status,
          'OWNER_CONTROL_PUBLIC_ACTIONS_INVENTORY_CHANGED');
        seen.add(run.id); runs.push(run);
      }
    }
    return immutableJson({ total_count: count, workflow_runs: runs });
  }
  const before = await capture(), after = await capture();
  requireValue(mailboxRotationDigest(before) === mailboxRotationDigest(after), 'OWNER_CONTROL_PUBLIC_ACTIONS_INVENTORY_CHANGED');
  return before;
}
async function collectPublicActions(get, mainHead, activationHead, deadline) {
  // Adapt the existing SYNCHRONOUS assessor through a strict occurrence-ordered
  // transcript. A later read of the same URL is a new GET, never a URL cache.
  // No await enters the original guard, and no caller supplies this transcript.
  const transcript = [], clocks = [], nextRead = new WeakMap();
  const local = immutableJson(localMailboxPublicationRevocations()), localDigest = mailboxRotationDigest(local);
  for (let pass = 0; pass <= PUBLIC_MAX_GETS; pass++) {
    let cursor = 0, clock = 0;
    try {
      const result = inventoryMailboxRotationExecution({ activationHead, local: () => local,
        now: () => { if (clock === clocks.length) clocks.push(new Date().toISOString()); return clocks[clock++]; },
        read: path => {
          requireValue(Date.now() <= deadline, 'OWNER_CONTROL_PUBLIC_READ_DEADLINE');
          const row = transcript[cursor++];
          if (row) { requireValue(row.path === path, 'OWNER_CONTROL_PUBLIC_TRANSCRIPT_DIVERGED'); return row.value; }
          const request = Error('next fixed read'); nextRead.set(request, path); throw request;
        } });
      requireValue(cursor === transcript.length && clock === clocks.length, 'OWNER_CONTROL_PUBLIC_TRANSCRIPT_DIVERGED');
      requireValue(mailboxRotationDigest(localMailboxPublicationRevocations()) === localDigest,
        'OWNER_CONTROL_PUBLIC_LOCAL_SOURCE_CHANGED');
      return immutableJson(result);
    } catch (error) {
      if (!nextRead.has(error)) {
        if (internalErrors.has(error)) throw error;
        requireValue(false, 'OWNER_CONTROL_PUBLIC_ACTIONS_UNPROVEN');
      }
      requireValue(transcript.length < PUBLIC_MAX_GETS, 'OWNER_CONTROL_PUBLIC_TRANSCRIPT_BOUND');
      const path = nextRead.get(error), list = path.match(/^actions\/runs\?status=(queued|in_progress|waiting|requested|pending)&per_page=100$/);
      const value = list ? await completeActionRuns(get, list[1]) : await get('/' + path);
      if (path === 'commits/main') requireValue(value?.sha === mainHead, 'OWNER_CONTROL_PUBLIC_MAIN_CHANGED');
      transcript.push(Object.freeze({ path, value: immutableJson(value) }));
    }
  }
  requireValue(false, 'OWNER_CONTROL_PUBLIC_TRANSCRIPT_BOUND');
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
  async function readPublicDrainInputs(evidence, input) {
    if (!recognized(evidence)) return held('OWNER_CONTROL_PRIOR_READ_NOT_AUTHENTICATED');
    let current = evidence;
    const stop = new AbortController();
    try {
      const clean = publicOptions(input);
      const local = localDrainCandidate(clean.drainInputCandidate, evidence, clean.expectedGenerationSha256);
      // recheck invalidates the original observation before its first await.
      // This method never acquires, retains, releases or substitutes a native guard.
      current = await recheck(current, { token: clean.token, observation: clean.observation });
      if (!current.ok) return current;
      const start = Date.now(), deadline = start + PUBLIC_READ_MS, budget = { gets: 0, bytes: 0 };
      const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(PUBLIC_READ_MS)]);
      const get = async path => {
        requireValue(Date.now() <= deadline && !signal.aborted, 'OWNER_CONTROL_PUBLIC_READ_DEADLINE');
        return boundedGet(fetchImpl, path, clean.token, signal, deadline, budget);
      };
      const consent = current.consent;
      predecessorMetadata(await get('/issues/3149'), consent);
      const before = await completePublicHistory(get, consent);
      const actions = await collectPublicActions(get, consent.source.protectedMainHead, consent.activation.headSha, deadline);
      const after = await completePublicHistory(get, consent);
      predecessorMetadata(await get('/issues/3149'), consent);
      requireValue(before.completeHistorySha256 === after.completeHistorySha256
        && mailboxRotationDigest(before) === mailboxRotationDigest(after), 'OWNER_CONTROL_PUBLIC_HISTORY_CHANGED');
      requireValue(Date.now() <= deadline && !signal.aborted, 'OWNER_CONTROL_PUBLIC_READ_DEADLINE');
      current = await recheck(current, { token: clean.token, observation: clean.observation });
      if (!current.ok) return current;
      const finished = Date.now(), now = new Date(finished).toISOString();
      localDrainCandidate(local, current, clean.expectedGenerationSha256, finished);
      requireValue(finished >= start && finished - start <= MAX_EVIDENCE_AGE_MS
        && exactInstant(actions.observedAt) && Date.parse(actions.observedAt) <= finished
        && finished - Date.parse(actions.observedAt) <= MAX_EVIDENCE_AGE_MS
        && actions.executionEvidence.proofs.every(p => exactInstant(p.observedAt)
          && Date.parse(p.observedAt) <= finished && finished - Date.parse(p.observedAt) <= MAX_EVIDENCE_AGE_MS),
        'OWNER_CONTROL_PUBLIC_ACTIONS_STALE');
      // The summary alone is deliberately NOT a freshness/source proof. Bind
      // the canonical predicate to actual completion time and both exact heads.
      const quiet = mailboxActionsExecutionQuiescent(actions, { now,
        mainHead: consent.source.protectedMainHead, activationHead: consent.activation.headSha });
      const summary = mailboxActionEvidenceSummary(actions);
      requireValue(quiet || summary.actionBlockingCount > 0, 'OWNER_CONTROL_PUBLIC_ACTIONS_CONTEXT_UNPROVEN');
      const classified = after.unclassifiedProtocolCommentCount === 0;
      const publicEvidence = immutableJson({ readStartedAtUtc: new Date(start).toISOString(), readCompletedAtUtc: now,
        completeHistorySha256: after.completeHistorySha256, canonicalInventorySha256: after.inventory.inventoryDigest,
        commentCount: after.commentCount, commandCount: after.inventory.commandCount,
        terminalRequestCount: after.inventory.terminalIds.length, unresolvedAcceptedCount: after.inventory.acceptedIds.length,
        unclassifiedProtocolCommentCount: after.unclassifiedProtocolCommentCount,
        noncanonicalSchemaCommentCount: after.noncanonicalSchemaCommentCount, retiredEpochCommentCount: after.retiredEpochCommentCount,
        actionsInventorySha256: actions.inventoryDigest, actionsEvidenceSha256: actions.evidenceDigest,
        actionsObservedAtUtc: actions.observedAt, actionsExecutionQuiescent: quiet, ...summary,
        pendingRuns: actions.pendingRuns, aggregateDispositions: actions.aggregateDispositions,
        githubGetCount: budget.gets, decodedResponseBytes: budget.bytes });
      const candidate = immutableJson({ ...local,
        historyPendingBeforeCount: classified ? after.inventory.pendingBeforeBarrier.length : null,
        historyPendingAfterCount: classified ? after.inventory.pendingAfterBarrier.length : null,
        orphanAcceptedCount: classified ? after.orphanAcceptedCount : null,
        actionPendingAggregateCount: summary.actionPendingAggregateCount, actionBlockingCount: summary.actionBlockingCount,
        publicEvidence, publicHistoryAuthenticated: production, actionsAuthenticated: production,
        publicHistoryClassificationComplete: classified, ordinaryReceiptDebtCount: null,
        localCaptureAuthenticated: false, localCaptureRecheckRequired: true,
        installedSourceAuthenticated: false, fullDrainProofComplete: false, ...noNativeAuthority });
      const result = { schemaVersion: MAILBOX_ROTATION_OWNER_GITHUB_SCHEMA_V2, ok: true, candidate: true,
        blocker: !classified ? 'OWNER_CONTROL_PUBLIC_PROTOCOL_UNCLASSIFIED'
          : !quiet ? 'OWNER_CONTROL_PUBLIC_ACTIONS_PENDING' : 'ORIGINAL_GUARDED_DRAIN_RECHECK_REQUIRED',
        ownerControlObservation: current, drainInputCandidate: candidate,
        apiTransportAuthenticated: production, testTransport: !production, ...noNativeAuthority };
      requireValue(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 64 * 1024, 'OWNER_CONTROL_PUBLIC_RESULT_BOUND');
      return immutableJson(result);
    } catch (error) { observations.delete(current); return failure(error); }
    finally { stop.abort(); }
  }
  return Object.freeze({ read, recheck, recognized, readPublicDrainInputs });
}
const live = makeReader(liveFetch, true);
export const readMailboxRotationOwnerControlGitHubV2 = live.read;
export const recheckMailboxRotationOwnerControlGitHubV2 = live.recheck;
export const isAuthenticatedMailboxRotationOwnerControlGitHubV2 = live.recognized;
export const readMailboxRotationPublicDrainInputsV2 = live.readPublicDrainInputs;

// Fixture transports never mint observations recognized by the production
// reader, even in a test process. There is no production fetch/clock override.
export function createMailboxRotationOwnerControlGitHubTestReaderV2(fetchImpl) {
  if (!process.env.NODE_TEST_CONTEXT || typeof fetchImpl !== 'function') throw Error('TEST_TRANSPORT_NOT_ADMITTED');
  return makeReader(fetchImpl, false);
}
