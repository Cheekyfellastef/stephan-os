import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGitHubOperatorBriefing, GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS, renderGitHubOperatorBriefingHuman } from './githubOperatorAssistantV1.mjs';

test('builds deterministic GitHub operator briefing from evidence fixtures', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../tests/fixtures/github-operator-assistant/input.json', import.meta.url), 'utf8'));
  const briefing = buildGitHubOperatorBriefing(fixture);
  assert.equal(briefing.schemaVersion, 'github-operator-assistant.v1');
  assert.equal(briefing.status, 'BLOCKED');
  assert.deepEqual(briefing.focusIssues, [1284, 1286, 1287]);
  assert.equal(briefing.readyForReview.some((item) => item.number === 1448), true);
  assert.equal(briefing.blocked.some((item) => item.number === 1444 && item.kind === 'pr-runtime-blocked'), true);
  assert.equal(briefing.blocked.some((item) => item.number === 1450 && item.kind === 'pr-head-mismatch'), true);
  assert.equal(briefing.waitingForImplementation.some((item) => item.number === 1286), true);
  assert.equal(briefing.evidence.some((item) => item.prNumber === 1448 && item.marker === 'PR_PUBLICATION_VERIFIER_PASS'), true);
});

test('classifies missing publication proof separately from claimed summaries', () => {
  const briefing = buildGitHubOperatorBriefing({
    generatedAtUtc: '2026-07-08T00:00:00.000Z',
    pullRequests: [{ number: 1500, title: 'Claimed ready', headSha: 'a'.repeat(40), claimedHeadSha: 'a'.repeat(40), checksStatus: 'pass', readyForReview: true }],
    evidence: [],
  });
  assert.equal(briefing.readyForReview.length, 0);
  assert.equal(briefing.waitingForProof[0].kind, 'pr-missing-publication-proof');
});

test('exposes only read-only allowlisted command shapes and renders compact human briefing', () => {
  assert.equal(GITHUB_OPERATOR_ASSISTANT_ALLOWED_COMMANDS.every((command) => !/pr merge|issue close|branch -d|delete-branch|reset --hard|sh -c|powershell/i.test(command)), true);
  const human = renderGitHubOperatorBriefingHuman(buildGitHubOperatorBriefing({ generatedAtUtc: '2026-07-08T00:00:00.000Z' }));
  assert.match(human, /GitHub Operator Assistant V1/);
  assert.match(human, /Ready for review: none/);
});

test('requires an explicit structured publication marker rather than claimed summary text', () => {
 const briefing=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,headSha:'a'.repeat(40),checksStatus:'pass'}],
  evidence:[{prNumber:1500,summary:'No PR_PUBLICATION_VERIFIER_PASS was found'}],
 });
 assert.equal(briefing.status,'WAITING_FOR_PROOF');
 assert.equal(briefing.readyForReview.length,0);
 assert.equal(briefing.waitingForProof[0].kind,'pr-missing-publication-proof');
});

test('never returns PASS while proof, operator or implementation work remains', () => {
 const withProofMissing=buildGitHubOperatorBriefing({pullRequests:[{number:1500,checksStatus:'pass'}]});
 assert.equal(withProofMissing.status,'WAITING_FOR_PROOF');
 const withOperator=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,checksStatus:'pass',operatorApprovalRequired:true,publicationVerified:true}],
 });
 assert.equal(withOperator.status,'WAITING_FOR_OPERATOR');
 const withImplementation=buildGitHubOperatorBriefing({issues:[{number:1286,status:'waiting-for-implementation'}]});
 assert.equal(withImplementation.status,'WAITING_FOR_IMPLEMENTATION');
});

test('normalizes allowlisted GitHub PR HEAD, branch and complete successful check rollups', () => {
 const briefing=buildGitHubOperatorBriefing({
  pullRequests:[{number:1500,headRefName:'owner/feature',headRefOid:'a'.repeat(40),
   statusCheckRollup:[{status:'COMPLETED',conclusion:'SUCCESS'},{state:'SUCCESS'}]}],
  evidence:[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}],
 });
 assert.equal(briefing.status,'PASS');
 assert.equal(briefing.readyForReview.length,1);
 assert.equal(briefing.readyForReview[0].headSha,'a'.repeat(40));
 assert.equal(briefing.readyForReview[0].branch,'owner/feature');
});

test('rejects missing, pending, failing, draft and contradictory check evidence', () => {
 const verified=[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}];
 const cases=[
  {number:1500},
  {number:1500,statusCheckRollup:[]},
  {number:1500,statusCheckRollup:[{status:'IN_PROGRESS',conclusion:''}]},
  {number:1500,statusCheckRollup:[{status:'COMPLETED',conclusion:'FAILURE'}]},
  {number:1500,checksStatus:'pass',statusCheckRollup:[{status:'COMPLETED',conclusion:'FAILURE'}]},
  {number:1500,checksStatus:'pass',isDraft:true},
 ];
 for(const pr of cases){
  const briefing=buildGitHubOperatorBriefing({pullRequests:[pr],evidence:verified});
  assert.equal(briefing.readyForReview.length,0);
  assert.equal(briefing.status,'WAITING_FOR_PROOF');
 }
});

test('detects claimed HEAD drift and contradictory GitHub field aliases', () => {
 const verified=[{prNumber:1500,marker:'PR_PUBLICATION_VERIFIER_PASS'}];
 const drift=buildGitHubOperatorBriefing({pullRequests:[{
  number:1500,headRefOid:'a'.repeat(40),claimedHeadSha:'b'.repeat(40),checksStatus:'pass'}],evidence:verified});
 assert.equal(drift.blocked[0].kind,'pr-head-mismatch');
 const conflict=buildGitHubOperatorBriefing({pullRequests:[{
  number:1500,headSha:'a'.repeat(40),headRefOid:'b'.repeat(40),checksStatus:'pass'}],evidence:verified});
 assert.equal(conflict.blocked[0].kind,'pr-head-evidence-conflict');
});
