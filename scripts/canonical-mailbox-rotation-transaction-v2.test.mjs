import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync,
  linkSync, symlinkSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { validateMailboxRotationRecord } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2, MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2,
  encodeMailboxNativeEvidenceV2 } from '../shared/agents/canonicalMailboxNativeEvidenceCodecV2.mjs';
import { formatMailboxRotationOwnerControlV2, parseMailboxRotationOwnerControlCandidateV2 } from '../shared/agents/canonicalMailboxRotationOwnerControlV2.mjs';
import { MAILBOX_ROTATION_EVIDENCE_MARKER_V2, MAILBOX_ROTATION_STATE_SCHEMA_V2,
  withMailboxRotationTransactionTestJournalV2 as withJournal } from './canonical-mailbox-rotation-transaction-v2.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sha = c => c.repeat(64), git = c => c.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os';
const FIELD = 'mailboxRotationControlTransactionV2';
const terminal = Buffer.from('{"fixture":"local terminal only"}');
const proofBundle = Buffer.from('{"fixture":"proof bundle, no native authority"}');
function input({ action = 'FREEZE', commentId = 12345, transitionId = 'fixture-transition-001' } = {}) {
  const now = Date.now();
  const consent = { schemaVersion: MAILBOX_ROTATION_OWNER_CONTROL_SCHEMA_V2, repository: REPO,
    operatorApproval: 'operator-approved', transitionId, rotationAction: action, state: 'PRE_MERGE',
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'),
      installedTreeSha: git('b'), installedClosureSha256: sha('c'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('d'), baseSha: git('a'), treeSha: git('e'), mergeCommitSha: null, mergeTreeSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 100, inventorySha256: sha('f'), commentCount: 2500 },
    preparation: { headSha: git('a'), treeSha: git('b'), closureSha256: sha('c'), originalFrozenArtifactSha256: null },
    expiresAtUtc: new Date(now + 300000).toISOString(), probeRequestIds: action === 'VERIFY' ? ['probe-one', 'probe-two'] : [] };
  return { consent, origin: { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId,
    commentBodySha256: hash(formatMailboxRotationOwnerControlV2(consent)), createdAtUtc: new Date(now - 1000).toISOString() } };
}
function noAuthority(value) {
  for (const key of ['consentAuthenticated', 'nativeEvidenceAuthenticated', 'nativeExecutionAuthorized',
    'freezeCertified', 'protectedMergeAuthorized', 'sourceSyncAuthorized', 'epochAdoptionAuthorized', 'effectReplayAllowed'])
    assert.equal(value[key], false, key);
  assert.equal(value.storageOnly, true);
}
function fixture(t, initial = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'mailbox-v2-journal-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const root = join(workspace, 'github-command-mailbox'); mkdirSync(root);
  const path = join(root, 'state.json');
  writeFileSync(path, JSON.stringify({ acceptedRequestIds: [], pendingReceiptPublications: [],
    retained: { unrelated: 'preserve me' }, ...initial }));
  return { workspace, root, path, read: () => JSON.parse(readFileSync(path)),
    run: (fn, fault) => withJournal(workspace, fn, fault ? { fault } : {}) };
}
function prepare(api, descriptor = input()) { return api.prepare(descriptor).journal; }
function reserve(api, descriptor = input()) { const j = prepare(api, descriptor); return api.reserve(j.generationSha256).journal; }
function apply(api, descriptor = input()) {
  const j = reserve(api, descriptor), intent = api.beginLocalEffect(j.generationSha256);
  return api.commitLocalEffect(intent.effectToken).journal;
}
function storeTerminal(api, descriptor = input()) {
  const j = apply(api, descriptor);
  return api.storeTerminalArtifacts(j.generationSha256, { terminal, proofBundle }).journal;
}
function envelope(journal) {
  const now = Date.now();
  const { mergeTreeSha, ...activation } = journal.consent.activation;
  return encodeMailboxNativeEvidenceV2({ schemaVersion: MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2, algorithm: 'Ed25519',
    enrollmentId: 'fixture-not-enrolled', keyId: 'fixture-not-a-key', signatureBase64: Buffer.alloc(64).toString('base64'),
    payload: { kind: 'CONTROL_TERMINAL', repository: REPO, deviceIdSha256: sha('1'), producerId: 'fixture-not-a-producer',
      producerPrincipalSha256: sha('2'), producerProfileSha256: sha('3'), requestId: journal.requestId,
      transitionId: journal.consent.transitionId, phase: 'DRAINING', result: 'LOCAL_STATE_PERSISTED',
      origin: journal.origin, source: journal.consent.source, activation,
      epoch: journal.consent.epoch, barrier: journal.consent.barrier,
      guard: { generationId: 'fixture-generation', ownerInstanceId: 'fixture-owner', transactionSha256: journal.appliedGenerationSha256 },
      drain: { acceptedCount: 0, inlinePublicationCount: 0, segmentedPublicationCount: 0, ordinaryReceiptDebtCount: 0,
        historyPendingBeforeCount: 0, historyPendingAfterCount: 0, orphanAcceptedCount: 0,
        outboxInventorySha256: sha('4'), actionsInventorySha256: sha('5'), actionsObservedAtUtc: new Date(now - 10).toISOString(),
        actionPendingAggregateCount: 0, actionBlockingCount: 0 },
      originalTerminalSha256: journal.terminalSha256, proofArtifactSha256: journal.proofBundleSha256,
      observedAtUtc: new Date(now - 10).toISOString(), expiresAtUtc: new Date(now + 100000).toISOString() } });
}
function publication(bytes) {
  const at = new Date().toISOString();
  return { id: 333333, user: { login: 'Cheekyfellastef', id: 267490109 },
    issue_url: `https://api.github.com/repos/${REPO}/issues/2315`,
    html_url: `https://github.com/${REPO}/issues/2315#issuecomment-333333`, created_at: at, updated_at: at,
    body: `${MAILBOX_ROTATION_EVIDENCE_MARKER_V2}\n\`\`\`json\n${bytes.toString('utf8')}\n\`\`\`\n` };
}
function publishedTerminal(f, descriptor = input()) {
  const journal = f.run(api => {
    const j = storeTerminal(api, descriptor), bytes = envelope(j), attached = api.attachEnvelope(j.generationSha256, bytes);
    return api.recordPublicationReadback(attached.journal.generationSha256, publication(bytes)).journal;
  });
  // Original executor terminalization remains separate from the storage unit.
  createMailboxExecutionLedger(f.root).complete({ requestId: journal.requestId, issueNumber: 3149,
    state: 'DONE', proofHash: journal.envelopeSha256 });
  return journal;
}
function artifact(f, kind, sha256) { return join(f.root, 'rotation-evidence-v2', kind, sha256.slice(0, 2), sha256 + '.json'); }
function crashAt(wanted) { return event => { if (event === wanted) throw Error('fixture crash at ' + event); }; }

test('same real owner-comment identity, original ledger and original singleton guard are retained', t => {
  const f = fixture(t), descriptor = input(), created = descriptor.origin.createdAtUtc;
  const parsed = parseMailboxRotationOwnerControlCandidateV2({ id: descriptor.origin.commentId,
    user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' }, author_association: 'OWNER',
    created_at: created, updated_at: created, body: formatMailboxRotationOwnerControlV2(descriptor.consent),
    issue_url: `https://api.github.com/repos/${REPO}/issues/3268`,
    html_url: `https://github.com/${REPO}/pull/3268#issuecomment-${descriptor.origin.commentId}` });
  assert.equal(parsed.ok, true);
  let result;
  f.run(api => {
    const j = prepare(api, descriptor); assert.equal(j.requestId, parsed.requestId);
    assert.throws(() => f.run(() => {}), /MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING/);
    result = api.reserve(j.generationSha256); noAuthority(result);
  });
  assert.equal(createMailboxExecutionLedger(f.root).read(result.journal.requestId).phase, 'RESERVED');
  assert.deepEqual(f.read().retained, { unrelated: 'preserve me' });
  assert.equal(readdirSync(f.root).some(name => name.endsWith('.lock-v1.json')), false);
});
test('a missing original state is not initialized as an empty authoritative owner', t => {
  const f = fixture(t); rmSync(f.path);
  assert.throws(() => f.run(api => api.prepare(input())));
  assert.equal(readdirSync(f.root).includes('state.json'), false);
});
test('preparation is idempotent by exact original identity, never by supplied request id', t => {
  const f = fixture(t), value = input();
  f.run(api => {
    const first = api.prepare(value), second = api.prepare(value);
    assert.deepEqual(second, first); noAuthority(first);
    assert.throws(() => api.prepare({ ...value, requestId: 'caller-choice' }), /INPUT_INVALID/);
    assert.throws(() => api.prepare(input({ commentId: 12346 })), /PRIOR_TRANSACTION_NOT_TERMINAL/);
  });
});
for (const phase of ['RESERVED', 'TERMINAL', 'RETIRED']) test('old ' + phase + ' V1 tombstones cannot be upgraded to V2', t => {
  const f = fixture(t), value = input();
  const j = f.run(api => api.prepare(value)).journal;
  const state = f.read(); delete state[FIELD]; writeFileSync(f.path, JSON.stringify(state));
  createMailboxExecutionLedger(f.root).importHistorical(j.requestId, 3149, phase);
  assert.throws(() => f.run(api => api.prepare(value)), /EXISTING_REQUEST_WITHOUT_V2_JOURNAL/);
  assert.equal(createMailboxExecutionLedger(f.root).read(j.requestId).phase, phase);
});
test('crash after PREPARED preserves no-effect evidence and requires first reservation admission', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => api.prepare(input()), crashAt('after-prepare-rename')), /fixture crash/);
  assert.equal(f.read()[FIELD].stage, 'PREPARED'); assert.equal(f.read().mailboxRotation, undefined);
  f.run(api => { const result = api.reconcile(); assert.equal(result.disposition, 'FRESH_ADMISSION_BEFORE_RESERVATION'); noAuthority(result); });
});
test('crash after wx reservation reconciles the original reservation without reserving again', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => reserve(api), crashAt('after-ledger-reserve')), /fixture crash/);
  assert.equal(f.read()[FIELD].stage, 'PREPARED');
  const before = createMailboxExecutionLedger(f.root).read(f.read()[FIELD].requestId);
  f.run(api => {
    const observed = api.reconcile(); assert.equal(observed.disposition, 'RECONCILE_EXISTING_RESERVATION');
    assert.equal(api.reserve(observed.journal.generationSha256).journal.stage, 'RESERVED');
  });
  assert.deepEqual(createMailboxExecutionLedger(f.root).read(before.requestId), before);
});
test('foreign reservation binding cannot be adopted even with the same request and epoch', t => {
  const f = fixture(t);
  const j = f.run(api => prepare(api));
  createMailboxExecutionLedger(f.root).reserve({ requestId: j.requestId, issueNumber: 3149, foreign: true });
  assert.throws(() => f.run(api => api.reserve(j.generationSha256)), /RESERVATION_MISMATCH/);
  assert.equal(f.read()[FIELD].stage, 'PREPARED');
});
test('RESERVED requires fresh consent before first effect and never becomes execution authority', t => {
  const f = fixture(t);
  f.run(api => reserve(api));
  f.run(api => { const result = api.reconcile(); assert.equal(result.disposition, 'FRESH_ADMISSION_BEFORE_FIRST_EFFECT'); noAuthority(result); });
});
for (const point of ['after-effect-intent-rename', 'before-effect-applied-rename']) test('crash at ' + point + ' retains UNKNOWN and denies replay', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => apply(api), crashAt(point)), /fixture crash/);
  assert.equal(f.read()[FIELD].stage, 'EFFECT_INTENT'); assert.equal(f.read().mailboxRotation, undefined);
  f.run(api => {
    const result = api.reconcile(); assert.equal(result.disposition, 'UNKNOWN_EFFECT_INTENT_RETAIN_CUSTODY'); noAuthority(result);
    assert.throws(() => api.beginLocalEffect(result.journal.generationSha256), /EFFECT_INTENT_NOT_ADMITTED/);
    assert.throws(() => api.commitLocalEffect({ requestId: result.journal.requestId }), /EFFECT_TOKEN_NOT_CURRENT/);
  });
});
test('one atomic generation persists local deny state together with EFFECT_APPLIED, even if return is lost', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => apply(api), crashAt('after-effect-applied-rename')), /fixture crash/);
  const persisted = f.read();
  assert.equal(persisted[FIELD].stage, 'EFFECT_APPLIED'); assert.equal(persisted.mailboxRotation.phase, 'DRAINING');
  assert.equal(persisted.mailboxRotation.schemaVersion, MAILBOX_ROTATION_STATE_SCHEMA_V2);
  assert.equal(persisted.mailboxRotation.drained, false);
  assert.throws(() => validateMailboxRotationRecord(persisted.mailboxRotation), /RECORD_INVALID/);
  assert.deepEqual(persisted.retained, { unrelated: 'preserve me' });
  f.run(api => { const result = api.reconcile(); assert.equal(result.disposition, 'STORE_ORIGINAL_TERMINAL_ONLY'); noAuthority(result); });
});
test('effect token is one-use, non-cloneable and bound to its live original guard session', t => {
  const f = fixture(t); let token, staleApi;
  f.run(api => {
    staleApi = api; const j = reserve(api), intent = api.beginLocalEffect(j.generationSha256); token = intent.effectToken;
    assert.throws(() => api.commitLocalEffect({ ...token }), /EFFECT_TOKEN_NOT_CURRENT/);
    noAuthority(api.commitLocalEffect(token));
    assert.throws(() => api.commitLocalEffect(token), /EFFECT_TOKEN_NOT_CURRENT/);
  });
  assert.throws(() => staleApi.inspect(), /SESSION_CLOSED/);
  f.run(api => assert.throws(() => api.commitLocalEffect(token), /EFFECT_TOKEN_NOT_CURRENT/));
});
test('no asynchronous callback can continue a journal session after the original guard releases', t => {
  const f = fixture(t); let retained;
  assert.throws(() => f.run(api => { retained = api; return Promise.resolve(); }), /SYNCHRONOUS_OPERATION_REQUIRED/);
  assert.throws(() => retained.prepare(input()), /SESSION_CLOSED/);
});
test('current generation is required and unrelated concurrent state edits are retained, never overwritten', t => {
  const f = fixture(t);
  f.run(api => {
    const j = prepare(api), next = api.reserve(j.generationSha256);
    assert.throws(() => api.beginLocalEffect(j.generationSha256), /GENERATION_CHANGED/);
    const external = f.read(); external.retained.unrelated = 'concurrent writer'; writeFileSync(f.path, JSON.stringify(external));
    assert.throws(() => api.beginLocalEffect(next.journal.generationSha256), /STATE_CHANGED/);
  });
  assert.equal(f.read().retained.unrelated, 'concurrent writer');
});
test('state movement immediately before atomic rename is detected without discarding it', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => reserve(api), event => {
    if (event === 'before-reserved') { const state = f.read(); state.retained.unrelated = 'late writer'; writeFileSync(f.path, JSON.stringify(state)); }
  }), /STATE_CHANGED|IDENTITY_CHANGED/);
  assert.equal(f.read().retained.unrelated, 'late writer'); assert.equal(f.read()[FIELD].stage, 'PREPARED');
});
test('journal identity corruption and effect-state divergence fail closed after reopening', t => {
  const f = fixture(t); f.run(api => apply(api));
  const original = f.read(), corrupt = structuredClone(original);
  corrupt[FIELD].origin.commentId++; writeFileSync(f.path, JSON.stringify(corrupt));
  assert.throws(() => f.run(api => api.reconcile()), /IDENTITY_CHANGED/);
  original.mailboxRotation.phase = 'FROZEN'; writeFileSync(f.path, JSON.stringify(original));
  assert.throws(() => f.run(api => api.reconcile()), /APPLIED_GENERATION_UNPROVEN/);
});
test('immutable original artifacts survive lost checkpoint and retry without being rewritten', t => {
  const f = fixture(t); f.run(api => apply(api));
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle }), crashAt('after-artifact-fsync')), /fixture crash/);
  assert.equal(f.read()[FIELD].stage, 'EFFECT_APPLIED');
  const first = artifact(f, 'terminal', hash(terminal)), before = lstatSync(first);
  f.run(api => {
    const out = api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle });
    assert.equal(out.journal.stage, 'TERMINAL_STORED'); noAuthority(out);
    assert.deepEqual(api.storeTerminalArtifacts(out.journal.generationSha256, { terminal, proofBundle }), out);
  });
  const after = lstatSync(first); assert.equal(before.ino, after.ino); assert.equal(before.mtimeMs, after.mtimeMs);
  assert.deepEqual(readFileSync(first), terminal);
});
test('terminal checkpoint with a lost return requires the original envelope, never another effect', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => storeTerminal(api), crashAt('after-terminal-stored-rename')), /fixture crash/);
  f.run(api => { const result = api.reconcile(); assert.equal(result.disposition, 'AUTHENTICATE_AND_STORE_ORIGINAL_ENVELOPE_ONLY'); noAuthority(result); });
});
test('lost artifact-intent return pins original terminal and proof bytes before either artifact exists', t => {
  const f = fixture(t); f.run(api => apply(api));
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle }),
    crashAt('after-artifact-intent-rename')), /fixture crash/);
  assert.equal(f.read()[FIELD].artifactIntent.terminalSha256, hash(terminal));
  assert.equal(readdirSync(f.root).includes('rotation-evidence-v2'), false);
  for (const changed of [{ terminal: Buffer.from('changed terminal'), proofBundle }, { terminal, proofBundle: Buffer.from('changed proof') }])
    assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, changed)), /TERMINAL_IDENTITY_CHANGED/);
  f.run(api => assert.equal(api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle }).journal.stage, 'TERMINAL_STORED'));
});
for (const partial of [Buffer.alloc(0), terminal.subarray(0, 7)]) test('partial artifact of ' + partial.length + ' bytes retains custody and is never overwritten or re-executed', t => {
  const f = fixture(t); f.run(api => apply(api));
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle }), event => {
    if (event === 'after-artifact-open') { writeFileSync(artifact(f, 'terminal', hash(terminal)), partial); throw Error('fixture partial write crash'); }
  }), /fixture partial write crash/);
  assert.equal(f.read()[FIELD].stage, 'EFFECT_APPLIED');
  assert.throws(() => f.run(api => api.reconcile()), /ARTIFACT_PARTIAL_RETAIN_CUSTODY/);
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle })), /ARTIFACT_PARTIAL_RETAIN_CUSTODY/);
  assert.deepEqual(readFileSync(artifact(f, 'terminal', hash(terminal))), partial);
  assert.equal(f.read().mailboxRotation.phase, 'DRAINING');
});
test('expiry after application permits retaining original artifacts but never another effect', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = fixture(t); f.run(api => apply(api)); t.mock.timers.tick(20 * 60 * 1000);
  f.run(api => {
    const j = api.inspect().journal;
    assert.equal(api.storeTerminalArtifacts(j.generationSha256, { terminal, proofBundle }).journal.stage, 'TERMINAL_STORED');
    assert.throws(() => api.beginLocalEffect(api.inspect().journal.generationSha256), /FRESH_OWNER_ADMISSION_REQUIRED/);
  });
});
test('encoded envelope storage binds the exact original artifacts but never authenticates a fixture signature', t => {
  const f = fixture(t);
  f.run(api => {
    const j = storeTerminal(api), bytes = envelope(j), stored = api.attachEnvelope(j.generationSha256, bytes);
    assert.equal(stored.journal.envelopeSha256, hash(bytes)); noAuthority(stored);
    assert.equal(stored.nativeEvidenceAuthenticated, false);
    assert.deepEqual(readFileSync(artifact(f, 'signed-envelope', hash(bytes))), bytes);
  });
});
test('lost envelope-intent return refuses a differently signed retry and accepts only the original bytes', t => {
  const f = fixture(t), journal = f.run(api => storeTerminal(api)), bytes = envelope(journal);
  assert.throws(() => f.run(api => api.attachEnvelope(api.inspect().journal.generationSha256, bytes), crashAt('after-envelope-intent-rename')), /fixture crash/);
  assert.equal(f.read()[FIELD].envelopeIntentSha256, hash(bytes)); assert.equal(f.read()[FIELD].envelopeSha256, '');
  const changed = JSON.parse(bytes.toString()); changed.signatureBase64 = Buffer.alloc(64, 1).toString('base64');
  assert.throws(() => f.run(api => api.attachEnvelope(api.inspect().journal.generationSha256, encodeMailboxNativeEvidenceV2(changed))), /ENVELOPE_IDENTITY_CHANGED/);
  f.run(api => assert.equal(api.attachEnvelope(api.inspect().journal.generationSha256, bytes).journal.envelopeSha256, hash(bytes)));
});
for (const field of ['requestId', 'originalTerminalSha256', 'proofArtifactSha256']) test('envelope ' + field + ' substitution cannot attach to another transaction', t => {
  const f = fixture(t);
  f.run(api => {
    const j = storeTerminal(api), decoded = JSON.parse(envelope(j).toString());
    decoded.payload[field] = field === 'requestId' ? 'different-original-request' : sha('9');
    assert.throws(() => api.attachEnvelope(j.generationSha256, encodeMailboxNativeEvidenceV2(decoded)), /ENVELOPE_BINDING_MISMATCH/);
    assert.equal(api.inspect().journal.envelopeSha256, '');
  });
});
test('publication checkpoint preserves an exact evidence-only readback and leaves original terminalization to its owner', t => {
  const f = fixture(t); let last;
  f.run(api => {
    const j = storeTerminal(api), bytes = envelope(j), attached = api.attachEnvelope(j.generationSha256, bytes);
    const out = api.recordPublicationReadback(attached.journal.generationSha256, publication(bytes));
    assert.equal(out.journal.stage, 'PUBLISHED'); noAuthority(out); last = out.journal;
    assert.equal(api.reconcile().disposition, 'AWAIT_ORIGINAL_LEDGER_TERMINALIZATION');
  });
  const ledger = createMailboxExecutionLedger(f.root); assert.equal(ledger.read(last.requestId).phase, 'RESERVED');
  // Fixture simulates the ORIGINAL independently admitted executor's terminal
  // path. The persistence API itself never calls ledger.complete or signs.
  ledger.complete({ requestId: last.requestId, issueNumber: 3149, state: 'DONE', proofHash: last.envelopeSha256 });
  f.run(api => { const out = api.reconcile(); assert.equal(out.disposition, 'RETURN_ORIGINAL_ARTIFACT_ONLY'); noAuthority(out); });
});
for (const [name, change] of [
  ['edited', c => { c.updated_at = '2026-01-01T00:00:00Z'; }],
  ['wrong issue', c => { c.issue_url = c.issue_url.replace('/2315', '/3258'); }],
  ['wrong owner', c => { c.user.id++; }],
  ['changed bytes', c => { c.body += 'modified'; }],
]) test('rejects ' + name + ' publication readback without terminalizing or granting authority', t => {
  const f = fixture(t);
  f.run(api => {
    const j = storeTerminal(api), bytes = envelope(j), attached = api.attachEnvelope(j.generationSha256, bytes), comment = publication(bytes);
    change(comment); assert.throws(() => api.recordPublicationReadback(attached.journal.generationSha256, comment), /PUBLICATION_READBACK_MISMATCH/);
    assert.equal(api.inspect().journal.stage, 'TERMINAL_STORED');
  });
});
test('published readback loss does not repeat execution or implicitly terminalize the original ledger', t => {
  const f = fixture(t);
  assert.throws(() => f.run(api => {
    const j = storeTerminal(api), bytes = envelope(j), attached = api.attachEnvelope(j.generationSha256, bytes);
    api.recordPublicationReadback(attached.journal.generationSha256, publication(bytes));
  }, crashAt('after-published-rename')), /fixture crash/);
  assert.equal(f.read()[FIELD].stage, 'PUBLISHED');
  f.run(api => assert.equal(api.reconcile().disposition, 'AWAIT_ORIGINAL_LEDGER_TERMINALIZATION'));
});
test('unpublished transactions cannot disappear behind a new control request', t => {
  const f = fixture(t); f.run(api => storeTerminal(api));
  assert.throws(() => f.run(api => api.prepare(input({ commentId: 45678 }))), /PRIOR_TRANSACTION_NOT_TERMINAL/);
});
test('a fresh request cannot discard a divergent applied generation after original terminalization', t => {
  const f = fixture(t), original = publishedTerminal(f), changed = f.read();
  changed.mailboxRotation.phase = 'CANCELLED'; writeFileSync(f.path, JSON.stringify(changed));
  const before = readFileSync(f.path), ledger = createMailboxExecutionLedger(f.root), terminalRecord = ledger.read(original.requestId);
  assert.throws(() => f.run(api => api.reconcile()), /APPLIED_GENERATION_UNPROVEN/);
  assert.throws(() => f.run(api => apply(api, input({ commentId: 99999, transitionId: 'fixture-transition-next' }))), /APPLIED_GENERATION_UNPROVEN/);
  assert.deepEqual(readFileSync(f.path), before);
  assert.deepEqual(ledger.read(original.requestId), terminalRecord);
});
for (const [kind, field] of [['terminal', 'terminalSha256'], ['proof-bundle', 'proofBundleSha256'], ['signed-envelope', 'envelopeSha256']])
  for (const damage of ['missing', 'corrupt']) test('a fresh request retains the original journal when its ' + kind + ' is ' + damage, t => {
    const f = fixture(t), original = publishedTerminal(f), path = artifact(f, kind, original[field]);
    if (damage === 'missing') rmSync(path);
    else writeFileSync(path, Buffer.alloc(lstatSync(path).size, 120));
    const before = readFileSync(f.path), ledger = createMailboxExecutionLedger(f.root), terminalRecord = ledger.read(original.requestId);
    const expected = damage === 'missing' ? /ENOENT/ : /ARTIFACT_DIGEST_MISMATCH/;
    assert.throws(() => f.run(api => api.reconcile()), expected);
    assert.throws(() => f.run(api => apply(api, input({ action: 'DRAIN', commentId: 99999 }))), expected);
    assert.deepEqual(readFileSync(f.path), before);
    assert.deepEqual(ledger.read(original.requestId), terminalRecord);
  });
test('a consistent published terminal permits the next original control while retaining original artifacts and ledger', t => {
  const f = fixture(t), original = publishedTerminal(f), ledger = createMailboxExecutionLedger(f.root), terminalRecord = ledger.read(original.requestId);
  const next = f.run(api => apply(api, input({ action: 'DRAIN', commentId: 99999 })));
  assert.notEqual(next.requestId, original.requestId);
  assert.equal(next.stage, 'EFFECT_APPLIED'); assert.equal(f.read().mailboxRotation.phase, 'DRAINING');
  assert.deepEqual(ledger.read(original.requestId), terminalRecord);
  for (const [kind, field] of [['terminal', 'terminalSha256'], ['proof-bundle', 'proofBundleSha256'], ['signed-envelope', 'envelopeSha256']])
    assert.equal(hash(readFileSync(artifact(f, kind, original[field]))), original[field]);
});
for (const attack of ['corrupt', 'hardlink', 'symlink']) test('immutable artifact ' + attack + ' is rejected on actual disk read', t => {
  const f = fixture(t); const j = f.run(api => storeTerminal(api));
  const path = artifact(f, 'terminal', j.terminalSha256);
  if (attack === 'corrupt') writeFileSync(path, 'corrupted');
  if (attack === 'hardlink') linkSync(path, join(f.workspace, 'another-link.json'));
  if (attack === 'symlink') { const old = join(f.workspace, 'moved-original.json'); renameSync(path, old); symlinkSync(old, path, 'file'); }
  assert.throws(() => f.run(api => api.reconcile()), /ARTIFACT_UNSAFE|ARTIFACT_DIGEST_MISMATCH/);
});
test('linked artifact parent cannot escape the original mailbox estate', t => {
  const f = fixture(t), other = mkdtempSync(join(tmpdir(), 'mailbox-v2-outside-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  f.run(api => apply(api)); symlinkSync(other, join(f.root, 'rotation-evidence-v2'), 'junction');
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle })), /DIRECTORY_UNSAFE/);
  assert.deepEqual(readdirSync(other), []);
});
test('artifact write-readback catches mutation before the completion checkpoint', t => {
  const f = fixture(t); f.run(api => apply(api));
  assert.throws(() => f.run(api => api.storeTerminalArtifacts(api.inspect().journal.generationSha256, { terminal, proofBundle }), event => {
    if (event === 'after-artifact-fsync') writeFileSync(artifact(f, 'terminal', hash(terminal)), Buffer.alloc(terminal.length, 120));
  }), /ARTIFACT_DIGEST_MISMATCH/);
  assert.equal(f.read()[FIELD].stage, 'EFFECT_APPLIED');
});
test('owner input and artifact accessors/proxies execute no injected code', t => {
  const f = fixture(t); let calls = 0;
  f.run(api => {
    const value = input(); Object.defineProperty(value, 'origin', { get() { calls++; return {}; } });
    assert.throws(() => api.prepare(value), /INPUT_INVALID/);
    assert.throws(() => api.prepare(new Proxy(input(), { ownKeys() { calls++; throw Error(); } })), /INPUT_INVALID/);
    const j = apply(api), bytes = Buffer.from(terminal);
    Object.defineProperty(bytes, 'length', { get() { calls++; return terminal.length; } });
    assert.throws(() => api.storeTerminalArtifacts(j.generationSha256, { terminal: bytes, proofBundle }), /ARTIFACT_BYTES_INVALID/);
    const artifacts = { proofBundle };
    Object.defineProperty(artifacts, 'terminal', { enumerable: true, get() { calls++; return terminal; } });
    assert.throws(() => api.storeTerminalArtifacts(j.generationSha256, artifacts), /ARTIFACT_BYTES_INVALID/);
    assert.throws(() => api.storeTerminalArtifacts(j.generationSha256, new Proxy({ terminal, proofBundle },
      { get() { calls++; throw Error(); }, ownKeys() { calls++; throw Error(); } })), /ARTIFACT_BYTES_INVALID/);
  });
  assert.equal(calls, 0);
});
test('native VERIFY and post-merge operations are not silently implemented as local state writes', t => {
  const f = fixture(t);
  f.run(api => {
    const j = reserve(api, input({ action: 'VERIFY' }));
    assert.throws(() => api.beginLocalEffect(j.generationSha256), /NATIVE_VERIFY_ADAPTER_REQUIRED/);
    assert.equal(api.inspect().journal.stage, 'RESERVED');
  });
  assert.equal(f.read().mailboxRotation, undefined);
});
test('fixture filesystem/fault factory is unavailable outside the Node test process', () => {
  const url = new URL('./canonical-mailbox-rotation-transaction-v2.mjs', import.meta.url).href;
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {withMailboxRotationTransactionTestJournalV2 as run} from ${JSON.stringify(url)};\n`
    + `try {run('/must-not-be-created',()=>{});process.exitCode=1;}catch(e){if(e.message!=='TEST_TRANSACTION_STORE_NOT_ADMITTED')process.exitCode=2;}`],
  { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
});
