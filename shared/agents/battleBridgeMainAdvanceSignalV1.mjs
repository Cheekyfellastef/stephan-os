export const BATTLE_BRIDGE_MAIN_ADVANCE_SIGNAL_SCHEMA = 'stephanos.battle-bridge-main-advance-signal.v1';
export const BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_MAIN_ADVANCE_ISSUE = 1507;
export const BATTLE_BRIDGE_MAIN_ADVANCE_BRANCH = 'main';
export const BATTLE_BRIDGE_MAIN_ADVANCE_EVENT = 'PULL_REQUEST_MERGED';
export const BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

function canonicalUtc(value) {
  const text = String(value || '').trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === text ? text : '';
}

export function createBattleBridgeMainAdvanceSignal({
  repository = BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY,
  branch = BATTLE_BRIDGE_MAIN_ADVANCE_BRANCH,
  prNumber,
  mainHead,
  mergedAtUtc,
  workflowRunId,
} = {}) {
  const normalizedHead = String(mainHead || '').trim().toLowerCase();
  const normalizedRunId = String(workflowRunId || '').trim();
  const normalizedPr = Number(prNumber);
  const normalizedMergedAt = canonicalUtc(mergedAtUtc);

  if (repository !== BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY) throw new Error('MAIN_ADVANCE_REPOSITORY_INVALID');
  if (branch !== BATTLE_BRIDGE_MAIN_ADVANCE_BRANCH) throw new Error('MAIN_ADVANCE_BRANCH_INVALID');
  if (!Number.isSafeInteger(normalizedPr) || normalizedPr < 1) throw new Error('MAIN_ADVANCE_PR_INVALID');
  if (!SHA_PATTERN.test(normalizedHead)) throw new Error('MAIN_ADVANCE_HEAD_INVALID');
  if (!normalizedMergedAt) throw new Error('MAIN_ADVANCE_MERGED_AT_INVALID');
  if (!RUN_ID_PATTERN.test(normalizedRunId)) throw new Error('MAIN_ADVANCE_WORKFLOW_RUN_INVALID');

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_MAIN_ADVANCE_SIGNAL_SCHEMA,
    repository: BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_MAIN_ADVANCE_ISSUE,
    branch: BATTLE_BRIDGE_MAIN_ADVANCE_BRANCH,
    event: BATTLE_BRIDGE_MAIN_ADVANCE_EVENT,
    prNumber: normalizedPr,
    mainHead: normalizedHead,
    mergedAtUtc: normalizedMergedAt,
    workflowRunId: normalizedRunId,
    syncMode: 'EXISTING_BOUNDED_GITHUB_SYNC',
    syncIntervalMinutes: BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES,
    expectedBattleBridgeAction: 'FETCH_AND_FF_ONLY_CANONICAL_MAIN',
    lifecycle: Object.freeze([
      'MERGED',
      'SIGNAL_SENT',
      'SYNC_OBSERVED',
      'SAFE_FF_APPLIED_OR_BLOCKED',
      'POST_SYNC_REFRESH',
      'EXACT_HEAD_RUNTIME_PROVED',
    ]),
    signalOnly: true,
    syncAuthorityGranted: false,
    runtimeMutationAuthorityGranted: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
  });
}

export function validateBattleBridgeMainAdvanceSignal(value = {}) {
  try {
    const rebuilt = createBattleBridgeMainAdvanceSignal({
      repository: value.repository,
      branch: value.branch,
      prNumber: value.prNumber,
      mainHead: value.mainHead,
      mergedAtUtc: value.mergedAtUtc,
      workflowRunId: value.workflowRunId,
    });
    const required = JSON.stringify(rebuilt);
    return Object.freeze({ ok: required === JSON.stringify(value), signal: rebuilt, blocker: required === JSON.stringify(value) ? '' : 'MAIN_ADVANCE_SIGNAL_SHAPE_INVALID' });
  } catch (error) {
    return Object.freeze({ ok: false, signal: null, blocker: error?.message || 'MAIN_ADVANCE_SIGNAL_INVALID' });
  }
}
