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
