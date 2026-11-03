export const PATCH_ESCROW_PUBLISH_AUTHORIZATION_SCHEMA_VERSION = 'stephanos.codex.patch-escrow-publish-authorization.v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_BUNDLE_PATTERN = /^patch-issue-[1-9][0-9]*-[a-f0-9]{12}$/;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function render(marker, payload) {
  return `${marker}\n${JSON.stringify(payload, null, 2)}\nEND_${marker}`;
}

export function createPatchEscrowPublishAuthorization(bundleId, patchSha256) {
  return Object.freeze({
    schemaVersion: PATCH_ESCROW_PUBLISH_AUTHORIZATION_SCHEMA_VERSION,
    bundleId: text(bundleId),
    patchSha256: text(patchSha256).toLowerCase(),
  });
}

export function validatePatchEscrowPublishAuthorization(payload = {}) {
  const blockers = [];
  if (payload.schemaVersion !== PATCH_ESCROW_PUBLISH_AUTHORIZATION_SCHEMA_VERSION) blockers.push('invalid-publish-authorization-schema');
  if (!SAFE_BUNDLE_PATTERN.test(text(payload.bundleId))) blockers.push('invalid-publish-authorization-bundle-id');
  if (!SHA256_PATTERN.test(text(payload.patchSha256).toLowerCase())) blockers.push('invalid-publish-authorization-patch-sha256');
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    bundleId: text(payload.bundleId),
    patchSha256: text(payload.patchSha256).toLowerCase(),
    finalVerdict: blockers.length ? 'PATCH_ESCROW_PUBLISH_AUTHORIZATION_BLOCKED' : 'PATCH_ESCROW_PUBLISH_AUTHORIZATION_PASS',
  });
}

export function renderPatchEscrowPublishAuthorizationComment(bundleId, patchSha256) {
  return render('PATCH_ESCROW_PUBLISH_V1', createPatchEscrowPublishAuthorization(bundleId, patchSha256));
}
