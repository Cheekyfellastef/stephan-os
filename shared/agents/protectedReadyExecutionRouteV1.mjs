import {
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  PROTECTED_WORKFLOW_READY_MODE,
  PROTECTED_WORKFLOW_READY_OPERATION,
} from './protectedWorkflowDispatchMailboxV1.mjs';

export const PROTECTED_READY_EXECUTION_ROUTE_SCHEMA = 'stephanos.protected-ready-execution-route.v1';

export const PROTECTED_READY_EXECUTION_ROUTE = Object.freeze({
  ALREADY_READY: 'ALREADY_READY',
  PROTECTED_MAILBOX: 'PROTECTED_WORKFLOW_MAILBOX',
  HOLD: 'HOLD',
});

export const PROTECTED_READY_CLIENT_FAULT = Object.freeze({
  NONE: 'NONE',
  FULL_DATABASE_ID_SCHEMA: 'KNOWN_CLIENT_FULL_DATABASE_ID_SCHEMA_FAULT',
  OTHER: 'OTHER_CLIENT_READY_FAULT',
});

const SHA40 = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonnegativeInteger(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || text(value) === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function faultText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function classifyProtectedReadyClientFault(value) {
  const observed = faultText(value).toLowerCase();
  if (!observed) return PROTECTED_READY_CLIENT_FAULT.NONE;
  if (observed.includes('fulldatabaseid')
    && (observed.includes('undefinedfield')
      || observed.includes("doesn't exist on type 'repository'")
      || observed.includes('does not exist on type repository'))) {
    return PROTECTED_READY_CLIENT_FAULT.FULL_DATABASE_ID_SCHEMA;
  }
  return PROTECTED_READY_CLIENT_FAULT.OTHER;
}

function hold(blocker, clientMutationFault = PROTECTED_READY_CLIENT_FAULT.NONE) {
  return Object.freeze({
    schemaVersion: PROTECTED_READY_EXECUTION_ROUTE_SCHEMA,
    route: PROTECTED_READY_EXECUTION_ROUTE.HOLD,
    blocker,
    clientMutationFault,
    retryClientMutation: false,
    clientMutationSuppressed: true,
    arbitraryGraphqlAllowed: false,
    callerSuppliedGraphqlAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    providerMutationAuthority: false,
  });
}

export function planProtectedReadyExecutionRoute(input = {}) {
  const repository = text(input.repository);
  const prNumber = positiveInteger(input.prNumber);
  const branch = text(input.branch);
  const head = text(input.head).toLowerCase();
  const headTree = text(input.headTree).toLowerCase();
  const base = text(input.base).toLowerCase();
  const unresolvedReviewThreads = nonnegativeInteger(input.unresolvedReviewThreads);
  const clientMutationFault = classifyProtectedReadyClientFault(input.clientMutationFailure);

  if (repository !== PROTECTED_WORKFLOW_DISPATCH_REPOSITORY) {
    return hold('PROTECTED_READY_REPOSITORY_MISMATCH', clientMutationFault);
  }
  if (!prNumber) return hold('PROTECTED_READY_PR_NUMBER_INVALID', clientMutationFault);
  if (!BRANCH.test(branch) || branch.includes('..')) {
    return hold('PROTECTED_READY_BRANCH_INVALID', clientMutationFault);
  }
  if (!SHA40.test(head) || !SHA40.test(headTree) || !SHA40.test(base)) {
    return hold('PROTECTED_READY_IDENTITY_INVALID', clientMutationFault);
  }

  if (input.alreadyReady === true) {
    return Object.freeze({
      schemaVersion: PROTECTED_READY_EXECUTION_ROUTE_SCHEMA,
      route: PROTECTED_READY_EXECUTION_ROUTE.ALREADY_READY,
      blocker: null,
      repository,
      prNumber,
      branch,
      head,
      headTree,
      base,
      clientMutationFault,
      retryClientMutation: false,
      clientMutationSuppressed: true,
      mutationRequired: false,
      arbitraryGraphqlAllowed: false,
      callerSuppliedGraphqlAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      providerMutationAuthority: false,
    });
  }

  if (input.readyTransitionAuthorized !== true) {
    return hold('PROTECTED_READY_OPERATOR_AUTHORIZATION_REQUIRED', clientMutationFault);
  }
  if (input.exactHeadReviewClean !== true || unresolvedReviewThreads !== 0) {
    return hold('PROTECTED_READY_REVIEW_NOT_CLEAN', clientMutationFault);
  }
  if (input.protectedMailboxAvailable !== true) {
    return hold('PROTECTED_READY_MAILBOX_UNAVAILABLE', clientMutationFault);
  }

  return Object.freeze({
    schemaVersion: PROTECTED_READY_EXECUTION_ROUTE_SCHEMA,
    route: PROTECTED_READY_EXECUTION_ROUTE.PROTECTED_MAILBOX,
    blocker: null,
    repository,
    issueNumber: PROTECTED_WORKFLOW_DISPATCH_ISSUE,
    prNumber,
    branch,
    head,
    headTree,
    base,
    operation: PROTECTED_WORKFLOW_READY_OPERATION,
    mode: PROTECTED_WORKFLOW_READY_MODE,
    clientMutationFault,
    clientMutationSuppressed: true,
    retryClientMutation: false,
    mutationRequired: true,
    requiresCurrentMainReread: true,
    requiresExactPrReread: true,
    requiresPostMutationIdentityReread: true,
    usesCanonicalProtectedMailbox: true,
    arbitraryGraphqlAllowed: false,
    callerSuppliedGraphqlAllowed: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    providerMutationAuthority: false,
    finalVerdict: 'PROTECTED_READY_ROUTE_CANONICAL_MAILBOX',
  });
}
