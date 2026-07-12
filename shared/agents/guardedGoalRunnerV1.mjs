import { existsSync, readFileSync } from 'node:fs';

export const GUARDED_GOAL_RUNNER_V1_OUTCOMES = Object.freeze({
  GOAL_GREEN: 'goal-green',
  KNOWN_BLOCKER_NEXT_PATCH: 'known-blocker-next-patch',
  NEEDS_OPERATOR_PR_CREATE_CLICK: 'needs-operator-pr-create-click',
  SAFE_TO_MERGE_WITH_EXPECTED_HEAD: 'safe-to-merge-with-expected-head',
  ABORT_STALE_BASE: 'abort-stale-base',
  ABORT_CONFLICTING_PR: 'abort-conflicting-pr',
  ABORT_MISSING_EXPECTED_HEAD: 'abort-missing-expected-head',
  ABORT_UNKNOWN_BLOCKER: 'abort-unknown-blocker',
  ABORT_REPEATED_BLOCKER: 'abort-repeated-blocker',
  ABORT_MISSING_PROOF: 'abort-missing-proof',
  STOP_AND_REPORT: 'stop-and-report',
});

export const GUARDED_GOAL_RUNNER_V1_BLOCKERS = Object.freeze({
  CONFIG_WRITE_REJECTED: 'openclaw-config-write-rejected',
  STARTUP_TOKEN_MISSING: 'startup-token-missing',
  STARTUP_APPROVAL_REQUIRED: 'startup-approval-required',
  SPAWN_OPENCLAW_ENOENT: 'spawn-openclaw-enoent',
  SPAWN_EINVAL: 'spawn-einval',
  OPENCLAW_HEALTH_LIVE: 'openclaw-health-live',
  SERVED_RUNTIME_STALE: 'served-runtime-stale',
  EXACT_HEAD_MISMATCH: 'exact-head-mismatch',
  SERVED_RUNTIME_EXACT_HEAD_GREEN: 'served-runtime-exact-head-green',
});

export const GUARDED_GOAL_RUNNER_V1_ALLOWED_MUTATIONS = Object.freeze([
  'source-patch',
  'test-only',
  'proof-only',
  'operator-approval-request',
]);

const KNOWN_BLOCKERS = new Set(Object.values(GUARDED_GOAL_RUNNER_V1_BLOCKERS));
const TERMINAL_GREEN_BLOCKER = GUARDED_GOAL_RUNNER_V1_BLOCKERS.SERVED_RUNTIME_EXACT_HEAD_GREEN;

export const GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID = 'stephanos.guarded-goal-runner-pr-proof.v1';

export const guardedGoalRunnerV1PrProofPacketShape = Object.freeze({
  schema: GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID,
  issue: 'number|string: goal/issue id the PR publication proof belongs to',
  prNumber: 'number|null: real GitHub PR number; null before operator Create PR click',
  prUrl: 'string|null: real GitHub PR URL; null before publication',
  publicationState: 'missing|pending-operator-create-pr-click|published|draft|unknown',
  baseBranch: 'string: target branch, usually main',
  baseSha: 'string: currently observed PR base SHA',
  expectedBaseSha: 'string|null: expected base SHA; when present it must equal baseSha',
  headSha: 'string: currently observed PR head SHA',
  expectedHeadSha: 'string: exact head SHA green proof and PR head must match',
  mergeable: 'boolean|null: GitHub mergeability proof',
  conflicting: 'boolean|null: true when conflicts are known',
  draft: 'boolean: true blocks merge gate',
  changedFiles: 'object: { count, files?, summary? } source-controlled summary only',
  testsRun: 'object|array: required tests and green/failing status summary',
  operatorApprovalRequired: 'boolean: true for PR create/merge clicks',
});

export const guardedGoalRunnerV1ProofPacketShape = Object.freeze({
  supervisorCurrentRecord: 'object: current proof/blocker/runtime truth record',
  currentSourceHead: 'object: { sha } for the checked source tree',
  prPublicationStatus: 'object: { state, prNumber?, url? } compatibility publication status',
  prProof: guardedGoalRunnerV1PrProofPacketShape,
  pr: 'object: compatibility { baseSha, expectedBaseSha, headSha, expectedHeadSha, mergeable, conflicting }',
  logPaths: 'array<string>: proof/evidence log paths, read-only',
  allowedTests: 'array<string>: exact commands the harness may recommend, not execute',
  requestedMutation: 'object?: { kind } must be from guarded allow-list',
});

export const guardedGoalRunnerV1MergeGateSchema = Object.freeze({
  performsMerge: false,
  performsShellExecution: false,
  required: ['expected_head_sha', 'pr_number', 'base_sha_current', 'mergeable_clean', 'green_exact_head_proof', 'required_tests_green'],
  outputOnly: 'The harness may emit safe-to-merge-with-expected-head but never invokes git/GitHub merge.',
});

export const guardedGoalRunnerV1OperatorApprovalEnvelope = Object.freeze({
  bypassesApproval: false,
  requiredFor: ['startup-approval-required', 'pr-create-click', 'merge-click'],
  envelope: ['approvalId', 'requestedBy', 'reason', 'expiresAt', 'operatorAction'],
});

function clean(value) { return String(value ?? '').trim(); }
function latestBlocker(record = {}) { return clean(record.blocker ?? record.blockerId ?? record.status ?? record.kind); }
function currentHead(packet = {}) { return clean(packet.currentSourceHead?.sha ?? packet.current_source_head_sha); }

function prProof(packet = {}) {
  const proof = packet.prProof ?? packet.prPublicationProof ?? null;
  if (proof) return proof;
  const pr = packet.pr ?? {};
  const status = packet.prPublicationStatus ?? {};
  if (!Object.keys(pr).length && !Object.keys(status).length) return null;
  return {
    publicationState: status.state,
    prNumber: pr.prNumber ?? status.prNumber,
    prUrl: pr.prUrl ?? status.url,
    baseSha: pr.baseSha,
    expectedBaseSha: pr.expectedBaseSha,
    headSha: pr.headSha,
    expectedHeadSha: pr.expectedHeadSha ?? pr.expected_head_sha,
    mergeable: pr.mergeable,
    conflicting: pr.conflicting,
    draft: pr.draft,
    testsRun: pr.testsRun,
  };
}

function expectedHead(packet = {}) { return clean(prProof(packet)?.expectedHeadSha ?? packet.expected_head_sha); }
function buildNextAction({ outcome, blocker = null, reason, patch = null, mergeGate = null, operatorApproval = null }) {
  return { runner: 'guarded-goal-runner-v1', outcome, blocker, reason, executesShell: false, performsMerge: false, performsShellExecution: false, patch, mergeGate, operatorApproval };
}

function isGreenExactHead(packet, blocker) {
  const record = packet.supervisorCurrentRecord ?? {};
  const expected = expectedHead(packet);
  const head = currentHead(packet);
  return blocker === TERMINAL_GREEN_BLOCKER && Boolean(expected) && head === expected && clean(record.expectedHeadSha ?? record.expected_head_sha ?? expected) === expected && clean(record.currentPhase) === 'ready' && clean(record.trafficLight) === 'green';
}
function hasRepeatedBlocker(packet, blocker) { const prior = Array.isArray(packet.priorBlockers) ? packet.priorBlockers.map(clean).filter(Boolean) : []; return Boolean(blocker && prior.at(-1) === blocker); }
function hasUnsafeMutation(packet) { const kind = clean(packet.requestedMutation?.kind); return Boolean(kind && !GUARDED_GOAL_RUNNER_V1_ALLOWED_MUTATIONS.includes(kind)); }
function requiredTestsGreen(testsRun) {
  if (!testsRun) return false;
  const items = Array.isArray(testsRun) ? testsRun : (Array.isArray(testsRun.required) ? testsRun.required : Array.isArray(testsRun.commands) ? testsRun.commands : []);
  if (items.length) return items.every((item) => item === true || clean(item.status) === 'green' || clean(item.outcome) === 'pass' || item.passed === true);
  return testsRun.allGreen === true || clean(testsRun.status) === 'green' || clean(testsRun.outcome) === 'pass';
}

export function classifyGuardedGoalRunnerV1(packet = {}) {
  if (!packet.supervisorCurrentRecord) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, reason: 'Missing supervisor current proof record.' });
  const blocker = latestBlocker(packet.supervisorCurrentRecord);
  if (!blocker || !KNOWN_BLOCKERS.has(blocker)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: 'Proof record does not contain a known Guarded Goal Runner V1 blocker.' });
  if (hasUnsafeMutation(packet)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: `Unsafe mutation request rejected: ${packet.requestedMutation.kind}.` });
  if (hasRepeatedBlocker(packet, blocker)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_REPEATED_BLOCKER, blocker, reason: 'The same blocker repeated consecutively; stop before looping.' });

  const proof = prProof(packet);
  if (!proof) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, blocker, reason: 'Missing PR proof packet.' });
  const publication = clean(proof.publicationState || proof.state);
  const expected = expectedHead(packet);
  const expectedBase = clean(proof.expectedBaseSha);
  const base = clean(proof.baseSha);
  if (expectedBase && base && expectedBase !== base) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_STALE_BASE, blocker, reason: 'PR base SHA no longer matches expected base SHA.' });
  if (proof.conflicting === true || proof.mergeable === false) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_CONFLICTING_PR, blocker, reason: 'PR mergeability proof is conflicting or not mergeable.' });
  if (!expected) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_EXPECTED_HEAD, blocker, reason: 'Missing expectedHeadSha; exact-head merge gate proof is required.' });

  if (!isGreenExactHead(packet, blocker)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.KNOWN_BLOCKER_NEXT_PATCH, blocker, reason: 'Known blocker classified; emit the next bounded source/proof patch packet only.', patch: { mutationKindsAllowed: GUARDED_GOAL_RUNNER_V1_ALLOWED_MUTATIONS, allowedTests: packet.allowedTests ?? [] } });

  const prExists = Boolean(proof.prNumber && clean(proof.prUrl));
  if (!prExists || publication === 'pending-operator-create-pr-click' || publication === 'missing') {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.NEEDS_OPERATOR_PR_CREATE_CLICK, blocker, reason: 'Green exact-head proof exists, but a real published GitHub PR number is not present.', operatorApproval: { bypassesApproval: false, action: 'click Create PR button, then rerun PR discovery/proof' } });
  }
  if (publication !== 'published') return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.STOP_AND_REPORT, blocker, reason: `Unsupported PR publication state: ${publication || '<empty>'}.` });
  if (proof.draft === true) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.STOP_AND_REPORT, blocker, reason: 'Published PR is draft; stop before merge gate.' });
  if (clean(proof.headSha) !== expected) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.STOP_AND_REPORT, blocker, reason: 'PR head SHA does not match expected head SHA.' });
  if (proof.mergeable === true && proof.conflicting === false && requiredTestsGreen(proof.testsRun)) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.SAFE_TO_MERGE_WITH_EXPECTED_HEAD, blocker, reason: 'Published PR has clean mergeability and green proof for the expected head. Merge is allowed only through an external exact-head guarded merge step.', mergeGate: { performsMerge: false, performsShellExecution: false, expected_head_sha: expected, pr_number: proof.prNumber, nextOperatorAction: 'merge is allowed only through an external exact-head guarded merge step' } });
  }
  return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.STOP_AND_REPORT, blocker, reason: 'PR proof is present but required tests are not reported green or mergeability is incomplete.' });
}

export function readGuardedGoalRunnerV1ProofPacket(proofPath) {
  if (!proofPath || !existsSync(proofPath)) return { ok: false, nextAction: buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, reason: `Missing proof file: ${proofPath || '<none>'}.` }) };
  return { ok: true, packet: JSON.parse(readFileSync(proofPath, 'utf8')) };
}
