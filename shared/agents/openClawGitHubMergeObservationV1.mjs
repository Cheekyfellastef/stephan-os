const LOWERCASE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const PARSEABLE_CHECK_EXIT_CODES = Object.freeze([0, 1]);
const PENDING_CHECK_EXIT_CODE = 8;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function parseJson(stdout, code, blockers) {
  const source = String(stdout || '').trim();
  if (!source) {
    blockers.push(`${code}-empty`);
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    blockers.push(`${code}-invalid-json`);
    return null;
  }
}

export function parseOpenClawGitHubMergeObservation({ view = {}, checks = {} } = {}) {
  const blockers = [];
  const checksExitCode = Number.isInteger(checks?.status) ? checks.status : null;

  if (view?.error || view?.status !== 0) blockers.push('github-pr-view-transport-failed');
  if (checks?.error || checksExitCode === null || (
    !PARSEABLE_CHECK_EXIT_CODES.includes(checksExitCode)
    && checksExitCode !== PENDING_CHECK_EXIT_CODE
  )) {
    blockers.push('github-pr-checks-transport-failed');
  }
  if (checksExitCode === PENDING_CHECK_EXIT_CODE) {
    blockers.push('github-pr-checks-pending');
  }

  const viewPayload = blockers.includes('github-pr-view-transport-failed')
    ? null
    : parseJson(view?.stdout, 'github-pr-view', blockers);
  const checkPayload = blockers.includes('github-pr-checks-transport-failed')
    || blockers.includes('github-pr-checks-pending')
    ? null
    : parseJson(checks?.stdout, 'github-pr-checks', blockers);

  if (viewPayload !== null) {
    if (!viewPayload || typeof viewPayload !== 'object' || Array.isArray(viewPayload)) {
      blockers.push('github-pr-view-payload-invalid');
    } else {
      const head = text(viewPayload.headRefOid).toLowerCase();
      const base = text(viewPayload.baseRefName);
      const mergeable = text(viewPayload.mergeable);
      const state = text(viewPayload.state);
      if (!LOWERCASE_SHA_PATTERN.test(head)) blockers.push('github-pr-view-head-invalid');
      if (!BRANCH_PATTERN.test(base) || base.includes('..')) blockers.push('github-pr-view-base-invalid');
      if (!mergeable) blockers.push('github-pr-view-mergeable-invalid');
      if (!state) blockers.push('github-pr-view-state-invalid');
    }
  }

  if (checkPayload !== null && !Array.isArray(checkPayload)) {
    blockers.push('github-pr-checks-payload-invalid');
  }

  return Object.freeze({
    valid: blockers.length === 0,
    viewPayload,
    checkPayload,
    checksExitCode,
    blockers: Object.freeze([...new Set(blockers)]),
    finalVerdict: blockers.length
      ? 'OPENCLAW_GITHUB_MERGE_OBSERVATION_BLOCKED'
      : 'OPENCLAW_GITHUB_MERGE_OBSERVATION_READY',
  });
}
