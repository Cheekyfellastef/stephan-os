import { buildPatchCourierDiffCommand } from './patchCourierPacket.mjs';
import { createPRPublicationVerifierResult } from './verificationHarness.mjs';

export const CODEX_BUILDER_LANE_BRIEF_VERSION = 'codex-builder-lane-brief.v1';

export const BUILDER_LANE_STATE = Object.freeze({
  READY_TO_SCOUT: 'ready-to-scout',
  PROOF_NEEDED: 'proof-needed',
  PATCH_COURIER_NEEDED: 'patch-courier-needed',
  PUBLICATION_PROOF_NEEDED: 'publication-proof-needed',
  BLOCKED_DIRTY_MAIN: 'blocked-dirty-main',
  BLOCKED_MISSING_REMOTE: 'blocked-missing-remote',
  BLOCKED_LOST_PATCH: 'blocked-lost-patch',
  BLOCKED_UNSAFE_COMMAND: 'blocked-unsafe-command',
});

const SAFE_COMMANDS = Object.freeze([
  'git status --short --branch',
  'git diff --name-only',
  'git diff --binary -- <targetFiles>',
  'npm test -- --runInBand <deterministic-test-file>',
  'node --test <deterministic-test-file>',
  'node scripts/verify-pr-publication.mjs --pr <pr> --branch <branch> --expected <head> --remote-pr-head <sha> --origin-branch-head <sha> --local-head <sha> --tested-head <sha>',
]);

const WRITE_OR_REMOTE_MUTATION_RE = /\b(git\s+(pull|push|merge|rebase|reset|clean|checkout|switch|commit|apply|am)|gh\s+pr\s+merge|rm\s+-rf|npm\s+run\s+stephanos:clean)\b/i;
const RUNTIME_DIRT_RE = /^(runtime\/|memory\/|apps\/stephanos\/dist\/|node_modules\/|\.stephanos-runtime\/|stephanos-runtime\/)/;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function isMainBranch(branch) {
  return ['main', 'master', 'trunk'].includes(text(branch).toLowerCase());
}

function hasUnsafeCommand(commands) {
  return list(commands).some((command) => WRITE_OR_REMOTE_MUTATION_RE.test(command));
}

function proofPassed(proof) {
  return proof?.status === 'PASS' || proof?.finalVerdict === 'PR_PUBLICATION_VERIFIER_PASS';
}

export function buildCodexBuilderLaneBrief(intentPacket = {}, observedRepoFacts = {}) {
  const issue = text(intentPacket.issue, '1284').replace(/^#/, '');
  const targetFiles = list(intentPacket.targetFiles);
  const targetBranch = text(intentPacket.targetBranch || intentPacket.branch, '');
  const observedBranch = text(observedRepoFacts.observedBranch || observedRepoFacts.branch, 'unknown');
  const observedHead = text(observedRepoFacts.observedHead || observedRepoFacts.localHeadSha || observedRepoFacts.head, '');
  const remoteHead = text(observedRepoFacts.remoteHead || observedRepoFacts.remotePrHeadSha || observedRepoFacts.headRefOid, '');
  const prNumber = text(observedRepoFacts.prNumber || intentPacket.prNumber, '');
  const dirtyFiles = list(observedRepoFacts.dirtyFiles);
  const requestedCommands = list(intentPacket.requestedCommands || intentPacket.commands);
  const lostPatch = observedRepoFacts.lostPatch === true || intentPacket.lostPatch === true;
  const publicationAttempted = observedRepoFacts.publicationAttempted === true || intentPacket.publicationAttempted === true;
  const successClaimed = observedRepoFacts.successClaimed === true || intentPacket.successClaimed === true;
  const hasRemoteConfigured = observedRepoFacts.hasRemote !== false && observedRepoFacts.remoteMissing !== true;
  const runtimeDirtyFiles = dirtyFiles.filter((file) => RUNTIME_DIRT_RE.test(file));
  const dirtyMainBlocked = isMainBranch(observedBranch) && dirtyFiles.length > 0;
  const unsafeCommandBlocked = hasUnsafeCommand(requestedCommands);

  const publicationProof = observedRepoFacts.publicationProof || createPRPublicationVerifierResult({
    prNumber,
    headBranch: targetBranch || observedBranch,
    expectedCommit: observedHead,
    remotePrHeadSha: remoteHead,
    fetchedOriginBranchSha: observedRepoFacts.fetchedOriginBranchSha || observedRepoFacts.originBranchSha || remoteHead,
    localHeadSha: observedHead,
    testedHeadSha: observedRepoFacts.testedHeadSha || observedHead,
    prCommits: observedRepoFacts.prCommits || (remoteHead ? [remoteHead] : []),
  });
  const publicationProofPass = proofPassed(publicationProof);

  const requiredProofs = [];
  const safetyBlockers = [];
  let state = BUILDER_LANE_STATE.READY_TO_SCOUT;
  let courierRequired = false;
  let publicationProofRequired = false;
  let publicationState = 'not-claimed';

  if (unsafeCommandBlocked) {
    state = BUILDER_LANE_STATE.BLOCKED_UNSAFE_COMMAND;
    safetyBlockers.push('unsafe-command-requested');
  } else if (dirtyMainBlocked || runtimeDirtyFiles.length > 0) {
    state = BUILDER_LANE_STATE.BLOCKED_DIRTY_MAIN;
    safetyBlockers.push(dirtyMainBlocked ? 'dirty-main' : 'runtime-dirt');
    if (runtimeDirtyFiles.length > 0) safetyBlockers.push('runtime-generated-dirt-present');
  } else if (!hasRemoteConfigured) {
    state = BUILDER_LANE_STATE.BLOCKED_MISSING_REMOTE;
    safetyBlockers.push('remote-missing');
  } else if (lostPatch) {
    state = BUILDER_LANE_STATE.BLOCKED_LOST_PATCH;
    courierRequired = true;
    safetyBlockers.push('lost-patch');
  } else if (publicationAttempted && !remoteHead) {
    state = BUILDER_LANE_STATE.PATCH_COURIER_NEEDED;
    courierRequired = true;
    publicationProofRequired = true;
    safetyBlockers.push('publication-failed-without-remote-head');
  } else if ((successClaimed || prNumber || remoteHead || observedHead) && !publicationProofPass) {
    state = BUILDER_LANE_STATE.PUBLICATION_PROOF_NEEDED;
    publicationProofRequired = true;
    safetyBlockers.push(successClaimed ? 'success-claim-without-publication-proof' : 'publication-proof-missing');
  } else if (intentPacket.intent === 'scout' || intentPacket.mode === 'scout') {
    state = BUILDER_LANE_STATE.READY_TO_SCOUT;
  } else {
    state = BUILDER_LANE_STATE.PROOF_NEEDED;
    requiredProofs.push('deterministic-test-proof');
  }

  if (publicationProofRequired) requiredProofs.push('PRPublicationVerifier PASS with exact PR/head proof');
  if (courierRequired) requiredProofs.push('Patch Courier V1 packet export');
  if (publicationProofPass) publicationState = 'review-ready-with-exact-publication-proof';
  else if (publicationProofRequired) publicationState = 'publication-proof-needed';

  const courierCommand = buildPatchCourierDiffCommand(targetFiles);
  const smallestNextOperatorAction = (() => {
    if (state === BUILDER_LANE_STATE.BLOCKED_UNSAFE_COMMAND) return 'Remove unsafe mutation commands; provide observed facts only.';
    if (state === BUILDER_LANE_STATE.BLOCKED_DIRTY_MAIN) return 'Stop local write/pull; operator must resolve or explicitly exclude dirty main/runtime files.';
    if (state === BUILDER_LANE_STATE.BLOCKED_MISSING_REMOTE) return 'Operator must provide remote facts or publish out-of-band; Codex must not push.';
    if (courierRequired) return `Export Patch Courier V1 packet with: ${courierCommand}`;
    if (publicationProofRequired) return 'Run exact PRPublicationVerifier proof and provide PR number plus remote head.';
    if (publicationProofPass) return 'Review PR; do not merge from builder lane.';
    if (state === BUILDER_LANE_STATE.READY_TO_SCOUT) return 'Scout source files and report a bounded plan before edits.';
    return 'Run deterministic source-only proof before claiming success.';
  })();

  return {
    schemaVersion: CODEX_BUILDER_LANE_BRIEF_VERSION,
    kind: 'stephanos.codex_builder_lane_brief',
    state,
    issue,
    targetFiles,
    targetBranch,
    observedBranch,
    observedHead,
    remoteHead,
    dirtyFiles,
    allowedCommands: SAFE_COMMANDS,
    requiredProofs,
    courierRequired,
    publicationProofRequired,
    safetyBlockers,
    smallestNextOperatorAction,
    nextOwner: safetyBlockers.length > 0 || publicationProofRequired || courierRequired ? 'operator' : 'codex',
    publicationState,
    publicationProof,
    mergeAllowed: false,
    patchApplyAllowed: false,
    shellExecutionAllowed: false,
  };
}
