import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { atomicWriteJson, readJsonObject, resolveMailboxOutboxGuardLockPath,
  withMailboxOutboxGuardLock } from './battle-bridge-github-command-mailbox-outbox-guard-v1.mjs';
import { decodeMailboxNativeEvidenceV2, decodeMailboxRotationOwnerControlV2,
  encodeMailboxRotationOwnerControlV2 } from '../shared/agents/canonicalMailboxNativeEvidenceCodecV2.mjs';
import { formatMailboxRotationOwnerControlV2 } from '../shared/agents/canonicalMailboxRotationOwnerControlV2.mjs';
import { mailboxRotationDigest, validateMailboxRotationRecord } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { classifySaturatedMailboxRotationPhaseV2 } from '../shared/agents/canonicalMailboxSaturatedPhaseModelV2.mjs';

// Internal persistence for the ORIGINAL serialized owner. There is no CLI,
// registry verb, network client, signer, enrollment or effect callback here.
// Inputs are storage candidates, not authenticated consent or native evidence.
// The owner must independently admit every operation before calling this unit.
export const MAILBOX_ROTATION_TRANSACTION_SCHEMA_V2 = 'stephanos.canonical-mailbox-rotation-transaction.v2';
export const MAILBOX_ROTATION_STATE_SCHEMA_V2 = 'stephanos.canonical-mailbox-rotation-state.v2';
export const MAILBOX_ROTATION_EVIDENCE_MARKER_V2 = '<!-- stephanos-canonical-mailbox-native-evidence:v2 -->';
const FIELD = 'mailboxRotationControlTransactionV2';
const REPO = 'Cheekyfellastef/stephan-os';
const HEX = /^[a-f0-9]{64}$/;
const STAGES = ['PREPARED', 'RESERVED', 'EFFECT_INTENT', 'EFFECT_APPLIED', 'TERMINAL_STORED', 'PUBLISHED'];
const MAX_STATE = 32 * 1024 * 1024;
const MAX_ARTIFACT = 64 * 1024;
const noAuthority = Object.freeze({ consentAuthenticated: false, nativeEvidenceAuthenticated: false,
  nativeExecutionAuthorized: false, freezeCertified: false, protectedMergeAuthorized: false,
  sourceSyncAuthorized: false, epochAdoptionAuthorized: false, effectReplayAllowed: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Error('MAILBOX_ROTATION_TRANSACTION_' + code); };
const check = (ok, code) => { if (!ok) fail(code); };
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
function snapshot(value, depth = 0, budget = { nodes: 0 }) {
  check(++budget.nodes <= 2048 && depth <= 12, 'INPUT_TOO_COMPLEX');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') { check(Number.isSafeInteger(value) && !Object.is(value, -0), 'INPUT_INVALID'); return value; }
  check(value && typeof value === 'object' && !types.isProxy(value), 'INPUT_INVALID');
  const array = Array.isArray(value);
  check(array ? Object.getPrototypeOf(value) === Array.prototype
    : [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INPUT_INVALID');
  const out = array ? [] : Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(typeof key === 'string' && descriptor && Object.hasOwn(descriptor, 'value')
      && descriptor.enumerable && (!array || /^(?:0|[1-9][0-9]*)$/.test(key)), 'INPUT_INVALID');
    out[key] = snapshot(descriptor.value, depth + 1, budget);
  }
  if (array) check(out.length === value.length && Object.keys(out).length === value.length, 'INPUT_INVALID');
  return out;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const digest = value => hash(JSON.stringify(canonical(value)));
const equal = (a, b) => digest(a) === digest(b);
function closed(value, fields, code = 'RECORD_INVALID') {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)), code);
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}
function descriptor(input) {
  const clean = snapshot(input);
  closed(clean, ['origin', 'consent'], 'INPUT_INVALID');
  const consent = decodeMailboxRotationOwnerControlV2(encodeMailboxRotationOwnerControlV2(clean.consent));
  const origin = clean.origin;
  closed(origin, ['kind', 'prNumber', 'commentId', 'commentBodySha256', 'createdAtUtc'], 'ORIGIN_INVALID');
  check(origin.kind === 'ACTIVATION_PR_OWNER_CONTROL_V2' && origin.prNumber === 3268
    && consent.activation.prNumber === 3268 && consent.repository === REPO
    && consent.epoch.predecessorIssue === 3149 && consent.epoch.successorIssue === 3258
    && Number.isSafeInteger(origin.commentId) && origin.commentId > 0 && instant(origin.createdAtUtc)
    && origin.commentBodySha256 === hash(formatMailboxRotationOwnerControlV2(consent)), 'ORIGIN_INVALID');
  const elapsed = Date.parse(consent.expiresAtUtc) - Date.parse(origin.createdAtUtc);
  check(elapsed > 0 && elapsed <= 15 * 60 * 1000, 'CONSENT_LIFETIME_INVALID');
  const requestId = 'rotation-v2-' + hash([REPO, origin.prNumber, origin.commentId,
    origin.commentBodySha256, consent.transitionId, consent.rotationAction].join('\0'));
  return { origin, consent, requestId, bindingSha256: digest({ origin, consent }) };
}
function fresh(value) {
  const now = Date.now();
  check(Date.parse(value.origin.createdAtUtc) <= now && Date.parse(value.consent.expiresAtUtc) > now,
    'FRESH_OWNER_ADMISSION_REQUIRED');
}
const JOURNAL_KEYS = ['schemaVersion', 'requestId', 'bindingSha256', 'origin', 'consent', 'stage',
  'revision', 'generationSha256', 'preparedAtUtc', 'updatedAtUtc', 'initialRotationSha256',
  'effectRotationSha256', 'appliedGenerationSha256', 'artifactIntent', 'terminalSha256', 'proofBundleSha256',
  'envelopeIntentSha256', 'envelopeIntentBytes', 'envelopeSha256', 'publication'];
function generation(value) { const { generationSha256, ...rest } = value; return digest(rest); }
function journalRecord(value) {
  closed(value, JOURNAL_KEYS);
  check(value.schemaVersion === MAILBOX_ROTATION_TRANSACTION_SCHEMA_V2 && STAGES.includes(value.stage)
    && Number.isSafeInteger(value.revision) && value.revision >= 0 && instant(value.preparedAtUtc)
    && instant(value.updatedAtUtc) && Date.parse(value.updatedAtUtc) >= Date.parse(value.preparedAtUtc)
    && HEX.test(value.initialRotationSha256), 'RECORD_INVALID');
  const identity = descriptor({ origin: value.origin, consent: value.consent });
  check(identity.requestId === value.requestId && identity.bindingSha256 === value.bindingSha256
    && generation(value) === value.generationSha256, 'IDENTITY_CHANGED');
  for (const key of ['effectRotationSha256', 'appliedGenerationSha256', 'terminalSha256', 'proofBundleSha256', 'envelopeIntentSha256', 'envelopeSha256'])
    check(value[key] === '' || HEX.test(value[key]), 'RECORD_INVALID');
  const stage = STAGES.indexOf(value.stage);
  check(stage >= 3 ? HEX.test(value.effectRotationSha256) && HEX.test(value.appliedGenerationSha256)
    : value.effectRotationSha256 === '' && value.appliedGenerationSha256 === '', 'RECORD_INVALID');
  check(stage >= 4 ? HEX.test(value.terminalSha256) && HEX.test(value.proofBundleSha256)
    : value.terminalSha256 === '' && value.proofBundleSha256 === '' && value.envelopeIntentSha256 === '' && value.envelopeSha256 === '', 'RECORD_INVALID');
  if (value.artifactIntent !== null) {
    closed(value.artifactIntent, ['terminalSha256', 'proofBundleSha256', 'terminalBytes', 'proofBundleBytes']);
    check(stage >= 3 && HEX.test(value.artifactIntent.terminalSha256) && HEX.test(value.artifactIntent.proofBundleSha256), 'RECORD_INVALID');
    for (const key of ['terminalBytes', 'proofBundleBytes']) check(Number.isSafeInteger(value.artifactIntent[key])
      && value.artifactIntent[key] > 0 && value.artifactIntent[key] <= MAX_ARTIFACT, 'RECORD_INVALID');
  }
  if (stage >= 4) check(value.artifactIntent?.terminalSha256 === value.terminalSha256
    && value.artifactIntent?.proofBundleSha256 === value.proofBundleSha256, 'RECORD_INVALID');
  check(Number.isSafeInteger(value.envelopeIntentBytes) && (value.envelopeIntentSha256
    ? stage >= 4 && value.envelopeIntentBytes > 0 && value.envelopeIntentBytes <= MAX_ARTIFACT
    : value.envelopeIntentBytes === 0), 'RECORD_INVALID');
  if (value.envelopeSha256) check(value.envelopeSha256 === value.envelopeIntentSha256, 'RECORD_INVALID');
  check(stage === 5 ? Boolean(value.publication) && HEX.test(value.envelopeSha256) : value.publication === null, 'RECORD_INVALID');
  if (value.publication) {
    closed(value.publication, ['goalIssue', 'commentId', 'bodySha256', 'createdAtUtc']);
    check(value.publication.goalIssue === 2315 && Number.isSafeInteger(value.publication.commentId)
      && value.publication.commentId > 0 && HEX.test(value.publication.bodySha256)
      && instant(value.publication.createdAtUtc), 'RECORD_INVALID');
  }
  return value;
}
function reservation(journal) {
  return { schemaVersion: MAILBOX_ROTATION_TRANSACTION_SCHEMA_V2, requestId: journal.requestId,
    issueNumber: journal.consent.epoch.predecessorIssue, bindingSha256: journal.bindingSha256 };
}
function nativeActivation(consent) {
  // The owner-control schema includes mergeTreeSha; the existing V2 native
  // envelope binds the five activation fields in its own closed wire schema.
  const { mergeTreeSha, ...activation } = consent.activation;
  return activation;
}
function ledgerMatches(record, journal) {
  return record?.requestId === journal.requestId && record.issueNumber === journal.consent.epoch.predecessorIssue
    && record.commandDigest === mailboxRotationDigest(reservation(journal));
}
function checkDirectory(path, create = false) {
  const absolute = resolve(path), base = parse(absolute).root;
  let current = base;
  for (const component of absolute.slice(base.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, component);
    if (create && !existsSync(current)) mkdirSync(current);
    const stat = lstatSync(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'ARTIFACT_DIRECTORY_UNSAFE');
  }
  return lstatSync(absolute);
}
const sameDirectory = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) => sameDirectory(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs
  && a.ctimeMs === b.ctimeMs && a.nlink === 1 && b.nlink === 1;
function syncDirectory(path) {
  let fd;
  try { fd = openSync(path, 'r'); fsyncSync(fd); }
  catch (error) { if (!['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR', 'EBADF', 'UNKNOWN'].includes(error.code)) throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function artifactLocation(root, kind, sha) {
  check(['terminal', 'proof-bundle', 'signed-envelope'].includes(kind) && HEX.test(sha), 'ARTIFACT_ID_INVALID');
  return join(root, 'rotation-evidence-v2', kind, sha.slice(0, 2), sha + '.json');
}
function readArtifact(root, kind, sha) {
  const path = artifactLocation(root, kind, sha), parent = checkDirectory(dirname(path));
  const before = lstatSync(path);
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1
    && before.size > 0 && before.size <= MAX_ARTIFACT, 'ARTIFACT_UNSAFE');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    check(sameFile(before, fstatSync(fd)), 'ARTIFACT_IDENTITY_CHANGED');
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) break; offset += n; }
    check(offset === bytes.length && readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0
      && sameFile(before, fstatSync(fd)) && sameFile(before, lstatSync(path))
      && sameDirectory(parent, checkDirectory(dirname(path))), 'ARTIFACT_IDENTITY_CHANGED');
    check(hash(bytes) === sha, 'ARTIFACT_DIGEST_MISMATCH');
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}
function checkPendingArtifact(root, kind, sha, size) {
  const path = artifactLocation(root, kind, sha);
  let observed;
  try { observed = lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  checkDirectory(dirname(path));
  if (observed.isFile() && !observed.isSymbolicLink() && observed.nlink === 1)
    check(observed.size === size, 'ARTIFACT_PARTIAL_RETAIN_CUSTODY');
  readArtifact(root, kind, sha);
}
function artifactBytes(input) {
  check(!types.isProxy(input) && Buffer.isBuffer(input) && Object.getPrototypeOf(input) === Buffer.prototype, 'ARTIFACT_BYTES_INVALID');
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(typed, 'length').get.call(input);
  const offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset').get.call(input);
  const backing = Object.getOwnPropertyDescriptor(typed, 'buffer').get.call(input);
  check(!types.isSharedArrayBuffer(backing) && length > 0 && length <= MAX_ARTIFACT, 'ARTIFACT_BYTES_INVALID');
  check(Reflect.ownKeys(input).every(key => typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)
    && Number(key) < length), 'ARTIFACT_BYTES_INVALID');
  return Buffer.from(new Uint8Array(backing, offset, length));
}
function storeArtifact(root, kind, input, fault) {
  const bytes = artifactBytes(input), sha = hash(bytes), path = artifactLocation(root, kind, sha);
  const parent = checkDirectory(dirname(path), true);
  if (!existsSync(path)) {
    let fd;
    try {
      fault('before-artifact-create');
      fd = openSync(path, 'wx', 0o600);
      check(sameDirectory(parent, checkDirectory(dirname(path))), 'ARTIFACT_DIRECTORY_CHANGED');
      fault('after-artifact-open');
      writeFileSync(fd, bytes); fsyncSync(fd);
      fault('after-artifact-fsync');
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
    syncDirectory(dirname(path));
  }
  // A crash during creation can leave a zero/truncated final name. The pinned
  // intent retains custody; never overwrite it or pretend automatic recovery.
  const observed = lstatSync(path);
  if (observed.isFile() && !observed.isSymbolicLink() && observed.nlink === 1)
    check(observed.size === bytes.length, 'ARTIFACT_PARTIAL_RETAIN_CUSTODY');
  check(readArtifact(root, kind, sha).equals(bytes), 'ARTIFACT_DIGEST_MISMATCH');
  return sha;
}
function nextLocalRotation(journal, original) {
  const { consent, origin } = journal, action = consent.rotationAction;
  // This unit persists only the local deny/cancel state. A FROZEN certificate,
  // epoch change or successful VERIFY requires the still-separate native adapter.
  check(consent.state === 'PRE_MERGE', 'NATIVE_POST_MERGE_ADAPTER_REQUIRED');
  check(action !== 'VERIFY', 'NATIVE_VERIFY_ADAPTER_REQUIRED');
  const structural = classifySaturatedMailboxRotationPhaseV2({ state: consent.state, operation: action,
    source: consent.source,
    activation: { ...Object.fromEntries(['headSha', 'baseSha', 'treeSha', 'mergeCommitSha', 'mergeTreeSha'].map(k => [k, consent.activation[k]])), state: 'OPEN' },
    epoch: { ...consent.epoch, activeIssue: consent.epoch.predecessorIssue, retiredPredecessor: false },
    preparation: { headSha: consent.preparation.headSha, treeSha: consent.preparation.treeSha,
      closureSha256: consent.preparation.closureSha256, originalFrozenAuthenticated: false } });
  check(structural.ok, 'LOCAL_PHASE_BINDING_INVALID');
  if (original && original.schemaVersion !== MAILBOX_ROTATION_STATE_SCHEMA_V2) validateMailboxRotationRecord(original);
  if (action === 'FREEZE') check(!original || ['CANCELLED', 'VERIFIED'].includes(original.phase), 'ACTIVE_TRANSITION_EXISTS');
  else check(original?.schemaVersion === MAILBOX_ROTATION_STATE_SCHEMA_V2
    && original.transitionId === consent.transitionId && original.phase === 'DRAINING'
    && equal(original.source, consent.source) && equal(original.epoch, consent.epoch)
    && equal(original.activation, consent.activation), 'ORIGINAL_TRANSITION_UNPROVEN');
  if (action === 'DRAIN') check(consent.barrier.highestCommandCommentId >= original.barrier.highestCommandCommentId
    && consent.barrier.commentCount >= original.barrier.commentCount, 'BARRIER_REGRESSION');
  if (action === 'STATUS') return original;
  return { schemaVersion: MAILBOX_ROTATION_STATE_SCHEMA_V2, transitionId: consent.transitionId,
    phase: action === 'CANCEL' ? 'CANCELLED' : 'DRAINING', drained: false,
    source: consent.source, activation: consent.activation, epoch: consent.epoch, barrier: consent.barrier,
    freezeOrigin: action === 'FREEZE' ? origin : original.freezeOrigin, controlOrigin: origin };
}
function session(env, fault, callback) {
  check(typeof callback === 'function', 'CALLBACK_REQUIRED');
  const root = dirname(resolveMailboxOutboxGuardLockPath({ env }));
  return withMailboxOutboxGuardLock((_lock, readDrainInputs) => {
    const statePath = join(root, 'state.json'), ledger = createMailboxExecutionLedger(root);
    let alive = true, state = readJsonObject(statePath, { maxBytes: MAX_STATE });
    let stateDigest = digest(state);
    const tokens = new WeakMap();
    function load() {
      check(alive, 'SESSION_CLOSED');
      const current = readJsonObject(statePath, { maxBytes: MAX_STATE });
      check(digest(current) === stateDigest, 'STATE_CHANGED');
      state = current;
      return state[FIELD] ? journalRecord(state[FIELD]) : null;
    }
    function write(next, event) {
      const expected = stateDigest;
      fault('before-' + event);
      atomicWriteJson(statePath, next, { maxBytes: MAX_STATE, beforeRenameFn() {
        check(digest(readJsonObject(statePath, { maxBytes: MAX_STATE })) === expected, 'STATE_CHANGED');
        fault('before-' + event + '-rename');
      } });
      fault('after-' + event + '-rename');
      const observed = readJsonObject(statePath, { maxBytes: MAX_STATE });
      check(digest(observed) === digest(next), 'STATE_READBACK_MISMATCH');
      state = observed; stateDigest = digest(observed);
    }
    function current(expected) {
      const journal = load();
      check(journal && journal.generationSha256 === expected, 'GENERATION_CHANGED');
      return journal;
    }
    function update(journal, patch, event, rotation) {
      const changed = { ...journal, ...patch, revision: journal.revision + 1, updatedAtUtc: new Date().toISOString() };
      changed.generationSha256 = generation(changed); journalRecord(changed);
      write({ ...state, ...(rotation === undefined ? {} : { mailboxRotation: rotation }), [FIELD]: changed }, event);
      return report(changed);
    }
    function report(journal, extra = {}) {
      return frozen({ journal: snapshot(journal), storageOnly: true, ...noAuthority, ...extra });
    }
    function activeReservation(journal) {
      const record = ledger.read(journal.requestId);
      check(ledgerMatches(record, journal) && record.phase === 'RESERVED', 'RESERVATION_MISMATCH');
      return record;
    }
    function applied(journal) {
      check(STAGES.indexOf(journal.stage) >= 3 && digest(state.mailboxRotation ?? null) === journal.effectRotationSha256,
        'APPLIED_GENERATION_UNPROVEN');
    }
    function retainedArtifacts(journal) {
      readArtifact(root, 'terminal', journal.terminalSha256); readArtifact(root, 'proof-bundle', journal.proofBundleSha256);
      if (journal.envelopeSha256) readArtifact(root, 'signed-envelope', journal.envelopeSha256);
      else if (journal.envelopeIntentSha256)
        checkPendingArtifact(root, 'signed-envelope', journal.envelopeIntentSha256, journal.envelopeIntentBytes);
    }
    const api = Object.freeze({
      inspect() { const journal = load(); return journal ? report(journal) : frozen({ journal: null, storageOnly: true, ...noAuthority }); },
      captureDrainInputs(expected) {
        const startedAt = Date.now(), journal = current(expected);
        check(journal.stage !== 'EFFECT_INTENT', 'DRAIN_EFFECT_INTENT_UNCERTAIN');
        activeReservation(journal);
        // This also retains the existing applied-state/artifact consistency
        // checks. A local input capture cannot conceal an uncertain transaction.
        api.reconcile();
        const local = readDrainInputs(), execution = ledger.inventory();
        check(local.stateSha256 === stateDigest, 'DRAIN_STATE_CHANGED');
        const records = new Map(execution.records.map(record => [record.requestId, record]));
        const own = records.get(journal.requestId);
        check(ledgerMatches(own, journal) && own.phase === 'RESERVED', 'DRAIN_RESERVATION_MISMATCH');
        for (const requestId of local.acceptedRequestIds) {
          const record = records.get(requestId);
          check(record && record.issueNumber === journal.consent.epoch.predecessorIssue
            && record.phase !== 'RETIRED', 'DRAIN_ACCEPTED_LEDGER_UNPROVEN');
        }
        const publications = [...local.inlinePublications, ...local.outbox.queuedPublications];
        check(publications.every(entry => entry.issueNumber === journal.consent.epoch.predecessorIssue), 'DRAIN_PUBLICATION_EPOCH_MISMATCH');
        fault('after-drain-inputs-capture');
        // The Control Tower's original consumer can also write the execution
        // ledger. The outbox lock alone never proves that estate quiescent.
        const localAfter = readDrainInputs(), executionAfter = ledger.inventory();
        check(localAfter.inventorySha256 === local.inventorySha256
          && localAfter.guardGenerationSha256 === local.guardGenerationSha256
          && executionAfter.inventorySha256 === execution.inventorySha256, 'DRAIN_INVENTORY_CHANGED');
        current(expected); activeReservation(journal); api.reconcile();
        const observedAt = Date.now();
        check(observedAt >= startedAt && observedAt - startedAt <= 120000, 'DRAIN_CAPTURE_NOT_FRESH');
        const candidate = {
          schemaVersion: 'stephanos.canonical-mailbox-local-drain-inputs.v2',
          requestId: journal.requestId, transitionId: journal.consent.transitionId,
          journalGenerationSha256: journal.generationSha256, bindingSha256: journal.bindingSha256,
          sourceBinding: journal.consent.source, epochBinding: journal.consent.epoch, barrierBinding: journal.consent.barrier,
          captureStartedAtUtc: new Date(startedAt).toISOString(), observedAtUtc: new Date(observedAt).toISOString(),
          stateSha256: local.stateSha256, guardGenerationSha256: local.guardGenerationSha256,
          localInventorySha256: local.inventorySha256, executionLedgerSha256: execution.inventorySha256,
          acceptedRequestIdsSha256: digest(local.acceptedRequestIds),
          inlinePublicationInventorySha256: digest(local.inlinePublications),
          outboxManifestSha256: local.outbox.manifestSha256, outboxStoreId: local.outbox.storeId,
          outboxIndexInventorySha256: local.outbox.indexInventorySha256,
          outboxSegmentInventorySha256: local.outbox.segmentInventorySha256,
          counts: { acceptedCount: local.acceptedRequestIds.length,
            inlinePublicationCount: local.inlinePublications.length,
            segmentedPublicationCount: local.outbox.queuedPublications.length,
            distinctPublicationCount: new Set(publications.map(entry => entry.publicationId)).size,
            executionLedgerCount: execution.recordCount, reservedCount: execution.counts.RESERVED,
            terminalCount: execution.counts.TERMINAL, retiredCount: execution.counts.RETIRED,
            currentRotationReservationCount: 1 },
          // These fields deliberately cannot be passed as a canonical V2 drain
          // payload. Missing independent history/Actions facts are not zeroes.
          ordinaryReceiptDebtCount: null, historyPendingBeforeCount: null, historyPendingAfterCount: null,
          orphanAcceptedCount: null, actionPendingAggregateCount: null, actionBlockingCount: null,
          localCaptureComplete: true, fullDrainProofComplete: false, publicHistoryAuthenticated: false,
          actionsAuthenticated: false, installedSourceAuthenticated: false,
          nativeProducerQualified: false, storageOnly: true, ...noAuthority,
        };
        check(Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_ARTIFACT, 'DRAIN_CAPTURE_TOO_LARGE');
        return report(journal, { readOnly: true, drainInputCandidate: frozen(candidate) });
      },
      prepare(input) {
        const identity = descriptor(input); fresh(identity);
        const previous = load();
        if (previous?.requestId === identity.requestId) {
          check(previous.bindingSha256 === identity.bindingSha256, 'IDENTITY_CHANGED');
          return report(previous);
        }
        if (previous) {
          const terminal = ledger.read(previous.requestId);
          check(previous.stage === 'PUBLISHED' && ledgerMatches(terminal, previous) && terminal.phase === 'TERMINAL'
            && terminal.terminalProofHash === previous.envelopeSha256, 'PRIOR_TRANSACTION_NOT_TERMINAL');
          // A terminal ledger entry cannot excuse lost or divergent custody.
          // Replacing the journal must pass the same retained-state/artifact
          // checks as reconciliation before recording any new request.
          applied(previous); retainedArtifacts(previous);
        }
        check(!ledger.read(identity.requestId), 'EXISTING_REQUEST_WITHOUT_V2_JOURNAL');
        const at = new Date().toISOString();
        const journal = { schemaVersion: MAILBOX_ROTATION_TRANSACTION_SCHEMA_V2, requestId: identity.requestId,
          bindingSha256: identity.bindingSha256, origin: identity.origin, consent: identity.consent,
          stage: 'PREPARED', revision: 0, generationSha256: '', preparedAtUtc: at, updatedAtUtc: at,
          initialRotationSha256: digest(state.mailboxRotation ?? null), effectRotationSha256: '', appliedGenerationSha256: '',
          artifactIntent: null, terminalSha256: '', proofBundleSha256: '', envelopeIntentSha256: '', envelopeIntentBytes: 0,
          envelopeSha256: '', publication: null };
        journal.generationSha256 = generation(journal); journalRecord(journal);
        write({ ...state, [FIELD]: journal }, 'prepare');
        return report(journal);
      },
      reserve(expected) {
        const journal = current(expected); fresh(journal);
        check(['PREPARED', 'RESERVED'].includes(journal.stage), 'RESERVATION_PHASE_INVALID');
        let existing = ledger.read(journal.requestId);
        if (!existing) { check(journal.stage === 'PREPARED', 'RESERVATION_MISSING'); ledger.reserve(reservation(journal)); fault('after-ledger-reserve'); }
        existing = activeReservation(journal);
        if (journal.stage === 'RESERVED') return report(journal);
        return update(journal, { stage: 'RESERVED' }, 'reserved');
      },
      beginLocalEffect(expected) {
        const journal = current(expected); fresh(journal); activeReservation(journal);
        check(journal.stage === 'RESERVED' && digest(state.mailboxRotation ?? null) === journal.initialRotationSha256,
          'EFFECT_INTENT_NOT_ADMITTED');
        nextLocalRotation(journal, state.mailboxRotation); // Refuse unsupported phases BEFORE persisting intent.
        const outcome = update(journal, { stage: 'EFFECT_INTENT' }, 'effect-intent');
        const token = Object.freeze({ requestId: journal.requestId, storageOnly: true });
        tokens.set(token, outcome.journal.generationSha256);
        return Object.freeze({ ...outcome, effectToken: token });
      },
      commitLocalEffect(token) {
        const expected = token && typeof token === 'object' ? tokens.get(token) : null;
        check(expected, 'EFFECT_TOKEN_NOT_CURRENT'); tokens.delete(token);
        const journal = current(expected); fresh(journal); activeReservation(journal);
        check(journal.stage === 'EFFECT_INTENT' && digest(state.mailboxRotation ?? null) === journal.initialRotationSha256,
          'EFFECT_INTENT_UNCERTAIN');
        const rotation = nextLocalRotation(journal, state.mailboxRotation);
        const effectRotationSha256 = digest(rotation);
        const appliedGenerationSha256 = digest({ requestId: journal.requestId, bindingSha256: journal.bindingSha256,
          intentGenerationSha256: journal.generationSha256, effectRotationSha256 });
        // One atomic state.json generation contains BOTH the actual local
        // rotation-state replacement and its checkpoint. There is no side effect
        // callback and no separate write window to guess about after a crash.
        return update(journal, { stage: 'EFFECT_APPLIED', effectRotationSha256, appliedGenerationSha256 }, 'effect-applied', rotation);
      },
      storeTerminalArtifacts(expected, input) {
        let journal = current(expected); activeReservation(journal); applied(journal);
        check(['EFFECT_APPLIED', 'TERMINAL_STORED'].includes(journal.stage), 'TERMINAL_PHASE_INVALID');
        check(input && typeof input === 'object' && !types.isProxy(input)
          && [Object.prototype, null].includes(Object.getPrototypeOf(input))
          && Reflect.ownKeys(input).length === 2, 'ARTIFACT_BYTES_INVALID');
        const values = {};
        for (const key of ['terminal', 'proofBundle']) {
          const field = Object.getOwnPropertyDescriptor(input, key);
          check(field && Object.hasOwn(field, 'value') && field.enumerable, 'ARTIFACT_BYTES_INVALID');
          values[key] = artifactBytes(field.value);
        }
        const { terminal, proofBundle } = values;
        const intent = { terminalSha256: hash(terminal), proofBundleSha256: hash(proofBundle),
          terminalBytes: terminal.length, proofBundleBytes: proofBundle.length };
        if (journal.artifactIntent) check(equal(journal.artifactIntent, intent), 'TERMINAL_IDENTITY_CHANGED');
        else journal = update(journal, { artifactIntent: intent }, 'artifact-intent').journal;
        const terminalSha256 = storeArtifact(root, 'terminal', terminal, fault);
        const proofBundleSha256 = storeArtifact(root, 'proof-bundle', proofBundle, fault);
        if (journal.stage === 'TERMINAL_STORED') {
          check(journal.terminalSha256 === terminalSha256 && journal.proofBundleSha256 === proofBundleSha256, 'TERMINAL_IDENTITY_CHANGED');
          return report(journal);
        }
        return update(journal, { stage: 'TERMINAL_STORED', terminalSha256, proofBundleSha256 }, 'terminal-stored');
      },
      attachEnvelope(expected, bytes) {
        let journal = current(expected); activeReservation(journal); applied(journal);
        check(journal.stage === 'TERMINAL_STORED', 'ENVELOPE_PHASE_INVALID');
        readArtifact(root, 'terminal', journal.terminalSha256); readArtifact(root, 'proof-bundle', journal.proofBundleSha256);
        bytes = artifactBytes(bytes);
        const decoded = decodeMailboxNativeEvidenceV2(bytes), payload = decoded.envelope.payload;
        check(payload.requestId === journal.requestId && payload.transitionId === journal.consent.transitionId
          && equal(payload.origin, journal.origin) && equal(payload.source, journal.consent.source)
          && equal(payload.activation, nativeActivation(journal.consent)) && equal(payload.epoch, journal.consent.epoch)
          && equal(payload.barrier, journal.consent.barrier)
          && payload.guard.transactionSha256 === journal.appliedGenerationSha256
          && payload.originalTerminalSha256 === journal.terminalSha256 && payload.proofArtifactSha256 === journal.proofBundleSha256,
        'ENVELOPE_BINDING_MISMATCH');
        const intent = decoded.artifactSha256;
        if (journal.envelopeIntentSha256) check(journal.envelopeIntentSha256 === intent, 'ENVELOPE_IDENTITY_CHANGED');
        else journal = update(journal, { envelopeIntentSha256: intent, envelopeIntentBytes: bytes.length }, 'envelope-intent').journal;
        const envelopeSha256 = storeArtifact(root, 'signed-envelope', bytes, fault);
        if (journal.envelopeSha256) { check(journal.envelopeSha256 === envelopeSha256, 'ENVELOPE_IDENTITY_CHANGED'); return report(journal); }
        // Encoding/binding and durable bytes only. Signature/native provenance
        // must be validated by the original owner before outbox publication.
        return update(journal, { envelopeSha256 }, 'envelope-stored');
      },
      recordPublicationReadback(expected, input) {
        const journal = current(expected); activeReservation(journal); applied(journal);
        check(journal.stage === 'TERMINAL_STORED' && HEX.test(journal.envelopeSha256), 'PUBLICATION_PHASE_INVALID');
        const comment = snapshot(input), bytes = readArtifact(root, 'signed-envelope', journal.envelopeSha256);
        const body = `${MAILBOX_ROTATION_EVIDENCE_MARKER_V2}\n\`\`\`json\n${bytes.toString('utf8')}\n\`\`\`\n`;
        check(Number.isSafeInteger(comment.id) && comment.id > 0 && comment.user?.login === 'Cheekyfellastef'
          && comment.user.id === 267490109 && comment.issue_url === `https://api.github.com/repos/${REPO}/issues/2315`
          && comment.html_url === `https://github.com/${REPO}/issues/2315#issuecomment-${comment.id}`
          && comment.created_at === comment.updated_at && Number.isFinite(Date.parse(comment.created_at))
          && Date.parse(comment.created_at) >= Date.parse(journal.origin.createdAtUtc)
          && Date.parse(comment.created_at) <= Date.now() && comment.body === body, 'PUBLICATION_READBACK_MISMATCH');
        const publication = { goalIssue: 2315, commentId: comment.id, bodySha256: hash(body),
          createdAtUtc: new Date(comment.created_at).toISOString() };
        // This records an already-obtained readback; it does not authenticate its
        // API transport, publish, or terminalize the original execution ledger.
        return update(journal, { stage: 'PUBLISHED', publication }, 'published');
      },
      reconcile() {
        const journal = load();
        if (!journal) return frozen({ disposition: 'NO_TRANSACTION', storageOnly: true, ...noAuthority });
        const record = ledger.read(journal.requestId);
        if (record) check(ledgerMatches(record, journal), 'RESERVATION_MISMATCH');
        let disposition;
        if (journal.stage === 'PREPARED') {
          check(!record || record.phase === 'RESERVED', 'RESERVATION_MISMATCH');
          disposition = record ? 'RECONCILE_EXISTING_RESERVATION' : 'FRESH_ADMISSION_BEFORE_RESERVATION';
        } else {
          check(record && ['RESERVED', 'TERMINAL'].includes(record.phase), 'RESERVATION_MISSING');
          if (journal.stage !== 'PUBLISHED') check(record.phase === 'RESERVED', 'EARLY_LEDGER_TERMINAL');
          if (journal.stage === 'RESERVED') disposition = 'FRESH_ADMISSION_BEFORE_FIRST_EFFECT';
          else if (journal.stage === 'EFFECT_INTENT') disposition = 'UNKNOWN_EFFECT_INTENT_RETAIN_CUSTODY';
          else {
            applied(journal);
            if (journal.stage === 'EFFECT_APPLIED') {
              if (journal.artifactIntent) {
                checkPendingArtifact(root, 'terminal', journal.artifactIntent.terminalSha256, journal.artifactIntent.terminalBytes);
                checkPendingArtifact(root, 'proof-bundle', journal.artifactIntent.proofBundleSha256, journal.artifactIntent.proofBundleBytes);
              }
              disposition = 'STORE_ORIGINAL_TERMINAL_ONLY';
            }
            else {
              retainedArtifacts(journal);
              disposition = journal.stage === 'TERMINAL_STORED' ? journal.envelopeSha256
                ? 'VERIFY_AND_REPUBLISH_ORIGINAL_ARTIFACT_ONLY' : 'AUTHENTICATE_AND_STORE_ORIGINAL_ENVELOPE_ONLY'
                : record.phase === 'RESERVED' ? 'AWAIT_ORIGINAL_LEDGER_TERMINALIZATION' : 'RETURN_ORIGINAL_ARTIFACT_ONLY';
              if (record.phase === 'TERMINAL') check(record.terminalProofHash === journal.envelopeSha256, 'TERMINAL_PROOF_MISMATCH');
            }
          }
        }
        return report(journal, { disposition });
      },
    });
    try { return callback(api); }
    finally { alive = false; }
  }, { env });
}

export function withMailboxRotationTransactionJournalV2(callback) {
  return session(process.env, () => {}, callback);
}

// Test-only filesystem/fault seams; no global hooks and no production identity,
// enrollment or authentication can be supplied through this factory.
export function withMailboxRotationTransactionTestJournalV2(workspace, callback, { fault = () => {} } = {}) {
  if (!process.env.NODE_TEST_CONTEXT) throw Error('TEST_TRANSACTION_STORE_NOT_ADMITTED');
  return session({ ...process.env, STEPHANOS_SHARED_WORKSPACE_ROOT: workspace }, fault, callback);
}
