import { EXACT_HEAD_REVIEW_MARKERS } from './exactHeadReviewDispatchCoordinator.mjs';

export const MACHINE_COORDINATOR_SENTINEL_LOGIN = 'stephanos-machine-coordinator';
export const REVIEW_COORDINATOR_WORKFLOW_NAME = 'Exact-Head Review Dispatch';
export const REVIEW_COORDINATOR_WORKFLOW_PATH = '.github/workflows/exact-head-review-dispatch.yml';
export const REVIEW_COORDINATOR_JOB = 'coordinate';

export const REVIEW_COORDINATOR_CREDENTIAL_SOURCE = Object.freeze({
  OWNER_SECRET: 'STEPHANOS_REVIEW_DISPATCH_TOKEN',
  GITHUB_ACTIONS: 'GITHUB_TOKEN',
  GH_TOKEN: 'GH_TOKEN',
  NONE: 'NONE',
});

export const TRUSTED_GITHUB_ACTIONS_COORDINATOR = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});

const MACHINE_EVENTS = new Set([
  'issue_comment',
  'workflow_run',
  'schedule',
  'workflow_dispatch',
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalizedLogin(value) {
  return text(value).toLowerCase();
}

function actor(item = {}) {
  return item?.user ?? item?.author ?? item;
}

function actorMatches(item, expected) {
  const candidate = actor(item);
  return normalizedLogin(candidate?.login) === expected.login
    && normalizedLogin(candidate?.type) === expected.type
    && Number(candidate?.id) === expected.id;
}

function hasMechanicalCoordinatorMarker(body) {
  const value = text(body);
  return Object.values(EXACT_HEAD_REVIEW_MARKERS)
    .some((marker) => value.includes(`<!-- ${marker}`));
}

export function selectReviewCoordinatorCredential(environment = {}) {
  const actionsToken = text(environment.GITHUB_TOKEN);
  if (environment.GITHUB_ACTIONS === 'true' && actionsToken) {
    return Object.freeze({
      token: actionsToken,
      source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
    });
  }
  for (const [source, candidate] of [
    [REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET, environment.STEPHANOS_REVIEW_DISPATCH_TOKEN],
    [REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS, environment.GITHUB_TOKEN],
    [REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GH_TOKEN, environment.GH_TOKEN],
  ]) {
    const token = text(candidate);
    if (token) return Object.freeze({ token, source });
  }
  return Object.freeze({
    token: '',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.NONE,
  });
}

export function selectReviewCoordinatorToken(environment = {}) {
  return selectReviewCoordinatorCredential(environment).token;
}

export function validateReviewCoordinatorActor(user = {}, laneAuthorityLogin = '') {
  const laneAuthority = normalizedLogin(laneAuthorityLogin);
  const login = normalizedLogin(user?.login);
  const base = {
    valid: false,
    actorLogin: login,
    laneAuthorityLogin: laneAuthority,
    markerLogin: MACHINE_COORDINATOR_SENTINEL_LOGIN,
    mode: 'none',
  };
  if (!laneAuthority) {
    return Object.freeze({ ...base, reason: 'lane authority login is required' });
  }
  if (login === laneAuthority) {
    return Object.freeze({
      ...base,
      valid: true,
      mode: 'lane-authority-token',
      reason: 'token actor is the configured owner lane authority',
    });
  }
  if (actorMatches(user, TRUSTED_GITHUB_ACTIONS_COORDINATOR)) {
    return Object.freeze({
      ...base,
      valid: true,
      mode: 'github-actions-token',
      reason: 'token actor is the exact GitHub Actions bot',
    });
  }
  return Object.freeze({
    ...base,
    reason: 'token actor is neither the lane authority nor the exact GitHub Actions bot',
  });
}

function validateGitHubActionsBoundary(environment = {}) {
  const repository = text(environment.GITHUB_REPOSITORY);
  const expectedWorkflowRef = repository
    ? `${repository}/${REVIEW_COORDINATOR_WORKFLOW_PATH}@refs/heads/main`
    : '';
  const blockers = [];
  if (environment.GITHUB_ACTIONS !== 'true') blockers.push('not-github-actions');
  if (text(environment.GITHUB_JOB) !== REVIEW_COORDINATOR_JOB) blockers.push('wrong-job');
  if (text(environment.GITHUB_WORKFLOW) !== REVIEW_COORDINATOR_WORKFLOW_NAME) blockers.push('wrong-workflow');
  if (!MACHINE_EVENTS.has(text(environment.GITHUB_EVENT_NAME))) blockers.push('wrong-event');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) blockers.push('invalid-repository');
  if (!expectedWorkflowRef || text(environment.GITHUB_WORKFLOW_REF) !== expectedWorkflowRef) {
    blockers.push('untrusted-workflow-ref');
  }
  return Object.freeze({
    valid: blockers.length === 0,
    blockers: Object.freeze(blockers),
    expectedWorkflowRef,
  });
}

export function validateReviewCoordinatorCredential({
  credential = {},
  authenticatedUser = {},
  laneAuthorityLogin = '',
  environment = {},
} = {}) {
  const laneAuthority = normalizedLogin(laneAuthorityLogin);
  const source = text(credential?.source);
  if (!text(credential?.token)) {
    return Object.freeze({
      valid: false,
      actorLogin: '',
      laneAuthorityLogin: laneAuthority,
      markerLogin: MACHINE_COORDINATOR_SENTINEL_LOGIN,
      credentialSource: source || REVIEW_COORDINATOR_CREDENTIAL_SOURCE.NONE,
      mode: 'none',
      reason: 'a bounded coordinator credential is required',
    });
  }
  if (source === REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS) {
    const boundary = validateGitHubActionsBoundary(environment);
    return Object.freeze({
      valid: boundary.valid,
      actorLogin: TRUSTED_GITHUB_ACTIONS_COORDINATOR.login,
      laneAuthorityLogin: laneAuthority,
      markerLogin: MACHINE_COORDINATOR_SENTINEL_LOGIN,
      credentialSource: source,
      mode: boundary.valid ? 'github-actions-token' : 'none',
      reason: boundary.valid
        ? 'repository token is bound to the exact trusted default-branch coordinator job'
        : `repository token boundary failed: ${boundary.blockers.join(', ')}`,
      blockers: boundary.blockers,
    });
  }
  const actorVerdict = validateReviewCoordinatorActor(
    authenticatedUser,
    laneAuthorityLogin,
  );
  return Object.freeze({
    ...actorVerdict,
    credentialSource: source,
  });
}

export function normalizeReviewCoordinatorMarkerComments(
  comments = [],
  { laneAuthorityLogin = '' } = {},
) {
  const laneAuthority = normalizedLogin(laneAuthorityLogin);
  return (Array.isArray(comments) ? comments : []).map((comment) => {
    if (!hasMechanicalCoordinatorMarker(comment?.body)) return comment;
    const trustedLaneAuthority = laneAuthority
      && normalizedLogin(actor(comment)?.login) === laneAuthority;
    const trustedMachineCoordinator = actorMatches(
      comment,
      TRUSTED_GITHUB_ACTIONS_COORDINATOR,
    );
    if (!trustedLaneAuthority && !trustedMachineCoordinator) return comment;
    return {
      ...comment,
      user: {
        ...(comment?.user || {}),
        login: MACHINE_COORDINATOR_SENTINEL_LOGIN,
      },
    };
  });
}
