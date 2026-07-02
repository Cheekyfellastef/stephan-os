import { BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP } from './battleBridgeBuildConciergeRoadmap.mjs';
export { BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP } from './battleBridgeBuildConciergeRoadmap.mjs';
const SHA40 = /^[a-f0-9]{40}$/;
const PR_NUMBER = /^[1-9][0-9]*$/;
const SAFE_COMMANDS = new Set([
  'npm test',
  'npm run build',
  'npm run verify',
  'npm run stephanos:build',
  'npm run stephanos:verify',
  'npm run stephanos:browser-proof',
  'npm run test:ui:reality',
  'node --test',
]);

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function normalizeCommand(command) {
  return Array.isArray(command) ? command.map(text).filter(Boolean).join(' ') : text(command).replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function knownBoolean(value) {
  return value === true ? true : value === false ? false : 'unknown';
}

function candidateId(candidate, fallbackIndex = 0) {
  const pr = Number.parseInt(candidate.number ?? candidate.prNumber, 10);
  return PR_NUMBER.test(String(pr)) ? `PR #${pr}` : text(candidate.id || candidate.goalId || candidate.issue, `candidate-${fallbackIndex + 1}`);
}

export function normalizeConciergeBrowserProof(input = {}) {
  const source = input.browserProofPacket && typeof input.browserProofPacket === 'object'
    ? input.browserProofPacket
    : (input.browserProof && typeof input.browserProof === 'object' ? input.browserProof : input);
  const runnerAvailable = source.runnerAvailable === true || source.browserRuntimeAvailable === true || source.status === 'verified' || source.browserProofStatus === 'verified';
  const screenshotPath = text(source.screenshotPath);
  const unavailableReason = text(source.unavailableReason || source.proofUnavailableBlocker || source.blocker);
  const checklistItems = Array.isArray(source.checklist) ? source.checklist : (Array.isArray(source.checklistItems) ? source.checklistItems : []);
  const checklist = checklistItems.map((item) => (typeof item === 'object' && item ? {
    item: text(item.item || item.label || item.name, 'unnamed checklist item'),
    status: text(item.status, item.passed === true ? 'passed' : 'unknown'),
  } : { item: text(item, 'unnamed checklist item'), status: 'unknown' }));
  const consoleErrors = list(source.consoleErrors);
  const caveats = list(source.caveats);
  const checklistStatus = text(source.checklistStatus, checklist.length ? (checklist.every((item) => item.status === 'passed') ? 'passed' : 'blocked_or_unknown') : 'unknown');
  const explicitStatus = text(source.browserProofStatus || source.status);
  const verified = explicitStatus === 'verified' && runnerAvailable && Boolean(screenshotPath) && checklistStatus === 'passed';
  const proofUnavailableBlocker = verified ? '' : (unavailableReason || (!runnerAvailable ? 'Browser proof runner/runtime unavailable; browser proof was not captured.' : (!screenshotPath ? 'Browser screenshot path is unavailable.' : (checklistStatus !== 'passed' ? 'Browser proof checklist is not passed.' : 'Browser proof remains unknown.'))));
  return {
    browserProofStatus: verified ? 'verified' : (proofUnavailableBlocker ? 'blocked_unavailable' : 'unknown'),
    screenshotPath,
    screenshotUnavailableReason: screenshotPath ? '' : proofUnavailableBlocker,
    checklistStatus,
    checklist,
    consoleErrors,
    caveats,
    proofUnavailableBlocker,
    runnerAvailable,
  };
}

export const BATTLE_BRIDGE_CONCIERGE_SCHEMA = 'stephanos.battle-bridge-build-concierge.v7';
export const BATTLE_BRIDGE_CONCIERGE_PREVIOUS_SCHEMA = 'stephanos.battle-bridge-build-concierge.v3';

export const BATTLE_BRIDGE_BUILD_CONCIERGE_SUCCESS_MARKERS = [
  'GOAL_COMPLETE_BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP',
  'NO_CLICK_MONKEY_LOOP',
  'INTENT_ENGINE_APPROVAL_ONLY',
];

export function buildConciergeRoadmap(input = {}) {
  const overrides = input.roadmapStatus && typeof input.roadmapStatus === 'object' ? input.roadmapStatus : {};
  const phases = BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.map((phase) => ({
    ...phase,
    status: text(overrides[phase.version], phase.status),
  }));
  const activePhase = phases.find((phase) => !['implemented', 'implemented_guarded'].includes(phase.status)) || phases[phases.length - 1];
  return {
    mission: 'Stephan is the intent engine and approval authority; Concierge plans, proves, receipts, and blocks rather than acting as an unapproved command runner.',
    activePhase,
    phases,
    successMarkers: [...BATTLE_BRIDGE_BUILD_CONCIERGE_SUCCESS_MARKERS],
    guardrails: {
      exactHeadApprovalRequired: true,
      unsafeCommandExecutionAllowed: false,
      dirtyTreeAutomaticMutationAllowed: false,
      fakeGithubProofAllowed: false,
      fakeLocalProofAllowed: false,
      fakeBrowserProofAllowed: false,
      pcRestartAllowed: false,
      unknownStaysUnknown: true,
      visibleReceiptsOrExplicitBlockersRequired: true,
    },
    nextOperatorAction: activePhase.version === 'V2'
      ? 'Review the V2 operator surfaces and declared proof/approval state before authorizing further automation.'
      : `Implement ${activePhase.version} only with isolated proof, visible receipts, and exact operator approval boundaries.`,
  };
}


export function battleBridgeMergeApprovalToken({ prNumber, headSha } = {}) {
  const pr = Number.parseInt(prNumber, 10);
  return `APPROVE_BATTLE_BRIDGE_EXACT_HEAD_MERGE:${pr}:${text(headSha)}`;
}

export function validateConciergeCommand(command) {
  const normalized = normalizeCommand(command);
  const exact = SAFE_COMMANDS.has(normalized);
  const nodeTestFile = /^node --test [A-Za-z0-9_./-]+\.test\.(mjs|js)$/.test(normalized) && !normalized.includes('..');
  return {
    command: normalized,
    allowed: exact || nodeTestFile,
    blocker: exact || nodeTestFile ? '' : `Command is outside the Battle Bridge allowlist: ${normalized || '<empty>'}`,
  };
}

export function chooseSafeProofCandidates(input = {}) {
  return buildConciergeAutoPick(input).rankedCandidates;
}

export function buildConciergeAutoPick(input = {}) {
  const supplied = [
    ...(Array.isArray(input.candidates) ? input.candidates : []),
    ...(Array.isArray(input.pullRequests) ? input.pullRequests.map((candidate) => ({ ...candidate, candidateType: 'pull_request' })) : []),
    ...(Array.isArray(input.goals) ? input.goals.map((candidate) => ({ ...candidate, candidateType: 'goal' })) : []),
  ];
  const githubAdapterProvided = input.githubAdapterProvided === true || input.adapterProvided === true || Boolean(input.adapter);
  const liveGithubProof = githubAdapterProvided ? 'adapter-provided' : 'not-claimed';
  const rankedCandidates = supplied.map((pr, index) => {
    const blockers = [];
    const rejectionReasons = [];
    const prNumber = Number.parseInt(pr.number ?? pr.prNumber, 10);
    const headSha = text(pr.headSha || pr.headRefOid);
    const changedFiles = list(pr.changedFiles);
    const proofCommandInputs = Array.isArray(pr.proofCommands) ? pr.proofCommands : [];
    const proofCommands = proofCommandInputs
      .map(validateConciergeCommand);
    const state = text(pr.state || pr.status, 'unknown').toLowerCase();
    const openReadyState = /^(open|ready|active)$/.test(state) && pr.isDraft !== true;
    const mergeable = knownBoolean(pr.mergeable);
    const requiredChecksClean = pr.requiredChecksClean === true || /^(clean|passing|passed|success)$/.test(text(pr.requiredChecksStatus || pr.checksStatus).toLowerCase());
    const stale = pr.stale === true || /^(stale|outdated)$/.test(text(pr.freshness || pr.statusFreshness).toLowerCase());
    const explicitBlockers = list(pr.blockers);
    const exactHeadAvailable = SHA40.test(headSha);
    const unknowns = [];

    if (!PR_NUMBER.test(String(prNumber)) && text(pr.candidateType) === 'pull_request') blockers.push('PR number is unknown or invalid.');
    if (!exactHeadAvailable) blockers.push('Exact PR/goal head SHA is unknown or invalid.');
    if (state === 'unknown') unknowns.push('open/ready state unknown');
    if (!openReadyState) blockers.push('Candidate open/ready state is unknown or not ready.');
    if (pr.isDraft === true) blockers.push('Draft candidates stay inspect-only until marked ready by the author.');
    if (mergeable === 'unknown') unknowns.push('mergeability unknown');
    if (mergeable !== true) blockers.push(mergeable === false ? 'Candidate is explicitly not mergeable.' : 'Candidate mergeability is unknown.');
    if (!requiredChecksClean) blockers.push('Required checks are unknown or not clean.');
    if (!proofCommandInputs.length) blockers.push('Declared allowlisted proof commands are missing.');
    if (explicitBlockers.length) blockers.push(...explicitBlockers.map((blocker) => `Declared blocker: ${blocker}`));
    if (stale) blockers.push('Candidate status is stale or outdated.');
    if (changedFiles.some((file) => /(^|\/)(dist|node_modules|runtime|tmp)(\/|$)/i.test(file))) {
      blockers.push('Changed files include generated or forbidden runtime paths.');
    }
    for (const proof of proofCommands) if (!proof.allowed) blockers.push(proof.blocker);
    if (!githubAdapterProvided && (pr.liveGithubProof === true || pr.githubProof === 'live')) blockers.push('Live GitHub proof was requested but no explicit adapter was provided.');

    const safeToProof = blockers.length === 0 && unknowns.length === 0;
    if (!safeToProof) rejectionReasons.push(...unique([...blockers, ...unknowns]));
    const score = [
      openReadyState,
      mergeable === true,
      requiredChecksClean,
      proofCommands.length > 0 && proofCommands.every((proof) => proof.allowed),
      explicitBlockers.length === 0,
      exactHeadAvailable,
      !stale && unknowns.length === 0,
    ].filter(Boolean).length;
    return {
      candidateId: candidateId(pr, index),
      candidateType: text(pr.candidateType || pr.type, PR_NUMBER.test(String(prNumber)) ? 'pull_request' : 'goal'),
      prNumber,
      title: text(pr.title, 'Untitled PR'),
      headSha,
      branch: text(pr.branch || pr.headRefName),
      changedFiles,
      proofCommands: proofCommands.map((proof) => proof.command),
      openReadyState: openReadyState ? 'ready' : (state === 'unknown' ? 'unknown' : 'not_ready'),
      mergeability: mergeable === true ? 'mergeable' : mergeable === false ? 'not_mergeable' : 'unknown',
      requiredChecks: requiredChecksClean ? 'clean' : 'unknown_or_not_clean',
      blockerStatus: explicitBlockers.length ? 'blocked' : 'none_declared',
      exactHeadAvailability: exactHeadAvailable ? 'available' : 'unknown',
      staleStatus: stale ? 'stale' : (unknowns.length ? 'unknown' : 'fresh'),
      liveGithubProof,
      safeToProof,
      score,
      blockers: unique(blockers),
      rejectionReasons: unique(rejectionReasons),
      requiredApprovalToken: battleBridgeMergeApprovalToken({ prNumber, headSha }),
    };
  }).sort((left, right) => Number(right.safeToProof) - Number(left.safeToProof) || right.score - left.score || (left.prNumber || 999999) - (right.prNumber || 999999));
  const selectedCandidate = rankedCandidates.find((candidate) => candidate.safeToProof) || null;
  const rejectedCandidates = rankedCandidates.filter((candidate) => candidate !== selectedCandidate).map((candidate) => ({
    candidateId: candidate.candidateId,
    prNumber: candidate.prNumber,
    title: candidate.title,
    safeToProof: false,
    rejectionReasons: candidate.rejectionReasons.length ? candidate.rejectionReasons : ['A safer candidate ranked higher.'],
  }));
  const blockers = selectedCandidate ? [] : unique(rankedCandidates.flatMap((candidate) => candidate.rejectionReasons));
  return {
    schemaVersion: `${BATTLE_BRIDGE_CONCIERGE_SCHEMA}.v5-auto-pick`,
    selectedCandidate,
    rankedCandidates,
    rejectedCandidates,
    blockers,
    confidence: selectedCandidate ? (selectedCandidate.score >= 7 ? 'high' : 'medium') : 'low',
    liveGithubProof,
    githubAdapterProvided,
    commandExecutionAllowed: false,
    mergeAllowed: false,
    nextOperatorAction: selectedCandidate
      ? `Review selected ${selectedCandidate.candidateId}; run only declared allowlisted proof commands in the guarded proof lane.`
      : (blockers[0] || 'Supply fresh candidate records with exact-head, mergeability, clean checks, blockers, and declared proof commands.'),
  };
}

export function buildConciergeApprovalDecision(input = {}) {
  const selectedCandidate = input.selectedCandidate || input.candidate || {};
  const proofSummary = input.proofSummary || input.proofPacketSummary || {};
  const prNumber = Number.parseInt(selectedCandidate.prNumber || input.prNumber, 10);
  const headSha = text(selectedCandidate.headSha || input.headSha);
  const currentHeadSha = text(input.currentHeadSha || headSha);
  const approvalToken = battleBridgeMergeApprovalToken({ prNumber, headSha });
  const suppliedApprovalToken = text(input.approvalToken);
  const rejectRequested = input.reject === true || text(input.decision).toLowerCase() === 'reject';
  const approveRequested = input.approve === true || text(input.decision).toLowerCase() === 'approve' || Boolean(suppliedApprovalToken);
  const validation = validateExactHeadMergeApproval({ prNumber, headSha, currentHeadSha, approvalToken: suppliedApprovalToken });
  const proofReady = ['PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL', 'ready', 'verified'].includes(text(proofSummary.status || input.proofStatus));
  const blockers = [];
  if (!PR_NUMBER.test(String(prNumber))) blockers.push('Approval PR number is missing or invalid.');
  if (!SHA40.test(headSha)) blockers.push('Approval head SHA is missing or invalid.');
  if (!proofReady) blockers.push('Proof packet is not ready for exact-head approval.');
  if (rejectRequested) blockers.push(text(input.rejectionReason, 'Operator rejected this exact-head candidate.'));
  if (approveRequested && validation.blockers.length) blockers.push(...validation.blockers);
  const approvalStatus = rejectRequested ? 'blocked_by_rejection' : (approveRequested && proofReady && validation.mergeAllowed ? 'approved_exact_head' : (approveRequested ? 'blocked_invalid_token' : 'awaiting_operator_token'));
  const rejectionStatus = rejectRequested ? 'rejected_with_receipt' : 'not_rejected';
  const rejectionReceipt = rejectRequested ? {
    receiptType: 'battle-bridge-operator-rejection',
    status: 'blocks_merge',
    prNumber,
    headSha,
    reason: text(input.rejectionReason, 'Operator rejected this exact-head candidate.'),
  } : null;
  return {
    selectedCandidate: {
      prNumber: PR_NUMBER.test(String(prNumber)) ? prNumber : null,
      title: text(selectedCandidate.title, 'Untitled PR'),
      headSha,
      requiredApprovalToken: approvalToken,
    },
    proofSummary: {
      status: text(proofSummary.status || input.proofStatus, 'not_started'),
      commandCount: Number(proofSummary.commandCount || 0),
      browserProof: text(proofSummary.browserProof, 'unknown'),
    },
    approvalToken,
    approvalStatus,
    rejectionStatus,
    rejectionReceipt,
    blockers: unique(blockers),
    mergeAllowed: false,
    commandExecutionAllowed: false,
    uiMergeClaim: false,
    nextOperatorAction: rejectRequested
      ? 'Rejection receipt blocks merge; update or replace the candidate before requesting approval again.'
      : (approvalStatus === 'approved_exact_head'
        ? 'Exact-head approval receipt is valid; hand off to a guarded merge executor outside this UI/state surface.'
        : `Review proof and provide exact token ${approvalToken} for PR #${PR_NUMBER.test(String(prNumber)) ? prNumber : 'unknown'}, or reject with a blocker receipt.`),
  };
}


export function buildConciergePostMergeSync(input = {}) {
  const mergeReceipt = input.mergeReceipt && typeof input.mergeReceipt === 'object' ? input.mergeReceipt : null;
  const adapterProvided = input.githubAdapterProvided === true || input.adapterProvided === true || Boolean(input.adapter);
  const mergeReceiptObserved = Boolean(mergeReceipt?.observed === true || mergeReceipt?.receiptId || mergeReceipt?.mergeCommitSha || (adapterProvided && mergeReceipt?.merged === true));
  const workingTreeClean = input.workingTreeClean === true;
  const dirtyTreeStatus = input.workingTreeClean === false ? 'dirty' : (workingTreeClean ? 'clean' : 'unknown');
  const pullMainReceipt = input.pullMainReceipt && typeof input.pullMainReceipt === 'object' ? input.pullMainReceipt : null;
  const restartReceipt = input.restartRefreshReceipt && typeof input.restartRefreshReceipt === 'object' ? input.restartRefreshReceipt : (input.refreshReceipt && typeof input.refreshReceipt === 'object' ? input.refreshReceipt : null);
  const backendReceipt = input.backendFreshnessReceipt && typeof input.backendFreshnessReceipt === 'object' ? input.backendFreshnessReceipt : null;
  const dashboardReceipt = input.dashboardRefreshReceipt && typeof input.dashboardRefreshReceipt === 'object' ? input.dashboardRefreshReceipt : null;
  const opsReceipt = input.missionOperationsRefreshReceipt && typeof input.missionOperationsRefreshReceipt === 'object' ? input.missionOperationsRefreshReceipt : null;
  const pullMainPerformed = Boolean(pullMainReceipt?.performed === true || pullMainReceipt?.receiptId || pullMainReceipt?.headSha || pullMainReceipt?.mainSha);
  const restartRequired = input.restartRefreshRequired !== false;
  const restartPerformed = Boolean(restartReceipt?.performed === true || restartReceipt?.receiptId || restartReceipt?.refreshedAt);
  const backendPerformed = Boolean(backendReceipt?.performed === true || backendReceipt?.receiptId || backendReceipt?.freshnessSha || backendReceipt?.observedAt);
  const dashboardPerformed = Boolean(dashboardReceipt?.performed === true || dashboardReceipt?.receiptId || dashboardReceipt?.refreshedAt);
  const opsPerformed = Boolean(opsReceipt?.performed === true || opsReceipt?.receiptId || opsReceipt?.refreshedAt);
  const blockers = [];
  if (!mergeReceiptObserved) blockers.push('Merge receipt is required before post-merge sync/reproof starts; no live GitHub claim is made without an adapter or receipt.');
  if (input.workingTreeClean === false) blockers.push('Dirty-tree blocks post-merge sync; automatic mutation/stash/checkout is prohibited.');
  if (dirtyTreeStatus === 'unknown') blockers.push('Working-tree cleanliness is unknown; pull main proof is blocked until clean/dirty truth is supplied.');
  if (mergeReceiptObserved && workingTreeClean && !pullMainPerformed) blockers.push('Pull-main receipt is required before claiming local main is synced.');
  if (pullMainPerformed && restartRequired && !restartPerformed) blockers.push('Stephanos restart/refresh receipt is required after sync before reproof.');
  if (pullMainPerformed && (!restartRequired || restartPerformed) && !backendPerformed) blockers.push('Backend freshness proof is required after sync/refresh before claiming current status.');
  const pullMain = !mergeReceiptObserved || !workingTreeClean
    ? { status: 'blocked', required: mergeReceiptObserved, performed: false, blockedReason: blockers[0] || 'Merge receipt and clean tree are required before pull main.' }
    : { status: pullMainPerformed ? 'performed' : 'required', required: true, performed: pullMainPerformed, receipt: pullMainReceipt };
  const restartRefresh = !pullMainPerformed
    ? { status: 'blocked', required: restartRequired, performed: false, blockedReason: 'Pull-main receipt is required before restart/refresh.' }
    : { status: restartRequired ? (restartPerformed ? 'performed' : 'required') : 'not_required', required: restartRequired, performed: restartPerformed, receipt: restartReceipt, pcRestartAllowed: false };
  const backendFreshnessProof = !pullMainPerformed || (restartRequired && !restartPerformed)
    ? { status: 'blocked', required: true, performed: false, blockedReason: 'Sync and restart/refresh truth are required before backend freshness proof.' }
    : { status: backendPerformed ? 'performed' : 'required', required: true, performed: backendPerformed, receipt: backendReceipt };
  const refreshState = {
    missionOperations: opsPerformed ? 'performed' : (backendPerformed ? 'required' : 'blocked'),
    goalDashboard: dashboardPerformed ? 'performed' : (backendPerformed ? 'required' : 'blocked'),
    receipts: { missionOperations: opsReceipt, goalDashboard: dashboardReceipt },
  };
  return {
    schemaVersion: `${BATTLE_BRIDGE_CONCIERGE_SCHEMA}.post-merge-sync-reproof`,
    phase: 'V7',
    status: 'implemented_guarded',
    mergeReceiptObserved,
    mergeReceipt: mergeReceiptObserved ? mergeReceipt : null,
    liveGithubProof: adapterProvided || mergeReceiptObserved ? (adapterProvided ? 'adapter-provided' : 'receipt-provided') : 'not-claimed',
    dirtyTreeStatus,
    pullMain,
    restartRefresh,
    backendFreshnessProof,
    refreshState,
    nextOperatorAction: blockers[0] || (!backendPerformed ? 'Record backend freshness proof, then refresh Mission Operations and Goal Dashboard.' : (!opsPerformed || !dashboardPerformed ? 'Refresh Mission Operations and Goal Dashboard surfaces with the post-merge proof receipt.' : 'Post-merge sync/reproof receipts are present; continue with the next guarded goal.')),
    guardrails: { pcRestartAllowed: false, dirtyTreeAutoMutationAllowed: false, fakePullMainProofAllowed: false, fakeSyncProofAllowed: false, liveGithubClaimWithoutAdapterOrReceiptAllowed: false },
    blockers: unique(blockers),
    finalVerdict: blockers.length ? 'POST_MERGE_SYNC_REPROOF_BLOCKED_OR_REQUIRED' : ((!opsPerformed || !dashboardPerformed) ? 'POST_MERGE_SURFACE_REFRESH_REQUIRED' : 'POST_MERGE_SYNC_REPROOF_READY'),
  };
}

export function buildConciergePlan(input = {}) {
  const autoPick = buildConciergeAutoPick(input);
  const candidates = autoPick.rankedCandidates;
  const selected = autoPick.selectedCandidate || candidates[0] || null;
  const blockers = [];
  if (!selected) blockers.push('No open PR or goal candidate was supplied.');
  if (input.workingTreeClean === false) blockers.push('Dirty-tree auto mutation is blocked; clean or stash intentionally first.');
  if (!text(input.repositoryRoot)) blockers.push('Repository root is unknown.');

  const canStartProof = blockers.length === 0 && selected?.safeToProof === true;
  const proofReadiness = canStartProof ? 'ready' : 'blocked_or_unknown';
  const dirtyTreeStatus = input.workingTreeClean === true ? 'clean' : input.workingTreeClean === false ? 'dirty' : 'unknown';
  const exactHeadApproval = selected ? {
    status: 'required',
    token: selected.requiredApprovalToken,
    prNumber: selected.prNumber,
    headSha: selected.headSha,
  } : { status: 'unknown', token: '', prNumber: null, headSha: '' };
  const mergeHoldState = canStartProof ? 'HELD_PENDING_PROOF_PACKET_AND_EXACT_HEAD_APPROVAL' : 'HELD_BLOCKED_OR_UNKNOWN';
  const nextOperatorAction = canStartProof
    ? `Run proof-packet/prove for PR #${selected.prNumber}; merge remains held until exact-head approval is supplied.`
    : (unique([...blockers, ...(selected?.safeToProof === false ? selected.blockers : [])])[0] || 'Supply a PR candidate with exact head truth and clean working tree proof.');
  const browserProofPacket = normalizeConciergeBrowserProof(input);
  return {
    schemaVersion: BATTLE_BRIDGE_CONCIERGE_SCHEMA,
    mode: 'local-first-semi-automatic',
    selectedCandidate: selected,
    rejectedCandidates: autoPick.rejectedCandidates,
    candidates,
    autoPick,
    roadmap: buildConciergeRoadmap(input),
    postMergeSync: buildConciergePostMergeSync(input.postMergeSync || input),
    guardrails: {
      exactHeadApprovalRequired: true,
      neverMerge: true,
      isolatedProofWorktreeWhereSafe: true,
      arbitraryShellAllowed: false,
      dirtyTreeAutoMutationAllowed: false,
      fakeGithubProofAllowed: false,
      fakeLocalProofAllowed: false,
      fakeBrowserProofAllowed: false,
      pcRestartAllowed: false,
      unknownStaysUnknown: true,
    },
    workflow: [
      'inspect-open-prs-and-goals',
      'create-isolated-proof-worktree',
      'run-declared-allowlisted-tests-build-browser-proof',
      'clean-generated-artifacts',
      'emit-canonical-proof-packet',
      'request-exact-head-operator-approval',
      'merge-only-after-token-matches-current-head',
      'pull-main-after-merge',
      'restart-and-reproof-stephanos-when-needed',
      'project-status-to-mission-operations-and-goal-dashboard',
    ],
    canStartProof,
    proofReadiness,
    dirtyTreeStatus,
    exactHeadApproval,
    approvalDecision: buildConciergeApprovalDecision({ selectedCandidate: selected || {}, proofSummary: { status: 'not_started', commandCount: selected?.proofCommands?.length || 0, browserProof: browserProofPacket.browserProofStatus }, currentHeadSha: selected?.headSha, approvalToken: input.approvalToken, decision: input.decision, rejectionReason: input.rejectionReason }),
    proofPacketSummary: {
      status: 'not_started',
      commandCount: selected?.proofCommands?.length || 0,
      browserProof: browserProofPacket.browserProofStatus,
      browserProofPacket,
      generatedArtifactsClean: 'unknown',
    },
    mergeHoldState,
    nextOperatorAction: canStartProof ? autoPick.nextOperatorAction : nextOperatorAction,
    blockers: unique([...blockers, ...autoPick.blockers, ...(selected?.safeToProof === false ? selected.blockers : [])]),
    confidence: autoPick.confidence,
    finalVerdict: canStartProof ? 'READY_TO_START_LOCAL_PROOF' : 'BLOCKED_OR_UNKNOWN',
  };
}

export function buildConciergeProofPacket(input = {}) {
  const candidate = input.candidate || {};
  const commandResults = Array.isArray(input.commandResults) ? input.commandResults : [];
  const failed = commandResults.filter((result) => Number(result.exitCode) !== 0);
  const headSha = text(candidate.headSha || input.headSha);
  const prNumber = Number.parseInt(candidate.prNumber || input.prNumber, 10);
  const proofComplete = commandResults.length > 0 && failed.length === 0 && SHA40.test(headSha) && PR_NUMBER.test(String(prNumber));
  const blockers = [];
  if (!commandResults.length) blockers.push('No proof commands have been recorded.');
  if (failed.length) blockers.push('One or more proof commands failed.');
  if (!SHA40.test(headSha)) blockers.push('Exact head SHA is missing from proof packet.');
  if (!PR_NUMBER.test(String(prNumber))) blockers.push('PR number is missing from proof packet.');
  if (input.generatedArtifactsClean !== true) blockers.push('Generated artifact cleanup has not been proven clean.');
  const browserProofPacket = normalizeConciergeBrowserProof(input);
  if (browserProofPacket.browserProofStatus !== 'verified') blockers.push(browserProofPacket.proofUnavailableBlocker || 'Browser proof remains unknown.');

  const finalVerdict = proofComplete && !blockers.length ? 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL' : 'PROOF_PACKET_BLOCKED';
  return {
    schemaVersion: `${BATTLE_BRIDGE_CONCIERGE_SCHEMA}.proof-packet`,
    packetKind: 'canonical-battle-bridge-build-concierge-proof',
    prNumber,
    headSha,
    branch: text(candidate.branch || input.branch),
    worktreePath: text(input.worktreePath),
    commandResults: commandResults.map((result) => ({ command: normalizeCommand(result.command), exitCode: Number(result.exitCode), evidencePath: text(result.evidencePath) })),
    browserProof: browserProofPacket.browserProofStatus,
    browserProofPacket,
    generatedArtifactsClean: input.generatedArtifactsClean === true,
    missionOperationsStatus: proofComplete && !blockers.length ? 'AWAITING_APPROVAL' : 'BLOCKED',
    goalDashboardStatus: proofComplete && !blockers.length ? 'Proof complete - exact-head approval required' : 'Proof blocked or unknown',
    requiredApprovalToken: battleBridgeMergeApprovalToken({ prNumber, headSha }),
    exactHeadApproval: {
      status: finalVerdict === 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL' ? 'awaiting_operator_token' : 'blocked',
      token: battleBridgeMergeApprovalToken({ prNumber, headSha }),
      prNumber,
      headSha,
    },
    approvalDecision: buildConciergeApprovalDecision({ selectedCandidate: { ...candidate, prNumber, headSha }, proofSummary: { status: finalVerdict, commandCount: commandResults.length, browserProof: browserProofPacket.browserProofStatus }, currentHeadSha: input.currentHeadSha || headSha, approvalToken: input.approvalToken, decision: input.decision, rejectionReason: input.rejectionReason }),
    proofPacketSummary: {
      status: finalVerdict,
      commandCount: commandResults.length,
      passedCommandCount: commandResults.length - failed.length,
      failedCommandCount: failed.length,
      browserProof: browserProofPacket.browserProofStatus,
      generatedArtifactsClean: input.generatedArtifactsClean === true ? 'verified' : 'unknown',
    },
    mergeHoldState: 'HELD_PENDING_EXACT_HEAD_APPROVAL',
    nextOperatorAction: finalVerdict === 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL'
      ? `Review proof packet, then provide exact-head token ${battleBridgeMergeApprovalToken({ prNumber, headSha })} only if you approve PR #${prNumber}.`
      : (blockers[0] || 'Complete declared proof before requesting merge approval.'),
    mergeAllowed: false,
    blockers: unique(blockers),
    roadmap: buildConciergeRoadmap(input),
    finalVerdict,
  };
}

export function validateExactHeadMergeApproval({ prNumber, headSha, approvalToken, currentHeadSha } = {}) {
  const requiredToken = battleBridgeMergeApprovalToken({ prNumber, headSha });
  const blockers = [];
  if (!SHA40.test(text(headSha))) blockers.push('Approved head SHA is invalid.');
  if (text(currentHeadSha || headSha) !== text(headSha)) blockers.push('Current PR head does not match approved exact head.');
  if (text(approvalToken) !== requiredToken) blockers.push('Exact-head operator approval token is missing or stale.');
  return { requiredToken, mergeAllowed: blockers.length === 0, blockers, finalVerdict: blockers.length ? 'MERGE_BLOCKED' : 'MERGE_ALLOWED' };
}


export function buildConciergeProveBlocked({ plan, blockers = [], worktreePath = '', commandResults = [] } = {}) {
  const selected = plan?.selectedCandidate || {};
  const prNumber = Number.parseInt(selected.prNumber || plan?.prNumber, 10);
  const headSha = text(selected.headSha || plan?.headSha);
  return {
    schemaVersion: `${BATTLE_BRIDGE_CONCIERGE_SCHEMA}.prove`,
    mode: 'prove',
    prNumber,
    headSha,
    worktreePath: text(worktreePath),
    commandResults: commandResults.map((result) => ({ command: normalizeCommand(result.command), exitCode: Number(result.exitCode), evidencePath: text(result.evidencePath), blocked: result.blocked === true })),
    generatedArtifactsClean: false,
    mergeAllowed: false,
    mergeHoldState: 'HELD_BLOCKED_OR_UNKNOWN',
    exactHeadApproval: selected.requiredApprovalToken ? { status: 'blocked', token: selected.requiredApprovalToken, prNumber, headSha } : { status: 'unknown', token: '', prNumber: null, headSha: '' },
    requiredApprovalToken: selected.requiredApprovalToken || '',
    blockers: unique(blockers),
    finalVerdict: 'PROVE_BLOCKED_OR_UNKNOWN',
  };
}
