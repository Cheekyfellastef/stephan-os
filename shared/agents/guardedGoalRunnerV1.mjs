import { existsSync, readFileSync } from 'node:fs';

export const GUARDED_GOAL_RUNNER_V1_OUTCOMES = Object.freeze({
  GOAL_GREEN: 'goal-green',
  KNOWN_BLOCKER_NEXT_PATCH: 'known-blocker-next-patch',
  SEARCH_CAPABILITY_OWNER: 'search-capability-owner',
  ADVANCE_EXISTING_CAPABILITY_GOAL: 'advance-existing-capability-goal',
  CREATE_MINIMAL_CAPABILITY_GOAL: 'create-minimal-capability-goal',
  ROUTE_TO_AUTOMATED_PUBLICATION: 'route-to-automated-publication',
  WAIT_FOR_GENUINE_OPERATOR_APPROVAL: 'wait-for-genuine-operator-approval',
  WAIT_FOR_LOCAL_HARDWARE_PROOF: 'wait-for-local-hardware-proof',
  ABORT_EXTERNAL_UNBUILDABLE: 'abort-external-unbuildable',
  SAFE_TO_MERGE_WITH_EXPECTED_HEAD: 'safe-to-merge-with-expected-head',
  ABORT_STALE_BASE: 'abort-stale-base',
  ABORT_CONFLICTING_PR: 'abort-conflicting-pr',
  ABORT_MISSING_EXPECTED_HEAD: 'abort-missing-expected-head',
  ABORT_UNKNOWN_BLOCKER: 'abort-unknown-blocker',
  ABORT_REPEATED_BLOCKER: 'abort-repeated-blocker',
  ABORT_MISSING_PROOF: 'abort-missing-proof',
  STOP_AND_REPORT: 'stop-and-report',
});

export const GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES = Object.freeze({
  EXTERNAL_UNBUILDABLE_BLOCKER: 'EXTERNAL_UNBUILDABLE_BLOCKER',
  BUILDABLE_CAPABILITY_GAP: 'BUILDABLE_CAPABILITY_GAP',
  GENUINE_OPERATOR_APPROVAL_GATE: 'GENUINE_OPERATOR_APPROVAL_GATE',
  GENUINE_LOCAL_HARDWARE_PROOF: 'GENUINE_LOCAL_HARDWARE_PROOF',
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
const BLOCKER_CLASSES = new Set(Object.values(GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES));
const TERMINAL_GREEN_BLOCKER = GUARDED_GOAL_RUNNER_V1_BLOCKERS.SERVED_RUNTIME_EXACT_HEAD_GREEN;

export const GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID = 'stephanos.guarded-goal-runner-pr-proof.v1';

export const guardedGoalRunnerV1PrProofPacketShape = Object.freeze({
  schema: GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID,
  generatedAt: 'string: ISO timestamp when explicit operator PR metadata was packetized',
  issue: 'number|string: goal/issue id the PR publication proof belongs to',
  prNumber: 'number|null: real GitHub PR number; null before automated publication',
  prUrl: 'string|null: real GitHub PR URL; null before publication',
  publicationState: 'missing|pending-automated-publication|published|draft|unknown',
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
  operatorApprovalRequired: 'boolean: true only for genuine operator gates such as exact-head merge',
  performsMerge: 'false: publisher authority boundary; never merges',
  performsShellExecution: 'false: publisher authority boundary; never executes shell beyond writing packet',
});

export const guardedGoalRunnerV1ProofPacketShape = Object.freeze({
  supervisorCurrentRecord: 'object: current proof/blocker/runtime truth record',
  currentSourceHead: 'object: { sha } for the checked source tree',
  prPublicationStatus: 'object: { state, prNumber?, url? } compatibility publication status',
  prProof: guardedGoalRunnerV1PrProofPacketShape,
  pr: 'object: compatibility { baseSha, expectedBaseSha, headSha, expectedHeadSha, mergeable, conflicting }',
  blockerClassification: 'object|string: one of the four governed blocker classes plus ownership evidence',
  authorizedGoal: 'number|string: parent goal whose standing authority is inherited for bounded enabling work',
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
  requiredFor: ['startup-approval-required', 'merge-click', 'legal-financial-secret-or-destructive-decision'],
  notRequiredFor: ['bounded-design', 'bounded-source-patch', 'tests', 'proof', 'branch-publication', 'pr-publication', 'review-retry'],
  envelope: ['approvalId', 'requestedBy', 'reason', 'expiresAt', 'operatorAction'],
});

function clean(value) { return String(value ?? '').trim(); }
function latestBlocker(record = {}) { return clean(record.blocker ?? record.blockerId ?? record.status ?? record.kind); }
function currentHead(packet = {}) { return clean(packet.currentSourceHead?.sha ?? packet.current_source_head_sha); }
function parentGoal(packet = {}) { return clean(packet.authorizedGoal ?? packet.issue ?? packet.goal ?? packet.supervisorCurrentRecord?.relatedGoal); }

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
function buildNextAction({ outcome, blocker = null, reason, patch = null, mergeGate = null, operatorApproval = null, capability = null, publication = null }) {
  return { runner: 'guarded-goal-runner-v1', outcome, blocker, reason, executesShell: false, performsMerge: false, performsShellExecution: false, patch, mergeGate, operatorApproval, capability, publication };
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

function normalizedBlockerClassification(packet = {}) {
  const raw = packet.blockerClassification ?? packet.supervisorCurrentRecord?.blockerClassification ?? null;
  if (!raw) return null;
  if (typeof raw === 'string') return { class: clean(raw) };
  return {
    class: clean(raw.class ?? raw.outcome ?? raw.kind),
    owningGoal: clean(raw.owningGoal ?? raw.ownerGoal ?? packet.owningCapabilityGoal),
    duplicateSearchComplete: raw.duplicateSearchComplete === true,
    evidenceRefs: Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs.map(String) : [],
    proposedGoalTitle: clean(raw.proposedGoalTitle),
  };
}

function standingAuthority(packet = {}) {
  return Object.freeze({
    inherited: true,
    authorizedGoal: parentGoal(packet),
    requiresNewOperatorApproval: false,
    allows: ['bounded-design', 'bounded-source-build', 'tests', 'proof', 'branch-publication', 'pr-publication', 'review-retry'],
    excludes: ['merge', 'self-approval', 'secret-access', 'financial-or-legal-authority', 'destructive-mutation', 'arbitrary-shell'],
  });
}

function classifyCapabilityGap(packet, blocker, classification) {
  const authority = standingAuthority(packet);
  if (classification.owningGoal) {
    return buildNextAction({
      outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ADVANCE_EXISTING_CAPABILITY_GOAL,
      blocker,
      reason: 'Buildable capability gap has an existing owning goal; advance it under inherited standing authority, then resume the parent goal.',
      capability: { action: 'advance-existing-goal', owningGoal: classification.owningGoal, resumeGoal: parentGoal(packet), authority, evidenceRefs: classification.evidenceRefs },
    });
  }
  if (classification.duplicateSearchComplete) {
    return buildNextAction({
      outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.CREATE_MINIMAL_CAPABILITY_GOAL,
      blocker,
      reason: 'Buildable capability gap has no existing owner after duplicate search; create and dispatch the smallest bounded enabling goal under inherited standing authority.',
      capability: { action: 'create-minimal-goal', proposedGoalTitle: classification.proposedGoalTitle, resumeGoal: parentGoal(packet), authority, evidenceRefs: classification.evidenceRefs },
    });
  }
  return buildNextAction({
    outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.SEARCH_CAPABILITY_OWNER,
    blocker,
    reason: 'Buildable capability gap must be searched against existing goals before any new goal is created.',
    capability: { action: 'search-existing-goals', resumeGoal: parentGoal(packet), authority, evidenceRefs: classification.evidenceRefs },
  });
}

function classifyGovernedBlocker(packet, blocker, classification) {
  if (!classification || !BLOCKER_CLASSES.has(classification.class)) return null;
  if (classification.class === GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES.BUILDABLE_CAPABILITY_GAP) return classifyCapabilityGap(packet, blocker, classification);
  if (classification.class === GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES.GENUINE_OPERATOR_APPROVAL_GATE) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.WAIT_FOR_GENUINE_OPERATOR_APPROVAL, blocker, reason: 'A genuine operator judgment or authority gate is proven.', operatorApproval: { bypassesApproval: false, requiresExactDecision: true } });
  }
  if (classification.class === GUARDED_GOAL_RUNNER_V1_BLOCKER_CLASSES.GENUINE_LOCAL_HARDWARE_PROOF) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.WAIT_FOR_LOCAL_HARDWARE_PROOF, blocker, reason: 'Completion requires real local hardware/runtime proof that cannot be fabricated remotely.' });
  }
  return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_EXTERNAL_UNBUILDABLE, blocker, reason: 'Verified external blocker cannot be removed by bounded platform work.' });
}

export function classifyGuardedGoalRunnerV1(packet = {}) {
  if (!packet.supervisorCurrentRecord) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, reason: 'Missing supervisor current proof record.' });
  const blocker = latestBlocker(packet.supervisorCurrentRecord);
  if (hasUnsafeMutation(packet)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: `Unsafe mutation request rejected: ${packet.requestedMutation.kind}.` });
  const governed = classifyGovernedBlocker(packet, blocker, normalizedBlockerClassification(packet));
  if (governed) return governed;
  if (!blocker || !KNOWN_BLOCKERS.has(blocker)) return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: 'Proof record does not contain a known Guarded Goal Runner V1 blocker or governed blocker classification.' });
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
  if (!prExists || publication === 'pending-automated-publication' || publication === 'pending-operator-create-pr-click' || publication === 'missing') {
    return buildNextAction({
      outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ROUTE_TO_AUTOMATED_PUBLICATION,
      blocker,
      reason: 'Green exact-head proof exists but no real PR is published; route to the authenticated bounded publication connector without creating an operator click.',
      publication: { action: 'publish-existing-branch-or-bundle', duplicateCheckRequired: true, expected_head_sha: expected, base_sha: base, requiresNewOperatorApproval: false, authority: standingAuthority(packet) },
    });
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
