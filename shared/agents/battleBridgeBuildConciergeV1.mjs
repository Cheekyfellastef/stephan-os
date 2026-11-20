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

export const BATTLE_BRIDGE_CONCIERGE_SCHEMA = 'stephanos.battle-bridge-build-concierge.v1';

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
    if (text(pr.state, 'OPEN').toUpperCase() !== 'OPEN') blockers.push('PR is not open.');
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
  return {
    schemaVersion: BATTLE_BRIDGE_CONCIERGE_SCHEMA,
    mode: 'local-first-semi-automatic',
    selectedCandidate: selected,
    candidates,
    guardrails: {
      exactHeadApprovalRequired: true,
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

  return {
    schemaVersion: `${BATTLE_BRIDGE_CONCIERGE_SCHEMA}.proof-packet`,
    prNumber,
    headSha,
    branch: text(candidate.branch || input.branch),
    worktreePath: text(input.worktreePath),
    commandResults: commandResults.map((result) => ({ command: normalizeCommand(result.command), exitCode: Number(result.exitCode), evidencePath: text(result.evidencePath) })),
    browserProof: input.browserProof === true ? 'verified' : 'unknown',
    generatedArtifactsClean: input.generatedArtifactsClean === true,
    missionOperationsStatus: proofComplete && !blockers.length ? 'AWAITING_APPROVAL' : 'BLOCKED',
    goalDashboardStatus: proofComplete && !blockers.length ? 'Proof complete - exact-head approval required' : 'Proof blocked or unknown',
    requiredApprovalToken: battleBridgeMergeApprovalToken({ prNumber, headSha }),
    mergeAllowed: false,
    blockers: unique(blockers),
    finalVerdict: proofComplete && !blockers.length ? 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL' : 'PROOF_PACKET_BLOCKED',
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
