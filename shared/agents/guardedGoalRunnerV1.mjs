import { existsSync, readFileSync } from 'node:fs';

export const GUARDED_GOAL_RUNNER_V1_OUTCOMES = Object.freeze({
  GOAL_GREEN: 'goal-green',
  KNOWN_BLOCKER_NEXT_PATCH: 'known-blocker-next-patch',
  NEEDS_OPERATOR_PR_CREATE_CLICK: 'needs-operator-pr-create-click',
  SAFE_TO_MERGE_WITH_EXPECTED_HEAD: 'safe-to-merge-with-expected-head',
  ABORT_STALE_BASE: 'abort-stale-base',
  ABORT_CONFLICTING_PR: 'abort-conflicting-pr',
  ABORT_UNKNOWN_BLOCKER: 'abort-unknown-blocker',
  ABORT_REPEATED_BLOCKER: 'abort-repeated-blocker',
  ABORT_MISSING_PROOF: 'abort-missing-proof',
});

export const GUARDED_GOAL_RUNNER_V1_BLOCKERS = Object.freeze({
  CONFIG_WRITE_REJECTED: 'openclaw-config-write-rejected',
  STARTUP_TOKEN_MISSING: 'startup-token-missing',
  STARTUP_APPROVAL_REQUIRED: 'startup-approval-required',
  SPAWN_OPENCLAW_ENOENT: 'spawn-openclaw-enoent',
  SPAWN_EINVAL: 'spawn-einval',
  OPENCLAW_HEALTH_LIVE: 'openclaw-health-live',
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

export const guardedGoalRunnerV1ProofPacketShape = Object.freeze({
  supervisorCurrentRecord: 'object: current proof/blocker/runtime truth record',
  currentSourceHead: 'object: { sha } for the checked source tree',
  prPublicationStatus: 'object: { state, prNumber?, url? }',
  pr: 'object: { baseSha, expectedBaseSha, headSha, expectedHeadSha, mergeable, conflicting }',
  logPaths: 'array<string>: proof/evidence log paths, read-only',
  allowedTests: 'array<string>: exact commands the harness may recommend, not execute',
  requestedMutation: 'object?: { kind } must be from guarded allow-list',
});

export const guardedGoalRunnerV1MergeGateSchema = Object.freeze({
  performsMerge: false,
  required: ['expected_head_sha', 'pr_number', 'base_sha_current', 'mergeable_clean', 'green_exact_head_proof'],
  outputOnly: 'The harness may emit safe-to-merge-with-expected-head but never invokes git/GitHub merge.',
});

export const guardedGoalRunnerV1OperatorApprovalEnvelope = Object.freeze({
  bypassesApproval: false,
  requiredFor: ['startup-approval-required', 'pr-create-click', 'merge-click'],
  envelope: ['approvalId', 'requestedBy', 'reason', 'expiresAt', 'operatorAction'],
});

function clean(value) {
  return String(value ?? '').trim();
}

function latestBlocker(record = {}) {
  return clean(record.blocker ?? record.blockerId ?? record.status ?? record.kind);
}

function currentHead(packet = {}) {
  return clean(packet.currentSourceHead?.sha ?? packet.current_source_head_sha);
}

function expectedHead(packet = {}) {
  return clean(packet.pr?.expectedHeadSha ?? packet.pr?.expected_head_sha ?? packet.expected_head_sha);
}

function buildNextAction({ outcome, blocker = null, reason, patch = null, mergeGate = null, operatorApproval = null }) {
  return {
    runner: 'guarded-goal-runner-v1',
    outcome,
    blocker,
    reason,
    executesShell: false,
    patch,
    mergeGate,
    operatorApproval,
  };
}

function isGreenExactHead(packet, blocker) {
  const record = packet.supervisorCurrentRecord ?? {};
  const expected = expectedHead(packet);
  const head = currentHead(packet);
  return blocker === TERMINAL_GREEN_BLOCKER
    && Boolean(expected)
    && head === expected
    && clean(record.expectedHeadSha ?? record.expected_head_sha ?? expected) === expected
    && clean(record.currentPhase) === 'ready'
    && clean(record.trafficLight) === 'green';
}

function hasRepeatedBlocker(packet, blocker) {
  const prior = Array.isArray(packet.priorBlockers) ? packet.priorBlockers.map(clean).filter(Boolean) : [];
  return Boolean(blocker && prior.at(-1) === blocker);
}

function hasUnsafeMutation(packet) {
  const kind = clean(packet.requestedMutation?.kind);
  return Boolean(kind && !GUARDED_GOAL_RUNNER_V1_ALLOWED_MUTATIONS.includes(kind));
}

export function classifyGuardedGoalRunnerV1(packet = {}) {
  if (!packet.supervisorCurrentRecord) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, reason: 'Missing supervisor current proof record.' });
  }

  const blocker = latestBlocker(packet.supervisorCurrentRecord);
  if (!blocker || !KNOWN_BLOCKERS.has(blocker)) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: 'Proof record does not contain a known Guarded Goal Runner V1 blocker.' });
  }

  if (hasUnsafeMutation(packet)) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_UNKNOWN_BLOCKER, blocker, reason: `Unsafe mutation request rejected: ${packet.requestedMutation.kind}.` });
  }

  if (hasRepeatedBlocker(packet, blocker)) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_REPEATED_BLOCKER, blocker, reason: 'The same blocker repeated consecutively; stop before looping.' });
  }

  const pr = packet.pr ?? {};
  if (pr.expectedBaseSha && pr.baseSha && pr.expectedBaseSha !== pr.baseSha) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_STALE_BASE, blocker, reason: 'PR base SHA no longer matches expected base SHA.' });
  }
  if (pr.conflicting || pr.mergeable === false) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_CONFLICTING_PR, blocker, reason: 'PR mergeability proof is conflicting or not mergeable.' });
  }

  if (!expectedHead(packet)) {
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, blocker, reason: 'Missing expected_head_sha; exact-head proof is required.' });
  }

  if (isGreenExactHead(packet, blocker)) {
    const publication = clean(packet.prPublicationStatus?.state);
    if (publication !== 'published') {
      return buildNextAction({
        outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.NEEDS_OPERATOR_PR_CREATE_CLICK,
        blocker,
        reason: 'Green exact-head proof exists, but a real published GitHub PR number is not present.',
        operatorApproval: { bypassesApproval: false, action: 'click Create PR button, then rerun PR discovery/proof' },
      });
    }
    if (packet.pr?.prNumber && packet.pr?.headSha === expectedHead(packet)) {
      return buildNextAction({
        outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.SAFE_TO_MERGE_WITH_EXPECTED_HEAD,
        blocker,
        reason: 'Published PR has clean mergeability and green proof for the expected head.',
        mergeGate: { performsMerge: false, expected_head_sha: expectedHead(packet), pr_number: packet.pr.prNumber },
      });
    }
    return buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.GOAL_GREEN, blocker, reason: 'Runtime is ready/green for the exact expected source head.' });
  }

  return buildNextAction({
    outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.KNOWN_BLOCKER_NEXT_PATCH,
    blocker,
    reason: 'Known blocker classified; emit the next bounded source/proof patch packet only.',
    patch: { mutationKindsAllowed: GUARDED_GOAL_RUNNER_V1_ALLOWED_MUTATIONS, allowedTests: packet.allowedTests ?? [] },
  });
}

export function readGuardedGoalRunnerV1ProofPacket(proofPath) {
  if (!proofPath || !existsSync(proofPath)) {
    return { ok: false, nextAction: buildNextAction({ outcome: GUARDED_GOAL_RUNNER_V1_OUTCOMES.ABORT_MISSING_PROOF, reason: `Missing proof file: ${proofPath || '<none>'}.` }) };
  }
  return { ok: true, packet: JSON.parse(readFileSync(proofPath, 'utf8')) };
}
