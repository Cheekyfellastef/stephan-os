import { buildHealthDiagnostics } from '../config/runtimeConfig.js';
import { buildConciergeQueue, buildConciergeRoadmap, buildConciergePostMergeSync, buildConciergeAntiStallMergeLane } from '../../shared/agents/battleBridgeBuildConciergeV2.mjs';
import { readWorkspaceUpdateStatus } from './workspaceUpdateStatusService.js';
import { readBuildConciergeGoalReceipts } from './buildConciergeGoalService.js';
import { readMissionOperations } from './missionOperationsService.js';
import { readImportedGoalReceipts } from './goalIngestionService.js';
import { buildExecutionChains, readGithubTelemetry } from './githubTelemetryService.js';
import { buildConciergeExecutionEngineV9 } from '../../shared/agents/buildConciergeExecutionEngineV9.mjs';

function list(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = 'unknown') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }
function timestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizedStatus(value = '') { return text(value).trim().toLowerCase(); }
function candidateIdentityKeys(candidate = {}) {
  return unique([
    text(candidate.candidateId || candidate.id || candidate.relatedGoal || candidate.issue || candidate.issueNumber, ''),
    candidate.title ? `title:${normalizedStatus(candidate.title)}` : '',
  ]);
}
function issueScore(issue, linkedPullRequests = []) {
  const labels = list(issue.labels).map((label) => normalizedStatus(label));
  const priorityLabel = labels.some((label) => /\b(p0|p1|priority|critical|active)\b/.test(label));
  const goalLabel = labels.some((label) => /\b(goal|mission|programme)\b/.test(label));
  const goalTitle = /\b(goal|mission|programme|dashboard|controller|repair|build)\b/i.test(text(issue.title, ''));
  return (linkedPullRequests.length ? 1_000_000_000_000_000 : 0)
    + (priorityLabel ? 100_000_000_000_000 : 0)
    + (goalLabel ? 10_000_000_000_000 : 0)
    + (goalTitle ? 1_000_000_000_000 : 0)
    + timestamp(issue.updatedAt);
}
function prStatus(pr = {}) {
  const checks = normalizedStatus(pr.checksStatus);
  const approval = normalizedStatus(pr.approvalStatus);
  if (checks === 'failed') return 'BLOCKED';
  if (checks === 'pending') return 'VERIFYING';
  if (pr.draft === true) return 'BUILDING';
  if (checks === 'passed' && approval === 'approved') return 'REVIEW PASSED · RUNTIME PROOF UNKNOWN';
  if (checks === 'passed') return 'READY FOR REVIEW';
  return 'PR OPEN · PROOF UNKNOWN';
}
function prNextAction(pr = {}) {
  const checks = normalizedStatus(pr.checksStatus);
  const approval = normalizedStatus(pr.approvalStatus);
  if (checks === 'failed') return `Repair failing checks on PR #${pr.number}; rerun exact-head verification.`;
  if (checks === 'pending') return `Wait for PR #${pr.number} checks, then inspect the exact-head result.`;
  if (pr.draft === true) return `Continue the bounded build on draft PR #${pr.number}; passing checks do not declare it ready for review.`;
  if (checks === 'passed' && approval === 'approved') return `Run the required runtime/browser proof for PR #${pr.number}; GitHub review does not grant operator approval.`;
  if (checks === 'passed') return `Request independent exact-head review for PR #${pr.number}; do not infer approval.`;
  return `Inspect PR #${pr.number} checks and proof; unknown remains unknown.`;
}
function prProofIndex(pr = {}) {
  const checks = normalizedStatus(pr.checksStatus);
  const approval = normalizedStatus(pr.approvalStatus);
  if (checks === 'passed' && approval === 'approved') return 5;
  if (checks === 'passed') return 4;
  if (checks === 'pending' || checks === 'failed') return 3;
  return 2;
}
function operatorNeededForPr(pr = {}) {
  return false;
}
function projectedPr(pr = {}) {
  return Object.freeze({
    number: pr.number,
    url: pr.url,
    branch: pr.branch,
    headSha: pr.headSha,
    draft: pr.draft,
    checksStatus: pr.checksStatus,
    approvalStatus: pr.approvalStatus,
    mergeReadiness: pr.mergeReadiness,
    supersededStatus: pr.supersededStatus,
  });
}
function cardPullRequestNumbers(card = {}) {
  return [
    ...list(card.linkedPullRequests).map((pr) => pr.number),
    card.linkedPr?.number,
  ].filter(Boolean);
}
function activeLinkedPullRequests(linkedPullRequests = []) {
  return [...linkedPullRequests]
    .filter((pr) => normalizedStatus(pr.supersededStatus) !== 'superseded')
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt));
}
function linkedPrAggregate(linkedPullRequests = []) {
  const prs = activeLinkedPullRequests(linkedPullRequests);
  if (!prs.length) return Object.freeze({ prs, representative: null, status: 'QUEUED · NO ACTIVE PR', checks: 'unknown', review: 'unknown' });
  const byChecks = (state) => prs.filter((pr) => normalizedStatus(pr.checksStatus) === state);
  const failed = byChecks('failed');
  if (failed.length) return Object.freeze({ prs, representative: failed[0], status: 'BLOCKED', checks: 'failed', review: 'unknown' });
  const pending = byChecks('pending');
  if (pending.length) return Object.freeze({ prs, representative: pending[0], status: 'VERIFYING', checks: 'pending', review: 'unknown' });
  const unknown = prs.filter((pr) => normalizedStatus(pr.checksStatus) !== 'passed');
  if (unknown.length) return Object.freeze({ prs, representative: unknown[0], status: 'PR OPEN · PROOF UNKNOWN', checks: 'unknown', review: 'unknown' });
  const drafts = prs.filter((pr) => pr.draft === true);
  if (drafts.length) return Object.freeze({ prs, representative: drafts[0], status: 'BUILDING', checks: 'passed', review: 'unknown' });
  const allApproved = prs.every((pr) => normalizedStatus(pr.approvalStatus) === 'approved');
  return Object.freeze({
    prs,
    representative: prs[0],
    status: allApproved ? 'REVIEW PASSED · RUNTIME PROOF UNKNOWN' : 'READY FOR REVIEW',
    checks: 'passed',
    review: allApproved ? 'approved' : 'unknown',
  });
}
function issueGoalCard(issue, linkedPullRequests = [], observedAt) {
  const aggregate = linkedPrAggregate(linkedPullRequests);
  const linkedPr = aggregate.representative;
  const linkedPrNumbers = aggregate.prs.map((pr) => `#${pr.number}`).join(', ');
  const status = aggregate.status;
  const operatorNeeded = linkedPr ? operatorNeededForPr(linkedPr) : false;
  const nextAction = linkedPr
    ? `${aggregate.prs.length > 1 ? `Reconcile every unsuperseded linked PR (${linkedPrNumbers}); ` : ''}${prNextAction(linkedPr)}`
    : 'Select this durable goal through the canonical scheduler before starting a build lane.';
  return Object.freeze({
    issue: `#${issue.number}`,
    issueNumber: issue.number,
    url: issue.url,
    title: issue.title,
    status,
    statusTruth: 'CURRENT',
    sourceTruth: 'LIVE READ-ONLY GITHUB',
    source: 'github-readonly-adapter',
    observedAt,
    lastUpdatedAt: issue.updatedAt || observedAt,
    labels: list(issue.labels),
    currentOwner: linkedPr ? (operatorNeeded ? 'Operator' : 'Codex / review lane') : 'Programme queue',
    nextOwner: linkedPr ? (operatorNeeded ? 'Guarded merge lane' : 'Independent reviewer') : 'Bounded construction lane',
    handoffState: linkedPr ? `issue #${issue.number} → PR${aggregate.prs.length > 1 ? 's' : ''} ${linkedPrNumbers} → ${aggregate.checks}` : `issue #${issue.number} → no active PR`,
    milestone: linkedPr ? (aggregate.prs.length > 1 ? `${aggregate.prs.length} UNSUPERSEDED PRS · CONSERVATIVE PROOF` : `PR #${linkedPr.number} · ${linkedPr.headSha ? linkedPr.headSha.slice(0, 10) : 'HEAD UNKNOWN'}`) : 'DURABLE GOAL RECORDED',
    operatorNeeded: operatorNeeded ? 'Yes · exact-head decision' : 'No',
    proofIndex: linkedPr ? Math.min(...aggregate.prs.map((pr) => prProofIndex(pr))) : 1,
    nextAction,
    proofTruth: {
      github: 'CURRENT',
      checks: aggregate.checks,
      review: aggregate.review,
      runtime: 'unknown',
      browser: 'unknown',
    },
    linkedPr: linkedPr ? projectedPr(linkedPr) : null,
    linkedPullRequests: aggregate.prs.map(projectedPr),
  });
}
function receiptGoalCard(candidate = {}, observedAt) {
  const candidateId = text(candidate.candidateId || candidate.id || candidate.relatedGoal || candidate.title, 'receipt-goal');
  const status = text(candidate.status || candidate.state, 'QUEUED').toUpperCase();
  return Object.freeze({
    issue: text(candidate.relatedGoal || candidate.issue || candidate.issueNumber, candidateId),
    issueNumber: null,
    url: '',
    title: text(candidate.title, 'Receipt-backed goal'),
    status,
    statusTruth: 'RECEIPT PROVIDED',
    sourceTruth: 'READ-ONLY RECEIPT',
    source: 'mission-operations-receipt',
    observedAt,
    lastUpdatedAt: text(candidate.updatedAt || candidate.createdAt, observedAt),
    labels: [],
    currentOwner: text(candidate.currentOwner || candidate.owner, 'Build Concierge queue'),
    nextOwner: text(candidate.nextOwner, 'Canonical dispatcher'),
    handoffState: text(candidate.handoffState, 'receipt → queue evaluation'),
    milestone: text(candidate.milestone, 'RECEIPT_BACKED_GOAL'),
    operatorNeeded: 'No',
    proofIndex: 1,
    nextAction: text(candidate.nextAction, 'Inspect the receipt-backed queue state before dispatch.'),
    proofTruth: { github: 'unknown', checks: 'unknown', review: 'unknown', runtime: 'receipt-provided', browser: 'unknown' },
    linkedPr: null,
  });
}
function orphanPrGoalCard(pr = {}, observedAt) {
  return Object.freeze({
    issue: `PR #${pr.number}`,
    issueNumber: null,
    url: '',
    title: pr.title,
    status: 'BLOCKED · DURABLE GOAL LINK UNKNOWN',
    statusTruth: 'CURRENT',
    sourceTruth: 'LIVE READ-ONLY GITHUB',
    source: 'github-readonly-adapter',
    observedAt,
    lastUpdatedAt: pr.updatedAt || observedAt,
    labels: [],
    currentOwner: 'Codex / review lane',
    nextOwner: 'Programme controller',
    handoffState: `PR #${pr.number} → no durable goal issue identified`,
    milestone: `PR #${pr.number} · ${pr.headSha ? pr.headSha.slice(0, 10) : 'HEAD UNKNOWN'}`,
    operatorNeeded: 'No',
    proofIndex: 2,
    nextAction: `Bind PR #${pr.number} to its durable GitHub goal issue before treating it as programme progress.`,
    proofTruth: {
      github: 'CURRENT',
      checks: pr.checksStatus || 'unknown',
      review: pr.approvalStatus || 'unknown',
      runtime: 'unknown',
      browser: 'unknown',
    },
    linkedPr: {
      number: pr.number,
      url: pr.url,
      branch: pr.branch,
      headSha: pr.headSha,
      draft: pr.draft,
      checksStatus: pr.checksStatus,
      approvalStatus: pr.approvalStatus,
      mergeReadiness: pr.mergeReadiness,
    },
  });
}

export function buildLiveDashboardGoals({ githubTelemetry = {}, queue = {}, missions = [], historicalCandidates = [], observedAt = new Date().toISOString(), limit = 12 } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 24) : 12;
  if (
    githubTelemetry.adapterAvailable === true
    && githubTelemetry.issueInventoryObserved === true
    && githubTelemetry.issueInventoryComplete === true
    && githubTelemetry.pullRequestInventoryComplete === true
  ) {
    const pullRequests = list(githubTelemetry.pullRequests);
    const openIssues = list(githubTelemetry.issues).filter((issue) => normalizedStatus(issue.state) === 'open');
    const ranked = openIssues
      .map((issue) => {
        const linkedPullRequests = pullRequests.filter((pr) => list(pr.relatedIssues).includes(issue.number));
        return { issue, linkedPullRequests, score: issueScore(issue, linkedPullRequests) };
      })
      .sort((left, right) => right.score - left.score || right.issue.number - left.issue.number);
    const linkedPrNumbers = new Set(ranked.flatMap(({ linkedPullRequests }) => linkedPullRequests.map((pr) => pr.number)));
    const orphanPrCards = pullRequests
      .filter((pr) => !linkedPrNumbers.has(pr.number))
      .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))
      .map((pr) => orphanPrGoalCard(pr, observedAt));
    const rankedCards = [
      ...ranked.filter(({ linkedPullRequests }) => linkedPullRequests.length).map(({ issue, linkedPullRequests }) => issueGoalCard(issue, linkedPullRequests, observedAt)),
      ...orphanPrCards,
      ...ranked.filter(({ linkedPullRequests }) => !linkedPullRequests.length).map(({ issue, linkedPullRequests }) => issueGoalCard(issue, linkedPullRequests, observedAt)),
    ];
    const cards = rankedCards.slice(0, safeLimit);
    const operatorAttention = cards.filter((card) => card.operatorNeeded.startsWith('Yes'));
    return Object.freeze({
      schemaVersion: 'stephanos.live-dashboard-goals.v1',
      sourceTruth: 'LIVE READ-ONLY GITHUB',
      freshnessVerdict: 'CURRENT_AT_REQUEST',
      observedAt,
      totalAvailable: rankedCards.length,
      displayedCount: cards.length,
      activePrCount: new Set(rankedCards.flatMap(cardPullRequestNumbers)).size,
      blockedCount: cards.filter((card) => card.status.startsWith('BLOCKED')).length,
      readyCount: cards.filter((card) => card.status.startsWith('READY')).length,
      operatorAttentionCount: operatorAttention.length,
      cards,
      nextAction: operatorAttention[0]?.nextAction || cards[0]?.nextAction || 'No open goal issues were returned by the verified read-only GitHub adapter.',
    });
  }

  const historicalReferences = list(historicalCandidates).map((candidate) => Object.freeze({
    candidateId: text(candidate.candidateId || candidate.id || candidate.title, 'historical-goal'),
    title: text(candidate.title, 'Imported historical goal'),
    verificationState: 'imported_unverified',
    importedAt: text(candidate.importedAt || candidate.createdAt || candidate.updatedAt, 'unknown'),
  }));
  const historicalCandidateKeys = new Set(list(historicalCandidates).flatMap((candidate) => candidateIdentityKeys(candidate)));
  const receiptCandidates = [
    ...list(queue.activeProofLane),
    ...list(queue.queuedCandidates),
    ...list(missions).map((mission) => ({
      candidateId: mission.mission?.missionId || mission.missionId,
      title: mission.mission?.title || mission.title,
      status: mission.mission?.state || mission.state,
      currentOwner: mission.agent?.label || mission.activeAgent?.label,
      nextAction: mission.mission?.nextAction || mission.nextAction,
      updatedAt: mission.mission?.updatedAt || mission.updatedAt,
      currentReceiptAuthority: true,
    })),
  ];
  const seen = new Set();
  const currentReceiptCandidates = receiptCandidates
    .filter((candidate) => {
      const keys = candidateIdentityKeys(candidate);
      const key = keys[0] || text(candidate.title);
      if (keys.some((candidateKey) => historicalCandidateKeys.has(candidateKey)) && candidate.currentReceiptAuthority !== true) return false;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const cards = currentReceiptCandidates
    .slice(0, safeLimit)
    .map((candidate) => receiptGoalCard(candidate, observedAt));
  return Object.freeze({
    schemaVersion: 'stephanos.live-dashboard-goals.v1',
    sourceTruth: cards.length ? 'READ-ONLY RECEIPTS' : 'UNKNOWN',
    freshnessVerdict: cards.length ? 'RECEIPT_TIMESTAMPS_VISIBLE' : 'NO_CURRENT_GOAL_RECORDS',
    observedAt,
    totalAvailable: currentReceiptCandidates.length,
    displayedCount: cards.length,
    activePrCount: 0,
    blockedCount: cards.filter((card) => /BLOCKED|FAILED/.test(card.status)).length,
    readyCount: cards.filter((card) => /READY/.test(card.status)).length,
    operatorAttentionCount: 0,
    cards,
    historicalReferenceCount: historicalReferences.length,
    historicalReferences,
    nextAction: cards[0]?.nextAction || (historicalReferences.length
      ? `${historicalReferences.length} imported historical reference(s) remain unverified and are excluded from current cards; publish a current canonical receipt or restore complete GitHub truth.`
      : 'Configure the read-only GitHub adapter or publish current canonical mission receipts.'),
  });
}

export function buildLiveGoalProjection(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const feed = input.missionOperationsFeed || {};
  const buildConcierge = input.buildConcierge || feed.buildConcierge || {};
  const importedGoals = input.importedGoals || buildConcierge.importedGoals || { receipts: [], candidates: [] };
  const updateStatus = input.updateStatus || feed.updateStatus || {};
  const githubTelemetry = input.githubTelemetry || feed.githubTelemetry || { status: 'adapter_unavailable', adapterAvailable: false, notificationCounts: {}, pullRequests: [], workflows: [], blockers: ['github_adapter_unavailable'] };
  const currentCreatedCandidates = list(input.createdGoalCandidates);
  const currentAuthorityKeys = new Set([
    ...currentCreatedCandidates.flatMap((candidate) => candidateIdentityKeys(candidate)),
    ...list(feed.missions).flatMap((mission) => candidateIdentityKeys({
      candidateId: mission.mission?.missionId || mission.missionId,
      title: mission.mission?.title || mission.title,
    })),
  ]);
  const historicalCandidates = list(importedGoals.candidates).filter((candidate) => (
    !candidateIdentityKeys(candidate).some((candidateKey) => currentAuthorityKeys.has(candidateKey))
  ));
  const historicalCandidateKeys = new Set(historicalCandidates.flatMap((candidate) => candidateIdentityKeys(candidate)));
  const isCurrentCandidate = (candidate) => (
    !candidateIdentityKeys(candidate).some((candidateKey) => historicalCandidateKeys.has(candidateKey))
  );
  const historicalImportPresent = list(importedGoals.candidates).length > 0 || list(importedGoals.receipts).length > 0;
  const suppliedQueue = historicalImportPresent
    ? buildConciergeQueue({ goals: currentCreatedCandidates })
    : (buildConcierge.queue || buildConciergeQueue({ goals: currentCreatedCandidates }));
  const queue = {
    ...suppliedQueue,
    queuedCandidates: list(suppliedQueue.queuedCandidates).filter(isCurrentCandidate),
    activeProofLane: list(suppliedQueue.activeProofLane).filter(isCurrentCandidate),
    blockedCandidates: list(suppliedQueue.blockedCandidates).filter(isCurrentCandidate),
    completedCandidates: list(suppliedQueue.completedCandidates).filter(isCurrentCandidate),
    rejectedCandidates: list(suppliedQueue.rejectedCandidates).filter(isCurrentCandidate),
  };
  if (queue.nextSafeCandidate && !isCurrentCandidate(queue.nextSafeCandidate)) queue.nextSafeCandidate = null;
  const queuedCandidates = list(queue.queuedCandidates);
  const activeProofLane = list(queue.activeProofLane);
  const blockedCandidates = list(queue.blockedCandidates);
  const completedCandidates = list(queue.completedCandidates);
  const rejectedCandidates = list(queue.rejectedCandidates);
  const currentReceipts = [
    ...list(buildConcierge.createdGoalReceipts),
    ...list(feed.missions).flatMap((mission) => list(mission.receipts)),
  ];
  const receipts = currentReceipts;
  const executionEngine = buildConciergeExecutionEngineV9({ receipts: currentReceipts });
  const blockers = unique([
    ...list(queue.blockers),
    ...list(executionEngine.blockers),
    ...blockedCandidates.flatMap((candidate) => list(candidate.blockers || candidate.rejectionReasons)),
    ...list(feed.errors).map((error) => error.error || error.message || String(error)),
    ...list(githubTelemetry.blockers),
  ]);
  const backendHealthy = input.backendStatus?.ok === true || input.backendStatus?.status === 'ok' || input.backendStatus?.status === 'live';
  const missionLive = ['ready', 'empty'].includes(text(feed.status, 'unknown'));
  const hasLiveGoalTruth = queuedCandidates.length || currentReceipts.length || list(feed.missions).length;
  const sourceTruth = backendHealthy && missionLive && hasLiveGoalTruth ? 'live' : (backendHealthy ? 'mixed' : 'static-fallback');
  const githubTruth = githubTelemetry.adapterAvailable === true ? 'adapter-provided' : (queue.autoPick?.liveGithubProof === 'adapter-provided' || queue.autoPick?.liveGithubProof === 'receipt-provided' ? queue.autoPick.liveGithubProof : 'unknown');
  const localProofTruth = currentReceipts.some((receipt) => /proof|command/i.test(`${receipt.receiptType || ''} ${receipt.status || ''}`)) ? 'receipt-provided' : 'unknown';
  const browserProofTruth = buildConcierge.browserProofPacket?.browserProofStatus || buildConcierge.proofPacketSummary?.browserProof || 'unknown';
  const dashboardGoals = buildLiveDashboardGoals({ githubTelemetry, queue, missions: list(feed.missions), historicalCandidates, observedAt: now.toISOString() });
  const staleWarnings = [];
  if (feed.projectionSource === 'static-goal-dashboard-seed' || feed.githubTruth === 'not-live-readonly-static-seed') staleWarnings.push('Static goal-dashboard seed is not presented as live truth.');
  if (githubTruth === 'unknown') staleWarnings.push('GitHub truth is unknown; no receipt/adapter supplied live GitHub proof.');
  if (localProofTruth === 'unknown') staleWarnings.push('Local proof is unknown; no proof receipt supplied local proof.');
  if (browserProofTruth === 'unknown') staleWarnings.push('Browser proof is unknown; no browser proof packet supplied browser proof.');
  return Object.freeze({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: now.toISOString(),
    projectionSource: 'live-goal-projection-service',
    generatedAtAgeSeconds: Math.max(0, Math.floor((Date.now() - now.getTime()) / 1000)),
    heartbeat: {
      generatedAt: now.toISOString(),
      generatedAtAgeSeconds: Math.max(0, Math.floor((Date.now() - now.getTime()) / 1000)),
      backendLive: backendHealthy,
      projectionSource: 'live-goal-projection-service',
      watchedGoals: executionEngine.watchedGoalCount || receipts.length,
      classifiedGoals: executionEngine.classifiedGoalCount || 0,
      manualDispatchRequired: executionEngine.manualDispatchRequiredCount || 0,
      staleUnknownWarnings: unique(staleWarnings),
      githubNotificationCount: list(githubTelemetry.notifications).length,
      githubOpenPrCount: list(githubTelemetry.pullRequests).length,
      githubWorkflowCount: list(githubTelemetry.workflows).length,
    },
    importedGoals: { status: importedGoals.receipts?.length ? 'present' : 'none', verificationState: importedGoals.receipts?.length ? 'imported_unverified' : 'none', receipts: list(importedGoals.receipts), candidates: list(importedGoals.candidates) },
    githubTelemetry,
    dashboardGoals,
    executionChains: buildExecutionChains({ goals: currentCreatedCandidates, githubTelemetry }),
    sourceTruth,
    backendStatus: input.backendStatus || { status: backendHealthy ? 'live' : 'unknown', healthRoute: '/api/health' },
    missionOperationsStatus: { status: text(feed.status, 'unknown'), source: text(feed.source, 'unknown'), route: '/api/mission-operations' },
    buildConciergeStatus: { status: text(queue.status, 'unknown'), roadmap: buildConcierge.roadmap || buildConciergeRoadmap(), postMergeSync: buildConcierge.postMergeSync || buildConciergePostMergeSync({}), antiStallMergeLane: buildConcierge.antiStallMergeLane || buildConciergeAntiStallMergeLane({}), executionEngine },
    executionEngine,
    totalGoals: queuedCandidates.length + completedCandidates.length + rejectedCandidates.length,
    activeGoalCount: activeProofLane.length,
    queuedGoalCount: queuedCandidates.length,
    blockedGoalCount: blockedCandidates.length,
    completedGoalCount: completedCandidates.length,
    activeProofLane,
    queuedCandidates,
    blockedCandidates,
    completedCandidates,
    rejectedCandidates,
    nextSafeCandidate: queue.nextSafeCandidate || null,
    currentAgentStates: {
      operator: { state: 'approval_authority', truth: 'intent-authority' },
      stephanos: { state: backendHealthy ? 'backend_reachable' : 'unknown', truth: backendHealthy ? 'live' : 'unknown' },
      codex: { state: 'not_dispatched', truth: 'no-dispatch-from-projection' },
      openclaw: { state: 'unknown', truth: 'no-live-openclaw-proof-without-receipt' },
      github: { state: githubTelemetry.adapterAvailable === true ? 'adapter-provided' : 'adapter_unavailable', truth: githubTruth },
      battleBridge: { state: text(queue.oneActiveLaneGuardrail, 'unknown'), truth: 'build-concierge-queue' },
    },
    approvals: buildConcierge.approvalDecision || { status: 'unknown', mergeAllowed: false },
    proofTruth: { github: githubTruth, local: localProofTruth, browser: browserProofTruth },
    blockers,
    receipts,
    staleWarnings: unique(staleWarnings),
    workspaceUpdateStatus: updateStatus,
    nextOperatorAction: executionEngine.nextOperatorAction || queue.nextOperatorAction || feed.recommendedNextAction || updateStatus.nextOperatorAction || 'Inspect live Mission Control projection; unknown stays unknown.',
    finalVerdict: blockers.length ? 'LIVE_GOAL_PROJECTION_BLOCKED_OR_UNKNOWN' : (sourceTruth === 'live' ? 'LIVE_GOAL_PROJECTION_READY' : 'LIVE_GOAL_PROJECTION_MIXED_OR_STATIC_FALLBACK'),
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  });
}

export async function readLiveGoalProjection(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const updateStatus = options.updateStatus || await readWorkspaceUpdateStatus(options.updateStatusOptions || {});
  const buildConciergeGoals = options.buildConciergeGoals || await readBuildConciergeGoalReceipts(options.buildConciergeGoalOptions || {});
  const importedGoals = options.importedGoals || await readImportedGoalReceipts(options.goalIngestionOptions || {});
  const githubTelemetry = options.githubTelemetry || await readGithubTelemetry(options.githubTelemetryOptions || {});
  const missionOperationsFeed = options.missionOperationsFeed || await readMissionOperations({ ...(options.missionOperationsOptions || {}), updateStatus, buildConciergeGoals, importedGoals, githubTelemetry, includeLiveGoalProjection: false, now });
  const backendStatus = options.backendStatus || { status: 'live', ok: true, healthRoute: '/api/health', freshness: 'request-generated', diagnostics: buildHealthDiagnostics(process.env, null, {}) };
  return buildLiveGoalProjection({ now, updateStatus, missionOperationsFeed, backendStatus, buildConcierge: { ...(missionOperationsFeed.buildConcierge || {}), importedGoals }, createdGoalCandidates: buildConciergeGoals.candidates, importedGoals, githubTelemetry });
}
