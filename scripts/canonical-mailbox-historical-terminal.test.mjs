import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HISTORICAL_TERMINAL_TARGETS, HISTORICAL_TERMINAL_ATTESTATION_VERDICT,
  attestHistoricalMailboxTerminal, inspectHistoricalMailboxTerminal, historicalTerminalDigest, historicalTerminalTextSha256,
  validateHistoricalTerminalAttestation, projectHistoricalTerminalAttestation,
} from '../shared/agents/mailboxHistoricalTerminalAttestationV1.mjs';
import { auditMailboxRotationComments } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { readMailboxReceipt, createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson } from './battle-bridge-github-command-mailbox.mjs';
import { createWindowsSafeMailboxReceiptFilename } from '../shared/agents/windowsSafeMailboxReceiptFilename.mjs';

const repository = 'Cheekyfellastef/stephan-os', fence = String.fromCharCode(96).repeat(3);
const head = 'a'.repeat(40), observedAt = '2026-11-20T18:00:02.000Z';
const originals = JSON.parse(readFileSync(new URL('../tests/fixtures/canonical-mailbox-rotation/historical-command-comments.json', import.meta.url), 'utf8'));
const targets = HISTORICAL_TERMINAL_TARGETS;
function command(target = targets[0], suffix = 'one') {
  return { schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'mailbox-terminal-proof-read-' + suffix, operation: 'READ_MAILBOX_RECEIPT',
    repository, issueNumber: 3258, branch: 'main', operatorApproval: 'operator-approved',
    expectedHead: head, expiresAt: '2026-11-20T18:05:00.000Z', targetRequestId: target.requestId };
}
function ledger(target = targets[0], state = 'BLOCKED') {
  return { schemaVersion: 'stephanos.mailbox-execution-ledger-entry.v1', requestId: target.requestId,
    issueNumber: 3258, phase: 'TERMINAL', commandDigest: target.normalizedCommandDigest, terminalState: state };
}
function unidentified(target = targets[0], state = 'ACCEPTED') {
  return { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1', requestId: '',
    repository, issueNumber: 3258, branch: 'main', operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    expectedHead: target.originalExpectedHead, processSourceHead: target.originalExpectedHead,
    state, result: { requestId: '' }, acceptedAt: '1999-01-01T00:00:00.000Z',
    blocker: 'UNIDENTIFIED_PAYLOAD_MUST_NOT_BE_RECONSTRUCTED' };
}
const identity = () => ({ ok: true, sourceHead: head, expectedHead: head, branch: 'main', expectedHeadMatch: true });
function proof(target = targets[0], { state = 'BLOCKED', suffix = 'one', readCommentId = 8000000001, ...patch } = {}) {
  return attestHistoricalMailboxTerminal({ command: command(target, suffix), identity: identity(),
    processSourceHead: head, readCommentId, unidentifiedReceipt: unidentified(target),
    readLedger: () => ledger(target, state), now: () => observedAt, ...patch });
}
function ownerComment(value, id, receipt = false, created = '2026-11-20T18:00:00Z') {
  return { id, user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' }, author_association: 'OWNER',
    issue_url: 'https://api.github.com/repos/' + repository + '/issues/3258',
    html_url: 'https://github.com/' + repository + '/issues/3258#issuecomment-' + id,
    created_at: created, updated_at: created,
    body: (receipt ? '<!-- stephanos-battle-bridge-command-receipt -->\n' + fence + 'json' : fence + 'stephanos-battle-bridge-command')
      + '\n' + JSON.stringify(value) + '\n' + fence };
}
function terminalReceipt(readCommand, attestation, operationResult = {}) {
  return { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: readCommand.requestId, operation: readCommand.operation, repository, issueNumber: 3258,
    branch: 'main', state: 'DONE', expectedHead: readCommand.expectedHead, processSourceHead: readCommand.expectedHead,
    acceptedAt: '2026-11-20T18:00:01.000Z', completedAt: '2026-11-20T18:00:03.000Z',
    proofRefs: ['https://github.com/' + repository + '/issues/3258#issuecomment-' + attestation.readCommentId,
      'receipts/github-command-mailbox/' + readCommand.requestId + '.json'],
    result: { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', operation: readCommand.operation,
      requestId: readCommand.requestId, result: { ...identity(), finalVerdict: HISTORICAL_TERMINAL_ATTESTATION_VERDICT,
        historicalTerminalAttestation: attestation, ...operationResult } } };
}
function chain(target = targets[0], options = {}) {
  const read = command(target, options.suffix || 'one'), attestation = proof(target, options);
  const publicReceipt = JSON.parse(serializeBoundedReceiptJson(terminalReceipt(read, attestation)));
  return [structuredClone(originals.find(original => original.id === target.originalCommentId)),
    ownerComment(read, options.readCommentId || 8000000001),
    ownerComment(publicReceipt, (options.readCommentId || 8000000001) + 1, true, '2026-11-20T18:00:04Z')];
}
const audit = comments => auditMailboxRotationComments(comments, { issueNumber: 3258, barrierCommentId: 7044786171 });
const parsed = comment => JSON.parse(comment.body.match(/(?:command|json)\s*\n([\s\S]*?)\n\x60\x60\x60/)[1]);
function mutateReceipt(comments, mutate) {
  const result = structuredClone(comments), value = parsed(result[2]);
  mutate(value);
  result[2] = { ...result[2], body: '<!-- stephanos-battle-bridge-command-receipt -->\n' + fence + 'json\n'
    + JSON.stringify(value) + '\n' + fence };
  return result;
}

test('fixed historical bodies, target hashes and admitted command digests match original evidence', () => {
  for (const target of targets) {
    const original = originals.find(comment => comment.id === target.originalCommentId);
    assert.equal(historicalTerminalTextSha256(original.body), target.originalCommentBodySha256);
    assert.equal(historicalTerminalTextSha256(target.requestId), target.targetRequestSha256);
    // Historical-source reproduction proves these exact two normalized commands
    // have unchanged values: no base defaults are added by the custom selector.
    assert.equal(historicalTerminalDigest(parsed(original)), target.normalizedCommandDigest);
    assert.notEqual(historicalTerminalDigest(target.requestId), target.targetRequestSha256);
  }
});
test('native proof attests only exact terminal ledger state and never copies unidentified history', () => {
  for (const target of targets) for (const state of ['DONE', 'BLOCKED']) {
    const result = proof(target, { state });
    assert.equal(result.terminalState, state);
    for (const key of ['originalCompletionTimeKnown', 'originalReceiptReconstructed', 'replayPerformed', 'ledgerMutationPerformed'])
      assert.equal(result[key], false);
    assert.ok(validateHistoricalTerminalAttestation(result));
    for (const text of [target.requestId, '1999-01-01', 'UNIDENTIFIED_PAYLOAD'])
      assert.equal(JSON.stringify(result).includes(text), false);
  }
});
for (const [name, change] of Object.entries({
  absent: () => null, imported: value => ({ ...value, commandDigest: '' }),
  reserved: value => ({ ...value, phase: 'RESERVED' }), retired: value => ({ ...value, phase: 'RETIRED' }),
  missingTerminalState: value => { delete value.terminalState; return value; },
  otherIdentity: value => ({ ...value, requestId: targets[1].requestId }),
  otherIssue: value => ({ ...value, issueNumber: 3552 }),
  otherDigest: value => ({ ...value, commandDigest: 'f'.repeat(64) }),
  otherSchema: value => ({ ...value, schemaVersion: 'invented' }),
  unknownState: value => ({ ...value, terminalState: 'UNKNOWN' }),
  extraAuthority: value => ({ ...value, controlTowerObservation: {} }),
  invalidOptionalProof: value => ({ ...value, terminalProofHash: '' }),
})) test('native holds on ledger ' + name, () => {
  assert.equal(proof(targets[0], { readLedger: () => change(ledger()) }), null);
});
test('native holds on changed ledger, read failure, conflicting receipt and source mismatch', () => {
  let reads = 0;
  assert.equal(proof(targets[0], { readLedger: () => ledger(targets[0], ++reads === 1 ? 'DONE' : 'BLOCKED') }), null);
  assert.equal(proof(targets[0], { readLedger: () => { throw Error('unsafe file'); } }), null);
  for (const receipt of [{ ...unidentified(), requestId: targets[1].requestId }, { ...unidentified(), state: 'DONE' },
    { ...unidentified(), result: { requestId: 'another-request-0001' } },
    { ...unidentified(), expectedHead: 'b'.repeat(40) }])
    assert.equal(proof(targets[0], { unidentifiedReceipt: receipt }), null);
  for (const patch of [{ processSourceHead: 'b'.repeat(40) }, { readCommentId: 0 },
    { identity: { ...identity(), expectedHeadMatch: false } },
    { command: { ...command(), targetRequestId: 'unrelated-historical-001' } },
    { now: () => '2026-11-20T19:00:00.000Z' }]) assert.equal(proof(targets[0], patch), null);
});
test('actual READ filesystem path returns typed evidence without writes or ledger changes', async t => {
  const root = mkdtempSync(join(tmpdir(), 'historical-mailbox-read-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const target of targets) {
    const path = join(root, createWindowsSafeMailboxReceiptFilename(target.requestId));
    const bytes = JSON.stringify(unidentified(target)); writeFileSync(path, bytes);
    const record = Object.freeze(ledger(target)); let reads = 0;
    const options = { receiptRoot: root, readSourceIdentity: async () => identity(),
      processSourceHead: head, readCommentId: 8000000001, now: () => observedAt };
    const result = await readMailboxReceipt(command(target), { ...options,
      readExecutionLedger: id => { assert.equal(id, target.requestId); reads++; return record; } });
    assert.equal(result.ok, true); assert.equal(result.finalVerdict, HISTORICAL_TERMINAL_ATTESTATION_VERDICT);
    assert.equal(result.receipt, undefined); assert.equal(result.targetRequestId, undefined); assert.equal(reads, 2);
    assert.equal(readFileSync(path, 'utf8'), bytes); assert.deepEqual(record, ledger(target));
    const absent = await readMailboxReceipt(command(target), { ...options, readExecutionLedger: () => null });
    assert.equal(absent.ok, false); assert.equal(absent.blocker, 'MAILBOX_HISTORICAL_LEDGER_NOT_FOUND');
  }
});
test('real projection, full serializer and forced compaction preserve exact safe evidence', () => {
  const attestation = proof(), read = command(), raw = terminalReceipt(read, attestation);
  const sanitized = createSanitizedMailboxReceiptProjection(raw);
  assert.deepEqual(sanitized.operationResult.historicalTerminalAttestation, attestation);
  const full = JSON.parse(serializeBoundedReceiptJson(raw, 256 * 1024));
  assert.deepEqual(full.result.result.historicalTerminalAttestation, attestation);
  assert.equal(full.proofRefs.some(ref => ref.startsWith('https:')), false);
  const large = terminalReceipt(read, attestation, { blockers: Array(30).fill('X'.repeat(200)) });
  const compact = JSON.parse(serializeBoundedReceiptJson(large));
  assert.equal(compact.githubProjectionTruncated, true);
  assert.deepEqual(compact.result.result.historicalTerminalAttestation, attestation);
  assert.deepEqual(JSON.parse(serializeBoundedReceiptJson(compact)).result.result.historicalTerminalAttestation, attestation);
  for (const value of [sanitized, full, compact]) assert.equal(JSON.stringify(value).includes(targets[0].requestId), false);
});
test('real serialized public receipt with only safe relative proofRefs clears exactly one original', () => {
  for (const target of targets) {
    const comments = chain(target);
    assert.deepEqual(parsed(comments[2]).proofRefs, ['receipts/github-command-mailbox/mailbox-terminal-proof-read-one.json']);
    const result = audit([...comments, ...originals.filter(original => original.id !== target.originalCommentId)]);
    assert.ok(result.terminalIds.includes(target.requestId));
    assert.deepEqual(result.pendingBeforeBarrier, targets.filter(other => other !== target).map(other => other.requestId));
  }
});
test('original requests stay pending without both authenticated READ command and DONE evidence', () => {
  const comments = chain();
  for (const subset of [[comments[0]], [comments[0], comments[1]], [comments[0], comments[2]]])
    assert.deepEqual(audit(subset).pendingBeforeBarrier, [targets[0].requestId]);
  assert.deepEqual(audit(originals).pendingBeforeBarrier, targets.map(target => target.requestId));
});
for (const [name, mutate] of Object.entries({
  outerHead: value => { value.expectedHead = 'b'.repeat(40); },
  processHead: value => { value.processSourceHead = 'b'.repeat(40); },
  outerOperation: value => { value.operation = 'READ_DEPLOYMENT_STATUS'; },
  outerBlocked: value => { value.state = 'BLOCKED'; },
  innerFailure: value => { value.result.result.ok = false; },
  executionIdentity: value => { value.result.requestId = 'another-read-001'; },
  sourceHead: value => { value.result.result.sourceHead = 'b'.repeat(40); },
  copiedPayload: value => { value.result.result.receipt = { requestId: targets[0].requestId }; },
  falseMatch: value => { value.result.result.expectedHeadMatch = false; },
  wrongConfig: value => { value.result.result.historicalTerminalAttestation.configSha256 = 'f'.repeat(64); },
  wrongTarget: value => { value.result.result.historicalTerminalAttestation.targetRequestSha256 = targets[1].targetRequestSha256; },
  wrongReadComment: value => { value.result.result.historicalTerminalAttestation.readCommentId++; },
  staleProof: value => { value.result.result.historicalTerminalAttestation.proofHash = 'f'.repeat(64); },
  inventedCompletion: value => { value.result.result.historicalTerminalAttestation.originalCompletionTimeKnown = true; },
  inventedField: value => { value.result.result.historicalTerminalAttestation.authorityGranted = true; },
  observationAfterCompletion: value => { value.completedAt = '2026-11-20T18:00:01.000Z'; },
})) test('audit holds on ' + name, () => {
  assert.deepEqual(audit(mutateReceipt(chain(), mutate)).pendingBeforeBarrier, [targets[0].requestId]);
});
test('strict owner metadata, immutable bodies, exact target and unique command identity are required', () => {
  for (const index of [0, 1, 2]) for (const mutate of [
    comment => { comment.user.id++; }, comment => { comment.user.type = 'Bot'; },
    comment => { comment.author_association = 'MEMBER'; },
    comment => { comment.issue_url = 'https://api.github.com/repos/' + repository + '/issues/3552'; },
    comment => { comment.updated_at = '2026-11-20T19:00:00Z'; }, comment => { comment.html_url += '-wrong'; },
  ]) {
    const comments = chain(); mutate(comments[index]);
    assert.equal(audit(comments).terminalIds.includes(targets[0].requestId), false);
  }
  const changedOriginal = chain(); changedOriginal[0].body += '\n';
  assert.deepEqual(audit(changedOriginal).pendingBeforeBarrier, [targets[0].requestId]);
  const wrongRead = chain(); wrongRead[1] = ownerComment({ ...command(), targetRequestId: targets[1].requestId }, 8000000001);
  assert.deepEqual(audit(wrongRead).pendingBeforeBarrier, [targets[0].requestId]);
  const duplicate = chain(); duplicate.push(ownerComment(command(), 8000000010));
  assert.deepEqual(audit(duplicate).pendingBeforeBarrier, [targets[0].requestId]);
});
test('duplicate publication is idempotent; conflicting claims within or across READs hold', () => {
  const first = chain(), duplicate = structuredClone(first[2]);
  duplicate.id++; duplicate.html_url = duplicate.html_url.replace(/8000000002$/, '8000000003');
  assert.equal(audit([...first, duplicate]).terminalIds.includes(targets[0].requestId), true);
  const conflicting = chain(targets[0], { state: 'DONE', suffix: 'two', readCommentId: 8000000011 });
  assert.deepEqual(audit([...first, ...conflicting.slice(1)]).pendingBeforeBarrier, [targets[0].requestId]);
  const second = chain(targets[0], { suffix: 'two', readCommentId: 8000000011 });
  assert.equal(audit([...first, ...second.slice(1)]).terminalIds.includes(targets[0].requestId), true);
  const failed = ownerComment({ ...parsed(first[2]), state: 'BLOCKED' }, 8000000003, true, '2026-11-20T18:00:05Z');
  assert.deepEqual(audit([...first, failed]).pendingBeforeBarrier, [targets[0].requestId]);
});
test('earlier ordinary failed READs do not invalidate a later authenticated attestation', () => {
  const comments = chain(), earlier = command(targets[0], 'earlier');
  const failed = { schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: earlier.requestId, operation: earlier.operation, repository, issueNumber: 3258,
    branch: 'main', state: 'BLOCKED', expectedHead: head, blocker: 'MAILBOX_RECEIPT_ID_MISMATCH' };
  assert.equal(audit([...comments, ownerComment(earlier, 7999999998),
    ownerComment(failed, 7999999999, true)]).terminalIds.includes(targets[0].requestId), true);
});
test('typed projection drops claims with a source or operation mismatch', () => {
  const raw = terminalReceipt(command(), proof());
  for (const patch of [{ expectedHead: 'b'.repeat(40) }, { processSourceHead: '' }, { operation: 'READ_DEPLOYMENT_STATUS' }])
    assert.deepEqual(projectHistoricalTerminalAttestation(raw.result.result, { ...raw, ...patch }), {});
});

test('a malformed competing READ result holds instead of crashing the inventory', () => {
  const comments = chain();
  const malformed = ownerComment({ ...parsed(comments[2]), result: { result: null } },
    8000000003, true, '2026-11-20T18:00:05Z');
  assert.deepEqual(audit([...comments, malformed]).pendingBeforeBarrier, [targets[0].requestId]);
  assert.deepEqual(projectHistoricalTerminalAttestation(null, null), {});
});

function diagnostic(patch = {}) {
  return inspectHistoricalMailboxTerminal({ command: command(), identity: identity(),
    processSourceHead: head, readCommentId: 8000000001, unidentifiedReceipt: unidentified(),
    readLedger: () => ledger(), now: () => observedAt, ...patch });
}
test('known-target diagnostic codes distinguish every failed ledger predicate without exposing records', () => {
  const cases = [
    ['LEDGER_NOT_FOUND', () => null],
    ['LEDGER_INVALID', () => ({ ...ledger(), schemaVersion: 'untrusted' })],
    ['LEDGER_IDENTITY_MISMATCH', () => ({ ...ledger(), requestId: targets[1].requestId })],
    ['LEDGER_IDENTITY_MISMATCH', () => ({ ...ledger(), issueNumber: 3552 })],
    ['LEDGER_IMPORTED_WITHOUT_DIGEST', () => ({ ...ledger(), commandDigest: '' })],
    ['LEDGER_COMMAND_DIGEST_MISMATCH', () => ({ ...ledger(), commandDigest: 'f'.repeat(64) })],
    ['LEDGER_RESERVED', () => ({ ...ledger(), phase: 'RESERVED' })],
    ['LEDGER_RETIRED', () => ({ ...ledger(), phase: 'RETIRED' })],
    ['LEDGER_NOT_TERMINAL', () => ({ ...ledger(), phase: 'UNKNOWN' })],
    ['LEDGER_TERMINAL_STATE_UNPROVEN', () => { const value = ledger(); delete value.terminalState; return value; }],
    ['LEDGER_INVALID', () => ({ ...ledger(), privatePayload: 'must-not-escape' })],
    ['LEDGER_INVALID', () => ({ ...ledger(), terminalProofHash: '' })],
    ['EVIDENCE_READ_FAILED', () => { throw Error('private-path-or-credential-must-not-escape'); }],
  ];
  for (const [suffix, readLedger] of cases) {
    const result = diagnostic({ readLedger });
    assert.deepEqual(result, { attestation: null, blocker: 'MAILBOX_HISTORICAL_' + suffix });
    assert.equal(JSON.stringify(result).includes('must-not-escape'), false);
    assert.equal(JSON.stringify(result).includes(targets[0].requestId), false);
  }
  let reads = 0;
  assert.deepEqual(diagnostic({ readLedger: () => ++reads === 1 ? ledger() : null }),
    { attestation: null, blocker: 'MAILBOX_HISTORICAL_LEDGER_UNSTABLE' });
});
test('diagnostics preserve admission, receipt conflict, expiry and unknown-target holds', () => {
  for (const [patch, suffix] of [
    [{ processSourceHead: 'b'.repeat(40) }, 'READ_BINDING_INVALID'],
    [{ unidentifiedReceipt: { ...unidentified(), requestId: 'another-request-0001' } }, 'RECEIPT_IDENTITY_CONFLICT'],
    [{ unidentifiedReceipt: unidentified(targets[0], 'DONE') }, 'RECEIPT_STATE_CONFLICT'],
    [{ now: () => '2026-11-20T19:00:00.000Z' }, 'READ_EXPIRED'],
  ]) assert.deepEqual(diagnostic(patch), { attestation: null, blocker: 'MAILBOX_HISTORICAL_' + suffix });
  let ledgerReads = 0;
  const unknown = diagnostic({ command: { ...command(), targetRequestId: 'unrelated-historical-001' },
    readLedger: () => { ledgerReads++; return ledger(); } });
  assert.deepEqual(unknown, { attestation: null, blocker: '' });
  assert.equal(ledgerReads, 0);
  assert.equal(diagnostic().blocker, '');
  assert.deepEqual(diagnostic().attestation, proof());
});
test('actual failed READ retains only its typed blocker through full and compact public serialization', async t => {
  const root = mkdtempSync(join(tmpdir(), 'historical-mailbox-diagnostic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const target of targets) {
    const cmd = command(target);
    const path = join(root, createWindowsSafeMailboxReceiptFilename(target.requestId));
    const bytes = JSON.stringify(unidentified(target)); writeFileSync(path, bytes);
    const result = await readMailboxReceipt(cmd, { receiptRoot: root,
      readSourceIdentity: async () => identity(), processSourceHead: head, readCommentId: 8000000001,
      readExecutionLedger: () => ({ ...ledger(target), phase: 'RESERVED' }), now: () => observedAt });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'MAILBOX_HISTORICAL_LEDGER_RESERVED');
    assert.equal(result.historicalTerminalAttestation, undefined);
    const raw = terminalReceipt(cmd, proof(target));
    raw.state = 'BLOCKED'; raw.blocker = result.blocker;
    raw.result = { ok: false, verdict: 'COMMAND_EXECUTION_BLOCKED',
      requestId: cmd.requestId, operation: cmd.operation, result };
    const projected = createSanitizedMailboxReceiptProjection(raw);
    assert.equal(projected.blocker, result.blocker);
    assert.equal(projected.operationResult.blocker, result.blocker);
    for (const large of [false, true]) {
      const value = structuredClone(raw);
      if (large) value.result.result.blockers = Array(30).fill('X'.repeat(200));
      const serialized = JSON.parse(serializeBoundedReceiptJson(value, large ? 9 * 1024 : 256 * 1024));
      assert.equal(serialized.blocker, result.blocker);
      assert.equal(serialized.result.result.blocker, result.blocker);
      assert.equal(serialized.result.result.historicalTerminalAttestation, undefined);
      if (large) assert.equal(serialized.githubProjectionTruncated, true);
      const comments = [originals.find(original => original.id === target.originalCommentId),
        ownerComment(cmd, 8000000001), ownerComment(serialized, 8000000002, true, '2026-11-20T18:00:04Z')];
      assert.deepEqual(audit(comments).pendingBeforeBarrier, [target.requestId]);
      assert.equal(JSON.stringify(serialized).includes(target.requestId), false);
    }
    assert.equal(readFileSync(path, 'utf8'), bytes);
  }
  const unrelated = { ...command(), targetRequestId: 'unrelated-historical-001' };
  writeFileSync(join(root, createWindowsSafeMailboxReceiptFilename(unrelated.targetRequestId)), JSON.stringify(unidentified()));
  const ordinary = await readMailboxReceipt(unrelated, { receiptRoot: root, readSourceIdentity: async () => identity(),
    readExecutionLedger: () => { throw Error('unknown target must not read ledger'); } });
  assert.equal(ordinary.blocker, 'MAILBOX_RECEIPT_ID_MISMATCH');
});
