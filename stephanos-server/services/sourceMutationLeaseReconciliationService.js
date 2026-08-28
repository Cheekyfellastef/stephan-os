import {
  reconcileStaleSourceMutationLease as reconcileStaleSourceMutationLeaseWithProgrammeAuthority,
} from './programmeAuthorityService.js';

export const SOURCE_MUTATION_LEASE_RECONCILIATION_SCHEMA = 'stephanos.source-mutation-lease-reconciliation.v1';
const SHA_40 = /^[0-9a-f]{40}$/i;

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function reconcileStaleSourceMutationLease(input = {}, options = {}) {
  const result = await reconcileStaleSourceMutationLeaseWithProgrammeAuthority(input, options);
  return Object.freeze({
    ...result,
    schemaVersion: SOURCE_MUTATION_LEASE_RECONCILIATION_SCHEMA,
    canonicalAuthority: 'programme-authority-service',
    independentReleaseAuthority: false,
    leaseSeizureAllowed: false,
    successorLeaseClaimed: false,
  });
}

export function isExactSourceMutationGrant(actionGrant = {}) {
  return Boolean(
    actionGrant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && actionGrant?.boundedActionCount === 1
    && ['codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(text(actionGrant.adapter).toLowerCase())
    && text(actionGrant.laneId)
    && text(actionGrant.repository)
    && positiveInteger(actionGrant.issueNumber)
    && positiveInteger(actionGrant.prNumber)
    && text(actionGrant.branch)
    && SHA_40.test(text(actionGrant.headSha).toLowerCase())
    && text(actionGrant.workerId)
    && actionGrant.mergeAuthority === false
    && actionGrant.leaseSeizureAllowed === false
  );
}
