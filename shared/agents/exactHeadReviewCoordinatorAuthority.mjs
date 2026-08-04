import { EXACT_HEAD_REVIEW_MARKERS } from './exactHeadReviewDispatchCoordinator.mjs';

export const MACHINE_COORDINATOR_SENTINEL_LOGIN = 'stephanos-machine-coordinator';

export const TRUSTED_GITHUB_ACTIONS_COORDINATOR = Object.freeze({
  login: 'github-actions[bot]',
  type: 'bot',
  id: 41898282,
});

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

export function selectReviewCoordinatorToken(environment = {}) {
  for (const candidate of [
    environment.STEPHANOS_REVIEW_DISPATCH_TOKEN,
    environment.GITHUB_TOKEN,
    environment.GH_TOKEN,
  ]) {
    const token = text(candidate);
    if (token) return token;
  }
  return '';
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
      reason: 'token actor is the exact repository-scoped GitHub Actions bot',
    });
  }
  return Object.freeze({
    ...base,
    reason: 'token actor is neither the lane authority nor the exact GitHub Actions bot',
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
