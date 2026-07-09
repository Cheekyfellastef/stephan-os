import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexBuilderLaneBrief, BUILDER_LANE_STATE } from './codexBuilderLaneBriefV1.mjs';

const SHA = '5d3412b26393fcfc4627bb0b1a1e942e3dac9651';

test('clean scout intent produces ready-to-scout brief', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', intent: 'scout', targetBranch: 'builder/1284', targetFiles: ['shared/agents/codexBuilderLaneBriefV1.mjs'] },
    { observedBranch: 'builder/1284', dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.READY_TO_SCOUT);
  assert.equal(brief.nextOwner, 'codex');
  assert.equal(brief.mergeAllowed, false);
  assert.equal(brief.shellExecutionAllowed, false);
});

test('dirty main with runtime files blocks local write/pull', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', requestedCommands: ['git pull --rebase'] },
    { observedBranch: 'main', dirtyFiles: ['runtime/session.json', 'shared/agents/example.mjs'] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.BLOCKED_UNSAFE_COMMAND);
  assert.equal(brief.safetyBlockers.includes('unsafe-command-requested'), true);

  const dirtyBrief = buildCodexBuilderLaneBrief(
    { issue: '1284' },
    { observedBranch: 'main', dirtyFiles: ['runtime/session.json'] },
  );
  assert.equal(dirtyBrief.state, BUILDER_LANE_STATE.BLOCKED_DIRTY_MAIN);
  assert.equal(dirtyBrief.safetyBlockers.includes('runtime-generated-dirt-present'), true);
});

test('missing remote head requires publication proof', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', targetBranch: 'builder/1284' },
    { observedBranch: 'builder/1284', observedHead: SHA, prNumber: 1500, dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.PUBLICATION_PROOF_NEEDED);
  assert.equal(brief.publicationProofRequired, true);
  assert.equal(brief.requiredProofs.includes('PRPublicationVerifier PASS with exact PR/head proof'), true);
});

test('lost patch routes to Patch Courier', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', targetFiles: ['shared/agents/codexBuilderLaneBriefV1.mjs'], lostPatch: true },
    { observedBranch: 'builder/1284', dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.BLOCKED_LOST_PATCH);
  assert.equal(brief.courierRequired, true);
  assert.match(brief.smallestNextOperatorAction, /git diff --binary -- shared\/agents\/codexBuilderLaneBriefV1\.mjs/);
});

test('unsafe commands are rejected', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', requestedCommands: ['git push origin HEAD'] },
    { observedBranch: 'builder/1284', dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.BLOCKED_UNSAFE_COMMAND);
  assert.equal(brief.safetyBlockers.includes('unsafe-command-requested'), true);
});

test('success claim without proof is blocked', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284' },
    { observedBranch: 'builder/1284', observedHead: SHA, successClaimed: true, dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.PUBLICATION_PROOF_NEEDED);
  assert.equal(brief.safetyBlockers.includes('success-claim-without-publication-proof'), true);
});

test('Codex commit SHA without remote proof is not trusted', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284' },
    { observedBranch: 'builder/1284', observedHead: SHA, dirtyFiles: [] },
  );
  assert.equal(brief.state, BUILDER_LANE_STATE.PUBLICATION_PROOF_NEEDED);
  assert.equal(brief.publicationProof.finalVerdict, 'PR_PUBLICATION_VERIFIER_BLOCKED');
});

test('exact PR/head proof unlocks review-ready state but still does not merge', () => {
  const brief = buildCodexBuilderLaneBrief(
    { issue: '1284', targetBranch: 'builder/1284' },
    {
      observedBranch: 'builder/1284',
      observedHead: SHA,
      remoteHead: SHA,
      fetchedOriginBranchSha: SHA,
      testedHeadSha: SHA,
      prNumber: 1500,
      prCommits: [SHA],
      dirtyFiles: [],
    },
  );
  assert.equal(brief.publicationState, 'review-ready-with-exact-publication-proof');
  assert.equal(brief.publicationProof.finalVerdict, 'PR_PUBLICATION_VERIFIER_PASS');
  assert.equal(brief.mergeAllowed, false);
  assert.match(brief.smallestNextOperatorAction, /do not merge/i);
});
