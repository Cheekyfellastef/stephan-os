import {
  OPERATOR_DECISION_KIND,
  OPERATOR_DECISION_STATUS,
  createOperatorDecision,
  validateOperatorDecision,
} from './operatorAutomationLayer.mjs';
import {
  OPERATOR_REVIEW_PARKING_STATE,
  buildOperatorReviewReadyBatchV1,
} from './operatorReviewParkingRefillV1.mjs';

const CURRENT = 'CURRENT';
const SHA40 = /^[a-f0-9]{40}$/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeSlug(value, fallback = 'goal') {
  const slug = text(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
  return slug || fallback;
}

function isCurrent(value) {
  return text(value, 'UNKNOWN').toUpperCase() === CURRENT;
}

function isApprovalReadyPullRequest(goal = {}) {
  return goal.source === 'github-live-open-pr'
    && text(goal.state).toUpperCase() === 'APPROVAL_REQUIRED'
    && Number.isInteger(Number(goal.prNumber))
    && Number(goal.prNumber) > 0
    && SHA40.test(text(goal.exactHead));
}

export function buildGoalDashboardApprovalDecisions(goals = [], explicitDecisions = []) {
  const decisions = [];
  const seen = new Set();
  const add = (decision) => {
    const validation = validateOperatorDecision(decision);
    if (!validation.valid || seen.has(decision.decisionId)) return;
    seen.add(decision.decisionId);
    decisions.push(Object.freeze(decision));
  };

  for (const candidate of list(explicitDecisions)) add(candidate);
  for (const goal of list(goals).filter(isApprovalReadyPullRequest)) {
    const prNumber = Number(goal.prNumber);
    const exactHead = text(goal.exactHead).toLowerCase();
    add(createOperatorDecision({
      decisionId: `merge-pr-${prNumber}-${exactHead.slice(0, 12)}`,
      decisionKind: OPERATOR_DECISION_KIND.MERGE_APPROVAL,
      status: OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
      relatedGoal: text(goal.issue, `PR #${prNumber}`),
      relatedPr: `#${prNumber}`,
      expectedHeadSha: exactHead,
      summary: `Approve protected merge progression for PR #${prNumber}.`,
    }));
  }

  return Object.freeze(decisions);
}

export function buildGoalDashboardMaintenanceActions(goals = []) {
  return Object.freeze(list(goals).flatMap((goal) => {
    const blockers = list(goal.blockers).map((item) => text(typeof item === 'string' ? item : item?.summary || item?.id)).filter(Boolean);
    const needsMaintenance = blockers.length > 0 || !isCurrent(goal.statusTruth) || !isCurrent(goal.proofTruth);
    if (!needsMaintenance || isApprovalReadyPullRequest(goal)) return [];
    const relatedGoal = text(goal.issue || goal.goalId, 'GOAL');
    return [Object.freeze({
      actionId: `maintain-${safeSlug(relatedGoal)}`,
      actionClass: 'EVIDENCE_MAINTENANCE',
      relatedGoal,
      title: text(goal.title, 'Refresh project evidence'),
      summary: text(goal.summary, 'This project item needs its saved status or proof refreshed.'),
      exactNextAction: text(goal.exactNextAction, 'Refresh the canonical project record and attach current evidence.'),
      blockers: Object.freeze(blockers),
      owner: 'codex-housekeeper',
      operatorDecisionRequired: false,
    })];
  }));
}

function mergeDecisionFromParkedReview(item) {
  if (item.requiredAuthorityClass !== 'PROTECTED_MERGE') return null;
  return createOperatorDecision({
    decisionId: `merge-pr-${item.prNumber}-${item.exactHead.slice(0, 12)}`,
    decisionKind: OPERATOR_DECISION_KIND.MERGE_APPROVAL,
    status: OPERATOR_DECISION_STATUS.WAITING_FOR_OPERATOR_APPROVAL,
    relatedGoal: `#${item.issueNumber}`,
    relatedPr: `#${item.prNumber}`,
    expectedHeadSha: item.exactHead,
    summary: `Review protected merge for PR #${item.prNumber}.`,
  });
}

export function buildGoalDashboardOperatorAttention(input = {}) {
  const goals = list(input.goals);
  const blockers = [...new Set(list(input.blockers).map((item) => text(item)).filter(Boolean))];
  const parkedReviewBatch = buildOperatorReviewReadyBatchV1(input.parkedReviewEntries);
  const parkedDecisions = parkedReviewBatch.state === OPERATOR_REVIEW_PARKING_STATE.SAFE_HOLD
    ? []
    : parkedReviewBatch.ready.map(mergeDecisionFromParkedReview).filter(Boolean);
  const explicitDecisions = [...list(input.explicitDecisions), ...parkedDecisions];
  const approvals = buildGoalDashboardApprovalDecisions(goals, explicitDecisions);
  const maintenanceActions = buildGoalDashboardMaintenanceActions(goals);
  if (parkedReviewBatch.state === OPERATOR_REVIEW_PARKING_STATE.SAFE_HOLD) {
    blockers.push('OPERATOR_REVIEW_READY_BATCH_SAFE_HOLD');
  }
  const exactNextAction = text(
    input.exactNextAction,
    parkedReviewBatch.readyCount
      ? `Review ${parkedReviewBatch.readyCount} current parked goal${parkedReviewBatch.readyCount === 1 ? '' : 's'}; construction capacity remains released while they wait.`
      : (approvals.length
        ? 'Review the genuine operator decisions; protected actions retain their separate exact approval gate.'
        : (maintenanceActions.length
          ? 'Codex and Housekeeper should refresh the stale or missing project records without asking the operator to approve routine maintenance.'
          : 'No operator decision or maintenance action is currently published.')),
  );
  return Object.freeze({
    approvals,
    parkedReviewBatch,
    maintenanceActions,
    localProofNeeded: Object.freeze(goals.filter((goal) => !isCurrent(goal.proofTruth)).map((goal) => text(goal.issue || goal.goalId, 'GOAL'))),
    blockers: Object.freeze([...new Set(blockers)]),
    exactNextAction,
  });
}
