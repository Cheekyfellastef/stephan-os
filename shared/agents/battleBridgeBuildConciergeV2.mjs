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

export const BATTLE_BRIDGE_CONCIERGE_SCHEMA = 'stephanos.battle-bridge-build-concierge.v4';
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
  const prs = Array.isArray(input.pullRequests) ? input.pullRequests : [];
  return prs.map((pr) => {
    const blockers = [];
    const prNumber = Number.parseInt(pr.number, 10);
    const headSha = text(pr.headSha || pr.headRefOid);
    const changedFiles = list(pr.changedFiles);
    const proofCommands = (Array.isArray(pr.proofCommands) && pr.proofCommands.length ? pr.proofCommands : ['npm test'])
      .map(validateConciergeCommand);

    if (!PR_NUMBER.test(String(pr.number))) blockers.push('PR number is unknown or invalid.');
    if (!SHA40.test(headSha)) blockers.push('Exact PR head SHA is unknown or invalid.');
    if (text(pr.state, 'UNKNOWN').toUpperCase() !== 'OPEN') blockers.push('PR open state is unknown or not open.');
    if (pr.isDraft === true) blockers.push('Draft PRs stay inspect-only until marked ready by the author.');
    if (pr.mergeable === false) blockers.push('PR is explicitly not mergeable.');
    if (changedFiles.some((file) => /(^|\/)(dist|node_modules|runtime|tmp)(\/|$)/i.test(file))) {
      blockers.push('Changed files include generated or forbidden runtime paths.');
    }
    for (const proof of proofCommands) if (!proof.allowed) blockers.push(proof.blocker);

    return {
      prNumber,
      title: text(pr.title, 'Untitled PR'),
      headSha,
      branch: text(pr.branch || pr.headRefName),
      changedFiles,
      proofCommands: proofCommands.map((proof) => proof.command),
      safeToProof: blockers.length === 0,
      blockers: unique(blockers),
      requiredApprovalToken: battleBridgeMergeApprovalToken({ prNumber, headSha }),
    };
  }).sort((left, right) => Number(right.safeToProof) - Number(left.safeToProof) || left.prNumber - right.prNumber);
}

export function buildConciergePlan(input = {}) {
  const candidates = chooseSafeProofCandidates(input);
  const selected = candidates.find((candidate) => candidate.safeToProof) || candidates[0] || null;
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
    candidates,
    roadmap: buildConciergeRoadmap(input),
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
    proofPacketSummary: {
      status: 'not_started',
      commandCount: selected?.proofCommands?.length || 0,
      browserProof: browserProofPacket.browserProofStatus,
      browserProofPacket,
      generatedArtifactsClean: 'unknown',
    },
    mergeHoldState,
    nextOperatorAction,
    blockers: unique([...blockers, ...(selected?.safeToProof === false ? selected.blockers : [])]),
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
