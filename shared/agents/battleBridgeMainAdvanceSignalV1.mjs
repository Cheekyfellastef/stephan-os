import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';

export const BATTLE_BRIDGE_MAIN_ADVANCE_SIGNAL_SCHEMA = 'stephanos.battle-bridge-main-advance-signal.v1';
export const BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_MAIN_ADVANCE_ISSUE = CANONICAL_MAILBOX_ISSUE;
export const BATTLE_BRIDGE_MAIN_ADVANCE_BRANCH = 'main';
export const BATTLE_BRIDGE_MAIN_ADVANCE_EVENT = 'PULL_REQUEST_MERGED';
export const BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES = 1;

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function canonicalUtc(value) {
  const text = String(value || '').trim();
  if (!UTC_TIMESTAMP_PATTERN.test(text)) return '';
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return Object.freeze({ ok: false, signal: null, blocker: 'MAIN_ADVANCE_SIGNAL_SHAPE_INVALID' });
    }
    const rebuilt = createBattleBridgeMainAdvanceSignal({
      repository: value.repository,
      branch: value.branch,
      prNumber: value.prNumber,
      mainHead: value.mainHead,
      mergedAtUtc: value.mergedAtUtc,
      workflowRunId: value.workflowRunId,
    });
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = Object.keys(rebuilt).sort();
    const exactKeys = actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index]);
    const exactValues = exactKeys && expectedKeys.every((key) => JSON.stringify(value[key]) === JSON.stringify(rebuilt[key]));
    return Object.freeze({
      ok: exactValues,
      signal: exactValues ? rebuilt : null,
      blocker: exactValues ? '' : 'MAIN_ADVANCE_SIGNAL_SHAPE_INVALID',
    });
  } catch (error) {
    return Object.freeze({ ok: false, signal: null, blocker: error?.message || 'MAIN_ADVANCE_SIGNAL_INVALID' });
  }
}

// Read-only orchestration for the existing signal publisher. Production owns
// its HTTPS reader; injected readers are test fixtures, never authentication.
// Every endpoint is fixed or derived from a validated SHA/positive numeric ID.
export async function readMergedMainAdvanceSignalV1({
  repository, eventName, event, mainHead, workflowRunId, readJson,
} = {}) {
  const root = '/repos/' + BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY;
  const positive = v => Number.isSafeInteger(v) && v > 0;
  const sha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
  const stop = code => { throw new Error(code); };
  if (repository !== BATTLE_BRIDGE_MAIN_ADVANCE_REPOSITORY
      || event?.repository?.full_name !== repository || !sha(mainHead)
      || typeof workflowRunId !== 'string' || !RUN_ID_PATTERN.test(workflowRunId)
      || typeof readJson !== 'function') stop('MAIN_ADVANCE_EVENT_IDENTITY_INVALID');
  let parent = null, sourceHead = '';
  if (eventName === 'push') {
    if (event.ref !== 'refs/heads/main' || event.after !== mainHead || event.deleted !== false)
      stop('MAIN_ADVANCE_PUSH_NOT_EXACT_MAIN');
  } else if (eventName === 'workflow_run') {
    const hinted = event.workflow_run;
    if (event.action !== 'completed' || !positive(hinted?.id)) stop('MAIN_ADVANCE_PARENT_HINT_INVALID');
    parent = await readJson(root + '/actions/runs/' + hinted.id);
    const match = typeof parent?.display_title === 'string'
      ? parent.display_title.match(/^Protected operator merge ([a-f0-9]{40})$/) : null;
    if (parent?.id !== hinted.id || parent.repository?.full_name !== repository
        || parent.head_repository?.full_name !== repository
        || parent.path !== '.github/workflows/operator-merge-approval-gate.yml'
        || parent.event !== 'workflow_dispatch' || parent.head_branch !== 'main'
        || parent.status !== 'completed' || parent.conclusion !== 'success'
        || !sha(parent.head_sha) || !match)
      stop('MAIN_ADVANCE_PROTECTED_PARENT_UNPROVEN');
    sourceHead = match[1];
  } else stop('MAIN_ADVANCE_EVENT_NOT_MAIN_ASSOCIATED');

  const exactMain = value => value?.ref === 'refs/heads/main' && value.object?.sha === mainHead;
  if (!exactMain(await readJson(root + '/git/ref/heads/main'))) stop('MAIN_ADVANCE_MAIN_MOVED');
  const associated = await readJson(root + '/commits/' + mainHead + '/pulls?per_page=100');
  if (!Array.isArray(associated) || associated.length >= 100) stop('MAIN_ADVANCE_PR_INVENTORY_UNPROVEN');
  const merged = associated.filter(pr => positive(pr?.number) && pr.state === 'closed'
    && pr.merge_commit_sha === mainHead && pr.base?.ref === 'main'
    && pr.base?.repo?.full_name === repository && canonicalUtc(pr.merged_at)
    && (!sourceHead || pr.head?.sha === sourceHead));
  if (merged.length === 0) return Object.freeze({ disposition: 'NO_MATCHING_MERGED_PR', signal: null });
  if (merged.length !== 1) stop('MAIN_ADVANCE_MERGED_PR_AMBIGUOUS');
  const pr = await readJson(root + '/pulls/' + merged[0].number);
  if (pr?.number !== merged[0].number || pr.merged !== true || pr.state !== 'closed'
      || pr.merge_commit_sha !== mainHead || pr.base?.ref !== 'main'
      || pr.base?.repo?.full_name !== repository || !canonicalUtc(pr.merged_at)
      || pr.merged_at !== merged[0].merged_at || !sha(pr.head?.sha)
      || pr.head.sha !== merged[0].head?.sha || (sourceHead && pr.head.sha !== sourceHead))
    stop('MAIN_ADVANCE_MERGED_PR_CHANGED_OR_UNPROVEN');
  if (parent) {
    const commit = await readJson(root + '/git/commits/' + mainHead);
    if (commit?.sha !== mainHead || !Array.isArray(commit.parents) || commit.parents.length !== 1
        || commit.parents[0]?.sha !== parent.head_sha)
      stop('MAIN_ADVANCE_PARENT_MERGE_NOT_EXACT');
  }
  if (!exactMain(await readJson(root + '/git/ref/heads/main'))) stop('MAIN_ADVANCE_MAIN_MOVED');
  return Object.freeze({ disposition: 'MERGED_MAIN_SIGNAL_OBSERVED', signal: createBattleBridgeMainAdvanceSignal({
    repository, prNumber: pr.number, mainHead, mergedAtUtc: pr.merged_at, workflowRunId,
  }) });
}
