export const DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_SCHEMA =
  'stephanos.direct-operator-intent-standing-authority.v1';

export const DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR = 'Cheekyfellastef';

export const DIRECT_OPERATOR_INTENT_CONTINUATION = Object.freeze([
  'bounded-design',
  'bounded-source-build',
  'tests',
  'proof',
  'branch-publication',
  'pr-publication',
  'review-retry',
  'review-fix',
  'protected-merge-environment-approval',
  'protected-exact-head-squash-merge',
  'guarded-live-update',
]);

export const DIRECT_OPERATOR_INTENT_EXCLUSIONS = Object.freeze([
  'scope-widening',
  'secret-or-credential-access',
  'financial-authority',
  'legal-or-regulatory-decision',
  'destructive-external-action',
  'ruleset-or-safety-bypass',
  'arbitrary-shell',
  'fabricated-local-hardware-proof',
]);

const ALLOWED_ORIGINS = new Set([
  'chatgpt',
  'stephanos-chat',
  'spatial-workspace',
  'whatsapp',
  'operator-console',
]);

function text(value) { return String(value ?? '').trim(); }

function cleanId(value) {
  const result = text(value);
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(result) ? result : '';
}

function cleanIntent(value) {
  const result = text(value);
  if (!result || result.length > 8000) return '';
  return result;
}

export function buildDirectOperatorIntentStandingAuthorityV1(input = {}) {
  return Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_SCHEMA,
    repository: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY,
    operator: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR,
    requestId: text(input.requestId),
    goalId: text(input.goalId),
    originSurface: text(input.originSurface || 'stephanos-chat'),
    intent: text(input.intent),
    directOperatorRequest: input.directOperatorRequest !== false,
    boundedScope: input.boundedScope !== false,
    requestedOutcome: text(input.requestedOutcome || 'build-test-review-protected-merge-guarded-live'),
    autoProtectedMergeRequested: input.autoProtectedMergeRequested !== false,
    guardedLiveUpdateRequested: input.guardedLiveUpdateRequested !== false,
    requiresNewSensitiveAuthority: input.requiresNewSensitiveAuthority === true,
    revoked: input.revoked === true,
  });
}
export function evaluateDirectOperatorIntentStandingAuthorityV1(input = {}) {
  const receipt = input?.receipt && typeof input.receipt === 'object' ? input.receipt : input;
  const blockers = [];
  const repository = text(receipt.repository);
  const operator = text(receipt.operator);
  const requestId = cleanId(receipt.requestId);
  const goalId = cleanId(receipt.goalId);
  const originSurface = text(receipt.originSurface);
  const intent = cleanIntent(receipt.intent);
  const requestedOutcome = text(receipt.requestedOutcome);

  if (text(receipt.schemaVersion) !== DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_SCHEMA) blockers.push('schema-version-invalid');
  if (repository !== DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_REPOSITORY) blockers.push('repository-not-canonical');
  if (operator !== DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_OPERATOR) blockers.push('operator-not-canonical');
  if (!requestId) blockers.push('request-id-invalid');
  if (!goalId) blockers.push('goal-id-invalid');
  if (!ALLOWED_ORIGINS.has(originSurface)) blockers.push('origin-surface-not-allowed');
  if (!intent) blockers.push('intent-missing-or-too-large');
  if (receipt.directOperatorRequest !== true) blockers.push('not-a-direct-operator-request');
  if (receipt.boundedScope !== true) blockers.push('scope-not-bounded');
  if (requestedOutcome !== 'build-test-review-protected-merge-guarded-live') blockers.push('requested-outcome-not-canonical');
  if (receipt.autoProtectedMergeRequested !== true) blockers.push('protected-merge-not-requested');
  if (receipt.guardedLiveUpdateRequested !== true) blockers.push('guarded-live-update-not-requested');
  if (receipt.requiresNewSensitiveAuthority === true) blockers.push('new-sensitive-authority-required');
  if (receipt.revoked === true) blockers.push('authorization-revoked');

  const valid = blockers.length === 0;
  return Object.freeze({
    schemaVersion: DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_SCHEMA,
    valid,
    standingAuthorization: valid,
    repository,
    operator,
    requestId,
    goalId,
    originSurface,
    intent,
    requestedOutcome,
    requiresNewOperatorApproval: !valid,
    continuationAllowed: valid,
    protectedMergeEnvironmentApprovalEligible: valid,
    protectedExactHeadMergeEligible: valid,
    guardedLiveUpdateEligible: valid,
    allows: valid ? DIRECT_OPERATOR_INTENT_CONTINUATION : Object.freeze([]),
    excludes: DIRECT_OPERATOR_INTENT_EXCLUSIONS,
    blockers: Object.freeze(blockers),
    mutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    finalVerdict: valid
      ? 'DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_VALID'
      : 'DIRECT_OPERATOR_INTENT_STANDING_AUTHORITY_BLOCKED',
  });
}
