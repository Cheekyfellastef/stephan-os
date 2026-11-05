// Fair bounded observation of the OPEN PR estate; no review, lease or merge authority.
// The formerly global 5-minute scheduler used to fetch comments for every open PR
// on every pass. Keep the two most recently updated PRs hot and rotate the
// remainder in deterministic bounded windows without durable cursor state.
// Stay aligned with the 15-minute scheduled fallback. A 5-minute window
// sampled every 15 minutes can systematically skip old-PR cohorts.
export const EXACT_HEAD_DISCOVERY_WINDOW_MS = 15 * 60_000;
export const EXACT_HEAD_DISCOVERY_FRESH_COUNT = 2;
export const EXACT_HEAD_DISCOVERY_ROTATING_COUNT = 10;
export const EXACT_HEAD_DISCOVERY_MAX_PER_PASS =
  EXACT_HEAD_DISCOVERY_FRESH_COUNT + EXACT_HEAD_DISCOVERY_ROTATING_COUNT;

export function selectExactHeadDiscoveryWindowV1(openPullRequests, { nowMs = Date.now() } = {}) {
  if (!Array.isArray(openPullRequests) || !Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error('EXACT_HEAD_DISCOVERY_INPUT_UNVERIFIED');
  }
  const ids = openPullRequests.map((pr) => Number(pr?.number));
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)
      || new Set(ids).size !== ids.length) {
    throw new Error('EXACT_HEAD_DISCOVERY_PR_IDENTITIES_UNVERIFIED');
  }
  if (openPullRequests.length <= EXACT_HEAD_DISCOVERY_MAX_PER_PASS) {
    return Object.freeze([...openPullRequests]);
  }

  // REST pulls?sort=updated&direction=desc returns the newest first; reserve
  // two fresh candidates so current operator work is always inspected.
  const recent = openPullRequests.slice(0, EXACT_HEAD_DISCOVERY_FRESH_COUNT);
  const older = openPullRequests.slice(EXACT_HEAD_DISCOVERY_FRESH_COUNT)
    .sort((a, b) => Number(a.number) - Number(b.number));
  const windows = Math.ceil(older.length / EXACT_HEAD_DISCOVERY_ROTATING_COUNT);
  const windowIndex = Math.floor(nowMs / EXACT_HEAD_DISCOVERY_WINDOW_MS) % windows;
  const offset = windowIndex * EXACT_HEAD_DISCOVERY_ROTATING_COUNT;
  const selected = [...recent, ...older.slice(offset, offset + EXACT_HEAD_DISCOVERY_ROTATING_COUNT)];
  return Object.freeze(selected);
}
