import { read, write, replaceOnce, replaceAllExact } from './patch-scoped-delivery-repair-lib-v1.mjs';

const mailboxSourcePath = 'shared/agents/battleBridgeGitHubCommandMailbox.mjs';
let mailboxSource = read(mailboxSourcePath);

mailboxSource = replaceOnce(
  mailboxSource,
`const MUSIC_SPOTIFY_FIELDS = Object.freeze(['source', 'spotifyUri', 'targetTrackId', 'targetArtist', 'targetTitle', 'requestedAtUtc']);

function fail(blocker, details = {}) {`,
`const MUSIC_SPOTIFY_FIELDS = Object.freeze(['source', 'spotifyUri', 'targetTrackId', 'targetArtist', 'targetTitle', 'requestedAtUtc']);
const SCOPED_DELIVERY_ALLOWED_OPERATIONS = new Set([
  'UPDATE_STEPHANOS_FROM_CHAT',
  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
]);
const SCOPED_DELIVERY_FIELDS = new Set([
  'prNumber',
  'mergeCommit',
  'deploymentRequestId',
  'featureId',
]);
const SCOPED_DELIVERY_FEATURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,120}$/;

function fail(blocker, details = {}) {`,
  'mailbox-scoped-constants',
);

mailboxSource = replaceOnce(
  mailboxSource,
`function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function unsafeAutomationField(command) {`,
`function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateScopedDelivery(command = {}) {
  if (!hasValue(command.scopedDelivery)) return Object.freeze({ ok: true, scopedDelivery: null });
  if (!SCOPED_DELIVERY_ALLOWED_OPERATIONS.has(command.operation)) {
    return fail('SCOPED_DELIVERY_FIELD_NOT_ALLOWED');
  }
  if (!plainObject(command.scopedDelivery)) return fail('SCOPED_DELIVERY_INVALID');

  const unexpectedField = Object.keys(command.scopedDelivery)
    .find((field) => !SCOPED_DELIVERY_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SCOPED_DELIVERY_FIELD_NOT_ALLOWED', { field: `scopedDelivery.${unexpectedField}` });
  }

  const prNumber = Number(command.scopedDelivery.prNumber);
  const mergeCommit = String(command.scopedDelivery.mergeCommit || '').toLowerCase();
  const deploymentRequestId = String(command.scopedDelivery.deploymentRequestId || '');
  const featureId = String(command.scopedDelivery.featureId || '');
  const deploymentHead = String(command.expectedHead || '').toLowerCase();

  if (!PR_NUMBER_PATTERN.test(String(prNumber))) return fail('SCOPED_DELIVERY_PR_NUMBER_INVALID');
  if (!SHA_PATTERN.test(mergeCommit)) return fail('SCOPED_DELIVERY_MERGE_COMMIT_INVALID');
  if (!SHA_PATTERN.test(deploymentHead)) return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_REQUIRED');
  if (!REQUEST_ID_PATTERN.test(deploymentRequestId)) return fail('SCOPED_DELIVERY_REQUEST_ID_INVALID');
  if (!SCOPED_DELIVERY_FEATURE_ID_PATTERN.test(featureId)) return fail('SCOPED_DELIVERY_FEATURE_ID_INVALID');
  if (command.operation === 'UPDATE_STEPHANOS_FROM_CHAT' && deploymentRequestId !== String(command.requestId)) {
    return fail('SCOPED_DELIVERY_REQUEST_ID_MISMATCH');
  }
  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' && prNumber !== Number(command.prNumber)) {
    return fail('SCOPED_DELIVERY_PR_NUMBER_MISMATCH');
  }

  return Object.freeze({
    ok: true,
    scopedDelivery: Object.freeze({
      repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
      relatedPr: `#${prNumber}`,
      prNumber,
      mergeCommit,
      deploymentHead,
      deploymentRequestId,
      featureId,
    }),
  });
}

function unsafeAutomationField(command) {`,
  'mailbox-scoped-validator',
);

mailboxSource = replaceOnce(
  mailboxSource,
`  const targetRequestId = String(command.targetRequestId || '');
  if (command.operation === 'READ_MAILBOX_RECEIPT' && !REQUEST_ID_PATTERN.test(targetRequestId)) {`,
`  const scopedDeliveryValidation = validateScopedDelivery(command);
  if (!scopedDeliveryValidation.ok) return scopedDeliveryValidation;

  const targetRequestId = String(command.targetRequestId || '');
  if (command.operation === 'READ_MAILBOX_RECEIPT' && !REQUEST_ID_PATTERN.test(targetRequestId)) {`,
  'mailbox-scoped-validation-call',
);

mailboxSource = replaceOnce(
  mailboxSource,
`      pullRequestHead: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.pullRequestHead || '').toLowerCase()
        : '',
      ...(forgeShadow || {}),`,
`      pullRequestHead: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF'
        ? String(command.pullRequestHead || '').toLowerCase()
        : '',
      ...(scopedDeliveryValidation.scopedDelivery
        ? { scopedDelivery: scopedDeliveryValidation.scopedDelivery }
        : {}),
      ...(forgeShadow || {}),`,
  'mailbox-scoped-normalized-command',
);

mailboxSource = replaceOnce(
  mailboxSource,
`export async function executeBattleBridgeGitHubCommand(command, {`,
`function validateScopedDeliveryExecution(command = {}, result = {}) {
  const scopedDelivery = command?.scopedDelivery;
  if (!scopedDelivery || result?.ok === false) return null;

  const sourceHead = String(result?.sourceHead || result?.expectedHead || '').toLowerCase();
  if (sourceHead && sourceHead !== scopedDelivery.deploymentHead) {
    return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead });
  }

  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF') {
    const mergeCommitHead = String(result?.mergeCommitHead || '').toLowerCase();
    const githubMainHead = String(result?.githubMainHead || '').toLowerCase();
    const localHead = String(result?.localHead || '').toLowerCase();
    if (mergeCommitHead !== scopedDelivery.mergeCommit) {
      return fail('SCOPED_DELIVERY_MERGE_COMMIT_MISMATCH', { mergeCommitHead });
    }
    if (githubMainHead && githubMainHead !== scopedDelivery.deploymentHead) {
      return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead: githubMainHead });
    }
    if (localHead && localHead !== scopedDelivery.deploymentHead) {
      return fail('SCOPED_DELIVERY_DEPLOYMENT_HEAD_MISMATCH', { sourceHead: localHead });
    }
  }

  return null;
}

export async function executeBattleBridgeGitHubCommand(command, {`,
  'mailbox-scoped-execution-validator',
);

mailboxSource = replaceOnce(
  mailboxSource,
`    const result = await handler(command);
    return Object.freeze({
      ok: result?.ok !== false,`,
`    const result = await handler(command);
    const scopedDeliveryBlocker = validateScopedDeliveryExecution(command, result);
    if (scopedDeliveryBlocker) {
      return Object.freeze({
        ...scopedDeliveryBlocker,
        operation: command.operation,
        requestId: command.requestId,
        result,
      });
    }
    return Object.freeze({
      ok: result?.ok !== false,`,
  'mailbox-scoped-execution-call',
);

mailboxSource = replaceOnce(
  mailboxSource,
`} = {}) {
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',`,
`} = {}) {
  const scopedDelivery = command?.scopedDelivery || null;
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',`,
  'mailbox-receipt-scoped-local',
);

mailboxSource = replaceOnce(
  mailboxSource,
`    expectedHead: String(command?.expectedHead || ''),
    forgejoVersion:`,
`    expectedHead: String(command?.expectedHead || ''),
    relatedPr: scopedDelivery ? String(scopedDelivery.relatedPr || '') : '',
    mergeCommit: scopedDelivery ? String(scopedDelivery.mergeCommit || '') : '',
    deploymentHead: scopedDelivery ? String(scopedDelivery.deploymentHead || '') : '',
    deploymentRequestId: scopedDelivery ? String(scopedDelivery.deploymentRequestId || '') : '',
    featureId: scopedDelivery ? String(scopedDelivery.featureId || '') : '',
    forgejoVersion:`,
  'mailbox-receipt-scoped-fields',
);

write(mailboxSourcePath, mailboxSource);
