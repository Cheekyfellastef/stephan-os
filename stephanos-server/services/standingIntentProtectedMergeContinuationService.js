import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import {
  BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_MARKER,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  extractBattleBridgeGitHubCommand,
} from '../../shared/agents/battleBridgeGitHubCommandMailboxBaseV1.mjs';
import {
  CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
  evaluateCanonicalMailboxCapacity,
} from '../../shared/agents/canonicalMailboxAuthorityV1.mjs';
import {
  resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1,
} from '../../shared/agents/directOperatorIntentGithubCommentBattleBridgeV1.mjs';
import {
  resolveProtectedMergeReviewEvidenceOnBattleBridgeV1,
} from '../../shared/agents/protectedMergeReviewEvidenceBattleBridgeV1.mjs';
import {
  buildStandingIntentProtectedMergeContinuationV1,
  missionGoalIssueNumberV1,
} from '../../shared/agents/standingIntentProtectedMergeContinuationV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../shared/agents/battleBridgeWindowsHosts.mjs';
import {
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorServiceCore.js';
import {
  appendMissionEvent,
  listMissionRecords,
} from './missionOrchestratorStore.js';

export const STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA =
  'stephanos.standing-intent-protected-merge-service.v1';
export const STANDING_INTENT_PROTECTED_MERGE_MAX_PER_CYCLE = 1;
export const STANDING_INTENT_PROTECTED_MERGE_RECENT_MAILBOX_PAGES = 3;

const SHA40 = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
  });
}

function fail(blocker, details = {}) {
  return Object.freeze({
    schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
    ok: false,
    blocker,
    mergeAuthority: false,
    directMergePerformed: false,
    arbitraryShellAllowed: false,
    forcePushAllowed: false,
    ...details,
  });
}

function jsonCommand(runCommand, executable, args, blocker, options = {}) {
  const result = runCommand(executable, args, options);
  if (result?.error || Number(result?.status) !== 0) {
    return fail(blocker, { error: text(result?.error?.message || result?.stderr || result?.stdout) });
  }
  try {
    return Object.freeze({ ok: true, payload: JSON.parse(String(result.stdout || '')) });
  } catch {
    return fail(`${blocker}_JSON_INVALID`);
  }
}

function protectedCandidate(mission = {}) {
  const phase = text(mission?.currentPhase);
  if (phase === 'AWAITING_OPERATOR_APPROVAL') return Boolean(
    integer(mission?.pullRequest?.number)
    && SHA40.test(text(mission?.pullRequest?.headSha).toLowerCase())
    && mission?.pullRequest?.mergeable === true
    && missionGoalIssueNumberV1(mission),
  );
  return phase === 'MERGE_PULL_REQUEST'
    && text(mission?.approval?.executionRoute).toLowerCase() === 'protected-workflow'
    && mission?.approval?.status === 'approved'
    && integer(mission?.pullRequest?.number)
    && SHA40.test(text(mission?.pullRequest?.headSha).toLowerCase())
    && missionGoalIssueNumberV1(mission);
}

function exactProtectedWorkflowRun(runs = [], mission = {}, expectedBase = '') {
  const expectedHead = text(mission?.pullRequest?.headSha).toLowerCase();
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => (
      text(run?.name) === 'Protected Operator Merge Queue Boundary'
      && text(run?.display_title) === `Protected operator merge ${expectedHead}`
      && run?.event === 'workflow_dispatch'
      && run?.status === 'completed'
      && run?.conclusion === 'success'
      && text(run?.head_sha).toLowerCase() === text(expectedBase).toLowerCase()
      && text(run?.repository?.full_name) === BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY
    ))
    .sort((left, right) => (
      Date.parse(text(right?.updated_at || right?.created_at)) - Date.parse(text(left?.updated_at || left?.created_at))
    ))[0] || null;
}

async function reconcileMergedMission({
  mission,
  runCommand,
  githubCli,
  paths,
  appendEvent,
  now,
}) {
  const prNumber = integer(mission?.pullRequest?.number);
  const expectedHead = text(mission?.pullRequest?.headSha).toLowerCase();
  const pullResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/pulls/${prNumber}`],
    'STANDING_INTENT_PROTECTED_MERGE_PR_RECONCILE_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!pullResult.ok) return pullResult;
  const pull = pullResult.payload;
  if (text(pull?.head?.sha).toLowerCase() !== expectedHead) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_PR_RECONCILE_HEAD_CHANGED', {
      missionId: mission.missionId,
      prNumber,
    });
  }
  if (pull?.merged !== true || text(pull?.state) !== 'closed') {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
      ok: true,
      blocker: '',
      action: 'WAIT_FOR_PROTECTED_WORKFLOW_MERGE',
      missionId: mission.missionId,
      prNumber,
      expectedHead,
      mergeAuthority: false,
      directMergePerformed: false,
      arbitraryShellAllowed: false,
      forcePushAllowed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_PENDING',
    });
  }
  const mergeCommitSha = text(pull?.merge_commit_sha).toLowerCase();
  const expectedBase = text(pull?.base?.sha).toLowerCase();
  if (!SHA40.test(mergeCommitSha) || !SHA40.test(expectedBase)) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_RECEIPT_IDENTITY_INVALID', {
      missionId: mission.missionId,
      prNumber,
    });
  }

  const runsResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/actions/workflows/operator-merge-approval-gate.yml/runs?event=workflow_dispatch&per_page=100`],
    'STANDING_INTENT_PROTECTED_MERGE_WORKFLOW_RECONCILE_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!runsResult.ok) return runsResult;
  const workflowRun = exactProtectedWorkflowRun(runsResult.payload?.workflow_runs, mission, expectedBase);
  if (!workflowRun) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_WORKFLOW_SUCCESS_NOT_PROVEN', {
      missionId: mission.missionId,
      prNumber,
      expectedHead,
    });
  }

  const digest = createHash('sha256').update(JSON.stringify({
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    prNumber,
    expectedHead,
    expectedBase,
    mergeCommitSha,
    workflowRunId: integer(workflowRun.id),
  })).digest('hex');
  const eventId = `protected-merge-${prNumber}-${expectedHead.slice(0, 16)}`;
  const result = await appendEvent(mission.missionId, {
    eventId,
    eventType: 'PULL_REQUEST_MERGED',
    expectedRevision: mission.revision,
    expectedCurrentPhase: 'MERGE_PULL_REQUEST',
    mergeCommitSha,
    receipt: {
      receiptId: eventId,
      requirement: 'approved squash merge',
      source: 'github-protected-operator-merge-workflow',
      evidenceType: 'github-workflow-and-pull-request',
      verified: true,
      sha256: digest,
      createdAt: now.toISOString(),
    },
    summary: `Reconcile protected workflow merge for PR #${prNumber} at exact head ${expectedHead}.`,
  }, {
    root: paths.orchestratorRoot,
    snapshotRoot: paths.snapshotRoot,
    now,
  });
  if (result?.preconditionFailed === true) {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
      ok: true,
      blocker: '',
      action: 'MISSION_STATE_MOVED_DURING_RECONCILIATION',
      missionId: mission.missionId,
      prNumber,
      mergeAuthority: false,
      directMergePerformed: false,
      arbitraryShellAllowed: false,
      forcePushAllowed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_RECONCILIATION_RACED_SAFELY',
    });
  }
  if (result?.state?.pullRequest?.merged !== true) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_MISSION_RECONCILE_FAILED', {
      missionId: mission.missionId,
      prNumber,
    });
  }
  return Object.freeze({
    schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
    ok: true,
    blocker: '',
    action: 'RECONCILED_PROTECTED_MERGE',
    missionId: mission.missionId,
    prNumber,
    expectedHead,
    mergeCommitSha,
    protectedWorkflowRunId: integer(workflowRun.id),
    nextMissionPhase: text(result.state.currentPhase),
    mergeAuthority: false,
    directMergePerformed: false,
    arbitraryShellAllowed: false,
    forcePushAllowed: false,
    finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_RECONCILED',
  });
}

function currentMainAndPull({ mission, runCommand, githubCli, paths }) {
  const prNumber = integer(mission?.pullRequest?.number);
  const pullResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/pulls/${prNumber}`],
    'STANDING_INTENT_PROTECTED_MERGE_PR_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!pullResult.ok) return pullResult;
  const mainResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/branches/main`],
    'STANDING_INTENT_PROTECTED_MERGE_MAIN_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!mainResult.ok) return mainResult;
  const pull = pullResult.payload;
  const mainHead = text(mainResult.payload?.commit?.sha).toLowerCase();
  const expectedHead = text(mission?.pullRequest?.headSha).toLowerCase();
  const expectedBase = text(pull?.base?.sha).toLowerCase();
  if (pull?.state !== 'open'
    || pull?.draft === true
    || integer(pull?.number) !== prNumber
    || text(pull?.head?.sha).toLowerCase() !== expectedHead
    || text(pull?.base?.ref) !== 'main'
    || !SHA40.test(expectedBase)
    || mainHead !== expectedBase
    || pull?.mergeable !== true) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_LIVE_PR_NOT_READY', {
      prNumber,
      expectedHead,
      expectedBase,
      mainHead,
    });
  }
  return Object.freeze({ ok: true, pull, expectedHead, expectedBase, mainHead });
}

function recentMailboxComments({ issue, runCommand, githubCli, paths }) {
  const commentCount = Number(issue?.comments || 0);
  const pageSize = 100;
  const lastPage = Math.max(1, Math.ceil(commentCount / pageSize));
  const firstPage = Math.max(1, lastPage - STANDING_INTENT_PROTECTED_MERGE_RECENT_MAILBOX_PAGES + 1);
  const comments = [];
  for (let page = firstPage; page <= lastPage; page += 1) {
    const result = jsonCommand(
      runCommand,
      githubCli,
      ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}/comments?per_page=${pageSize}&page=${page}`],
      'STANDING_INTENT_PROTECTED_MERGE_MAILBOX_COMMENTS_READ_FAILED',
      { cwd: paths.repoRoot },
    );
    if (!result.ok) return result;
    if (!Array.isArray(result.payload)) return fail('STANDING_INTENT_PROTECTED_MERGE_MAILBOX_COMMENTS_INVALID');
    comments.push(...result.payload);
  }
  return Object.freeze({ ok: true, comments });
}

function exactPublishedCommand(comments = [], command = {}) {
  return [...(Array.isArray(comments) ? comments : [])].reverse().find((comment) => {
    if (text(comment?.user?.login) !== BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR) return false;
    const extracted = extractBattleBridgeGitHubCommand(comment?.body || '');
    return Boolean(
      extracted?.ok
      && extracted.command?.requestId === command.requestId
      && extracted.command?.operation === command.operation
      && integer(extracted.command?.prNumber) === integer(command.prNumber)
      && text(extracted.command?.expectedHead).toLowerCase() === text(command.expectedHead).toLowerCase()
      && text(extracted.command?.expectedBase).toLowerCase() === text(command.expectedBase).toLowerCase()
      && integer(extracted.command?.reviewArtifactId) === integer(command.reviewArtifactId)
    );
  }) || null;
}

function publishProtectedMergeCommand({ command, runCommand, githubCli, paths }) {
  const actorResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', 'user'],
    'STANDING_INTENT_PROTECTED_MERGE_ACTOR_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!actorResult.ok) return actorResult;
  if (text(actorResult.payload?.login) !== BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_ACTOR_NOT_OWNER');
  }

  const issueResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}`],
    'STANDING_INTENT_PROTECTED_MERGE_MAILBOX_READ_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!issueResult.ok) return issueResult;
  const capacity = evaluateCanonicalMailboxCapacity({
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    commentCount: Number(issueResult.payload?.comments || 0),
  });
  if (!capacity.ok || capacity.rotationRequired === true) {
    return fail(capacity.blocker || 'STANDING_INTENT_PROTECTED_MERGE_MAILBOX_ROTATION_REQUIRED', {
      commentCount: Number(issueResult.payload?.comments || 0),
      rotationThresholdComments: CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS,
    });
  }

  const recent = recentMailboxComments({
    issue: issueResult.payload,
    runCommand,
    githubCli,
    paths,
  });
  if (!recent.ok) return recent;
  const existing = exactPublishedCommand(recent.comments, command);
  if (existing) {
    return Object.freeze({
      ok: true,
      published: false,
      duplicate: true,
      commentId: integer(existing.id),
      requestId: command.requestId,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_COMMAND_ALREADY_PUBLISHED',
    });
  }

  const body = `\`\`${BATTLE_BRIDGE_GITHUB_COMMAND_MARKER}\n${JSON.stringify(command)}\n\`\`\``;
  const posted = jsonCommand(
    runCommand,
    githubCli,
    [
      'api',
      `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}/comments`,
      '--method', 'POST',
      '--raw-field', `body=${body}`,
    ],
    'STANDING_INTENT_PROTECTED_MERGE_MAILBOX_PUBLISH_FAILED',
    { cwd: paths.repoRoot },
  );
  if (!posted.ok) return posted;
  if (!integer(posted.payload?.id) || text(posted.payload?.user?.login) !== BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_MAILBOX_PUBLICATION_IDENTITY_INVALID');
  }
  return Object.freeze({
    ok: true,
    published: true,
    duplicate: false,
    commentId: integer(posted.payload.id),
    requestId: command.requestId,
    finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_COMMAND_PUBLISHED',
  });
}

async function advanceProtectedCandidate({
  mission,
  runCommand,
  githubCli,
  paths,
  directIntentResolver,
  reviewResolver,
  appendEvent,
  now,
}) {
  if (text(mission?.currentPhase) === 'MERGE_PULL_REQUEST') {
    const reconciled = await reconcileMergedMission({
      mission,
      runCommand,
      githubCli,
      paths,
      appendEvent,
      now,
    });
    if (!reconciled.ok || reconciled.action !== 'WAIT_FOR_PROTECTED_WORKFLOW_MERGE') return reconciled;
  }

  const live = currentMainAndPull({ mission, runCommand, githubCli, paths });
  if (!live.ok) return live;
  const goalIssue = missionGoalIssueNumberV1(mission);
  const intent = directIntentResolver({ issueNumber: goalIssue }, {
    githubCli,
    runCommand,
  });
  if (intent?.ok !== true || intent?.evidence?.valid !== true) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_AUTHENTICATED_INTENT_MISSING', {
      missionId: mission.missionId,
      goalIssue,
      intentBlocker: intent?.blocker || intent?.evidence?.blockers?.[0] || '',
    });
  }

  const review = reviewResolver({
    prNumber: integer(mission.pullRequest.number),
    expectedHead: live.expectedHead,
    expectedBase: live.expectedBase,
  }, {
    githubCli,
    repositoryRoot: paths.repoRoot,
    runCommand,
  });
  if (review?.ok !== true) {
    return fail('STANDING_INTENT_PROTECTED_MERGE_REVIEW_NOT_READY', {
      missionId: mission.missionId,
      prNumber: integer(mission.pullRequest.number),
      reviewBlocker: review?.blocker || '',
    });
  }

  const plan = buildStandingIntentProtectedMergeContinuationV1({
    mission,
    intentEvidence: intent.evidence,
    reviewEvidence: review,
  }, { now });
  if (!plan.ok) {
    return fail(plan.blocker, {
      missionId: mission.missionId,
      prNumber: integer(mission.pullRequest.number),
      blockers: plan.blockers,
    });
  }

  let approvedState = mission;
  if (plan.approvalEvent) {
    const eventId = `standing-approval-${plan.prNumber}-${plan.expectedHead.slice(0, 16)}`;
    const approved = await appendEvent(mission.missionId, {
      ...plan.approvalEvent,
      eventId,
      expectedRevision: mission.revision,
      expectedCurrentPhase: 'AWAITING_OPERATOR_APPROVAL',
      summary: `Reuse authenticated standing operator intent for the existing protected exact-head merge path on PR #${plan.prNumber}.`,
    }, {
      root: paths.orchestratorRoot,
      snapshotRoot: paths.snapshotRoot,
      now,
    });
    if (approved?.preconditionFailed === true) {
      return Object.freeze({
        schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
        ok: true,
        blocker: '',
        action: 'MISSION_STATE_MOVED_DURING_APPROVAL',
        missionId: mission.missionId,
        prNumber: plan.prNumber,
        mergeAuthority: false,
        directMergePerformed: false,
        arbitraryShellAllowed: false,
        forcePushAllowed: false,
        finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_APPROVAL_RACED_SAFELY',
      });
    }
    approvedState = approved?.state || mission;
    if (text(approvedState?.currentPhase) !== 'MERGE_PULL_REQUEST'
      || text(approvedState?.approval?.executionRoute).toLowerCase() !== 'protected-workflow') {
      return fail('STANDING_INTENT_PROTECTED_MERGE_APPROVAL_TRANSITION_FAILED', {
        missionId: mission.missionId,
        prNumber: plan.prNumber,
      });
    }
  }

  const publication = publishProtectedMergeCommand({
    command: plan.command,
    runCommand,
    githubCli,
    paths,
  });
  if (!publication.ok) {
    return fail(publication.blocker, {
      missionId: mission.missionId,
      prNumber: plan.prNumber,
      requestId: plan.requestId,
      approvalRecorded: text(approvedState?.currentPhase) === 'MERGE_PULL_REQUEST',
    });
  }

  return Object.freeze({
    schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
    ok: true,
    blocker: '',
    action: publication.duplicate
      ? 'PROTECTED_MERGE_COMMAND_ALREADY_PUBLISHED'
      : 'PROTECTED_MERGE_COMMAND_PUBLISHED',
    missionId: mission.missionId,
    goalIssue,
    prNumber: plan.prNumber,
    expectedHead: plan.expectedHead,
    expectedBase: plan.expectedBase,
    requestId: plan.requestId,
    authorizationEvidenceRef: plan.intentEvidenceRef,
    mailboxCommentId: publication.commentId,
    reviewRunId: review.reviewRunId,
    reviewArtifactId: review.reviewArtifactId,
    mergeAuthority: false,
    directMergePerformed: false,
    arbitraryShellAllowed: false,
    forcePushAllowed: false,
    finalVerdict: publication.finalVerdict,
  });
}

export async function runStandingIntentProtectedMergeContinuation({
  env = process.env,
  now = new Date(),
  platform = process.platform,
  paths = resolveCriticalBacklogRuntimePaths({ env }),
  listMissions = listMissionRecords,
  appendEvent = appendMissionEvent,
  directIntentResolver = resolveDirectOperatorIntentGithubCommentOnBattleBridgeV1,
  reviewResolver = resolveProtectedMergeReviewEvidenceOnBattleBridgeV1,
  runCommand = defaultRun,
  githubCli = text(BATTLE_BRIDGE_WINDOWS_HOST.githubCli) || 'gh',
} = {}) {
  if (platform !== 'win32') {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
      ok: true,
      blocker: '',
      action: 'NOT_BATTLE_BRIDGE_WINDOWS',
      candidateCount: 0,
      mergeAuthority: false,
      directMergePerformed: false,
      arbitraryShellAllowed: false,
      forcePushAllowed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_NOT_APPLICABLE',
    });
  }
  const missions = await listMissions({
    root: paths.orchestratorRoot,
    snapshotRoot: paths.snapshotRoot,
    env,
  });
  const candidates = (Array.isArray(missions) ? missions : []).filter(protectedCandidate);
  if (!candidates.length) {
    return Object.freeze({
      schemaVersion: STANDING_INTENT_PROTECTED_MERGE_SERVICE_SCHEMA,
      ok: true,
      blocker: '',
      action: 'NO_ELIGIBLE_PROTECTED_MERGE',
      candidateCount: 0,
      mergeAuthority: false,
      directMergePerformed: false,
      arbitraryShellAllowed: false,
      forcePushAllowed: false,
      finalVerdict: 'STANDING_INTENT_PROTECTED_MERGE_IDLE',
    });
  }

  const candidate = candidates[0];
  const result = await advanceProtectedCandidate({
    mission: candidate,
    runCommand,
    githubCli,
    paths,
    directIntentResolver,
    reviewResolver,
    appendEvent,
    now: now instanceof Date ? now : new Date(now),
  });
  return Object.freeze({
    ...result,
    candidateCount: candidates.length,
    maxPerCycle: STANDING_INTENT_PROTECTED_MERGE_MAX_PER_CYCLE,
  });
}
