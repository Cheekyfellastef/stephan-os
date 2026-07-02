import test from 'node:test';
import assert from 'node:assert/strict';
import {
  battleBridgeMergeApprovalToken,
  buildConciergePlan,
  buildConciergeAutoPick,
  buildConciergeProofPacket,
  buildConciergeRoadmap,
  validateConciergeCommand,
  buildConciergeProveBlocked,
  validateExactHeadMergeApproval,
  buildConciergeApprovalDecision,
} from './battleBridgeBuildConciergeV2.mjs';

const head = 'c'.repeat(40);

test('PR candidate plan includes PR/head/proof commands/next action', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: true, pullRequests: [{ number: 1391, title: 'V2 operator surfaces', headSha: head, state: 'OPEN', mergeable: true, requiredChecksClean: true, changedFiles: ['shared/agents/a.mjs'], proofCommands: ['npm test'] }] });
  assert.equal(plan.selectedCandidate.prNumber, 1391);
  assert.equal(plan.selectedCandidate.headSha, head);
  assert.deepEqual(plan.selectedCandidate.proofCommands, ['npm test']);
  assert.match(plan.nextOperatorAction, /PR #1391/);
  assert.equal(plan.proofReadiness, 'ready');
});

test('proof packet includes exact-head token', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 1391, headSha: head }, generatedArtifactsClean: true, commandResults: [{ command: 'npm test', exitCode: 0 }], browserProofPacket: { browserProofStatus: 'verified', runnerAvailable: true, screenshotPath: 'artifacts/browser/v4.png', checklistStatus: 'passed', checklist: [{ item: 'page rendered', status: 'passed' }] } });
  const token = battleBridgeMergeApprovalToken({ prNumber: 1391, headSha: head });
  assert.equal(packet.requiredApprovalToken, token);
  assert.equal(packet.exactHeadApproval.token, token);
  assert.equal(packet.proofPacketSummary.status, 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL');
});

test('validate-merge accepts only matching PR/head/token', () => {
  const token = battleBridgeMergeApprovalToken({ prNumber: 1391, headSha: head });
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1391, headSha: head, currentHeadSha: head, approvalToken: token }).mergeAllowed, true);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1392, headSha: head, currentHeadSha: head, approvalToken: token }).mergeAllowed, false);
  assert.equal(validateExactHeadMergeApproval({ prNumber: 1391, headSha: head, currentHeadSha: 'd'.repeat(40), approvalToken: token }).mergeAllowed, false);
});

test('dirty tree blocks proof/merge readiness', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: false, pullRequests: [{ number: 1391, headSha: head, state: 'OPEN', requiredChecksClean: true, changedFiles: ['shared/a.mjs'], proofCommands: ['npm test'] }] });
  assert.equal(plan.canStartProof, false);
  assert.equal(plan.dirtyTreeStatus, 'dirty');
  assert.match(plan.mergeHoldState, /HELD/);
  assert.match(plan.blockers.join(' '), /Dirty-tree/);
});


test('roadmap preserves intent-engine approval-only mission and success markers', () => {
  const roadmap = buildConciergeRoadmap();
  assert.match(roadmap.mission, /intent engine and approval authority/);
  assert.equal(roadmap.phases.find((phase) => phase.version === 'V2').status, 'implemented');
  assert.equal(roadmap.activePhase.version, 'V7');
  assert.equal(roadmap.phases.find((phase) => phase.version === 'V4').status, 'implemented_guarded');
  assert.equal(roadmap.phases.find((phase) => phase.version === 'V5').status, 'implemented_guarded');
  assert.equal(roadmap.guardrails.unsafeCommandExecutionAllowed, false);
  assert.equal(roadmap.guardrails.visibleReceiptsOrExplicitBlockersRequired, true);
  assert.ok(roadmap.successMarkers.includes('GOAL_COMPLETE_BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP'));
  assert.ok(roadmap.successMarkers.includes('NO_CLICK_MONKEY_LOOP'));
  assert.ok(roadmap.successMarkers.includes('INTENT_ENGINE_APPROVAL_ONLY'));
});

test('V5 selects safest candidate from mixed PR and goal records without executing commands', () => {
  const autoPick = buildConciergeAutoPick({
    pullRequests: [
      { number: 1397, title: 'stale candidate', headSha: 'a'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, stale: true, proofCommands: ['npm test'] },
      { number: 1398, title: 'safe candidate', headSha: head, state: 'OPEN', mergeable: true, requiredChecksStatus: 'passing', blockers: [], proofCommands: ['npm run stephanos:build'] },
    ],
    goals: [
      { id: 'goal-unknown', title: 'unknown goal', state: 'unknown', mergeable: true, requiredChecksClean: true, proofCommands: ['npm test'], headSha: 'b'.repeat(40) },
    ],
  });
  assert.equal(autoPick.selectedCandidate.prNumber, 1398);
  assert.equal(autoPick.selectedCandidate.safeToProof, true);
  assert.equal(autoPick.commandExecutionAllowed, false);
  assert.equal(autoPick.mergeAllowed, false);
  assert.equal(autoPick.confidence, 'high');
});

test('V5 rejects unknown stale blocked and unsafe candidates with reasons', () => {
  const autoPick = buildConciergeAutoPick({
    candidates: [
      { id: 'unknown', title: 'unknown state', headSha: 'b'.repeat(40), state: 'unknown', mergeable: true, requiredChecksClean: true, proofCommands: ['npm test'] },
      { id: 'blocked', title: 'blocked work', headSha: 'c'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, blockers: ['operator hold'], proofCommands: ['npm test'] },
      { id: 'unsafe', title: 'unsafe proof', headSha: 'd'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, proofCommands: ['rm -rf tmp'] },
      { id: 'stale', title: 'stale work', headSha: 'e'.repeat(40), state: 'OPEN', mergeable: true, requiredChecksClean: true, stale: true, proofCommands: ['npm test'] },
    ],
  });
  assert.equal(autoPick.selectedCandidate, null);
  assert.match(autoPick.rejectedCandidates.map((candidate) => candidate.rejectionReasons.join(' ')).join(' | '), /open\/ready state unknown/);
  assert.match(autoPick.rejectedCandidates.map((candidate) => candidate.rejectionReasons.join(' ')).join(' | '), /operator hold/);
  assert.match(autoPick.rejectedCandidates.map((candidate) => candidate.rejectionReasons.join(' ')).join(' | '), /outside the Battle Bridge allowlist/);
  assert.match(autoPick.rejectedCandidates.map((candidate) => candidate.rejectionReasons.join(' ')).join(' | '), /stale/);
});

test('V5 does not claim live GitHub proof without adapter and preserves exact-head boundary', () => {
  const plan = buildConciergePlan({
    repositoryRoot: '/repo',
    workingTreeClean: true,
    pullRequests: [{ number: 1398, title: 'adapterless live proof request', headSha: head, state: 'OPEN', mergeable: true, requiredChecksClean: true, liveGithubProof: true, proofCommands: ['npm test'] }],
  });
  assert.equal(plan.autoPick.liveGithubProof, 'not-claimed');
  assert.equal(plan.canStartProof, false);
  assert.match(plan.blockers.join(' '), /no explicit adapter/);
  assert.equal(plan.exactHeadApproval.token, battleBridgeMergeApprovalToken({ prNumber: 1398, headSha: head }));
  assert.equal(plan.guardrails.neverMerge, true);
});


test('V3 guarded proof packet keeps exact-head token and never allows merge', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 1393, headSha: head, proofCommands: ['node --test shared/agents/battleBridgeBuildConciergeV2.test.mjs'] }, generatedArtifactsClean: true, commandResults: [{ command: 'node --test shared/agents/battleBridgeBuildConciergeV2.test.mjs', exitCode: 0 }], browserProofPacket: { browserProofStatus: 'verified', runnerAvailable: true, screenshotPath: 'artifacts/browser/v4.png', checklistStatus: 'passed', caveats: ['none'] } });
  assert.equal(packet.schemaVersion, 'stephanos.battle-bridge-build-concierge.v6.proof-packet');
  assert.equal(packet.packetKind, 'canonical-battle-bridge-build-concierge-proof');
  assert.equal(packet.requiredApprovalToken, battleBridgeMergeApprovalToken({ prNumber: 1393, headSha: head }));
  assert.equal(packet.mergeAllowed, false);
  assert.equal(packet.finalVerdict, 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL');
});

test('allowlist blocks unsafe commands before proof execution', () => {
  const validation = validateConciergeCommand('rm -rf apps/stephanos/dist');
  assert.equal(validation.allowed, false);
  assert.match(validation.blocker, /outside the Battle Bridge allowlist/);
});

test('V3 dirty or unsafe context returns truthful blocked prove state without merge', () => {
  const plan = buildConciergePlan({ repositoryRoot: '/repo', workingTreeClean: false, pullRequests: [{ number: 1393, headSha: head, state: 'OPEN', mergeable: true, requiredChecksClean: true, changedFiles: ['shared/agents/a.mjs'], proofCommands: ['npm run stephanos:build'] }] });
  const blocked = buildConciergeProveBlocked({ plan, blockers: plan.blockers });
  assert.equal(blocked.finalVerdict, 'PROVE_BLOCKED_OR_UNKNOWN');
  assert.equal(blocked.mergeAllowed, false);
  assert.match(blocked.mergeHoldState, /HELD/);
  assert.equal(blocked.requiredApprovalToken, battleBridgeMergeApprovalToken({ prNumber: 1393, headSha: head }));
});


test('V4 browser proof unavailable returns explicit blocker, not fake pass', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 1395, headSha: head }, generatedArtifactsClean: true, commandResults: [{ command: 'npm run stephanos:build', exitCode: 0 }], browserProofPacket: { runnerAvailable: false, unavailableReason: 'Playwright browser runtime is not installed.' } });
  assert.equal(packet.browserProof, 'blocked_unavailable');
  assert.equal(packet.proofPacketSummary.status, 'PROOF_PACKET_BLOCKED');
  assert.match(packet.browserProofPacket.proofUnavailableBlocker, /Playwright browser runtime is not installed/);
  assert.equal(packet.mergeAllowed, false);
});

test('V4 browser proof packet preserves screenshot checklist caveats and console errors', () => {
  const packet = buildConciergeProofPacket({ candidate: { prNumber: 1395, headSha: head }, generatedArtifactsClean: true, commandResults: [{ command: 'npm run stephanos:build', exitCode: 0 }], browserProofPacket: { browserProofStatus: 'verified', runnerAvailable: true, screenshotPath: 'artifacts/browser/build-concierge-v4.png', checklistStatus: 'passed', checklist: [{ item: 'Mission Operations visible', status: 'passed' }], caveats: ['Animations disabled for capture.'], consoleErrors: ['Failed to load optional favicon.'] } });
  assert.equal(packet.browserProof, 'verified');
  assert.equal(packet.browserProofPacket.screenshotPath, 'artifacts/browser/build-concierge-v4.png');
  assert.equal(packet.browserProofPacket.checklistStatus, 'passed');
  assert.deepEqual(packet.browserProofPacket.caveats, ['Animations disabled for capture.']);
  assert.deepEqual(packet.browserProofPacket.consoleErrors, ['Failed to load optional favicon.']);
});

test('V6 approval decision accepts only exact PR/head approval token', () => {
  const token = battleBridgeMergeApprovalToken({ prNumber: 1400, headSha: head });
  const decision = buildConciergeApprovalDecision({ selectedCandidate: { prNumber: 1400, title: 'V6 approval', headSha: head }, proofSummary: { status: 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL', commandCount: 2, browserProof: 'verified' }, currentHeadSha: head, approvalToken: token });
  assert.equal(decision.approvalToken, token);
  assert.equal(decision.approvalStatus, 'approved_exact_head');
  assert.equal(decision.rejectionStatus, 'not_rejected');
  assert.equal(decision.mergeAllowed, false);
  assert.equal(decision.commandExecutionAllowed, false);
  assert.equal(decision.uiMergeClaim, false);
});

test('V6 approval decision rejects wrong PR head or token', () => {
  const token = battleBridgeMergeApprovalToken({ prNumber: 1400, headSha: head });
  for (const input of [
    { prNumber: 1401, headSha: head, currentHeadSha: head, approvalToken: token },
    { prNumber: 1400, headSha: head, currentHeadSha: 'd'.repeat(40), approvalToken: token },
    { prNumber: 1400, headSha: head, currentHeadSha: head, approvalToken: 'APPROVE_BATTLE_BRIDGE_EXACT_HEAD_MERGE:1400:' + 'e'.repeat(40) },
  ]) {
    const decision = buildConciergeApprovalDecision({ selectedCandidate: { prNumber: input.prNumber, headSha: input.headSha }, proofSummary: { status: 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL' }, currentHeadSha: input.currentHeadSha, approvalToken: input.approvalToken });
    assert.equal(decision.approvalStatus, 'blocked_invalid_token');
    assert.equal(decision.mergeAllowed, false);
    assert.ok(decision.blockers.length > 0);
  }
});

test('V6 rejection state produces receipt and blocks merge', () => {
  const decision = buildConciergeApprovalDecision({ selectedCandidate: { prNumber: 1400, headSha: head }, proofSummary: { status: 'PROOF_PACKET_READY_FOR_EXACT_HEAD_APPROVAL' }, decision: 'reject', rejectionReason: 'Needs operator changes.' });
  assert.equal(decision.approvalStatus, 'blocked_by_rejection');
  assert.equal(decision.rejectionStatus, 'rejected_with_receipt');
  assert.equal(decision.rejectionReceipt.status, 'blocks_merge');
  assert.equal(decision.mergeAllowed, false);
  assert.match(decision.nextOperatorAction, /blocks merge/);
});

test('V6 roadmap is implemented_guarded', () => {
  const roadmap = buildConciergeRoadmap();
  assert.equal(roadmap.phases.find((phase) => phase.version === 'V6').status, 'implemented_guarded');
});
