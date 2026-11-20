import { createHash } from 'node:crypto';

// A fixed migration for two original commands whose public/private receipt
// projection erased identity. This contract never authorizes execution,
// reconstructs an unidentified receipt, or changes an execution-ledger entry.
const repository = 'Cheekyfellastef/stephan-os';
const owner = 'Cheekyfellastef';
const ownerId = 267490109;
const originalIssue = 3258;
const originalOperation = 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION';
const ledgerSchema = 'stephanos.mailbox-execution-ledger-entry.v1';
const readOperation = 'READ_MAILBOX_RECEIPT';
export const HISTORICAL_TERMINAL_ATTESTATION_SCHEMA = 'stephanos.mailbox-historical-terminal-attestation.v1';
export const HISTORICAL_TERMINAL_ATTESTATION_VERDICT = 'MAILBOX_HISTORICAL_TERMINAL_ATTESTED';
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const terminal = value => value === 'DONE' || value === 'BLOCKED';
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const historicalTerminalDigest = value =>
  createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const historicalTerminalTextSha256 = value =>
  createHash('sha256').update(String(value), 'utf8').digest('hex');

export const HISTORICAL_TERMINAL_TARGETS = Object.freeze([
  Object.freeze({
    requestId: 'openclaw-topstack-nonsecret-status-20261104-01',
    targetRequestSha256: '7c6bbdfcb0226fdc971bf6dae95dccd1b5daf845fe24de4989242db3effc9c75',
    originalCommentId: 6629817255,
    originalCommentBodySha256: '30f7bf2917c3317b142267da8eb4b6f69f22ca2f9c57fd65a4be52b3dc33e0f5',
    originalExpectedHead: '1d8546ae4fd5980970dc16d0f95afe2e4dd89a15',
    normalizedCommandDigest: '1fc3675f2841d7fb9cf566c756167befae759268187a145198579d17edf1c1ed',
    originalCreatedAt: '2026-11-04T11:49:10Z',
  }),
  Object.freeze({
    requestId: 'vr2707-20261105T1953Z-cf7-archive-single-session-v1',
    targetRequestSha256: '26bbabe9f1aea16102b31da4942c87ea98cc5e3680f0db45eb3faf299b0135f3',
    originalCommentId: 6667748867,
    originalCommentBodySha256: 'd17f9648d1d89fcb6870aaed0e1ea822706250c48bb70327fe5b5143aabbbb3a',
    originalExpectedHead: 'cf7cd85b7afa96a696fd092b1ceb2e734f198a77',
    normalizedCommandDigest: 'f7dcdce00eac8e109bdd41d56740a248694056d5b6bb587db72c0c8105902fe6',
    originalCreatedAt: '2026-11-05T19:52:06Z',
  }),
]);
export const HISTORICAL_TERMINAL_CONFIG_SHA256 = historicalTerminalDigest({
  schemaVersion: HISTORICAL_TERMINAL_ATTESTATION_SCHEMA, repository, owner, ownerId,
  originalIssue, originalOperation, targets: HISTORICAL_TERMINAL_TARGETS,
});
const targetForId = id => HISTORICAL_TERMINAL_TARGETS.find(target => target.requestId === id);
const readFields = ['schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber',
  'branch', 'operatorApproval', 'expectedHead', 'expiresAt', 'targetRequestId'];
const exactKeys = (value, fields) => object(value) && Object.keys(value).length === fields.length
  && fields.every(key => Object.hasOwn(value, key));
const readIdentity = command => Object.fromEntries(readFields.map(key => [key, command?.[key]]));
function validReadCommand(command, target) {
  return command?.schemaVersion === 'stephanos.battle-bridge-github-command.v1'
    && requestIdPattern.test(command.requestId || '') && !targetForId(command.requestId)
    && command.operation === readOperation && command.repository === repository
    && command.issueNumber === originalIssue && command.branch === 'main'
    && command.operatorApproval === 'operator-approved' && sha(command.expectedHead)
    && command.targetRequestId === target.requestId && Number.isFinite(Date.parse(command.expiresAt));
}
function ledgerProjection(record, target) {
  const fields = ['schemaVersion', 'requestId', 'issueNumber', 'phase', 'commandDigest', 'terminalState'];
  if (Object.hasOwn(record || {}, 'terminalProofHash')) fields.push('terminalProofHash');
  if (!exactKeys(record, fields) || record.schemaVersion !== ledgerSchema
    || record.requestId !== target.requestId || record.issueNumber !== originalIssue
    || record.phase !== 'TERMINAL' || record.commandDigest !== target.normalizedCommandDigest
    || !terminal(record.terminalState)
    || (Object.hasOwn(record, 'terminalProofHash') && !hash(record.terminalProofHash))) return null;
  return record;
}
const proofFields = ['schemaVersion', 'configSha256', 'targetRequestSha256', 'originalIssueNumber',
  'originalCommentId', 'originalCommentBodySha256', 'originalOperation', 'originalExpectedHead',
  'normalizationSourceHead', 'normalizedCommandDigest', 'ledgerSchemaVersion', 'ledgerPhase',
  'terminalState', 'ledgerRecordSha256', 'ledgerTerminalProofHash', 'readRequestId', 'readCommentId',
  'readCommandDigest', 'observerSourceHead', 'observedAt', 'originalCompletionTimeKnown',
  'originalReceiptReconstructed', 'replayPerformed', 'ledgerMutationPerformed', 'proofHash'];

// The source identity and original canonical ledger reader are trusted internal
// dependencies, never caller-selected paths, records or proof fields.
export function inspectHistoricalMailboxTerminal({
  command, identity, processSourceHead, readCommentId, unidentifiedReceipt, readLedger, now = () => new Date(),
} = {}) {
  const held = blocker => Object.freeze({ attestation: null, blocker });
  const target = targetForId(command?.targetRequestId);
  if (!target) return held('');
  if (!validReadCommand(command, target) || typeof readLedger !== 'function'
    || !Number.isSafeInteger(readCommentId) || readCommentId <= target.originalCommentId
    || identity?.ok !== true || identity.branch !== 'main' || identity.expectedHeadMatch !== true
    || identity.expectedHead !== command.expectedHead || identity.sourceHead !== command.expectedHead
    || processSourceHead !== command.expectedHead) return held('MAILBOX_HISTORICAL_READ_BINDING_INVALID');
  // A conflicting nonempty identity is not an erased historical identity.
  if (unidentifiedReceipt?.requestId !== ''
    || (unidentifiedReceipt.result?.requestId !== undefined && unidentifiedReceipt.result.requestId !== '')
    || unidentifiedReceipt.schemaVersion !== 'stephanos.battle-bridge-github-command-receipt.v1'
    || unidentifiedReceipt.repository !== repository || unidentifiedReceipt.issueNumber !== originalIssue
    || unidentifiedReceipt.branch !== 'main' || unidentifiedReceipt.operation !== originalOperation
    || unidentifiedReceipt.expectedHead !== target.originalExpectedHead
    || !['ACCEPTED', 'DONE', 'BLOCKED'].includes(unidentifiedReceipt.state))
    return held('MAILBOX_HISTORICAL_RECEIPT_IDENTITY_CONFLICT');
  try {
    const before = readLedger(target.requestId);
    if (before == null) return held('MAILBOX_HISTORICAL_LEDGER_NOT_FOUND');
    if (!object(before) || before.schemaVersion !== ledgerSchema)
      return held('MAILBOX_HISTORICAL_LEDGER_INVALID');
    if (before.requestId !== target.requestId || before.issueNumber !== originalIssue)
      return held('MAILBOX_HISTORICAL_LEDGER_IDENTITY_MISMATCH');
    if (before.commandDigest === '') return held('MAILBOX_HISTORICAL_LEDGER_IMPORTED_WITHOUT_DIGEST');
    if (before.commandDigest !== target.normalizedCommandDigest)
      return held('MAILBOX_HISTORICAL_LEDGER_COMMAND_DIGEST_MISMATCH');
    if (before.phase === 'RESERVED') return held('MAILBOX_HISTORICAL_LEDGER_RESERVED');
    if (before.phase === 'RETIRED') return held('MAILBOX_HISTORICAL_LEDGER_RETIRED');
    if (before.phase !== 'TERMINAL') return held('MAILBOX_HISTORICAL_LEDGER_NOT_TERMINAL');
    if (!terminal(before.terminalState)) return held('MAILBOX_HISTORICAL_LEDGER_TERMINAL_STATE_UNPROVEN');
    const record = ledgerProjection(before, target);
    if (!record) return held('MAILBOX_HISTORICAL_LEDGER_INVALID');
    // The malformed receipt supplies no authority. Only reject a contradiction;
    // never recover its timestamps, payload, native result, or blocker.
    if (terminal(unidentifiedReceipt.state) && unidentifiedReceipt.state !== record.terminalState)
      return held('MAILBOX_HISTORICAL_RECEIPT_STATE_CONFLICT');
    const recordHash = historicalTerminalDigest(record);
    const after = readLedger(target.requestId);
    if (!ledgerProjection(after, target) || historicalTerminalDigest(after) !== recordHash)
      return held('MAILBOX_HISTORICAL_LEDGER_UNSTABLE');
    const observedAt = new Date(now()).toISOString();
    if (Date.parse(observedAt) > Date.parse(command.expiresAt)) return held('MAILBOX_HISTORICAL_READ_EXPIRED');
    const proof = {
      schemaVersion: HISTORICAL_TERMINAL_ATTESTATION_SCHEMA,
      configSha256: HISTORICAL_TERMINAL_CONFIG_SHA256,
      targetRequestSha256: target.targetRequestSha256,
      originalIssueNumber: originalIssue,
      originalCommentId: target.originalCommentId,
      originalCommentBodySha256: target.originalCommentBodySha256,
      originalOperation,
      originalExpectedHead: target.originalExpectedHead,
      normalizationSourceHead: target.originalExpectedHead,
      normalizedCommandDigest: target.normalizedCommandDigest,
      ledgerSchemaVersion: ledgerSchema,
      ledgerPhase: 'TERMINAL',
      terminalState: record.terminalState,
      ledgerRecordSha256: recordHash,
      ledgerTerminalProofHash: record.terminalProofHash || '',
      readRequestId: command.requestId,
      readCommentId,
      readCommandDigest: historicalTerminalDigest(readIdentity(command)),
      observerSourceHead: processSourceHead,
      observedAt,
      originalCompletionTimeKnown: false,
      originalReceiptReconstructed: false,
      replayPerformed: false,
      ledgerMutationPerformed: false,
    };
    return Object.freeze({ attestation: Object.freeze({ ...proof, proofHash: historicalTerminalDigest(proof) }), blocker: '' });
  } catch {
    return held('MAILBOX_HISTORICAL_EVIDENCE_READ_FAILED');
  }
}

// Preserve the existing proof-or-null API. Diagnostics are finite non-authority
// codes on the two known-target reads, never raw records, paths or exceptions.
export function attestHistoricalMailboxTerminal(options = {}) {
  return inspectHistoricalMailboxTerminal(options).attestation;
}

export function validateHistoricalTerminalAttestation(value) {
  if (!exactKeys(value, proofFields)) return null;
  const target = HISTORICAL_TERMINAL_TARGETS.find(entry => entry.targetRequestSha256 === value.targetRequestSha256);
  if (!target || value.schemaVersion !== HISTORICAL_TERMINAL_ATTESTATION_SCHEMA
    || value.configSha256 !== HISTORICAL_TERMINAL_CONFIG_SHA256
    || value.originalIssueNumber !== originalIssue || value.originalCommentId !== target.originalCommentId
    || value.originalCommentBodySha256 !== target.originalCommentBodySha256
    || value.originalOperation !== originalOperation || value.originalExpectedHead !== target.originalExpectedHead
    || value.normalizationSourceHead !== target.originalExpectedHead
    || value.normalizedCommandDigest !== target.normalizedCommandDigest
    || value.ledgerSchemaVersion !== ledgerSchema || value.ledgerPhase !== 'TERMINAL'
    || !terminal(value.terminalState) || !hash(value.ledgerRecordSha256)
    || !(value.ledgerTerminalProofHash === '' || hash(value.ledgerTerminalProofHash))
    || !requestIdPattern.test(value.readRequestId || '') || targetForId(value.readRequestId)
    || !Number.isSafeInteger(value.readCommentId) || value.readCommentId <= target.originalCommentId
    || !hash(value.readCommandDigest) || !sha(value.observerSourceHead)
    || typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt))
    || new Date(value.observedAt).toISOString() !== value.observedAt
    || value.originalCompletionTimeKnown !== false || value.originalReceiptReconstructed !== false
    || value.replayPerformed !== false || value.ledgerMutationPerformed !== false) return null;
  const record = { schemaVersion: ledgerSchema, requestId: target.requestId, issueNumber: originalIssue,
    phase: 'TERMINAL', commandDigest: target.normalizedCommandDigest, terminalState: value.terminalState,
    ...(value.ledgerTerminalProofHash ? { terminalProofHash: value.ledgerTerminalProofHash } : {}) };
  const { proofHash, ...proof } = value;
  if (historicalTerminalDigest(record) !== value.ledgerRecordSha256
    || !hash(proofHash) || historicalTerminalDigest(proof) !== proofHash) return null;
  return Object.freeze({ ...value });
}

// Reprojection is lossless only for this exact typed READ result. Unknown
// fields and incomplete/native-unbound claims disappear rather than improve.
export function projectHistoricalTerminalAttestation(operationResult = {}, receipt = {}) {
  if (!object(operationResult) || !object(receipt)) return {};
  const proof = validateHistoricalTerminalAttestation(operationResult.historicalTerminalAttestation);
  if (!proof || receipt.operation !== readOperation || receipt.requestId !== proof.readRequestId
    || receipt.expectedHead !== proof.observerSourceHead || receipt.processSourceHead !== proof.observerSourceHead
    || operationResult.ok !== true || operationResult.finalVerdict !== HISTORICAL_TERMINAL_ATTESTATION_VERDICT
    || operationResult.sourceHead !== proof.observerSourceHead || operationResult.branch !== 'main'
    || operationResult.expectedHeadMatch !== true || operationResult.expectedHead !== proof.observerSourceHead
    || operationResult.receipt != null) return {};
  return { historicalTerminalAttestation: proof };
}
function immutableOwnerComment(entry) {
  const comment = entry?.comment;
  return object(comment) && comment.user?.login === owner && Number.isSafeInteger(comment.id) && comment.id > 0
    && comment.user.id === ownerId && comment.user.type === 'User' && comment.author_association === 'OWNER'
    && comment.issue_url === 'https://api.github.com/repos/' + repository + '/issues/' + originalIssue
    && comment.id === entry.commentId && comment.html_url === entry.commentUrl
    && comment.html_url === 'https://github.com/' + repository + '/issues/' + originalIssue + '#issuecomment-' + comment.id
    && typeof comment.body === 'string' && Buffer.byteLength(comment.body, 'utf8') <= 64000
    && Number.isFinite(Date.parse(comment.created_at)) && comment.created_at === comment.updated_at;
}
function qualifyingReadReceipt(entry, read, target) {
  const receipt = entry.value, result = receipt?.result, inner = result?.result;
  const proof = projectHistoricalTerminalAttestation(inner, receipt).historicalTerminalAttestation;
  if (!proof || !immutableOwnerComment(entry) || receipt.state !== 'DONE'
    || receipt.repository !== repository || receipt.issueNumber !== originalIssue || receipt.branch !== 'main'
    || receipt.schemaVersion !== 'stephanos.battle-bridge-github-command-receipt.v1'
    || receipt.requestId !== read.value.requestId || receipt.operation !== readOperation
    || result?.ok !== true || result.requestId !== receipt.requestId || result.operation !== readOperation
    || result.verdict !== 'COMMAND_EXECUTION_COMPLETE'
    || proof.targetRequestSha256 !== target.targetRequestSha256
    || proof.readCommentId !== read.commentId
    || proof.readCommandDigest !== historicalTerminalDigest(readIdentity(read.value))
    || receipt.expectedHead !== read.value.expectedHead
    || entry.commentId <= read.commentId) return null;
  const created = Date.parse(read.comment.created_at), accepted = Date.parse(receipt.acceptedAt);
  const observed = Date.parse(proof.observedAt), completed = Date.parse(receipt.completedAt);
  const published = Date.parse(entry.comment.created_at), expiry = Date.parse(read.value.expiresAt);
  if (![created, accepted, observed, completed, published, expiry].every(Number.isFinite)
    || !(created <= accepted && accepted <= observed && observed <= completed && completed < published + 1000
      && observed <= expiry && created < expiry && expiry - created <= 6 * 60 * 60 * 1000)) return null;
  return proof;
}

// Called only with the original strict mailbox parser's observations, enriched
// with their actual owner comments. Nested readback alone is never sufficient.
export function historicalMailboxTerminalIds(observations = []) {
  const recovered = new Set();
  for (const target of HISTORICAL_TERMINAL_TARGETS) {
    const originals = observations.filter(entry => entry.type === 'command' && entry.value.requestId === target.requestId);
    if (originals.length !== 1) continue;
    const original = originals[0];
    if (!immutableOwnerComment(original) || original.commentId !== target.originalCommentId
      || original.comment.created_at !== target.originalCreatedAt
      || historicalTerminalTextSha256(original.comment.body) !== target.originalCommentBodySha256
      || original.value.expectedHead !== target.originalExpectedHead || original.value.operation !== originalOperation) continue;
    const reads = observations.filter(entry => entry.type === 'command' && entry.value.operation === readOperation
      && entry.value.targetRequestId === target.requestId);
    const claims = [];
    let conflicting = false;
    for (const read of reads) {
      if (!immutableOwnerComment(read) || read.commentId <= original.commentId
        || !exactKeys(read.value, readFields) || !validReadCommand(read.value, target)
        || observations.filter(entry => entry.type === 'command' && entry.value.requestId === read.value.requestId).length !== 1) continue;
      const receipts = observations.filter(entry => entry.type === 'receipt' && entry.value.requestId === read.value.requestId
        && terminal(entry.value.state));
      if (!receipts.some(entry => entry.value.result?.result?.historicalTerminalAttestation !== undefined)) continue;
      const proofs = receipts.map(entry => qualifyingReadReceipt(entry, read, target));
      if (proofs.some(proof => !proof) || proofs.some(proof => proof.proofHash !== proofs[0].proofHash)) {
        conflicting = true;
        continue;
      }
      claims.push(proofs[0]);
    }
    if (!conflicting && claims.length && claims.every(proof => proof.terminalState === claims[0].terminalState
      && proof.ledgerRecordSha256 === claims[0].ledgerRecordSha256)) recovered.add(target.requestId);
  }
  return recovered;
}
